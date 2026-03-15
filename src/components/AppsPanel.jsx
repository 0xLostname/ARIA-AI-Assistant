import React, { useState } from 'react';
import './AppsPanel.css';

const APPS = [
  { name:'Chrome',      icon:'🌐', cmd:'chrome'        },
  { name:'Firefox',     icon:'🦊', cmd:'firefox'       },
  { name:'Edge',        icon:'🔵', cmd:'edge'          },
  { name:'Notepad',     icon:'📝', cmd:'notepad'       },
  { name:'Calculator',  icon:'🔢', cmd:'calculator'    },
  { name:'Paint',       icon:'🎨', cmd:'paint'         },
  { name:'Explorer',    icon:'📁', cmd:'file explorer' },
  { name:'CMD',         icon:'⬛', cmd:'cmd'           },
  { name:'PowerShell',  icon:'🔷', cmd:'powershell'    },
  { name:'Terminal',    icon:'💻', cmd:'terminal'      },
  { name:'Task Mgr',    icon:'📊', cmd:'task manager'  },
  { name:'VS Code',     icon:'💙', cmd:'vscode'        },
  { name:'Spotify',     icon:'🎵', cmd:'spotify'       },
  { name:'Discord',     icon:'💬', cmd:'discord'       },
  { name:'Zoom',        icon:'📹', cmd:'zoom'          },
  { name:'Slack',       icon:'💼', cmd:'slack'         },
  { name:'Word',        icon:'📘', cmd:'word'          },
  { name:'Excel',       icon:'📗', cmd:'excel'         },
];

export default function AppsPanel({ showToast }) {
  const [launching, setLaunching] = useState(null);

  const launch = async (app) => {
    setLaunching(app.cmd);
    const r = await window.aria.appLaunch(app.cmd);
    setLaunching(null);
    if (r.ok) showToast(`Launching ${app.name}…`, 'success');
    else      showToast(r.error, 'error');
  };

  return (
    <div id="panel-apps">
      <div className="panel-header" style={{ borderBottom:'1px solid rgba(0,212,255,0.1)', background:'rgba(5,8,16,0.8)' }}>
        <span className="panel-title">🚀 Quick Launch</span>
      </div>
      <div className="apps-grid">
        {APPS.map(app => (
          <div
            key={app.cmd}
            className={`app-card${launching === app.cmd ? ' launching' : ''}`}
            onClick={() => launch(app)}
          >
            <div className="app-icon">{launching === app.cmd ? '⏳' : app.icon}</div>
            <div className="app-name">{app.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
