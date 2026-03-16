import React, { useEffect, useRef } from 'react';
import './Titlebar.css';

export default function Titlebar({ ollamaRunning, ollamaModel, aiMode, hotwordEnabled, hotwordActive, sysUser, sysHost }) {

  const logoRef = useRef(null);

  // Expose flash function globally so hotword engine can call it
  useEffect(() => {
    window.__flashLogo = () => {
      if (!logoRef.current) return;
      logoRef.current.classList.add('flash');
      setTimeout(() => logoRef.current?.classList.remove('flash'), 700);
    };
    return () => { delete window.__flashLogo; };
  }, []);

  return (
    <div id="titlebar">
      {/* Logo */}
      <div className="titlebar-logo" ref={logoRef}>
        <div className="dot" />
        ARIA
      </div>

      {/* Status */}
      <div className="titlebar-status">
        {sysUser && <span>{sysUser}@{sysHost}</span>}

        <span className={`status-pill ${ollamaRunning ? 'online' : 'offline'}`}>
          OLLAMA {ollamaRunning ? '✓' : '✗'}
        </span>

        {hotwordEnabled && (
          <span
            className={`status-pill ${hotwordActive ? 'online' : 'offline'}`}
            title='Say "Hey ARIA" to wake'
          >
            👂 WAKE
          </span>
        )}

        {ollamaModel && aiMode !== 'claude' && (
          <span className="status-pill ai">{ollamaModel}</span>
        )}
      </div>

      {/* Window controls */}
      <div className="titlebar-controls">
        <button className="win-btn" onClick={() => window.aria.minimize()} title="Minimize">−</button>
        <button className="win-btn" onClick={() => window.aria.maximize()} title="Maximize">□</button>
        <button className="win-btn close" onClick={() => window.aria.close()} title="Close">✕</button>
      </div>
    </div>
  );
}
