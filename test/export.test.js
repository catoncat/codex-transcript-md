import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendMessageBody,
  default0gHistoryPath,
  exportSessionToMarkdown,
  resolveCurrentRollout,
  formatSessionExport,
  inlineCode,
  loadRolloutFile,
  publishTo0g,
  longestBacktickRun,
} from "../src/index.js";

test("exports visible user and assistant events only", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-transcript-md-"));
  const rolloutPath = path.join(temp, "rollout-2026-05-11T00-00-00-019e14c8-ba55-76e3-a86a-c4d232dedbe0.jsonl");
  await fs.writeFile(
    rolloutPath,
    [
      line("session_meta", { id: "019e14c8-ba55-76e3-a86a-c4d232dedbe0", timestamp: "2026-05-11T00:00:00Z", cwd: "/tmp/project", originator: "Codex Desktop", cli_version: "0.1.0", model_provider: "openai" }),
      line("response_item", { type: "message", role: "developer", content: [{ type: "input_text", text: "hidden instructions" }] }),
      line("event_msg", { type: "user_message", message: "Please summarize this session.", images: null, local_images: [] }),
      line("event_msg", { type: "agent_message", message: "Here is the summary.", phase: "final_answer" }),
      line("response_item", { type: "function_call", name: "shell", arguments: "{}" }),
    ].join("\n") + "\n",
  );

  const outFile = path.join(temp, "session.md");
  const result = await exportSessionToMarkdown({ input: rolloutPath, outFile, exportedAt: "2026-05-11T00:01:00Z" });
  assert.equal(result.messageCount, 2);
  const markdown = await fs.readFile(outFile, "utf8");
  assert.match(markdown, /# Codex Session Export/);
  assert.match(markdown, /- Session ID: `019e14c8-ba55-76e3-a86a-c4d232dedbe0`/);
  assert.match(markdown, /### User\n\nPlease summarize this session\./);
  assert.match(markdown, /### Assistant\n\nHere is the summary\./);
  assert.doesNotMatch(markdown, /hidden instructions/);
  assert.equal(result.outputPath, outFile);
});

test("resolves session id by scanning rollout filenames", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-transcript-md-"));
  const sessionRoot = path.join(temp, "sessions", "2026", "05", "11");
  await fs.mkdir(sessionRoot, { recursive: true });
  const rolloutPath = path.join(sessionRoot, "rollout-2026-05-11T00-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl");
  await fs.writeFile(rolloutPath, `${line("session_meta", { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" })}\n`);

  const result = await exportSessionToMarkdown({
    input: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    sessionRoot: path.join(temp, "sessions"),
    exportsDir: path.join(temp, "exports"),
    exportedAt: "2026-05-11T00:01:00Z",
  });

  assert.equal(result.rolloutPath, rolloutPath);
  assert.equal(result.outputPath, path.join(temp, "exports", "codex-session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md"));
});

test("resolves current rollout by newest mtime", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-transcript-md-"));
  const sessionRoot = path.join(temp, "sessions");
  const older = path.join(sessionRoot, "2026", "05", "10", "rollout-older.jsonl");
  const newer = path.join(sessionRoot, "2026", "05", "11", "rollout-newer.jsonl");
  await fs.mkdir(path.dirname(older), { recursive: true });
  await fs.mkdir(path.dirname(newer), { recursive: true });
  await fs.writeFile(older, `${line("session_meta", { id: "older" })}\n`);
  await fs.writeFile(newer, `${line("session_meta", { id: "newer" })}\n`);
  const oldTime = new Date("2026-05-10T00:00:00Z");
  const newTime = new Date("2026-05-11T00:00:00Z");
  await fs.utimes(older, oldTime, oldTime);
  await fs.utimes(newer, newTime, newTime);

  assert.equal(await resolveCurrentRollout(sessionRoot), newer);
  const result = await exportSessionToMarkdown({ current: true, sessionRoot, exportsDir: path.join(temp, "exports") });
  assert.equal(result.sessionId, "newer");
});

test("supports Rust-style { item } rollout wrapper", async () => {
  const loaded = await loadFromLines([
    JSON.stringify({ timestamp: "2026-05-11T00:00:00Z", item: { type: "session_meta", payload: { id: "id-1" } } }),
    JSON.stringify({ timestamp: "2026-05-11T00:00:01Z", item: { type: "event_msg", payload: { type: "user_message", message: "hello" } } }),
  ]);
  const document = formatSessionExport(loaded.items, { rolloutPath: "/tmp/rollout.jsonl", exportedAt: "2026-05-11T00:01:00Z" });
  assert.equal(document.sessionId, "id-1");
  assert.match(document.markdown, /### User\n\nhello/);
});

test("preserves fenced code as renderable markdown", () => {
  assert.equal(appendMessageBody("Example:\n```js\nconsole.log(1)\n```"), "Example:\n```js\nconsole.log(1)\n```\n");
  assert.equal(longestBacktickRun("````\nbody\n````"), 4);
  assert.equal(appendMessageBody("````\nbody\n````"), "````\nbody\n````\n");
});

test("publishes markdown to 0g.hk and records edit token in local history", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-transcript-md-"));
  const historyPath = path.join(temp, "links.jsonl");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      shortUrl: "https://demo.0g.hk/",
      rawUrl: "https://demo.0g.hk/raw",
      editToken: "secret-token",
      name: "demo",
      expiresAt: "2026-05-18T00:00:00Z",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await publishTo0g("# Hello", {
    name: "demo",
    ttl: "1d",
    fetchImpl,
    historyPath,
    source: "/tmp/session.md",
    title: "demo title",
  });

  assert.equal(result.shortUrl, "https://demo.0g.hk/");
  assert.equal(result.rawUrl, "https://demo.0g.hk/raw");
  assert.equal(calls[0].url, "https://0g.hk/");
  assert.deepEqual(JSON.parse(calls[0].init.body), { content: "# Hello", name: "demo", ttl: "1d" });
  const [row] = (await fs.readFile(historyPath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(row.short_url, "https://demo.0g.hk/");
  assert.equal(row.edit_token, "secret-token");
});

test("rejects 0g.hk content over the service text limit", async () => {
  await assert.rejects(
    publishTo0g("x".repeat(24_577), { fetchImpl: async () => { throw new Error("should not fetch"); }, historyPath: false }),
    /text limit/,
  );
});

test("uses Windows user data dir for default 0g.hk history", () => {
  assert.equal(
    default0gHistoryPath({ LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local" }, "win32", "C:\\Users\\Ada"),
    path.join("C:\\Users\\Ada\\AppData\\Local", "0g-hk", "links.jsonl"),
  );
  assert.equal(
    default0gHistoryPath({ APPDATA: "C:\\Users\\Ada\\AppData\\Roaming" }, "win32", "C:\\Users\\Ada"),
    path.join("C:\\Users\\Ada\\AppData\\Roaming", "0g-hk", "links.jsonl"),
  );
  assert.equal(
    default0gHistoryPath({}, "win32", "C:\\Users\\Ada"),
    path.join("C:\\Users\\Ada", "AppData", "Local", "0g-hk", "links.jsonl"),
  );
});

test("XDG data dir overrides platform-specific 0g.hk history dir", () => {
  assert.equal(
    default0gHistoryPath({ XDG_DATA_HOME: "/tmp/xdg", LOCALAPPDATA: "C:\\Local" }, "win32", "C:\\Users\\Ada"),
    path.join("/tmp/xdg", "0g-hk", "links.jsonl"),
  );
});

test("metadata inline code expands around backticks", () => {
  assert.equal(inlineCode("plain"), "`plain`");
  assert.equal(inlineCode("value `with` ticks"), "`` value `with` ticks ``");
});

function line(type, payload) {
  return JSON.stringify({ timestamp: "2026-05-11T00:00:00Z", type, payload });
}

async function loadFromLines(lines) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-transcript-md-"));
  const file = path.join(temp, "rollout.jsonl");
  await fs.writeFile(file, `${lines.join("\n")}\n`);
  return loadRolloutFile(file);
}
