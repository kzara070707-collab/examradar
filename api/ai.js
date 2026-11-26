//// Vercel serverless function using Google's Gemini API (free tier available).
// Your key stays here on the server and is never sent to the browser.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const LIMIT = Number(process.env.HOURLY_LIMIT || 20); // calls per visitor per hour
const hits = new Map(); // basic brake only: resets when the server restarts

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is not set up yet." });

  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if (recent.length >= LIMIT) return res.status(429).json({ error: "Hourly limit reached. Try again later." });
  recent.push(now);
  hits.set(ip, recent);

  const { prompt, images = [] } = req.body || {};
  if (typeof prompt !== "string" || !prompt || prompt.length > 20000)
    return res.status(400).json({ error: "Bad request." });
  if (!Array.isArray(images) || images.length > 3)
    return res.status(400).json({ error: "Too many images." });

  const parts = [];
  for (const d of images) {
    const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(d));
    if (!m || m[2].length > 1500000) return res.status(400).json({ error: "Bad image." });
    parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  parts.push({ text: prompt });

  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(MODEL) + ":generateContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { maxOutputTokens: 6000 } })
      }
    );
    const j = await r.json();
    if (!r.ok) {
      console.error("Gemini error", r.status, JSON.stringify(j).slice(0, 500)); // visible in Vercel logs
      if (r.status === 429) return res.status(429).json({ error: "The free AI is busy. Wait a minute and try again." });
      return res.status(502).json({ error: "The AI service refused the request (" + r.status + ")." });
    }
    const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [])
      .map(p => p.text || "").join("\n").trim();
    if (!text) return res.status(502).json({ error: "The AI returned no answer. Try again." });
    return res.status(200).json({ text });
  } catch (e) {
    console.error("Gemini fetch failed", e);
    return res.status(502).json({ error: "Could not reach the AI service." });
  }
}; Vercel serverless function: the only place that knows your API key.
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const LIMIT = Number(process.env.HOURLY_LIMIT || 30); // calls per visitor per hour
const hits = new Map(); // best-effort only: resets when the server restarts

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is not set up yet." });

  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if (recent.length >= LIMIT) return res.status(429).json({ error: "Hourly limit reached. Try again later." });
  recent.push(now);
  hits.set(ip, recent);

  const { prompt, images = [] } = req.body || {};
  if (typeof prompt !== "string" || !prompt || prompt.length > 20000)
    return res.status(400).json({ error: "Bad request." });
  if (!Array.isArray(images) || images.length > 3)
    return res.status(400).json({ error: "Too many images." });

  const content = [];
  for (const d of images) {
    const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(d));
    if (!m || m[2].length > 1500000) return res.status(400).json({ error: "Bad image." });
    content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  content.push({ type: "text", text: prompt });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: "The AI service refused the request." });
    const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the AI service." });
  }
};
