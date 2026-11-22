import { NextResponse } from 'next/server';
import { getProvider, AUTO_ORDER } from '@/lib/providers';
import { orderKeys, isRetryableStatus } from '@/lib/keys';
import { estimateTokens } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // البث قد يستغرق حتى دقيقة كاملة

// POST /api/chat — وكيل OpenAI-compatible مع تدوير مفاتيح تلقائي.
// لا يسجّل المفاتيح أبداً في السجلات.
// stream: true → بث SSE (أحداث {type:'reasoning'|'content', delta} ثم
// {type:'done', usage, modelUsed, providerUsed, keyIndex}) حتى يرى المستخدم
// التفكير والمحتوى لحظة بلحظة. stream: false/غائب → JSON كامل كما قبل
// (يستعمله وضع المقارنة). عند فشل البث لكل المزودين يرجع JSON 502 بالمحاولات.

function buildLangRule(lang) {
  const langName = { ar: 'Arabic', en: 'English', fr: 'French', es: 'Spanish', de: 'German', tr: 'Turkish', ru: 'Russian', zh: 'Chinese', hi: 'Hindi', pt: 'Portuguese', it: 'Italian', id: 'Indonesian' }[lang] || 'Arabic';
  return 'Always answer in ' + langName + ' unless the user explicitly asks for another language.';
}

function buildSystemExtra({ deepThinking, lang, skills }) {
  const langRule = buildLangRule(lang);
  const skillText = (Array.isArray(skills) ? skills : []).filter(Boolean).map((x) => String(x).slice(0, 800)).join('\n');
  const skillRule = skillText ? '\n\nActive skills — follow them:\n' + skillText : '';
  return (deepThinking
    ? 'فكّر خطوة بخطوة بعمق قبل الإجابة. ابدأ إجابتك بقسم قصير بعنوان "التفكير:" يلخّص خطوات تفكيرك (3-6 أسطر)، ثم ضع الإجابة النهائية بعد سطر "الإجابة:".'
    : 'أجب بدقة وبشكل مباشر ومنظّم.') + '\n' + langRule + skillRule;
}

// حقول الطلب (v2.2 — إعدادات الوكيل): تُمرَّر للمزود حيث يدعمها، وتُحذف
// الصامتة غير المدعومة عند رفض 400 ثم تُعاد المحاولة بحد أدنى (لا ادعاء دعم).
function sanitizeSampling(s = {}) {
  const out = {};
  if (typeof s.temperature === 'number' && s.temperature >= 0 && s.temperature <= 2) out.temperature = s.temperature;
  if (typeof s.top_p === 'number' && s.top_p > 0 && s.top_p <= 1) out.top_p = s.top_p;
  if (Number.isInteger(s.max_tokens) && s.max_tokens > 0) out.max_tokens = Math.min(s.max_tokens, 32000);
  if (typeof s.presence_penalty === 'number' && s.presence_penalty >= -2 && s.presence_penalty <= 2) out.presence_penalty = s.presence_penalty;
  if (typeof s.frequency_penalty === 'number' && s.frequency_penalty >= -2 && s.frequency_penalty <= 2) out.frequency_penalty = s.frequency_penalty;
  if (s.stop) {
    const arr = Array.isArray(s.stop) ? s.stop.map((x) => String(x)) : String(s.stop).split(',').map((x) => x.trim());
    const clean = arr.filter(Boolean).slice(0, 4);
    if (clean.length) out.stop = clean;
  }
  if (Number.isInteger(s.seed)) out.seed = s.seed;
  if (['low', 'medium', 'high'].includes(s.reasoning_effort)) out.reasoning_effort = s.reasoning_effort;
  if (s.response_format === 'json_object') out.response_format = { type: 'json_object' };
  return out;
}

// يبني حمولة الطلب + نسخة دنيا للتراجع عند 400. hasAdvanced = حقول تتجاوز
// model/messages/temperature/stream (هي التي قد يرفضها مزود ما).
function buildChatPayload({ model, systemContent, messages, stream, sampling = {} }) {
  const adv = sanitizeSampling(sampling);
  const payload = {
    model,
    messages: [{ role: 'system', content: systemContent }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    stream: !!stream
  };
  payload.temperature = adv.temperature != null ? adv.temperature : 0.7;
  for (const k of ['top_p', 'max_tokens', 'presence_penalty', 'frequency_penalty', 'stop', 'seed', 'reasoning_effort', 'response_format']) {
    if (adv[k] != null) payload[k] = adv[k];
  }
  if (stream) payload.stream_options = { include_usage: true };
  const minimal = { model, messages: payload.messages, temperature: payload.temperature, stream: !!stream };
  const hasAdvanced = Object.keys(adv).some((k) => k !== 'temperature') || !!payload.stream_options;
  return { payload, minimal, hasAdvanced };
}

// طلب واحد مع تراجع واحد عند 400: يعيد {r, fallback}.
async function postChatCompletion(url, headers, built, timeoutMs) {
  let r = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify(built.payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!r.ok && r.status === 400 && built.hasAdvanced) {
    const firstErr = await r.text().catch(() => '');
    r = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify(built.minimal),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return { r, fallback: true, firstError: String(firstErr || '').slice(0, 200) };
  }
  return { r, fallback: false };
}

// يبني استجابة SSE من دالة تُصدر الأحداث عبر emit(obj).
function sseResponse(producer) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj) => {
        try { controller.enqueue(encoder.encode('data: ' + JSON.stringify(obj) + '\n\n')); } catch {}
      };
      try { await producer(emit); }
      catch (e) { emit({ type: 'error', error: String(e?.message || e) }); }
      finally { try { controller.close(); } catch {} }
    }
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' }
  });
}

// يحوّل استجابة OpenAI-compatible متدفقة (أو JSON كاملاً إن تجاهل المزود
// stream:true) إلى أحداثنا الموحدة. يرجع true عند نجاح البث.
async function pipeUpstreamToSse(r, emit, meta) {
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let usage = null;
    let modelUsed = null;
    const handleLine = (line) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let chunk;
      try { chunk = JSON.parse(payload); } catch { return; }
      const delta = chunk.choices?.[0]?.delta || {};
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) emit({ type: 'reasoning', delta: delta.reasoning_content });
      if (typeof delta.content === 'string' && delta.content) emit({ type: 'content', delta: delta.content });
      if (chunk.usage) usage = chunk.usage;
      if (chunk.model) modelUsed = chunk.model;
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    }
    buf += decoder.decode();
    for (const line of buf.split('\n')) handleLine(line.trim());
    emit({ type: 'done', usage, modelUsed, providerUsed: meta.providerUsed, keyIndex: meta.keyIndex, fallback: !!meta.fallback });
    return true;
  }
  // المزود تجاهل stream:true وردّ JSON كاملاً — نبثّه مقطّعاً حتى يعمل العميل بالطريقة نفسها.
  const data = await r.json();
  const choice = data.choices?.[0]?.message;
  const content = choice?.content || '';
  const reasoning = choice?.reasoning_content || data.choices?.[0]?.reasoning || null;
  if (reasoning) emit({ type: 'reasoning', delta: reasoning });
  for (const c of (content.match(/[\s\S]{1,60}/g) || [])) emit({ type: 'content', delta: c });
  emit({ type: 'done', usage: data.usage || null, modelUsed: data.model || meta.model, providerUsed: meta.providerUsed, keyIndex: meta.keyIndex, fallback: !!meta.fallback });
  return true;
}

async function handleStream({ messages, providerId, model, apiKeys, customBase, deepThinking, lang, skills, systemPrompt, sampling }) {
  // البرومبت النظامي للوكيل (v2.2) يقدَّم على قاعدة النظام العادية: إن وُجد،
  // يصبح هو رسالة system مع قاعدة اللغة فقط.
  const systemContent = systemPrompt && String(systemPrompt).trim()
    ? String(systemPrompt).trim() + '\n' + buildLangRule(lang)
    : buildSystemExtra({ deepThinking, lang, skills });
  const attempts = [];
  const providerIds = providerId === 'auto' ? AUTO_ORDER : [providerId];

  for (const pid of providerIds) {
    const provider = getProvider(pid);
    if (provider.videoOnly) { attempts.push({ provider: pid, error: 'هذا المزود للفيديو فقط — لا يقدم محادثة نصية.' }); continue; }
    const base = pid === 'custom' ? (customBase || provider.baseURL) : (customBase && providerId !== 'auto' ? customBase : provider.baseURL);
    if (!base) { attempts.push({ provider: pid, error: 'لا يوجد رابط أساس لهذا المزود.' }); continue; }
    const mdl = model && providerId !== 'auto' ? model : provider.models[0];

    // Pollinations نص مجاني بدون مفتاح — GET كامل، ثم يُبث مقطّعاً.
    if (pid === 'pollinations') {
      try {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        const prompt = encodeURIComponent((lastUser?.content || '').slice(0, 4000));
        const r = await fetch(`https://text.pollinations.ai/${prompt}?model=${encodeURIComponent(mdl)}`, { signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error('Pollinations ردّ بالحالة ' + r.status);
        const text = await r.text();
        return sseResponse(async (emit) => {
          for (const c of (text.match(/[\s\S]{1,60}/g) || [])) emit({ type: 'content', delta: c });
          emit({ type: 'done', usage: { total_tokens: estimateTokens(text) }, modelUsed: mdl, providerUsed: 'pollinations', keyIndex: 0 });
        });
      } catch (e) { attempts.push({ provider: pid, error: String(e.message || e) }); continue; }
    }

    const keys = orderKeys(apiKeys[pid] || []);
    if (provider.needsKey && keys.length === 0) {
      attempts.push({ provider: pid, error: 'لا يوجد مفتاح لهذا المزود. أضف مفتاحاً من مدير المفاتيح.' });
      if (providerId !== 'auto') break;
      continue;
    }
    const keyList = keys.length ? keys : [{ value: '', index: 0, status: 'active' }];

    for (const k of keyList) {
      try {
        const built = buildChatPayload({ model: mdl, systemContent, messages, stream: true, sampling });
        const { r, fallback } = await postChatCompletion(base.replace(/\/$/, '') + '/chat/completions', {
          'Content-Type': 'application/json', ...(k.value ? { Authorization: 'Bearer ' + k.value } : {})
        }, built, 120000);
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          const err = new Error(`المزود ردّ بالحالة ${r.status}: ${txt.slice(0, 200)}`);
          err.status = r.status;
          throw err;
        }
        const meta = { providerUsed: pid, keyIndex: k.index, model: mdl, fallback };
        return sseResponse((emit) => pipeUpstreamToSse(r, emit, meta));
      } catch (e) {
        attempts.push({ provider: pid, keyIndex: k.index, error: String(e.message || e), status: e.status || null });
        if (e.status && !isRetryableStatus(e.status) && providerId !== 'auto') break;
        continue;
      }
    }
    if (providerId !== 'auto') break;
  }

  return NextResponse.json({
    error: 'تعذّر الحصول على رد من أي مزود. تحقق من مفاتيحك واتصالك، ثم جرّب مزوداً آخر.',
    attempts,
    hint: 'أسرع بداية مجانية: أنشئ مفتاح Groq مجانياً من console.groq.com/keys وأضفه من مدير المفاتيح، أو اختر Pollinations (بدون مفتاح).'
  }, { status: 502 });
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح (JSON).' }, { status: 400 }); }
  const { messages = [], providerId = 'auto', model, apiKeys = {}, baseURL: customBase, deepThinking = false, lang = 'ar', skills = [], stream = false, systemPrompt, sampling = {} } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'لا توجد رسائل للإرسال.' }, { status: 400 });
  }

  // مسار البث (SSE) — الإرسال العادي من المحادثة. وضع المقارنة يستعمل JSON.
  if (stream === true) {
    return handleStream({ messages, providerId, model, apiKeys, customBase, deepThinking, lang, skills, systemPrompt, sampling });
  }

  // ---------- المسار غير المتدفق (JSON كامل) — كما قبل، لوضع المقارنة ----------
  const systemContent = systemPrompt && String(systemPrompt).trim()
    ? String(systemPrompt).trim() + '\n' + buildLangRule(lang)
    : buildSystemExtra({ deepThinking, lang, skills });

  const attempts = [];
  const providerIds = providerId === 'auto'
    ? AUTO_ORDER
    : [providerId];

  for (const pid of providerIds) {
    const provider = getProvider(pid);
    if (provider.videoOnly) { attempts.push({ provider: pid, error: 'هذا المزود للفيديو فقط — لا يقدم محادثة نصية.' }); continue; } // fal.ai فيديو فقط
    const base = pid === 'custom' ? (customBase || provider.baseURL) : (customBase && providerId !== 'auto' ? customBase : provider.baseURL);
    if (!base) { attempts.push({ provider: pid, error: 'لا يوجد رابط أساس لهذا المزود.' }); continue; }
    const mdl = model && providerId !== 'auto' ? model : provider.models[0];

    // Pollinations نص مجاني بدون مفتاح — مسار مختلف (GET)
    if (pid === 'pollinations') {
      try {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        const prompt = encodeURIComponent((lastUser?.content || '').slice(0, 4000));
        const r = await fetch(`https://text.pollinations.ai/${prompt}?model=${encodeURIComponent(mdl)}`, { signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error('Pollinations ردّ بالحالة ' + r.status);
        const text = await r.text();
        return NextResponse.json({ content: text, usage: { total_tokens: estimateTokens(text) }, modelUsed: mdl, providerUsed: 'pollinations', keyIndex: 0, reasoning: null });
      } catch (e) { attempts.push({ provider: pid, error: String(e.message || e) }); continue; }
    }

    const keys = orderKeys(apiKeys[pid] || []);
    // مزود يحتاج مفتاحاً ولم يُعطَ أي مفتاح → تخطَّه في الوضع التلقائي، وخطأ واضح في الوضع اليدوي
    if (provider.needsKey && keys.length === 0) {
      attempts.push({ provider: pid, error: 'لا يوجد مفتاح لهذا المزود. أضف مفتاحاً من مدير المفاتيح.' });
      if (providerId !== 'auto') break;
      continue;
    }
    const keyList = keys.length ? keys : [{ value: '', index: 0, status: 'active' }];

    for (const k of keyList) {
      try {
        const built = buildChatPayload({ model: mdl, systemContent, messages, stream: false, sampling });
        const { r, fallback } = await postChatCompletion(base.replace(/\/$/, '') + '/chat/completions', {
          'Content-Type': 'application/json', ...(k.value ? { Authorization: 'Bearer ' + k.value } : {})
        }, built, 90000);
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          const err = new Error(`المزود ردّ بالحالة ${r.status}: ${txt.slice(0, 200)}`);
          err.status = r.status;
          throw err;
        }
        const data = await r.json();
        const choice = data.choices?.[0]?.message;
        let content = choice?.content || '';
        let reasoning = choice?.reasoning_content || data.choices?.[0]?.reasoning || null;
        if (!reasoning && deepThinking && content.includes('التفكير:')) {
          const parts = content.split('الإجابة:');
          if (parts.length > 1) { reasoning = parts[0].replace('التفكير:', '').trim(); content = parts.slice(1).join('الإجابة:').trim(); }
        }
        const usage = data.usage || { total_tokens: estimateTokens(content) + estimateTokens(JSON.stringify(messages)) };
        return NextResponse.json({ content, usage, modelUsed: data.model || mdl, providerUsed: pid, keyIndex: k.index, reasoning, fallback });
      } catch (e) {
        attempts.push({ provider: pid, keyIndex: k.index, error: String(e.message || e), status: e.status || null });
        // 429/401/5xx → جرّب المفتاح التالي؛ غير ذلك جرّب المفتاح التالي أيضاً في الوضع التلقائي
        if (e.status && !isRetryableStatus(e.status) && providerId !== 'auto') break;
        continue;
      }
    }
    if (providerId !== 'auto') break;
  }

  return NextResponse.json({
    error: 'تعذّر الحصول على رد من أي مزود. تحقق من مفاتيحك واتصالك، ثم جرّب مزوداً آخر.',
    attempts,
    hint: 'أسرع بداية مجانية: أنشئ مفتاح Groq مجانياً من console.groq.com/keys وأضفه من مدير المفاتيح، أو اختر Pollinations (بدون مفتاح).'
  }, { status: 502 });
}
