import React, { useState, useCallback, useEffect } from 'react';
import './SettingsPanel.css';

const REC_MODELS = ['llama3.1:8b', 'mistral:7b', 'qwen2.5:7b', 'phi3:mini', 'gemma2:9b'];
const WIN_SETTINGS = ['Display', 'WiFi', 'Bluetooth', 'Sound', 'Apps'];

export default function SettingsPanel({
  // Whisper
  whisperReady, whisperSettingUp, onWhisperSetup,
  // AI mode
  aiMode, onAiModeChange,
  // Hotword
  hotwordEnabled, onHotwordToggle,
  // Ollama
  ollamaRunning, ollamaModels, ollamaModel, ollamaHost,
  onOllamaHostSave, onModelChange, onOllamaRefresh,
  // Claude
  claudeApiKey, onClaudeKeySave,
  // System info
  sysInfo,
}) {
  const [hostInput,    setHostInput]    = useState(ollamaHost || 'http://localhost:11434');
  const [claudeInput,  setClaudeInput]  = useState('');
  const [pullInput,    setPullInput]    = useState('');
  const [pullStatus,   setPullStatus]   = useState(null);
  const [pulling,      setPulling]      = useState(false);
  const [debugOut,     setDebugOut]     = useState('Click the button to test…');
  const [debugging,    setDebugging]    = useState(false);

  // Sync host input if prop updates (e.g. loaded from config after mount)
  useEffect(() => {
    if (ollamaHost) setHostInput(ollamaHost);
  }, [ollamaHost]);

  // ── Ollama host save ──────────────────────────────────────────
  const handleHostSave = useCallback(() => {
    if (hostInput.trim()) onOllamaHostSave(hostInput.trim());
  }, [hostInput, onOllamaHostSave]);

  // ── Claude key save ───────────────────────────────────────────
  const handleClaudeKeySave = useCallback(() => {
    const key = claudeInput.trim();
    if (!key.startsWith('sk-ant')) { return; }
    onClaudeKeySave(key);
    setClaudeInput('');
  }, [claudeInput, onClaudeKeySave]);

  // ── Pull model ────────────────────────────────────────────────
  const handlePull = useCallback(async () => {
    const model = pullInput.trim();
    if (!model) return;
    setPulling(true);
    setPullStatus({ msg: `⬇️ Pulling ${model}… (may take minutes)`, type: 'info' });
    try {
      const r = await window.aria.ollamaPull(model, ollamaHost);
      if (r.ok) {
        setPullStatus({ msg: `✓ ${r.message}`, type: 'success' });
        onOllamaRefresh();
        setPullInput('');
      } else {
        setPullStatus({ msg: `✗ ${r.error}`, type: 'error' });
      }
    } catch(e) {
      setPullStatus({ msg: `✗ ${e.message}`, type: 'error' });
    }
    setPulling(false);
  }, [pullInput, ollamaHost, onOllamaRefresh]);

  // ── Debug test ────────────────────────────────────────────────
  const handleDebugTest = useCallback(async () => {
    if (debugging) return;
    setDebugging(true);
    let out = `Testing…\nModel: ${ollamaModel}\nHost:  ${ollamaHost}\n`;
    setDebugOut(out);

    out += '\n[1] Checking Ollama status…\n';
    setDebugOut(out);
    let status;
    try { status = await window.aria.ollamaStatus(ollamaHost); }
    catch(e) { setDebugOut(out + `ERROR: ${e.message}`); setDebugging(false); return; }
    out += status.running
      ? `    ✓ Running — models: ${status.models.map(m => m.name).join(', ')}\n`
      : `    ✗ Not running: ${status.error}\n`;
    setDebugOut(out);
    if (!status.running) { setDebugging(false); return; }

    out += '\n[2] Sending test chat…\n';
    setDebugOut(out);
    const t0 = Date.now();
    let r;
    try {
      r = await window.aria.ollamaChat(
        ollamaModel,
        [{ role: 'user', content: 'Reply with exactly: ARIA_OK' }],
        'You are a test assistant. Reply only with ARIA_OK.',
        ollamaHost
      );
    } catch(e) { setDebugOut(out + `ERROR: ${e.message}`); setDebugging(false); return; }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    out += r.ok
      ? `    ✓ Response in ${elapsed}s:\n    "${r.text}"\n`
      : `    ✗ Error after ${elapsed}s: ${r.error}\n`;
    setDebugOut(out);
    if (!r.ok) { setDebugging(false); return; }

    out += '\n[3] Sending real command (open notepad)…\n';
    setDebugOut(out);
    const t1 = Date.now();
    let r2;
    try {
      r2 = await window.aria.ollamaChat(
        ollamaModel,
        [{ role: 'user', content: 'open notepad' }],
        buildSystemPrompt(sysInfo),
        ollamaHost
      );
    } catch(e) { setDebugOut(out + `ERROR: ${e.message}`); setDebugging(false); return; }
    const e2 = ((Date.now() - t1) / 1000).toFixed(1);
    out += r2.ok
      ? `    ✓ Response in ${e2}s:\n${r2.text}\n`
      : `    ✗ Error after ${e2}s: ${r2.error}\n`;
    setDebugOut(out);
    setDebugging(false);
  }, [debugging, ollamaModel, ollamaHost, sysInfo]);

  // ── Whisper status text ───────────────────────────────────────
  const whisperStatus = whisperSettingUp
    ? <span style={{ color:'var(--cyan)' }}>● Setting up…</span>
    : whisperReady
      ? <span style={{ color:'var(--green)' }}>● Ready · ggml-base.en</span>
      : <span style={{ color:'var(--text-faint)' }}>● Not installed · click Setup</span>;

  // ── Ollama status text ────────────────────────────────────────
  const ollamaStatus = ollamaRunning
    ? <span style={{ color:'var(--green)' }}>● Running · {ollamaModels.length} model(s)</span>
    : <span style={{ color:'var(--red)' }}>● Offline</span>;

  return (
    <div id="panel-settings">
      <div className="settings-scroll">

        {/* ── Voice / Whisper ── */}
        <Section title="🎙️ Voice Input (Whisper)">
          <Row label="Status">
            <span className="status-text">{whisperStatus}</span>
            <button className="btn-save" onClick={onWhisperSetup} disabled={whisperSettingUp || whisperReady}>
              {whisperReady ? '✓ Ready' : 'Setup'}
            </button>
          </Row>
          <p className="section-note">
            100% local · No internet for transcription · One-time ~150 MB download<br />
            Stored in: <code>%APPDATA%\aria-assistant\whisper\</code>
          </p>
        </Section>

        {/* ── AI Mode ── */}
        <Section title="🤖 AI Mode">
          <Row label="Mode">
            <select
              className="settings-select"
              value={aiMode}
              onChange={e => onAiModeChange(e.target.value)}
            >
              <option value="ollama">Ollama only (local)</option>
              <option value="claude">Claude only (cloud)</option>
              <option value="auto">Auto — Ollama then Claude</option>
            </select>
          </Row>
          <Row label="Wake word">
            <div className="toggle-row">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={hotwordEnabled}
                  onChange={e => onHotwordToggle(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
              <span className="toggle-label">
                Say <strong style={{ color:'var(--cyan)' }}>"Hey ARIA"</strong> to wake from tray
              </span>
            </div>
          </Row>
        </Section>

        {/* ── Ollama ── */}
        <Section title="🦙 Ollama">
          <Row label="Status">
            <span className="status-text">{ollamaStatus}</span>
            <button className="btn-save" onClick={onOllamaRefresh}>Refresh</button>
          </Row>
          <Row label="Host">
            <input
              type="text"
              value={hostInput}
              onChange={e => setHostInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleHostSave()}
              placeholder="http://localhost:11434"
            />
            <button className="btn-save" onClick={handleHostSave}>Save</button>
          </Row>
          <Row label="Model">
            <select
              className="settings-select"
              style={{ flex: 2 }}
              value={ollamaModel || ''}
              onChange={e => onModelChange(e.target.value)}
            >
              {ollamaModels.length === 0
                ? <option value="">— no models —</option>
                : ollamaModels.map(m => (
                    <option key={m.name} value={m.name}>
                      {m.name} ({fmtBytes(m.size)})
                    </option>
                  ))
              }
            </select>
          </Row>
          <div className="settings-row pull-row">
            <label>Pull model</label>
            <div className="pull-input-row">
              <input
                type="text"
                value={pullInput}
                onChange={e => setPullInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePull()}
                placeholder="e.g. llama3.1"
              />
              <button className="btn-save" onClick={handlePull} disabled={pulling || !pullInput.trim()}>
                {pulling ? '…' : '⬇️ Pull'}
              </button>
            </div>
            {pullStatus && (
              <div className="pull-status" style={{
                color: pullStatus.type === 'success' ? 'var(--green)'
                     : pullStatus.type === 'error'   ? 'var(--red)'
                     : 'var(--text-faint)'
              }}>
                {pullStatus.msg}
              </div>
            )}
            <div className="model-chips">
              {REC_MODELS.map(m => (
                <span key={m} className="model-chip" onClick={() => setPullInput(m)}>{m}</span>
              ))}
            </div>
          </div>
        </Section>

        {/* ── Claude API ── */}
        <Section title="☁️ Claude API">
          <Row label="Key">
            <input
              type="password"
              value={claudeInput}
              onChange={e => setClaudeInput(e.target.value)}
              placeholder={claudeApiKey ? '••••••••••••••••' : 'sk-ant-api03-…'}
            />
            <button
              className="btn-save"
              onClick={handleClaudeKeySave}
              disabled={!claudeInput.trim().startsWith('sk-ant')}
            >
              Save
            </button>
          </Row>
          {claudeApiKey && (
            <p className="section-note" style={{ color:'var(--green)' }}>✓ Claude API key saved</p>
          )}
        </Section>

        {/* ── Debug ── */}
        <Section title="🔬 Debug — Test Ollama">
          <div className="debug-buttons">
            <button className="btn-save" onClick={handleDebugTest} disabled={debugging}>
              {debugging ? '⏳ Testing…' : '▶ Send test message'}
            </button>
            <button className="action-btn" onClick={() => setDebugOut('Click the button to test…')}>
              Clear
            </button>
          </div>
          <pre className="debug-out">{debugOut}</pre>
        </Section>

        {/* ── System Info ── */}
        <Section title="💻 System Info">
          {sysInfo ? (
            <div className="info-grid">
              {[
                ['User',   sysInfo.username],
                ['Host',   sysInfo.hostname],
                ['OS',     sysInfo.osVersion?.substring(0, 30) || 'Windows'],
                ['Arch',   sysInfo.arch],
                ['CPU',    sysInfo.cpu?.substring(0, 28)],
                ['Cores',  sysInfo.cpuCores],
                ['RAM',    `${sysInfo.usedMemGB}/${sysInfo.totalMemGB} GB`],
                ['Uptime', sysInfo.uptime],
              ].map(([label, value]) => (
                <div key={label} className="info-card">
                  <div className="info-label">{label}</div>
                  <div className="info-value">{value || '—'}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="section-note">Loading…</p>
          )}
        </Section>

        {/* ── Windows Settings ── */}
        <Section title="🪟 Windows Settings">
          <div className="win-settings-btns">
            {WIN_SETTINGS.map(s => (
              <button
                key={s}
                className="action-btn"
                onClick={() => window.aria.sysOpenSettings(s.toLowerCase())}
              >
                {s}
              </button>
            ))}
          </div>
        </Section>

      </div>
    </div>
  );
}

// ── Small layout helpers ──────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="settings-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="settings-row">
      <label>{label}</label>
      {children}
    </div>
  );
}

function fmtBytes(b) {
  if (!b) return '?';
  const gb = b / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1024 / 1024).toFixed(0)} MB`;
}

function buildSystemPrompt(sysInfo) {
  const D = sysInfo?.desktop   || 'C:/Users/user/Desktop';
  const L = sysInfo?.downloads || 'C:/Users/user/Downloads';
  const O = sysInfo?.documents || 'C:/Users/user/Documents';
  const U = sysInfo?.username  || 'user';
  return `You are ARIA, a Windows assistant for ${U}. Desktop="${D}" Downloads="${L}" Documents="${O}"
Reply: one sentence + JSON action block.
Actions: launch_app(name) web_search(query) open_url(url)
Rules: always output JSON block. One sentence only.`;
}
