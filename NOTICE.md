# Third-Party Notices

NEXUS AI is built on top of open-source software. This file preserves the
attribution and license notices required by those projects. The NEXUS brand and
original application code are the author's; the components below retain their
original licenses.

## Project basis

| Component | Relationship | License |
|-----------|--------------|---------|
| [G0DM0D3](https://github.com/elder-plinius/G0DM0D3) by elder-plinius | NEXUS's interface and several features are **based on / inspired by** G0DM0D3 | **AGPL-3.0** |

> **AGPL-3.0 is strong copyleft.** Because NEXUS derives from G0DM0D3, if NEXUS
> is distributed OR offered to others over a network (as a hosted service), the
> corresponding NEXUS source must be made available to those users under
> AGPL-3.0. Keeping the repo private for personal use is fine; publishing or
> hosting it for others triggers these obligations. The project's own license
> declaration should be reconciled with this (a derivative of AGPL-3.0 code is
> itself AGPL-3.0). Do not strip G0DM0D3's copyright or license.

## Runtime dependencies (file analysis — Phase 1)

| Component | Purpose | License |
|-----------|---------|---------|
| pdfjs-dist (Mozilla) | PDF text extraction | Apache-2.0 |
| mammoth | Word (.docx) → text/HTML | BSD-2-Clause |
| xlsx (SheetJS Community) | Excel/CSV parsing | Apache-2.0 |
| jszip | ZIP archive reading | MIT / GPLv3 (dual) |
| libarchive.js | RAR/7z/tar/gz… extraction (wasm) | MIT (wrapper) + BSD (libarchive) |
| @ffmpeg/ffmpeg (ffmpeg.wasm) | audio/video demux & frames | MIT (wrapper), LGPL/GPL (ffmpeg) |

## Agent engine

| Component | Purpose | License |
|-----------|---------|---------|
| **@e2b/code-interpreter (E2B)** | **ACTIVE** — cloud sandbox powering NEXUS's autonomous agent (code/shell/file tools) | Apache-2.0 |
| OpenHands (All Hands AI) | Dormant scaffolding kept for a future VPS — `openhands/docker-compose.yml`, rebranded as "NEXUS Agent" | MIT |

> The agent loop, skill playbooks, and artifact handling in `src/lib/agent.ts`
> and `src/lib/skills.ts` are NEXUS's own code; E2B provides only the sandbox.

## Planned integrations (later phases)

| Component | Purpose | License |
|-----------|---------|---------|
| Docling (IBM) | Heavy document/OCR extraction service | MIT |
| Apache Tika | Alternative document extraction service | Apache-2.0 |
| faster-whisper / Groq Whisper | Audio transcription | MIT / provider terms |

> When any of the above is added to the codebase, its full LICENSE text must be
> retained in `third_party/<name>/LICENSE` and referenced here. Do not remove
> upstream copyright headers from vendored source.
