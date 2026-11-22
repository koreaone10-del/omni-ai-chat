import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/image — توليد صور.
// إن وُجد مفتاح OpenAI-compatible يُستخدم /images/generations،
// وإلا يُستخدم Pollinations المجاني بدون مفتاح (يُذكر ذلك صراحة في الرد).
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح.' }, { status: 400 }); }
  const { prompt, providerId = 'openai', apiKeys = {}, size = '1024x1024' } = body;
  if (!prompt || !String(prompt).trim()) return NextResponse.json({ error: 'اكتب وصفاً للصورة أولاً.' }, { status: 400 });

  const key = (apiKeys[providerId] || [])[0];
  const keyValue = typeof key === 'string' ? key : key?.value;
  const bases = { openai: 'https://api.openai.com/v1', together: 'https://api.together.xyz/v1' };

  if (keyValue && bases[providerId]) {
    try {
      const r = await fetch(bases[providerId] + '/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + keyValue },
        body: JSON.stringify({ model: providerId === 'openai' ? 'dall-e-3' : 'black-forest-labs/FLUX.1-schnell-Free', prompt, size, n: 1 }),
        signal: AbortSignal.timeout(120000)
      });
      if (!r.ok) throw new Error('المزود ردّ بالحالة ' + r.status);
      const data = await r.json();
      const url = data.data?.[0]?.url;
      if (!url) throw new Error('لم يرجع المزود رابط صورة.');
      return NextResponse.json({ url, via: providerId, free: false });
    } catch (e) {
      // سقوط المزود المدفوع → بديل مجاني بدل الفشل الكامل، مع توضيح ذلك
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${Date.now() % 100000}&nologo=true`;
      return NextResponse.json({ url, via: 'pollinations', free: true, note: 'تعذّر مزود الصور المدفوع (' + String(e.message || e) + ') — تم التوليد عبر Pollinations المجاني.' });
    }
  }

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${Date.now() % 100000}&nologo=true`;
  return NextResponse.json({ url, via: 'pollinations', free: true, note: 'تم التوليد عبر Pollinations المجاني (بدون مفتاح). لإنشاء صور DALL·E أضف مفتاح OpenAI.' });
}
