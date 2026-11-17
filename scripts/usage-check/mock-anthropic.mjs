/**
 * A stand-in for the Anthropic Messages API, for cost tests that must not
 * spend money. It counts every request it receives and answers conversation
 * and story-beat requests with valid (fake) structured output.
 *
 *   node scripts/usage-check/mock-anthropic.mjs [port]      (default 4555)
 *   GET  /__count   → { total, byKind, log }
 *   POST /__reset   → clears the counts
 * Point the game at it with ANTHROPIC_BASE_URL=http://127.0.0.1:4555 and any
 * non-empty ANTHROPIC_API_KEY. It never forwards anything anywhere.
 */
import http from "node:http";

const port = Number(process.argv[2] || 4555);
let log = [];

function kindOf(body) {
  const sys = Array.isArray(body.system) ? body.system.map((b) => b.text).join("") : String(body.system ?? "");
  if (sys.startsWith("You voice ONE character") && sys.includes("speaker")) return "talk";
  if (sys.startsWith("You write one short story beat")) return "turn";
  if (sys.startsWith("You write ONE short conversation")) return "auto_talk";
  if (sys.includes("photo")) return "photo";
  if (sys.includes("gift")) return "gift_reaction";
  return "other";
}

const TALK = {
  dialogue: "Hm. I'll think about that. (mock)",
  emotion: "neutral",
  reactionIntensity: 0.3,
  movementIntent: "face_target",
  relationshipChanges: { trust: 0, affection: 0, respect: 0, tension: 0 },
  stance: "respond_freely",
  interpretation: { interaction: "small_talk", significance: "ordinary", evidence: "mock" },
  memory: { summary: "", importance: 0, kind: "none", thread: "none", resolves: "" },
  conversationSuggestions: [
    { label: "Ask more", line: "Tell me more?", intent: "curious" },
    { label: "Change topic", line: "Anyway, nice weather.", intent: "playful" },
  ],
  staysInCharacter: true,
};
const VIEW = { interaction: "small_talk", significance: "ordinary", trust: 0, affection: 1, respect: 0, tension: 0, memory: { summary: "", importance: 0, kind: "none", thread: "none" } };
/** One whole autonomous conversation (four alternating lines). */
const AUTO_TALK = {
  turns: [
    { speaker: "a", text: "Got a minute? (mock)", emotion: "happy", intensity: 0.3 },
    { speaker: "b", text: "Sure, what is it? (mock)", emotion: "neutral", intensity: 0.2 },
    { speaker: "a", text: "Nothing much, just saying hello. (mock)", emotion: "neutral", intensity: 0.2 },
    { speaker: "b", text: "Hello to you too. (mock)", emotion: "happy", intensity: 0.2 },
  ],
  endedBy: "b",
  how: "natural",
  topic: "hello (mock)",
  a: VIEW,
  b: VIEW,
  staysInCharacter: true,
};
const TURN = { lines: [{ speaker: "narrator", text: "The wind shifts a little. (mock)" }], memoryNote: "" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__count") {
    const byKind = {};
    for (const e of log) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ total: log.length, byKind, log }));
  }
  if (url.pathname === "/__reset") {
    log = [];
    return res.end("{}");
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {}
    if (req.method === "GET" && url.pathname.startsWith("/v1/models/")) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ id: url.pathname.split("/").pop(), type: "model", capabilities: { image_input: { supported: true } } }));
    }
    const kind = kindOf(body);
    const cached = body.system?.some?.((b) => b.cache_control) ?? false;
    log.push({ at: new Date().toISOString(), kind, model: body.model, max_tokens: body.max_tokens, cacheMarked: cached });
    const out = kind === "talk" ? TALK : kind === "turn" ? TURN : kind === "auto_talk" ? AUTO_TALK : { error: "unsupported in mock" };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: `msg_mock_${log.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: JSON.stringify(out) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 180, cache_creation_input_tokens: log.length === 1 ? 2500 : 0, cache_read_input_tokens: log.length === 1 ? 0 : 2500 },
      }),
    );
  });
});
server.listen(port, "127.0.0.1", () => console.log(`mock anthropic on http://127.0.0.1:${port}`));
