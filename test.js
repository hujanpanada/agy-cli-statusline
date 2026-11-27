const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'statusline.js');
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function runStatusline(payload, { env = {}, configDir } = {}) {
  const tmpDir = configDir || fs.mkdtempSync(path.join(os.tmpdir(), 'agy-sl-'));
  const cleanEnv = { ...process.env, AGY_CONFIG_DIR: tmpDir, AGY_DISABLE_PROC_CHECK: '1', ...env };
  if (!('VIRTUAL_ENV' in env)) delete cleanEnv.VIRTUAL_ENV;
  if (!('CONDA_DEFAULT_ENV' in env)) delete cleanEnv.CONDA_DEFAULT_ENV;

  const out = execFileSync(process.execPath, [SCRIPT], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf-8',
    env: cleanEnv
  }).trim();

  if (!configDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  return stripAnsi(out);
}

test('renders git branch, quota (%w, %fh), context, and model(effort)', () => {
  const out = runStatusline({
    workspace: { current_dir: '/tmp/settle' },
    vcs: { branch: 'main' },
    dangerously_skip_permissions: true,
    context_window: { used_percentage: 7.9 },
    quota: {
      'gemini-weekly': { remaining_fraction: 0.87, reset_in_seconds: 400000 },
      'gemini-5h': { remaining_fraction: 0.85, reset_in_seconds: 15000 }
    },
    model: { display_name: 'Gemini 4 Hydrogen (High)', effort: 'high' }
  });

  assert.equal(
    out,
    [
      'settle(main)  [skip-perm]  [default]',
      '7.9% ctx  usage(87%w, 85%fh)',
      'Gemini 4 Hydrogen(high)'
    ].join('\n')
  );
});

test('reads SetCycleMode and --dangerously-skip-permissions from latest cli log', () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cfg-'));
  const logDir = path.join(cfg, 'log');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(
    path.join(logDir, 'cli-20261127_180000.log'),
    [
      'I1127 18:00:00.000 1 overrides.go:64] --dangerously-skip-permissions: auto-approving',
      'I1127 18:00:05.000 1 manager.go:1796] SetCycleMode called: accept-edits',
      'I1127 18:00:06.000 1 manager.go:1796] SetCycleMode called: plan'
    ].join('\n')
  );

  try {
    const out = runStatusline(
      { workspace: { current_dir: '/tmp/app' }, context_window: { used_percentage: 12.0 } },
      { configDir: cfg }
    );
    assert.equal(out, ['app  [skip-perm]  [plan]', '12.0% ctx'].join('\n'));
  } finally {
    fs.rmSync(cfg, { recursive: true, force: true });
  }
});

test('detects .venv and git branch from disk without subprocesses', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-proj-'));
  fs.mkdirSync(path.join(proj, '.git'));
  fs.writeFileSync(path.join(proj, '.git', 'HEAD'), 'ref: refs/heads/feat/test\n');
  fs.mkdirSync(path.join(proj, '.venv'));

  try {
    const out = runStatusline({
      workspace: { current_dir: proj },
      permission_mode: 'acceptEdits',
      context_window: { used_percentage: 0 }
    });
    assert.equal(out, [`${path.basename(proj)}(feat/test)  [accept-edits]  (.venv)`, '0.0% ctx'].join('\n'));
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('handles malformed stdin gracefully', () => {
  const out = runStatusline('not json');
  assert.ok(out.includes('0.0% ctx'));
});
