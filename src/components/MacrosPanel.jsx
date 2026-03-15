import React from 'react';
import './MacrosPanel.css';

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

export default function MacrosPanel({
  memory, onRun, onDelete, onClearAll,
}) {
  return (
    <div id="panel-macros">
      <div className="panel-header">
        <span className="panel-title">⚡ Learned Commands</span>
        <button
          className="action-btn"
          style={{ color:'var(--red)', borderColor:'rgba(255,60,60,0.3)', marginLeft:'auto' }}
          onClick={onClearAll}
        >
          🗑 Clear All
        </button>
      </div>

      <div className="macros-hint">
        Commands ARIA learned automatically. Click ▶ to run instantly, 🗑 to forget.
      </div>

      <div className="macros-list">
        {memory.length === 0 ? (
          <div className="empty-state" style={{ marginTop:40 }}>
            <div className="icon">⚡</div>
            <span>No learned commands yet.<br/>Just use ARIA normally — it learns automatically.</span>
          </div>
        ) : (
          memory.map(entry => (
            <div key={entry.id} className="macro-item">
              <button
                className="macro-run"
                title="Run now"
                onClick={() => onRun(entry)}
              >▶</button>

              <div className="macro-body">
                <div className="macro-label">{entry.phrase}</div>
                <div className="macro-action">{describeAction(entry.action)}</div>
              </div>

              <div className="macro-meta">{entry.useCount || 1}×</div>

              <button
                className="macro-btn delete"
                title="Forget this command"
                onClick={() => onDelete(entry.id)}
              >🗑</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
