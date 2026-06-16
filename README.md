# NEXUS

**A multi-model AI workspace with an autonomous agent.** Chat with any frontier
model, drop in files, and let NEXUS *do the work* — it plans, runs code in a real
cloud sandbox, builds files, and hands them back to you.

You just talk to it normally. NEXUS reads the task, judges its complexity, and
decides which tools and skills to use.

---

## ✨ Features

- **🤖 Autonomous agent** — an isolated Linux sandbox (Python, bash, internet, a
  filesystem). NEXUS runs and tests code, scrapes/fetches data, processes and
  builds files, and returns them as **downloadable artifacts** — nothing gets
  stuck in the sandbox.
- **🧠 Skills (auto-selected)** — expert playbooks the model picks per task:
  **Web Design** (premium front-ends), **Planning**, **Data Analysis**,
  **Debugging**, and **Autonomous Agent**. No commands to learn — it just routes.
- **💭 Thinking UI** — a Claude-style collapsible reasoning panel ("Thinking →
  Thought for *N*s") plus a live timeline of the agent's tool use.
- **📎 File analysis** — images (vision), PDF, Word, Excel, CSV, audio/video
  (Whisper transcription), and archives (ZIP/RAR/7z/tar…), extracted in-browser.
- **⚔️ Multi-model orchestration** — **RACE** several models in parallel and keep
  the best answer; **SYNTHESIS** collects all responses and synthesizes a single
  ground-truth answer.
- **🎛️ Context-aware tuning** — auto-detects intent (code / creative / analytical /
  chat) and applies optimal sampling parameters; learns from your 👍/👎.
- **🔌 Bring your own model** — OpenRouter (100+ models) and NVIDIA NIM, side by side.
- **🔒 Privacy-first** — everything lives in your browser's local storage. No
  account, no tracking. Export/import full backups anytime.
- **🎨 Four themes** — Midnight, Crimson, Aurora, Light.

---

## 🚀 Quick start

```bash
npm install
cp .env.local.example .env.local   # then add your keys (see below)
npm run dev
```

Open <http://localhost:3000>, open **Settings**, and paste your model API key.

> The autonomous agent needs **server mode** (the default `npm run dev` / `npm run
> start`). A static export (`NEXT_STATIC_EXPORT=1 npm run build`) builds the chat
> UI but cannot run the agent route.

---

## 🔑 Keys & environment

Model keys are entered in **Settings** (stored locally, never sent to a NEXUS server):

- **OpenRouter** — 100+ models · <https://openrouter.ai/keys>
- **NVIDIA NIM** — <https://build.nvidia.com>
- **Whisper** (optional, for audio/video) — Groq or OpenAI, set in Settings.

The agent's sandbox key is read **server-side** from `.env.local`:

```bash
# .env.local
E2B_API_KEY=e2b_xxxxxxxx   # https://e2b.dev  (use the "API Key", not an access token)
```

---

## 🏗️ Architecture

```
src/
  app/            Next.js app + the /api/agent route (SSE, server-only)
  components/     React UI (chat, message, settings, …)
  lib/
    agent.ts      autonomous ReAct loop over the E2B sandbox + artifact capture
    skills.ts     skill playbooks + auto-router
    system-prompt.ts   NEXUS's identity
    files.ts      client-side file extraction
    openrouter.ts / nvidia.ts   providers
    tuning*.ts    context-adaptive sampling
  store/          Zustand state (persisted to localStorage)
```

The agent loop is NEXUS's own code; [E2B](https://e2b.dev) provides only the sandbox.

---

## 📜 License & credits

NEXUS is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** —
see [LICENSE](LICENSE).

NEXUS's interface and several features are **based on
[G0DM0D3](https://github.com/elder-plinius/G0DM0D3) by elder-plinius** (AGPL-3.0).
Because NEXUS is a derivative work, it stays under AGPL-3.0: if you distribute it or
run it as a network service for others, you must make your source available to
those users under the same license. Full third-party attribution is in
[NOTICE.md](NOTICE.md).
