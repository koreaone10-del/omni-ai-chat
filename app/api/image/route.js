import { NextResponse } from 'next/server';
import { Client } from '@gradio/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel Hobby يحدّ وظائف الخادم بـ 60 ثانية كحد أقصى — كل المحاولات معاً تبقى تحت هذا السقف.
export const maxDuration = 60;

// POST /api/image — توليد صور بلا أي بديل مجاني عشوائي:
// (أ) نموذج الصور الخاص بمزود لديه مفتاح محفوظ (DALL·E / FLUX عبر OpenAI أو Together أو Hugging Face)
// (أ2) Nano Banana من Google — gemini-3.1-flash-image (Nano Banana 2)،
//      gemini-nano-banana-2.1 (Nano Banana 2.1 — الأحدث الموصى به)،
//      gemini-3-pro-image (Nano Banana Pro) — عبر generateContent الرسمي:
//      POST /v1beta/models/{model}:generateContent مع x-goog-api-key و
//      generationConfig {responseModalities: ['TEXT','IMAGE']}، والصورة في
//      candidates[0].content.parts[].inlineData.data (base64).
//      المصدر: https://ai.google.dev/gemini-api/docs/image-generation
//      (المسار الأحدث Interactions API موجود في الوثائق نفسها، لكن generateContent
//      هو المسار المستقر الموثق للـ REST — يحتاج مفتاح Gemini للتأكيد الحي.)
// (ب) راوتر FreeLLMAPI بمفاتيحه الموحدة — يعمل فقط إن أُضيف في لوحة الراوتر مفتاح مزود يقدّم نماذج صور
//     (مفتاح Groq وحده لا يكفي: Groq نص فقط، والراوتر يردّ 404 على نموذج صور غير موجود في كتالوجه)
// (ب2) Cloudflare Workers AI — FLUX.1-schnell مجاني (10,000 neuron/يوم، ~57 صورة 1024×1024/يوم)
//      يحتاج CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN في Vercel (حساب مجاني، بلا بطاقة)
// (ج) مساحة Hugging Face مفتوحة المصدر black-forest-labs/FLUX.1-schnell بدون مفتاح (Gradio)
// الوصف غير الإنجليزي يُترجم إلى الإنجليزية أولاً (best-effort) لأن نماذج الصور مدرّبة على الإنجليزية.
// طلب صورة لا يردّ عليه بنص أبداً، ولا بصورة من مسار آخر: إما رابط صورة من المسار المسمّى في via،
// أو خطأ صريح يسمّي كل مسار جُرّب وسبب فشله.
// معامل preferred: 'auto' (الترتيب أعلاه) أو نموذج محدد — عند اختيار نموذج محدد
// من لوحة أدوات المزود يُجرَّب ذلك المسار وحده، وإن غاب مفتاحه يرجع خطأ صريحاً
// باسم المفتاح المطلوب بدل التبديل الصامت لمسار آخر.

const IMAGE_PROVIDERS = [
  { id: 'openai', label: 'DALL·E 3 (OpenAI)', base: 'https://api.openai.com/v1', model: 'dall-e-3', payload: (prompt, size) => ({ model: 'dall-e-3', prompt, size, n: 1 }) },
  { id: 'together', label: 'FLUX (Together)', base: 'https://api.together.xyz/v1', model: 'black-forest-labs/FLUX.1-schnell-Free', payload: (prompt, size) => { const [w, h] = String(size || '1024x1024').split('x').map(Number); return { model: 'black-forest-labs/FLUX.1-schnell-Free', prompt, width: w || 1024, height: h || 1024, steps: 4, n: 1 }; } },
  { id: 'huggingface', label: 'FLUX (Hugging Face)', base: 'https://router.huggingface.co/v1', model: 'black-forest-labs/FLUX.1-schnell', payload: (prompt, size) => ({ model: 'black-forest-labs/FLUX.1-schnell', prompt, size, n: 1 }) }
];

// Nano Banana — نماذج صور Google (مفتاح Gemini من Google AI Studio).
const NANO_BANANA = {
  'nanobanana': { model: 'gemini-3.1-flash-image', label: 'Nano Banana 2 (gemini-3.1-flash-image)' },
  'nanobanana-2.1': { model: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1 (gemini-nano-banana-2.1)' },
  'nanobanana-pro': { model: 'gemini-3-pro-image', label: 'Nano Banana Pro (gemini-3-pro-image)' }
};
const GEMINI_NATIVE = 'https://generativelanguage.googleapis.com/v1beta';

async function tryNanoBanana(model, key, prompt, ms) {
  const r = await fetch(GEMINI_NATIVE + '/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
    }),
    signal: AbortSignal.timeout(ms)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error('HTTP ' + r.status + (txt ? ': ' + txt.slice(0, 160) : ''));
  }
  const data = await r.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return 'data:' + (part.inlineData.mimeType || 'image/png') + ';base64,' + part.inlineData.data;
    }
  }
  const text = parts.map((p) => p?.text || '').join(' ').trim();
  throw new Error(text ? 'النموذج ردّ بنص دون صورة: ' + text.slice(0, 120) : 'no image in response');
}

const HF_SPACE = 'black-forest-labs/FLUX.1-schnell';
const HF_ORIGIN = 'https://black-forest-labs-flux-1-schnell.hf.space';

// (ب2) Cloudflare Workers AI — FLUX.1-schnell مجاني (10,000 neuron/يوم، بلا بطاقة).
// يحتاج متغيري بيئة في Vercel: CLOUDFLARE_ACCOUNT_ID و CLOUDFLARE_API_TOKEN
// (حساب Cloudflare مجاني + توكن بقالب Workers AI Edit) — بلا هذين المتغيرين يُتخطى المسار بصمت.
// المصدر: https://developers.cloudflare.com/workers-ai/platform/pricing/
// (بحث 2026-11-22 — انظر research/free-media-apis-2026-11-22.md)
async function tryCloudflareImage(prompt, ms) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) return null;
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + accountId + '/ai/run/@cf/black-forest-labs/flux-1-schnell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ prompt, steps: 4 }),
    signal: AbortSignal.timeout(ms)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error('HTTP ' + r.status + (txt ? ': ' + txt.slice(0, 120) : ''));
  }
  const data = await r.json();
  const b64 = data?.result?.image;
  if (!b64) throw new Error('no image in response');
  return 'data:image/jpeg;base64,' + b64;
}
const NON_ENGLISH = /[^\x00-\x7F]/;

function extractUrl(data) {
  const d = data?.data?.[0];
  if (!d) return null;
  if (d.url) return d.url;
  if (d.b64_json) return 'data:image/png;base64,' + d.b64_json;
  return null;
}

async function tryImagesGenerations(base, key, payload, ms) {
  const r = await fetch(base.replace(/\/$/, '') + '/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ms)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  const url = extractUrl(data);
  if (!url) throw new Error('no image url');
  return url;
}

// ترجمة الوصف إلى الإنجليزية عبر الراوتر أولاً، ثم Groq مباشرة — best-effort، لا يوقف التوليد أبداً.
async function translatePrompt(prompt, { flKeys, flUrl, apiKeys, timeLeft }) {
  if (!NON_ENGLISH.test(prompt)) return { text: prompt, translated: false };
  const sys = 'Translate the following image prompt into English. Output ONLY the English translation as one short image-prompt sentence. No quotes, no explanation.';
  const attempts = [];
  const flBase = String(flUrl || '').replace(/\/$/, '');
  for (const k of (flKeys || [])) attempts.push({ base: flBase, key: k, model: 'auto', label: 'router' });
  for (const k of ((apiKeys.groq || []).map((x) => (typeof x === 'string' ? x : x?.value)).filter(Boolean))) {
    attempts.push({ base: 'https://api.groq.com/openai/v1', key: k, model: 'openai/gpt-oss-120b', label: 'groq' });
  }
  for (const a of attempts) {
    if (!a.base || !a.key) continue;
    const ms = Math.min(15000, timeLeft());
    if (ms <= 2000) break;
    try {
      const r = await fetch(a.base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.key },
        body: JSON.stringify({ model: a.model, messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }], max_tokens: 120, temperature: 0.2 }),
        signal: AbortSignal.timeout(ms)
      });
      if (!r.ok) continue;
      const d = await r.json();
      const t = String(d?.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
      if (t && t.length < 500 && t !== prompt) return { text: t, translated: true };
    } catch { continue; }
  }
  return { text: prompt, translated: false };
}

// ترجمة رسائل خطأ المساحة إلى عربية واضحة.
function mapSpaceError(e) {
  const m = String(e?.message || e);
  if (/ZeroGPU/i.test(m)) return 'استُنفدت الحصة المجانية اليومية للمساحة (ZeroGPU) — أعد المحاولة غداً، أو أضف مفتاح Hugging Face مجانياً من مدير المفاتيح';
  if (/timeout/i.test(m)) return 'انتهت المهلة أثناء الانتظار في الطابور — المساحة مشغولة أو نائمة، أعد المحاولة بعد قليل';
  if (/Connection errored/i.test(m)) return 'تعذّر الاتصال بالمساحة — أعد المحاولة بعد قليل';
  return m;
}

// مساحة FLUX.1-schnell المجانية بدون مفتاح عبر عميل Gradio الرسمي.
async function tryHuggingFaceSpace(prompt, size, ms) {
  const [w0, h0] = String(size || '1024x1024').split('x').map((n) => parseInt(n, 10) || 1024);
  const w = Math.min(2048, Math.max(256, w0));
  const h = Math.min(2048, Math.max(256, h0));
  const run = (async () => {
    const client = await Client.connect(HF_SPACE);
    const result = await client.predict('/infer', {
      prompt,
      seed: Math.floor(Math.random() * 2147483647),
      randomize_seed: false,
      width: w,
      height: h,
      num_inference_steps: 4
    });
    const file = result?.data?.[0];
    if (!file) throw new Error('no image returned');
    if (file.url && String(file.url).startsWith('http')) return file.url;
    if (file.path) return HF_ORIGIN + '/gradio_api/file=' + String(file.path);
    throw new Error('no image url');
  })();
  return Promise.race([
    run,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout — المساحة مشغولة أو نائمة')), ms))
  ]);
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح.' }, { status: 400 }); }
  const { prompt, apiKeys = {}, flKeys = [], flUrl, size = '1024x1024', preferred = 'auto' } = body;
  if (!prompt || !String(prompt).trim()) return NextResponse.json({ error: 'اكتب وصفاً للصورة أولاً.' }, { status: 400 });
  const clean = String(prompt).trim();

  const deadline = Date.now() + 55000;
  const timeLeft = () => deadline - Date.now();
  const failures = [];
  const keyList = (arr) => (arr || []).map((k) => (typeof k === 'string' ? k : k?.value)).filter(Boolean);

  // 0) ترجمة الوصف غير الإنجليزي أولاً (لا توقف التوليد إن فشلت)
  const tr = await translatePrompt(clean, { flKeys: keyList(flKeys), flUrl, apiKeys, timeLeft });
  const usePrompt = tr.text;
  const note = tr.translated ? 'الوصف بعد الترجمة إلى الإنجليزية: ' + tr.text : null;

  // نموذج محدد اختاره المستخدم من لوحة أدوات المزود — يُجرَّب وحده، بلا تبديل صامت.
  if (preferred && preferred !== 'auto') {
    if (NANO_BANANA[preferred]) {
      const nb = NANO_BANANA[preferred];
      const keys = keyList(apiKeys.gemini);
      if (!keys.length) {
        return NextResponse.json({ error: nb.label + ' يحتاج مفتاح Google AI Studio (مجاني) — أضفه من مدير المفاتيح تحت اسم «Google Gemini» (aistudio.google.com/apikey)، ثم أعد المحاولة.' }, { status: 402 });
      }
      for (const key of keys) {
        if (timeLeft() <= 3000) break;
        try {
          const url = await tryNanoBanana(nb.model, key, usePrompt, Math.min(30000, timeLeft()));
          return NextResponse.json({ url, via: 'gemini', model: nb.model, free: false, note, translatedPrompt: tr.translated ? tr.text : null });
        } catch (e) { failures.push(nb.label + ': ' + String(e.message || e)); }
      }
      return NextResponse.json({ error: 'تعذّر توليد الصورة عبر ' + nb.label + ':\n' + failures.map((f) => '• ' + f).join('\n') + '\n\nتحقق من مفتاح Gemini في مدير المفاتيح (قد يكون مستنفداً) أو جرّب نموذجاً آخر.' }, { status: 502 });
    }
    if (preferred === 'dalle') {
      const keys = keyList(apiKeys.openai);
      if (!keys.length) return NextResponse.json({ error: 'DALL·E 3 يحتاج مفتاح OpenAI — أضفه من مدير المفاتيح، ثم أعد المحاولة.' }, { status: 402 });
      for (const key of keys) {
        if (timeLeft() <= 3000) break;
        try {
          const url = await tryImagesGenerations('https://api.openai.com/v1', key, { model: 'dall-e-3', prompt: usePrompt, size, n: 1 }, Math.min(20000, timeLeft()));
          return NextResponse.json({ url, via: 'openai', model: 'dall-e-3', free: false, note, translatedPrompt: tr.translated ? tr.text : null });
        } catch (e) { failures.push('DALL·E 3: ' + String(e.message || e)); }
      }
      return NextResponse.json({ error: 'تعذّر توليد الصورة عبر DALL·E 3:\n' + failures.map((f) => '• ' + f).join('\n') }, { status: 502 });
    }
    if (preferred === 'flux') {
      const tried = [];
      for (const p of IMAGE_PROVIDERS.filter((x) => x.id !== 'openai')) {
        for (const key of keyList(apiKeys[p.id])) {
          if (timeLeft() <= 3000) break;
          try {
            const url = await tryImagesGenerations(p.base, key, p.payload(usePrompt, size), Math.min(20000, timeLeft()));
            return NextResponse.json({ url, via: p.id, model: p.model, free: false, note, translatedPrompt: tr.translated ? tr.text : null });
          } catch (e) { tried.push(p.label + ': ' + String(e.message || e)); }
        }
      }
      return NextResponse.json({ error: 'FLUX يحتاج مفتاح Together أو Hugging Face — أضفه من مدير المفاتيح، ثم أعد المحاولة.' + (tried.length ? '\n' + tried.map((f) => '• ' + f).join('\n') : '') }, { status: 402 });
    }
    // preferred غير معروف → تجاهله والمتابعة بالترتيب التلقائي.
  }

  // (أ) مزود صور خاص بمفتاح محفوظ — كل مفاتيح المزود تُجرَّب بالترتيب
  for (const p of IMAGE_PROVIDERS) {
    const keys = keyList(apiKeys[p.id]);
    if (!keys.length) { failures.push(p.label + ': لا يوجد مفتاح محفوظ'); continue; }
    for (const key of keys) {
      if (timeLeft() <= 3000) break;
      try {
        const url = await tryImagesGenerations(p.base, key, p.payload(usePrompt, size), Math.min(20000, timeLeft()));
        return NextResponse.json({ url, via: p.id, free: false, note, translatedPrompt: tr.translated ? tr.text : null });
      } catch (e) { failures.push(p.label + ': ' + String(e.message || e)); }
    }
  }

  // (أ2) Nano Banana 2.1 من Google — بمفاتيح Gemini المحفوظة (الأحدث الموصى به)
  {
    const nb = NANO_BANANA['nanobanana-2.1'];
    const keys = keyList(apiKeys.gemini);
    if (!keys.length) { failures.push(nb.label + ': لا يوجد مفتاح Gemini محفوظ'); }
    else {
      for (const key of keys) {
        if (timeLeft() <= 3000) break;
        try {
          const url = await tryNanoBanana(nb.model, key, usePrompt, Math.min(30000, timeLeft()));
          return NextResponse.json({ url, via: 'gemini', model: nb.model, free: false, note, translatedPrompt: tr.translated ? tr.text : null });
        } catch (e) { failures.push(nb.label + ': ' + String(e.message || e)); }
      }
    }
  }

  // (ب) راوتر FreeLLMAPI بمفاتيحه الموحدة — كل مفتاح يُجرَّب بالترتيب
  const flBase = String(flUrl || '').replace(/\/$/, '');
  const flKeyList = keyList(flKeys);
  if (!flBase || !flKeyList.length) {
    failures.push('FreeLLMAPI Router: لا يوجد مفتاح موحد محفوظ');
  } else {
    for (const key of flKeyList) {
      if (timeLeft() <= 3000) break;
      try {
        const url = await tryImagesGenerations(flBase, key, { model: 'black-forest-labs/FLUX.1-schnell', prompt: usePrompt, size, n: 1 }, Math.min(20000, timeLeft()));
        return NextResponse.json({ url, via: 'freellmapi', free: false, note, translatedPrompt: tr.translated ? tr.text : null });
      } catch (e) { failures.push('FreeLLMAPI Router: ' + String(e.message || e) + ' — الراوتر يخدم نماذج الصور فقط إن أُضيف في لوحته مفتاح مزود يقدّمها (Groq نص فقط ولا يكفي)'); }
    }
  }

  // (ب2) Cloudflare Workers AI — FLUX.1-schnell مجاني (إن ضُبطت مفاتيحه في Vercel)
  if (timeLeft() > 5000) {
    try {
      const url = await tryCloudflareImage(usePrompt, Math.min(30000, timeLeft()));
      if (url) return NextResponse.json({ url, via: 'cloudflare', free: true, note, translatedPrompt: tr.translated ? tr.text : null });
      failures.push('Cloudflare Workers AI (مجاني): غير مضبوط — أضف CLOUDFLARE_ACCOUNT_ID و CLOUDFLARE_API_TOKEN في Vercel (حساب Cloudflare مجاني، بلا بطاقة)');
    } catch (e) {
      failures.push('Cloudflare Workers AI (مجاني): ' + String(e.message || e).slice(0, 120));
    }
  }

  // (ج) مساحة FLUX.1-schnell المجانية مفتوحة المصدر — بدون مفتاح
  if (timeLeft() > 5000) {
    try {
      const url = await tryHuggingFaceSpace(usePrompt, size, Math.min(50000, timeLeft()));
      return NextResponse.json({ url, via: 'huggingface-space', free: true, note, translatedPrompt: tr.translated ? tr.text : null });
    } catch (e) {
      failures.push('FLUX.1-schnell المجاني (Hugging Face): ' + mapSpaceError(e));
    }
  } else {
    failures.push('FLUX.1-schnell المجاني (Hugging Face): لم يبقَ وقت للمحاولة');
  }

  // فشل صريح: نسمّي كل مسار وسبب فشله، ولا نرجع صورة من مسار آخر أبداً.
  const error = 'تعذّر توليد الصورة. المسارات التي جُرّبت:\n' + failures.map((f) => '• ' + f).join('\n')
    + '\n\nما يمكنك فعله: أضف مفتاح OpenAI أو Together أو Hugging Face من مدير المفاتيح لصور DALL·E / FLUX بجودة عالية (مفتاح Hugging Face مجاني من huggingface.co/settings/tokens)، أو اضبط Cloudflare Workers AI المجاني في Vercel (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN — حساب مجاني بلا بطاقة، ~57 صورة/يوم)، أو أضف في لوحة راوتر FreeLLMAPI مفتاح مزود يقدّم نماذج صور، أو أعد المحاولة لاحقاً عبر المسار المجاني بعد تجدد حصته اليومية.';
  return NextResponse.json({ error }, { status: 502 });
}
