import { useCallback } from 'react';

// ── Execute a pre-parsed action object ──────────────────────────
export function useActions({ onFilesNavigate, onSysInfoUpdate } = {}) {

  const runAction = useCallback(async (action) => {
    if (!action?.action) return null;
    try {
      switch (action.action) {
        case 'launch_app':
          return await window.aria.appLaunch(action.name);

        case 'web_search':
          return await window.aria.browserSearch(action.query, action.engine || 'google');

        case 'open_url':
          return await window.aria.browserOpenUrl(action.url);

        case 'open_file':
          return await window.aria.fsOpen(action.path);

        case 'open_folder':
          return await window.aria.fsOpenFolder(action.path);

        case 'list_files': {
          const r = await window.aria.fsList(action.path);
          if (r.ok) {
            onFilesNavigate?.(r.path, r.items);
            const dirs  = r.items.filter(i => i.isDir).length;
            const files = r.items.filter(i => !i.isDir).length;
            return { ok: true, message: `${r.path} — ${dirs} folder${dirs !== 1 ? 's' : ''}, ${files} file${files !== 1 ? 's' : ''}` };
          }
          return r;
        }

        case 'search_files':
          return await window.aria.fsSearch(action.query, action.dir);

        case 'create_file':
          return await window.aria.fsCreateFile(action.path, action.content || '');

        case 'create_folder':
          return await window.aria.fsCreateFolder(action.path);

        case 'rename':
          return await window.aria.fsRename(action.path, action.newName);

        case 'delete':
          return await window.aria.fsDelete(action.path);

        case 'screenshot':
          return await window.aria.sysScreenshot();

        case 'clipboard_write':
          return await window.aria.clipboardWrite(action.text);

        case 'clipboard_read': {
          const r = await window.aria.clipboardRead();
          if (r.ok) {
            const content = r.content;
            return {
              ok: true,
              message: content
                ? `Clipboard: "${content.substring(0, 100)}${content.length > 100 ? '…' : ''}"`
                : 'Clipboard is empty',
            };
          }
          return r;
        }

        case 'sys_info': {
          const r = await window.aria.sysInfo();
          if (r.ok) onSysInfoUpdate?.(r.info);
          return r;
        }

        case 'open_settings':
          return await window.aria.sysOpenSettings(action.setting);

        case 'run_cmd':
          return await window.aria.sysRunCommand(action.command);

        case 'kill_app':
          return await window.aria.appKill(action.name);

        default:
          return { ok: false, error: `Unknown action: ${action.action}` };
      }
    } catch(e) {
      return { ok: false, error: e.message };
    }
  }, [onFilesNavigate, onSysInfoUpdate]);

  // ── Parse AI text response and run the extracted action ──────
  const parseAndRun = useCallback(async (text, originalPhrase, onMemorySave) => {
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

    // Fix common model JSON mistakes
    jsonStr = jsonStr
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
      .replace(/:\s*'([^']*?)'/g, ':"$1"');

    let action;
    try {
      action = JSON.parse(jsonStr);
    } catch {
      const an = jsonStr.match(/"action"\s*:\s*"([^"]+)"/);
      if (!an) return { ok: false, error: 'Could not parse action JSON' };
      action = { action: an[1] };
      const pn = jsonStr.match(/"path"\s*:\s*"([^"]+)"/);   if (pn) action.path    = pn[1];
      const nn = jsonStr.match(/"name"\s*:\s*"([^"]+)"/);   if (nn) action.name    = nn[1];
      const qn = jsonStr.match(/"query"\s*:\s*"([^"]+)"/);  if (qn) action.query   = qn[1];
      const en = jsonStr.match(/"engine"\s*:\s*"([^"]+)"/); if (en) action.engine  = en[1];
      const tn = jsonStr.match(/"text"\s*:\s*"([^"]+)"/);   if (tn) action.text    = tn[1];
      const un = jsonStr.match(/"url"\s*:\s*"([^"]+)"/);    if (un) action.url     = un[1];
    }

    if (!action?.action) return null;
    console.log('[ARIA action]', JSON.stringify(action));

    const result = await runAction(action);

    if (result?.ok !== false && originalPhrase) {
      await onMemorySave?.(originalPhrase, action);
    }

    return result;
  }, [runAction]);

  return { runAction, parseAndRun };
}
