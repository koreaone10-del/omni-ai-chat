import { NextResponse } from 'next/server';
import { getProvider, AUTO_ORDER } from '@/lib/providers';
import { orderKeys, isRetryableStatus } from '@/lib/keys';
import { estimateTokens } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/chat — وكيل OpenAI-compatible مع تدوير مفاتيح تلقائي.
// لا يسجّل المفاتيح أبداً في السجلات.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح (JSON).' }, { status: 400 }); }
  const { messages = [], providerId = 'auto', model, apiKeys = {}, baseURL: customBase, deepThinking = false } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'لا توجد رسائل للإرسال.' }, { status: 400 });
  }

  const systemExtra = deepThinking
    ? 'فكّر خطوة بخطوة بعمق قبل الإجابة. ابدأ إجابتك بقسم قصير بعنوان "التفكير:" يلخّص خطوات تفكيرك (3-6 أسطر)، ثم ضع الإجابة النهائية بعد سطر "الإجابة:".'
    : 'أجب بدقة وبشكل مباشر ومنظّم.';

  const attempts = [];
  const providerIds = providerId === 'auto'
    ? AUTO_ORDER
    : [providerId];

  for (const pid of providerIds) {
    const provider = getProvider(pid);
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
        const payload = {
          model: mdl,
          messages: [{ role: 'system', content: systemExtra }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
          temperature: 0.7
        };
        const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(k.value ? { Authorization: 'Bearer ' + k.value } : {}) },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(90000)
        });
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
        return NextResponse.json({ content, usage, modelUsed: data.model || mdl, providerUsed: pid, keyIndex: k.index, reasoning });
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
