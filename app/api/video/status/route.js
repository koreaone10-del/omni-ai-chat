import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/video/status — استطلاع حالة مهمة فيديو fal.ai (Veo 3 / Seedance 2.5).
// الجسم: { endpoint: 'veo3' | 'bytedance/seedance-2.5/text-to-video', jobId, apiKeys }
// يرجع: { status: 'queued' | 'processing' | 'completed' | 'failed', url?, error?, logs? }
// بروتوكول طابور fal الرسمي (queue.fal.run):
//  GET /{endpoint}/requests/{request_id}/status → { status: IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED }
//  GET /{endpoint}/requests/{request_id}        → { data: { video: { url }, seed } }

const FAL_QUEUE = 'https://queue.fal.run/fal-ai';

function keyList(arr) {
  return (arr || []).map((k) => (typeof k === 'string' ? k : k?.value)).filter(Boolean);
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح.' }, { status: 400 }); }
  const { endpoint, jobId, apiKeys = {} } = body;
  if (!endpoint || !jobId) return NextResponse.json({ error: 'ناقص: endpoint و jobId.' }, { status: 400 });
  const safeEndpoint = String(endpoint).replace(/^\/+/, '');
  if (!/^(veo3|bytedance\/seedance-2\.5\/text-to-video)$/.test(safeEndpoint)) {
    return NextResponse.json({ error: 'نقطة نهاية غير مدعومة للاستطلاع.' }, { status: 400 });
  }
  const keys = keyList(apiKeys.fal);
  if (!keys.length) return NextResponse.json({ error: 'لا يوجد مفتاح fal.ai محفوظ للاستطلاع.' }, { status: 402 });

  const failures = [];
  for (const key of keys) {
    try {
      const r = await fetch(`${FAL_QUEUE}/${safeEndpoint}/requests/${encodeURIComponent(jobId)}/status`, {
        headers: { Authorization: 'Key ' + key },
        signal: AbortSignal.timeout(15000)
      });
      if (r.status === 404) return NextResponse.json({ status: 'failed', error: 'المهمة غير موجودة على fal (ربما انتهت صلاحيتها).' });
      if (!r.ok) throw new Error('fal ردّ بالحالة ' + r.status);
      const s = await r.json();
      const st = String(s.status || '');
      if (st === 'COMPLETED') {
        const rr = await fetch(`${FAL_QUEUE}/${safeEndpoint}/requests/${encodeURIComponent(jobId)}`, {
          headers: { Authorization: 'Key ' + key },
          signal: AbortSignal.timeout(15000)
        });
        if (!rr.ok) throw new Error('تعذّر جلب نتيجة المهمة (HTTP ' + rr.status + ')');
        const res = await rr.json();
        const url = res?.data?.video?.url || null;
        if (!url) return NextResponse.json({ status: 'failed', error: 'اكتملت المهمة دون رابط فيديو.' });
        return NextResponse.json({ status: 'completed', url, seed: res?.data?.seed ?? null });
      }
      if (st === 'FAILED' || st === 'CANCELLED') {
        return NextResponse.json({ status: 'failed', error: 'فشلت المهمة على fal' + (s.error ? ': ' + String(s.error).slice(0, 200) : '.') });
      }
      return NextResponse.json({ status: st === 'IN_PROGRESS' ? 'processing' : 'queued', logs: (s.logs || []).map((l) => l.message).filter(Boolean).slice(-3) });
    } catch (e) {
      failures.push(String(e.message || e));
      continue;
    }
  }
  return NextResponse.json({ status: 'failed', error: 'تعذّر استطلاع الحالة: ' + failures.join(' | ') }, { status: 502 });
}
