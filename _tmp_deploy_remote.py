"""One-shot remote deploy helper. Delete after use. Do not commit."""

from __future__ import annotations

import sys
import time

import paramiko

HOSTS = {
    "server1": ("172.235.26.25", "RecruiCt45@7892"),
    "server2": ("172.235.26.53", "ReCu127Can@yr289"),
}
REPOS = {
    "server1": "/opt/ai-recruitment-poc",
    "server2": "/root/ai-recruitment-poc",
}


def connect(role: str) -> paramiko.SSHClient:
    host, password = HOSTS[role]
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username="root", password=password, timeout=30)
    transport = client.get_transport()
    if transport is not None:
        transport.set_keepalive(30)
    return client


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def _write(stream, text: str) -> None:
    try:
        stream.write(text)
    except UnicodeEncodeError:
        stream.write(text.encode(stream.encoding or "utf-8", "replace").decode(stream.encoding or "utf-8", "replace"))
    stream.flush()


def stream(client: paramiko.SSHClient, cmd: str, timeout: int = 1200) -> int:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    start = time.time()
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            chunk = stdout.channel.recv(4096).decode("utf-8", "replace")
            _write(sys.stdout, chunk)
        if time.time() - start > timeout:
            raise TimeoutError(f"command exceeded {timeout}s: {cmd}")
        time.sleep(0.4)
    while stdout.channel.recv_ready():
        _write(sys.stdout, stdout.channel.recv(4096).decode("utf-8", "replace"))
    while stderr.channel.recv_ready():
        _write(sys.stderr, stderr.channel.recv(4096).decode("utf-8", "replace"))
    return stdout.channel.recv_exit_status()


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "probe"
    role = sys.argv[2] if len(sys.argv) > 2 else "server1"

    client = connect(role)
    try:
        if action == "probe":
            code, out, err = run(
                client,
                f"hostname; "
                f"if [ -d {REPO} ]; then cd {REPO} && git rev-parse --abbrev-ref HEAD && git log -1 --oneline; "
                f"else echo NO_REPO; find /opt /srv /root /home -maxdepth 4 "
                f"\\( -name deploy.sh -o -name docker-compose.worker.yml \\) 2>/dev/null; fi; "
                "echo ---docker---; docker ps --format '{{.Names}} {{.Status}}'; "
                "echo ---procs---; pgrep -af 'deploy.sh|compose' || true",
            )
            _write(sys.stdout, out)
            if err.strip():
                _write(sys.stdout, err)
            return code
        if action == "find":
            code, out, err = run(
                client,
                "hostname; ls /opt /srv /root /home 2>/dev/null; "
                "find /opt /srv /root /home /var -maxdepth 4 "
                "\\( -name deploy.sh -o -name docker-compose.worker.yml -o -name .env.production \\) 2>/dev/null; "
                "docker ps --format '{{.Names}} {{.Status}}'",
            )
            _write(sys.stdout, out)
            if err.strip():
                _write(sys.stdout, err)
            return code
        if action == "deploy":
            log = f"/tmp/deploy-{role}.log"
            start_cmd = (
                f"if pgrep -f 'bash deploy.sh {role}' >/dev/null; then echo ALREADY_RUNNING; "
                f"else nohup bash -lc 'cd {REPO} && bash deploy.sh {role}' > {log} 2>&1 & echo STARTED $!; fi"
            )
            code, out, err = run(client, start_cmd)
            _write(sys.stdout, out + err)
            return code
        if action == "log":
            log = f"/tmp/deploy-{role}.log"
            code, out, err = run(client, f"tail -n 80 {log} 2>/dev/null || echo NO_LOG; echo ---; pgrep -af 'deploy.sh|compose' || true")
            _write(sys.stdout, out + err)
            return code
        print("usage: probe|find|deploy|log server1|server2", file=sys.stderr)
        return 2
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
