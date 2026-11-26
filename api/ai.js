// Vercel serverless function using Google's Gemini API.
// The API key stays on the server and is never sent to the browser.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const LIMIT = Number(process.env.HOURLY_LIMIT || 20);
const hits = new Map();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.GEMINI_API_KEY;
  if (!key || !key.trim()) return res.status(500).json({ error: "Gemini is not configured on the server. Check GEMINI_API_KEY in Vercel Production." });

  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if (recent.length >= LIMIT) return res.status(429).json({ error: "Hourly limit reached. Try again later." });
  recent.push(now);
  hits.set(ip, recent);

  const { prompt, images = [] } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000) return res.status(400).json({ error: "Bad request." });
  if (!Array.isArray(images) || images.length > 3) return res.status(400).json({ error: "Too many images." });

  const parts = [];
  for (const d of images) {
    const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(d));
    if (!m || m[2].length > 1500000) return res.status(400).json({ error: "Bad image." });
    parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  parts.push({ text: prompt });

  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(MODEL) + ":generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { maxOutputTokens: 6000 } })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Gemini request failed", r.status, JSON.stringify(j).slice(0, 700));
      if (r.status === 400 || r.status === 404) return res.status(502).json({ error: "Gemini rejected the model or request. Check GEMINI_MODEL in Vercel, or remove it to use the default model." });
      if (r.status === 401 || r.status === 403) return res.status(502).json({ error: "Gemini rejected the API key or its permissions. Check the key in Google AI Studio and Vercel." });
      if (r.status === 429) return res.status(429).json({ error: "Gemini rate limit or quota reached. Wait and try again, or check your Google AI Studio quota." });
      return res.status(502).json({ error: "Gemini could not complete the request (HTTP " + r.status + ")." });
    }
    const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || "").join("\n").trim();
    if (!text) return res.status(502).json({ error: "Gemini returned no answer. Try again." });
    return res.status(200).json({ text });
  } catch (e) {
    console.error("Gemini fetch failed", e && e.message ? e.message : "unknown error");
    return res.status(502).json({ error: "Could not reach the Gemini service." });
  }
};
