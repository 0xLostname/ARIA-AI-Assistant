<div align="center">

```
 ◈ ARIA
```

**AI-Powered Windows Desktop Assistant**

*Control your PC with natural language — fully local, no cloud required*

[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron)](https://electronjs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite)](https://vitejs.dev)
[![Ollama](https://img.shields.io/badge/Ollama-local_AI-black)](https://ollama.com)

</div>

---

ARIA is a Windows desktop assistant built with Electron + React that lets you control your PC through natural language — type or speak any command and ARIA executes it. It runs entirely on-device using local LLMs via [Ollama](https://ollama.com), with Claude API as an optional fallback.

The project started as an experiment in local AI on consumer hardware and grew into a full desktop application with a custom fuzzy-matching memory engine, real-time token streaming, local speech recognition via Whisper, a wake word system, and a React frontend migrated from vanilla JS across four structured sessions.

---

## What It Can Do

| | Capability |
|---|---|
| 🚀 | Launch any installed app by name |
| 📁 | Full file browser — open, create, rename, delete, search |
| 🌐 | Web search on Google, YouTube, Bing — or open any URL |
| 📸 | Take screenshots on demand |
| 📋 | Read and write the clipboard |
| 💻 | Show system info — CPU, RAM, uptime |
| ⚙️ | Jump to any Windows Settings page |
| 🖥️ | Run CMD or PowerShell commands |
| 🎤 | Voice input via local Whisper STT — 100% offline |
| 👂 | "Hey ARIA" wake word — window pops up, mic starts |
| ⚡ | Command memory — gets faster the more you use it |
| 🧠 | Vague intent — *"I'm bored"* → opens YouTube |

---

## Tech Stack

```
Frontend      React 18 + Vite 5
Desktop       Electron 28 (main + renderer process architecture)
Local AI      Ollama (llama.cpp inference — CUDA/CPU)
Cloud AI      Anthropic Claude API (optional fallback)
Voice STT     Whisper.cpp (ggml-base.en, fully local)
Wake Word     Web Speech API (browser-native, hotword only)
Build         electron-builder → portable .exe
Data          JSON flat files in %APPDATA%\aria-assistant\
```

---

## Architecture

ARIA separates concerns across two OS processes with a strict IPC boundary:

```
┌─────────────────────────────────────┐    ┌────────────────────────────────┐
│        MAIN PROCESS — main.js       │    │  RENDERER — React + Vite       │
│                                     │    │                                │
│  IPC handlers (ipcMain.handle)      │    │  App.jsx — global state        │
│  ├─ Ollama HTTP streaming           │◄──►│  ├─ useChat    — AI routing    │
│  ├─ File system ops                 │    │  ├─ useMemory  — fuzzy engine  │
│  ├─ App launching (shell: true)     │    │  ├─ useActions — action runner │
│  ├─ Whisper child process           │    │  └─ 7 panel components         │
│  ├─ Screenshot / clipboard          │    │                                │
│  └─ Config + memory persistence     │    │  contextIsolation: true        │
│                                     │    │  nodeIntegration: false        │
└──────────────┬──────────────────────┘    └──────────────┬─────────────────┘
               │        preload.js — contextBridge         │
               └──────────────────────────────────────────┘
```

The renderer has zero Node.js access — every OS operation is whitelisted through `preload.js` and called as `window.aria.*`. This is the correct Electron security model.

---

## The Memory System

The most interesting engineering in the project. ARIA automatically learns every command it successfully executes and routes future input through a three-tier system before touching the AI:

**Scoring algorithm — two signals combined:**

```
Jaccard word overlap (60% weight):
  "launch chrome" vs "open chrome"
  overlap = {chrome}, union = {launch, open, chrome}
  score = 1/3 = 0.33

Character bigram similarity (40% weight):
  bigrams("chrome") = {ch, hr, ro, om, me}
  bigrams("chrome") → identical → score = 1.0

  final = (0.33 × 0.6) + (1.0 × 0.4) = 0.60 → fuzzy match
```

Bigrams catch typos and partial inputs that word overlap misses. Combined scoring handles both semantic variation (different words, same meaning) and surface variation (typos, abbreviations).

**Three routing tiers:**

| Score | Action | Latency |
|---|---|---|
| ≥ 0.95 | Instant bypass — AI never involved | ~50ms |
| 0.60–0.94 | Amber confirm bar — "Run again?" or "Ask AI" | — |
| < 0.60 | Sent to AI, learned on success | model-dependent |

The result: the more you use ARIA, the more commands get bypassed entirely. Common workflows become effectively instant.

---

## Streaming Pipeline

Token streaming goes through four layers, each with its own batching:

```
llama.cpp GPU inference
  → Ollama HTTP chunked response (NDJSON)
    → main.js res.on('data') — batches tokens per TCP chunk → single IPC send
      → useChat.js onStreamToken — 30ms flush timer → single setMessages call
        → React reconciliation → visible text update
```

Key optimisations in the pipeline:
- **Main process batching** — all tokens in one HTTP chunk sent as a single `webContents.send` call, reducing IPC overhead by 5–10×
- **React batching** — 30ms flush timer collapses all tokens in a window into one `setMessages` call, dropping re-renders from one-per-token to ~10/sec max
- **JSON stripping during stream** — in-progress JSON blocks are hidden from the visible text in real time using regex, so the user sees clean prose while the action is still being generated
- **Client-side elapsed timer** — `setInterval` in the renderer replaces the old IPC ping that fired every 500ms

---

## TTFT Optimisations

First-token latency was the primary performance target. Every change listed here was measured:

| Change | Mechanism | Impact |
|---|---|---|
| `keep_alive: -1` on all requests | Model stays in VRAM between messages | −10–15s cold load |
| `ollama-prewarm` on startup | Silent 1-token request loads model before first user message | First message instant |
| `Promise.allSettled` boot | Config + sysInfo + memory load in parallel | −150ms startup |
| System prompt cached in `promptRef` | Rebuilt only on sysInfo change, not every message | −1ms × N messages |
| History window 6 → 3 messages | ~100 fewer prompt tokens per request | −50–100ms TTFT |
| `num_predict` 100 → 80 | Generation stops sooner | Less tail latency |
| Removed IPC ping timer | Eliminated 2 IPC round-trips per second during streaming | Smoother rendering |

On a warm llama3.1 model: TTFT under 1s. On a cold model: 10–15s (unavoidable — GPU memory load). Pre-warming eliminates the cold case entirely during normal use.

---

## Getting Started

**Requirements:** Windows 10/11, Node.js 18+, and either Ollama or a Claude API key.

```bash
git clone https://github.com/yourusername/aria-assistant
cd aria-assistant
npm install
npm run build
npm run electron
```

**Ollama setup (recommended — fully local):**

```bash
# Install from ollama.com, then:
ollama pull llama3.1        # ~4GB — best quality
ollama pull phi3:mini       # ~2GB — fastest on low-end hardware
```

> ⚠️ **Critical:** Right-click the Ollama tray icon → Settings → enable **"Expose Ollama on the network"** → restart Ollama. Without this, ARIA cannot connect regardless of anything else.

Models can also be pulled directly from inside ARIA's Settings panel.

**Claude API (optional):**

Open Settings → paste your `sk-ant-api03-...` key. Stored locally in `%APPDATA%\aria-assistant\config.json`, never transmitted except to Anthropic's API.

---

## Voice Input

ARIA uses [whisper.cpp](https://github.com/ggerganov/whisper.cpp) for local speech-to-text — no network call, no Google, nothing leaves the machine.

First mic click triggers a one-time download of `whisper-cli.exe` + `ggml-base.en.bin` (~150MB total) to `%APPDATA%\aria-assistant\whisper\`. After that:

1. Click **🎤** — button turns red and pulses
2. Speak your command
3. Click **⏹** — Whisper processes audio locally (~200ms per second of speech)
4. Confirm bar shows transcript → **⚡ Send** or **✕ Cancel**

Spoken commands run through the same memory matching as typed ones — saying "launch chrome" matches "open chrome" from memory.

**Wake word:** Enable in Settings → say "Hey ARIA" from anywhere → window appears, mic starts automatically. Also handles common mishears ("hey area", "hey raya").

---

## Building a Portable .exe

```bash
npm run dist
```

Runs `vite build` then `electron-builder`. Output: `dist/ARIA-Assistant-Setup.exe` — runs on any Windows 10/11 machine, no Node.js required.

---

## Project Structure

```
aria-assistant/
├── main.js              Electron main process — all IPC handlers, OS ops, Ollama HTTP
├── preload.js           contextBridge — whitelisted IPC surface exposed to renderer
├── vite.config.js       Vite config — outputs to dist/, base: './' for Electron
├── package.json
└── src/
    ├── main.jsx         React root
    ├── App.jsx          Global state, boot sequence, panel routing
    ├── styles/
    │   └── globals.css  CSS custom properties, resets, shared animations
    ├── hooks/
    │   ├── useChat.js   sendMessage, Ollama streaming, Claude fallback, message state
    │   ├── useMemory.js Fuzzy scoring, save/delete/clear, autocomplete matching
    │   └── useActions.js parseAndRun (JSON extraction), runAction (18 action types)
    └── components/
        ├── Titlebar     Logo, status pills, window controls
        ├── Sidebar      Navigation, quick access, AI backend widget
        ├── ChatPanel    Message list, input bar, voice confirm, fuzzy confirm, autocomplete
        ├── FilesPanel   File browser, breadcrumb, search, create/delete
        ├── AppsPanel    18-app launch grid
        ├── MacrosPanel  Learned commands — view, run, delete
        └── SettingsPanel All config — AI mode, Ollama, Claude, Whisper, debug, sysinfo
```

**Local data:**

| Path | Contents |
|---|---|
| `%APPDATA%\aria-assistant\config.json` | AI mode, model, host, hotword, API key |
| `%APPDATA%\aria-assistant\memory.json` | Learned commands — phrase, action, use count, timestamp |
| `%APPDATA%\aria-assistant\whisper\` | whisper-cli.exe + ggml-base.en.bin |

---

## Security Model

- `contextIsolation: true`, `nodeIntegration: false` — renderer is sandboxed, no direct Node access
- All OS operations go through the `preload.js` contextBridge whitelist
- No telemetry, no analytics, no external requests except Ollama (localhost) and optionally Anthropic API
- API keys stored in local JSON only, never logged or transmitted beyond their intended endpoint
- Mic access scoped to the ARIA window only

---

## Troubleshooting

**"Connection refused"** → Enable "Expose Ollama on the network" in Ollama tray → Settings. This is the cause 99% of the time.

**Long wait before first token** → Model is cold-loading into VRAM. Happens once per session. ARIA pre-warms on startup automatically; if it's still slow, try a smaller model (`phi3:mini`, `qwen2.5:3b`).

**White screen on launch** → Run `npm run build` before `npm run electron`. The `dist/` folder must exist.

**No models in dropdown** → Run `ollama pull llama3.1` in terminal, or use the pull field in ARIA Settings.

**Whisper download fails** → Download `whisper-bin-x64.zip` from the [whisper.cpp releases](https://github.com/ggerganov/whisper.cpp/releases) and `ggml-base.en.bin` from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp) manually → place both in `%APPDATA%\aria-assistant\whisper\`.

---

## Changelog

### v3.0 — React + Vite migration + performance pass
- Rewrote entire frontend from a 1700-line vanilla JS monolith into React 18 + Vite with 7 components and 3 custom hooks (`useChat`, `useMemory`, `useActions`)
- Full TTFT optimisation pass: `keep_alive: -1`, model pre-warming, `Promise.allSettled` boot, 30ms token batching, IPC ping removal, prompt caching, context window reduction
- 8 bugs fixed during migration (state declaration order, timestamp re-renders, array mutation in render, voice state race condition, null guard crashes, stale prop sync)

### v2.3 — Local voice (Whisper)
- Replaced Web Speech API (required internet) with local whisper.cpp via `MediaRecorder` → WebM blob → temp file → subprocess → transcript
- One-time auto-download of binary + model with progress toasts
- Transcribing state indicator, Settings panel Whisper section

### v2.2 — Wake word
- Always-on "Hey ARIA" hotword listener using Web Speech API
- Window restore from tray, mic auto-start, mishear tolerance, visual feedback, persisted toggle

### v2.1 — Command memory
- Auto-learning from successful executions
- Jaccard + bigram fuzzy scoring, three-tier routing (instant / confirm / AI)
- Autocomplete dropdown, Learned Commands panel

### v2.0
- Streaming responses, multi-action IPC, Auto AI mode

---

## License

MIT — do whatever you want with it.
