import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/video — توليد فيديو حقيقي عبر مزود مدفوع بمفتاح.
// مصادر موثقة (نُفذت حرفياً منها):
//  • Veo 3 عبر fal.ai — نقطة النهاية fal-ai/veo3 (fal.ai/models/fal-ai/veo3/api):
//    POST https://queue.fal.run/fal-ai/veo3 بمفتاح fal، يعيد {request_id}، ثم
//    استطلاع الحالة حتى COMPLETED. الدخل: prompt, duration "4s"|"6s"|"8s"،
//    resolution "720p"|"1080p"، generate_audio، aspect_ratio "16:9"|"9:16".
//    ملاحظة صادقة: واجهة Gemini API المباشرة لـ Veo أُغلقت (Veo 3.1 Preview
//    توقفت 22 أكتوبر 2026، وVeo 3.0 GA على Vertex AI يحتاج OAuth من GCP لا
//    مفتاح API عادياً) — لذلك طريق Veo 3 بمفتاح API هو fal.ai.
//  • Seedance 2.5 عبر fal.ai — bytedance/seedance-2.5/text-to-video
//    (fal.ai/models/bytedance/seedance-2.5/text-to-video/api):
//    prompt, resolution "480p"|"720p"|"1080p"|"4k"، duration "auto"|4..30،
//    aspect_ratio "auto"|"16:9"|"9:16"|"1:1"|"4:3"|"3:4"|"21:9"،
//    generate_audio، output_format "mp4". يصل إلى 30 ثانية مع صوت.
//  • Gemini Omni Flash — gemini-omni-1.2-flash (ai.google.dev/gemini-api/docs/omni):
//    POST https://generativelanguage.googleapis.com/v1beta/interactions?key=KEY
//    الجسم {model, input}، والفيديو في steps[].content[] من نوع video (base64).
//    محاولة متزامنة واحدة بمهلة 55 ثانية (سقف وظيفة Vercel هو 60 ثانية) —
//    إن طال التوليد أكثر نرجع 504 صادقاً ونقترح Veo 3 / Seedance (غير متزامن).
// الفيديو غير متزامن بطبيعته: هذا المسار ينشئ المهمة فقط ويعيد jobId،
// والعميل يستطلع /api/video/status حتى الاكتمال. لا فيديو وهمي أبداً.

const FAL_QUEUE = 'https://queue.fal.run/fal-ai';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const VIDEO_MODELS = {
  veo3: {
    endpoint: 'veo3', label: 'Veo 3 (fal.ai)',
    input: (prompt, opts) => ({
      prompt,
      duration: ['4s', '6s', '8s'].includes(opts.duration) ? opts.duration : '8s',
      resolution: opts.resolution === '1080p' ? '1080p' : '720p',
      generate_audio: true,
      aspect_ratio: opts.aspectRatio === '9:16' ? '9:16' : '16:9'
    })
  },
  seedance: {
    endpoint: 'bytedance/seedance-2.5/text-to-video', label: 'Seedance 2.5 (fal.ai)',
    input: (prompt, opts) => ({
      prompt,
      resolution: ['480p', '720p', '1080p', '4k'].includes(opts.resolution) ? opts.resolution : '720p',
      duration: opts.duration && /^[0-9]+$/.test(String(opts.duration)) ? String(opts.duration) : 'auto',
      aspect_ratio: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(opts.aspectRatio) ? opts.aspectRatio : 'auto',
      generate_audio: true,
      output_format: 'mp4'
    })
  }
};

function keyList(arr) {
  return (arr || []).map((k) => (typeof k === 'string' ? k : k?.value)).filter(Boolean);
}

async function falSubmit(endpoint, input, keys) {
  const failures = [];
  for (const key of keys) {
    try {
      const r = await fetch(FAL_QUEUE + '/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + key },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30000)
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error('fal ردّ بالحالة ' + r.status + (txt ? ': ' + txt.slice(0, 160) : ''));
      }
      const data = await r.json();
      if (!data.request_id) throw new Error('fal لم يرجع request_id');
      return { requestId: data.request_id };
    } catch (e) {
      failures.push(String(e.message || e));
      if (/401|403/.test(String(e.message || e))) continue; // مفتاح غير صالح → جرّب التالي
      if (/429|402/.test(String(e.message || e))) continue; // نفاد رصيد/حد → جرّب التالي
      continue;
    }
  }
  throw new Error(failures.join(' | ') || 'فشل الإرسال إلى fal');
}

// Gemini Omni Flash — محاولة متزامنة واحدة (Interactions API الرسمية).
async function omniGenerate(prompt, keys) {
  const failures = [];
  for (const key of keys) {
    try {
      const r = await fetch(GEMINI_BASE + '/interactions?key=' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemini-omni-1.2-flash', input: prompt }),
        signal: AbortSignal.timeout(55000)
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error('Gemini ردّ بالحالة ' + r.status + (txt ? ': ' + txt.slice(0, 160) : ''));
      }
      const data = await r.json();
      // REST: الفيديو في steps[].content[] من نوع video (base64) — أو output_video (SDK).
      let b64 = data?.output_video?.data || null;
      let mime = data?.output_video?.mime_type || 'video/mp4';
      if (!b64 && Array.isArray(data?.steps)) {
        outer: for (const step of data.steps) {
          for (const part of step?.content || []) {
            if (part?.type === 'video' && part.data) { b64 = part.data; mime = part.mime_type || 'video/mp4'; break outer; }
          }
        }
      }
      if (!b64) throw new Error('اكتمل الطلب دون فيديو (ربما رفض النموذج الوصف — جرّب وصفاً آخر)');
      return { url: 'data:' + mime + ';base64,' + b64 };
    } catch (e) {
      failures.push(String(e.message || e));
      continue;
    }
  }
  throw new Error(failures.join(' | ') || 'فشل توليد Omni');
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح.' }, { status: 400 }); }
  const { prompt, provider = 'veo3', apiKeys = {}, duration, aspectRatio, resolution } = body;
  if (!prompt || !String(prompt).trim()) return NextResponse.json({ error: 'اكتب وصفاً للفيديو أولاً.' }, { status: 400 });
  const clean = String(prompt).trim();

  if (provider === 'veo3' || provider === 'seedance') {
    const keys = keyList(apiKeys.fal);
    if (!keys.length) {
      return NextResponse.json({
        error: 'توليد الفيديو عبر ' + VIDEO_MODELS[provider].label + ' يحتاج مفتاح fal.ai — لا يوجد مزود فيديو مجاني موثوق بدون مفتاح.',
        needsKey: true,
        howTo: 'أنشئ حساباً في fal.ai، انسخ مفتاح API من fal.ai/dashboard/keys، وأضفه من مدير المفاتيح تحت اسم «fal.ai (فيديو)»، ثم أعد المحاولة. لن نعرض فيديو وهمياً بدل ذلك.'
      }, { status: 402 });
    }
    try {
      const { requestId } = await falSubmit(VIDEO_MODELS[provider].endpoint, VIDEO_MODELS[provider].input(clean, { duration, aspectRatio, resolution }), keys);
      return NextResponse.json({
        status: 'queued', jobId: requestId, endpoint: VIDEO_MODELS[provider].endpoint,
        provider, model: VIDEO_MODELS[provider].label,
        etaSeconds: provider === 'seedance' ? 120 : 90,
        note: 'المهمة في الطابور — سيُستطلع حالتها تلقائياً حتى يكتمل الفيديو.'
      });
    } catch (e) {
      return NextResponse.json({ error: 'تعذّر بدء توليد الفيديو: ' + String(e.message || e), needsKey: false }, { status: 502 });
    }
  }

  if (provider === 'omni') {
    const keys = keyList(apiKeys.gemini);
    if (!keys.length) {
      return NextResponse.json({
        error: 'Gemini Omni Flash يحتاج مفتاح Google AI Studio (مجاني) — أضفه من مدير المفاتيح تحت اسم «Google Gemini».',
        needsKey: true,
        howTo: 'احصل على مفتاح مجاني من aistudio.google.com/apikey وأضفه من مدير المفاتيح، ثم أعد المحاولة.'
      }, { status: 402 });
    }
    try {
      const { url } = await omniGenerate(clean, keys);
      return NextResponse.json({ status: 'completed', url, provider, model: 'Gemini Omni Flash (gemini-omni-1.2-flash)' });
    } catch (e) {
      const msg = String(e.message || e);
      const timedOut = /timeout|aborted|504/i.test(msg);
      return NextResponse.json({
        error: timedOut
          ? 'تجاوز توليد Omni مهلة الخادم (60 ثانية) — الفيديو يحتاج وقتاً أطول. جرّب Veo 3 أو Seedance (غير متزامن) أو أعد المحاولة بوصف أقصر.'
          : 'تعذّر توليد الفيديو عبر Omni: ' + msg,
        needsKey: false
      }, { status: timedOut ? 504 : 502 });
    }
  }

  // replicate / luma / runway — غير مكتملة بصراحة كما قبل.
  const key = keyList(apiKeys[provider] || apiKeys.replicate)[0];
  if (!key) {
    return NextResponse.json({
      error: 'توليد الفيديو يحتاج مفتاحاً مدفوعاً — لا يوجد مزود فيديو مجاني موثوق بدون مفتاح.',
      needsKey: true,
      howTo: 'أنشئ حساباً في Replicate (replicate.com) أو Luma (lumalabs.ai) أو Runway، انسخ مفتاح API، وأضفه من مدير المفاتيح تحت اسم المزود، ثم أعد المحاولة. أو اختر Veo 3 / Seedance 2.5 بمفتاح fal.ai — وهما مكتملان الآن. لن نعرض فيديو وهمياً بدل ذلك.'
    }, { status: 402 });
  }
  return NextResponse.json({
    error: 'المفتاح موجود، لكن توليد الفيديو عبر ' + provider + ' (مهام غير متزامنة واستطلاع حالة) غير مكتمل في هذه النسخة بعد — جرّب Veo 3 أو Seedance 2.5 بمفتاح fal.ai، فهما مكتملان.',
    needsKey: false,
    howTo: 'اختر Veo 3 أو Seedance 2.5 من قائمة مزود الفيديو.'
  }, { status: 501 });
}
