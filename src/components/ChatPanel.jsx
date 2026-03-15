import React, {
  useState, useEffect, useRef, useCallback, useMemo
} from 'react';
import { fmt, esc } from '../hooks/useChat.js';
import './ChatPanel.css';

const SUGGESTIONS = [
  "Open Chrome", "Show my Desktop", "I'm bored",
  "Take a screenshot", "Play some music", "Show my Downloads",
  "Open VS Code", "System info",
];

// ── Single message bubble ────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === 'user';
  const bubbleHtml = msg.isStreaming
    ? (msg.text
        ? fmt(msg.text) + '<span class="cursor-blink">▌</span>'
        : '<span style="opacity:.4">thinking…</span><span class="cursor-blink">▌</span>')
    : fmt(msg.text || '');

  return (
    <div className={`msg ${isUser ? 'user' : 'ai'}`}>
      <div className="msg-avatar">{isUser ? '👤' : '🤖'}</div>
      <div className="msg-body">
        <div
          className="msg-bubble"
          dangerouslySetInnerHTML={{ __html: bubbleHtml + (msg.result ? renderResult(msg.result) : '') }}
        />
        <div className="msg-time" style={{ display:'flex', gap:8, alignItems:'center' }}>
          {msg.timestamp}
          {msg.model && (
            <span className="src-badge">
              {msg.model}{msg.elapsed ? ` · ${msg.elapsed}s` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function renderResult(result) {
  if (!result) return '';
  if (result.ok)    return `<div class="msg-result success">✓ ${esc(result.message || 'Done')}</div>`;
  if (result.error) return `<div class="msg-result error">✗ ${esc(result.error)}</div>`;
  return '';
}

// ── Typing indicator ─────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="msg ai">
      <div className="msg-avatar">🤖</div>
      <div className="msg-body">
        <div className="msg-bubble" style={{ padding:'10px 16px' }}>
          <div className="typing-indicator">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ChatPanel ───────────────────────────────────────────────
export default function ChatPanel({
  messages, isLoading,
  fuzzyPending, onFuzzyRun, onFuzzyAsk,
  onSendMessage,
  autocompleteMatches,
  whisperReady, whisperSettingUp,
  onWhisperSetup,
}) {
  // Shuffle suggestions once on mount, never again
  const shuffledSuggestions = useMemo(() =>
    [...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 4),
  []);
  const [input,          setInput]          = useState('');
  const [acMatches,      setAcMatches]      = useState([]);
  const [showAc,         setShowAc]         = useState(false);
  const [voiceActive,    setVoiceActive]    = useState(false);
  const [voiceTranscript,setVoiceTranscript]= useState(null); // null = hidden, string = show confirm
  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);
  const acTimerRef     = useRef(null);
  const mediaRef       = useRef({ recorder: null, chunks: [], stream: null });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Input handling ────────────────────────────────────────────
  const handleInputChange = useCallback((e) => {
    const val = e.target.value;
    setInput(val);

    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';

    // Debounced autocomplete
    clearTimeout(acTimerRef.current);
    if (!val.trim() || val.length < 2) { setShowAc(false); setAcMatches([]); return; }
    acTimerRef.current = setTimeout(() => {
      const matches = autocompleteMatches(val);
      setAcMatches(matches);
      setShowAc(matches.length > 0);
    }, 80);
  }, [autocompleteMatches]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isLoading) return;
    const text = input;
    setInput('');
    setShowAc(false);
    setAcMatches([]);
    if (inputRef.current) { inputRef.current.style.height = 'auto'; }
    onSendMessage(text);
  }, [input, isLoading, onSendMessage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    // Typing while recording stops mic
    if (voiceActive && e.key !== 'Enter') stopRecording();
  }, [handleSend, voiceActive]);

  const useAcSuggestion = useCallback((match) => {
    setInput(match.phrase);
    setShowAc(false);
    setAcMatches([]);
    onSendMessage(match.phrase);
  }, [onSendMessage]);

  const useSuggestion = useCallback((text) => {
    setInput('');
    onSendMessage(text);
  }, [onSendMessage]);

  // ── Voice recording ───────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (!whisperReady) { onWhisperSetup(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current.stream  = stream;
      mediaRef.current.chunks  = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorder.ondataavailable = e => { if (e.data.size > 0) mediaRef.current.chunks.push(e.data); };
      recorder.onstop = async () => {
        const chunks = [...mediaRef.current.chunks];
        mediaRef.current.chunks = [];
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 1000) return;

        setVoiceActive(false); // show transcribing state
        try {
          const buf = await blob.arrayBuffer();
          const r   = await window.aria.whisperTranscribe(buf);
          if (r.ok && r.text?.trim()) setVoiceTranscript(r.text.trim());
        } catch(e) {
          console.warn('Transcription error:', e);
        }
      };

      recorder.start(100);
      mediaRef.current.recorder = recorder;
      setVoiceActive(true);
      setVoiceTranscript(null);
    } catch(e) {
      console.warn('Mic error:', e);
    }
  }, [whisperReady, onWhisperSetup]);

  const stopRecording = useCallback(() => {
    if (!mediaRef.current.recorder) return;
    // Don't setVoiceActive(false) here — onstop handler owns that transition
    // so the UI can show the "transcribing" state cleanly
    try { mediaRef.current.recorder.stop(); } catch(_) {}
    try { mediaRef.current.stream?.getTracks().forEach(t => t.stop()); } catch(_) {}
    mediaRef.current.recorder = null;
    mediaRef.current.stream   = null;
  }, []);

  const toggleVoice = useCallback(() => {
    if (voiceActive) stopRecording();
    else startRecording();
  }, [voiceActive, startRecording, stopRecording]);

  const voiceSend = useCallback(() => {
    if (!voiceTranscript) return;
    const text = voiceTranscript;
    setVoiceTranscript(null);
    setInput('');
    onSendMessage(text);
  }, [voiceTranscript, onSendMessage]);

  const voiceCancel = useCallback(() => {
    setVoiceTranscript(null);
    setInput('');
  }, []);

  // Mic button state
  const micState = whisperSettingUp ? 'setting-up'
                 : voiceActive      ? 'listening'
                 : voiceTranscript !== null ? 'transcribing'
                 : 'idle';

  const micIcon  = { 'setting-up': '⏳', listening: '⏹', transcribing: '💭', idle: '🎤' }[micState];
  const micTitle = {
    'setting-up': 'Setting up Whisper…',
    listening:    'Click to stop recording',
    transcribing: 'Transcribing…',
    idle:         whisperReady ? 'Click to speak (Whisper local)' : 'Click to set up local voice',
  }[micState];

  return (
    <div id="panel-chat">
      {/* Messages */}
      <div id="messages">
        {messages.map(msg => <Message key={msg.id} msg={msg} />)}
        {isLoading && messages[messages.length - 1]?.role === 'user' && !messages.some(m => m.isStreaming) && (
          <TypingIndicator />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div id="input-bar">
        {/* Suggestion chips */}
        {messages.length <= 1 && (
          <div className="suggestions">
            {shuffledSuggestions.map(s => (
              <span key={s} className="suggestion-chip" onClick={() => useSuggestion(s)}>{s}</span>
            ))}
          </div>
        )}

        {/* Voice confirm */}
        {voiceTranscript !== null && (
          <div id="voice-confirm" style={{ display:'flex' }}>
            <div className="voice-confirm-text">"{voiceTranscript}"</div>
            <div className="voice-confirm-actions">
              <button className="voice-confirm-btn send"   onClick={voiceSend}>⚡ Send</button>
              <button className="voice-confirm-btn cancel" onClick={voiceCancel}>✕ Cancel</button>
            </div>
          </div>
        )}

        {/* Fuzzy confirm */}
        {fuzzyPending && (
          <div id="fuzzy-confirm" style={{ display:'flex' }}>
            <div className="fuzzy-confirm-left">
              <span className="fuzzy-icon">⚡</span>
              <div>
                <div className="fuzzy-label">"{fuzzyPending.entry.phrase}"</div>
                <div className="fuzzy-action">{describeAction(fuzzyPending.entry.action)}</div>
              </div>
            </div>
            <div className="voice-confirm-actions">
              <button className="voice-confirm-btn send"   onClick={onFuzzyRun}>▶ Run again</button>
              <button className="voice-confirm-btn cancel" onClick={onFuzzyAsk}>🤖 Ask AI</button>
            </div>
          </div>
        )}

        {/* Autocomplete */}
        {showAc && acMatches.length > 0 && (
          <div id="autocomplete-list">
            {acMatches.map(m => (
              <div key={m.id} className="ac-item" onClick={() => useAcSuggestion(m)}>
                <span className="ac-icon">⚡</span>
                <span className="ac-label">{m.phrase}</span>
                <span className="ac-count">{m.useCount}×</span>
                <span className="ac-score">{Math.round(m.score * 100)}%</span>
              </div>
            ))}
          </div>
        )}

        {/* Text input */}
        <div className="input-wrapper">
          <textarea
            ref={inputRef}
            id="chat-input"
            rows={1}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Say anything — 'open Chrome', 'show my downloads', 'I'm bored'…"
          />
          <button
            id="mic-btn"
            className={voiceActive ? 'mic-active' : ''}
            onClick={toggleVoice}
            title={micTitle}
            disabled={micState === 'setting-up' || micState === 'transcribing'}
          >
            {micIcon}
          </button>
          <button
            id="send-btn"
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
          >
            ⚡
          </button>
        </div>

        <div className="input-hint">
          ENTER to send · SHIFT+ENTER new line · 🎤 click to speak
        </div>
      </div>
    </div>
  );
}

// ── Describe action for fuzzy confirm bar ─────────────────────────
function describeAction(action) {
  if (!action?.action) return '?';
  switch (action.action) {
    case 'launch_app':      return `Launch ${action.name}`;
    case 'web_search':      return `Search ${action.engine || 'google'}: "${action.query}"`;
    case 'open_url':        return `Open ${action.url}`;
    case 'open_file':       return `Open: ${action.path}`;
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
