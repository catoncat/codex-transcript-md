import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DEFAULT_EXPORTS_DIRNAME = "exports";

export async function exportSessionToMarkdown(options) {
  const codexHome = expandHome(options?.codexHome ?? path.join(os.homedir(), ".codex"));
  const sessionRoot = expandHome(options?.sessionRoot ?? path.join(codexHome, "sessions"));
  const exportsDir = expandHome(options?.exportsDir ?? path.join(codexHome, DEFAULT_EXPORTS_DIRNAME));
  const input = options?.current ? await resolveCurrentRollout(sessionRoot) : options?.input;
  if (!input || typeof input !== "string") {
    throw new Error("input is required unless --current is used");
  }

  const rolloutPath = await resolveSessionInput(input, { sessionRoot });
  const loaded = await loadRolloutFile(rolloutPath);
  const exportedAt = options.exportedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const document = formatSessionExport(loaded.items, {
    rolloutPath,
    exportedAt,
    parseErrors: loaded.parseErrors,
  });

  if (options.stdout) {
    return {
      markdown: document.markdown,
      outputPath: null,
      rolloutPath,
      sessionId: document.sessionId,
      messageCount: document.messageCount,
      parseErrors: loaded.parseErrors,
    };
  }

  const outputPath = expandHome(options.outFile ?? path.join(exportsDir, defaultFilename(document.sessionId, rolloutPath)));
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(outputPath, document.markdown, "utf8");
  return {
    markdown: document.markdown,
    outputPath,
    rolloutPath,
    sessionId: document.sessionId,
    messageCount: document.messageCount,
    parseErrors: loaded.parseErrors,
  };
}

export async function resolveCurrentRollout(sessionRoot = path.join(os.homedir(), ".codex", "sessions")) {
  const root = expandHome(sessionRoot);
  await assertReadableDirectory(root);
  let newest = null;
  let newestMtime = -Infinity;
  for await (const filePath of walkRollouts(root)) {
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs > newestMtime) {
      newest = filePath;
      newestMtime = stat.mtimeMs;
    }
  }
  if (!newest) throw new Error(`No rollout JSONL files found under ${root}`);
  return newest;
}

export async function resolveSessionInput(input, options = {}) {
  const candidate = expandHome(input);
  if (looksLikePath(candidate)) {
    const resolved = path.resolve(candidate);
    await assertReadableFile(resolved);
    return resolved;
  }

  const sessionRoot = expandHome(options.sessionRoot ?? path.join(os.homedir(), ".codex", "sessions"));
  return findRolloutBySessionId(input, sessionRoot);
}

export async function loadRolloutFile(rolloutPath) {
  const text = await fs.readFile(rolloutPath, "utf8");
  const items = [];
  let parseErrors = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      const item = normalizeRolloutLine(parsed);
      if (item) items.push(item);
    } catch {
      parseErrors += 1;
    }
  }

  return { items, parseErrors };
}

export function formatSessionExport(items, options = {}) {
  const rolloutPath = options.rolloutPath ?? "<unknown>";
  const exportedAt = options.exportedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const parseErrors = options.parseErrors ?? 0;
  const sessionMeta = firstSessionMeta(items);
  const messages = visibleMessages(items);
  const sessionId = sessionMeta?.id ?? idFromRolloutFilename(String(rolloutPath));

  let markdown = "# Codex Session Export\n\n";
  markdown += "## Metadata\n\n";
  markdown = pushMetadataLine(markdown, "Session ID", sessionId);
  markdown = pushMetadataLine(markdown, "Created At", sessionMeta?.timestamp);
  markdown = pushMetadataLine(markdown, "CWD", sessionMeta?.cwd);
  markdown = pushMetadataLine(markdown, "Originator", sessionMeta?.originator);
  markdown = pushMetadataLine(markdown, "CLI Version", sessionMeta?.cliVersion);
  markdown = pushMetadataLine(markdown, "Model Provider", sessionMeta?.modelProvider);
  markdown = pushMetadataLine(markdown, "Exported At", exportedAt);
  markdown = pushMetadataLine(markdown, "Rollout File", String(rolloutPath));
  markdown = pushMetadataLine(markdown, "Message Count", String(messages.length));
  if (parseErrors > 0) markdown = pushMetadataLine(markdown, "Parse Errors", String(parseErrors));

  markdown += "\n## Conversation\n\n";
  if (messages.length === 0) {
    markdown += "_No visible user or assistant messages were found._\n";
  } else {
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (i > 0) markdown += "\n---\n\n";
      markdown += `### ${message.heading}\n\n`;
      markdown += appendMessageBody(message.body);
    }
  }

  return { markdown, sessionId, messageCount: messages.length };
}

function normalizeRolloutLine(line) {
  if (!line || typeof line !== "object") return null;

  // Current Codex JSONL format: { timestamp, type, payload }.
  if (typeof line.type === "string") {
    return { timestamp: line.timestamp, type: line.type, payload: line.payload };
  }

  // Rust RolloutLine shape used by recent Codex internals: { timestamp, item }.
  if (line.item && typeof line.item === "object") {
    if (typeof line.item.type === "string") {
      return { timestamp: line.timestamp, type: line.item.type, payload: line.item.payload ?? line.item };
    }
    const single = singleKeyObject(line.item);
    if (single) return { timestamp: line.timestamp, type: single.key, payload: single.value };
  }

  return null;
}

function firstSessionMeta(items) {
  for (const item of items) {
    if (item.type !== "session_meta") continue;
    const payload = item.payload?.meta ?? item.payload;
    if (!payload || typeof payload !== "object") return null;
    return {
      id: stringValue(payload.id),
      timestamp: stringValue(payload.timestamp),
      cwd: pathString(payload.cwd),
      originator: stringValue(payload.originator),
      cliVersion: stringValue(payload.cli_version ?? payload.cliVersion),
      modelProvider: stringValue(payload.model_provider ?? payload.modelProvider),
    };
  }
  return null;
}

function visibleMessages(items) {
  const messages = [];
  for (const item of items) {
    if (item.type !== "event_msg") continue;
    const payload = item.payload;
    if (!payload || typeof payload !== "object") continue;

    if (payload.type === "user_message") {
      messages.push({ heading: "User", body: userMessageBody(payload) });
    } else if (payload.type === "agent_message") {
      messages.push({ heading: agentHeading(payload), body: stringValue(payload.message) ?? "" });
    }
  }
  return messages;
}

function userMessageBody(event) {
  let body = stringValue(event.message) ?? "";
  const images = Array.isArray(event.images) ? event.images : [];
  const localImages = Array.isArray(event.local_images ?? event.localImages) ? (event.local_images ?? event.localImages) : [];
  if (images.length === 0 && localImages.length === 0) return body;

  if (body && !body.endsWith("\n")) body += "\n";
  body += "\nAttached images:\n";
  for (const image of images) body += `- ${pathString(image) ?? String(image)}\n`;
  for (const image of localImages) body += `- ${pathString(image) ?? String(image)}\n`;
  return body;
}

function agentHeading(event) {
  const phase = String(event.phase ?? "").toLowerCase();
  if (phase === "commentary") return "Assistant (commentary)";
  return "Assistant";
}

function pushMetadataLine(markdown, label, value) {
  if (value === undefined || value === null || value === "") return markdown;
  return `${markdown}- ${label}: ${inlineCode(String(value))}\n`;
}

export function inlineCode(value) {
  if (!value.includes("`")) return `\`${value}\``;
  const fence = "`".repeat(longestBacktickRun(value) + 1);
  return `${fence} ${value} ${fence}`;
}

export function appendMessageBody(body) {
  if (!body) return "_(empty message)_\n";
  const trimmed = body.replace(/\n+$/u, "");
  // Preserve the assistant/user message as Markdown. Wrapping messages that
  // contain fenced code in a larger `markdown` fence makes Markdown viewers
  // render the whole answer as a code block, which defeats the purpose of an
  // export meant for reading.
  return `${trimmed}\n`;
}

export function longestBacktickRun(value) {
  let longest = 0;
  let current = 0;
  for (const ch of value) {
    if (ch === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

async function findRolloutBySessionId(sessionId, sessionRoot) {
  await assertReadableDirectory(sessionRoot);
  const matches = [];
  const needle = sessionId.toLowerCase();

  for await (const filePath of walkRollouts(sessionRoot)) {
    if (path.basename(filePath).toLowerCase().includes(needle)) {
      matches.push(filePath);
    }
  }

  if (matches.length === 0) {
    throw new Error(`No rollout JSONL found for session id '${sessionId}' under ${sessionRoot}`);
  }
  if (matches.length > 1) {
    throw new Error(`Session id '${sessionId}' matched multiple rollout files:\n${matches.map((m) => `- ${m}`).join("\n")}`);
  }
  return matches[0];
}

async function* walkRollouts(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkRollouts(full);
    } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
      yield full;
    }
  }
}

function defaultFilename(sessionId, rolloutPath) {
  const safe = safeFilename(sessionId ?? idFromRolloutFilename(rolloutPath) ?? path.basename(rolloutPath, ".jsonl"));
  return `codex-session-${safe}.md`;
}

function idFromRolloutFilename(filePath) {
  const base = path.basename(filePath, ".jsonl");
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1] ?? null;
}

function safeFilename(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160) || "unknown";
}

function looksLikePath(value) {
  return value.includes("/") || value.includes("\\") || value.endsWith(".jsonl") || value.startsWith(".") || value.startsWith("~");
}

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

async function assertReadableFile(filePath) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error(`File not found: ${filePath}`);
}

async function assertReadableDirectory(dirPath) {
  const stat = await fs.stat(dirPath).catch(() => null);
  if (!stat || !stat.isDirectory()) throw new Error(`Directory not found: ${dirPath}`);
}

function singleKeyObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  return { key: keys[0], value: value[keys[0]] };
}

function stringValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function pathString(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.display === "string") return value.display;
    if (typeof value.path === "string") return value.path;
    if (typeof value.pathname === "string") return value.pathname;
  }
  return undefined;
}
