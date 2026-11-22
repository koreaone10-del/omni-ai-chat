'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { PROVIDERS, getProvider, AUTO_ORDER } from '@/lib/providers';
import { estimateTokens, formatTokens } from '@/lib/tokens';
import { loadKeyPool, saveKeyPool, addKeyToPool, generateAppApiKey } from '@/lib/keys';

const PLANS = {
  free: { name: 'مجانية', price: '0$', limit: 100000, images: 5 },
  pro: { name: 'Pro', price: '4.99$/شهر', limit: 2000000, images: 200 },
  business: { name: 'Business', price: '14.99$/شهر', limit: 10000000, images: 2000 }
};
const FREE_LIMIT = 100000;

// ---------- markdown خفيف (بدون مكتبات) ----------
function inlineMd(text, keyPrefix) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={keyPrefix + i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={keyPrefix + i}>{p.slice(1, -1)}</code>;
    return <span key={keyPrefix + i}>{p}</span>;
  });
}
function renderMd(text) {
  const t = String(text || '');
  const blocks = t.split(/```(\w*)\n?([\s\S]*?)```/g);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i % 3 === 2) {
      out.push(<pre key={'pre' + i} dir="ltr"><code>{blocks[i]}</code></pre>);
      continue;
    }
    if (i % 3 === 1) continue; // لغة الكتلة
    const lines = blocks[i].split('\n');
    let list = [];
    const flush = () => { if (list.length) { out.push(<ul key={'ul' + out.length}>{list.map((li, j) => <li key={j}>{inlineMd(li, 'li' + j)}</li>)}</ul>); list = []; } };
    lines.forEach((line, j) => {
      if (line.startsWith('### ')) { flush(); out.push(<h3 key={'h' + i + j}>{inlineMd(line.slice(4), 'h')}</h3>); }
      else if (line.startsWith('## ')) { flush(); out.push(<h2 key={'h' + i + j}>{inlineMd(line.slice(3), 'h')}</h2>); }
      else if (line.startsWith('# ')) { flush(); out.push(<h1 key={'h' + i + j}>{inlineMd(line.slice(2), 'h')}</h1>); }
      else if (/^[-*]\s+/.test(line)) { list.push(line.replace(/^[-*]\s+/, '')); }
      else if (/^\d+\.\s+/.test(line)) { list.push(line.replace(/^\d+\.\s+/, '')); }
      else if (line.trim()) { flush(); out.push(<p key={'p' + i + j}>{inlineMd(line, 'p' + j)}</p>); }
    });
    flush();
  }
  return <div className="md">{out}</div>;
}
function textOf(msg) {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return '';
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayKey() { return new Date().toISOString().slice(0, 10); }

export default function Home() {
  const [sessions, setSessions] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [input, setInput] = useState('');
  const [providerId, setProviderId] = useState('auto');
  const [model, setModel] = useState('');
  const [deepThinking, setDeepThinking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawer, setDrawer] = useState(null); // keys | settings | stats | image | video | pricing
  const [authOpen, setAuthOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [plan, setPlan] = useState('free');
  const [daily, setDaily] = useState({ date: todayKey(), tokens: 0, images: 0 });
  const [keys, setKeys] = useState({});
  const [attachments, setAttachments] = useState([]);
  const [copied, setCopied] = useState('');
  const [authStep, setAuthStep] = useState(1);
  const [authContact, setAuthContact] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authSent, setAuthSent] = useState('');
  const [newKeyProvider, setNewKeyProvider] = useState('groq');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [customBase, setCustomBase] = useState('http://localhost:3001/v1');
  const [flKey, setFlKey] = useState('');
  const [flTest, setFlTest] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [appKey, setAppKey] = useState('');
  const [testResult, setTestResult] = useState('');
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgSize, setImgSize] = useState('1024x1024');
  const [imgResult, setImgResult] = useState(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [vidPrompt, setVidPrompt] = useState('');
  const [vidProvider, setVidProvider] = useState('replicate');
  const [vidResult, setVidResult] = useState(null);
  const [vidLoading, setVidLoading] = useState(false);
  const [showThink, setShowThink] = useState({});
  const fileRef = useRef(null);
  const chatRef = useRef(null);

  // تحميل الحالة المحفوظة
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('omni_sessions') || '[]');
      if (s.length) { setSessions(s); setCurrentId(s[0].id); }
      else { const first = { id: uid(), title: 'محادثة جديدة', messages: [], tokens: 0, createdAt: Date.now() }; setSessions([first]); setCurrentId(first.id); }
      setKeys(loadKeyPool());
      setUser(JSON.parse(localStorage.getItem('omni_user') || 'null'));
      setPlan(localStorage.getItem('omni_plan') || 'free');
      const d = JSON.parse(localStorage.getItem('omni_daily') || 'null');
      if (d && d.date === todayKey()) setDaily(d);
      setAppKey(localStorage.getItem('omni_appkey') || '');
      setCustomBase(localStorage.getItem('omni_freellmapi_url') || 'http://localhost:3001/v1');
      setFlKey(localStorage.getItem('omni_freellmapi_key') || '');
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('omni_sessions', JSON.stringify(sessions)); } catch {} }, [sessions]);
  useEffect(() => { saveKeyPool(keys); }, [keys]);
  useEffect(() => { try { localStorage.setItem('omni_daily', JSON.stringify(daily)); } catch {} }, [daily]);
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }); }, [sessions, loading]);
  // إغلاق القائمة/الدرج/النافذة بزر Escape — يعيد دائماً إلى عرض محادثة نظيف
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSidebarOpen(false); setDrawer(null); setAuthOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = sessions.find((s) => s.id === currentId) || sessions[0];
  const totalTokens = useMemo(() => sessions.reduce((n, s) => n + (s.tokens || 0), 0), [sessions]);
  const planInfo = PLANS[plan];
  const remaining = Math.max(0, planInfo.limit - daily.tokens);
  const provider = getProvider(providerId === 'auto' ? 'groq' : providerId);
  const models = providerId === 'auto' ? ['تلقائي — يختار الأفضل المتاح'] : provider.models;

  function updateSession(id, fn) { setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s))); }
  function newChat() {
    const s = { id: uid(), title: 'محادثة جديدة', messages: [], tokens: 0, createdAt: Date.now() };
    setSessions((p) => [s, ...p]); setCurrentId(s.id); setAttachments([]); setSidebarOpen(false);
  }
  function renameSession(s) {
    const name = window.prompt('اسم جديد للمحادثة:', s.title);
    if (name && name.trim()) updateSession(s.id, (x) => ({ ...x, title: name.trim().slice(0, 60) }));
  }
  function copyText(text, id) {
    const done = () => { setCopied(id); setTimeout(() => setCopied(''), 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch {} ta.remove(); }

  // ---------- الملفات ----------
  function handleFiles(files) {
    [...files].forEach((f) => {
      if (f.type.startsWith('image/')) {
        const r = new FileReader();
        r.onload = () => setAttachments((p) => [...p, { id: uid(), name: f.name, kind: 'image', dataUrl: r.result, tokens: 800 }]);
        r.readAsDataURL(f);
      } else if (f.name.toLowerCase().endsWith('.pdf')) {
        setAttachments((p) => [...p, { id: uid(), name: f.name, kind: 'pdf', content: '', tokens: 0, note: 'PDF: انسخ النص من الملف والصقه هنا — استخراج نص PDF غير متوفر في المتصفح.' }]);
      } else if (f.size > 2_000_000) {
        setAttachments((p) => [...p, { id: uid(), name: f.name, kind: 'note', content: '', tokens: 0, note: 'الملف أكبر من 2MB — الصق جزءاً منه كنص بدلاً من ذلك.' }]);
      } else {
        const r = new FileReader();
        r.onload = () => setAttachments((p) => [...p, { id: uid(), name: f.name, kind: 'text', content: String(r.result || ''), tokens: estimateTokens(String(r.result || '')) }]);
        r.readAsText(f);
      }
    });
  }
  function onPaste(e) {
    const items = e.clipboardData?.items || [];
    let hasFile = false;
    for (const it of items) {
      if (it.kind === 'file') { hasFile = true; handleFiles([it.getAsFile()]); }
    }
    if (hasFile) e.preventDefault();
  }

  // ---------- FreeLLMAPI ----------
  // خادم Vercel لا يستطيع الوصول إلى localhost على جهاز المستخدم،
  // لذا رابط localhost يُطلب مباشرة من المتصفح (نفس الجهاز)،
  // والرابط العام (https) يمر عبر وكيل خادم الموقع /api/chat.
  function isLocalRouterUrl(url) {
    try {
      const u = new URL(String(url || '').includes('://') ? url : 'http://' + url);
      const h = u.hostname.toLowerCase();
      return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
    } catch { return String(url || '').includes('localhost') || String(url || '').includes('127.0.0.1'); }
  }
  function flPath() { return isLocalRouterUrl(customBase) ? 'مباشر من المتصفح' : 'عبر خادم الموقع'; }
  function saveFlKey(v) { setFlKey(v); try { localStorage.setItem('omni_freellmapi_key', v); } catch {} }
  function saveFlUrl(v) { setCustomBase(v); try { localStorage.setItem('omni_freellmapi_url', v); } catch {} }

  async function testFreellmapi() {
    const base = String(customBase || '').replace(/\/$/, '');
    if (!base) { setFlTest('أدخل رابط الراوتر أولاً (الافتراضي http://localhost:3001/v1).'); return; }
    if (!flKey.trim()) { setFlTest('أدخل المفتاح الموحد freellmapi-… من صفحة Keys في لوحة الراوتر أولاً.'); return; }
    setFlTest('جارٍ اختبار الاتصال من متصفحك…');
    try {
      const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + flKey.trim() }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        setFlTest(r.status === 401 ? 'المفتاح غير صحيح (401) — تأكد من نسخ المفتاح الموحد كاملاً من لوحة الراوتر.' : 'الراوتر ردّ بالحالة ' + r.status + ': ' + t.slice(0, 150));
        return;
      }
      const data = await r.json();
      const n = Array.isArray(data.data) ? data.data.length : 0;
      setFlTest('✓ الاتصال يعمل — الراوتر ردّ ويعرض ' + n + ' نموذجاً. المسار: ' + flPath() + '.');
    } catch (e) {
      setFlTest(isLocalRouterUrl(base)
        ? 'تعذّر الوصول إلى الراوتر على هذا الجهاز. تأكد أن FreeLLMAPI يعمل (افتح http://localhost:3001 في متصفحك)، أو استعمل رابطاً عاماً عبر Cloudflare Tunnel / خادم VPS. الخطأ: ' + String(e.message || e)
        : 'تعذّر الوصول إلى الرابط العام: ' + String(e.message || e));
    }
  }

  // إرسال مباشر من المتصفح إلى راوتر localhost (نفس الجهاز)
  async function sendDirectViaRouter(apiMessages, modelName, systemExtra) {
    const base = String(customBase || '').replace(/\/$/, '');
    const payload = {
      model: modelName || 'auto',
      messages: [{ role: 'system', content: systemExtra }, ...apiMessages],
      temperature: 0.7
    };
    let r;
    try {
      r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + flKey.trim() },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90000)
      });
    } catch (e) {
      throw new Error('الراوتر لا يردّ على هذا الجهاز — تأكد أن FreeLLMAPI يعمل (افتح http://localhost:3001 في متصفحك) وأنه يسمح بالاتصال من المتصفح، أو استعمل رابطاً عاماً (Cloudflare Tunnel / VPS).');
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(r.status === 401 ? 'المفتاح الموحد غير صحيح (401) — أعد نسخه كاملاً من صفحة Keys في لوحة الراوتر.' : 'الراوتر ردّ بالحالة ' + r.status + ': ' + txt.slice(0, 200));
    }
    const data = await r.json();
    const choice = data.choices?.[0]?.message;
    let content = choice?.content || '';
    let reasoning = choice?.reasoning_content || data.choices?.[0]?.reasoning || null;
    if (!reasoning && deepThinking && content.includes('التفكير:')) {
      const parts = content.split('الإجابة:');
      if (parts.length > 1) { reasoning = parts[0].replace('التفكير:', '').trim(); content = parts.slice(1).join('الإجابة:').trim(); }
    }
    const usage = data.usage || { total_tokens: estimateTokens(content) };
    return { content, usage, modelUsed: data.model || modelName || 'auto', providerUsed: 'freellmapi', reasoning, via: 'مباشر من المتصفح' };
  }

  // ---------- الإرسال ----------
  async function sendMessage(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!text && attachments.length === 0) return;
    if (daily.tokens >= planInfo.limit) { setError('بلغت حد الخطة اليومي (' + formatTokens(planInfo.limit) + ' توكن). راجع الأسعار للترقية أو انتظر الغد.'); setDrawer('pricing'); return; }
    if (!current) return;
    setError('');
    const attachText = attachments.filter((a) => a.kind === 'text').map((a) => `\n\n[ملف: ${a.name}]\n${a.content.slice(0, 12000)}`).join('');
    const imageAtt = attachments.find((a) => a.kind === 'image');
    const pdfNote = attachments.filter((a) => a.kind === 'pdf').map((a) => `\n[ملف PDF مرفق: ${a.name} — لم يُستخرج نصه، انسخ نصه والصقه.]`).join('');
    let userContent = text + attachText + pdfNote;
    let apiContent = userContent;
    if (imageAtt && providerId !== 'auto' && provider.supportsVision) {
      apiContent = [{ type: 'text', text: userContent || 'صف هذه الصورة وحلّلها.' }, { type: 'image_url', image_url: { url: imageAtt.dataUrl } }];
    }
    const userMsg = { role: 'user', content: userContent, tokens: estimateTokens(userContent) };
    const history = [...current.messages, userMsg];
    updateSession(current.id, (s) => ({ ...s, title: s.messages.length === 0 ? text.slice(0, 40) || 'محادثة جديدة' : s.title, messages: history, tokens: (s.tokens || 0) + userMsg.tokens }));
    setInput(''); setAttachments([]); setLoading(true);
    try {
      const apiMessages = history.map((m) => ({ role: m.role, content: m.role === 'user' && m === userMsg ? apiContent : m.content }));
      const systemExtra = deepThinking
        ? 'فكّر خطوة بخطوة بعمق قبل الإجابة. ابدأ إجابتك بقسم قصير بعنوان "التفكير:" يلخّص خطوات تفكيرك (3-6 أسطر)، ثم ضع الإجابة النهائية بعد سطر "الإجابة:".'
        : 'أجب بدقة وبشكل مباشر ومنظّم.';
      let data;
      if (providerId === 'freellmapi') {
        // --- FreeLLMAPI: مفتاح موحد + مساران (مباشر للـ localhost، وكيل للرابط العام) ---
        if (!flKey.trim()) {
          setError('أضف المفتاح الموحد (freellmapi-…) من لوحة الراوتر في إعدادات FreeLLMAPI أولاً.');
          setDrawer('freellmapi');
          return;
        }
        const modelName = (model || '').trim() || 'auto';
        if (isLocalRouterUrl(customBase)) {
          data = await sendDirectViaRouter(apiMessages, modelName, systemExtra);
        } else {
          const res = await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: apiMessages,
              providerId, model: modelName,
              apiKeys: { ...keys, freellmapi: [{ value: flKey.trim(), status: 'active' }] },
              baseURL: customBase, deepThinking
            })
          });
          data = await res.json();
          if (!res.ok) throw new Error(data.error || 'فشل الطلب.');
          data.via = 'عبر خادم الموقع';
        }
      } else {
        const res = await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: apiMessages,
            providerId, model: providerId === 'auto' ? undefined : (model || provider.models[0]),
            apiKeys: keys, baseURL: providerId === 'custom' ? customBase : undefined,
            deepThinking
          })
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل الطلب.');
      }
      const used = data.usage?.total_tokens || estimateTokens(data.content);
      const aiMsg = { role: 'assistant', content: data.content, provider: data.providerUsed, model: data.modelUsed, tokens: used, reasoning: data.reasoning || null, via: data.via || null };
      updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, aiMsg], tokens: (s.tokens || 0) + used }));
      setDaily((d) => ({ ...d, tokens: d.tokens + used }));
    } catch (e) {
      setError(String(e.message || e));
    } finally { setLoading(false); }
  }

  // ---------- المصادقة التجريبية ----------
  function sendAuthCode() {
    if (!authContact.trim()) { setError('أدخل بريداً إلكترونياً أو رقم هاتف أولاً.'); return; }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setAuthSent(code); setAuthStep(2); setError('');
  }
  function verifyAuthCode() {
    if (authCode.trim() === authSent && authSent) {
      const u = { contact: authContact.trim(), createdAt: Date.now() };
      setUser(u); try { localStorage.setItem('omni_user', JSON.stringify(u)); } catch {}
      setAuthOpen(false); setAuthStep(1); setAuthCode(''); setAuthSent('');
    } else setError('الرمز غير صحيح — تحقق من الرمز الظاهر في النافذة وأعد المحاولة.');
  }

  // ---------- المفاتيح ----------
  function addKey() {
    if (!newKeyValue.trim()) return;
    setKeys((p) => addKeyToPool(p, newKeyProvider, newKeyValue.trim()));
    setNewKeyValue(''); setTestResult('تمت إضافة المفتاح. جرّب زر "اختبار" للتأكد منه.');
  }
  async function testKey(pid, idx) {
    setTestResult('جارٍ اختبار المفتاح…');
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'قل: ok' }], providerId: pid, model: getProvider(pid).models[0], apiKeys: { [pid]: [keys[pid][idx]] }, baseURL: pid === 'freellmapi' ? customBase : undefined }) });
      const data = await res.json();
      setTestResult(res.ok ? 'المفتاح يعمل ✓ — رد المزود: ' + String(data.content || '').slice(0, 80) : 'المفتاح فشل: ' + (data.error || res.status));
    } catch (e) { setTestResult('تعذّر الاختبار: ' + String(e.message || e)); }
  }

  // ---------- الصور والفيديو ----------
  async function genImage() {
    if (!imgPrompt.trim()) return;
    if (daily.images >= planInfo.images) { setError('بلغت حد صور اليوم في خطتك (' + planInfo.images + ').'); setDrawer('pricing'); return; }
    setImgLoading(true); setImgResult(null);
    try {
      const res = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: imgPrompt, providerId: 'openai', apiKeys: keys, size: imgSize }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل توليد الصورة.');
      setImgResult(data); setDaily((d) => ({ ...d, images: d.images + 1 }));
    } catch (e) { setImgResult({ error: String(e.message || e) }); }
    finally { setImgLoading(false); }
  }
  async function genVideo() {
    if (!vidPrompt.trim()) return;
    setVidLoading(true); setVidResult(null);
    try {
      const res = await fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: vidPrompt, provider: vidProvider, apiKeys: keys }) });
      const data = await res.json();
      setVidResult({ status: res.status, ...data });
    } catch (e) { setVidResult({ error: String(e.message || e) }); }
    finally { setVidLoading(false); }
  }

  function exportSession(fmt) {
    if (!current) return;
    const data = fmt === 'json'
      ? JSON.stringify(current, null, 2)
      : '# ' + current.title + '\n\n' + current.messages.map((m) => (m.role === 'user' ? '## أنت' : '## OmniAI' + (m.provider ? ` (${m.provider} / ${m.model})` : '')) + '\n\n' + textOf(m) + '\n').join('\n');
    const blob = new Blob([data], { type: fmt === 'json' ? 'application/json' : 'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (current.title || 'session').replace(/[^\w\-]+/g, '-') + '.' + (fmt === 'json' ? 'json' : 'md'); a.click();
  }

  const stats = useMemo(() => {
    const per = {};
    sessions.forEach((s) => s.messages.forEach((m) => { if (m.role === 'assistant' && m.provider) per[m.provider] = (per[m.provider] || 0) + 1; }));
    return { sessions: sessions.length, messages: sessions.reduce((n, s) => n + s.messages.length, 0), per };
  }, [sessions]);

  const currentModelLabel = providerId === 'auto' ? '⚡ تلقائي' : provider.name + (model ? ' · ' + model : '');

  return (
    <div className="app">
      {/* خلفية معتمة للقائمة الجانبية على الهاتف — النقر عليها يغلقها */}
      {sidebarOpen && <div className="backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      {/* الشريط الجانبي */}
      <aside className={'sidebar' + (sidebarOpen ? ' open' : '')}>
        <div className="sidebar-head">
          <div className="logo">OmniAI <small>منصة ذكاء اصطناعي موحدة</small></div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="إغلاق القائمة">✕</button>
        </div>
        <button className="btn btn-block" onClick={newChat}>+ محادثة جديدة</button>
        <div className="stat-box">توكنات اليوم: <b>{formatTokens(daily.tokens)}</b> / {formatTokens(planInfo.limit)} — متبقٍ <b>{formatTokens(remaining)}</b><br />كل الجلسات: <b>{formatTokens(totalTokens)}</b> توكن · {sessions.length} جلسة</div>
        <div className="session-list">
          {sessions.map((s) => (
            <div key={s.id} className={'session-item' + (s.id === currentId ? ' active' : '')} onClick={() => { setCurrentId(s.id); setSidebarOpen(false); }}>
              <span>{s.title}</span><small>{formatTokens(s.tokens || 0)}</small>
              <span className="row-btns">
                <button className="icon-btn" title="إعادة تسمية" onClick={(e) => { e.stopPropagation(); renameSession(s); }}>✏️</button>
                <button className="icon-btn" title="حذف" onClick={(e) => { e.stopPropagation(); setSessions((p) => p.filter((x) => x.id !== s.id)); if (s.id === currentId) setCurrentId(sessions[0]?.id || null); }}>🗑</button>
              </span>
            </div>
          ))}
        </div>
        <div className="sidebar-foot">
          <button className="btn ghost" onClick={() => { setGuideOpen(true); setSidebarOpen(false); }}>🚀 FreeLLMAPI — 10.1 مليار توكن</button>
          <button className="btn ghost" onClick={() => { setDrawer('freellmapi'); setSidebarOpen(false); }}>⚙️ إعدادات FreeLLMAPI</button>
          <button className="btn ghost" onClick={() => { setDrawer('keys'); setSidebarOpen(false); }}>🔑 مدير المفاتيح</button>
          <button className="btn ghost" onClick={() => { setDrawer('image'); setSidebarOpen(false); }}>🖼 توليد الصور</button>
          <button className="btn ghost" onClick={() => { setDrawer('video'); setSidebarOpen(false); }}>🎬 توليد الفيديو</button>
          <button className="btn ghost" onClick={() => { setDrawer('stats'); setSidebarOpen(false); }}>📊 الإحصائيات</button>
          <button className="btn ghost" onClick={() => { setDrawer('pricing'); setSidebarOpen(false); }}>💎 الخطط والأسعار</button>
          <button className="btn ghost" onClick={() => { setDrawer('settings'); setSidebarOpen(false); }}>⚙️ الإعدادات</button>
          {user
            ? <button className="btn ghost" onClick={() => { setUser(null); try { localStorage.removeItem('omni_user'); } catch {} }}>تسجيل الخروج ({user.contact})</button>
            : <button className="btn ghost" onClick={() => { setAuthOpen(true); setSidebarOpen(false); }}>👤 تسجيل الدخول / إنشاء حساب</button>}
        </div>
      </aside>

      {/* الرئيسي */}
      <main className="main">
        <header className="topbar-main">
          <button className="menu-btn" onClick={() => setSidebarOpen(true)} aria-label="فتح القائمة">☰</button>
          <span className="brand">OmniAI</span>
          <span className="model-pill">{currentModelLabel}</span>
          <span className="spacer" />
          <span className="plan-pill">الخطة: <b>{planInfo.name}</b> — {planInfo.price}</span>
          {user
            ? <button className="btn ghost small" onClick={() => { setUser(null); try { localStorage.removeItem('omni_user'); } catch {} }}>👤 {user.contact}</button>
            : <button className="btn ghost small" onClick={() => setAuthOpen(true)}>👤 دخول</button>}
        </header>

        <div className="hero">
          <span className="tagline"><b>مزودون متعددون</b> · تدوير مفاتيح تلقائي عند نفاد الرصيد</span>
          <span className="pills">
            <span className="pill">🤖 محادثة</span><span className="pill">🖼 صور</span><span className="pill">🎬 فيديو</span><span className="pill">🧠 تفكير عميق</span><span className="pill">📁 ملفات</span>
          </span>
        </div>

        <div className="controls">
          <select value={providerId} onChange={(e) => { setProviderId(e.target.value); setModel(''); }} aria-label="المزود">
            <option value="auto">⚡ تلقائي — أفضل مزود متاح</option>
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}{p.needsKey ? '' : ' (بدون مفتاح)'}</option>)}
          </select>
          {providerId === 'freellmapi' ? (
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="auto — يختار الراوتر، أو اكتب اسم نموذج" aria-label="النموذج" dir="ltr" />
          ) : (
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="النموذج">
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <button className={'toggle' + (deepThinking ? ' on' : '')} onClick={() => setDeepThinking(!deepThinking)} title="يطلب من النموذج التفكير خطوة بخطوة ويعرض قسم التفكير">🧠 تفكير عميق {deepThinking ? 'مفعّل' : 'متوقف'}</button>
          {current && (
            <span className="actions">
              <button className="btn ghost small" onClick={() => copyText(current.messages.map((m) => (m.role === 'user' ? 'أنت: ' : 'OmniAI: ') + textOf(m)).join('\n\n'), 'all')}>{copied === 'all' ? '✓ تم النسخ' : '📋 نسخ الجلسة'}</button>
              <button className="btn ghost small" onClick={() => exportSession('md')}>⬇ تصدير .md</button>
              <button className="btn ghost small" onClick={() => exportSession('json')}>⬇ تصدير .json</button>
            </span>
          )}
        </div>

        <div className="chat" ref={chatRef}>
          <div className="chat-inner">
            {!current || current.messages.length === 0 ? (
              <div className="empty">
                <h2>مرحباً بك في OmniAI 👋</h2>
                <p>اسأل أي شيء، ارفع ملفاً، أو ولّد صورة. اختر «تلقائي» وسيجرّب الموقع المزودين المجانيين أولاً، وينتقل للبديل تلقائياً إذا نفد رصيد مفتاح.</p>
                <p style={{ fontSize: 13, marginTop: 8 }}>للبدء مجاناً: أضف مفتاح Groq من <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a> عبر «مدير المفاتيح»، أو جرّب Pollinations بدون مفتاح.</p>
                <p style={{ fontSize: 13, marginTop: 8 }}>أو استعمل <b>FreeLLMAPI</b> — راوتر يجمع الحصص المجانية لـ 87 مزوداً خلف مفتاح واحد: <button className="btn ghost small" onClick={() => setGuideOpen(true)}>🚀 دليل FreeLLMAPI — 10.1 مليار توكن</button></p>
                <div className="chips">
                  {['اشرح لي الذكاء الاصطناعي ببساطة', 'اكتب لي كود بايثون لفرز قائمة', 'ما الفرق بين Groq و OpenRouter؟', 'لخّص هذا النص في 3 نقاط'].map((q) => (
                    <button key={q} className="chip" onClick={() => sendMessage(q)}>{q}</button>
                  ))}
                </div>
              </div>
            ) : current.messages.map((m, i) => (
              <div key={i} className={'msg ' + m.role}>
                <div className={'avatar ' + (m.role === 'user' ? 'user' : 'ai')}>{m.role === 'user' ? '👤' : '✦'}</div>
                <div className="msg-body">
                  <div className="msg-meta">
                    <span>{m.role === 'user' ? 'أنت' : 'OmniAI'}</span>
                    {m.provider && <span>المزود: {getProvider(m.provider).name} · {m.model}</span>}
                    {m.via && <span>المسار: {m.via}</span>}
                    <span>{formatTokens(m.tokens || estimateTokens(textOf(m)))} توكن</span>
                  </div>
                  {renderMd(textOf(m))}
                  {m.reasoning && (
                    <details className="think" open={!!showThink[i]} onToggle={(e) => setShowThink((p) => ({ ...p, [i]: e.target.open }))}>
                      <summary>🧠 التفكير العميق — اضغط لعرض/إخفاء خطوات التفكير</summary>
                      <div style={{ marginTop: 6 }}>{renderMd(m.reasoning)}</div>
                    </details>
                  )}
                  <div className="msg-actions">
                    <button onClick={() => copyText(textOf(m), 'm' + i)}>{copied === 'm' + i ? '✓ تم النسخ' : '📋 نسخ'}</button>
                    {m.role === 'assistant' && <button onClick={() => { setInput(textOf(m)); }}>✏️ استخدام كنص</button>}
                  </div>
                </div>
              </div>
            ))}
            {loading && <div className="msg"><div className="avatar ai">✦</div><div className="msg-body"><div className="typing"><i /><i /><i /></div><span style={{ fontSize: 13, color: 'var(--muted)' }}>جارٍ التفكير…</span></div></div>}
            {error && <div className="note" style={{ borderColor: 'rgba(248,113,113,.5)', background: 'rgba(248,113,113,.08)' }}>⚠️ {error}</div>}
          </div>
        </div>

        <div className="composer">
          {attachments.length > 0 && (
            <div className="attach-bar">
              {attachments.map((a) => (
                <span key={a.id} className="attach-chip"><span>📎 {a.name} · ~{formatTokens(a.tokens || 0)} توكن {a.note ? '— ' + a.note : ''}</span>
                  <button onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))} aria-label="إزالة المرفق">✕</button></span>
              ))}
            </div>
          )}
          <div className="composer-row">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onPaste={onPaste}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="اكتب رسالتك… (Enter للإرسال، Shift+Enter لسطر جديد، الصق نصاً أو صورة بـ Ctrl+V)" />
            <button className="btn ghost" onClick={() => fileRef.current?.click()} title="رفع ملفات" aria-label="رفع ملفات">📎</button>
            <button className="send-btn" onClick={() => sendMessage()} disabled={loading}>{loading ? '…' : 'إرسال'}</button>
          </div>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
          <div className="token-line">
            <span>توكنات هذه الجلسة: <b>{formatTokens(current?.tokens || 0)}</b></span>
            <span>توكنات اليوم: {formatTokens(daily.tokens)} / {formatTokens(planInfo.limit)}</span>
            <span>صور اليوم: {daily.images} / {planInfo.images}</span>
            <span>المفاتيح المحفوظة: {Object.values(keys).flat().length} مفتاحاً</span>
          </div>
        </div>
      </main>

      {/* درج جانبي: مفاتيح / صور / فيديو / إحصائيات / أسعار / إعدادات */}
      {drawer && (
        <>
          <div className="backdrop" style={{ display: 'block', zIndex: 65 }} onClick={() => setDrawer(null)} aria-hidden="true" />
          <div className="drawer">
            <div className="drawer-head">
              <h2>{drawer === 'keys' ? '🔑 مدير المفاتيح' : drawer === 'image' ? '🖼 توليد الصور' : drawer === 'video' ? '🎬 توليد الفيديو' : drawer === 'stats' ? '📊 الإحصائيات' : drawer === 'pricing' ? '💎 الخطط والأسعار' : drawer === 'freellmapi' ? '🚀 FreeLLMAPI — الراوتر' : '⚙️ الإعدادات'}</h2>
              <button className="sidebar-close" style={{ display: 'inline-flex' }} onClick={() => setDrawer(null)} aria-label="إغلاق">✕</button>
            </div>

            {drawer === 'keys' && (<>
              <p>أضف عدة مفاتيح لكل مزود — عند نفاد رصيد مفتاح (429) ينتقل الموقع تلقائياً للمفتاح التالي. المفاتيح تُحفظ في متصفحك فقط.</p>
              <div className="field"><label>المزود</label>
                <select value={newKeyProvider} onChange={(e) => setNewKeyProvider(e.target.value)}>{PROVIDERS.filter((p) => p.needsKey).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </div>
              <div className="field"><label>المفتاح</label><input type="password" value={newKeyValue} onChange={(e) => setNewKeyValue(e.target.value)} placeholder="sk-..." dir="ltr" /></div>
              <button className="btn" onClick={addKey}>إضافة المفتاح</button>
              {testResult && <div className="note blue">{testResult}</div>}
              <h3>المفاتيح المحفوظة</h3>
              {Object.keys(keys).length === 0 && <p>لا مفاتيح بعد. ابدأ بمفتاح Groq مجاني من <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>.</p>}
              {Object.entries(keys).map(([pid, list]) => (
                <div key={pid}><b>{getProvider(pid).name}</b>
                  {list.map((k, idx) => (
                    <div key={idx} className="key-row">
                      <code>••••{String(k.value).slice(-6)}</code>
                      <span className={'badge' + (k.status === 'exhausted' ? ' exhausted' : '')}>{k.status === 'exhausted' ? 'مستنفد' : 'نشط'}</span>
                      <button className="btn ghost small" onClick={() => testKey(pid, idx)}>اختبار</button>
                      <button className="btn danger small" onClick={() => setKeys((p) => ({ ...p, [pid]: p[pid].filter((_, j) => j !== idx) }))}>حذف</button>
                    </div>
                  ))}
                </div>
              ))}
              <h3>مفتاح API الخاص بموقعك</h3>
              <p>ولّد مفتاحاً موحداً لتطبيقاتك تستعمله بدل توزيع مفاتيح المزودين.</p>
              <button className="btn ghost" onClick={() => { const k = generateAppApiKey(); setAppKey(k); try { localStorage.setItem('omni_appkey', k); } catch {} }}>توليد مفتاح API</button>
              {appKey && <div className="key-row"><code>{appKey}</code><button className="btn ghost small" onClick={() => copyText(appKey, 'appkey')}>{copied === 'appkey' ? '✓ نُسخ' : 'نسخ'}</button></div>}
              <h3>FreeLLMAPI — توضيح صادق</h3>
              <div className="note">أرقام «10.1 مليار توكن / 87 مزوداً» هي تقدير كتالوج المشروع الكلي، وليست حصة مضمونة لك. كل مزود يحتاج حسابه ومفتاحه وحدوده الخاصة. هذا الموقع يستطيع توجيه الطلبات إلى موجّه FreeLLMAPI يعمل على جهازك.</div>
              <div className="field"><label>رابط موجّه FreeLLMAPI</label><input value={customBase} onChange={(e) => { setCustomBase(e.target.value); try { localStorage.setItem('omni_freellmapi_url', e.target.value); } catch {} }} dir="ltr" /></div>
              <p>ثبّت المشروع من <a href="https://github.com/tashfeenahmed/freellmapi" target="_blank" rel="noreferrer">GitHub — freellmapi</a>، شغّله على المنفذ 3001، ثم اختر المزود «FreeLLMAPI Router (محلي)» من الأعلى.</p>
              <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setDrawer('freellmapi')}>فتح إعدادات FreeLLMAPI الكاملة</button>
            </>)}

            {drawer === 'freellmapi' && (<>
              <p>الراوتر يعمل على جهازك أنت — خادم Vercel لا يستطيع الوصول إلى localhost. لذلك: رابط محلي (localhost) يُرسل <b>مباشرة من متصفحك</b> إلى الراوتر، ورابط عام (https) يُرسل عبر خادم الموقع.</p>
              <div className="note blue">المسار الحالي: <b>{flPath()}</b> — {isLocalRouterUrl(customBase) ? 'الطلبات تخرج من متصفحك مباشرة إلى الراوتر على هذا الجهاز.' : 'الطلبات تمر عبر خادم الموقع إلى رابطك العام.'}</div>
              <div className="field"><label>رابط الراوتر</label><input value={customBase} onChange={(e) => saveFlUrl(e.target.value)} dir="ltr" placeholder="http://localhost:3001/v1" /></div>
              <div className="field"><label>المفتاح الموحد (freellmapi-…)</label><input type="password" value={flKey} onChange={(e) => saveFlKey(e.target.value)} placeholder="freellmapi-…" dir="ltr" /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={testFreellmapi}>اختبار الاتصال</button>
                <button className="btn ghost" onClick={() => { saveFlKey(''); saveFlUrl('http://localhost:3001/v1'); setFlTest('تم المسح — عاد الرابط إلى الافتراضي http://localhost:3001/v1.'); }}>مسح</button>
                <button className="btn ghost" onClick={() => { setDrawer(null); setGuideOpen(true); }}>📖 دليل التثبيت</button>
              </div>
              {flTest && <div className="note blue">{flTest}</div>}
              <h3>ملاحظة صادقة</h3>
              <div className="note">«10.1 مليار توكن» = مجموع الحصص المجانية لكل المزودين الـ 87 في كتالوج FreeLLMAPI، وليست رصيداً يمنحه لك أحد. كل مزود له حسابه ومفتاحه وحده الخاص. الكتالوج المجاني لقطة شهرية تتأخر 30 يوماً؛ الكتالوج الحي Premium بـ 19$/سنة (أو 49$ مدى الحياة). المشروع «للتجربة الشخصية فقط».</div>
            </>)}

            {drawer === 'image' && (<>
              <p>بدون مفتاح: Pollinations المجاني. مع مفتاح OpenAI: DALL·E 3.</p>
              <div className="field"><label>وصف الصورة</label><textarea value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)} rows={3} placeholder="مدينة مستقبلية عند الغروب، أسلوب سينمائي…" /></div>
              <div className="field"><label>الحجم</label><select value={imgSize} onChange={(e) => setImgSize(e.target.value)}><option>1024x1024</option><option>1024x1792</option><option>1792x1024</option></select></div>
              <button className="btn" onClick={genImage} disabled={imgLoading}>{imgLoading ? 'جارٍ التوليد…' : 'توليد الصورة'}</button>
              {imgResult?.note && <div className="note blue">{imgResult.note}</div>}
              {imgResult?.error && <div className="note">{imgResult.error}</div>}
              {imgResult?.url && (<>
                <img className="gen" src={imgResult.url} alt={imgPrompt} />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <a className="btn ghost small" href={imgResult.url} download target="_blank" rel="noreferrer">⬇ تنزيل الصورة</a>
                  <button className="btn ghost small" onClick={() => copyText(imgResult.url, 'imgurl')}>{copied === 'imgurl' ? '✓ نُسخ الرابط' : 'نسخ رابط الصورة'}</button>
                </div>
                <p>تم التوليد عبر: {imgResult.via === 'pollinations' ? 'Pollinations (مجاني)' : imgResult.via}</p>
              </>)}
            </>)}

            {drawer === 'video' && (<>
              <p>توليد الفيديو يحتاج مفتاحاً مدفوعاً (Replicate / Luma / Runway) — لا يوجد مزود فيديو مجاني موثوق بدون مفتاح، ولن نعرض فيديو وهمياً.</p>
              <div className="field"><label>وصف الفيديو</label><textarea value={vidPrompt} onChange={(e) => setVidPrompt(e.target.value)} rows={3} placeholder="موجة بحر تتحرك ببطء عند الفجر…" /></div>
              <div className="field"><label>المزود</label><select value={vidProvider} onChange={(e) => setVidProvider(e.target.value)}><option value="replicate">Replicate</option><option value="luma">Luma</option><option value="runway">Runway</option></select></div>
              <button className="btn" onClick={genVideo} disabled={vidLoading}>{vidLoading ? 'جارٍ…' : 'توليد الفيديو'}</button>
              {vidResult && <div className="note" style={{ marginTop: 12 }}>
                <b>{vidResult.error || 'نتيجة'}</b>
                {vidResult.howTo && <p style={{ marginTop: 6 }}>{vidResult.howTo}</p>}
                {vidResult.needsKey && <p style={{ marginTop: 6 }}>أضف المفتاح من «مدير المفاتيح» ثم أعد المحاولة.</p>}
              </div>}
            </>)}

            {drawer === 'stats' && (<>
              <div className="grid2">
                <div className="stat-box">كل التوكنات<br /><b>{formatTokens(totalTokens)}</b></div>
                <div className="stat-box">توكنات اليوم<br /><b>{formatTokens(daily.tokens)}</b></div>
                <div className="stat-box">الجلسات<br /><b>{stats.sessions}</b></div>
                <div className="stat-box">الرسائل<br /><b>{stats.messages}</b></div>
              </div>
              <h3>الردود حسب المزود</h3>
              {Object.keys(stats.per).length === 0 ? <p>لا ردود بعد — أرسل أول رسالة.</p> : Object.entries(stats.per).map(([p, n]) => <div key={p} className="key-row"><span style={{ flex: 1 }}>{getProvider(p).name}</span><b>{n} رداً</b></div>)}
              <h3>الخطة</h3>
              <p>خطتك الحالية: <b>{planInfo.name}</b> — حد اليوم {formatTokens(planInfo.limit)} توكن، {planInfo.images} صورة. متبقٍ اليوم: {formatTokens(remaining)} توكن.</p>
            </>)}

            {drawer === 'pricing' && (<>
              <p>الأسعار بالدولار. الدفع عبر Stripe غير متصل بعد — زر الترقية يشرح ذلك بصراحة ولن يخصم أي مبلغ.</p>
              <div className="plan-grid">
                {Object.entries(PLANS).map(([id, p]) => (
                  <div key={id} className={'plan' + (plan === id ? ' current' : '')}>
                    <b>{p.name}</b><div className="price">{p.price}</div>
                    <div>{formatTokens(p.limit)} توكن/يوم</div><div>{p.images} صورة/يوم</div>
                    {plan === id ? <div className="badge" style={{ marginTop: 8 }}>خطتك الحالية</div>
                      : <button className="btn small" style={{ marginTop: 8 }} onClick={() => { alert('الدفع غير متصل بعد: لم يتم ربط Stripe في هذه النسخة، ولن يُخصم أي مبلغ. للترقية التجريبية اختر الخطة من الإعدادات.'); setPlan(id); try { localStorage.setItem('omni_plan', id); } catch {} }}>ترقية إلى {p.name}</button>}
                  </div>
                ))}
              </div>
              <div className="note">الخطة المجانية: 100 ألف توكن/يوم تقديرياً عبر المزودين المجانيين و5 صور/يوم. الحدود تُحسب من تقدير التوكنات المحلي ومن usage المزود عند توفره.</div>
            </>)}

            {drawer === 'settings' && (<>
              <h3>الخطة</h3>
              <select value={plan} onChange={(e) => { setPlan(e.target.value); try { localStorage.setItem('omni_plan', e.target.value); } catch {} }}>
                {Object.entries(PLANS).map(([id, p]) => <option key={id} value={id}>{p.name} — {p.price}</option>)}
              </select>
              <h3>رابط FreeLLMAPI / نقطة نهاية مخصصة</h3>
              <input value={customBase} onChange={(e) => { setCustomBase(e.target.value); try { localStorage.setItem('omni_freellmapi_url', e.target.value); } catch {} }} dir="ltr" />
              <h3>البيانات المحلية</h3>
              <p>كل الجلسات والمفاتيح محفوظة في متصفحك فقط (localStorage). مسحها يحذف كل شيء نهائياً من هذا الجهاز.</p>
              <button className="btn danger" onClick={() => { if (confirm('حذف كل الجلسات والمفاتيح من هذا المتصفح؟')) { try { localStorage.clear(); } catch {} location.reload(); } }}>🗑 مسح كل البيانات المحلية</button>
              <h3>روابط مفيدة</h3>
              <p><a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">مفتاح Groq المجاني</a><br /><a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">مفتاح OpenRouter</a><br /><a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">توكن Hugging Face</a><br /><a href="https://github.com/tashfeenahmed/freellmapi" target="_blank" rel="noreferrer">مشروع FreeLLMAPI</a></p>
            </>)}
          </div>
        </>
      )}

      {/* دليل FreeLLMAPI */}
      {guideOpen && (
        <div className="modal-back" onClick={() => setGuideOpen(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>🚀 دليل FreeLLMAPI — 10.1 مليار توكن</h2>
            <p>FreeLLMAPI راوتر مفتوح المصدر يعمل على <b>جهازك أنت</b>: تضيف مفاتيح مزوديك فيه، فيعطيك مفتاحاً موحداً واحداً (freellmapi-…) يوجّه طلباتك عبر كل المزودين مع انتقال تلقائي للبديل عند بلوغ حدّ أو عطل.</p>
            <ol className="guide-steps">
              <li><b>ثبّت الراوتر على جهازك</b> (يحتاج Docker) — انسخ الأمر وشغّله في الطرفية:
                <div className="codeblock">curl -fsSL https://freellmapi.co/install.sh | bash</div>
                <button className="btn ghost small" onClick={() => copyText('curl -fsSL https://freellmapi.co/install.sh | bash', 'flcmd')}>{copied === 'flcmd' ? '✓ نُسخ الأمر' : '📋 نسخ أمر التثبيت'}</button>
                <div style={{ marginTop: 8 }}>أو ثبّت تطبيق سطح المكتب من <a href="https://freellmapi.co" target="_blank" rel="noreferrer">freellmapi.co</a> (Microsoft Store / macOS) — نفس الراوتر واللوحة.</div>
              </li>
              <li><b>افتح لوحة الراوتر</b> على <a href="http://localhost:3001" target="_blank" rel="noreferrer">http://localhost:3001</a>، ثم صفحة <b>Keys</b>، وأضف مفاتيح المزودين المجانية التي تريدها:
                <table className="guide-table">
                  <thead><tr><th>المزود</th><th>أين تحصل على المفتاح؟</th></tr></thead>
                  <tbody>
                    <tr><td>Groq</td><td><a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a></td></tr>
                    <tr><td>OpenRouter</td><td><a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a></td></tr>
                    <tr><td>DeepSeek</td><td><a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">platform.deepseek.com/api_keys</a></td></tr>
                    <tr><td>Hugging Face</td><td><a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">huggingface.co/settings/tokens</a></td></tr>
                    <tr><td>Mistral</td><td><a href="https://console.mistral.ai" target="_blank" rel="noreferrer">console.mistral.ai</a></td></tr>
                    <tr><td>Google AI Studio</td><td><a href="https://aistudio.google.com" target="_blank" rel="noreferrer">aistudio.google.com</a></td></tr>
                  </tbody>
                </table>
                القائمة الكاملة للمزودين الـ 87 (Google، Cerebras، Cloudflare، Cohere، NVIDIA وغيرها) في <a href="https://freellmapi.co" target="_blank" rel="noreferrer">freellmapi.co</a>.
              </li>
              <li><b>انسخ المفتاح الموحد</b> (freellmapi-…) من أعلى صفحة Keys في لوحة الراوتر، والصقه في إعدادات FreeLLMAPI هنا:
                <div style={{ marginTop: 8 }}><button className="btn" onClick={() => { setGuideOpen(false); setDrawer('freellmapi'); }}>فتح إعدادات FreeLLMAPI</button></div>
              </li>
              <li><b>اختبر الاتصال</b> من نفس اللوحة بزر «اختبار الاتصال»، ثم اختر المزود «FreeLLMAPI Router» من أعلى المحادثة، اترك النموذج <code>auto</code> ليختار الراوتر الأفضل، أو اكتب اسم نموذج معين، وأرسل رسالتك. ستظهر تحت كل رد عبارة «المسار: مباشر من المتصفح» أو «عبر خادم الموقع».</li>
            </ol>
            <div className="note">
              <b>ملاحظات صادقة — اقرأها قبل أن تتوقع 10 مليارات توكن:</b><br />
              • الرقم 10.1 مليار توكن/شهر = <b>مجموع</b> الحصص المجانية المعلنة لكل المزودين الـ 87 (1,313 endpoint) — وليس رصيداً يمنحه لك أحد. كل مزود له حسابه ومفتاحه وحده الخاص.<br />
              • الكتالوج المجاني لقطة شهرية تتأخر 30 يوماً عن الكتالوج الحي؛ الكتالوج الحي Premium بـ 19$/سنة (أو 49$ مدى الحياة) على freellmapi.co.<br />
              • المشروع مكتوب عليه «للتجربة الشخصية فقط» (Personal experimentation only).<br />
              • رابط localhost يعمل فقط من متصفح <b>نفس الجهاز</b> الذي يشغّل الراوتر — خادم Vercel لا يستطيع الوصول إليه. من الهاتف تحتاج الراوتر مكشوفاً عبر رابط عام (Cloudflare Tunnel أو خادم VPS)، ثم ضع ذلك الرابط في الإعدادات وستمر الطلبات عبر خادم الموقع.
            </div>
            <button className="btn" onClick={() => setGuideOpen(false)}>فهمت — إغلاق الدليل</button>
          </div>
        </div>
      )}

      {/* نافذة المصادقة */}
      {authOpen && (
        <div className="modal-back" onClick={() => setAuthOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>👤 تسجيل الدخول / إنشاء حساب</h2>
            <p>بالبريد الإلكتروني أو رقم الهاتف. <b>وضع تجريبي:</b> لا توجد خدمة SMS/بريد متصلة بعد، لذا يظهر رمز التحقق هنا في النافذة نفسها — في الإنتاج يُرسل عبر Twilio/Resend. لا ندّعي إرسال رسالة لم تُرسل.</p>
            {authStep === 1 ? (<>
              <div className="field"><label>البريد الإلكتروني أو رقم الهاتف</label><input value={authContact} onChange={(e) => setAuthContact(e.target.value)} placeholder="name@email.com أو +213…" dir="ltr" /></div>
              {error && <div className="note">{error}</div>}
              <button className="btn" onClick={sendAuthCode}>إرسال رمز التحقق (تجريبي)</button>
            </>) : (<>
              <div className="note green">🔐 رمزك التجريبي (يظهر هنا فقط لأن الوضع تجريبي): <b style={{ fontSize: 20, letterSpacing: 4 }} dir="ltr">{authSent}</b><br />أُرسل إلى: {authContact} — في الإنتاج يصل عبر SMS/بريد.</div>
              <div className="field"><label>رمز التحقق (6 أرقام)</label><input value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder="123456" dir="ltr" maxLength={6} /></div>
              {error && <div className="note">{error}</div>}
              <button className="btn" onClick={verifyAuthCode}>تأكيد الحساب</button>
              <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setAuthStep(1)}>تغيير البريد/الهاتف</button>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}
