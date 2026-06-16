# NEXUS Agent Engine (local setup)

The autonomous-agent ("Manus-like") brain of NEXUS runs on **OpenHands** (MIT),
rebranded. It executes code, edits files, browses and iterates inside isolated
Docker sandboxes. It runs **locally on your PC** for now; later it can move to a
VPS without changing the integration.

> Attribution: this engine is OpenHands by All Hands AI (MIT). See `../NOTICE.md`.
> The UI is rebranded for end users; upstream license is preserved in the repo.

---

## One-time prerequisite: Docker Desktop + WSL2 (Windows)

OpenHands **requires Docker**. It is not currently installed on this machine.

1. **Install WSL2** (if not already): open PowerShell **as Administrator** and run:
   ```powershell
   wsl --install
   ```
   Reboot when prompted.

2. **Install Docker Desktop**: https://www.docker.com/products/docker-desktop/
   - During/after install, enable **"Use the WSL 2 based engine"** (Settings → General).
   - Enable your distro under **Settings → Resources → WSL Integration**.

3. **Verify** — open a **WSL/Ubuntu terminal** (not PowerShell) and run:
   ```bash
   docker --version
   docker info
   ```
   Both should succeed.

> Why WSL: on Windows the Docker socket mount (`/var/run/docker.sock`) that the
> agent needs to spawn sandboxes works correctly through the WSL2 backend.

---

## Run the agent

From a **WSL terminal**, in the project root:

```bash
bash openhands/start-agent.sh
```

First run pulls a few GB of images — be patient. When ready, open:

**http://localhost:3030**

On first launch the agent UI asks for an **LLM provider + API key**. Use your
OpenRouter or NVIDIA key (it's model-agnostic via LiteLLM), e.g.:
- Provider: OpenRouter — Model: `anthropic/claude-opus-4.8` (or any you prefer).

State (conversations, workspace) persists in `openhands/state/` (git-ignored).

To stop: `Ctrl+C`, or `docker compose -f openhands/docker-compose.yml down`.

---

## Ports

| Service | Port |
|---------|------|
| NEXUS (Next.js dev) | 3000 |
| NEXUS Agent (OpenHands) | **3030** |

They must differ — both default to 3000, so the agent is remapped to 3030.

---

## Updating versions

Edit `docker-compose.yml`:
- `image: docker.openhands.dev/openhands/openhands:<APP_TAG>`
- `AGENT_SERVER_IMAGE_TAG=<RUNTIME_TAG>`

Current pins: app `1.8`, runtime `1.26.0-python`.

---

## Connecting NEXUS → Agent

NEXUS stores the agent URL (default `http://localhost:3030`) and will surface an
**Agent** entry point. Full UI rebrand (hiding all upstream branding) is done via
a reverse proxy when/if this moves to a public host — tracked for a later phase.
