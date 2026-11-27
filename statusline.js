#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

// ANSI 16-color palette
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[91m';
const GREEN = '\x1b[92m';
const YELLOW = '\x1b[93m';
const MAGENTA = '\x1b[95m';
const CYAN = '\x1b[96m';
const WHITE = '\x1b[97m';
const GRAY = '\x1b[90m';

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readGitBranch(startDir) {
  try {
    let cur = path.resolve(startDir);
    while (cur) {
      const dotGit = path.join(cur, '.git');
      let gitDir = '';
      try {
        const stat = fs.statSync(dotGit);
        if (stat.isDirectory()) {
          gitDir = dotGit;
        } else if (stat.isFile()) {
          const content = fs.readFileSync(dotGit, 'utf-8');
          const match = content.match(/^gitdir:\s*(.+)$/m);
          if (match) {
            gitDir = path.resolve(cur, match[1].trim());
          }
        }
      } catch {}

      if (gitDir) {
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
        if (head.startsWith('ref: refs/heads/')) {
          return head.slice('ref: refs/heads/'.length);
        }
        if (head.startsWith('ref: ')) {
          return head.slice('ref: '.length).split('/').pop() || '';
        }
        if (/^[0-9a-f]{7,40}$/i.test(head)) {
          return head.slice(0, 7);
        }
        return '';
      }

      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  } catch {}
  return '';
}

function checkProcAncestorsSkipPerm() {
  if (process.platform !== 'linux') return false;
  try {
    let pid = process.ppid;
    for (let i = 0; i < 4; i++) {
      if (!pid || pid <= 1) break;
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
        if (/(?:^|\0)--dangerously-skip-permissions(?:\0|$)/.test(cmd)) {
          return true;
        }
      } catch {}
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
        const m = stat.match(/^\d+\s+\([^)]*\)\s+\S+\s+(\d+)\s/);
        if (!m) break;
        pid = Number(m[1]);
      } catch {
        break;
      }
    }
  } catch {}
  return false;
}

function readLatestLogInfo(logDir) {
  let skipPermFromLog = false;
  let logCycleMode;

  try {
    let latestName = '';
    for (const f of fs.readdirSync(logDir)) {
      if (f.startsWith('cli-') && f.endsWith('.log') && f > latestName) {
        latestName = f;
      }
    }
    if (!latestName) return { skipPermFromLog, logCycleMode };

    const fd = fs.openSync(path.join(logDir, latestName), 'r');
    try {
      const fileSize = fs.fstatSync(fd).size;
      const headSize = Math.min(16384, fileSize);
      const headBuf = Buffer.alloc(headSize);
      const headRead = fs.readSync(fd, headBuf, 0, headSize, 0);
      skipPermFromLog = headBuf.toString('utf-8', 0, headRead).includes('--dangerously-skip-permissions');

      const chunkSize = 65536;
      let end = fileSize;
      while (end > 0) {
        const start = Math.max(0, end - chunkSize);
        const len = end - start;
        const tailBuf = Buffer.alloc(len);
        const tailRead = fs.readSync(fd, tailBuf, 0, len, start);
        const text = tailBuf.toString('utf-8', 0, tailRead);
        const re = /SetCycleMode called:[ \t]*([^\r\n]*)/g;
        let m;
        let lastMatch;
        while ((m = re.exec(text)) !== null) {
          lastMatch = m[1].trim();
        }
        if (lastMatch !== undefined) {
          logCycleMode = lastMatch;
          break;
        }
        if (start === 0) break;
        end = start + 128;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {}

  return { skipPermFromLog, logCycleMode };
}

try {
  let raw = '';
  if (!process.stdin.isTTY) {
    try {
      raw = fs.readFileSync(0, 'utf-8');
    } catch {}
  }

  let data = {};
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed;
      }
    } catch {}
  }

  const agyDir = process.env.AGY_CONFIG_DIR || path.join(os.homedir(), '.gemini', 'antigravity-cli');

  // 1. Directory & Git branch: dir(git-branch)
  let dir = '';
  if (data.workspace && typeof data.workspace === 'object' && data.workspace.current_dir) {
    dir = data.workspace.current_dir;
  } else if (data.cwd) {
    dir = data.cwd;
  } else if (process.env.PWD) {
    dir = process.env.PWD;
  } else {
    dir = process.cwd();
  }

  const dirName = path.basename(dir) || dir;

  let branch = '';
  if (data.vcs && typeof data.vcs === 'object' && data.vcs.branch) {
    branch = data.vcs.branch;
  }
  if (!branch && dir && isDir(dir)) {
    branch = readGitBranch(dir);
  }

  let dirPart = `${CYAN}${BOLD}${dirName}${RESET}`;
  if (branch) {
    dirPart += `${GREEN}(${branch})${RESET}`;
  }

  const parts = [dirPart];

  // Read settings.json once for toolPermission / agentMode / model fallback
  const settingsPath = path.join(agyDir, 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) || {};
  } catch {}

  const { skipPermFromLog, logCycleMode } = readLatestLogInfo(path.join(agyDir, 'log'));

  // 2. [skip-perm] indicator
  let skipPerm = false;
  if (data.dangerously_skip_permissions || data.skip_permissions) {
    skipPerm = true;
  } else if (typeof data.permission_mode === 'string' && /^(?:bypass|skip|always[-_]proceed|dontAsk)/i.test(data.permission_mode)) {
    skipPerm = true;
  } else if (settings.toolPermission === 'always-proceed') {
    skipPerm = true;
  } else if (checkProcAncestorsSkipPerm() || skipPermFromLog) {
    skipPerm = true;
  }

  if (skipPerm) {
    parts.push(`${RED}${BOLD}[skip-perm]${RESET}`);
  }

  // 2b. Agent mode: [default] / [accept-edits] / [auto] / [plan]
  let rawMode = logCycleMode !== undefined ? logCycleMode : (data.agent_mode || data.mode || data.permission_mode || '');
  if (logCycleMode === undefined && !rawMode && typeof settings.agentMode === 'string') {
    rawMode = settings.agentMode;
  }
  let agentMode = String(rawMode || 'default').trim();
  if (/^accept[-_]?edits$/i.test(agentMode)) {
    agentMode = 'accept-edits';
  } else {
    agentMode = agentMode.toLowerCase() || 'default';
  }

  const modeColors = {
    plan: CYAN,
    auto: YELLOW,
    'accept-edits': GREEN,
    default: GRAY
  };
  const modeColor = modeColors[agentMode] || GRAY;
  parts.push(`${modeColor}[${agentMode}]${RESET}`);

  // 3. Python virtualenv: (.venv)
  let venv = '';
  if (process.env.VIRTUAL_ENV) {
    venv = path.basename(process.env.VIRTUAL_ENV);
  } else if (process.env.CONDA_DEFAULT_ENV && process.env.CONDA_DEFAULT_ENV !== 'base') {
    venv = process.env.CONDA_DEFAULT_ENV;
  } else if (dir && isDir(path.join(dir, '.venv'))) {
    venv = '.venv';
  } else if (dir && isDir(path.join(dir, 'venv'))) {
    venv = 'venv';
  }
  if (venv) {
    parts.push(`${YELLOW}(${venv})${RESET}`);
  }

  // 4. Context window percentage: 39.6% ctx
  let usedPct = 0;
  if (data.context_window && typeof data.context_window === 'object' && data.context_window.used_percentage !== undefined && data.context_window.used_percentage !== null) {
    usedPct = Number(data.context_window.used_percentage) || 0;
  }
  let ctxColor = WHITE;
  if (usedPct >= 90) {
    ctxColor = RED;
  } else if (usedPct >= 60) {
    ctxColor = YELLOW;
  }
  parts.push(`${ctxColor}${usedPct.toFixed(1)}% ctx${RESET}`);

  // 5. Quota usage: usage(87%w, 85%fh)
  if (data.quota && typeof data.quota === 'object' && Object.keys(data.quota).length > 0) {
    let wMin;
    let dMin;
    let otherMin;

    for (const [bucketId, b] of Object.entries(data.quota)) {
      if (!b || typeof b !== 'object') continue;
      if (b.disabled) continue;
      if (b.remaining_fraction === undefined || b.remaining_fraction === null) continue;
      const frac = Number(b.remaining_fraction);
      if (Number.isNaN(frac)) continue;

      const resetSec = b.reset_in_seconds !== undefined && b.reset_in_seconds !== null ? Number(b.reset_in_seconds) : -1;
      if (/weekly|week|7d/i.test(bucketId) || resetSec > 86400) {
        if (wMin === undefined || frac < wMin) wMin = frac;
      } else if (/daily|day|24h|5h|hourly/i.test(bucketId) || (resetSec > 0 && resetSec <= 86400)) {
        if (dMin === undefined || frac < dMin) dMin = frac;
      } else {
        if (otherMin === undefined || frac < otherMin) otherMin = frac;
      }
    }

    const uItems = [];
    let minFrac;
    if (wMin !== undefined) {
      uItems.push(`${Math.round(wMin * 100)}%w`);
      minFrac = wMin;
    }
    if (dMin !== undefined) {
      uItems.push(`${Math.round(dMin * 100)}%fh`);
      if (minFrac === undefined || dMin < minFrac) minFrac = dMin;
    }
    if (uItems.length === 0 && otherMin !== undefined) {
      uItems.push(`${Math.round(otherMin * 100)}%`);
      minFrac = otherMin;
    }

    if (uItems.length > 0) {
      let uColor = GREEN;
      if (minFrac < 0.20) {
        uColor = RED;
      } else if (minFrac < 0.50) {
        uColor = YELLOW;
      }
      parts.push(`${GRAY}usage(${uColor}${uItems.join(', ')}${GRAY})${RESET}`);
    }
  }

  // 6. Model & effort: model(effort)
  let modelName = '';
  let effort = '';
  if (data.model && typeof data.model === 'object') {
    modelName = data.model.display_name || data.model.id || '';
    effort = data.model.effort ?? '';
  } else if (typeof settings.model === 'string' && settings.model) {
    modelName = settings.model;
    const match = modelName.match(/\s+\(([^)]+)\)$/);
    if (match) effort = match[1].toLowerCase();
  }

  if (modelName) {
    if (effort) {
      const escapedEffort = effort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      modelName = modelName.replace(new RegExp(`\\s+\\(${escapedEffort}\\)$`, 'i'), '');
      parts.push(`${MAGENTA}${modelName}${GRAY}(${MAGENTA}${effort}${GRAY})${RESET}`);
    } else {
      parts.push(`${MAGENTA}${modelName}${RESET}`);
    }
  }

  console.log(parts.join('  '));
} catch {
  console.log('agy');
}
