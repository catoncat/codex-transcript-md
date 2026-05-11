#!/usr/bin/env node
import process from "node:process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { exportSessionToMarkdown } from "../src/index.js";

const USAGE = `Usage: codex-transcript-md <session-id-or-jsonl-path> [options]
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
  -v, --version              show version`;

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.version) {
    console.log(await packageVersion());
    return;
  }
  if (!args.input && !args.current) throw new Error(`Missing session id or JSONL path. Use --current to export the newest local session.\n\n${USAGE}`);
  if (args.input && args.current) throw new Error("Use either an explicit input or --current, not both.");
  if (args.stdout && args.outFile) throw new Error("Use either --stdout or --out, not both.");
  if (args.stdout && args.publish0g) throw new Error("Use either --stdout or --publish-0g, not both.");

  const result = await exportSessionToMarkdown(args);
  if (args.stdout) {
    process.stdout.write(result.markdown);
    return;
  }

  console.error(`Exported ${result.messageCount} messages to ${result.outputPath}`);
  if (result.zeroG) {
    console.error(`Published to 0g.hk: ${result.zeroG.shortUrl}`);
    if (result.zeroG.rawUrl) console.error(`Raw: ${result.zeroG.rawUrl}`);
  }
  if (result.parseErrors > 0) console.error(`Warning: skipped ${result.parseErrors} malformed JSONL line(s).`);
}

function parseArgs(argv) {
  const out = { stdout: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") out.help = true;
    else if (arg === "-v" || arg === "--version") out.version = true;
    else if (arg === "--stdout") out.stdout = true;
    else if (arg === "--current") out.current = true;
    else if (arg === "--publish-0g") out.publish0g = true;
    else if (arg === "-o" || arg === "--out") out.outFile = takeValue(argv, ++i, arg);
    else if (arg === "--codex-home") out.codexHome = takeValue(argv, ++i, arg);
    else if (arg === "--session-root") out.sessionRoot = takeValue(argv, ++i, arg);
    else if (arg === "--exports-dir") out.exportsDir = takeValue(argv, ++i, arg);
    else if (arg === "--0g-name") out.ogName = takeValue(argv, ++i, arg);
    else if (arg === "--0g-ttl") out.ogTtl = takeValue(argv, ++i, arg);
    else if (arg.startsWith("--out=")) out.outFile = arg.slice("--out=".length);
    else if (arg.startsWith("--codex-home=")) out.codexHome = arg.slice("--codex-home=".length);
    else if (arg.startsWith("--session-root=")) out.sessionRoot = arg.slice("--session-root=".length);
    else if (arg.startsWith("--exports-dir=")) out.exportsDir = arg.slice("--exports-dir=".length);
    else if (arg.startsWith("--0g-name=")) out.ogName = arg.slice("--0g-name=".length);
    else if (arg.startsWith("--0g-ttl=")) out.ogTtl = arg.slice("--0g-ttl=".length);
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else rest.push(arg);
  }
  if (rest.length > 1) throw new Error(`Expected one input, got ${rest.length}: ${rest.join(" ")}`);
  out.input = rest[0];
  return out;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function packageVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(await readFile(path.join(here, "..", "package.json"), "utf8"));
  return packageJson.version;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`codex-transcript-md: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
