---
name: export-session
description: Use when the user says /export-session, $export-session, export-session, export current Codex session, save this conversation as Markdown, dump transcript, asks to export a Codex rollout/session to .md, or asks to publish/share that export to 0g.hk.
---

# Export Session

Export the current or specified Codex conversation to Markdown by calling `@act0r/codex-transcript-md` through `npx -y`.

## Hard rules

- Do **not** use `cxs`, SQLite indexes, what7, or any secondary session database.
- Read only Codex rollout JSONL files under `$CODEX_HOME/sessions`, `~/.codex/sessions`, or the Windows equivalent `%USERPROFILE%\.codex\sessions`, unless the user provides another JSONL path.
- Do not paste the exported transcript into chat unless the user explicitly asks; report the output path and message count.
- If the user provides an output path, honor it. Otherwise let the CLI write to the default Codex exports dir (`~/.codex/exports/` or `%USERPROFILE%\.codex\exports\` on Windows).
- Do not publish to 0g.hk unless the user explicitly says publish/share/0g.hk/public link.
- 0g.hk is public and temporary. If publishing, use `--publish-0g`; optional `--0g-name <name>` and `--0g-ttl 1h|1d|7d` are allowed.

## Command pattern

If the user provides a session id or JSONL path:

```bash
npx -y @act0r/codex-transcript-md <session-id-or-jsonl-path> -o <out.md>
```

If the user just says `/export-session`, export the current session by letting the CLI pick the newest local Codex rollout JSONL:

```bash
npx -y @act0r/codex-transcript-md --current
```

If the user asks to publish/share to 0g.hk:

```bash
npx -y @act0r/codex-transcript-md --current --publish-0g
```

For a specified session/path plus 0g.hk:

```bash
npx -y @act0r/codex-transcript-md <session-id-or-jsonl-path> --publish-0g
```

For stdout, only when explicitly requested and never with 0g.hk:

```bash
npx -y @act0r/codex-transcript-md <session-id-or-jsonl-path> --stdout
```

## Response format

Keep the response short:

```text
已导出：/path/to/codex-session-....md
消息数：N
如需临时公开链接，可说：/export-session publish

若已发布到 0g.hk，再加：
0g.hk：PUBLIC_URL
Raw：RAW_URL
```

If export fails, show the exact failing command and error summary, then ask for a session id or JSONL path only if automatic current-session detection failed. If 0g.hk publish fails after local export, still report the local output path from the error.
