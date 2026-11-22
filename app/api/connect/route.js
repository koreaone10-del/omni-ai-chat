import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/connect — قدرة حقيقية واحدة لكل خدمة موصولة (v1.7).
// التوكن يأتي في جسم الطلب فقط، ويُمرَّر مباشرة إلى الخدمة نفسها،
// ولا يُسجَّل في أي سجل خادم أبداً، ولا يُرسل لأي مزود آخر.
//   { service: 'github'|'vercel'|'render', action, token, repo?, path? }
//   github: test | listRepos | readFile   (repo بصيغة owner/name)
//   vercel: test | listProjects
//   render: test | listServices
// الرد: JSON مختصر (أسماء وروابط فقط) ليُضمَّن كسياق في المحادثة.

const GH = 'https://api.github.com';
const VC = 'https://api.vercel.com';
const RN = 'https://api.render.com/v1';

async function call(url, token, timeoutMs = 15000) {
  const r = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CHIBANI-AI-connect'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!r.ok) {
    const msg = (data && (data.message || data.error?.message)) || ('HTTP ' + r.status);
    const err = new Error(String(msg).slice(0, 200));
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح (JSON).' }, { status: 400 }); }
  const { service, action, token, repo, path } = body || {};
  // تحقق دون تسجيل أي قيمة سرية.
  if (!token || typeof token !== 'string' || token.length < 8) {
    return NextResponse.json({ error: 'أضف التوكن أولاً من قسم «الربط» في الإعدادات.' }, { status: 400 });
  }
  try {
    if (service === 'github') {
      if (action === 'listRepos' || action === 'test') {
        const repos = await call(GH + '/user/repos?per_page=100&sort=updated', token);
        const list = (Array.isArray(repos) ? repos : []).map((r) => ({
          name: r.full_name, url: r.html_url, private: !!r.private,
          language: r.language || null, updated: r.updated_at || null
        }));
        return NextResponse.json({ ok: true, service: 'github', count: list.length, repos: list });
      }
      if (action === 'readFile') {
        if (!repo || !String(repo).includes('/') || !path) {
          return NextResponse.json({ error: 'حدّد المستودع بصيغة owner/name ومسار الملف.' }, { status: 400 });
        }
        const file = await call(GH + '/repos/' + repo + '/contents/' + String(path).replace(/^\//, ''), token);
        let content = '';
        if (file && file.content) {
          try { content = Buffer.from(String(file.content).replace(/\s/g, ''), 'base64').toString('utf8'); } catch {}
        }
        return NextResponse.json({ ok: true, service: 'github', repo, path, size: file?.size || 0, content: content.slice(0, 8000) });
      }
      return NextResponse.json({ error: 'إجراء غير معروف لـ GitHub.' }, { status: 400 });
    }
    if (service === 'vercel') {
      if (action === 'listProjects' || action === 'test') {
        const data = await call(VC + '/v9/projects?limit=100', token);
        const list = ((data && data.projects) || []).map((p) => ({
          name: p.name, id: p.id, framework: p.framework || null,
          updated: p.updatedAt ? new Date(p.updatedAt).toISOString() : null
        }));
        return NextResponse.json({ ok: true, service: 'vercel', count: list.length, projects: list });
      }
      return NextResponse.json({ error: 'إجراء غير معروف لـ Vercel.' }, { status: 400 });
    }
    if (service === 'render') {
      if (action === 'listServices' || action === 'test') {
        const data = await call(RN + '/services?limit=100', token);
        const arr = Array.isArray(data) ? data : (data?.service ? [data] : []);
        const list = arr.map((s) => {
          const svc = s.service || s;
          return { name: svc.name, id: svc.id, type: svc.type || null, suspended: svc.suspended || null, url: svc.serviceDetails?.url || null };
        });
        return NextResponse.json({ ok: true, service: 'render', count: list.length, services: list });
      }
      return NextResponse.json({ error: 'إجراء غير معروف لـ Render.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'خدمة غير معروفة.' }, { status: 400 });
  } catch (e) {
    const status = e.status === 401 || e.status === 403
      ? 401
      : (e.status || 502);
    const msg = e.status === 401 || e.status === 403
      ? 'التوكن مرفوض من الخدمة — تحقق منه وأعد المحاولة.'
      : 'تعذّر الاتصال بالخدمة: ' + String(e.message || e).slice(0, 160);
    return NextResponse.json({ error: msg }, { status });
  }
}
