// Cloudflare Worker: hides the Gemini API key and only answers your GitHub Pages site.
// Settings needed: secret GEMINI_API_KEY, variable ALLOWED_ORIGIN, optional GEMINI_MODEL.

const TAG_PROMPT = `Identify the single clothing item in this photo. Reply with JSON only:
{"name": short plain name like "Black wool turtleneck", "category": one of top|bottom|dress|outerwear|shoes|accessory, "colors": up to 3 hex codes like "#1f2d4d" for the main colors of the item itself (ignore background and shadows), most dominant first, "color": short color name like "navy and cream", "pattern": one of solid|striped|plaid|floral|graphic|other, "tags": 2 to 4 from casual,dressy,cozy,sporty,work,evening,summer,winter,layering}`;

const outfitPrompt = (items, style) => `You are a warm, practical personal stylist. Build 3 different outfits from ONLY the items below.
Rules: use either one dress, or one top plus one bottom; add shoes if any exist; add outerwear or an accessory only when it helps. Never invent items, and use each item's exact id. Items list hex colors (most dominant first) and a pattern. Pair patterned pieces with solids that match one of their colors, and avoid clashing colors.
Style request for today: ${style ? JSON.stringify(String(style).slice(0, 200)) : '"anything that looks good"'}
Items: ${JSON.stringify(items)}
Reply with JSON only: {"outfits":[{"title": short catchy name, "ids": [item ids], "note": one friendly sentence on why it works}]}`;

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    const out = (body, status = 200) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST' || req.headers.get('Origin') !== env.ALLOWED_ORIGIN) return out('Forbidden', 403);

    let body;
    try { body = await req.json(); } catch { return out('Bad request', 400); }

    const path = new URL(req.url).pathname;
    let parts;
    if (path === '/tag') {
      if (typeof body.image !== 'string' || body.image.length > 1_500_000) return out('Bad image', 413);
      parts = [{ text: TAG_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: body.image } }];
    } else if (path === '/outfits') {
      if (!Array.isArray(body.items) || body.items.length > 300) return out('Bad items', 400);
      parts = [{ text: outfitPrompt(body.items, body.style) }];
    } else {
      return out('Not found', 404);
    }

    const model = env.GEMINI_MODEL || 'gemini-flash-latest';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
      }),
    });
    if (!res.ok) return out({ error: 'Gemini error', status: res.status, detail: (await res.text()).slice(0, 300) }, 502);

    try {
      const data = await res.json();
      return out(JSON.parse(data.candidates[0].content.parts[0].text));
    } catch {
      return out({ error: 'Unreadable model reply' }, 502);
    }
  },
};
