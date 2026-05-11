# codex-transcript-md

Export OpenAI Codex rollout JSONL sessions to clean Markdown transcripts.

This package is intentionally small and standalone: it reads Codex's original
`~/.codex/sessions/**/rollout-*.jsonl` files directly. It does not depend on any
external session index, database, or local web app.

## Usage

```bash
npx @act0r/codex-transcript-md --current
npx @act0r/codex-transcript-md --current --publish-0g
npx @act0r/codex-transcript-md <session-id> -o session.md
npx @act0r/codex-transcript-md ~/.codex/sessions/2026/05/11/rollout-....jsonl -o session.md
npx @act0r/codex-transcript-md <session-id> --stdout
```

If `-o/--out` and `--stdout` are omitted, the file is written to:

```text
~/.codex/exports/codex-session-<session-id>.md
```

## What gets exported

The exporter follows Codex's user-visible rollout events:

- `event_msg:user_message`
- `event_msg:agent_message`

It skips model context, developer/system instructions, reasoning, tool calls,
tool outputs, token counters, and other internal events. That makes the Markdown
safe to hand back to an LLM for review without dragging along hidden runtime
context.

## Options

```text
Usage: codex-transcript-md <session-id-or-jsonl-path> [options]
       codex-transcript-md --current [options]

Options:
  -o, --out <file>           write Markdown to this path
  --stdout                   print Markdown to stdout
  --current                  export the newest local Codex rollout JSONL
  --publish-0g               publish the Markdown to 0g.hk after exporting
  --0g-name <name>           optional 0g.hk semantic short name
  --0g-ttl <ttl>             0g.hk TTL: 1h, 1d, or 7d (default: 7d)
  --codex-home <dir>         Codex home directory (default: ~/.codex)
  --session-root <dir>       session root to search (default: <codex-home>/sessions)
  --exports-dir <dir>        default output directory (default: <codex-home>/exports)
  -h, --help                 show help
  -v, --version              show version
```


## 0g.hk temporary public link

Publishing is explicit because 0g.hk pages are public temporary notes. Use:

```bash
npx @act0r/codex-transcript-md --current --publish-0g
npx @act0r/codex-transcript-md <session-id> --publish-0g --0g-name my-session --0g-ttl 1d
```

The CLI posts the Markdown body to `https://0g.hk/`, prints the public and raw
URLs, and stores the edit token in `${XDG_DATA_HOME:-~/.local/share}/0g-hk/links.jsonl`
with file mode `600`. It never prints the edit token. 0g.hk accepts text notes up
to 24,576 bytes; larger exports stay local.

## Codex skill

This package also ships an agent skill at `skills/export-session`. Install the skill with:

```bash
npx skills add @act0r/codex-transcript-md -g --skill export-session -y --full-depth
```

After restarting your agent session, you can ask in chat:

```text
/export-session
/export-session publish
/export-session -o ~/Desktop/session.md
```

The skill calls `npx -y @act0r/codex-transcript-md`, so users do not need a global install. It still reads only Codex rollout JSONL files; it does not use cxs or what7. When the user asks to publish/share, it adds `--publish-0g` and uses 0g.hk.

## Programmatic API

```js
import { exportSessionToMarkdown } from "@act0r/codex-transcript-md";

const result = await exportSessionToMarkdown({
  input: "019e14c8-ba55-76e3-a86a-c4d232dedbe0",
  outFile: "session.md",
});

console.log(result.messageCount, result.outputPath);
```
