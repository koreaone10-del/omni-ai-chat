import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/jobs — مهام Live الخلفية (v2.1).
// التشغيل على GitHub Actions (مجاني: 2000 دقيقة/شهر) عبر repository_dispatch.
// التوكن (GitHub PAT) يأتي في جسم الطلب فقط، ولا يُسجَّل أبداً.
//   { action: 'create', token, type, title, prompt } → { ok, jobId }
//   { action: 'status', token, jobId } → حالة المهمة من ملف النتيجة في فرع `jobs`
//        + حالة تشغيل Actions المطابق (اسمه يحمل jobId).
// المستودع هو مستودع الموقع نفسه: koreaone10-del/omni-ai-chat.

const OWNER = 'koreaone10-del';
const REPO = 'omni-ai-chat';
const GH = 'https://api.github.com';

async function gh(path, token, method = 'GET', body = null, timeoutMs = 20000) {
  const r = await fetch(GH + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'CHIBANI-AI-jobs'
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!r.ok) {
    const err = new Error((data && data.message) || ('GitHub ردّ بالحالة ' + r.status));
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح (JSON).' }, { status: 400 }); }
  const { action, token, type, title, prompt, jobId } = body || {};
  if (!token || typeof token !== 'string' || token.length < 8) {
    return NextResponse.json({ error: 'أضف توكن GitHub أولاً من قسم «التكاملات» (يحتاج صلاحية repo + workflow).' }, { status: 400 });
  }
  try {
    if (action === 'create') {
      const cleanType = ['research', 'summary', 'image', 'code'].includes(type) ? type : 'research';
      const cleanTitle = String(title || prompt || 'مهمة').slice(0, 120);
      const cleanPrompt = String(prompt || '').slice(0, 20000);
      if (!cleanPrompt.trim()) return NextResponse.json({ error: 'اكتب وصف المهمة أولاً.' }, { status: 400 });
      const id = 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await gh('/repos/' + OWNER + '/' + REPO + '/dispatches', token, 'POST', {
        event_type: 'chibani-job',
        client_payload: { jobId: id, type: cleanType, title: cleanTitle, prompt: cleanPrompt }
      });
      return NextResponse.json({ ok: true, jobId: id, status: 'queued' });
    }
    if (action === 'status') {
      if (!jobId) return NextResponse.json({ error: 'حدّد المهمة.' }, { status: 400 });
      // 1) ملف النتيجة في فرع `jobs` (يكتبه العامل أثناء التشغيل وعند اكتماله).
      let file = null;
      try {
        const f = await gh('/repos/' + OWNER + '/' + REPO + '/contents/jobs/results/' + encodeURIComponent(jobId) + '.json?ref=jobs', token);
        if (f && f.content) {
          try { file = JSON.parse(Buffer.from(String(f.content).replace(/\s/g, ''), 'base64').toString('utf8')); } catch {}
        }
      } catch (e) { if (e.status !== 404) throw e; }
      // 2) تشغيل Actions المطابق (اسمه يحمل jobId).
      let run = null;
      try {
        const runs = await gh('/repos/' + OWNER + '/' + REPO + '/actions/runs?event=repository_dispatch&per_page=10', token);
        const found = ((runs && runs.workflow_runs) || []).find((r) => String(r.name || '').includes(jobId));
        if (found) run = { id: found.id, status: found.status, conclusion: found.conclusion, url: found.html_url, created: found.created_at };
      } catch {}
      if (file) {
        return NextResponse.json({ ok: true, jobId, status: file.status || 'running', progress: file.progress || 0, steps: file.steps || [], result: file.result || null, error: file.error || null, updatedAt: file.updatedAt || null, run });
      }
      if (run) {
        const st = run.status === 'completed' ? (run.conclusion === 'success' ? 'done' : 'failed') : 'running';
        return NextResponse.json({ ok: true, jobId, status: st, progress: st === 'done' ? 100 : 10, steps: [], result: null, error: run.conclusion === 'failure' ? 'فشل التشغيل في GitHub Actions — افتح سجل التشغيل للتفاصيل.' : null, run });
      }
      return NextResponse.json({ ok: true, jobId, status: 'queued', progress: 0, steps: [], result: null, run: null });
    }
    return NextResponse.json({ error: 'إجراء غير معروف.' }, { status: 400 });
  } catch (e) {
    const status = e.status === 401 || e.status === 403 ? 401 : (e.status || 502);
    const msg = e.status === 401 || e.status === 403
      ? 'توكن GitHub مرفوض أو بلا صلاحية workflow — أنشئ توكناً بصلاحيتي repo و workflow.'
      : 'تعذّر الاتصال بـ GitHub: ' + String(e.message || e).slice(0, 160);
    return NextResponse.json({ error: msg }, { status });
  }
}
