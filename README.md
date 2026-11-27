# agy-statusline

Cross-platform custom status line for Google Antigravity CLI (`agy`) using Node.js with zero external dependencies.

```text
settle(main)  [skip-perm]  [default]  (.venv)  7.9% ctx  usage(87%w, 85%fh)  Gemini 4 Hydrogen(high)
```

## Segments

- **`dir(branch)`** — Current workspace folder and active Git branch (resolved from payload or by reading `.git/HEAD` directly with zero child process spawns).
- **`[skip-perm]`** — Shown when running with `--dangerously-skip-permissions` or `toolPermission: "always-proceed"`.
- **`[default]` / `[accept-edits]` / `[auto]` / `[plan]`** — Active agent mode (from latest `SetCycleMode` log entry, payload, or `settings.json`).
- **`(.venv)`** — Active Python virtualenv (`VIRTUAL_ENV`, `CONDA_DEFAULT_ENV`, `.venv`, or `venv`).
- **`ctx`** — Context window usage percentage (white, yellow at >=60%, red at >=90%).
- **`usage(w, fh)`** — Minimum remaining quota across weekly (`%w`) and 5-hour (`%fh`) buckets (green, yellow <50%, red <20%).
- **`Model(effort)`** — Active model name and reasoning effort.

## Install

Requires Node.js.

### Linux / macOS

```bash
cp statusline.js ~/.gemini/antigravity-cli/statusline.js
chmod +x ~/.gemini/antigravity-cli/statusline.js
```

In `~/.gemini/antigravity-cli/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.gemini/antigravity-cli/statusline.js",
    "enabled": true,
    "stack_with_default": false
  }
}
```

### Windows

Copy `statusline.js` to `%USERPROFILE%\.gemini\antigravity-cli\statusline.js`, then in `%USERPROFILE%\.gemini\antigravity-cli\settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Users/<you>/.gemini/antigravity-cli/statusline.js",
    "enabled": true,
    "stack_with_default": false
  }
}
```

## Test

```bash
node --test test.js
```
