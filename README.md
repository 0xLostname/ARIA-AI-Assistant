# ◈ ARIA — AI Desktop Assistant

> Control your Windows PC with natural language. Powered by local AI (Ollama) or Claude API.

---

## What is ARIA?

ARIA is an Electron-based Windows desktop assistant that lets you control your PC by talking to it. Type or **speak** a command like *"open Chrome"*, *"show my Downloads"*, *"I'm bored"*, or *"take a screenshot"* — and ARIA figures out what you mean and does it.

It runs **fully offline** using [Ollama](https://ollama.com) (local AI models), with an optional Claude API fallback for cloud-powered responses.

---

## Features

| Category | Capabilities |
|---|---|
| 🚀 **App Launching** | Open any installed app by name — Chrome, Spotify, VS Code, Zoom, etc. |
| 📁 **File Management** | Browse, open, create, rename, delete, copy, and search files & folders |
| 🌐 **Web Search** | Search Google, YouTube, or Bing — or open any URL directly |
| 📸 **Screenshots** | Capture your screen on demand |
| 📋 **Clipboard** | Read from and write to the clipboard |
| 💻 **System Info** | See CPU, RAM, uptime, and system details |
| ⚙️ **Windows Settings** | Jump directly to Display, WiFi, Bluetooth, Sound, or Apps settings |
| 🖥️ **Terminal Commands** | Run CMD or PowerShell commands |
| 🎤 **Voice Input** | Click the mic button, speak your command, confirm before sending |
| 👂 **Wake Word** | Say "Hey ARIA" from anywhere — window pops up, mic starts automatically |
| ⚡ **Command Memory** | ARIA learns every command you run and replays them instantly next time |
| 🧠 **Vague Commands** | Say *"I'm bored"* or *"play some music"* — ARIA interprets intent |

---

## Requirements

- **Windows 10 or 11**
- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **One of:**
  - [Ollama](https://ollama.com) with at least one model pulled *(recommended — fully local)*
  - An [Anthropic API key](https://console.anthropic.com) for Claude *(cloud)*

---

## Installation

```bash
# 1. Navigate into the project folder
cd aria-assistant

# 2. Install dependencies (React, Vite, Electron)
npm install

# 3. Build the React frontend
npm run build

# 4. Launch the app
npm run electron
```

On first launch, ARIA shows a setup screen. Connect Ollama or enter your Claude API key to get started.

> **Dev mode:** Run `npm run dev` to start the Vite dev server with hot-reload, then separately run `npm run electron` to open the Electron window pointing at the built files.

---

## Using Ollama (Local AI — Recommended)

Ollama runs AI models entirely on your machine — no internet, no API key, no data sent anywhere.

### Step 1 — Install Ollama
Download from [ollama.com](https://ollama.com) and install it.

---

### ⚠️ STEP 2 — CRITICAL: Enable "Expose Ollama to Network" ⚠️

> **Do this before anything else. This is the #1 reason ARIA can't connect to Ollama.**
> **Without this step, ARIA will show "Connection refused" no matter what you try.**
> **It took me 2 hours to figure this out so you don't have to.**

1. Find the **Ollama icon** in your system tray (bottom-right of taskbar)
2. Right-click it → open **Settings**
3. Find the option **"Expose Ollama on the network"** (or similar wording)
4. **Enable it** ✓
5. Restart Ollama

That's it. One toggle. Done.

---

### Step 3 — Pull a model
Pick one based on your available RAM:

| Model | RAM Required | Quality | Speed |
|---|---|---|---|
| `qwen2.5:3b` | ~2 GB | ⭐⭐⭐⭐ | ⚡ Fastest |
| `phi3:mini` | ~2.5 GB | ⭐⭐⭐ | ⚡ Fastest |
| `mistral` | ~5 GB | ⭐⭐⭐⭐ | Fast |
| `qwen2.5` | ~5 GB | ⭐⭐⭐⭐ | Fast |
| `llama3.1` | ~6 GB | ⭐⭐⭐⭐⭐ | Fast |
| `gemma2:9b` | ~8 GB | ⭐⭐⭐⭐⭐ | Medium |

```bash
ollama pull llama3.1
# or for fastest responses on lower-end hardware:
ollama pull phi3:mini
```

### Step 4 — Keep the model warm (optional but recommended)
Pin the model in memory so your first message is instant rather than waiting for a cold load:
```bash
ollama run llama3.1 --keepalive -1
```
Or set `OLLAMA_KEEP_ALIVE=-1` as a system environment variable.

### Step 5 — Connect
Open ARIA and click **Connect** in the setup screen. Done.

You can also pull models directly inside ARIA from the Settings panel.

---

## Using Claude API (Cloud)

If you prefer Claude or don't want to run Ollama:

1. Get an API key at [console.anthropic.com](https://console.anthropic.com)
2. Open ARIA → Settings → paste your key (`sk-ant-api03-...`) → Save

Your key is stored locally at `%APPDATA%\aria-assistant\config.json` and never shared.

---

## Voice Input 🎙️

ARIA uses **Whisper** for 100% local speech-to-text — no internet required, no Google, no data leaves your machine.

### First-time setup (one-time only)
1. Click the **🎤** mic button — ARIA will detect Whisper isn't set up yet
2. It automatically downloads two things (~150 MB total, one time):
   - `whisper-cli.exe` — the whisper.cpp binary for Windows
   - `ggml-base.en.bin` — the English speech model
3. Files are saved to `%APPDATA%\aria-assistant\whisper\`
4. Once done, the mic is ready to use immediately

You can also go to **Settings → 🎙️ Voice Input** to trigger setup manually and see status.

### How to use
1. Click **🎤** to start recording — button turns red and pulses
2. Speak your command
3. Click **⏹** to stop — button shows **💭** while transcribing (takes 1–3 seconds)
4. A confirm bar slides up showing your transcript
5. Click **⚡ Send** to send it, or **✕ Cancel** to discard

### Voice + Command Memory
Spoken commands go through the same fuzzy matching as typed commands — saying *"launch chrome"* will match *"open chrome"* from memory and show the amber "Run again?" prompt.

### Notes
- Fully offline after setup — no network calls ever
- Based on `ggml-base.en` — fast and accurate for short commands
- Works with the **"Hey ARIA"** wake word — mic auto-starts after detection

---

## Wake Word 👂

Say **"Hey ARIA"** at any time — even when the window is hidden — and ARIA pops up with the mic already listening.

**Setup:**
1. Open Settings → toggle **Wake word** on
2. The `👂 WAKE` pill in the titlebar pulses green when active
3. Minimise ARIA to the tray — hotword listener starts automatically
4. Say *"Hey ARIA"* → window appears, logo flashes cyan, mic starts

**Notes:**
- Requires microphone permission — Windows will prompt you the first time
- Listener pauses while you're actively speaking a command, resumes after
- Handles common mishears: "hey area", "hey era", "hey raya"
- Toggle state persists across restarts

---

## Command Memory ⚡

ARIA automatically learns every command it successfully executes. Nothing to configure — it just gets faster as you use it.

**Three tiers:**

| Match strength | Threshold | Behaviour |
|---|---|---|
| **Exact** | ≥ 95% similarity | Runs instantly, no AI involved — `⚡ instant` badge |
| **Fuzzy** | 60–94% | Amber prompt: **▶ Run again** or **🤖 Ask AI** |
| **No match** | < 60% | Sent to AI as normal, learned if it succeeds |

**Voice + fuzzy:** Spoken commands match memory the same way typed commands do — saying "launch chrome" will match "open chrome" from memory.

**Autocomplete:** After 2+ characters, matching past commands appear in a dropdown with match % and use count.

**⚡ Learned Commands panel:** Sidebar tab showing everything memorised, with the action it maps to and run count. Click ▶ to run any instantly, 🗑 to forget it.

Memory stored in `%APPDATA%\aria-assistant\memory.json`, persists across sessions.

---

## Example Commands

**Apps:**
```
open Chrome
launch Spotify
start VS Code
open the calculator
```

**Files:**
```
show my Desktop
open Downloads folder
create a file called notes.txt on my Desktop
find budget.xlsx in Documents
rename old-report.docx to final-report.docx
```

**Web:**
```
search YouTube for lofi music
google the weather in Tokyo
open github.com
```

**System:**
```
take a screenshot
what's in my clipboard
show PC stats
open sound settings
run ipconfig in CMD
```

**Vague (ARIA figures it out):**
```
I'm bored
play some music
I need to write something
let's video call
how is my PC doing
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Enter` | Send message |
| `Shift + Enter` | New line in input |
| `Ctrl + Shift + A` | Toggle ARIA window globally (even when minimised) |

---

## Panels

**Chat** — Main interface. Type or speak. Responses stream token-by-token.

**Files** — Visual file browser with breadcrumb navigation and search.

**Apps** — One-click launch grid for 18 common apps.

**⚡ Learned Commands** — Everything ARIA has memorised. Run or forget any command.

**Settings** — AI backend config, wake word toggle, system info, Ollama debug, Windows Settings shortcuts.

---

## Performance Notes

- **Streaming** — First tokens appear within ~200ms of the model starting
- **Compact prompt** — ~180 tokens vs ~600 originally; significantly faster TTFT
- **Memory bypass** — Exact command matches skip the AI entirely and run in ~50ms
- **Low token cap** — `num_predict: 150` — enough for one sentence + JSON, nothing wasted
- **GPU acceleration** — Ollama uses your NVIDIA GPU automatically if CUDA is installed

---

## Building a Portable .exe

```bash
npm run dist
```

This runs `vite build` first, then packages everything with electron-builder. Produces `dist/ARIA-Assistant-Setup.exe` — runs on any Windows 10/11 machine without Node.js.

---

## Project Structure

```
aria-assistant/
├── main.js          ← Electron main process — OS operations + IPC handlers
├── preload.js       ← Secure IPC bridge (contextBridge)
├── vite.config.js   ← Vite build config (outputs to dist/)
├── package.json     ← Dependencies: React, Vite, Electron
├── dist/            ← Built React app (generated by npm run build)
├── assets/
└── src/
    ├── index.html   ← Vite entry point
    ├── main.jsx     ← React root mount
    ├── App.jsx      ← Root component — global state, boot, panel routing
    ├── styles/
    │   └── globals.css       ← CSS variables, resets, shared styles
    ├── hooks/
    │   ├── useMemory.js      ← Fuzzy matching, save/delete, autocomplete
    │   ├── useActions.js     ← Action executor (all 18 action types)
    │   └── useChat.js        ← sendMessage, streaming, AI routing, message state
    └── components/
        ├── Titlebar.jsx/.css
        ├── Sidebar.jsx/.css
        ├── ChatPanel.jsx/.css
        ├── FilesPanel.jsx/.css
        ├── AppsPanel.jsx/.css
        ├── MacrosPanel.jsx/.css
        └── SettingsPanel.jsx/.css
```

### Data Stored Locally

| File | Contents |
|---|---|
| `%APPDATA%\aria-assistant\config.json` | API key, AI mode, Ollama host/model, hotword enabled |
| `%APPDATA%\aria-assistant\memory.json` | Learned commands (phrase → action, use count, timestamp) |

---

## Troubleshooting

**"Connection refused" / can't reach Ollama:**
→ You haven't enabled **"Expose Ollama on the network"** in Ollama's settings. Right-click the Ollama tray icon → Settings → enable that option → restart Ollama. This is the answer 99% of the time.

**No response / long wait:**
Open Settings → **Debug** → **▶ Send test message**. Common causes:
- Ollama not running — run `ollama serve`
- Model cold on first load — wait 10–20s or use `--keepalive -1`
- Model name mismatch — check Settings → Model dropdown

**"No models" after connecting:**
Run `ollama pull llama3.1` in terminal, or use the pull field in ARIA Settings.

**Wake word not detecting:**
- Check the `👂 WAKE` pill is green (not grey)
- Check Windows Privacy → Microphone — make sure ARIA has access
- The listener only runs when the window is minimised/hidden
- Speak clearly: "Hey ARIA" with a slight natural pause

**Voice says "network error":**
→ This is the old Web Speech API bug. Update to v2.3+ — voice now uses Whisper locally, no internet needed.

**Voice transcription is slow:**
→ First transcription after a cold start takes 2–4 seconds. Subsequent ones are faster. If your PC is very slow, the `ggml-tiny.en` model is smaller and faster — replace `ggml-base.en.bin` in `%APPDATA%\aria-assistant\whisper\`.

**Whisper setup download fails:**
→ Check your internet connection — the one-time download needs internet. After that, voice works fully offline. If the download keeps failing, download `whisper-bin-x64.zip` from the whisper.cpp GitHub releases and `ggml-base.en.bin` from Hugging Face manually, and place both extracted files in `%APPDATA%\aria-assistant\whisper\`.

**Wrong action executed:**
Try a larger model (`llama3.1`, `mistral`) or be more specific in your command.

**App won't start / white screen:**
Make sure you ran `npm run build` before `npm run electron` — the `dist/` folder must exist. Check `node --version` — needs 18+.

**Global shortcut not working:**
`Ctrl+Shift+A` may conflict with another app. Update `globalShortcut.register` in `main.js`.

---

## Security

- `contextIsolation: true`, `nodeIntegration: false` — renderer has no direct Node access
- All OS operations go through the `preload.js` IPC bridge
- API keys stored locally only, never transmitted
- Ollama runs entirely on-device — no data leaves your machine
- Mic permission granted only to ARIA's window

---

## Changelog

### v3.0 — React + Vite Frontend
- **Full React migration** — frontend rewritten from a 1700-line vanilla JS file into clean React components
- **Vite build system** — hot module replacement in dev, optimised production bundle
- **Component architecture** — `Titlebar`, `Sidebar`, `ChatPanel`, `FilesPanel`, `AppsPanel`, `MacrosPanel`, `SettingsPanel`
- **Custom hooks** — `useChat`, `useMemory`, `useActions` encapsulate all logic cleanly
- **No breaking changes** — all v2.x features preserved: streaming, memory, voice, hotword, fuzzy match
- **Bug fixes** — 8 bugs fixed during migration: state declaration order, timestamp rendering, suggestion mutation, voice state transitions, null guard crashes, stale settings inputs, missing file navigation callback

### v2.3 — Local Voice (Whisper)
- **Replaced Web Speech API** — no more "network error", no Google, no internet dependency
- **Whisper local STT** — uses whisper.cpp (`ggml-base.en`) via `MediaRecorder` → temp WAV → subprocess → transcript
- **Auto-setup** — first mic click triggers one-time download of `whisper-cli.exe` + model (~150 MB)
- **Progress toasts** — real-time download % shown during setup
- **💭 Transcribing state** — mic button shows thinking indicator while Whisper processes audio
- **Settings panel** — new 🎙️ Voice Input section shows Whisper status and manual setup trigger
- **Wake word compatible** — "Hey ARIA" still works; mic auto-starts via MediaRecorder after detection

### v2.2 — Wake Word
- **"Hey ARIA" hotword** — always-on background listener; say it from anywhere to pop the window and start the mic
- **Auto mic start** — no button click needed after wake word detection
- **Mishear tolerance** — also catches "hey area", "hey era", "hey raya"
- **Smart pause/resume** — hotword pauses while command mic is active or window is focused
- **Visual feedback** — logo flashes cyan on detection; `👂 WAKE` pill pulses green in titlebar
- **Persisted** — toggle state saved to config, restored on launch
- **`window-show` IPC** — new handler to restore window from tray/minimised state

### v2.1 — Command Memory
- **Auto-learning** — every successfully executed command saved to `memory.json`
- **Instant replay** — ≥95% match bypasses AI entirely, runs in ~50ms
- **Fuzzy match prompt** — 60–94% match shows amber bar: Run again or Ask AI
- **Voice + fuzzy** — spoken commands match memory the same way typed ones do
- **Autocomplete** — matching past commands appear as you type
- **⚡ Learned Commands panel** — view, run, and delete all memorised commands

### v2.0
- Streaming responses, voice input, compressed prompt, Auto AI mode, multiple bug fixes

---

## License

MIT
