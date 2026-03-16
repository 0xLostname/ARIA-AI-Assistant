import { useState, useCallback, useRef } from 'react';

// ── Markdown-lite formatter (safe HTML) ──────────────────────────
export function fmt(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--cyan)">$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

export function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function stripJson(text) {
  return text
    .replace(/```json[\s\S]*?```/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();
}

// ── System prompt builder ────────────────────────────────────────
function buildPrompt(sysInfo) {
  const D = sysInfo?.desktop   || 'C:/Users/user/Desktop';
  const L = sysInfo?.downloads || 'C:/Users/user/Downloads';
  const O = sysInfo?.documents || 'C:/Users/user/Documents';
  const U = sysInfo?.username  || 'user';

  return `You are ARIA, a Windows assistant for ${U}. Desktop="${D}" Downloads="${L}" Documents="${O}"

Reply: one sentence + JSON action block.
Example: Opening Chrome.\n\`\`\`json\n{"action":"launch_app","name":"chrome"}\n\`\`\`

Actions: launch_app(name) web_search(query,engine) open_url(url) open_file(path) open_folder(path) list_files(path) search_files(query,dir) create_file(path,content) create_folder(path) rename(path,newName) delete(path) screenshot clipboard_write(text) clipboard_read sys_info open_settings(setting) run_cmd(command)

App names: chrome firefox edge notepad calculator vlc spotify discord zoom vscode word excel cmd powershell explorer
Engines: google youtube bing

Vague\u2192action: bored/watch\u2192web_search youtube | music\u2192launch spotify | write\u2192launch notepad | files\u2192list_files "${D}" | code\u2192launch vscode | chat\u2192launch discord | call\u2192launch zoom | screenshot\u2192screenshot | stats\u2192sys_info

Rules: always output JSON block. Use full paths. One sentence only.`;
}

// ── Message shape ────────────────────────────────────────────────
// { id, role: 'user'|'ai', text, result, model, elapsed, isStreaming }

function nowStr() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

let _msgId = 0;
const nextId = () => ++_msgId;

// ── Hook ─────────────────────────────────────────────────────────
export function useChat({
  ollamaRunning, ollamaModel, ollamaHost,
  claudeApiKey, aiMode, sysInfo,
  parseAndRun, runAction,
  memoryExactMatch, memoryFuzzyMatch, memorySave,
  showToast,
}) {

  const [messages,     setMessages]     = useState([]);
  const [isLoading,    setIsLoading]    = useState(false);
  const [fuzzyPending, setFuzzyPending] = useState(null);

  // Bug fix #2: request ID ref guards listener races on fast double-send.
  // Each stream invocation stamps its own reqId; all listeners bail out on
  // mismatch so a stale stream can't corrupt the incoming one.
  const activeReqId = useRef(0);

  // ── Welcome message ───────────────────────────────────────────
  const showWelcome = useCallback((model) => {
    const u = sysInfo?.username;
    const text = `Hello${u ? ` **${u}**` : ''}! I'm ARIA, powered by **${model}**.\n\nTry: *"open Chrome"*, *"show my Downloads"*, *"I'm bored"*, *"take a screenshot"*`;
    setMessages([{ id: nextId(), role: 'ai', text, model, timestamp: nowStr() }]);
  }, [sysInfo]);

  // ── Add message helpers ───────────────────────────────────────
  const addUserMsg  = useCallback((text) =>
    setMessages(prev => [...prev, { id: nextId(), role: 'user', text, timestamp: nowStr() }]), []);

  const addAiMsg = useCallback((text, result, model, elapsed) =>
    setMessages(prev => [...prev, { id: nextId(), role: 'ai', text, result, model, elapsed, timestamp: nowStr() }]), []);

  // ── Streaming bubble update ───────────────────────────────────
  const updateStreamMsg = useCallback((id, patch) =>
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m)), []);

  // ── Shared Ollama stream runner ───────────────────────────────
  // Bug fix #1: extracted as a proper useCallback with complete deps so
  // sendMessage (and fuzzyConfirmAsk) always call the current version.
  // Previously these were separate callbacks missing from sendMessage's
  // dep array, causing sendMessage to hold stale closures after re-renders.
  const _runOllamaStream = useCallback(async (originalText, ctx, prompt) => {
    const reqId   = ++activeReqId.current;
    const msgId   = nextId();
    const startMs = Date.now();
    let accumulated = '';
    let done        = false;

    window.aria.removeStreamListeners();

    setMessages(prev => [...prev, {
      id: msgId, role: 'ai', text: '', isStreaming: true, model: ollamaModel, timestamp: nowStr(),
    }]);

    window.aria.onStreamPing(() => {
      if (done || activeReqId.current !== reqId) return;
      updateStreamMsg(msgId, { elapsed: ((Date.now() - startMs) / 1000).toFixed(1) });
    });

    window.aria.onStreamToken((token) => {
      if (done || activeReqId.current !== reqId) return;
      accumulated += token;
      const visible = accumulated
        .replace(/```json[\s\S]*?```/g, '')
        .replace(/```json[\s\S]*$/,     '')
        .replace(/^\s*`+\s*$/gm,        '')
        .trim();
      updateStreamMsg(msgId, { text: visible, isStreaming: true });
    });

    window.aria.onStreamDone(async (fullText) => {
      if (done || activeReqId.current !== reqId) return;
      done = true;
      window.aria.removeStreamListeners();
      setIsLoading(false);

      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      const display = stripJson(fullText);
      const result  = await parseAndRun(fullText, originalText, memorySave);

      updateStreamMsg(msgId, {
        text: display || '\u2713',
        isStreaming: false,
        result,
        model: ollamaModel,
        elapsed,
      });

      
    });

    window.aria.onStreamError((err) => {
      if (done || activeReqId.current !== reqId) return;
      done = true;
      window.aria.removeStreamListeners();
      setIsLoading(false);
      updateStreamMsg(msgId, { text: `\u26a0\ufe0f ${err}`, isStreaming: false });
    });

    const r = await window.aria.ollamaChat(ollamaModel, ctx, prompt, ollamaHost);
    if (!done && activeReqId.current === reqId && !r.ok) {
      done = true;
      window.aria.removeStreamListeners();
      setIsLoading(false);
      updateStreamMsg(msgId, { text: `\u26a0\ufe0f ${r.error}`, isStreaming: false });
    }
  }, [ollamaModel, ollamaHost, parseAndRun, memorySave, updateStreamMsg]);

  // ── Shared Claude request runner ──────────────────────────────
  const _runClaudeRequest = useCallback(async (originalText, ctx, prompt) => {
    try {
      const r = await window.aria.aiMessage(claudeApiKey, ctx, prompt);
      setIsLoading(false);
      if (!r.ok) { addAiMsg(`\u26a0\ufe0f ${r.error}`, null, 'Claude'); return; }
      const raw     = (r.content || []).map(c => c.text || '').join('');
      const display = stripJson(raw);
      const result  = await parseAndRun(raw, originalText, memorySave);
      addAiMsg(display || '\u2713', result, 'Claude');
      
    } catch(e) {
      setIsLoading(false);
      addAiMsg(`\u26a0\ufe0f ${e.message}`, null, 'Claude');
    }
  }, [claudeApiKey, parseAndRun, memorySave, addAiMsg]);

  // ── Core send logic ───────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    text = text.trim();
    if (!text || isLoading) return;

    const useOllama = ollamaRunning && ollamaModel && (aiMode === 'ollama' || aiMode === 'auto');
    const useClaude = claudeApiKey  && (aiMode === 'claude' || (aiMode === 'auto' && !ollamaRunning));

    // ── Exact memory match → instant bypass ───────────────────
    const exactHit = memoryExactMatch(text);
    if (exactHit) {
      addUserMsg(text);
      setIsLoading(true);
      const result = await runAction(exactHit.action);
      setIsLoading(false);
      addAiMsg(`Running **${exactHit.phrase}**`, result, '\u26a1 instant');
      // Bug fix #3: only reinforce memory when the action actually succeeded.
      // Previously memorySave was called unconditionally, so failed actions
      // (e.g. file not found, app not installed) would keep replaying instantly.
      if (result?.ok === true) await memorySave(exactHit.phrase, exactHit.action);
      return;
    }

    // ── Fuzzy match → show confirm bar ─────────────────────────
    const fuzzyHit = memoryFuzzyMatch(text);
    if (fuzzyHit) {
      addUserMsg(text);
      
      setFuzzyPending({ entry: fuzzyHit, originalText: text });
      return;
    }

    if (!useOllama && !useClaude) {
      showToast('No AI connected \u2014 open Settings', 'error');
      return;
    }

    addUserMsg(text);
    
    setIsLoading(true);

    const prompt = buildPrompt(sysInfo);
    

    if (useOllama) await _runOllamaStream(text, [], prompt);
    else           await _runClaudeRequest(text, [], prompt);
  }, [
    isLoading, ollamaRunning, ollamaModel, ollamaHost,
    claudeApiKey, aiMode, sysInfo,
    memoryExactMatch, memoryFuzzyMatch, memorySave,
    addUserMsg, addAiMsg, runAction, showToast,
    _runOllamaStream, _runClaudeRequest,
  ]);

  // ── Fuzzy confirm: run remembered action ──────────────────────
  const fuzzyConfirmRun = useCallback(async () => {
    if (!fuzzyPending) return;
    const { entry } = fuzzyPending;
    setFuzzyPending(null);
    if (!entry) return;
    setIsLoading(true);
    const result = await runAction(entry.action);
    setIsLoading(false);
    addAiMsg(`Running **${entry.phrase}**`, result, '\u26a1 memory');
    // Bug fix #3: same guard as exact-match path.
    if (result?.ok === true) await memorySave(entry.phrase, entry.action);
  }, [fuzzyPending, runAction, addAiMsg, memorySave]);

  // ── Fuzzy confirm: ask AI instead ────────────────────────────
  const fuzzyConfirmAsk = useCallback(async () => {
    if (!fuzzyPending) return;
    const { originalText } = fuzzyPending;
    setFuzzyPending(null);
    if (!originalText) return;

    const useOllama = ollamaRunning && ollamaModel && (aiMode === 'ollama' || aiMode === 'auto');
    const useClaude = claudeApiKey  && (aiMode === 'claude' || (aiMode === 'auto' && !ollamaRunning));
    if (!useOllama && !useClaude) { showToast('No AI connected', 'error'); return; }

    setIsLoading(true);
    const prompt = buildPrompt(sysInfo);
    
    if (useOllama) await _runOllamaStream(originalText, [], prompt);
    else           await _runClaudeRequest(originalText, [], prompt);
  }, [
    fuzzyPending, ollamaRunning, ollamaModel, claudeApiKey,
    aiMode, sysInfo, _runOllamaStream, _runClaudeRequest, showToast,
  ]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages, isLoading, fuzzyPending,
    sendMessage, showWelcome, clearMessages,
    fuzzyConfirmRun, fuzzyConfirmAsk,
    setFuzzyPending,
  };
}
