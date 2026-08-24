"""One-click connect service — POC side (async mirror of talentOS).

The POC is the connect *initiator*:
  - ``start_connect`` mints a local ``rhub_`` key, calls talentOS ``provision``
    (shared service key) to mint ``tal_``, and stores the tenant binding.
  - ``handle_ping`` (ping_a, talentOS -> POC) validates the caller-presented
    ``rhub_`` key and records proof; ``_ping_talentos`` (ping_b, POC -> talentOS)
    presents the ``tal_`` key and records talentOS's proof.
  - Both proofs must land (``ping_a_verified`` AND ``ping_b_verified``) before
    the link becomes ``linked`` — order-independent.

Credentials are returned only by the provisioning response (and its replay);
every other path returns state/proof, never keys.
"""

from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.api_keys.api_key_schema import CreateApiKeyRequest
from app.modules.api_keys.api_key_service import ApiKeyService
from app.modules.talentos_integration.connect_models import (
    OPERATION_CONNECT,
    OPERATION_DISCONNECT,
    PROVIDER_POC,
    PROVIDER_TALENTOS,
    REPLAYABLE_STATES,
    STATE_DISCONNECTED,
    STATE_KEYS_EXCHANGED,
    STATE_LINKED,
    STATE_NONE,
    STATE_PROVISIONING,
    STATE_VERIFYING,
    TRANSIENT_STATES,
    IntegrationLink,
    IntegrationLinkEvent,
    IntegrationLinkFlow,
    utcnow,
)
from app.modules.talentos_integration.talentos_be_client import (
    get_talentos_client_for_tenant,
)
from app.models.models import Tenant
from app.services.tenant_integrations_service import decrypt_value, encrypt_value

logger = logging.getLogger(__name__)

INTEGRATION_KEY_ROLE = "reviewer"  # informational — talentOS side mints with least privilege
MAX_ATTEMPTS = 8
BACKOFF_BASE_SECONDS = 30
BACKOFF_CAP_SECONDS = 30 * 60
BACKOFF_JITTER_SECONDS = 15
AWAIT_POLL = timedelta(seconds=15)


def backoff_delay(attempts: int) -> timedelta:
    exp = BACKOFF_BASE_SECONDS * (2 ** max(0, attempts - 1))
    capped = min(exp, BACKOFF_CAP_SECONDS)
    jitter = random.uniform(0, BACKOFF_JITTER_SECONDS)
    return timedelta(seconds=capped + jitter)


class ConnectService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── provisioning (initiator) ──────────────────────────────────────────────

    async def start_connect(
        self,
        *,
        actor_tenant_id: uuid.UUID | None,
        flow_id: uuid.UUID | None = None,
        tenant_name: str | None = None,
    ) -> dict:
        """Handle ``POST /api/integrations/talentos/connect``.

        Idempotent by ``flow_id``. First call mints rhub_, provisions talentOS,
        stores tal_ (encrypted); any replay with the same flow_id re-returns the
        same credentials (no new keys minted).
        """
        if actor_tenant_id is None:
            raise HTTPException(status_code=403, detail="Tenant-scoped credential required")
        flow_id = flow_id or uuid.uuid4()

        existing = await self._get_flow(flow_id)
        if existing is not None:
            return await self._replay(existing)

        link = await self._get_existing_link(actor_tenant_id)
        if link is not None:
            if link.state == STATE_LINKED:
                raise HTTPException(status_code=409, detail="Already connected")
            if link.state in TRANSIENT_STATES and link.current_flow_id is not None:
                return {
                    "flow_id": str(link.current_flow_id),
                    "state": link.state,
                    "already_in_progress": True,
                }

        # Mint the POC-issued rhub_ key, scoped to this tenant.
        created, rhub_raw = await ApiKeyService(self.db).create(
            CreateApiKeyRequest(
                name=f"talentos-{str(actor_tenant_id)[:12]}",
                description=f"Auto-provisioned talentOS integration key (flow {flow_id})",
            ),
            created_by_user_id=None,
            tenant_id=actor_tenant_id,
        )

        # Canonical tenant name — always send the POC-side Tenant.name so the
        # talentOS tenant and the tenantOS tenant are named identically.
        tenant = await self.db.get(Tenant, actor_tenant_id)
        resolved_tenant_name = (tenant.name if tenant else None) or tenant_name or ""

        # Provision talentOS (shared service key) -> returns tal_.
        client = await get_talentos_client_for_tenant(actor_tenant_id)
        prov = await client.provision_connection(
            flow_id=flow_id,
            tenant_name=resolved_tenant_name,
            external_tenant_id=str(actor_tenant_id),
            rh_api_key=rhub_raw,
        )
        if not prov or prov.get("state") != STATE_KEYS_EXCHANGED or not prov.get("tal_api_key"):
            await ApiKeyService(self.db).revoke(created.id)
            logger.error(
                "talentOS provisioning failed | flow_id=%s response=%s",
                flow_id, prov,
            )
            raise HTTPException(status_code=502, detail="talentOS provisioning failed")

        # Persist the link (get-or-create) + flow.
        link = await self._get_or_create_link(actor_tenant_id)
        link.external_tenant_id = str(prov.get("tenant_id", ""))
        link.rhub_key_id = created.id
        link.tal_key_id = str(prov["tal_key_id"])
        link.tal_key_enc = encrypt_value(prov["tal_api_key"])
        link.current_flow_id = flow_id
        link.state = STATE_KEYS_EXCHANGED

        flow = IntegrationLinkFlow(
            flow_id=flow_id,
            link_id=link.id,
            operation=OPERATION_CONNECT,
            state=STATE_KEYS_EXCHANGED,
            attempts=0,
            next_retry_at=utcnow(),
        )
        self.db.add(flow)
        await self.db.flush()
        await self._record_event(
            link_id=link.id,
            flow_id=flow_id,
            action="connect_keys_exchanged",
            actor="system",
            source="api",
            result="ok",
        )
        logger.info(
            "Provisioned talentOS link | flow_id=%s talentos_tenant_id=%s",
            flow_id, link.external_tenant_id,
        )
        # Prove ping_b in-request so handshake is not Celery-only. talentOS
        # still has to complete ping_a (its in-process reconciler).
        try:
            await self.reconcile_flow(flow)
        except Exception:
            logger.exception("Immediate ping_b after provision failed | flow_id=%s", flow_id)
        return {
            "flow_id": str(flow_id),
            "state": flow.state,
            "rhub_key_id": created.id,
            "tal_key_id": prov["tal_key_id"],
        }

    async def _replay(self, flow: IntegrationLinkFlow) -> dict:
        link = await self.db.get(IntegrationLink, flow.link_id)
        if link is None or flow.operation != OPERATION_CONNECT:
            raise HTTPException(status_code=409, detail="Flow not found or not a connect flow")

        if flow.state == STATE_LINKED:
            raise HTTPException(status_code=409, detail="Already connected")
        if flow.state not in REPLAYABLE_STATES:
            raise HTTPException(
                status_code=409,
                detail=f"Flow {flow.flow_id} is terminal ({flow.state}); start a new connect",
            )
        if not link.tal_key_enc:
            raise HTTPException(status_code=409, detail="Credential no longer replayable")
        return {
            "flow_id": str(flow.flow_id),
            "state": flow.state,
            "rhub_key_id": link.rhub_key_id,
            "tal_key_id": link.tal_key_id,
            "tal_api_key": decrypt_value(link.tal_key_enc),
            "replayed": True,
        }

    async def get_status(self, flow_id: uuid.UUID) -> dict:
        """Status polling — NEVER returns credentials."""
        flow = await self._get_flow(flow_id)
        if flow is None:
            raise HTTPException(status_code=404, detail="Flow not found")
        return {
            "flow_id": str(flow.flow_id),
            "state": flow.state,
            "operation": flow.operation,
            "external_tenant_id": await self._link_external_tenant_id(flow.link_id),
            "attempts": flow.attempts,
            "ping_a_verified": flow.ping_a_verified,
            "ping_b_verified": flow.ping_b_verified,
        }

    # ── ping_a: talentOS -> POC (bearer rhub_ + X-Flow-Id) ────────────────────

    async def handle_ping(self, flow_id: uuid.UUID, raw_key: str | None) -> dict:
        """``GET /internal/talentos/connections/ping`` (talentOS -> POC).

        Derives the tenant from the presented ``rhub_`` key, cross-checks it
        against the flow/link, records ping_a, and returns OUR link values —
        never trusts a caller-supplied tenant id.
        """
        if not raw_key:
            raise HTTPException(status_code=401, detail="Missing credential")
        api_key = await ApiKeyService.validate_api_key(raw_key, self.db)
        if api_key is None or api_key.tenant_id is None:
            raise HTTPException(status_code=401, detail="Invalid or revoked credential")

        flow = await self._get_flow(flow_id)
        if flow is None or flow.operation != OPERATION_CONNECT:
            raise HTTPException(status_code=404, detail="Flow not found")
        link = await self.db.get(IntegrationLink, flow.link_id)
        if link is None or link.rhub_key_id is None or link.rhub_key_id != api_key.id:
            raise HTTPException(status_code=403, detail="Credential does not match this link")
        if link.tenant_id != api_key.tenant_id:
            raise HTTPException(status_code=403, detail="Credential does not match this link")
        if link.current_flow_id != flow_id:
            raise HTTPException(status_code=409, detail="Stale flow")

        if flow.state in (STATE_LINKED, "failed"):
            return self._ping_proof(link, flow)

        if flow.state not in (STATE_KEYS_EXCHANGED, STATE_VERIFYING, STATE_PROVISIONING):
            raise HTTPException(status_code=409, detail=f"Flow in state {flow.state}")

        flow.ping_a_verified = True
        if flow.ping_b_verified:
            await self._mark_linked(link, flow)
        else:
            flow.state = STATE_VERIFYING
            flow.next_retry_at = utcnow() + AWAIT_POLL
        await self._record_event(
            link_id=link.id,
            flow_id=flow_id,
            action="ping_rhub_verified",
            actor="system",
            source="api",
            result="ok",
        )
        return self._ping_proof(link, flow)

    @staticmethod
    def _ping_proof(link: IntegrationLink, flow: IntegrationLinkFlow) -> dict:
        return {
            "flow_id": str(flow.flow_id),
            "external_tenant_id": link.external_tenant_id,
            "provider": link.provider,
        }

    # ── disconnect (idempotent, even when already disconnected) ────────────────

    async def disconnect(
        self, *, actor_tenant_id: uuid.UUID | None, flow_id: uuid.UUID | None
    ) -> dict:
        """``POST /api/integrations/talentos/disconnect``.

        Best-effort remote revoke of tal_, then local cleanup: revoke rhub_,
        clear enc, reset link, mark the disconnect flow terminal.
        """
        if actor_tenant_id is None:
            raise HTTPException(status_code=403, detail="Tenant-scoped credential required")
        flow_id = flow_id or uuid.uuid4()

        link = await self._get_existing_link(actor_tenant_id)
        if link is None:
            return {"flow_id": str(flow_id), "state": STATE_NONE, "result": "ok"}

        # Best-effort remote disconnect (revokes tal_ on talentOS).
        try:
            client = await get_talentos_client_for_tenant(actor_tenant_id)
            await client.disconnect_connection(
                flow_id=flow_id, external_tenant_id=str(actor_tenant_id)
            )
        except Exception:
            logger.exception("talentOS disconnect best-effort failed | link=%s", link.id)

        await self._revoke_rhub(link)
        link.tal_key_enc = None
        link.state = STATE_NONE
        link.current_flow_id = None
        link.connected_at = None

        flow = await self._get_flow(flow_id)
        if flow is None:
            flow = IntegrationLinkFlow(
                flow_id=flow_id,
                link_id=link.id,
                operation=OPERATION_DISCONNECT,
                state=STATE_DISCONNECTED,
                attempts=0,
                next_retry_at=None,
            )
            self.db.add(flow)
        else:
            flow.operation = OPERATION_DISCONNECT
            flow.state = STATE_DISCONNECTED
            flow.next_retry_at = None
            flow.attempts = 0

        await self.db.flush()
        await self._record_event(
            link_id=link.id,
            flow_id=flow_id,
            action="disconnect_completed",
            actor="system",
            source="api",
            result="ok",
        )
        return {"flow_id": str(flow_id), "state": STATE_NONE, "result": "ok"}

    # ── reconciler entry points ───────────────────────────────────────────────

    async def reconcile_flow(self, flow: IntegrationLinkFlow) -> str:
        """Advance one transient flow. Returns a coarse outcome for logging."""
        if flow.operation == OPERATION_DISCONNECT:
            return "disconnect"  # defensive — disconnect flows are already terminal
        if flow.operation != OPERATION_CONNECT:
            return "wait"
        link = await self.db.get(IntegrationLink, flow.link_id)
        if link is None:
            await self._fail_connect_nolink(flow, "LINK_MISSING")
            return "failed"
        return await self._reconcile_connect(link, flow)

    async def _reconcile_connect(self, link: IntegrationLink, flow: IntegrationLinkFlow) -> str:
        if flow.state not in REPLAYABLE_STATES:
            return "wait"

        # Inbound direction (talentOS -> POC) already proven — only awaiting ping_b.
        if flow.ping_b_verified:
            return self._retry_or_wait(link, flow, event="await_inbound_ping", retry=True)

        if not link.tal_key_enc:
            await self._fail_connect(link, flow, "TAL_KEY_MISSING", "peer tal_ key not stored")
            return "failed"
        tal_raw = decrypt_value(link.tal_key_enc)
        if not tal_raw:
            await self._fail_connect(link, flow, "TAL_KEY_MISSING", "peer tal_ key not stored")
            return "failed"

        proof = await self._ping_talentos(link, flow, tal_raw)
        if not proof:
            self._retry_or_wait(link, flow, event="ping_b_failed", retry=True)
            return "retry"

        # Cross-check talentOS's proof echoes OUR binding.
        if (
            str(proof.get("flow_id", "")) == str(flow.flow_id)
            and str(proof.get("external_tenant_id", "")) == str(link.tenant_id)
            and str(proof.get("provider", "")) == PROVIDER_POC
        ):
            flow.ping_b_verified = True
            await self._record_event(
                link_id=link.id,
                flow_id=flow.flow_id,
                action="ping_tal_verified",
                actor="system",
                source="reconciler",
                result="ok",
            )
            if flow.ping_a_verified:
                await self._mark_linked(link, flow)
                return "linked"
            flow.next_retry_at = utcnow() + AWAIT_POLL
            return "await_inbound_ping"

        self._retry_or_wait(link, flow, event="ping_b_mismatch", retry=AWAIT_POLL)
        return "retry"

    async def _ping_talentos(
        self, link: IntegrationLink, flow: IntegrationLinkFlow, tal_raw: str
    ) -> dict | None:
        """Send the outbound ping (POC -> talentOS) using the peer tal_ key."""
        client = await get_talentos_client_for_tenant(link.tenant_id)
        try:
            return await client.ping_connection(tal_raw, str(flow.flow_id))
        except Exception:
            logger.exception("ping_b to talentOS failed | flow_id=%s", flow.flow_id)
            return None

    # ── linked / backoff / fail ───────────────────────────────────────────────

    async def _mark_linked(self, link: IntegrationLink, flow: IntegrationLinkFlow) -> None:
        link.tal_key_enc = None
        link.state = STATE_LINKED
        link.connected_at = utcnow()
        flow.state = STATE_LINKED
        flow.next_retry_at = None
        flow.last_error_code = None
        flow.last_error = None
        await self._record_event(
            link_id=link.id,
            flow_id=flow.flow_id,
            action="linked",
            actor="system",
            source="reconciler",
            result="ok",
        )
        logger.info(
            "talentOS integration linked | link_id=%s tenant_id=%s flow_id=%s",
            link.id, link.tenant_id, flow.flow_id,
        )

    def _retry_or_wait(
        self, link: IntegrationLink, flow: IntegrationLinkFlow, *, event: str, retry
    ) -> str:
        flow.attempts += 1
        flow.last_error_code = event
        flow.last_error = self._sanitize(event)
        if flow.attempts >= MAX_ATTEMPTS:
            # fire-and-forget async failure (state persisted by caller commit)
            self._fail_connect_sync(link, flow, "RECONCILE_TIMEOUT", event)
            return "failed"
        if isinstance(retry, timedelta):
            flow.next_retry_at = utcnow() + retry
        else:
            flow.next_retry_at = utcnow() + backoff_delay(flow.attempts)
        return event

    async def _fail_connect(
        self, link: IntegrationLink, flow: IntegrationLinkFlow, code: str, detail: str
    ) -> None:
        await self._revoke_rhub(link)
        link.tal_key_enc = None
        link.state = "failed"
        flow.state = "failed"
        flow.next_retry_at = None
        flow.last_error_code = code
        flow.last_error = self._sanitize(detail)
        await self._record_event(
            link_id=link.id,
            flow_id=flow.flow_id,
            action="failed",
            detail=f"{code}: {self._sanitize(detail)}",
            actor="system",
            source="reconciler",
            result="error",
        )

    def _fail_connect_sync(
        self, link: IntegrationLink, flow: IntegrationLinkFlow, code: str, detail: str
    ) -> None:
        link.state = "failed"
        flow.state = "failed"
        flow.next_retry_at = None
        flow.last_error_code = code
        flow.last_error = self._sanitize(detail)

    async def _fail_connect_nolink(self, flow: IntegrationLinkFlow, code: str) -> None:
        flow.state = "failed"
        flow.next_retry_at = None
        flow.last_error_code = code
        flow.last_error = self._sanitize(code)

    async def cleanup_expired(self, *, batch: int = 200) -> int:
        """Fail transient flows whose attempts exceed the budget."""
        now = utcnow()
        result = await self.db.execute(
            select(IntegrationLinkFlow)
            .where(
                IntegrationLinkFlow.state.in_(TRANSIENT_STATES),
                IntegrationLinkFlow.attempts >= MAX_ATTEMPTS,
            )
            .limit(batch)
        )
        flowed = 0
        for flow in result.scalars().all():
            link = await self.db.get(IntegrationLink, flow.link_id)
            if link is not None:
                await self._fail_connect(link, flow, "RECONCILE_BUDGET", "reconcile budget exhausted")
            else:
                await self._fail_connect_nolink(flow, "LINK_MISSING")
            flowed += 1
        return flowed

    # ── helpers ──────────────────────────────────────────────────────────────

    async def _get_flow(self, flow_id: uuid.UUID) -> IntegrationLinkFlow | None:
        result = await self.db.execute(
            select(IntegrationLinkFlow).where(IntegrationLinkFlow.flow_id == flow_id)
        )
        return result.scalars().first()

    async def _link_external_tenant_id(self, link_id: uuid.UUID) -> str | None:
        link = await self.db.get(IntegrationLink, link_id)
        return link.external_tenant_id if link else None

    async def _get_existing_link(self, tenant_id: uuid.UUID) -> IntegrationLink | None:
        result = await self.db.execute(
            select(IntegrationLink)
            .where(
                IntegrationLink.provider == PROVIDER_TALENTOS,
                IntegrationLink.tenant_id == tenant_id,
            )
            .with_for_update()
        )
        return result.scalars().first()

    async def _get_or_create_link(self, tenant_id: uuid.UUID) -> IntegrationLink:
        link = await self._get_existing_link(tenant_id)
        if link is not None:
            return link
        link = IntegrationLink(
            provider=PROVIDER_TALENTOS,
            tenant_id=tenant_id,
            external_tenant_id="",
            state=STATE_NONE,
        )
        self.db.add(link)
        await self.db.flush()
        return link

    async def _revoke_rhub(self, link: IntegrationLink) -> None:
        if link.rhub_key_id is not None:
            try:
                await ApiKeyService(self.db).revoke(link.rhub_key_id)
            except Exception:
                logger.exception("Failed to revoke rhub_ key id=%s", link.rhub_key_id)
            link.rhub_key_id = None

    async def _record_event(
        self,
        *,
        link_id: uuid.UUID,
        flow_id: uuid.UUID | None = None,
        action: str,
        actor: str | None = None,
        source: str | None = None,
        result: str | None = None,
        detail: str | None = None,
    ) -> None:
        self.db.add(
            IntegrationLinkEvent(
                link_id=link_id,
                flow_id=flow_id,
                action=action,
                actor=actor,
                source=source,
                result=result,
                detail=self._sanitize(detail) if detail else None,
            )
        )
        await self.db.flush()

    @staticmethod
    def _sanitize(message: str) -> str:
        scrubbed = message
        for marker in ("rhub_", "tal_", "bearer ", "authorization"):
            scrubbed = scrubbed.replace(marker, "")
        return scrubbed
