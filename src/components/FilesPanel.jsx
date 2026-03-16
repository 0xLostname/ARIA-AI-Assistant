import React, { useState, useEffect, useCallback, useRef } from 'react';
import './FilesPanel.css';

const FILE_ICONS = {
  '.txt':'📄', '.md':'📝', '.pdf':'📕', '.doc':'📘', '.docx':'📘',
  '.xls':'📗', '.xlsx':'📗', '.jpg':'🖼️', '.jpeg':'🖼️', '.png':'🖼️',
  '.gif':'🖼️', '.mp3':'🎵', '.mp4':'🎬', '.mkv':'🎬', '.zip':'🗜️',
  '.rar':'🗜️', '.exe':'⚙️', '.bat':'⚙️', '.py':'🐍', '.js':'📜',
  '.jsx':'📜', '.ts':'📜', '.tsx':'📜', '.html':'🌐', '.css':'🎨',
};

function fileIcon(item) {
  if (item.isDir) return '📁';
  return FILE_ICONS[item.ext?.toLowerCase()] || '📄';
}

function Breadcrumb({ path, onNavigate }) {
  if (!path) return null;
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  let acc = '';
  return (
    <div className="breadcrumb">
      {parts.map((part, i) => {
        acc += (acc ? '/' : '') + part;
        const cur  = acc;
        const last = i === parts.length - 1;
        return (
          <React.Fragment key={cur}>
            {i > 0 && <span className="sep"> / </span>}
            <span
              className={last ? 'current' : ''}
              onClick={() => !last && onNavigate(cur)}
            >
              {part}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function FilesPanel({ initialPath, showToast, onNavigated }) {
  const [currentPath, setCurrentPath] = useState(initialPath || null);
  const [items,       setItems]       = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [search,      setSearch]      = useState('');
  const searchTimer = useRef(null);

  // Navigate to a path
  const navTo = useCallback(async (path) => {
    if (!path) return;
    setLoading(true);
    const r = await window.aria.fsList(path);
    setLoading(false);
    if (!r.ok) { showToast(r.error, 'error'); return; }
    setCurrentPath(r.path);
    setItems(r.items || []);
    setSearch('');
    onNavigated?.(r.path);
  }, [showToast, onNavigated]);

  // Boot / initialPath change
  useEffect(() => {
    if (initialPath) navTo(initialPath);
  }, [initialPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const navUp = useCallback(async () => {
    if (!currentPath) return;
    const parts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 1) return;
    parts.pop();
    await navTo(parts.join('/') || '/');
  }, [currentPath, navTo]);

  const onDblClick = useCallback(async (item) => {
    if (item.isDir) { navTo(item.path); return; }
    const r = await window.aria.fsOpen(item.path);
    if (!r.ok) showToast(r.error, 'error');
  }, [navTo, showToast]);

  const onSearchChange = useCallback((val) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    if (!val.trim()) { navTo(currentPath); return; }
    if (val.length < 2) return;
    searchTimer.current = setTimeout(async () => {
      setLoading(true);
      const r = await window.aria.fsSearch(val, currentPath);
      setLoading(false);
      if (r.ok) setItems(r.results || []);
    }, 300);
  }, [currentPath, navTo]);

  const newFile = useCallback(async () => {
    const name = window.prompt('File name:');
    if (!name?.trim()) return;
    const r = await window.aria.fsCreateFile(`${currentPath}/${name}`, '');
    if (r.ok) { showToast(r.message, 'success'); navTo(currentPath); }
    else showToast(r.error, 'error');
  }, [currentPath, navTo, showToast]);

  const newFolder = useCallback(async () => {
    const name = window.prompt('Folder name:');
    if (!name?.trim()) return;
    const r = await window.aria.fsCreateFolder(`${currentPath}/${name}`);
    if (r.ok) { showToast(r.message, 'success'); navTo(currentPath); }
    else showToast(r.error, 'error');
  }, [currentPath, navTo, showToast]);

  const sorted = [...items].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div id="panel-files">
      {/* Header */}
      <div className="panel-header">
        <span className="panel-title">📁 Files</span>
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
        />
        <button className="action-btn" onClick={() => navTo(currentPath)} disabled={loading}>🔄</button>
      </div>

      {/* Breadcrumb */}
      <Breadcrumb path={currentPath} onNavigate={navTo} />

      {/* Grid */}
      <div className="file-grid">
        {loading && (
          <div className="empty-state">
            <div className="icon" style={{ fontSize:24, opacity:0.4 }}>⏳</div>
            <span>Loading…</span>
          </div>
        )}
        {!loading && sorted.length === 0 && (
          <div className="empty-state">
            <div className="icon">📭</div>
            <span>{search ? 'No results' : 'Empty folder'}</span>
          </div>
        )}
        {!loading && sorted.map(item => (
          <div
            key={item.path}
            className={`file-item${item.isDir ? ' folder' : ''}`}
            onDoubleClick={() => onDblClick(item)}
            title={item.name}
          >
            <div className="file-icon">{fileIcon(item)}</div>
            <div className="file-name">{item.name}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="file-actions">
        <button className="action-btn" onClick={newFile}>+ File</button>
        <button className="action-btn" onClick={newFolder}>+ Folder</button>
        <button className="action-btn" onClick={navUp}>↑ Up</button>
      </div>
    </div>
  );
}
