"""Built-in starting point for extension detection.

Used to seed the database the first time it is read. After that the database is
authoritative and a Super Admin edits it; nothing here is consulted again.
The same shapes are validated by app.schemas.integrity.PolicyRules.

Scoring (implemented in the browser extension, see chrome-extension/rules.js):
  intent     = sum of matched keyword weights (each keyword once)
               + vendor_host_weight if a host permission points at an AI vendor
               + homepage_weight if the extension's homepage is an AI vendor
  capability = sum of weights of declared API permissions
               + broad_host_weight if it can run on every site
  strong     = intent >= intent_strong AND capability >= capability_strong
  weak       = intent >= intent_weak (and not strong)
Capability alone never flags: ad blockers and password managers have it.
"""

from __future__ import annotations

from datetime import date
from typing import Any

POLICY_ID = 1
DEFAULT_MODE = "shadow"

DEFAULT_RULES: dict[str, Any] = {
    "intent": {
        "keywords": [
            # Interview-specific wording: the clearest intent signal.
            {"term": "interview copilot", "weight": 4},
            {"term": "interview assistant", "weight": 4},
            {"term": "interview helper", "weight": 4},
            {"term": "interview buddy", "weight": 4},
            {"term": "interview coach", "weight": 3},
            {"term": "interview ai", "weight": 3},
            # Model and vendor names.
            {"term": "chatgpt", "weight": 3},
            {"term": "gpt-4", "weight": 3},
            {"term": "gpt-5", "weight": 3},
            {"term": "openai", "weight": 3},
            {"term": "claude", "weight": 3},
            {"term": "anthropic", "weight": 3},
            {"term": "gemini", "weight": 3},
            {"term": "deepseek", "weight": 3},
            {"term": "perplexity", "weight": 3},
            {"term": "grok", "weight": 3},
            {"term": "llm", "weight": 3},
            {"term": "copilot", "weight": 2},
            # Generic AI wording.
            {"term": "ai assistant", "weight": 2},
            {"term": "ai assist", "weight": 2},
            {"term": "ai-powered", "weight": 2},
            {"term": "ai powered", "weight": 2},
            {"term": "ai copilot", "weight": 2},
            {"term": "ai chatbot", "weight": 2},
            {"term": "ai answer", "weight": 2},
            {"term": "answer generator", "weight": 2},
            {"term": "gpt", "weight": 2},
            {"term": "interviewer", "weight": 2},
            {"term": "interview answer", "weight": 3},
            {"term": "coding interview", "weight": 3},
            {"term": "suggested answer", "weight": 3},
            {"term": "ai tutor", "weight": 2},
            {"term": "ai", "weight": 2},
            {"term": "answer", "weight": 1},
            {"term": "interview", "weight": 1},
        ],
        "vendor_hosts": [
            "openai.com",
            "chatgpt.com",
            "anthropic.com",
            "claude.ai",
            "perplexity.ai",
            "gemini.google.com",
            "copilot.microsoft.com",
            "deepseek.com",
            "mistral.ai",
            "poe.com",
            "character.ai",
            "x.ai",
        ],
        "vendor_host_weight": 4,
        "homepage_weight": 2,
    },
    "capability": {
        "permissions": {
            "tabCapture": 3,
            "desktopCapture": 3,
            "sidePanel": 2,
            "offscreen": 1,
            "scripting": 1,
            "activeTab": 1,
        },
        "broad_host_weight": 3,
    },
    "thresholds": {"intent_strong": 4, "capability_strong": 3, "intent_weak": 2},
}

_STORE = "https://chromewebstore.google.com/detail/"


def _entry(extension_id: str, name: str, category: str, reason: str) -> dict[str, Any]:
    return {
        "extension_id": extension_id,
        "name": name,
        "category": category,
        "reason": reason,
        "listing_url": f"{_STORE}{extension_id}",
        "status": "active",
        "verified_on": date(2026, 10, 12),
    }


# Every ID was read off the extension's own Chrome Web Store listing
# (directories are not trusted - one attributed an unrelated extension).
SEED_BLOCKLIST: list[dict[str, Any]] = [
    _entry(
        "ofpnmcalabcbjgholdjcjblkibolbppb",
        "Monica: All-In-One AI Assist & Smartest AI Agent",
        "ai_assistant",
        "AI assistant that adds a sidebar and overlays to pages and can answer questions as you browse.",
    ),
    _entry(
        "lfbbdphejjjanjiohlmkdbapdmfoaeem",
        "Final Round AI",
        "interview_assistant",
        "Interview copilot that provides real-time answers and coaching during interviews.",
    ),
    _entry(
        "ibdllmhlcnecbccejcjbpdldgjnohpoc",
        "Interview Copilot",
        "interview_assistant",
        "Listens to interview questions and generates suggested answers in real time.",
    ),
    _entry(
        "jkmbojgnflgmonjnpemjoidfmhjofbaa",
        "AI Interview Helper",
        "interview_assistant",
        "Provides live interview analysis and response suggestions during interviews.",
    ),
    _entry(
        "bankjceeoiajhanakmghlbnahahkmaic",
        "Interview Buddy - Your AI Interview Copilot",
        "interview_assistant",
        "Transcribes interviewer audio and shows suggested answers in a floating overlay.",
    ),
    _entry(
        "amgblhcclnikballgldanljepeplfdkh",
        "VoiceMeetAI - AI Interview Assistant",
        "interview_assistant",
        "Transcribes tab audio and generates answers during interviews.",
    ),
    _entry(
        "difoiogjjojoaoomphldepapgpbgkhkb",
        "Sider: Chat with all AI",
        "ai_assistant",
        "General-purpose AI sidebar that can read the page and answer questions.",
    ),
    _entry(
        "mhnlakgilnojmhinhkckjpncpbhabphi",
        "MaxAI: Ask AI anything as you browse",
        "ai_assistant",
        "General-purpose AI sidebar and context menu that can read the page.",
    ),
    _entry(
        "camppjleccjaphfdbohjdohecfnoikec",
        "Merlin AI",
        "ai_assistant",
        "General-purpose AI assistant that can read the page and answer questions.",
    ),
    _entry(
        "pokdnpkcjeekgiiokkdkdghpkcpfjgdh",
        "AI Interview Copilot",
        "interview_assistant",
        "AI interview assistant that generates and analyses answers.",
    ),
]
