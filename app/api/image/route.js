import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/image — توليد صور بترتيب جودة ثابت:
// (أ) نموذج الصور الخاص بمزود لديه مفتاح محفوظ (DALL·E / FLUX عبر OpenAI أو Together أو Hugging Face)
// (ب) راوتر FreeLLMAPI بمفاتيحه الموحدة
// (ج) Pollinations المجاني — بديل واضح الجودة الأقل، ويُذكر ذلك صراحة في الرد.
// طلب صورة لا يردّ عليه بنص أبداً: إما رابط صورة أو خطأ صريح.

const IMAGE_PROVIDERS = [
  { id: 'openai', base: 'https://api.openai.com/v1', model: 'dall-e-3', payload: (prompt, size) => ({ model: 'dall-e-3', prompt, size, n: 1 }) },
  { id: 'together', base: 'https://api.together.xyz/v1', model: 'black-forest-labs/FLUX.1-schnell-Free', payload: (prompt, size) => { const [w, h] = String(size || '1024x1024').split('x').map(Number); return { model: 'black-forest-labs/FLUX.1-schnell-Free', prompt, width: w || 1024, height: h || 1024, steps: 4, n: 1 }; } },
  { id: 'huggingface', base: 'https://router.huggingface.co/v1', model: 'black-forest-labs/FLUX.1-schnell', payload: (prompt, size) => ({ model: 'black-forest-labs/FLUX.1-schnell', prompt, size, n: 1 }) }
];

const POLL_NOTE = 'بديل مجاني — جودة أقل. لصور بجودة أعلى أضف مفتاح OpenAI أو Together أو Hugging Face، أو مفتاح FreeLLMAPI موحداً.';

function pollinationsUrl(prompt, size) {
  const [w, h] = String(size || '1024x1024').split('x').map((n) => parseInt(n, 10) || 1024);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${Date.now() % 100000}&nologo=true`;
}

function extractUrl(data) {
  const d = data?.data?.[0];
  if (!d) return null;
  if (d.url) return d.url;
  if (d.b64_json) return 'data:image/png;base64,' + d.b64_json;
  return null;
}

async function tryImagesGenerations(base, key, payload) {
  const r = await fetch(base.replace(/\/$/, '') + '/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  const url = extractUrl(data);
  if (!url) throw new Error('no image url');
  return url;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح.' }, { status: 400 }); }
  const { prompt, apiKeys = {}, flKeys = [], flUrl, size = '1024x1024' } = body;
  if (!prompt || !String(prompt).trim()) return NextResponse.json({ error: 'اكتب وصفاً للصورة أولاً.' }, { status: 400 });
  const clean = String(prompt).trim();

  // (أ) مزود صور خاص بمفتاح محفوظ — كل مفاتيح المزود تُجرَّب بالترتيب
  for (const p of IMAGE_PROVIDERS) {
    const keys = (apiKeys[p.id] || []).map((k) => (typeof k === 'string' ? k : k?.value)).filter(Boolean);
    for (const key of keys) {
      try {
        const url = await tryImagesGenerations(p.base, key, p.payload(clean, size));
        return NextResponse.json({ url, via: p.id, free: false });
      } catch { continue; }
    }
  }

  // (ب) راوتر FreeLLMAPI بمفاتيحه الموحدة — كل مفتاح يُجرَّب بالترتيب
  const flBase = String(flUrl || '').replace(/\/$/, '');
  const flKeyList = (flKeys || []).map((k) => (typeof k === 'string' ? k : k?.value)).filter(Boolean);
  if (flBase && flKeyList.length) {
    for (const key of flKeyList) {
      try {
        const url = await tryImagesGenerations(flBase, key, { model: 'black-forest-labs/FLUX.1-schnell', prompt: clean, size, n: 1 });
        return NextResponse.json({ url, via: 'freellmapi', free: false });
      } catch { continue; }
    }
  }

  // (ج) بديل مجاني واضح — Pollinations فقط كملاذ أخير
  return NextResponse.json({ url: pollinationsUrl(clean, size), via: 'pollinations', free: true, note: POLL_NOTE });
}
