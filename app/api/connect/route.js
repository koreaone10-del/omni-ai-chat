import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/connect — قدرة حقيقية واحدة لكل خدمة موصولة (v1.7، موسّعة v2.1).
// التوكن يأتي في جسم الطلب فقط، ويُمرَّر مباشرة إلى الخدمة نفسها،
// ولا يُسجَّل في أي سجل خادم أبداً، ولا يُرسل لأي مزود آخر.
//   { service: 'github'|'vercel'|'render'|'cloudflare'|'facebook'|'gmail', action, token, repo?, path?, pageId? }
//   github: test | listRepos | readFile   (repo بصيغة owner/name)
//   vercel: test | listProjects
//   render: test | listServices
//   cloudflare: test | listZones | account
//   facebook: test | listPages | listPosts  (listPosts يحتاج pageId)
//   gmail: test | listMessages  (يحتاج توكن OAuth بنطاق gmail.readonly — غير مضاف في عميل
//          Google OAuth الحالي؛ عند رفض النطاق يرجع المسار رسالة صريحة بشرح الإعداد.)
// الرد: JSON مختصر (أسماء وروابط فقط) ليُضمَّن كسياق في المحادثة.

const GH = 'https://api.github.com';
const VC = 'https://api.vercel.com';
const RN = 'https://api.render.com/v1';
const CF = 'https://api.cloudflare.com/client/v4';
const FB = 'https://graph.facebook.com/v18.0';
const GM = 'https://gmail.googleapis.com/gmail/v1';

const GMAIL_SCOPE_NOTE = 'Gmail غير مفعّل بعد: عميل Google OAuth الحالي بلا نطاق gmail.readonly. أضف النطاق https://www.googleapis.com/auth/gmail.readonly في Google Cloud Console (مشروع CHIBANI AI ← OAuth consent) ثم سجّل خروجك ودخولك من جديد للموافقة عليه.';

async function call(url, token, timeoutMs = 15000, extraHeaders = {}) {
  const r = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'User-Agent': 'CHIBANI-AI-connect',
      ...extraHeaders
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!r.ok) {
    const msg = (data && (data.message || data.error?.message || data.error?.errors?.[0]?.message || (typeof data.error === 'string' ? data.error : null))) || ('HTTP ' + r.status);
    const err = new Error(String(msg).slice(0, 200));
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح (JSON).' }, { status: 400 }); }
  const { service, action, token, repo, path, pageId } = body || {};
  // تحقق دون تسجيل أي قيمة سرية.
  if (!token || typeof token !== 'string' || token.length < 8) {
    return NextResponse.json({ error: 'أضف التوكن أولاً من قسم «التكاملات» في الإعدادات.' }, { status: 400 });
  }
  try {
    if (service === 'github') {
      if (action === 'listRepos' || action === 'test') {
        const repos = await call(GH + '/user/repos?per_page=100&sort=updated', token, 15000, { Accept: 'application/vnd.github+json' });
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
        const file = await call(GH + '/repos/' + repo + '/contents/' + String(path).replace(/^\//, ''), token, 15000, { Accept: 'application/vnd.github+json' });
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
    if (service === 'cloudflare') {
      if (action === 'test') {
        const v = await call(CF + '/user/tokens/verify', token);
        const ok = !!(v && v.success && v.result && v.result.status === 'active');
        if (!ok) return NextResponse.json({ error: 'التوكن غير صالح أو غير نشط — تحقق منه في لوحة Cloudflare.' }, { status: 401 });
        return NextResponse.json({ ok: true, service: 'cloudflare', tokenId: v.result.id, status: v.result.status });
      }
      if (action === 'listZones') {
        const data = await call(CF + '/zones?per_page=50', token);
        const list = ((data && data.result) || []).map((z) => ({
          name: z.name, id: z.id, status: z.status || null, plan: z.plan?.name || null
        }));
        return NextResponse.json({ ok: true, service: 'cloudflare', count: list.length, zones: list });
      }
      if (action === 'account') {
        const data = await call(CF + '/accounts?per_page=20', token);
        const list = ((data && data.result) || []).map((a) => ({ name: a.name, id: a.id }));
        return NextResponse.json({ ok: true, service: 'cloudflare', count: list.length, accounts: list });
      }
      return NextResponse.json({ error: 'إجراء غير معروف لـ Cloudflare.' }, { status: 400 });
    }
    if (service === 'facebook') {
      if (action === 'listPages' || action === 'test') {
        const data = await call(FB + '/me/accounts?fields=id,name&limit=50', token);
        const list = ((data && data.data) || []).map((p) => ({ name: p.name, id: p.id }));
        return NextResponse.json({ ok: true, service: 'facebook', count: list.length, pages: list });
      }
      if (action === 'listPosts') {
        if (!pageId) return NextResponse.json({ error: 'حدّد الصفحة أولاً (listPages ثم اختر صفحة).' }, { status: 400 });
        // توكن الصفحة يُجلب خادماً من /me/accounts حتى لا يمرّ عبر العميل.
        const acc = await call(FB + '/me/accounts?fields=id,access_token&limit=50', token);
        const page = ((acc && acc.data) || []).find((p) => String(p.id) === String(pageId));
        if (!page || !page.access_token) return NextResponse.json({ error: 'لم تُعثر على الصفحة في حسابك — تحقق من صلاحية pages_read_engagement.' }, { status: 403 });
        const posts = await call(FB + '/' + encodeURIComponent(pageId) + '/posts?fields=id,message,created_time,permalink_url&limit=10', page.access_token);
        const list = ((posts && posts.data) || []).map((p) => ({
          id: p.id, message: (p.message || '').slice(0, 500), created: p.created_time || null, url: p.permalink_url || null
        }));
        return NextResponse.json({ ok: true, service: 'facebook', count: list.length, posts: list });
      }
      return NextResponse.json({ error: 'إجراء غير معروف لـ Facebook.' }, { status: 400 });
    }
    if (service === 'gmail') {
      // يحتاج توكن OAuth بنطاق gmail.readonly — عميل Google OAuth الحالي بلا هذا النطاق.
      if (action === 'listMessages' || action === 'test') {
        try {
          const data = await call(GM + '/users/me/messages?maxResults=10', token);
          const ids = ((data && data.messages) || []).slice(0, 10);
          const msgs = [];
          for (const m of ids) {
            try {
              const full = await call(GM + '/users/me/messages/' + m.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date', token, 10000);
              const headers = {};
              for (const h of (full?.payload?.headers || [])) headers[h.name] = h.value;
              msgs.push({ id: m.id, subject: headers.Subject || '', from: headers.From || '', date: headers.Date || '', snippet: (full?.snippet || '').slice(0, 200) });
            } catch {}
          }
          return NextResponse.json({ ok: true, service: 'gmail', count: msgs.length, messages: msgs });
        } catch (e) {
          if (e.status === 401 || e.status === 403) {
            return NextResponse.json({ error: GMAIL_SCOPE_NOTE, needsScope: true }, { status: 401 });
          }
          throw e;
        }
      }
      return NextResponse.json({ error: 'إجراء غير معروف لـ Gmail.' }, { status: 400 });
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
