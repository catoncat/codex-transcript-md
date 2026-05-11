---
name: export-session
description: Use when the user says /export-session, $export-session, export-session, export current Codex session, save this conversation as Markdown, dump transcript, or asks to export a Codex rollout/session to .md.
---

# Export Session

Export the current or specified Codex conversation to Markdown by calling the `codex-transcript-md` CLI.

## Hard rules

- Do **not** use `cxs`, SQLite indexes, what7, or any secondary session database.
- Read only Codex rollout JSONL files under `$CODEX_HOME/sessions` or `~/.codex/sessions`, unless the user provides another JSONL path.
- Do not paste the exported transcript into chat unless the user explicitly asks; report the output path and message count.
- If the user provides an output path, honor it. Otherwise let the CLI write to `~/.codex/exports/`.

## Command pattern

If the user provides a session id or JSONL path:

```bash
npx -y codex-transcript-md <session-id-or-jsonl-path> -o <out.md>
```

If the user just says `/export-session`, export the current session. Prefer a current rollout path if the runtime exposes one. If not, use the newest rollout JSONL as the local Codex current-session fallback:

```bash
root="${CODEX_HOME:-$HOME/.codex}/sessions"
rollout=$(find "$root" -type f -name 'rollout-*.jsonl' -print0 | xargs -0 ls -t | head -1)
npx -y codex-transcript-md "$rollout"
```

For stdout, only when explicitly requested:

```bash
npx -y codex-transcript-md <session-id-or-jsonl-path> --stdout
```

## Response format

Keep the response short:

```text
已导出：/path/to/codex-session-....md
消息数：N
```

If export fails, show the exact failing command and error summary, then ask for a session id or JSONL path only if automatic current-session detection failed.
