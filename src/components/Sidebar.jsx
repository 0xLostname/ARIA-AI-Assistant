import React from 'react';
import './Sidebar.css';

const NAV_ITEMS = [
  { id: 'chat',     icon: '💬', label: 'Chat' },
  { id: 'files',    icon: '📁', label: 'Files' },
  { id: 'apps',     icon: '🚀', label: 'Apps' },
  { id: 'macros',   icon: '⚡', label: 'Learned' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

const QUICK_PATHS = [
  { id: 'desktop',   icon: '🖥️', label: 'Desktop' },
  { id: 'downloads', icon: '⬇️', label: 'Downloads' },
  { id: 'documents', icon: '📄', label: 'Documents' },
  { id: 'pictures',  icon: '🖼️', label: 'Pictures' },
];

export default function Sidebar({
  activePanel,
  onNavigate,
  onQuickOpen,
  ollamaRunning,
  ollamaModel,
  claudeApiKey,
  aiMode,
  onRefreshOllama,
  memoryCount,
}) {

  const aiWidgetContent = () => {
    if (ollamaRunning && ollamaModel && aiMode !== 'claude') {
      return <><span style={{ color: 'var(--green)' }}>🦙</span> {ollamaModel}</>;
    }
    if (claudeApiKey) {
      return <><span style={{ color: 'var(--cyan)' }}>☁️</span> Claude</>;
    }
    return <><span style={{ color: 'var(--red)' }}>✗</span> Not configured</>;
  };

  return (
    <div id="sidebar">
      <div className="sidebar-section-label">Navigation</div>

      {NAV_ITEMS.map(item => (
        <div
          key={item.id}
          className={`nav-item ${activePanel === item.id ? 'active' : ''}`}
          onClick={() => onNavigate(item.id)}
        >
          <span className="nav-icon">{item.icon}</span>
          {item.label}
          {item.id === 'macros' && memoryCount > 0 && (
            <span className="nav-badge">{memoryCount}</span>
          )}
        </div>
      ))}

      <div className="sidebar-divider" />
      <div className="sidebar-section-label">Quick Access</div>

      <div className="quick-paths">
        {QUICK_PATHS.map(p => (
          <div
            key={p.id}
            className="quick-path"
            onClick={() => onQuickOpen(p.id)}
          >
            <span className="folder-icon">{p.icon}</span>
            {p.label}
          </div>
        ))}
      </div>

      <div className="sidebar-divider" />

      {/* AI Widget */}
      <div className="sidebar-bottom">
        <div className="ai-widget">
          <div className="ai-widget-label">AI BACKEND</div>
          <div className="ai-widget-model">{aiWidgetContent()}</div>
          <div className="ai-widget-actions">
            <button className="ai-widget-btn" onClick={() => onNavigate('settings')}>⚙️ Config</button>
            <button className="ai-widget-btn" onClick={onRefreshOllama}>🔄</button>
          </div>
        </div>
        <div className="sidebar-version">ARIA v2.3 · Ctrl+Shift+A</div>
      </div>
    </div>
  );
}
