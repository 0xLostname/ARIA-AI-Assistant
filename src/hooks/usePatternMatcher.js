// ── Pattern Matcher — bypasses AI for common commands ────────────────
// Returns an action object (same shape as AI output) or null if no match.
// Evaluated top-to-bottom; first match wins.

// ── Normalise ────────────────────────────────────────────────────────
function norm(s) {
  return s.toLowerCase().trim()
    .replace(/[!?.,']+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/^(hey aria|aria)[,\s]+/, '')
    .trim();
}

// ── Extract payload after trigger prefixes (longest prefix first) ────
function after(n, ...prefixes) {
  const sorted = [...prefixes].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    if (n === p) return '';
    if (n.startsWith(p + ' ')) return n.slice(p.length + 1).trim();
  }
  return null;
}

function startsWith(n, ...prefixes) {
  return prefixes.some(p => n === p || n.startsWith(p + ' '));
}

function hasWord(n, ...words) {
  return words.some(w => {
    const re = new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    return re.test(n);
  });
}

// ── Folder name → full path ───────────────────────────────────────────
function resolveFolder(name, info) {
  const u = info?.username || 'user';
  const map = {
    'desktop':       info?.desktop   || `C:/Users/${u}/Desktop`,
    'downloads':     info?.downloads || `C:/Users/${u}/Downloads`,
    'documents':     info?.documents || `C:/Users/${u}/Documents`,
    'docs':          info?.documents || `C:/Users/${u}/Documents`,
    'pictures':      `C:/Users/${u}/Pictures`,
    'photos':        `C:/Users/${u}/Pictures`,
    'images':        `C:/Users/${u}/Pictures`,
    'music':         `C:/Users/${u}/Music`,
    'songs':         `C:/Users/${u}/Music`,
    'videos':        `C:/Users/${u}/Videos`,
    'movies':        `C:/Users/${u}/Videos`,
    'home':          info?.homedir || `C:/Users/${u}`,
    'appdata':       `C:/Users/${u}/AppData/Roaming`,
    'temp':          `C:/Users/${u}/AppData/Local/Temp`,
    'program files': 'C:/Program Files',
    'programs':      'C:/Program Files',
  };
  return map[name] || null;
}

// ── Rules ────────────────────────────────────────────────────────────
const RULES = [

  // APP LAUNCHING
  // "open chrome", "launch spotify", "can you start vscode"
  (s) => {
    const stripped = s.replace(/^(can you|could you|please|will you|would you mind|i want to|i'd like to|i need to)\s+/, '');
    const app = after(stripped,
      'open up', 'start up', 'boot up', 'fire up', 'bring up', 'pull up',
      'pop open', 'get me into', 'take me to app',
      'open', 'launch', 'start', 'run', 'load', 'execute',
    );
    if (app !== null && app.length > 1) {
      if (/\bfolder\b|\bdirectory\b|\bdrive\b/.test(app)) return null;
      // "open a new X" with 3+ words is probably not an app name
      if (/^(a |the |this |that |my )/.test(app) && app.split(' ').length > 2 && !/\.\w{2,4}$/.test(app)) return null;
      return { action: 'launch_app', name: app };
    }
    return null;
  },

  // FILE / FOLDER OPEN
  // "show my downloads", "go to documents folder", "browse desktop"
  (s, info) => {
    const payload = after(s,
      'open my folder', 'open folder', 'show my folder', 'show folder',
      'open directory', 'browse folder', 'go to folder', 'navigate to folder',
      'open my', 'show my', 'take me to my', 'go to my',
      'browse', 'go to', 'navigate to',
    );
    if (payload === null) return null;
    const clean = payload.replace(/\s*(folder|directory)$/, '').trim();
    if (!clean) return null;
    const resolved = resolveFolder(clean, info);
    if (resolved) return { action: 'open_folder', path: resolved };
    if (/^[a-z]:[/\\]/i.test(clean) || clean.startsWith('/')) return { action: 'open_folder', path: clean };
    return null;
  },

  // FILE SEARCH
  // "find budget.xlsx", "where is my resume.docx", "locate config.json"
  (s, info) => {
    const q = after(s,
      'find file', 'search for file', 'locate file', 'where is the file',
      'find my', 'where is my', 'where is', 'locate', 'find the file',
    );
    if (q !== null && q.length > 1) {
      if (/\.\w{2,5}$/.test(q) || /\bfile\b/.test(s)) {
        const dir = info?.documents || `C:/Users/${info?.username || 'user'}`;
        return { action: 'search_files', query: q, dir };
      }
    }
    return null;
  },

  // WEB SEARCH — YouTube (before Google)
  // "youtube lo-fi", "search youtube for cats", "watch tutorials"
  (s) => {
    const q = after(s,
      'search youtube for', 'youtube search for', 'find on youtube',
      'watch on youtube', 'look up on youtube', 'search youtube',
      'youtube for', 'youtube',
    );
    if (q !== null && q.length > 1) return { action: 'web_search', query: q, engine: 'youtube' };
    const watch = after(s, 'watch');
    if (watch !== null && watch.length > 1 && !watch.includes('http'))
      return { action: 'web_search', query: watch, engine: 'youtube' };
    return null;
  },

  // WEB SEARCH — Bing
  (s) => {
    const q = after(s, 'search bing for', 'bing search for', 'search on bing', 'bing search', 'bing');
    if (q !== null && q.length > 1) return { action: 'web_search', query: q, engine: 'bing' };
    return null;
  },

  // WEB SEARCH — Google
  // "search for X", "google X", "look up X", "what is X", "how do I X"
  (s) => {
    const q = after(s,
      'search google for', 'google search for', 'search on google',
      'search for', 'google for', 'google',
      'look up', 'look for', 'search',
    );
    if (q !== null && q.length > 1) return { action: 'web_search', query: q, engine: 'google' };
    if (/^(what(s| is| are| was| were)|how (do|does|did|can|to)|who (is|was|are)|when (did|is|was)|why (is|are|does|did))\b/.test(s))
      return { action: 'web_search', query: s, engine: 'google' };
    return null;
  },

  // OPEN URL
  // "go to github.com", "visit reddit.com", "open https://..."
  (s) => {
    if (/^(https?:\/\/|www\.)\S+/.test(s)) return { action: 'open_url', url: s };
    const url = after(s, 'open url', 'open website', 'open site', 'open link', 'go to', 'navigate to', 'visit', 'take me to');
    if (url !== null && url.length > 1) {
      if (/^(https?:\/\/|www\.|[a-z0-9-]+\.(com|org|net|io|dev|co|uk|me|app|ai))/.test(url))
        return { action: 'open_url', url };
    }
    return null;
  },

  // SCREENSHOT
  (s) => {
    if (hasWord(s, 'screenshot', 'screen shot') ||
        startsWith(s, 'take a screenshot', 'capture my screen', 'capture screen',
                      'snap my screen', 'screen capture', 'grab my screen', 'take screenshot'))
      return { action: 'screenshot' };
    return null;
  },

  // CLIPBOARD READ
  // Only match explicit clipboard-read phrases, not just the word "clipboard"
  (s) => {
    if (startsWith(s,
      "what's in my clipboard", "what is in my clipboard", "whats in my clipboard",
      'show my clipboard', 'show clipboard contents', 'read my clipboard', 'read clipboard',
      'check my clipboard', 'check clipboard', 'clipboard contents', 'what did i copy',
      'paste from clipboard', 'get clipboard',
    )) return { action: 'clipboard_read' };
    return null;
  },

  // CLIPBOARD WRITE
  // "copy X to clipboard", "put X in my clipboard"
  (s) => {
    const text = after(s,
      'copy to clipboard', 'write to clipboard', 'set clipboard to',
      'put in my clipboard', 'put in clipboard', 'add to clipboard',
      'save to clipboard', 'clipboard write',
    );
    if (text !== null && text.length > 0) return { action: 'clipboard_write', text };
    return null;
  },

  // SYSTEM INFO
  (s) => {
    if (startsWith(s,
      'system info', 'show system info', 'pc stats', 'pc info', 'show pc stats',
      'computer stats', 'computer info', "how's my pc", 'how is my pc',
      "how's my computer", 'check my pc', 'show memory', 'show ram', 'show cpu',
      'memory usage', 'cpu usage', 'ram usage', 'disk usage',
      'check ram', 'check cpu', 'check memory', 'show uptime',
    ) || hasWord(s, 'sys info', 'sysinfo'))
      return { action: 'sys_info' };
    return null;
  },

  // WINDOWS SETTINGS
  (s) => {
    const map = [
      { setting: 'display',       words: ['display settings', 'screen settings', 'screen resolution', 'resolution settings', 'brightness settings', 'monitor settings', 'change resolution', 'adjust brightness'] },
      { setting: 'sound',         words: ['sound settings', 'audio settings', 'volume settings', 'speaker settings', 'change volume', 'audio output', 'microphone settings', 'sound output'] },
      { setting: 'wifi',          words: ['wifi settings', 'wi-fi settings', 'network settings', 'internet settings', 'wireless settings', 'change wifi', 'connect to wifi', 'network connections'] },
      { setting: 'bluetooth',     words: ['bluetooth settings', 'bluetooth devices', 'pair bluetooth', 'connect bluetooth', 'bluetooth options'] },
      { setting: 'apps',          words: ['apps settings', 'installed apps', 'add remove programs', 'uninstall apps', 'manage apps', 'programs and features', 'default apps'] },
      { setting: 'updates',       words: ['windows update', 'check for updates', 'update settings', 'update windows', 'install updates', 'check updates'] },
      { setting: 'privacy',       words: ['privacy settings', 'camera permissions', 'microphone permissions', 'app permissions', 'location settings', 'privacy options'] },
      { setting: 'power',         words: ['power settings', 'sleep settings', 'battery settings', 'power options', 'hibernate settings', 'shutdown settings', 'power plan'] },
      { setting: 'accounts',      words: ['account settings', 'user settings', 'sign in settings', 'login settings', 'change password', 'microsoft account', 'user accounts'] },
      { setting: 'keyboard',      words: ['keyboard settings', 'typing settings', 'input settings', 'language settings', 'keyboard layout', 'keyboard options'] },
      { setting: 'mouse',         words: ['mouse settings', 'pointer settings', 'cursor settings', 'trackpad settings', 'touchpad settings', 'mouse options'] },
      { setting: 'storage',       words: ['storage settings', 'disk settings', 'storage sense', 'free up space', 'manage storage', 'disk space settings'] },
      { setting: 'time',          words: ['date and time', 'time settings', 'timezone settings', 'time zone', 'change time', 'change date', 'clock settings', 'date settings'] },
      { setting: 'startup',       words: ['startup apps', 'startup programs', 'startup settings', 'autostart', 'boot apps', 'startup manager'] },
      { setting: 'taskbar',       words: ['taskbar settings', 'customize taskbar', 'taskbar options', 'taskbar configuration'] },
      { setting: 'notifications', words: ['notification settings', 'manage notifications', 'turn off notifications', 'do not disturb', 'focus assist', 'notification options'] },
      { setting: 'personalize',   words: ['personalization', 'change wallpaper', 'change background', 'change theme', 'desktop background', 'wallpaper settings', 'theme settings'] },
      { setting: 'system',        words: ['system settings', 'about this pc', 'device specs', 'computer properties', 'advanced system settings'] },
    ];
    for (const { setting, words } of map) {
      if (words.some(w => s.includes(w))) return { action: 'open_settings', setting };
    }
    return null;
  },

  // RUN COMMAND
  // "run ipconfig in cmd", "execute ping 8.8.8.8"
  (s) => {
    const cmd = after(s,
      'run command', 'execute command', 'run in cmd', 'run in terminal',
      'run in powershell', 'execute in cmd', 'execute in terminal',
      'terminal command', 'cmd command', 'run cmd',
    );
    if (cmd !== null && cmd.length > 1) return { action: 'run_cmd', command: cmd };
    return null;
  },

  // VAGUE / INTENT — most specific first
  (s) => {
    if (hasWord(s, 'bored') || startsWith(s, 'entertain me', 'something to watch', 'nothing to do', 'kill some time', 'i have nothing to do'))
      return { action: 'web_search', query: 'trending videos', engine: 'youtube' };

    if (startsWith(s, 'play music', 'play some music', 'i want to listen', 'i want music', 'put on music', 'put on some music', 'play something') || s === 'music')
      return { action: 'launch_app', name: 'spotify' };

    if (hasWord(s, 'video call', 'video chat') || startsWith(s, 'join a call', 'start a call', 'hop on a call', 'jump on a call'))
      return { action: 'launch_app', name: 'zoom' };

    if (s === 'write' || s === 'notes' || s === 'notepad' ||
        startsWith(s, 'i need to write', 'take notes', 'write something', 'jot down', 'make a note', 'open notes'))
      return { action: 'launch_app', name: 'notepad' };

    if (s === 'code' || s === 'coding' ||
        startsWith(s, 'i want to code', 'let me code', 'start coding', 'open my editor', 'write some code'))
      return { action: 'launch_app', name: 'vscode' };

    if (s === 'discord' || startsWith(s, 'message someone', 'chat with', 'dm someone', 'open discord'))
      return { action: 'launch_app', name: 'discord' };

    if (s === 'email' || s === 'mail' ||
        startsWith(s, 'check my email', 'open email', 'open mail', 'read my email', 'check email'))
      return { action: 'launch_app', name: 'outlook' };

    if (s === 'files' || s === 'file explorer' || s === 'explorer' ||
        startsWith(s, 'show my files', 'browse my files', 'open file explorer', 'open files'))
      return { action: 'launch_app', name: 'explorer' };

    return null;
  },
];

// ── Main export ───────────────────────────────────────────────────────
export function matchPattern(input, sysInfo) {
  if (!input?.trim()) return null;
  const n = norm(input);
  for (const rule of RULES) {
    const result = rule(n, sysInfo);
    if (result) {
      console.log(`[ARIA pattern] "${input}" → ${JSON.stringify(result)}`);
      return result;
    }
  }
  return null;
}
