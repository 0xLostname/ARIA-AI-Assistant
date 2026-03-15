import React, { useState, useEffect, useCallback, useRef } from 'react';
import Titlebar      from './components/Titlebar.jsx';
import Sidebar       from './components/Sidebar.jsx';
import ChatPanel     from './components/ChatPanel.jsx';
import FilesPanel    from './components/FilesPanel.jsx';
import AppsPanel     from './components/AppsPanel.jsx';
import MacrosPanel   from './components/MacrosPanel.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { useMemory }  from './hooks/useMemory.js';
import { useActions } from './hooks/useActions.js';
import { useChat }    from './hooks/useChat.js';

// ── Placeholder for panels not yet migrated ───────────────────────
const PlaceholderPanel = ({ name }) => (
  <div style={{
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', gap: 12, color: 'var(--text-faint)',
    fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: 1,
  }}>
    <div style={{ fontSize: 36, opacity: 0.3 }}>🚧</div>
    <span>{name} — migrating next session</span>
  </div>
);

// ── Toast hook ────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState({ msg: '', type: 'info', visible: false });
  const timerRef = useRef(null);
  const showToast = useCallback((msg, type = 'info') => {
    clearTimeout(timerRef.current);
    setToast({ msg, type, visible: true });
    timerRef.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000);
  }, []);
  return { toast, showToast };
}

// ── Whisper hook ──────────────────────────────────────────────────
function useWhisper(showToast) {
  const [whisperReady,      setWhisperReady]      = useState(false);
  const [whisperSettingUp,  setWhisperSettingUp]  = useState(false);

  useEffect(() => {
    window.aria.whisperStatus().then(r => setWhisperReady(r.ready)).catch(() => {});
  }, []);

  const setupWhisper = useCallback(async () => {
    if (whisperReady)     { showToast('Whisper already set up ✓', 'success'); return; }
    if (whisperSettingUp) { showToast('Setup already running…', 'info'); return; }
    setWhisperSettingUp(true);
    showToast('Setting up local voice (one-time ~150 MB)…', 'info');
    window.aria.onWhisperProgress(({ msg, pct }) => {
      showToast(`🎙️ ${msg}${pct < 100 ? ` (${pct}%)` : ''}`, 'info');
    });
    const r = await window.aria.whisperSetup();
    window.aria.offWhisperProgress();
    setWhisperSettingUp(false);
    if (r.ok) { setWhisperReady(true); showToast('✓ Whisper ready — click mic to speak', 'success'); }
    else       { showToast(`Whisper setup failed: ${r.error}`, 'error'); }
  }, [whisperReady, whisperSettingUp, showToast]);

  return { whisperReady, whisperSettingUp, setupWhisper };
}

// ── Main App ──────────────────────────────────────────────────────
export default function App() {

  // ── Core state ────────────────────────────────────────────────
  const [activePanel,    setActivePanel]    = useState('chat');
  const [sysInfo,        setSysInfo]        = useState(null);
  const [ollamaRunning,  setOllamaRunning]  = useState(false);
  const [ollamaModel,    setOllamaModel]    = useState(null);
  const [ollamaModels,   setOllamaModels]   = useState([]);
  const [ollamaHost,     setOllamaHost]     = useState('http://localhost:11434');
  const [claudeApiKey,   setClaudeApiKey]   = useState(null);
  const [aiMode,         setAiMode]         = useState('ollama');
  const [memory,         setMemory]         = useState([]);
  const [hotwordEnabled, setHotwordEnabled] = useState(false);
  const [hotwordActive,  setHotwordActive]  = useState(false);
  const [showSetup,      setShowSetup]      = useState(false);

  const { toast, showToast }                       = useToast();
  const { whisperReady, whisperSettingUp, setupWhisper } = useWhisper(showToast);

  // ── Memory engine ─────────────────────────────────────────────
  const {
    memoryExactMatch, memoryFuzzyMatch,
    memorySave, memoryDelete, memoryClearAll, autocompleteMatches,
  } = useMemory(memory, setMemory);

  const [filesPath, setFilesPath] = useState(null);

  // Set initial files path from sysInfo
  useEffect(() => {
    if (sysInfo?.homedir && !filesPath) setFilesPath(sysInfo.homedir);
  }, [sysInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Action executor ───────────────────────────────────────────
  const { runAction, parseAndRun } = useActions({
    onSysInfoUpdate:  (info) => setSysInfo(info),
    onFilesNavigate:  (path) => { setFilesPath(path); },
  });

  // ── Chat engine ───────────────────────────────────────────────
  const {
    messages, isLoading, fuzzyPending,
    sendMessage, showWelcome, fuzzyConfirmRun, fuzzyConfirmAsk,
  } = useChat({
    ollamaRunning, ollamaModel, ollamaHost,
    claudeApiKey, aiMode, sysInfo,
    parseAndRun, runAction,
    memoryExactMatch, memoryFuzzyMatch, memorySave,
    showToast,
  });

  // ── Boot ──────────────────────────────────────────────────────
  useEffect(() => {
    async function boot() {
      try {
        const res = await window.aria.loadConfig();
        const cfg = res?.config || {};
        if (cfg.apiKey)         setClaudeApiKey(cfg.apiKey);
        if (cfg.aiMode)         setAiMode(cfg.aiMode);
        if (cfg.ollamaHost)     setOllamaHost(cfg.ollamaHost);
        if (cfg.ollamaModel)    setOllamaModel(cfg.ollamaModel);
        if (cfg.hotwordEnabled) setHotwordEnabled(cfg.hotwordEnabled);
      } catch(e) { console.warn('Config error:', e); }

      try {
        const res = await window.aria.sysInfo();
        if (res.ok) setSysInfo(res.info);
      } catch(e) { console.warn('sysInfo error:', e); }

      try {
        const res = await window.aria.memoryLoad();
        if (res.ok) setMemory(res.entries || []);
      } catch(e) { console.warn('Memory error:', e); }

      await refreshOllama(true);
    }
    boot();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setShowSetup(!ollamaRunning && !claudeApiKey);
  }, [ollamaRunning, claudeApiKey]);

  // Show welcome message once AI is connected
  const welcomeShown = useRef(false);
  useEffect(() => {
    if (!welcomeShown.current && (ollamaRunning || claudeApiKey) && messages.length === 0) {
      welcomeShown.current = true;
      const model = (aiMode !== 'claude' && ollamaModel) ? ollamaModel : 'Claude';
      showWelcome(model);
    }
  }, [ollamaRunning, claudeApiKey, ollamaModel, aiMode, messages.length, showWelcome]);

  // ── Ollama refresh ────────────────────────────────────────────
  const refreshOllama = useCallback(async (silent = false) => {
    let res;
    try { res = await window.aria.ollamaStatus(ollamaHost); }
    catch(e) { res = { running: false, models: [], error: e.message }; }

    setOllamaRunning(res.running || false);
    setOllamaModels(res.models || []);

    if (!ollamaModel && res.models?.length) {
      const prefer = ['llama3.1','llama3','mistral','qwen','gemma','phi','deepseek'];
      const found  = prefer.find(p => res.models.some(m => m.name.includes(p)));
      const picked = found
        ? res.models.find(m => m.name.includes(found)).name
        : res.models[0].name;
      setOllamaModel(picked);
      try { await window.aria.saveConfig({ ollamaModel: picked }); } catch(_) {}
    }

    if (!silent) {
      if (res.running) showToast(`Ollama OK · ${res.models?.length || 0} model(s)`, 'success');
      else             showToast(res.error || 'Ollama unreachable', 'error');
    }
  }, [ollamaHost, ollamaModel, showToast]);

  // ── Navigation ────────────────────────────────────────────────
  const handleNavigate = useCallback((panel) => setActivePanel(panel), []);

  const handleQuickOpen = useCallback((folder) => {
    setFilesPath(folder);
    setActivePanel('files');
  }, []);

  // ── Run a macro entry from MacrosPanel ───────────────────────
  const runMacro = useCallback(async (entry) => {
    setActivePanel('chat');
    const result = await runAction(entry.action);
    await memorySave(entry.phrase, entry.action);
    showToast(
      result?.ok
        ? `✓ ${result.message || entry.phrase}`
        : `✗ ${result?.error || 'Failed'}`,
      result?.ok ? 'success' : 'error'
    );
  }, [runAction, memorySave, showToast]);

  // ── Settings handlers ─────────────────────────────────────────
  const handleAiModeChange = useCallback(async (mode) => {
    setAiMode(mode);
    try { await window.aria.saveConfig({ aiMode: mode }); } catch(_) {}
  }, []);

  const handleOllamaHostSave = useCallback(async (host) => {
    setOllamaHost(host);
    try { await window.aria.saveConfig({ ollamaHost: host }); } catch(_) {}
    await refreshOllama(false);
  }, [refreshOllama]);

  const handleModelChange = useCallback(async (model) => {
    setOllamaModel(model);
    try { await window.aria.saveConfig({ ollamaModel: model }); } catch(_) {}
    showToast(`Model → ${model}`, 'success');
  }, [showToast]);

  const handleClaudeKeySave = useCallback(async (key) => {
    setClaudeApiKey(key);
    try {
      await window.aria.storeApiKey(key);
      await window.aria.saveConfig({ apiKey: key });
    } catch(_) {}
    showToast('Claude key saved!', 'success');
  }, [showToast]);

  const handleHotwordToggle = useCallback(async (enabled) => {
    setHotwordEnabled(enabled);
    try { await window.aria.saveConfig({ hotwordEnabled: enabled }); } catch(_) {}
    showToast(enabled ? 'Wake word active — say "Hey ARIA"' : 'Wake word disabled', 'info');
  }, [showToast]);

  // ── Panel router ──────────────────────────────────────────────
  const renderPanel = () => {
    switch (activePanel) {
      case 'chat':
        return (
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            fuzzyPending={fuzzyPending}
            onFuzzyRun={fuzzyConfirmRun}
            onFuzzyAsk={fuzzyConfirmAsk}
            onSendMessage={sendMessage}
            autocompleteMatches={autocompleteMatches}
            whisperReady={whisperReady}
            whisperSettingUp={whisperSettingUp}
            onWhisperSetup={setupWhisper}
          />
        );
      case 'files':
        return (
          <FilesPanel
            key={filesPath}
            initialPath={filesPath}
            showToast={showToast}
            onNavigated={setFilesPath}
          />
        );
      case 'apps':
        return <AppsPanel showToast={showToast} />;
      case 'macros':
        return (
          <MacrosPanel
            memory={memory}
            onRun={runMacro}
            onDelete={memoryDelete}
            onClearAll={async () => {
              if (!window.confirm('Clear all saved commands?')) return;
              await memoryClearAll();
              showToast('Command memory cleared', 'info');
            }}
          />
        );
      case 'settings':
        return (
          <SettingsPanel
            whisperReady={whisperReady}
            whisperSettingUp={whisperSettingUp}
            onWhisperSetup={setupWhisper}
            aiMode={aiMode}
            onAiModeChange={handleAiModeChange}
            hotwordEnabled={hotwordEnabled}
            onHotwordToggle={handleHotwordToggle}
            ollamaRunning={ollamaRunning}
            ollamaModels={ollamaModels}
            ollamaModel={ollamaModel}
            ollamaHost={ollamaHost}
            onOllamaHostSave={handleOllamaHostSave}
            onModelChange={handleModelChange}
            onOllamaRefresh={() => refreshOllama(false)}
            claudeApiKey={claudeApiKey}
            onClaudeKeySave={handleClaudeKeySave}
            sysInfo={sysInfo}
          />
        );
      default:
        return <PlaceholderPanel name={activePanel} />;
    }
  };

  return (
    <div className="app-shell">
      <div className="bg-grid" />
      <div className="bg-glow bg-glow-1" />
      <div className="bg-glow bg-glow-2" />
      <div className="scanline" />

      {/* Setup overlay */}
      {showSetup && (
        <div style={{
          position:'fixed', inset:0, zIndex:500,
          background:'rgba(3,5,12,0.97)',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <div style={{
            fontFamily:'var(--mono)', color:'var(--cyan)',
            textAlign:'center', padding:40,
          }}>
            <div style={{ fontSize:32, marginBottom:16 }}>◈ ARIA</div>
            <div style={{ fontSize:12, color:'var(--text-faint)', marginBottom:24 }}>
              Connect an AI backend in Settings to get started
            </div>
            <button
              onClick={() => { setShowSetup(false); setActivePanel('settings'); }}
              style={{
                background:'rgba(0,212,255,0.1)', border:'1px solid var(--cyan-border)',
                color:'var(--cyan)', padding:'10px 24px', borderRadius:8,
                fontFamily:'var(--mono)', fontSize:12, cursor:'pointer',
              }}
            >
              Open Settings →
            </button>
          </div>
        </div>
      )}

      <Titlebar
        ollamaRunning={ollamaRunning}
        ollamaModel={ollamaModel}
        aiMode={aiMode}
        hotwordEnabled={hotwordEnabled}
        hotwordActive={hotwordActive}
        sysUser={sysInfo?.username}
        sysHost={sysInfo?.hostname}
      />

      <div className="main-layout">
        <Sidebar
          activePanel={activePanel}
          onNavigate={handleNavigate}
          onQuickOpen={handleQuickOpen}
          ollamaRunning={ollamaRunning}
          ollamaModel={ollamaModel}
          claudeApiKey={claudeApiKey}
          aiMode={aiMode}
          onRefreshOllama={() => refreshOllama(false)}
          memoryCount={memory.length}
        />

        <div className="content-area">
          {isLoading && (
            <div className="loading-bar">
              <div className="loading-bar-inner" />
            </div>
          )}
          {renderPanel()}
        </div>
      </div>

      <div className={`toast ${toast.visible ? 'show' : ''} ${toast.type}`}>
        {toast.type === 'success' ? '✓ ' : toast.type === 'error' ? '✗ ' : 'ℹ '}
        {toast.msg}
      </div>
    </div>
  );
}
