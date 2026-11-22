// scripts/agent-worker.mjs — عامل مهام Live الخلفية (v2.1)
// يعمل على GitHub Actions (ubuntu-latest, Node 20, بلا اعتماديات خارجية).
// يقرأ JOB_PAYLOAD (JSON) من البيئة، ينفّذ المهمة خطوة بخطوة، ويكتب
// التقدم والنتيجة في فرع `jobs` (jobs/results/<jobId>.json + .md + ملفات)
// مع commit + push بعد كل خطوة، فيرى الموقع التقدم حياً.
// لا يطبع أي سر أبداً في السجلات. المهلة الكلية ~50 دقيقة (حد التشغيل).

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.GITHUB_REPOSITORY || 'koreaone10-del/omni-ai-chat';
const TOKEN = process.env.GITHUB_TOKEN || '';
const ROUTER_URL = 'https://freellmapi-production-c529c3c7.up.railway.app/v1';
const FL_KEY = process.env.FREELLMAPI_KEY || '';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';

const payload = JSON.parse(process.env.JOB_PAYLOAD || '{}');
const jobId = String(payload.jobId || 'job_unknown');
const type = ['research', 'summary', 'image', 'code'].includes(payload.type) ? payload.type : 'research';
const title = String(payload.title || 'مهمة').slice(0, 120);
const prompt = String(payload.prompt || '').slice(0, 20000);
const OUT = join('jobs', 'results');
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/jobs/jobs/results/`;

const state = {
  jobId, type, title, status: 'running', progress: 5,
  steps: [], result: null, error: null, updatedAt: new Date().toISOString()
};

function log(...a) { console.log('[worker]', ...a); }
function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts });
}
function stripHtml(html) {
  let t = String(html || '');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
  return t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// --- git: فرع `jobs` (يُنشأ عند أول مهمة) ---
function gitInit() {
  mkdirSync(OUT, { recursive: true });
  run('git config user.name "chibani-agent"');
  run('git config user.email "agent@chibani.ai"');
  run(`git remote set-url origin https://x-access-token:${TOKEN}@github.com/${REPO}.git`);
  try { run('git fetch origin jobs --depth=1'); run('git checkout jobs'); }
  catch { run('git checkout -B jobs'); }
  mkdirSync(OUT, { recursive: true });
}
function commitProgress(msg) {
  state.updatedAt = new Date().toISOString();
  writeFileSync(join(OUT, jobId + '.json'), JSON.stringify(state, null, 2));
  try {
    run(`git add jobs/results/${jobId}.json jobs/results/${jobId}.md jobs/results/${jobId}.jpg jobs/results/${jobId}.html 2>/dev/null || git add jobs/results/${jobId}.json`);
    run(`git -c user.name="chibani-agent" -c user.email="agent@chibani.ai" commit -m ${JSON.stringify('job ' + jobId + ': ' + msg)} --allow-empty`);
    try { run('git push origin jobs'); }
    catch { try { run('git pull --rebase origin jobs'); run('git push origin jobs'); } catch (e) { log('push failed, will retry at the end'); } }
  } catch (e) { log('commit failed:', String(e.message || e).slice(0, 120)); }
}
function setStep(label, status, detail) {
  const ex = state.steps.find((s) => s.label === label);
  if (ex) { ex.status = status; ex.detail = detail || ex.detail; }
  else state.steps.push({ label, status, detail: detail || '' });
  state.progress = Math.min(95, 5 + Math.round((state.steps.filter((s) => s.status === 'done').length / Math.max(1, state.steps.length)) * 90));
  commitProgress(label + ' — ' + status);
}

// --- استدعاء نموذج لغوي: الراوتر أولاً، ثم Pollinations المجاني بلا مفتاح ---
async function callModel(messages, maxTokens = 2000) {
  if (FL_KEY) {
    try {
      const r = await fetch(ROUTER_URL + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + FL_KEY },
        body: JSON.stringify({ model: 'auto', messages, temperature: 0.6, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(90000)
      });
      if (r.ok) {
        const d = await r.json();
        const c = d.choices?.[0]?.message?.content;
        if (c) return c;
      }
      log('router failed:', r.status);
    } catch (e) { log('router error:', String(e.message || e).slice(0, 100)); }
  }
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const sys = (messages.find((m) => m.role === 'system')?.content || '') + '\n\n' + (lastUser?.content || '');
  const r = await fetch('https://text.pollinations.ai/' + encodeURIComponent(sys.slice(0, 6000)) + '?model=openai', { signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error('Pollinations ردّ بالحالة ' + r.status);
  return await r.text();
}

async function fetchPageText(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'CHIBANI-AI-agent/2.1', Accept: 'text/html,text/plain,*/*' },
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) return '';
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 200 * 1024) return '';
    return stripHtml(new TextDecoder('utf-8').decode(buf)).slice(0, 6000);
  } catch { return ''; }
}

function writeResultMd(body, files = []) {
  const md = '# ' + title + '\n\n' + body + '\n\n---\n\n_أُنجزت بواسطة وكيل CHIBANI AI الخفي على GitHub Actions — ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC_\n';
  writeFileSync(join(OUT, jobId + '.md'), md);
  state.result = { title, md, files };
}

// --- أنواع المهام ---
async function doResearch() {
  setStep('تخطيط البحث', 'running');
  const plan = await callModel([
    { role: 'system', content: 'You are a research planner. Answer in Arabic.' },
    { role: 'user', content: 'الموضوع: ' + prompt + '\n\nضع خطة بحث: 3-5 أسئلة فرعية، ثم قائمة بأفضل 3 روابط ويب لقراءتها (روابط حقيقية معروفة). أجب بهذا الشكل فقط:\nأسئلة:\n1. ...\nروابط:\n- https://...\n' }
  ], 1200);
  setStep('تخطيط البحث', 'done', plan.slice(0, 200));
  const urls = [...new Set((plan.match(/https?:\/\/[^\s<>"')\]]+/g) || []).slice(0, 3))];
  let sources = '';
  for (const u of urls) {
    setStep('قراءة ' + u.slice(0, 60), 'running');
    const txt = await fetchPageText(u);
    if (txt) sources += '\n\n[مصدر: ' + u + ']\n' + txt.slice(0, 4000);
    setStep('قراءة ' + u.slice(0, 60), txt ? 'done' : 'failed', txt ? txt.length + ' حرف' : 'تعذّر الجلب');
  }
  setStep('كتابة التقرير', 'running');
  const report = await callModel([
    { role: 'system', content: 'You are a thorough researcher. Write in Arabic, with sources cited inline.' },
    { role: 'user', content: 'الموضوع: ' + prompt + '\n\nالمصادر المقروءة:\n' + (sources || 'لا مصادر مقروءة — اعتمد على معرفتك ووضّح ذلك.') + '\n\nاكتب تقريراً منظماً: خلاصة، النقاط الأساسية، مقارنة إن وُجدت، ثم المصادر. لا تخترع روابط.' }
  ], 4000);
  setStep('كتابة التقرير', 'done');
  writeResultMd(report);
}

async function doSummary() {
  setStep('تقسيم النص', 'running');
  const chunks = prompt.match(/[\s\S]{1,6000}/g) || [prompt];
  setStep('تقسيم النص', 'done', chunks.length + ' مقاطع');
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    setStep('تلخيص المقطع ' + (i + 1) + '/' + chunks.length, 'running');
    const s = await callModel([
      { role: 'system', content: 'You are a summarizer. Answer in Arabic with bullet points, keeping all facts, numbers and names.' },
      { role: 'user', content: 'لخّص هذا النص في نقاط واضحة:\n\n' + chunks[i] }
    ], 1500);
    parts.push(s);
    setStep('تلخيص المقطع ' + (i + 1) + '/' + chunks.length, 'done');
  }
  setStep('دمج الملخص', 'running');
  const final = parts.length > 1
    ? await callModel([
        { role: 'system', content: 'You are a summarizer. Answer in Arabic.' },
        { role: 'user', content: 'ادمج هذه الملخصات الجزئية في ملخص واحد متماسك بنقاط واضحة:\n\n' + parts.join('\n\n---\n\n') }
      ], 2500)
    : parts[0];
  setStep('دمج الملخص', 'done');
  writeResultMd(final);
}

async function doImage() {
  setStep('توليد الصورة', 'running');
  const enPrompt = prompt;
  let saved = false;
  if (CF_TOKEN && CF_ACCOUNT) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: enPrompt, steps: 4 }),
        signal: AbortSignal.timeout(120000)
      });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 5000) {
          writeFileSync(join(OUT, jobId + '.jpg'), buf);
          saved = true;
        }
      } else log('cloudflare image failed:', r.status);
    } catch (e) { log('cloudflare image error:', String(e.message || e).slice(0, 100)); }
  }
  if (!saved) {
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(enPrompt) + '?width=1024&height=1024&nologo=true&model=flux';
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error('Pollinations ردّ بالحالة ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 5000) throw new Error('الصورة المولّدة فارغة.');
    writeFileSync(join(OUT, jobId + '.jpg'), buf);
    saved = true;
  }
  setStep('توليد الصورة', 'done');
  writeResultMd(`![${title}](${RAW_BASE + jobId + '.jpg'})\n\nالوصف: ${enPrompt}`, [jobId + '.jpg']);
}

async function doCode() {
  setStep('كتابة الصفحة', 'running');
  const code = await callModel([
    { role: 'system', content: 'You are an expert web developer. Output ONLY the complete HTML file (with inline CSS/JS), no explanation, no markdown fences.' },
    { role: 'user', content: 'اكتب صفحة ويب كاملة (HTML + CSS + JS مضمّن) لهذا الطلب:\n\n' + prompt }
  ], 6000);
  let html = code.replace(/^```html\s*/i, '').replace(/```\s*$/, '').trim();
  if (!html.toLowerCase().includes('<html')) html = '<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head><meta charset="utf-8"><title>' + title.replace(/</g, '') + '</title></head>\n<body>\n' + html + '\n</body>\n</html>';
  writeFileSync(join(OUT, jobId + '.html'), html);
  setStep('كتابة الصفحة', 'done');
  writeResultMd(`صفحة الويب جاهزة: [فتح الصفحة](${RAW_BASE + jobId + '.html'})\n\nالطلب: ${prompt}`, [jobId + '.html']);
}

// --- التشغيل ---
try {
  gitInit();
  state.steps = [];
  commitProgress('started');
  if (type === 'research') await doResearch();
  else if (type === 'summary') await doSummary();
  else if (type === 'image') await doImage();
  else await doCode();
  state.status = 'done';
  state.progress = 100;
  commitProgress('done');
  log('job done:', jobId);
} catch (e) {
  state.status = 'failed';
  state.error = String(e.message || e).slice(0, 300);
  try { commitProgress('failed'); } catch {}
  log('job failed:', state.error);
  process.exitCode = 1;
}
