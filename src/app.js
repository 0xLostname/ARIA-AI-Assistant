'use strict';

/* ─── State ────────────────────────────────────────────────────── */
const state = {
  aiMode:       'ollama',
  ollamaModel:  null,
  ollamaHost:   'http://localhost:11434',
  ollamaModels: [],
  ollamaRunning: false,
  claudeApiKey: null,
  messages:     [],
  currentPanel: 'chat',
  currentPath:  null,
  sysInfo:      null,
  isLoading:    false,
  memory:       [],   // loaded command memory
};

const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

/* ─── Boot ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  buildUI();

  // Load saved config
  try {
    const res = await window.aria.loadConfig();
    const cfg = res?.config || {};
    state.claudeApiKey   = cfg.apiKey        || null;
    state.aiMode         = cfg.aiMode        || 'ollama';
    state.ollamaHost     = cfg.ollamaHost    || 'http://localhost:11434';
    state.ollamaModel    = cfg.ollamaModel   || null;
    hotword.enabled      = cfg.hotwordEnabled || false;
  } catch (e) { console.warn('Config load error:', e); }

  // Load system info
  try {
    const res = await window.aria.sysInfo();
    if (res.ok) {
      state.sysInfo      = res.info;
      state.currentPath  = res.info.homedir;
      el('sys-user').textContent = res.info.username;
      el('sys-host').textContent = res.info.hostname;
      renderSystemInfo(res.info);
    }
  } catch(e) { console.warn('sysInfo error:', e); }

  // Load command memory
  try {
    const res = await window.aria.memoryLoad();
    if (res.ok) state.memory = res.entries || [];
  } catch(e) { console.warn('Memory load error:', e); }

  // Check Whisper readiness (silent)
  await initWhisper();

  // Check Ollama
  await refreshOllama(true);

  if (!state.ollamaRunning && !state.claudeApiKey) {
    el('setup-overlay').style.display = 'flex';
  } else {
    el('setup-overlay').style.display = 'none';
    addBotMessage(welcomeText());
  }

  // Restore hotword toggle UI state
  const hwToggle = el('hotword-toggle');
  if (hwToggle) hwToggle.checked = hotword.enabled;
  updateHotwordPill();
  // Don't auto-start on boot — only start when window hides (or user enables it)
});

function el(id) { return document.getElementById(id); }

/* ─── Ollama Status ─────────────────────────────────────────────── */
async function refreshOllama(silent) {
  let res;
  try { res = await window.aria.ollamaStatus(state.ollamaHost); }
  catch(e) { res = { running: false, models: [], error: e.message }; }

  state.ollamaRunning = res.running || false;
  state.ollamaModels  = res.models  || [];

  // Auto-pick best model
  if (!state.ollamaModel && state.ollamaModels.length) {
    const prefer = ['llama3.1','llama3','mistral','qwen','gemma','phi','deepseek'];
    const found  = prefer.find(p => state.ollamaModels.some(m => m.name.includes(p)));
    state.ollamaModel = found
      ? state.ollamaModels.find(m => m.name.includes(found)).name
      : state.ollamaModels[0].name;
    try { await window.aria.saveConfig({ ollamaModel: state.ollamaModel }); } catch(_) {}
  }

  updateBadges();
  rebuildModelPicker();

  if (!silent) {
    if (res.running) toast(`Ollama OK · ${state.ollamaModels.length} model(s)`, 'success');
    else             toast(res.error || 'Ollama unreachable', 'error');
  }
}

/* ─── System Prompt ─────────────────────────────────────────────── */
function buildPrompt() {
  const I = state.sysInfo;
  const D = I?.desktop   || 'C:/Users/user/Desktop';
  const L = I?.downloads || 'C:/Users/user/Downloads';
  const O = I?.documents || 'C:/Users/user/Documents';
  const U = I?.username  || 'user';

  // Compact prompt — ~180 tokens vs previous ~600. Local models handle structured short prompts well.
  return `You are ARIA, a Windows assistant for ${U}. Desktop="${D}" Downloads="${L}" Documents="${O}"

Reply: one sentence + JSON action block.
Example: Opening Chrome.\n\`\`\`json\n{"action":"launch_app","name":"chrome"}\n\`\`\`

Actions: launch_app(name) web_search(query,engine) open_url(url) open_file(path) open_folder(path) list_files(path) search_files(query,dir) create_file(path,content) create_folder(path) rename(path,newName) delete(path) screenshot clipboard_write(text) clipboard_read sys_info open_settings(setting) run_cmd(command)

App names: chrome firefox edge notepad calculator vlc spotify discord zoom vscode word excel cmd powershell explorer
Engines: google youtube bing

Vague→action: bored/watch→web_search youtube | music→launch spotify | write→launch notepad | files→list_files "${D}" | code→launch vscode | chat→launch discord | call→launch zoom | screenshot→screenshot | stats→sys_info

Rules: always output JSON block. Use full paths. One sentence only.`;
}

/* ─── Command Memory Engine ─────────────────────────────────────── */

// Generate a stable ID for a phrase
function memoryId(phrase) {
  return phrase.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 60);
}

// Fuzzy score: how similar are two strings? Returns 0–1
function fuzzyScore(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;

  // Word overlap score
  const wa = new Set(a.split(/\s+/));
  const wb = new Set(b.split(/\s+/));
  const overlap = [...wa].filter(w => wb.has(w)).length;
  const union   = new Set([...wa, ...wb]).size;
  if (union === 0) return 0;
  const jaccard = overlap / union;

  // Character-level bigram similarity
  const bigrams = s => { const bg = new Set(); for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i+2)); return bg; };
  const ba = bigrams(a), bb = bigrams(b);
  const biOverlap = [...ba].filter(g => bb.has(g)).length;
  const biUnion   = new Set([...ba, ...bb]).size;
  const biScore   = biUnion ? biOverlap / biUnion : 0;

  return (jaccard * 0.6) + (biScore * 0.4);
}

// Find best memory matches for a query (returns sorted array)
function memoryMatch(query, threshold = 0.55) {
  if (!query.trim() || !state.memory.length) return [];
  return state.memory
    .map(e => ({ ...e, score: fuzzyScore(query, e.phrase) }))
    .filter(e => e.score >= threshold)
    .sort((a, b) => b.score !== a.score ? b.score - a.score : (b.useCount || 0) - (a.useCount || 0))
    .slice(0, 5);
}

// Check for an exact/near-exact match (score >= 0.95) — instant bypass, no prompt
function memoryExactMatch(query) {
  const matches = memoryMatch(query, 0.95);
  return matches.length ? matches[0] : null;
}

// Check for a fuzzy match (0.60–0.94) — shows "Run again?" prompt
function memoryFuzzyMatch(query) {
  const matches = memoryMatch(query, 0.60).filter(m => m.score < 0.95);
  return matches.length ? matches[0] : null;
}

// Save a phrase→action pair to memory (called after every successful AI execution)
async function memorySave(phrase, action) {
  phrase = phrase.trim();
  if (!phrase || !action?.action) return;

  const id = memoryId(phrase);
  const existing = state.memory.find(e => e.id === id);
  const entry = {
    id,
    phrase,
    action,
    useCount: (existing?.useCount || 0) + 1,
    lastUsed: Date.now(),
  };

  const idx = state.memory.findIndex(e => e.id === id);
  if (idx >= 0) state.memory[idx] = entry;
  else          state.memory.unshift(entry);

  try { await window.aria.memorySaveEntry(entry); } catch(e) { console.warn('Memory save error:', e); }

  if (state.currentPanel === 'macros') renderMacros();
}

// Delete a memory entry
async function memoryDelete(id) {
  state.memory = state.memory.filter(e => e.id !== id);
  try { await window.aria.memoryDeleteEntry(id); } catch(e) {}
  renderMacros();
}

// Clear all memory
async function memoryClearAll() {
  if (!confirm('Clear all saved commands?')) return;
  state.memory = [];
  try { await window.aria.memoryClear(); } catch(e) {}
  renderMacros();
  toast('Command memory cleared', 'info');
}

/* ─── Autocomplete Suggestions ──────────────────────────────────── */
let _acTimer = null;

function onChatInput(val) {
  // Auto-resize textarea
  const inp = el('chat-input');
  inp.style.height = 'auto';
  inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';

  // Debounce autocomplete
  clearTimeout(_acTimer);
  if (!val.trim() || val.length < 2) { hideAutocomplete(); return; }
  _acTimer = setTimeout(() => showAutocomplete(val), 80);
}

function showAutocomplete(query) {
  const matches = memoryMatch(query, 0.45);
  const ac = el('autocomplete-list');
  if (!ac || !matches.length) { hideAutocomplete(); return; }

  ac.innerHTML = matches.map(m => `
    <div class="ac-item" onclick="useAutocomplete(${JSON.stringify(m.id).replace(/"/g, '&quot;')})">
      <span class="ac-icon">⚡</span>
      <span class="ac-label">${esc(m.label || m.phrase)}</span>
      <span class="ac-count">${m.useCount}×</span>
      <span class="ac-score">${Math.round(m.score * 100)}%</span>
    </div>`).join('');
  ac.style.display = 'block';
}

function hideAutocomplete() {
  const ac = el('autocomplete-list');
  if (ac) ac.style.display = 'none';
}

function useAutocomplete(id) {
  const entry = state.memory.find(e => e.id === id);
  if (!entry) return;
  el('chat-input').value = entry.phrase;
  hideAutocomplete();
  sendMessage();
}

/* ─── Fuzzy Confirm Bar ─────────────────────────────────────────── */
// Holds state for the pending fuzzy match while user decides
const fuzzyPending = { entry: null, originalText: null };

function showFuzzyConfirm(originalText, entry) {
  fuzzyPending.entry       = entry;
  fuzzyPending.originalText = originalText;

  el('fuzzy-label').textContent  = `"${entry.phrase}"`;
  el('fuzzy-action').textContent = describeAction(entry.action);

  const bar = el('fuzzy-confirm');
  bar.style.display = 'flex';
  bar.style.animation = 'confirmSlideIn 0.18s ease-out';
}

function hideFuzzyConfirm() {
  el('fuzzy-confirm').style.display = 'none';
  fuzzyPending.entry       = null;
  fuzzyPending.originalText = null;
}

// User clicked "Run again" — execute the memory action
async function fuzzyConfirmRun() {
  const { entry } = fuzzyPending;
  hideFuzzyConfirm();
  if (!entry) return;
  setLoading(true);
  const result = await parseAndRunAction(entry.action);
  setLoading(false);
  addBotMessage(`Running **${entry.phrase}**`, result, '⚡ memory');
  await memorySave(entry.phrase, entry.action);
}

// User clicked "Ask AI" — proceed to AI with the original text
async function fuzzyConfirmAsk() {
  const { originalText } = fuzzyPending;
  hideFuzzyConfirm();
  if (!originalText) return;
  // Re-inject the original text and route to AI
  state.messages.push({ role: 'user', content: originalText });
  await _sendToAI(originalText);
}

/* ─── Send Message ──────────────────────────────────────────────── */
async function sendMessage() {
  const input = el('chat-input');
  const text  = input.value.trim();
  if (!text || state.isLoading) return;

  hideAutocomplete();
  input.value = '';
  input.style.height = 'auto';
  addUserMessage(text);

  // ── EXACT match (≥0.95) — run instantly, no prompt ───────────────────
  const exactHit = memoryExactMatch(text);
  if (exactHit) {
    setLoading(true);
    const result = await parseAndRunAction(exactHit.action);
    setLoading(false);
    addBotMessage(`Running **${exactHit.phrase}**`, result, '⚡ instant');
    await memorySave(exactHit.phrase, exactHit.action);
    return;
  }

  // ── FUZZY match (0.60–0.94) — show "Run again?" confirm ─────────────
  const fuzzyHit = memoryFuzzyMatch(text);
  if (fuzzyHit) {
    showFuzzyConfirm(text, fuzzyHit);
    return;
  }

  // ── AI path ───────────────────────────────────────────────────────────
  state.messages.push({ role: 'user', content: text });
  await _sendToAI(text);
}

async function _sendToAI(originalText) {
  const useOllama = state.ollamaRunning && state.ollamaModel && (state.aiMode === 'ollama' || state.aiMode === 'auto');
  const useClaude = state.claudeApiKey  && (state.aiMode === 'claude' || (state.aiMode === 'auto' && !state.ollamaRunning));

  if (!useOllama && !useClaude) {
    toast('No AI connected — open Settings', 'error');
    return;
  }

  setLoading(true);

  const history = state.messages.slice(-6);
  const prompt  = buildPrompt();

  if (useOllama) {
    // ── STREAMING path — bubble appears immediately, tokens fill in ──────
    window.aria.removeStreamListeners();

    // Create bubble with blinking cursor right away
    const { bubbleEl, metaEl } = createStreamBubble();
    let accumulated = '';
    let streamDone  = false;
    const startMs   = Date.now();

    // Tick the elapsed timer on every ping (every 500ms from main)
    window.aria.onStreamPing(() => {
      const s = ((Date.now() - startMs) / 1000).toFixed(1);
      const timerEl = metaEl.querySelector('.stream-timer');
      if (timerEl) timerEl.textContent = `${s}s`;
    });

    window.aria.onStreamToken((token) => {
      if (streamDone) return;
      accumulated += token;
      // Show text portion only — hide the JSON block while streaming
      const visible = accumulated
        .replace(/```json[\s\S]*?```/g, '')  // complete json blocks
        .replace(/```json[\s\S]*$/,  '')      // incomplete json block still forming
        .replace(/^\s*`+\s*$/gm,    '')       // stray backtick lines
        .trim();
      bubbleEl.innerHTML = (visible ? fmt(visible) : '<span style="opacity:.4">thinking…</span>')
        + '<span class="cursor-blink">▌</span>';
      bubbleEl.closest('.msg')?.scrollIntoView({ block: 'end' });
    });

    window.aria.onStreamDone(async (fullText) => {
      if (streamDone) return;
      streamDone = true;
      window.aria.removeStreamListeners();
      setLoading(false);

      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      state.messages.push({ role: 'assistant', content: fullText });

      const actionResult = await parseAndRun(fullText, originalText);

      const displayText = fullText
        .replace(/```json[\s\S]*?```/g, '')
        .replace(/```[\s\S]*?```/g,     '')
        .trim();

      // Finalize bubble
      let resultHtml = '';
      if (actionResult?.ok)    resultHtml = `<div class="msg-result success">✓ ${esc(actionResult.message || 'Done')}</div>`;
      if (actionResult?.error) resultHtml = `<div class="msg-result error">✗ ${esc(actionResult.error)}</div>`;
      bubbleEl.innerHTML = fmt(displayText || '✓') + resultHtml;

      metaEl.innerHTML = `${now()} <span class="src-badge">${state.ollamaModel} · ${elapsed}s</span>`;
      bubbleEl.closest('.msg')?.scrollIntoView({ block: 'end' });
    });

    window.aria.onStreamError((err) => {
      if (streamDone) return;
      streamDone = true;
      window.aria.removeStreamListeners();
      setLoading(false);
      bubbleEl.innerHTML = fmt(`⚠️ ${err}`);
      metaEl.innerHTML = now();
    });

    // Kick off — if the promise rejects before any stream events fire, handle it
    window.aria.ollamaChat(state.ollamaModel, history, prompt, state.ollamaHost)
      .then(r => {
        // Only fires AFTER stream-done resolves; if stream events already handled everything, ignore
        if (!streamDone && !r.ok) {
          streamDone = true;
          window.aria.removeStreamListeners();
          setLoading(false);
          bubbleEl.innerHTML = fmt(`⚠️ ${r.error}`);
          metaEl.innerHTML = now();
        }
      })
      .catch(e => {
        if (!streamDone) {
          streamDone = true;
          window.aria.removeStreamListeners();
          setLoading(false);
          bubbleEl.innerHTML = fmt(`⚠️ ${e.message}`);
          metaEl.innerHTML = now();
        }
      });

  } else {
    // ── Claude (non-streaming) ────────────────────────────────────────────
    showTyping();
    try {
      const r = await window.aria.aiMessage(state.claudeApiKey, history, prompt);
      hideTyping();
      setLoading(false);
      if (!r.ok) { addBotMessage(`⚠️ ${r.error}`); return; }
      const rawResponse = (r.content || []).map(c => c.text || '').join('');
      state.messages.push({ role: 'assistant', content: rawResponse });
      const actionResult = await parseAndRun(rawResponse, originalText);
      const displayText  = rawResponse.replace(/```json[\s\S]*?```/g,'').replace(/```[\s\S]*?```/g,'').trim();
      addBotMessage(displayText || '✓', actionResult, 'Claude');
    } catch (e) {
      hideTyping(); setLoading(false);
      addBotMessage(`⚠️ ${e.message}`);
    }
  }
}

/* ─── Action Parser ─────────────────────────────────────────────── */

// Execute a pre-parsed action object directly (used by memory bypass)
async function parseAndRunAction(action) {
  if (!action?.action) return null;
  try {
    switch (action.action) {
      case 'launch_app':      return await window.aria.appLaunch(action.name);
      case 'web_search':      return await window.aria.browserSearch(action.query, action.engine || 'google');
      case 'open_url':        return await window.aria.browserOpenUrl(action.url);
      case 'open_file':       return await window.aria.fsOpen(action.path);
      case 'open_folder':     return await window.aria.fsOpenFolder(action.path);
      case 'list_files': {
        const r = await window.aria.fsList(action.path);
        if (r.ok) {
          state.currentPath = r.path;
          if (state.currentPanel === 'files') { renderCrumb(r.path); renderGrid(r.items); }
          return { ok: true, message: `${r.path} — ${r.items.filter(i=>i.isDir).length} folders, ${r.items.filter(i=>!i.isDir).length} files` };
        }
        return r;
      }
      case 'search_files':    return await window.aria.fsSearch(action.query, action.dir);
      case 'create_file':     return await window.aria.fsCreateFile(action.path, action.content || '');
      case 'create_folder':   return await window.aria.fsCreateFolder(action.path);
      case 'rename':          return await window.aria.fsRename(action.path, action.newName);
      case 'delete':          return await window.aria.fsDelete(action.path);
      case 'screenshot':      return await window.aria.sysScreenshot();
      case 'clipboard_write': return await window.aria.clipboardWrite(action.text);
      case 'clipboard_read': {
        const r = await window.aria.clipboardRead();
        if (r.ok) return { ok: true, message: r.content ? `Clipboard: "${r.content.substring(0, 100)}${r.content.length > 100 ? '…' : ''}"` : 'Clipboard is empty' };
        return r;
      }
      case 'sys_info': {
        const r = await window.aria.sysInfo();
        if (r.ok) { state.sysInfo = r.info; renderSystemInfo(r.info); }
        return r;
      }
      case 'open_settings':   return await window.aria.sysOpenSettings(action.setting);
      case 'run_cmd':         return await window.aria.sysRunCommand(action.command);
      case 'kill_app':        return await window.aria.appKill(action.name);
      default: return { ok: false, error: `Unknown action: ${action.action}` };
    }
  } catch(e) { return { ok: false, error: e.message }; }
}

// Parse AI response text, execute the action, and save to memory
async function parseAndRun(text, originalPhrase) {
  // Extract JSON from fenced block
  let jsonStr = null;

  const m1 = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (m1) jsonStr = m1[1].trim();

  if (!jsonStr) {
    const m2 = text.match(/```\s*(\{[\s\S]*?\})\s*```/);
    if (m2) jsonStr = m2[1].trim();
  }

  if (!jsonStr) {
    const m3 = text.match(/\{[^{}]*"action"\s*:[^{}]*\}/);
    if (m3) jsonStr = m3[0];
  }

  if (!jsonStr) return null;

  // Fix common model JSON errors
  jsonStr = jsonStr
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
    .replace(/:\s*'([^']*?)'/g, ':"$1"');

  let action;
  try {
    action = JSON.parse(jsonStr);
  } catch {
    const an = jsonStr.match(/"action"\s*:\s*"([^"]+)"/);
    if (!an) return { ok: false, error: 'Could not parse JSON from model' };
    action = { action: an[1] };
    const pn = jsonStr.match(/"path"\s*:\s*"([^"]+)"/);   if (pn) action.path = pn[1];
    const nn = jsonStr.match(/"name"\s*:\s*"([^"]+)"/);   if (nn) action.name = nn[1];
    const qn = jsonStr.match(/"query"\s*:\s*"([^"]+)"/);  if (qn) action.query = qn[1];
    const en = jsonStr.match(/"engine"\s*:\s*"([^"]+)"/); if (en) action.engine = en[1];
    const tn = jsonStr.match(/"text"\s*:\s*"([^"]+)"/);   if (tn) action.text = tn[1];
    const un = jsonStr.match(/"url"\s*:\s*"([^"]+)"/);    if (un) action.url = un[1];
  }

  if (!action?.action) return null;
  console.log('[ARIA action]', JSON.stringify(action));

  const result = await parseAndRunAction(action);

  // Save to memory if action succeeded and we have an original phrase
  if (result?.ok !== false && originalPhrase) {
    await memorySave(originalPhrase, action);
  }

  return result;
}

/* ─── UI Builder ────────────────────────────────────────────────── */
function buildUI() {
  const APPS = [
    {n:'Chrome',i:'🌐',c:'chrome'},{n:'Firefox',i:'🦊',c:'firefox'},
    {n:'Edge',i:'🔵',c:'edge'},{n:'Notepad',i:'📝',c:'notepad'},
    {n:'Calculator',i:'🔢',c:'calculator'},{n:'Paint',i:'🎨',c:'paint'},
    {n:'Explorer',i:'📁',c:'file explorer'},{n:'CMD',i:'⬛',c:'cmd'},
    {n:'PowerShell',i:'🔷',c:'powershell'},{n:'Terminal',i:'💻',c:'terminal'},
    {n:'Task Mgr',i:'📊',c:'task manager'},{n:'VS Code',i:'💙',c:'vscode'},
    {n:'Spotify',i:'🎵',c:'spotify'},{n:'Discord',i:'💬',c:'discord'},
    {n:'Zoom',i:'📹',c:'zoom'},{n:'Slack',i:'💼',c:'slack'},
    {n:'Word',i:'📘',c:'word'},{n:'Excel',i:'📗',c:'excel'},
  ];

  const REC_MODELS = ['llama3.1:8b','mistral:7b','qwen2.5:7b','phi3:mini','gemma2:9b'];

  document.getElementById('app').innerHTML = `
  <div class="bg-grid"></div>
  <div class="bg-glow bg-glow-1"></div>
  <div class="bg-glow bg-glow-2"></div>
  <div class="scanline"></div>

  <!-- ── Setup Overlay ── -->
  <div id="setup-overlay" style="display:none;position:fixed;inset:0;z-index:500;background:rgba(3,5,12,.97);align-items:center;justify-content:center">
    <div class="setup-card">
      <div class="setup-logo">◈ ARIA</div>
      <div class="setup-subtitle">Connect an AI backend to get started</div>
      <div class="setup-tabs">
        <button class="setup-tab active" data-tab="ollama" onclick="showSetupTab('ollama')">🦙 Ollama (Local)</button>
        <button class="setup-tab"        data-tab="claude" onclick="showSetupTab('claude')">☁️ Claude API</button>
      </div>

      <div id="setup-ollama" class="setup-panel active">
        <div class="setup-desc">Run AI <strong>fully offline</strong> — no API key needed.</div>
        <div class="setup-steps">
          <div class="setup-step"><span class="step-num">1</span><div>Install Ollama from <strong>ollama.com</strong></div></div>
          <div class="setup-step" style="background:rgba(255,200,0,0.07);border:1px solid rgba(255,200,0,0.3);border-radius:8px;padding:10px 12px">
            <span class="step-num" style="background:rgba(255,200,0,0.2);color:#ffc800">!</span>
            <div>
              <strong style="color:#ffc800">Right-click the Ollama tray icon → Settings → enable "Expose Ollama on the network"</strong>
              <div style="font-size:10px;opacity:0.7;margin-top:3px">Skip this and ARIA will never connect, no matter what else you try.</div>
            </div>
          </div>
          <div class="setup-step"><span class="step-num">2</span><div>Pull a model: <code>ollama pull llama3.1</code></div></div>
          <div class="setup-step"><span class="step-num">3</span><div>Click Connect below</div></div>
        </div>
        <div style="display:flex;gap:8px">
          <input id="setup-ollama-host" type="text" value="http://localhost:11434" style="flex:1;padding:10px 14px;background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.25);border-radius:8px;color:var(--text);font-family:var(--mono);font-size:11px;outline:none"/>
          <button class="setup-connect-btn" onclick="doConnectOllama()">🔌 Connect</button>
        </div>
        <div id="setup-ollama-msg" style="font-family:var(--mono);font-size:10px;min-height:16px;margin-top:4px"></div>
      </div>

      <div id="setup-claude" class="setup-panel">
        <div class="setup-desc">Use Claude via Anthropic API — requires internet + API key.</div>
        <div style="display:flex;gap:8px">
          <input id="setup-claude-key" type="password" placeholder="sk-ant-api03-..." style="flex:1;padding:10px 14px;background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.25);border-radius:8px;color:var(--text);font-family:var(--mono);font-size:11px;outline:none"/>
          <button class="setup-connect-btn" onclick="doConnectClaude()">☁️ Connect</button>
        </div>
        <div id="setup-claude-msg" style="font-family:var(--mono);font-size:10px;min-height:16px;margin-top:4px"></div>
      </div>
    </div>
  </div>

  <!-- ── Titlebar ── -->
  <div id="titlebar">
    <div class="titlebar-logo"><div class="dot"></div>ARIA</div>
    <div class="titlebar-status">
      <span id="sys-user">—</span>@<span id="sys-host">—</span>
      <span id="ollama-badge" class="status-pill offline">OLLAMA ✗</span>
      <span id="hotword-pill" class="status-pill offline" style="display:none" title="Say 'Hey ARIA' to wake">👂 WAKE</span>
    </div>
    <div class="titlebar-controls">
      <button class="win-btn" onclick="window.aria.minimize()">−</button>
      <button class="win-btn" onclick="window.aria.maximize()">□</button>
      <button class="win-btn close" onclick="window.aria.close()">✕</button>
    </div>
  </div>

  <!-- ── Main ── -->
  <div id="main">
    <div id="sidebar">
      <div class="sidebar-section-label">Navigation</div>
      <div class="nav-item active" data-panel="chat"     onclick="gotoPanel('chat')">    <span class="nav-icon">💬</span> Chat</div>
      <div class="nav-item"        data-panel="files"    onclick="gotoPanel('files')">   <span class="nav-icon">📁</span> Files</div>
      <div class="nav-item"        data-panel="apps"     onclick="gotoPanel('apps')">    <span class="nav-icon">🚀</span> Apps</div>
      <div class="nav-item"        data-panel="macros"   onclick="gotoPanel('macros')">  <span class="nav-icon">⚡</span> Macros</div>
      <div class="nav-item"        data-panel="settings" onclick="gotoPanel('settings')"><span class="nav-icon">⚙️</span> Settings</div>
      <div class="sidebar-divider"></div>
      <div class="sidebar-section-label">Quick Access</div>
      <div class="quick-paths">
        <div class="quick-path" onclick="quickOpen('desktop')">  <span class="folder-icon">🖥️</span> Desktop</div>
        <div class="quick-path" onclick="quickOpen('downloads')"><span class="folder-icon">⬇️</span> Downloads</div>
        <div class="quick-path" onclick="quickOpen('documents')"><span class="folder-icon">📄</span> Documents</div>
        <div class="quick-path" onclick="quickOpen('pictures')"> <span class="folder-icon">🖼️</span> Pictures</div>
      </div>
      <div class="sidebar-divider"></div>
      <div style="padding:10px 12px;margin-top:auto">
        <div class="ai-widget">
          <div class="ai-widget-label">AI BACKEND</div>
          <div id="ai-widget-model" class="ai-widget-model">Loading…</div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="ai-widget-btn" onclick="gotoPanel('settings')">⚙️ Config</button>
            <button class="ai-widget-btn" onclick="refreshOllama(false)">🔄</button>
          </div>
        </div>
        <div style="font-family:var(--mono);font-size:8px;letter-spacing:1.5px;color:var(--text-faint);margin-top:10px;line-height:1.7">ARIA v2.0 · Ctrl+Shift+A</div>
      </div>
    </div>

    <div id="content">
      <div class="loading-bar" id="loading-bar" style="display:none"><div class="loading-bar-inner"></div></div>

      <!-- Chat -->
      <div id="panel-chat" class="panel active">
        <div id="messages"></div>
        <div id="input-bar">
          <div class="suggestions" id="suggestions"></div>
          <div id="voice-confirm" style="display:none">
            <div class="voice-confirm-text" id="voice-confirm-text"></div>
            <div class="voice-confirm-actions">
              <button class="voice-confirm-btn send"   onclick="voiceConfirmSend()">⚡ Send</button>
              <button class="voice-confirm-btn cancel" onclick="voiceConfirmCancel()">✕ Cancel</button>
            </div>
          </div>
          <div id="fuzzy-confirm" style="display:none">
            <div class="fuzzy-confirm-left">
              <span class="fuzzy-icon">⚡</span>
              <div>
                <div class="fuzzy-label" id="fuzzy-label"></div>
                <div class="fuzzy-action" id="fuzzy-action"></div>
              </div>
            </div>
            <div class="voice-confirm-actions">
              <button class="voice-confirm-btn send"   onclick="fuzzyConfirmRun()">▶ Run again</button>
              <button class="voice-confirm-btn cancel" onclick="fuzzyConfirmAsk()">🤖 Ask AI</button>
            </div>
          </div>
          <div class="input-wrapper">
            <textarea id="chat-input" rows="1" placeholder="Say anything — 'open Chrome', 'show my downloads', 'I'm bored'…"
              oninput="onChatInput(this.value)"></textarea>
            <button id="mic-btn" onclick="toggleVoice()" title="Click to speak">🎤</button>
            <button id="send-btn" onclick="sendMessage()">⚡</button>
          </div>
          <div id="autocomplete-list" style="display:none"></div>
          <div class="input-hint">ENTER to send · SHIFT+ENTER new line · 🎤 click to speak · Model: <span id="model-hint">—</span></div>
        </div>
      </div>

      <!-- Files -->
      <div id="panel-files" class="panel">
        <div class="panel-header">
          <span class="panel-title">📁 Files</span>
          <input type="text" id="file-search" placeholder="Search…" oninput="onFileSearch(this.value)"/>
          <button class="action-btn" onclick="navTo(state.currentPath)">🔄</button>
        </div>
        <div class="breadcrumb" id="breadcrumb"></div>
        <div class="file-grid"  id="file-grid"><div class="empty-state"><div class="icon">📂</div><span>Loading…</span></div></div>
        <div class="file-actions">
          <button class="action-btn" onclick="newFileDialog()">+ File</button>
          <button class="action-btn" onclick="newFolderDialog()">+ Folder</button>
          <button class="action-btn" onclick="navUp()">↑ Up</button>
        </div>
      </div>

      <!-- Apps -->
      <div id="panel-apps" class="panel">
        <div class="panel-header"><span class="panel-title">🚀 Quick Launch</span></div>
        <div class="apps-grid">
          ${APPS.map(a=>`<div class="app-card" onclick="quickLaunch('${a.c}','${a.n}')"><div class="app-icon">${a.i}</div><div class="app-name">${a.n}</div></div>`).join('')}
        </div>
      </div>

      <!-- Macros -->
      <div id="panel-macros" class="panel">
        <div class="panel-header">
          <span class="panel-title">⚡ Learned Commands</span>
          <button class="action-btn" onclick="memoryClearAll()" style="color:var(--red);border-color:rgba(255,60,60,.3)">🗑 Clear All</button>
        </div>
        <div class="macros-hint">Commands ARIA has learned automatically. Click ▶ to run instantly, 🗑 to forget.</div>
        <div id="macros-list"></div>
      </div>

      <!-- Settings -->
      <div id="panel-settings" class="panel">
        <div style="overflow-y:auto;flex:1;padding:24px">

          <div class="settings-section">
            <h3>🎙️ Voice Input (Whisper)</h3>
            <div class="settings-row">
              <label>Status</label>
              <span id="whisper-status-text" style="font-family:var(--mono);font-size:11px;flex:2">Checking…</span>
              <button class="btn-save" onclick="onWhisperSetupClick()">Setup</button>
            </div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--text-faint);margin-top:4px;line-height:1.7">
              100% local · No internet for transcription · One-time ~150 MB download<br>
              Files stored in: <code>%APPDATA%\aria-assistant\whisper\</code>
            </div>
          </div>

          <div class="settings-section">
            <h3>🤖 AI Mode</h3>
            <div class="settings-row">
              <label>Mode</label>
              <select id="ai-mode-sel" class="settings-select" onchange="onModeChange(this.value)">
                <option value="ollama">Ollama only (local)</option>
                <option value="claude">Claude only (cloud)</option>
                <option value="auto">Auto — Ollama then Claude</option>
              </select>
            </div>
            <div class="settings-row">
              <label>Wake word</label>
              <div style="display:flex;align-items:center;gap:10px;flex:2">
                <label class="toggle-switch">
                  <input type="checkbox" id="hotword-toggle" onchange="onHotwordToggle(this.checked)"/>
                  <span class="toggle-slider"></span>
                </label>
                <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim)">Say <strong style="color:var(--cyan)">"Hey ARIA"</strong> to wake from tray</span>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3>🦙 Ollama</h3>
            <div class="settings-row">
              <label>Status</label>
              <span id="ollama-status-text" style="font-family:var(--mono);font-size:11px;flex:2">—</span>
              <button class="btn-save" onclick="refreshOllama(false)">Refresh</button>
            </div>
            <div class="settings-row">
              <label>Host</label>
              <input id="ollama-host-input" type="text" placeholder="http://localhost:11434"/>
              <button class="btn-save" onclick="saveOllamaHost()">Save</button>
            </div>
            <div class="settings-row">
              <label>Model</label>
              <select id="model-select" class="settings-select" style="flex:2" onchange="onModelChange(this.value)"></select>
            </div>
            <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:10px">
              <label>Pull model</label>
              <div style="display:flex;gap:8px;width:100%">
                <input id="pull-input" type="text" placeholder="e.g. llama3.1" style="flex:1"/>
                <button class="btn-save" onclick="doPull()">⬇️ Pull</button>
              </div>
              <div id="pull-status" style="font-family:var(--mono);font-size:9px;color:var(--text-faint)"></div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${REC_MODELS.map(m=>`<span class="model-chip" onclick="el('pull-input').value='${m}'">${m}</span>`).join('')}
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3>☁️ Claude API</h3>
            <div class="settings-row">
              <label>Key</label>
              <input id="claude-key-input" type="password" placeholder="sk-ant-api03-…"/>
              <button class="btn-save" onclick="saveClaudeKey()">Save</button>
            </div>
          </div>

          <div class="settings-section">
            <h3>🔬 Debug — Test Ollama directly</h3>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <button class="btn-save" onclick="debugTestOllama()">▶ Send test message</button>
              <button class="action-btn" onclick="el('debug-out').textContent=''">Clear</button>
            </div>
            <pre id="debug-out" style="font-family:var(--mono);font-size:9px;color:var(--cyan);background:rgba(0,0,0,.4);border:1px solid rgba(0,212,255,.1);border-radius:6px;padding:10px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;min-height:40px">Click the button to test…</pre>
          </div>

          <div class="settings-section">
            <h3>💻 System Info</h3>
            <div class="info-grid" id="sys-info-grid"></div>
          </div>

          <div class="settings-section">
            <h3>🪟 Windows Settings</h3>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${['Display','WiFi','Bluetooth','Sound','Apps'].map(s=>`<button class="action-btn" onclick="window.aria.sysOpenSettings('${s.toLowerCase()}')">${s}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="toast"></div>`;

  // Wire keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && document.activeElement?.id === 'chat-input') {
      e.preventDefault(); sendMessage();
    }
  });
  buildSuggestions();
}

/* ─── Setup overlay ─────────────────────────────────────────────── */
function showSetupTab(tab) {
  $$('.setup-tab').forEach(b => b.classList.remove('active'));
  $$('.setup-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.setup-tab[data-tab="${tab}"]`)?.classList.add('active');
  el(`setup-${tab}`)?.classList.add('active');
}

async function doConnectOllama() {
  const host = (el('setup-ollama-host')?.value || '').trim() || 'http://localhost:11434';
  const msg  = el('setup-ollama-msg');
  state.ollamaHost = host;
  msg.textContent = '🔄 Connecting…'; msg.style.color = 'var(--text-dim)';
  let r;
  try { r = await window.aria.ollamaStatus(host); }
  catch(e) { msg.textContent = `✗ ${e.message}`; msg.style.color = 'var(--red)'; return; }

  if (r.running && r.models?.length) {
    state.ollamaRunning = true; state.ollamaModels = r.models;
    state.ollamaModel   = r.models[0].name; state.aiMode = 'ollama';
    try { await window.aria.saveConfig({ ollamaHost: host, ollamaModel: state.ollamaModel, aiMode: 'ollama' }); } catch(_){}
    msg.textContent = `✓ Connected — ${r.models.map(m=>m.name).join(', ')}`; msg.style.color = 'var(--green)';
    setTimeout(() => { el('setup-overlay').style.display = 'none'; updateBadges(); rebuildModelPicker(); addBotMessage(welcomeText()); }, 1200);
  } else if (r.running) {
    msg.textContent = '⚠️ Running but no models — run: ollama pull llama3.1'; msg.style.color = 'var(--yellow)';
  } else {
    msg.textContent = `✗ ${r.error || 'Cannot connect'}`; msg.style.color = 'var(--red)';
  }
}

async function doConnectClaude() {
  const key = (el('setup-claude-key')?.value || '').trim();
  const msg = el('setup-claude-msg');
  if (!key.startsWith('sk-ant')) { msg.textContent = '✗ Invalid key'; msg.style.color = 'var(--red)'; return; }
  try { await window.aria.storeApiKey(key); } catch(_){}
  state.claudeApiKey = key; state.aiMode = 'claude';
  try { await window.aria.saveConfig({ aiMode: 'claude' }); } catch(_){}
  msg.textContent = '✓ Claude connected!'; msg.style.color = 'var(--green)';
  setTimeout(() => { el('setup-overlay').style.display = 'none'; updateBadges(); addBotMessage(welcomeText()); }, 1000);
}

/* ─── Settings ──────────────────────────────────────────────────── */
async function onModeChange(v) { state.aiMode = v; try { await window.aria.saveConfig({ aiMode: v }); } catch(_){} updateBadges(); }
async function onModelChange(v) { state.ollamaModel = v; try { await window.aria.saveConfig({ ollamaModel: v }); } catch(_){} updateBadges(); toast(`Model → ${v}`, 'success'); }

async function saveOllamaHost() {
  const h = el('ollama-host-input')?.value?.trim();
  if (!h) return;
  state.ollamaHost = h;
  try { await window.aria.saveConfig({ ollamaHost: h }); } catch(_){}
  await refreshOllama(false);
}

async function saveClaudeKey() {
  const k = el('claude-key-input')?.value?.trim();
  if (!k?.startsWith('sk-ant')) { toast('Invalid key', 'error'); return; }
  try { await window.aria.storeApiKey(k); } catch(_){}
  state.claudeApiKey = k; toast('Claude key saved!', 'success');
}

async function doPull() {
  const model = el('pull-input')?.value?.trim();
  if (!model) { toast('Enter a model name', 'error'); return; }
  const s = el('pull-status');
  s.textContent = `⬇️ Pulling ${model}… (may take minutes)`; s.style.color = 'var(--cyan)';
  try {
    const r = await window.aria.ollamaPull(model, state.ollamaHost);
    if (r.ok) { s.textContent = `✓ ${r.message}`; s.style.color = 'var(--green)'; await refreshOllama(true); toast(`${model} ready!`, 'success'); }
    else       { s.textContent = `✗ ${r.error}`;   s.style.color = 'var(--red)'; }
  } catch(e) { s.textContent = `✗ ${e.message}`; s.style.color = 'var(--red)'; }
}

/* ─── Badges & model picker ─────────────────────────────────────── */
function updateBadges() {
  const badge = el('ollama-badge');
  if (badge) { badge.textContent = state.ollamaRunning ? 'OLLAMA ✓' : 'OLLAMA ✗'; badge.className = state.ollamaRunning ? 'status-pill online' : 'status-pill offline'; }

  const widget = el('ai-widget-model');
  if (widget) {
    if (state.ollamaRunning && state.ollamaModel && state.aiMode !== 'claude')
      widget.innerHTML = `<span style="color:var(--green)">🦙</span> ${state.ollamaModel}`;
    else if (state.claudeApiKey)
      widget.innerHTML = `<span style="color:var(--cyan)">☁️</span> Claude`;
    else
      widget.innerHTML = `<span style="color:var(--red)">✗</span> Not configured`;
  }

  const hint = el('model-hint');
  if (hint) hint.textContent = (state.aiMode !== 'claude' && state.ollamaModel) ? state.ollamaModel : 'Claude';

  const statusTxt = el('ollama-status-text');
  if (statusTxt) statusTxt.innerHTML = state.ollamaRunning
    ? `<span style="color:var(--green)">● Running</span> · ${state.ollamaModels.length} model(s)`
    : `<span style="color:var(--red)">● Offline</span>`;

  // Sync settings fields
  const modeSel = el('ai-mode-sel'); if (modeSel) modeSel.value = state.aiMode;
  const hostInp = el('ollama-host-input'); if (hostInp && !hostInp.value) hostInp.value = state.ollamaHost;
  const keyInp  = el('claude-key-input'); if (keyInp && state.claudeApiKey && !keyInp.value) keyInp.value = state.claudeApiKey;
  // Whisper status
  const wst = el('whisper-status-text');
  if (wst) {
    if (whisperState.setting_up) wst.innerHTML = `<span style="color:var(--cyan)">● Setting up…</span>`;
    else if (whisperState.ready)  wst.innerHTML = `<span style="color:var(--green)">● Ready</span> · ggml-base.en`;
    else                          wst.innerHTML = `<span style="color:var(--text-faint)">● Not installed</span> · click Setup to download`;
  }
}

async function onWhisperSetupClick() {
  if (whisperState.ready) { toast('Whisper is already set up ✓', 'success'); return; }
  if (whisperState.setting_up) { toast('Setup already running…', 'info'); return; }
  await runWhisperSetup();
  updateBadges();
}

function rebuildModelPicker() {
  const sel = el('model-select');
  if (!sel) return;
  if (!state.ollamaModels.length) { sel.innerHTML = '<option>— no models —</option>'; return; }
  sel.innerHTML = state.ollamaModels.map(m =>
    `<option value="${m.name}" ${m.name === state.ollamaModel ? 'selected' : ''}>${m.name} (${fmtBytes(m.size)})</option>`
  ).join('');
}

/* ─── Messages ──────────────────────────────────────────────────── */
function welcomeText() {
  const model = (state.aiMode !== 'claude' && state.ollamaModel) ? state.ollamaModel : 'Claude';
  const u = state.sysInfo?.username || '';
  return `Hello${u ? ` **${u}**` : ''}! I'm ARIA, powered by **${model}**.\n\nTry: *"open Chrome"*, *"show my Downloads"*, *"I'm bored"*, *"take a screenshot"*`;
}

// Creates a streaming bubble — returns refs so tokens can fill it in live
function createStreamBubble() {
  const c = el('messages');
  const d = document.createElement('div');
  d.className = 'msg ai';
  d.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-body">
      <div class="msg-bubble"><span style="opacity:.4">thinking…</span><span class="cursor-blink">▌</span></div>
      <div class="msg-time" style="display:flex;gap:8px;align-items:center">
        ${now()}
        <span class="stream-timer" style="font-family:var(--mono);font-size:9px;color:var(--text-faint)">0.0s</span>
      </div>
    </div>`;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
  return {
    bubbleEl: d.querySelector('.msg-bubble'),
    metaEl:   d.querySelector('.msg-time'),
  };
}

function addUserMessage(text) {
  const c = el('messages');
  const d = document.createElement('div');
  d.className = 'msg user';
  d.innerHTML = `<div class="msg-avatar">👤</div><div class="msg-body"><div class="msg-bubble">${esc(text)}</div><div class="msg-time">${now()}</div></div>`;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}

function addBotMessage(text, actionResult, modelLabel) {
  const c = el('messages');
  const d = document.createElement('div');
  d.className = 'msg ai';

  let resultHtml = '';
  if (actionResult?.ok)    resultHtml = `<div class="msg-result success">✓ ${esc(actionResult.message || 'Done')}</div>`;
  if (actionResult?.error) resultHtml = `<div class="msg-result error">✗ ${esc(actionResult.error)}</div>`;

  const badge = modelLabel ? `<span style="font-family:var(--mono);font-size:8px;color:var(--text-faint);letter-spacing:1px">${modelLabel}</span>` : '';

  d.innerHTML = `<div class="msg-avatar">🤖</div><div class="msg-body"><div class="msg-bubble">${fmt(text)}${resultHtml}</div><div class="msg-time" style="display:flex;gap:8px">${now()} ${badge}</div></div>`;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}

function showTyping() {
  const c = el('messages');
  const d = document.createElement('div');
  d.id = 'typing-ind'; d.className = 'msg ai';
  d.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-body">
      <div class="msg-bubble" style="padding:10px 16px;display:flex;align-items:center;gap:10px">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
        <span class="thinking-timer" style="font-family:var(--mono);font-size:10px;color:var(--text-faint)">0.0s</span>
      </div>
    </div>`;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
  return d;
}
function hideTyping() { el('typing-ind')?.remove(); }

function fmt(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong style="color:var(--cyan)">$1</strong>')
    .replace(/\*([^*\n]+)\*/g,'<em>$1</em>')
    .replace(/\n/g,'<br/>');
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function now() { return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }

/* ─── Suggestions ───────────────────────────────────────────────── */
const SUGG = ['Open Chrome','Show my Desktop','I\'m bored','Take a screenshot','Play some music','Show my Downloads','Open VS Code','System info'];
function buildSuggestions() {
  const c = el('suggestions'); if (!c) return;
  const picks = [...SUGG].sort(()=>Math.random()-.5).slice(0,4);
  c.innerHTML = picks.map(s=>`<span class="suggestion-chip" onclick="useSugg('${s.replace(/'/g,"\\'")}')">${s}</span>`).join('');
}
function useSugg(t) { el('chat-input').value = t; sendMessage(); }

/* ─── Panel navigation ──────────────────────────────────────────── */
function gotoPanel(p) {
  state.currentPanel = p;
  $$('.panel').forEach(x => x.classList.remove('active'));
  $$('.nav-item').forEach(x => x.classList.remove('active'));
  el(`panel-${p}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-panel="${p}"]`)?.classList.add('active');
  if (p === 'files' && state.currentPath) navTo(state.currentPath);
  if (p === 'settings') { updateBadges(); rebuildModelPicker(); }
  if (p === 'macros') renderMacros();
}

/* ─── Macros Panel ──────────────────────────────────────────────── */
/* ─── History Panel ─────────────────────────────────────────────── */
function renderMacros() {
  const list = el('macros-list');
  if (!list) return;

  if (!state.memory.length) {
    list.innerHTML = `<div class="empty-state" style="margin-top:40px"><div class="icon">⚡</div><span>No learned commands yet.<br/>Just use ARIA normally — it learns automatically.</span></div>`;
    return;
  }

  list.innerHTML = state.memory.map(m => `
    <div class="macro-item" id="macro-${m.id}">
      <div class="macro-run" onclick="runMacro('${m.id}')" title="Run now">▶</div>
      <div class="macro-body">
        <div class="macro-label">${esc(m.phrase)}</div>
        <div class="macro-action">${esc(describeAction(m.action))}</div>
      </div>
      <div class="macro-meta">${m.useCount || 1}×</div>
      <button class="macro-btn delete" onclick="memoryDelete('${m.id}')" title="Forget this command">🗑</button>
    </div>`).join('');
}

function describeAction(action) {
  if (!action?.action) return '?';
  switch (action.action) {
    case 'launch_app':      return `Launch ${action.name}`;
    case 'web_search':      return `Search ${action.engine || 'google'}: "${action.query}"`;
    case 'open_url':        return `Open ${action.url}`;
    case 'open_file':       return `Open file: ${action.path}`;
    case 'open_folder':     return `Open folder: ${action.path}`;
    case 'list_files':      return `List: ${action.path}`;
    case 'search_files':    return `Find "${action.query}"`;
    case 'create_file':     return `Create: ${action.path}`;
    case 'create_folder':   return `Create folder: ${action.path}`;
    case 'rename':          return `Rename → ${action.newName}`;
    case 'delete':          return `Delete: ${action.path}`;
    case 'screenshot':      return 'Take screenshot';
    case 'clipboard_write': return `Copy: "${(action.text||'').substring(0,30)}"`;
    case 'clipboard_read':  return 'Read clipboard';
    case 'sys_info':        return 'Show system info';
    case 'open_settings':   return `Settings: ${action.setting}`;
    case 'run_cmd':         return `Run: ${action.command}`;
    case 'kill_app':        return `Kill: ${action.name}`;
    default:                return action.action;
  }
}

async function runMacro(id) {
  const entry = state.memory.find(e => e.id === id);
  if (!entry) return;
  addUserMessage(entry.phrase);
  setLoading(true);
  const result = await parseAndRunAction(entry.action);
  setLoading(false);
  addBotMessage(`Running **${entry.phrase}**`, result, '⚡ instant');
  await memorySave(entry.phrase, entry.action);
  gotoPanel('chat');
}
function quickOpen(folder) { gotoPanel('files'); navTo(folder); }

/* ─── File browser ──────────────────────────────────────────────── */
async function navTo(path) {
  setLoading(true);
  const r = await window.aria.fsList(path);
  setLoading(false);
  if (!r.ok) { toast(r.error, 'error'); return; }
  state.currentPath = r.path;
  renderCrumb(r.path);
  renderGrid(r.items);
}

function renderCrumb(full) {
  const c = el('breadcrumb');
  const parts = full.replace(/\\/g,'/').split('/').filter(Boolean);
  let acc = '';
  c.innerHTML = parts.map((p,i) => {
    acc += (acc?'/':'') + p; const cur = acc; const last = i===parts.length-1;
    return `${i?'<span class="sep"> / </span>':''}<span class="${last?'current':''}" onclick="navTo('${cur.replace(/'/g,"\\'")}')">${p}</span>`;
  }).join('');
}

function renderGrid(items) {
  const g = el('file-grid');
  if (!items?.length) { g.innerHTML='<div class="empty-state"><div class="icon">📭</div><span>Empty</span></div>'; return; }
  const sorted = [...items].sort((a,b)=>a.isDir!==b.isDir?(a.isDir?-1:1):a.name.localeCompare(b.name));
  g.innerHTML = sorted.map(item=>`
    <div class="file-item ${item.isDir?'folder':''}" ondblclick="onFileDbl('${item.path.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')">
      <div class="file-icon">${fileIcon(item)}</div>
      <div class="file-name">${esc(item.name)}</div>
    </div>`).join('');
}

async function onFileDbl(path) {
  const r = await window.aria.fsList(path);
  if (r.ok) navTo(path);
  else { const o = await window.aria.fsOpen(path); if (!o.ok) toast(o.error,'error'); }
}

async function navUp() {
  if (!state.currentPath) return;
  const parts = state.currentPath.replace(/\\/g,'/').split('/').filter(Boolean);
  if (parts.length <= 1) return;
  parts.pop(); await navTo(parts.join('/')||'/');
}

async function onFileSearch(q) {
  if (!q.trim()) { navTo(state.currentPath); return; }
  if (q.length < 2) return;
  setLoading(true);
  const r = await window.aria.fsSearch(q, state.currentPath);
  setLoading(false);
  if (r.ok) renderGrid(r.results);
}

function newFileDialog() {
  const n = prompt('File name:'); if (!n) return;
  window.aria.fsCreateFile(`${state.currentPath}/${n}`, '').then(r=>{
    if (r.ok) { toast(r.message,'success'); navTo(state.currentPath); } else toast(r.error,'error');
  });
}
function newFolderDialog() {
  const n = prompt('Folder name:'); if (!n) return;
  window.aria.fsCreateFolder(`${state.currentPath}/${n}`).then(r=>{
    if (r.ok) { toast(r.message,'success'); navTo(state.currentPath); } else toast(r.error,'error');
  });
}

function fileIcon(item) {
  if (item.isDir) return '📁';
  const m = {'.txt':'📄','.md':'📝','.pdf':'📕','.doc':'📘','.docx':'📘','.xls':'📗','.xlsx':'📗',
    '.jpg':'🖼️','.jpeg':'🖼️','.png':'🖼️','.gif':'🖼️','.mp3':'🎵','.mp4':'🎬','.mkv':'🎬',
    '.zip':'🗜️','.rar':'🗜️','.exe':'⚙️','.bat':'⚙️','.py':'🐍','.js':'📜','.html':'🌐'};
  return m[item.ext?.toLowerCase()] || '📄';
}

/* ─── Apps ──────────────────────────────────────────────────────── */
async function quickLaunch(cmd, name) {
  setLoading(true);
  const r = await window.aria.appLaunch(cmd);
  setLoading(false);
  if (r.ok) toast(`Launching ${name}…`, 'success'); else toast(r.error, 'error');
}

/* ─── System info ───────────────────────────────────────────────── */
function renderSystemInfo(info) {
  const g = el('sys-info-grid'); if (!g) return;
  g.innerHTML = ''; // clear before re-rendering to prevent double-append
  [['User',info.username],['Host',info.hostname],['OS',info.osVersion?.substring(0,30)||'Win'],
   ['Arch',info.arch],['CPU',info.cpu?.substring(0,28)],['Cores',info.cpuCores],
   ['RAM',`${info.usedMemGB}/${info.totalMemGB} GB`],['Uptime',info.uptime]]
  .forEach(([l,v]) => {
    const d = document.createElement('div'); d.className='info-card';
    d.innerHTML=`<div class="info-label">${l}</div><div class="info-value" style="font-size:11px;word-break:break-all">${v||'—'}</div>`;
    g.appendChild(d);
  });
}

/* ─── Voice Input (Whisper local STT) ───────────────────────────── */
const voice = {
  mediaRecorder: null,
  active:        false,
  chunks:        [],
  stream:        null,
  // Keep a stub recognition object for hotword compatibility
  recognition:   null,
};

// Whisper setup state
const whisperState = { ready: false, setting_up: false };

async function checkWhisperReady() {
  try {
    const r = await window.aria.whisperStatus();
    whisperState.ready = r.ready;
    return r.ready;
  } catch(_) { return false; }
}

// Called on boot — silent check
async function initWhisper() {
  await checkWhisperReady();
  updateMicBtn();
}

function updateMicBtn() {
  const btn = el('mic-btn');
  if (!btn) return;
  if (whisperState.setting_up) {
    btn.textContent = '⏳';
    btn.title = 'Setting up Whisper…';
  } else if (voice.active) {
    btn.textContent = '⏹';
    btn.title = 'Click to stop recording';
    btn.classList.add('mic-active');
  } else {
    btn.textContent = '🎤';
    btn.title = whisperState.ready ? 'Click to speak (Whisper local)' : 'Click to set up local voice';
    btn.classList.remove('mic-active');
  }
}

// ── Public toggle — called by the mic button ──────────────────────
async function toggleVoice() {
  if (state.isLoading) return;

  if (voice.active) {
    _voiceStop();
    return;
  }

  hideVoiceConfirm();

  // First use: run setup if Whisper not ready
  if (!whisperState.ready) {
    await runWhisperSetup();
    if (!whisperState.ready) return;
  }

  await _voiceStart();
}

async function runWhisperSetup() {
  whisperState.setting_up = true;
  updateMicBtn();
  toast('Setting up local voice (one-time ~150 MB download)…', 'info');

  window.aria.onWhisperProgress(({ msg, pct }) => {
    toast(`🎙️ ${msg} ${pct < 100 ? `(${pct}%)` : ''}`, 'info');
  });

  const r = await window.aria.whisperSetup();
  window.aria.offWhisperProgress();
  whisperState.setting_up = false;

  if (r.ok) {
    whisperState.ready = true;
    toast('✓ Whisper ready — click mic to speak', 'success');
  } else {
    toast(`Whisper setup failed: ${r.error}`, 'error');
  }
  updateMicBtn();
}

async function _voiceStart() {
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch(e) {
    toast(`Mic access denied: ${e.message}`, 'error');
    return;
  }

  voice.chunks = [];

  // Prefer webm/opus; fall back to whatever is supported
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';

  voice.mediaRecorder = new MediaRecorder(voice.stream, mimeType ? { mimeType } : {});
  voice.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) voice.chunks.push(e.data); };
  voice.mediaRecorder.onstop = _onRecordingStop;

  voice.mediaRecorder.start(100); // collect chunks every 100ms
  voice.active = true;
  setMicState('listening');
  hideVoiceConfirm();
  const inp = el('chat-input');
  inp.value       = '';
  inp.placeholder = '🎙️ Recording… click ⏹ to stop';
  document.dispatchEvent(new Event('aria-voice-start'));
}

function _voiceStop() {
  if (!voice.active) return;
  voice.active = false;
  setMicState('transcribing');
  el('chat-input').placeholder = "Say anything — 'open Chrome', 'show my downloads', 'I'm bored'…";
  try { voice.mediaRecorder?.stop(); } catch(_) {}
  try { voice.stream?.getTracks().forEach(t => t.stop()); } catch(_) {}
  document.dispatchEvent(new Event('aria-voice-end'));
}

async function _onRecordingStop() {
  const blob = new Blob(voice.chunks, { type: voice.mediaRecorder?.mimeType || 'audio/webm' });
  voice.chunks = [];

  if (blob.size < 1000) {
    setMicState('idle');
    el('chat-input').placeholder = "Say anything — 'open Chrome', 'show my downloads', 'I'm bored'…";
    toast('No audio recorded', 'info');
    return;
  }

  // Show transcribing indicator
  el('mic-btn').textContent = '💭';
  el('mic-btn').title = 'Transcribing…';

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const r = await window.aria.whisperTranscribe(arrayBuffer);

    setMicState('idle');
    el('chat-input').placeholder = "Say anything — 'open Chrome', 'show my downloads', 'I'm bored'…";

    if (!r.ok || !r.text?.trim()) {
      toast(r.error || 'Nothing transcribed — try speaking louder', 'info');
      return;
    }

    // Show in confirm bar — same flow as before
    const transcript = r.text.trim();
    el('chat-input').value = transcript;
    _showVoiceConfirm(transcript);

  } catch(e) {
    setMicState('idle');
    toast(`Transcription error: ${e.message}`, 'error');
  }
}

function initVoice() {
  // Stub — kept for hotword compatibility. Actual init is lazy in toggleVoice.
  return true;
}

// ── Confirm bar ───────────────────────────────────────────────────
function _showVoiceConfirm(transcript) {
  if (!transcript?.trim()) return;
  const bar  = el('voice-confirm');
  const text = el('voice-confirm-text');
  if (!bar || !text) return;
  text.textContent = `"${transcript}"`;
  bar.style.display = 'flex';
  bar.classList.add('voice-confirm-in');
  el('chat-input').value = transcript;
}

function hideVoiceConfirm() {
  const bar = el('voice-confirm');
  if (bar) bar.style.display = 'none';
}

function voiceConfirmSend() {
  hideVoiceConfirm();
  sendMessage();
}

function voiceConfirmCancel() {
  hideVoiceConfirm();
  el('chat-input').value = '';
  el('chat-input').style.height = 'auto';
  toast('Voice cancelled', 'info');
}

function setMicState(s) {
  const btn = el('mic-btn');
  if (!btn) return;
  if (s === 'listening') {
    btn.textContent = '⏹';
    btn.title = 'Click to stop recording';
    btn.classList.add('mic-active');
  } else if (s === 'transcribing') {
    btn.textContent = '💭';
    btn.title = 'Transcribing…';
    btn.classList.remove('mic-active');
  } else {
    btn.textContent = '🎤';
    btn.title = whisperState.ready ? 'Click to speak (Whisper local)' : 'Click to set up local voice';
    btn.classList.remove('mic-active');
  }
}

// Typing while mic is active cancels recording
document.addEventListener('keydown', (e) => {
  if (voice.active && e.target.id === 'chat-input' && e.key !== 'Enter') {
    _voiceStop();
    hideVoiceConfirm();
  }
});


/* ─── Hotword Engine ("Hey ARIA") ───────────────────────────────── */
const hotword = {
  recognition: null,
  active:      false,
  enabled:     false,
  PHRASE:      'hey aria',       // what to listen for
  ALT_PHRASES: ['hey area', 'hey era', 'a aria', 'hey raya'],  // common mishears
  restartTimer: null,
};

function initHotword() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { console.warn('[ARIA] Hotword: SpeechRecognition not available'); return false; }

  const r = new SR();
  r.continuous      = true;
  r.interimResults  = true;   // interim lets us catch the phrase mid-sentence faster
  r.lang            = 'en-US';
  r.maxAlternatives = 3;       // more alternatives = better chance of catching mishears

  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      // Check all alternatives for this result
      for (let a = 0; a < e.results[i].length; a++) {
        const t = e.results[i][a].transcript.toLowerCase().trim();
        const detected = t.includes(hotword.PHRASE) || hotword.ALT_PHRASES.some(p => t.includes(p));
        if (detected) {
          console.log('[ARIA] Wake word detected:', t);
          onWakeWordDetected();
          return;
        }
      }
    }
  };

  r.onerror = (e) => {
    if (e.error === 'aborted') return;
    if (e.error === 'not-allowed') {
      console.warn('[ARIA] Hotword: mic permission denied');
      hotword.active = false;
      updateHotwordPill();
      return;
    }
    // Any other error — try restarting after a delay
    hotword.active = false;
    if (hotword.enabled) scheduleHotwordRestart(3000);
  };

  r.onend = () => {
    hotword.active = false;
    // Auto-restart if still enabled and window is hidden
    if (hotword.enabled) scheduleHotwordRestart(500);
  };

  hotword.recognition = r;
  return true;
}

function startHotword() {
  if (hotword.active || voice.active) return;
  if (!hotword.recognition) {
    const ok = initHotword();
    if (!ok) return;
  }
  clearTimeout(hotword.restartTimer);
  try {
    hotword.recognition.start();
    hotword.active = true;
    updateHotwordPill();
    console.log('[ARIA] Hotword listening…');
  } catch(e) {
    console.warn('[ARIA] Hotword start error:', e.message);
    hotword.active = false;
    scheduleHotwordRestart(2000);
  }
}

function stopHotword() {
  clearTimeout(hotword.restartTimer);
  hotword.active = false;
  updateHotwordPill();
  try { hotword.recognition?.stop(); } catch(_) {}
}

function scheduleHotwordRestart(delay = 1000) {
  clearTimeout(hotword.restartTimer);
  hotword.restartTimer = setTimeout(() => {
    if (hotword.enabled && !voice.active) startHotword();
  }, delay);
}

function onWakeWordDetected() {
  stopHotword();
  window.aria.showWindow();

  setTimeout(() => {
    const overlay = el('setup-overlay');
    if (overlay && overlay.style.display !== 'none') return; // not set up yet

    // Flash logo for visual feedback
    const logo = document.querySelector('.titlebar-logo');
    if (logo) {
      logo.style.color = 'var(--cyan)';
      logo.style.textShadow = '0 0 12px var(--cyan)';
      setTimeout(() => { logo.style.color = ''; logo.style.textShadow = ''; }, 700);
    }

    toast('👂 Hey ARIA — listening…', 'success');

    // Auto-start command mic via Whisper recorder
    hideVoiceConfirm();
    hideFuzzyConfirm();
    if (whisperState.ready) {
      await _voiceStart();
    } else {
      // Whisper not set up yet — just focus the input
      el('chat-input').focus();
      toast('Say your command and press Enter', 'info');
    }
  }, 250);
}

function onHotwordToggle(enabled) {
  hotword.enabled = enabled;
  try { window.aria.saveConfig({ hotwordEnabled: enabled }); } catch(_) {}

  if (enabled) {
    startHotword();
    toast('Wake word active — say "Hey ARIA"', 'success');
  } else {
    stopHotword();
    toast('Wake word disabled', 'info');
  }
  updateHotwordPill();
}

function updateHotwordPill() {
  const pill = el('hotword-pill');
  if (!pill) return;
  if (!hotword.enabled) {
    pill.style.display = 'none';
    return;
  }
  pill.style.display = 'inline-flex';
  if (hotword.active) {
    pill.textContent = '👂 WAKE';
    pill.className   = 'status-pill online';
    pill.title       = 'Listening for "Hey ARIA"';
  } else {
    pill.textContent = '👂 WAKE';
    pill.className   = 'status-pill offline';
    pill.title       = 'Wake word paused (mic in use)';
  }
}

// ── Pause hotword while command mic is active, resume after ──────
const _origToggleVoice = toggleVoice;
// Hook: stop hotword when command mic starts
const _origInitVoice = initVoice;

// Watch window visibility — restart hotword when window hides
try {
  window.aria.onWindowHide(() => {
    if (hotword.enabled && !voice.active) scheduleHotwordRestart(800);
  });
  window.aria.onWindowShow(() => {
    // Pause hotword when window is visible (command mic takes over)
    if (hotword.active) stopHotword();
  });
} catch(_) {}

// Also pause hotword when command mic is in use
const _origVoiceStart = voice;
document.addEventListener('aria-voice-start', () => { if (hotword.active) stopHotword(); });
document.addEventListener('aria-voice-end',   () => {
  if (hotword.enabled) scheduleHotwordRestart(1000);
});
async function debugTestOllama() {
  const out = el('debug-out');
  if (!out) return;
  out.textContent = `Testing…\nModel: ${state.ollamaModel}\nHost:  ${state.ollamaHost}\n`;

  // 1. Check connectivity
  out.textContent += '\n[1] Checking Ollama status…\n';
  let status;
  try { status = await window.aria.ollamaStatus(state.ollamaHost); }
  catch(e) { out.textContent += `ERROR: ${e.message}`; return; }
  out.textContent += status.running
    ? `    ✓ Running — models: ${status.models.map(m=>m.name).join(', ')}\n`
    : `    ✗ Not running: ${status.error}\n`;
  if (!status.running) return;

  // 2. Send minimal test chat
  out.textContent += '\n[2] Sending test chat (say hi)…\n';
  const t0 = Date.now();
  let r;
  try {
    r = await window.aria.ollamaChat(
      state.ollamaModel,
      [{ role: 'user', content: 'Reply with exactly: ARIA_OK' }],
      'You are a test assistant. Reply only with ARIA_OK.',
      state.ollamaHost
    );
  } catch(e) { out.textContent += `ERROR: ${e.message}`; return; }

  const elapsed = ((Date.now()-t0)/1000).toFixed(1);
  if (r.ok) {
    out.textContent += `    ✓ Response in ${elapsed}s:\n    "${r.text}"\n`;
  } else {
    out.textContent += `    ✗ Error after ${elapsed}s: ${r.error}\n`;
    return;
  }

  // 3. Send a real ARIA command
  out.textContent += '\n[3] Sending real ARIA command (open notepad)…\n';
  const t1 = Date.now();
  let r2;
  try {
    r2 = await window.aria.ollamaChat(
      state.ollamaModel,
      [{ role: 'user', content: 'open notepad' }],
      buildPrompt(),
      state.ollamaHost
    );
  } catch(e) { out.textContent += `ERROR: ${e.message}`; return; }

  const e2 = ((Date.now()-t1)/1000).toFixed(1);
  if (r2.ok) {
    out.textContent += `    ✓ Response in ${e2}s:\n${r2.text}\n`;
  } else {
    out.textContent += `    ✗ Error after ${e2}s: ${r2.error}\n`;
  }
}
function setLoading(v) {
  state.isLoading = v;
  const lb = el('loading-bar'), btn = el('send-btn');
  if (lb) lb.style.display = v ? 'block' : 'none';
  if (btn) btn.disabled = v;
}

let _tt;
function toast(msg, type='info') {
  const t = el('toast');
  t.textContent = (type==='success'?'✓ ':type==='error'?'✗ ':'ℹ ') + msg;
  t.className = `show ${type}`; clearTimeout(_tt);
  _tt = setTimeout(()=>t.classList.remove('show'), 3000);
}

function fmtBytes(b) {
  if (!b) return '?';
  const gb = b/1024/1024/1024;
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(b/1024/1024).toFixed(0)}MB`;
}
