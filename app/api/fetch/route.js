import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/fetch — جلب صفحة ويب وتحويلها إلى نص مقروء (للوكيل الذكي).
// { url } → { ok, url, title, text } — النص مقتطع إلى ~8000 حرف.
// حدود: http(s) فقط، مهلة 12 ثانية، حد أقصى 200KB، بلا مفاتيح وبلا تسجيل.

function stripHtml(html) {
  let t = String(html || '');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<(noscript|template|svg|canvas)[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
  return t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح (JSON).' }, { status: 400 }); }
  const raw = String((body && body.url) || '').trim();
  if (!raw) return NextResponse.json({ error: 'أدخل رابطاً أولاً.' }, { status: 400 });
  let url;
  try { url = new URL(raw.startsWith('http') ? raw : 'https://' + raw); } catch {
    return NextResponse.json({ error: 'الرابط غير صالح.' }, { status: 400 });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return NextResponse.json({ error: 'يُقبل http و https فقط.' }, { status: 400 });
  }
  try {
    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': 'CHIBANI-AI-agent/2.1 (+https://omni-ai-chat-dbwk.vercel.app)', Accept: 'text/html,application/xhtml+xml,text/plain,*/*' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow'
    });
    if (!r.ok) return NextResponse.json({ error: 'الموقع ردّ بالحالة ' + r.status + '.' }, { status: 502 });
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 200 * 1024) {
      return NextResponse.json({ error: 'الصفحة أكبر من 200KB — انسخ نصها مباشرة.' }, { status: 413 });
    }
    const html = new TextDecoder('utf-8').decode(buf);
    const titleMatch = html.match(/<title[^>]*>([\s\S]{0,300})<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]).slice(0, 200) : '';
    const text = stripHtml(html).slice(0, 8000);
    if (!text) return NextResponse.json({ error: 'لم يُستخرج نص من الصفحة.' }, { status: 502 });
    return NextResponse.json({ ok: true, url: url.toString(), title, text });
  } catch (e) {
    return NextResponse.json({ error: 'تعذّر جلب الصفحة: ' + String(e.message || e).slice(0, 160) }, { status: 502 });
  }
}
