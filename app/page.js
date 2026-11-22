'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { PROVIDERS, getProvider, AUTO_ORDER } from '@/lib/providers';
import { estimateTokens, formatTokens } from '@/lib/tokens';
import { loadKeyPool, saveKeyPool, addKeyToPool, generateAppApiKey } from '@/lib/keys';
import { detectIntent, ROUTE_LABELS } from '@/lib/intent';

const PLANS = {
  free: { name: 'مجانية', price: '0$', limit: 100000, images: 5 },
  pro: { name: 'Pro', price: '4.99$/شهر', limit: 2000000, images: 200 },
  business: { name: 'Business', price: '14.99$/شهر', limit: 10000000, images: 2000 }
};
const FREE_LIMIT = 100000;
// راوتر FreeLLMAPI المستضاف على Railway (عام، HTTPS) — لا Termux ولا localhost
const FL_DEFAULT_URL = 'https://freellmapi-production-c529c3c7.up.railway.app/v1';
const FL_DASHBOARD_URL = 'https://freellmapi-production-c529c3c7.up.railway.app/';
const PAGE_SIZE = 50; // نافذة عرض الرسائل — للجلسات الطويلة جداً

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
  if (msg.compare) return (msg.results || []).map((r) => `[${getProvider(r.provider).name}]: ${r.error ? 'خطأ — ' + r.error : (r.content || '')}`).join('\n\n');
  if (msg.kind === 'image') return '[صورة مولّدة: ' + (msg.prompt || '') + '] ' + (msg.imageUrl || '');
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return '';
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayKey() { return new Date().toISOString().slice(0, 10); }
// وصف صورة من سياق الجلسة — عندما يقول المستخدم «اريد صورة هنا» دون موضوع
function subjectFromHistory(messages) {
  const last = [...(messages || [])].reverse().find((m) => m.role === 'assistant' && textOf(m).trim());
  if (!last) return '';
  return textOf(last).replace(/https?:\/\/\S+/g, ' ').replace(/[#*`_[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

export default function Home() {
  const [sessions, setSessions] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [input, setInput] = useState('');
  const [providerId, setProviderId] = useState('auto');
  const [model, setModel] = useState('');
  const [deepThinking, setDeepThinking] = useState(false);
  const [compareOn, setCompareOn] = useState(false); // وضع المقارنة: نفس السؤال لعدة مزودين دفعة واحدة
  const [compareProviders, setCompareProviders] = useState([]); // المزودون المتنافسون المحددون
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawer, setDrawer] = useState(null); // keys | freellmapi | settings | stats | image | video | pricing
  const [sheet, setSheet] = useState(null); // model | tools — ورقة سفلية بأسلوب Claude
  const [pendingTool, setPendingTool] = useState(null); // أداة صريحة من ورقة "+" تفوز على الكشف التلقائي
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE); // نافذة الرسائل المعروضة
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
  const [customBase, setCustomBase] = useState(''); // نقطة نهاية مخصصة لمزود «custom» فقط
  const [flUrl, setFlUrl] = useState(''); // رابط راوتر FreeLLMAPI المستضاف (Railway)
  const [flKeys, setFlKeys] = useState([]); // مفاتيح FreeLLMAPI الموحدة — عدة حسابات مع تداول
  const [newFlKey, setNewFlKey] = useState('');
  const [flTest, setFlTest] = useState('');
  const [guideOpen, setGuideOpen] = useState(false); // دليل FreeLLMAPI
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
  const fileImageOnlyRef = useRef(null);
  const chatRef = useRef(null);
  const composerRef = useRef(null);
  const flCursorRef = useRef(0); // مؤشر التداول الدوري بين مفاتيح FreeLLMAPI

  // تحميل الحالة المحفوظة
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('omni_sessions') || '[]');
      if (s.length) { setSessions(s); setCurrentId(s[0].id); }
      else { const first = { id: uid(), title: 'محادثة جديدة', messages: [], tokens: 0, createdAt: Date.now() }; setSessions([first]); setCurrentId(first.id); }
      const loadedKeys = loadKeyPool();
      setKeys(loadedKeys);
      setUser(JSON.parse(localStorage.getItem('omni_user') || 'null'));
      setPlan(localStorage.getItem('omni_plan') || 'free');
      const d = JSON.parse(localStorage.getItem('omni_daily') || 'null');
      if (d && d.date === todayKey()) setDaily(d);
      setAppKey(localStorage.getItem('omni_appkey') || '');
      setCustomBase(localStorage.getItem('omni_custom_base') || '');
      setFlUrl(localStorage.getItem('omni_freellmapi_url') || FL_DEFAULT_URL);
      // مفاتيح FreeLLMAPI: قائمة جديدة، مع ترحيل المفتاح الواحد القديم كـ «حساب 1»
      let loadedFlKeys = [];
      try { loadedFlKeys = JSON.parse(localStorage.getItem('omni_freellmapi_keys') || '[]'); } catch {}
      if (!Array.isArray(loadedFlKeys) || !loadedFlKeys.length) {
        const oldSingle = localStorage.getItem('omni_freellmapi_key') || '';
        if (oldSingle.trim()) loadedFlKeys = [{ id: uid(), label: 'حساب 1', value: oldSingle.trim(), status: 'active', lastUsed: null, lastError: null }];
      }
      setFlKeys(loadedFlKeys);
      // وضع المقارنة: يُحمّل بعد المفاتيح لأنه يعتمد عليها
      const cmpEligible = (pid) => {
        if (pid === 'ollama' || pid === 'custom') return false;
        if (pid === 'pollinations') return true;
        if (pid === 'freellmapi') return loadedFlKeys.some((k) => k.status !== 'exhausted');
        return (loadedKeys[pid] || []).some((k) => k.status !== 'exhausted');
      };
      let savedCmp = null;
      try { savedCmp = JSON.parse(localStorage.getItem('omni_compare_providers') || 'null'); } catch {}
      if (Array.isArray(savedCmp)) {
        const valid = savedCmp.filter((id) => cmpEligible(id) && PROVIDERS.some((p) => p.id === id));
        setCompareProviders(valid.length ? valid : ['pollinations']);
        setCompareOn(localStorage.getItem('omni_compare_on') === '1' && valid.length > 0);
      } else {
        const dflt = ['groq', 'freellmapi', 'pollinations'].filter(cmpEligible);
        setCompareProviders(dflt.length ? dflt : ['pollinations']);
      }
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('omni_sessions', JSON.stringify(sessions)); } catch {} }, [sessions]);
  useEffect(() => { saveKeyPool(keys); }, [keys]);
  useEffect(() => { try { localStorage.setItem('omni_daily', JSON.stringify(daily)); } catch {} }, [daily]);
  useEffect(() => { try { localStorage.setItem('omni_compare_on', compareOn ? '1' : '0'); } catch {} }, [compareOn]);
  useEffect(() => { try { localStorage.setItem('omni_compare_providers', JSON.stringify(compareProviders)); } catch {} }, [compareProviders]);
  useEffect(() => { try { localStorage.setItem('omni_freellmapi_keys', JSON.stringify(flKeys)); } catch {} }, [flKeys]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [currentId]); // جلسة جديدة = أول 50 رسالة
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }); }, [sessions, loading]);
  // إغلاق القائمة/الدرج/الورقة/النافذة بزر Escape — يعيد دائماً إلى عرض محادثة نظيف
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSidebarOpen(false); setDrawer(null); setAuthOpen(false); setGuideOpen(false); setSheet(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = sessions.find((s) => s.id === currentId) || sessions[0];
  const totalTokens = useMemo(() => sessions.reduce((n, s) => n + (s.tokens || 0), 0), [sessions]);
  const planInfo = PLANS[plan];
  const remaining = Math.max(0, planInfo.limit - daily.tokens);
  const provider = getProvider(providerId === 'auto' ? 'groq' : providerId);

  // ---------- مفاتيح FreeLLMAPI: تداول دوري + حالة كل مفتاح ----------
  // ترتيب الإرسال يبدأ من مؤشر متحرك (round-robin بين الطلبات)،
  // والخادم يجرّب المفاتيح بالترتيب وينتقل للتالي عند 401/429/نفاد الرصيد.
  function flKeyEntries() {
    const list = flKeys.filter((k) => k.value && k.status !== 'exhausted').map((k) => ({ id: k.id, value: k.value, status: 'active' }));
    if (!list.length) return [];
    const start = flCursorRef.current % list.length;
    flCursorRef.current += 1;
    return [...list.slice(start), ...list.slice(0, start)];
  }
  function noteFlKeyUsed(sentOrder, keyIndex, ok, errMsg) {
    if (!Array.isArray(sentOrder) || sentOrder.length === 0) return;
    const entry = sentOrder[Math.min(keyIndex || 0, sentOrder.length - 1)];
    if (!entry?.id) return;
    setFlKeys((prev) => prev.map((k) => (k.id === entry.id
      ? { ...k, status: ok ? 'active' : (errMsg && /401|429|quota|رصيد|insufficient/i.test(String(errMsg)) ? 'exhausted' : k.status), lastUsed: Date.now(), lastError: ok ? null : String(errMsg || '').slice(0, 120) }
      : k)));
  }
  function saveFlUrl(v) { setFlUrl(v); try { localStorage.setItem('omni_freellmapi_url', v); } catch {} }
  function addFlKey() {
    const v = newFlKey.trim();
    if (!v) return;
    if (flKeys.some((k) => k.value === v)) { setFlTest('هذا المفتاح مضاف أصلاً.'); return; }
    setFlKeys((p) => [...p, { id: uid(), label: 'حساب ' + (p.length + 1), value: v, status: 'active', lastUsed: null, lastError: null }]);
    setNewFlKey(''); setFlTest('تمت إضافة المفتاح — جرّب «اختبار كل المفاتيح» للتأكد منه.');
  }
  async function testFreellmapi() {
    const base = String(flUrl || '').replace(/\/$/, '');
    if (!base) { setFlTest('أدخل رابط الراوتر أولاً (الافتراضي ' + FL_DEFAULT_URL + ').'); return; }
    if (!flKeys.length) { setFlTest('أضف مفتاحاً موحداً freellmapi-… من صفحة Keys في لوحة الراوتر أولاً.'); return; }
    setFlTest('جارٍ اختبار ' + flKeys.length + ' مفتاح عبر خادم الموقع…');
    const results = [];
    for (const k of flKeys) {
      try {
        const res = await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'قل: ok' }],
            providerId: 'freellmapi', model: 'auto',
            apiKeys: { freellmapi: [{ value: k.value, status: 'active' }] },
            baseURL: base, deepThinking: false
          })
        });
        const data = await res.json();
        const ok = res.ok;
        results.push(k.label + ': ' + (ok ? '✓ يعمل' : '✗ فشل (' + String(data?.error || res.status).slice(0, 60) + ')'));
        setFlKeys((prev) => prev.map((x) => (x.id === k.id ? { ...x, status: ok ? 'active' : 'exhausted', lastUsed: Date.now(), lastError: ok ? null : String(data?.error || res.status).slice(0, 120) } : x)));
      } catch (e) {
        results.push(k.label + ': ✗ تعذّر الوصول');
        setFlKeys((prev) => prev.map((x) => (x.id === k.id ? { ...x, lastUsed: Date.now(), lastError: String(e.message || e).slice(0, 120) } : x)));
      }
    }
    setFlTest(results.join(' · '));
  }

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

  // ---------- وضع المقارنة: نفس السؤال لعدة مزودين دفعة واحدة ----------
  function isCompareEligible(pid) {
    if (pid === 'ollama' || pid === 'custom') return false; // محلي / يحتاج إعداد نقطة نهاية يدوياً
    if (pid === 'pollinations') return true; // بدون مفتاح
    if (pid === 'freellmapi') return flKeys.some((k) => k.status !== 'exhausted'); // يحتاج مفتاحاً موحداً محفوظاً
    return (keys[pid] || []).some((k) => k.status !== 'exhausted');
  }
  function toggleCompareProvider(pid) {
    setCompareProviders((prev) => {
      if (prev.includes(pid)) {
        if (prev.length <= 1) return prev; // يجب أن يبقى مزود واحد على الأقل
        return prev.filter((x) => x !== pid);
      }
      return [...prev, pid].slice(0, 4); // حد أقصى 4 مزودين متنافسين
    });
  }
  function enableCompare() {
    const dflt = ['groq', 'freellmapi', 'pollinations'].filter((id) => isCompareEligible(id));
    const avail = dflt.length ? dflt : PROVIDERS.filter((p) => isCompareEligible(p.id)).slice(0, 3).map((p) => p.id);
    setCompareProviders(avail.length ? avail : ['pollinations']);
    setCompareOn(true);
  }
  // محتوى رسالة للمزود عند الإرسال: رسائل المقارنة السابقة تتحول إلى ملخص نصي
  function apiContentOf(m) {
    if (m.compare) return 'نتائج مقارنة سابقة:\n' + (m.results || []).map((r) => `[${getProvider(r.provider).name}]: ${r.error ? 'خطأ — ' + r.error : (r.content || '')}`).join('\n');
    return m.content;
  }
  function historyApiMessages(history, userMsg, apiContent) {
    return history.map((m) => ({ role: m.role, content: (m.role === 'user' && m === userMsg) ? apiContent : apiContentOf(m) }));
  }
  // طلب واحد لمزود واحد (نفس مسار الإرسال العادي، دون التبديل التلقائي)
  async function fetchOneProvider(pid, history, userMsg, userContent, imageAtt) {
    const prov = getProvider(pid);
    const apiContent = (imageAtt && prov.supportsVision)
      ? [{ type: 'text', text: userContent || 'صف هذه الصورة وحلّلها.' }, { type: 'image_url', image_url: { url: imageAtt.dataUrl } }]
      : userContent;
    const apiMessages = historyApiMessages(history, userMsg, apiContent);
    const modelName = pid === 'freellmapi' ? 'auto' : prov.models[0];
    const t0 = Date.now();
    try {
      let data;
      let sentFl = null;
      if (pid === 'freellmapi') {
        sentFl = flKeyEntries();
        if (!sentFl.length) throw new Error('أضف المفتاح الموحد (freellmapi-…) من لوحة الراوتر في إعدادات FreeLLMAPI أولاً.');
        const res = await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: apiMessages,
            providerId: pid, model: modelName,
            apiKeys: { ...keys, freellmapi: sentFl },
            baseURL: flUrl || FL_DEFAULT_URL, deepThinking
          })
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل الطلب.');
        noteFlKeyUsed(sentFl, data.keyIndex, true);
        data.via = 'عبر خادم الموقع';
      } else {
        const res = await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: apiMessages,
            providerId: pid, model: modelName,
            apiKeys: keys, deepThinking
          })
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل الطلب.');
      }
      let content = data.content || '';
      let reasoning = data.reasoning || null;
      if (!reasoning && deepThinking && content.includes('التفكير:')) {
        const parts = content.split('الإجابة:');
        if (parts.length > 1) { reasoning = parts[0].replace('التفكير:', '').trim(); content = parts.slice(1).join('الإجابة:').trim(); }
      }
      const used = data.usage?.total_tokens || estimateTokens(content);
      return { provider: pid, model: data.modelUsed || data.model || modelName, content, tokens: used, seconds: (Date.now() - t0) / 1000, reasoning, via: data.via || null, error: null };
    } catch (e) {
      return { provider: pid, model: modelName, content: '', tokens: 0, seconds: (Date.now() - t0) / 1000, reasoning: null, via: null, error: String(e.message || e) };
    }
  }

  async function sendCompare(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!text && attachments.length === 0) return;
    if (daily.tokens >= planInfo.limit) { setError('بلغت حد الخطة اليومي (' + formatTokens(planInfo.limit) + ' توكن). راجع الأسعار للترقية أو انتظر الغد.'); setDrawer('pricing'); return; }
    if (!current) return;
    if (!compareProviders.length) { setError('اختر مزوداً واحداً على الأقل للمقارنة.'); return; }
    setError('');
    const attachText = attachments.filter((a) => a.kind === 'text').map((a) => `\n\n[ملف: ${a.name}]\n${a.content.slice(0, 12000)}`).join('');
    const imageAtt = attachments.find((a) => a.kind === 'image');
    const pdfNote = attachments.filter((a) => a.kind === 'pdf').map((a) => `\n[ملف PDF مرفق: ${a.name} — لم يُستخرج نصه، انسخ نصه والصقه.]`).join('');
    const userContent = text + attachText + pdfNote;
    const userMsg = { role: 'user', content: userContent, tokens: estimateTokens(userContent), route: 'compare' };
    const history = [...current.messages, userMsg];
    updateSession(current.id, (s) => ({ ...s, title: s.messages.length === 0 ? text.slice(0, 40) || 'محادثة جديدة' : s.title, messages: history, tokens: (s.tokens || 0) + userMsg.tokens }));
    setInput(''); setAttachments([]); setLoading(true);
    try {
      const settled = await Promise.allSettled(compareProviders.map((pid) => fetchOneProvider(pid, history, userMsg, userContent, imageAtt)));
      const results = settled.map((r, i) => r.status === 'fulfilled' ? r.value : { provider: compareProviders[i], model: getProvider(compareProviders[i]).models[0], content: '', tokens: 0, seconds: 0, reasoning: null, via: null, error: String(r.reason || 'فشل الطلب.') });
      const ok = results.filter((r) => !r.error);
      if (ok.length > 1) {
        const fastest = ok.reduce((a, b) => (a.seconds <= b.seconds ? a : b));
        fastest.fastest = true;
      }
      const totalUsed = results.reduce((n, r) => n + (r.tokens || 0), 0);
      const cmpMsg = { role: 'assistant', compare: true, results, tokens: totalUsed };
      updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, cmpMsg], tokens: (s.tokens || 0) + totalUsed }));
      setDaily((d) => ({ ...d, tokens: d.tokens + totalUsed }));
      if (ok.length === 0) setError('فشلت كل المزودين المحددين — تحقق من مفاتيحك ثم أعد المحاولة.');
    } finally { setLoading(false); }
  }

  // ---------- الإرسال ----------
  async function sendMessage(textOverride, opts = {}) {
    const text = (textOverride ?? input).trim();
    if (!text && attachments.length === 0) return;
    if (daily.tokens >= planInfo.limit) { setError('بلغت حد الخطة اليومي (' + formatTokens(planInfo.limit) + ' توكن). راجع الأسعار للترقية أو انتظر الغد.'); setDrawer('pricing'); return; }
    if (!current) return;
    const deep = opts.deep || deepThinking;
    setError('');
    const attachText = attachments.filter((a) => a.kind === 'text').map((a) => `\n\n[ملف: ${a.name}]\n${a.content.slice(0, 12000)}`).join('');
    const imageAtt = attachments.find((a) => a.kind === 'image');
    const pdfNote = attachments.filter((a) => a.kind === 'pdf').map((a) => `\n[ملف PDF مرفق: ${a.name} — لم يُستخرج نصه، انسخ نصه والصقه.]`).join('');
    let userContent = text + attachText + pdfNote;
    let apiContent = userContent;
    if (imageAtt && providerId !== 'auto' && provider.supportsVision) {
      apiContent = [{ type: 'text', text: userContent || 'صف هذه الصورة وحلّلها.' }, { type: 'image_url', image_url: { url: imageAtt.dataUrl } }];
    }
    const userMsg = { role: 'user', content: userContent, tokens: estimateTokens(userContent), route: opts.route || null };
    const history = [...current.messages, userMsg];
    updateSession(current.id, (s) => ({ ...s, title: s.messages.length === 0 ? text.slice(0, 40) || 'محادثة جديدة' : s.title, messages: history, tokens: (s.tokens || 0) + userMsg.tokens }));
    setInput(''); setAttachments([]); setLoading(true);
    try {
      const apiMessages = historyApiMessages(history, userMsg, apiContent);
      // كل المزودين يمرون عبر وكيل خادم الموقع /api/chat.
      let data;
      if (providerId === 'freellmapi') {
        // --- FreeLLMAPI: الراوتر المستضاف على Railway — دائماً عبر وكيل الخادم ---
        const sentFl = flKeyEntries();
        if (!sentFl.length) {
          setError('أضف المفتاح الموحد (freellmapi-…) من لوحة الراوتر في إعدادات FreeLLMAPI أولاً.');
          setDrawer('freellmapi');
          return;
        }
        const modelName = (model || '').trim() || 'auto';
        const res = await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: apiMessages,
            providerId, model: modelName,
            apiKeys: { ...keys, freellmapi: sentFl },
            baseURL: flUrl || FL_DEFAULT_URL, deepThinking: deep
          })
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل الطلب.');
        noteFlKeyUsed(sentFl, data.keyIndex, true);
        data.via = 'عبر خادم الموقع';
      } else {
        const res = await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: apiMessages,
            providerId, model: providerId === 'auto' ? undefined : (model || provider.models[0]),
            apiKeys: keys, baseURL: providerId === 'custom' ? customBase : undefined,
            deepThinking: deep
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

  // ---------- توليد صورة من داخل المحادثة (عبر الموجّه الذكي) ----------
  // طلب صورة لا يردّ عليه بنص أبداً: إما صورة ظاهرة في المحادثة أو خطأ صريح.
  async function genImageChat(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!current) return;
    if (daily.images >= planInfo.images) { setError('بلغت حد صور اليوم في خطتك (' + planInfo.images + ').'); setDrawer('pricing'); return; }
    let prompt = detectIntent(text, {}).prompt;
    if (!prompt) prompt = subjectFromHistory(current.messages) || 'مشهد جميل';
    setError('');
    const userMsg = { role: 'user', content: text, tokens: estimateTokens(text), route: 'image' };
    const history = [...current.messages, userMsg];
    updateSession(current.id, (s) => ({ ...s, title: s.messages.length === 0 ? prompt.slice(0, 40) : s.title, messages: history, tokens: (s.tokens || 0) + userMsg.tokens }));
    setInput(''); setAttachments([]); setLoading(true);
    try {
      const res = await fetch('/api/image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, apiKeys: keys, flKeys: flKeys.filter((k) => k.status !== 'exhausted').map((k) => ({ value: k.value })), flUrl: flUrl || FL_DEFAULT_URL, size: '1024x1024' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل توليد الصورة.');
      const viaName = data.via === 'huggingface-space' ? 'Hugging Face FLUX (مجاني بدون مفتاح)' : data.via === 'freellmapi' ? 'FreeLLMAPI Router' : getProvider(data.via).name;
      const imgMsg = {
        role: 'assistant', kind: 'image', imageUrl: data.url, prompt,
        via: viaName + (data.free ? ' — مجاني بدون مفتاح' : ''),
        note: data.note || null, tokens: 0
      };
      updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, imgMsg] }));
      setDaily((d) => ({ ...d, images: d.images + 1 }));
    } catch (e) {
      const errMsg = { role: 'assistant', content: 'تعذّر توليد الصورة: ' + String(e.message || e) + '\n\nأعد المحاولة بعد قليل (المسار المجاني قد يكون مشغولاً)، أو أضف مفتاح OpenAI / Together / Hugging Face من مدير المفاتيح.', tokens: 0 };
      updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, errMsg] }));
    } finally { setLoading(false); }
  }

  // ---------- توليد فيديو من داخل المحادثة (عبر الموجّه الذكي) ----------
  // لا فيديو وهمي أبداً: إما فيديو حقيقي أو شرح صريح بالخطوات.
  async function genVideoChat(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!current) return;
    const prompt = detectIntent(text, {}).prompt || text;
    setError('');
    const userMsg = { role: 'user', content: text, tokens: estimateTokens(text), route: 'video' };
    const history = [...current.messages, userMsg];
    updateSession(current.id, (s) => ({ ...s, title: s.messages.length === 0 ? prompt.slice(0, 40) : s.title, messages: history, tokens: (s.tokens || 0) + userMsg.tokens }));
    setInput(''); setAttachments([]); setLoading(true);
    try {
      const res = await fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, provider: vidProvider, apiKeys: keys }) });
      const data = await res.json();
      const content = res.ok
        ? 'تم إنشاء الفيديو:\n' + String(data.url || data.videoUrl || '')
        : (data.error || 'تعذّر توليد الفيديو.') + (data.howTo ? '\n\n' + data.howTo : '');
      updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, { role: 'assistant', content, tokens: estimateTokens(content) }] }));
    } catch (e) {
      updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, { role: 'assistant', content: 'تعذّر توليد الفيديو: ' + String(e.message || e), tokens: 0 }] }));
    } finally { setLoading(false); }
  }

  // ---------- نقطة الدخول الواحدة للإرسال: الأداة الصريحة تفوز، ثم الكشف الذكي ----------
  function sendCurrent(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!text && attachments.length === 0) return;
    const tool = pendingTool;
    setPendingTool(null);
    if (tool === 'image') { genImageChat(textOverride); return; }
    if (tool === 'video') { genVideoChat(textOverride); return; }
    const hasImage = attachments.some((a) => a.kind === 'image');
    const intent = detectIntent(text, { hasImageAttachment: hasImage });
    if (intent.type === 'image') { genImageChat(textOverride); return; }
    if (intent.type === 'video') { genVideoChat(textOverride); return; }
    if (intent.type === 'compare') { if (!compareOn) enableCompare(); sendCompare(textOverride); return; }
    if (intent.type === 'deep') { sendMessage(textOverride, { deep: true }); return; }
    if (compareOn) sendCompare(textOverride); else sendMessage(textOverride);
  }
  // اختيار أداة من ورقة "+": إن كان في الصندوق نص يُرسل فوراً، وإلا تُحفظ الأداة للرسالة التالية
  function chooseTool(tool) {
    setSheet(null);
    if (tool === 'image' || tool === 'video') {
      if (input.trim()) { setPendingTool(tool); sendCurrent(); }
      else { setPendingTool(tool); setTimeout(() => composerRef.current?.focus(), 50); }
      return;
    }
    if (tool === 'deep') { setDeepThinking((v) => !v); return; }
    if (tool === 'compare') { if (compareOn) setCompareOn(false); else enableCompare(); return; }
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
        body: JSON.stringify({ messages: [{ role: 'user', content: 'قل: ok' }], providerId: pid, model: getProvider(pid).models[0], apiKeys: { [pid]: [keys[pid][idx]] } }) });
      const data = await res.json();
      setTestResult(res.ok ? 'المفتاح يعمل ✓ — رد المزود: ' + String(data.content || '').slice(0, 80) : 'المفتاح فشل: ' + (data.error || res.status));
    } catch (e) { setTestResult('تعذّر الاختبار: ' + String(e.message || e)); }
  }

  // ---------- الصور والفيديو (من الدرج) ----------
  async function genImage() {
    if (!imgPrompt.trim()) return;
    if (daily.images >= planInfo.images) { setError('بلغت حد صور اليوم في خطتك (' + planInfo.images + ').'); setDrawer('pricing'); return; }
    setImgLoading(true); setImgResult(null);
    try {
      const res = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: imgPrompt, apiKeys: keys, flKeys: flKeys.filter((k) => k.status !== 'exhausted').map((k) => ({ value: k.value })), flUrl: flUrl || FL_DEFAULT_URL, size: imgSize }) });
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
    sessions.forEach((s) => s.messages.forEach((m) => {
      if (m.compare) {
        (m.results || []).forEach((r) => {
          if (!r.error) {
            const e = per[r.provider] || { replies: 0, tokens: 0 };
            e.replies += 1; e.tokens += (r.tokens || 0);
            per[r.provider] = e;
          }
        });
      } else if (m.role === 'assistant' && m.provider) {
        const e = per[m.provider] || { replies: 0, tokens: 0 };
        e.replies += 1; e.tokens += (m.tokens || 0);
        per[m.provider] = e;
      }
    }));
    return { sessions: sessions.length, messages: sessions.reduce((n, s) => n + s.messages.length, 0), per };
  }, [sessions]);

  // حالة المفاتيح: نشط / مستنفد لكل مزود — من تجمع المفاتيح المحفوظ في المتصفح
  const keyStatus = useMemo(() => {
    const out = {};
    PROVIDERS.filter((p) => p.needsKey).forEach((p) => {
      const list = keys[p.id] || [];
      out[p.id] = {
        name: p.name,
        total: list.length,
        active: list.filter((k) => k.status !== 'exhausted').length,
        exhausted: list.filter((k) => k.status === 'exhausted').length
      };
    });
    return out;
  }, [keys]);

  const currentModelLabel = compareOn ? '⚔️ مقارنة (' + compareProviders.length + ')' : (providerId === 'auto' ? '⚡ تلقائي' : provider.name + (model ? ' · ' + model : ''));
  const modelBadge = (p) => {
    if (p.id === 'groq') return 'الأسرع';
    if (p.id === 'openai') return 'الأذكى';
    if (p.id === 'freellmapi') return '10.1B توكن';
    if (p.id === 'pollinations') return 'مجاني';
    if (p.id === 'ollama') return 'محلي';
    return p.needsKey ? 'يحتاج مفتاحاً' : 'مجاني';
  };
  const visibleMessages = current ? current.messages.slice(-visibleCount) : [];
  const olderCount = current ? Math.max(0, current.messages.length - visibleCount) : 0;

  return (
    <div className="app">
      {/* خلفية معتمة للقائمة الجانبية على الهاتف — النقر عليها يغلقها */}
      {sidebarOpen && <div className="backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      {/* الشريط الجانبي — كل التفاصيل هنا، لا شيء منها في الواجهة الرئيسية */}
      <aside className={'sidebar' + (sidebarOpen ? ' open' : '')}>
        <div className="sidebar-head">
          <div className="logo">OmniAI <small>منصة ذكاء اصطناعي موحدة</small></div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="إغلاق القائمة">✕</button>
        </div>
        <button className="btn btn-block" onClick={newChat}>+ محادثة جديدة</button>
        <div className="stat-box">
          الخطة: <b>{planInfo.name}</b> — {planInfo.price}<br />
          توكنات اليوم: <b>{formatTokens(daily.tokens)}</b> / {formatTokens(planInfo.limit)} — متبقٍ <b>{formatTokens(remaining)}</b><br />
          كل الجلسات: <b>{formatTokens(totalTokens)}</b> توكن · {sessions.length} جلسة<br />
          {user ? <>الحساب: {user.contact}</> : 'لم تسجّل الدخول بعد'}
        </div>
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
          <button className="btn ghost" onClick={() => { setDrawer('freellmapi'); setSidebarOpen(false); }}>⚙️ إعدادات FreeLLMAPI {flKeys.length ? '✓ ' + flKeys.length : ''}</button>
          <button className="btn ghost" onClick={() => { setDrawer('keys'); setSidebarOpen(false); }}>🔑 مدير المفاتيح</button>
          <button className="btn ghost" onClick={() => { setDrawer('image'); setSidebarOpen(false); }}>🖼 توليد الصور</button>
          <button className="btn ghost" onClick={() => { setDrawer('video'); setSidebarOpen(false); }}>🎬 توليد الفيديو</button>
          <button className="btn ghost" onClick={() => { setDrawer('stats'); setSidebarOpen(false); }}>📊 لوحة المعلومات</button>
          <button className="btn ghost" onClick={() => { setDrawer('pricing'); setSidebarOpen(false); }}>💎 الخطط والأسعار</button>
          <button className="btn ghost" onClick={() => { setDrawer('settings'); setSidebarOpen(false); }}>⚙️ الإعدادات</button>
          {user
            ? <button className="btn ghost" onClick={() => { setUser(null); try { localStorage.removeItem('omni_user'); } catch {} }}>تسجيل الخروج ({user.contact})</button>
            : <button className="btn ghost" onClick={() => { setAuthOpen(true); setSidebarOpen(false); }}>👤 تسجيل الدخول / إنشاء حساب</button>}
        </div>
      </aside>

      {/* الرئيسي — واجهة نظيفة بأسلوب Claude: لا أشرطة مزدحمة ولا أزرار زائدة */}
      <main className="main">
        <header className="topbar-main">
          <button className="menu-btn" onClick={() => setSidebarOpen(true)} aria-label="فتح القائمة">☰</button>
          <span className="brand">OmniAI</span>
          <span className="session-title">{current?.title || ''}</span>
          <span className="spacer" />
        </header>

        <div className="chat" ref={chatRef}>
          <div className="chat-inner">
            {!current || current.messages.length === 0 ? (
              <div className="empty">
                <h2>مرحباً بك في OmniAI — كيف أساعدك اليوم؟</h2>
              </div>
            ) : (
              <>
                {olderCount > 0 && (
                  <div style={{ textAlign: 'center', marginBottom: 14 }}>
                    <button className="btn ghost small" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>عرض رسائل أقدم ({olderCount} رسالة)</button>
                  </div>
                )}
                {visibleMessages.map((m, vi) => {
                  const i = current.messages.length - visibleMessages.length + vi;
                  return m.compare ? (
                    <div key={i} className="compare-block">
                      <div className="compare-head">⚔️ مقارنة بين {m.results.length} مزودين · {formatTokens(m.tokens || 0)} توكن</div>
                      <div className="compare-grid">
                        {(m.results || []).map((r, j) => (
                          <div key={j} className={'compare-card' + (r.error ? ' failed' : '') + (r.fastest ? ' fastest' : '')}>
                            <div className="compare-card-head">
                              <b>{getProvider(r.provider).name}</b>
                              {r.fastest && <span className="badge fast">⚡ الأسرع</span>}
                              <span dir="ltr">{r.model || ''}</span>
                            </div>
                            {r.error ? (
                              <div className="note">⚠️ {r.error}</div>
                            ) : (
                              <>
                                {renderMd(r.content)}
                                {r.reasoning && (
                                  <details className="think">
                                    <summary>🧠 التفكير العميق — اضغط لعرض/إخفاء خطوات التفكير</summary>
                                    <div style={{ marginTop: 6 }}>{renderMd(r.reasoning)}</div>
                                  </details>
                                )}
                              </>
                            )}
                            <div className="compare-card-foot">
                              <span>{formatTokens(r.tokens || 0)} توكن</span>
                              <span>{Number(r.seconds || 0).toFixed(1)} ثانية</span>
                              {r.via && <span>المسار: {r.via}</span>}
                              {!r.error && <button onClick={() => copyText(r.content, 'cmp' + i + '-' + j)}>{copied === 'cmp' + i + '-' + j ? '✓ تم النسخ' : '📋 نسخ'}</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className={'msg ' + m.role}>
                      <div className={'avatar ' + (m.role === 'user' ? 'user' : 'ai')}>{m.role === 'user' ? '👤' : '✦'}</div>
                      <div className="msg-body">
                        <div className="msg-meta">
                          <span>{m.role === 'user' ? 'أنت' : 'OmniAI'}</span>
                          {m.provider && <span>المزود: {getProvider(m.provider).name} · {m.model}</span>}
                          {m.via && <span>المسار: {m.via}</span>}
                          <span>{formatTokens(m.tokens || estimateTokens(textOf(m)))} توكن</span>
                        </div>
                        {m.route && m.role === 'user' && <div className="route-chip">تم التوجيه إلى: {ROUTE_LABELS[m.route] || m.route}</div>}
                        {m.kind === 'image' ? (
                          <>
                            <img className="gen" src={m.imageUrl} alt={m.prompt || 'صورة مولّدة'} />
                            {m.note && <div className="note blue" style={{ marginTop: 10 }}>{m.note}</div>}
                            <div className="msg-actions">
                              <a className="btn ghost small" href={m.imageUrl} download target="_blank" rel="noreferrer">⬇ تنزيل الصورة</a>
                              <button onClick={() => copyText(m.imageUrl, 'img' + i)}>{copied === 'img' + i ? '✓ نُسخ الرابط' : 'نسخ رابط الصورة'}</button>
                            </div>
                          </>
                        ) : (
                          <>
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
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
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
          <div className="composer-top">
            <button className="model-pill-btn" onClick={() => setSheet('model')} aria-label="اختيار النموذج">{currentModelLabel} <span aria-hidden="true">⌄</span></button>
            {deepThinking && <span className="mini-chip">🧠 تفكير عميق</span>}
            {pendingTool && <span className="mini-chip">الأداة: {pendingTool === 'image' ? '🖼 توليد صورة' : '🎬 توليد فيديو'} <button onClick={() => setPendingTool(null)} aria-label="إلغاء الأداة">✕</button></span>}
          </div>
          <div className="composer-row">
            <button className="plus-btn" onClick={() => setSheet('tools')} title="إضافة أداة" aria-label="إضافة أداة">+</button>
            <textarea ref={composerRef} value={input} onChange={(e) => setInput(e.target.value)} onPaste={onPaste}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); } }}
              aria-label="اكتب رسالتك" />
            <button className="send-btn" onClick={() => sendCurrent()} disabled={loading}>{loading ? '…' : 'إرسال'}</button>
          </div>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
          <input ref={fileImageOnlyRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
        </div>
      </main>

      {/* ورقة اختيار النموذج — بأسلوب Claude: بطاقة لكل مزود مع وصف وشارة وعلامة اختيار */}
      {sheet === 'model' && (
        <>
          <div className="sheet-back" onClick={() => setSheet(null)} aria-hidden="true" />
          <div className="sheet" role="dialog" aria-label="اختيار النموذج">
            <div className="sheet-grip" />
            <div className="sheet-head">
              <h2>اختيار النموذج</h2>
              <button className="sidebar-close" style={{ display: 'inline-flex' }} onClick={() => setSheet(null)} aria-label="إغلاق">✕</button>
            </div>
            <div className="model-list">
              <button className={'model-card' + (providerId === 'auto' && !compareOn ? ' selected' : '')} onClick={() => { setProviderId('auto'); setModel(''); setCompareOn(false); setSheet(null); }}>
                <span className="model-name">⚡ تلقائي</span>
                <span className="model-badge">الأسرع</span>
                <span className="model-desc">يختار أفضل مزود متاح، وينتقل للبديل تلقائياً عند نفاد الرصيد</span>
                {providerId === 'auto' && !compareOn && <span className="model-check">✓</span>}
              </button>
              {PROVIDERS.map((p) => {
                const hasKey = !p.needsKey || (keys[p.id] || []).some((k) => k.status !== 'exhausted') || (p.id === 'freellmapi' && flKeys.some((k) => k.status !== 'exhausted'));
                const selected = providerId === p.id && !compareOn;
                return (
                  <button key={p.id} className={'model-card' + (selected ? ' selected' : '')} onClick={() => { setProviderId(p.id); setModel(''); setCompareOn(false); if (p.id === 'freellmapi' && !flKeys.length) { setSheet(null); setDrawer('freellmapi'); } }}>
                    <span className="model-name">{p.name}</span>
                    <span className="model-badge">{hasKey ? modelBadge(p) : 'يحتاج مفتاحاً'}</span>
                    <span className="model-desc">{p.blurb}</span>
                    {selected && <span className="model-check">✓</span>}
                  </button>
                );
              })}
              <button className={'model-card' + (compareOn ? ' selected' : '')} onClick={() => { if (compareOn) setCompareOn(false); else enableCompare(); }}>
                <span className="model-name">⚔️ مقارنة</span>
                <span className="model-badge">منافسة</span>
                <span className="model-desc">نفس السؤال لعدة مزودين دفعة واحدة — والأسرع يظهر بشارة ⚡</span>
                {compareOn && <span className="model-check">✓</span>}
              </button>
            </div>
            {compareOn && (
              <div className="compare-picker">
                <span className="compare-picker-title">⚔️ المزودون المتنافسون:</span>
                {PROVIDERS.filter((p) => p.id !== 'ollama' && p.id !== 'custom').map((p) => {
                  const ok = isCompareEligible(p.id);
                  const checked = compareProviders.includes(p.id);
                  return (
                    <label key={p.id} className={'cmp-chip' + (checked ? ' on' : '') + (ok ? '' : ' disabled')}>
                      <input type="checkbox" checked={checked} disabled={!ok} onChange={() => toggleCompareProvider(p.id)} />
                      {p.name}
                      {!ok && <small> — أضف مفتاحاً</small>}
                    </label>
                  );
                })}
              </div>
            )}
            {providerId === 'freellmapi' && !compareOn && (
              <div className="field" style={{ marginTop: 12 }}>
                <label>نموذج FreeLLMAPI (اتركه auto ليختار الراوتر)</label>
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="auto" dir="ltr" />
              </div>
            )}
            {providerId !== 'auto' && providerId !== 'freellmapi' && !compareOn && provider.models.length > 1 && (
              <div className="model-sub">
                <span className="model-sub-title">النموذج:</span>
                {provider.models.map((m) => (
                  <button key={m} className={'model-sub-chip' + ((model || provider.models[0]) === m ? ' on' : '')} onClick={() => setModel(m)} dir="ltr">{m}</button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ورقة "+" — كل الأدوات الحقيقية فقط، بأسلوب Claude */}
      {sheet === 'tools' && (
        <>
          <div className="sheet-back" onClick={() => setSheet(null)} aria-hidden="true" />
          <div className="sheet" role="dialog" aria-label="إضافة أداة">
            <div className="sheet-grip" />
            <div className="sheet-head">
              <h2>إضافة إلى المحادثة</h2>
              <button className="sidebar-close" style={{ display: 'inline-flex' }} onClick={() => setSheet(null)} aria-label="إغلاق">✕</button>
            </div>
            <div className="tool-list-sheet">
              <button className="tool-row" onClick={() => chooseTool('image')}>
                <span className="tool-icon">🖼</span>
                <span className="tool-text"><b>توليد صورة</b><small>صورة من وصفك — DALL·E أو FLUX إن وُجد مفتاح، وإلا بديل مجاني</small></span>
              </button>
              <button className="tool-row" onClick={() => chooseTool('video')}>
                <span className="tool-icon">🎬</span>
                <span className="tool-text"><b>توليد فيديو</b><small>يحتاج مفتاحاً مدفوعاً (Replicate / Luma / Runway)</small></span>
              </button>
              <button className="tool-row" onClick={() => { setSheet(null); fileImageOnlyRef.current?.click(); }}>
                <span className="tool-icon">📷</span>
                <span className="tool-text"><b>إرفاق صورة</b><small>من معرض هاتفك — لتحليلها أو وصفها</small></span>
              </button>
              <button className="tool-row" onClick={() => { setSheet(null); fileRef.current?.click(); }}>
                <span className="tool-icon">📁</span>
                <span className="tool-text"><b>إرفاق ملف</b><small>نص أو PDF حتى 2MB — يُحلَّل مع رسالتك</small></span>
              </button>
              <button className="tool-row" onClick={() => chooseTool('deep')}>
                <span className="tool-icon">🧠</span>
                <span className="tool-text"><b>تفكير عميق</b><small>يفكّر خطوة بخطوة ويعرض خطوات تفكيره</small></span>
                <span className={'switch' + (deepThinking ? ' on' : '')}><i /></span>
              </button>
              <button className="tool-row" onClick={() => chooseTool('compare')}>
                <span className="tool-icon">⚔️</span>
                <span className="tool-text"><b>مقارنة</b><small>نفس السؤال لعدة مزودين دفعة واحدة</small></span>
                <span className={'switch' + (compareOn ? ' on' : '')}><i /></span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* درج جانبي: مفاتيح / صور / فيديو / إحصائيات / أسعار / إعدادات */}
      {drawer && (
        <>
          <div className="backdrop" style={{ display: 'block', zIndex: 65 }} onClick={() => setDrawer(null)} aria-hidden="true" />
          <div className="drawer">
            <div className="drawer-head">
              <h2>{drawer === 'keys' ? '🔑 مدير المفاتيح' : drawer === 'freellmapi' ? '🚀 FreeLLMAPI — الراوتر المستضاف' : drawer === 'image' ? '🖼 توليد الصور' : drawer === 'video' ? '🎬 توليد الفيديو' : drawer === 'stats' ? '📊 لوحة المعلومات' : drawer === 'pricing' ? '💎 الخطط والأسعار' : '⚙️ الإعدادات'}</h2>
              <button className="sidebar-close" style={{ display: 'inline-flex' }} onClick={() => setDrawer(null)} aria-label="إغلاق">✕</button>
            </div>

            {drawer === 'freellmapi' && (<>
              <p>الراوتر يعمل على سحابة Railway على مدار الساعة — لا Termux ولا تثبيت على هاتفك. الطلبات تمر دائماً <b>عبر خادم الموقع</b> إلى الرابط العام للراوتر.</p>
              <div className="note blue">المفاتيح الموحدة المحفوظة: <b>{flKeys.length}</b> · الرابط: <span dir="ltr">{flUrl || FL_DEFAULT_URL}</span></div>
              <div className="field"><label>رابط الراوتر</label><input value={flUrl} onChange={(e) => saveFlUrl(e.target.value)} dir="ltr" placeholder={FL_DEFAULT_URL} /></div>
              <h3>مفاتيح FreeLLMAPI (تداول)</h3>
              <p>أضف مفاتيح موحدة من عدة حسابات — عند نفاد رصيد مفتاح (401/429) ينتقل الموقع تلقائياً للمفتاح التالي، وتتداول الطلبات بينها دورياً.</p>
              {flKeys.length === 0 && <p>لا مفاتيح بعد. انسخ المفتاح الموحد من صفحة Keys في لوحة الراوتر والصقه هنا.</p>}
              {flKeys.map((k) => (
                <div key={k.id} className="key-row">
                  <span style={{ fontWeight: 700 }}>{k.label}</span>
                  <code>••••{String(k.value).slice(-6)}</code>
                  <span className={'badge' + (k.status === 'exhausted' ? ' exhausted' : '')}>{k.status === 'exhausted' ? 'مستنفد' : 'يعمل'}</span>
                  {k.lastUsed && <small style={{ color: 'var(--muted)' }}>آخر استخدام: {new Date(k.lastUsed).toLocaleString('ar')}</small>}
                  {k.lastError && <small style={{ color: 'var(--red)' }}>{k.lastError}</small>}
                  <button className="btn danger small" onClick={() => setFlKeys((p) => p.filter((x) => x.id !== k.id))}>حذف</button>
                </div>
              ))}
              <div className="field"><label>إضافة مفتاح موحد جديد (freellmapi-…)</label><input type="password" value={newFlKey} onChange={(e) => setNewFlKey(e.target.value)} placeholder="freellmapi-…" dir="ltr" /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={addFlKey}>إضافة المفتاح</button>
                <button className="btn ghost" onClick={testFreellmapi}>اختبار كل المفاتيح</button>
                <button className="btn ghost" onClick={() => { setDrawer(null); setGuideOpen(true); }}>📖 دليل FreeLLMAPI</button>
              </div>
              {flTest && <div className="note blue">{flTest}</div>}
              <h3>كيف تحصل على المفتاح الموحد؟</h3>
              <p>من <a href={FL_DASHBOARD_URL} target="_blank" rel="noreferrer">لوحة الراوتر</a> (صفحة Keys): أضف مفاتيح مزوديك أولاً (Groq وغيره)، ثم انسخ المفتاح الموحد من أعلى الصفحة والصقه هنا. يمكنك تكرار ذلك من حسابات راوتر متعددة — كل مفتاح يُحفظ في متصفحك فقط.</p>
              <h3>ملاحظة صادقة</h3>
              <div className="note">«10.1 مليار توكن» = مجموع الحصص المجانية لكل المزودين الـ 87 في كتالوج FreeLLMAPI، وليست رصيداً يمنحه لك أحد. كل مزود له حسابه ومفتاحه وحده الخاص. الكتالوج المجاني لقطة شهرية تتأخر 30 يوماً؛ الكتالوج الحي Premium بـ 19$/سنة (أو 49$ مدى الحياة). المشروع «للتجربة الشخصية فقط».</div>
            </>)}

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
            </>)}


            {drawer === 'image' && (<>
              <p>بمفتاح محفوظ: DALL·E 3 أو FLUX بجودة عالية. بدون مفتاح: نموذج FLUX.1-schnell مفتوح المصدر مجاناً (قد ينتظر في الطابور). الوصف العربي يُترجم تلقائياً إلى الإنجليزية قبل التوليد.</p>
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
                <p>تم التوليد عبر: {imgResult.via === 'huggingface-space' ? 'Hugging Face FLUX (مجاني بدون مفتاح)' : imgResult.via === 'freellmapi' ? 'FreeLLMAPI Router' : getProvider(imgResult.via).name}</p>
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
              <h3>التوكنات</h3>
              <div className="grid2">
                <div className="stat-box">هذه الجلسة<br /><b>{formatTokens(current?.tokens || 0)}</b></div>
                <div className="stat-box">توكنات اليوم<br /><b>{formatTokens(daily.tokens)}</b></div>
                <div className="stat-box">كل الجلسات<br /><b>{formatTokens(totalTokens)}</b></div>
                <div className="stat-box">الرسائل<br /><b>{stats.messages}</b></div>
              </div>
              <h3>الاستهلاك حسب المزود</h3>
              {Object.keys(stats.per).length === 0 ? <p>لا ردود بعد — أرسل أول رسالة وستظهر التفاصيل هنا.</p> : Object.entries(stats.per).map(([p, e]) => <div key={p} className="key-row"><span style={{ flex: 1 }}>{(PROVIDERS.find((x) => x.id === p)?.name || p)}</span><b>{e.replies} رداً · {formatTokens(e.tokens)} توكن</b></div>)}
              <h3>حالة المفاتيح</h3>
              {Object.values(keyStatus).every((k) => k.total === 0)
                ? <p>لا مفاتيح محفوظة بعد — أضف مفتاح Groq مجاني من «مدير المفاتيح»، أو جرّب Pollinations بدون مفتاح.</p>
                : Object.entries(keyStatus).filter(([, k]) => k.total > 0).map(([pid, k]) => (
                  <div key={pid} className="key-row"><span style={{ flex: 1 }}>{k.name}</span><b>{k.active} نشط · {k.exhausted} مستنفد</b></div>
                ))}
              <h3>مفاتيح FreeLLMAPI الموحدة</h3>
              {flKeys.length === 0 ? <p>لا مفاتيح موحدة بعد.</p> : flKeys.map((k) => (
                <div key={k.id} className="key-row"><span style={{ flex: 1 }}>{k.label} — ••••{String(k.value).slice(-6)}</span><b>{k.status === 'exhausted' ? 'مستنفد' : 'يعمل'}</b></div>
              ))}
              <h3>الأدوات — ماذا يحتاج كل منها؟</h3>
              <div className="tool-list">
                <div className="key-row"><span style={{ flex: 1 }}>🤖 محادثة</span><span>مفتاح مجاني (Groq) أو بدون مفتاح عبر Pollinations</span></div>
                <div className="key-row"><span style={{ flex: 1 }}>🖼 توليد الصور</span><span>DALL·E أو FLUX بمفتاح، أو بديل مجاني بجودة أقل</span></div>
                <div className="key-row"><span style={{ flex: 1 }}>🎬 توليد الفيديو</span><span>يحتاج مفتاحاً مدفوعاً (Replicate / Luma / Runway)</span></div>
                <div className="key-row"><span style={{ flex: 1 }}>🧠 تفكير عميق</span><span>يعمل مع أي مزود — فعّله من ورقة «+»</span></div>
                <div className="key-row"><span style={{ flex: 1 }}>⚔️ مقارنة</span><span>نفس السؤال لعدة مزودين — من ورقة «+» أو ورقة النموذج</span></div>
                <div className="key-row"><span style={{ flex: 1 }}>📁 رفع ملفات وتحليلها</span><span>نصوص حتى 2MB؛ ملف PDF يُقبل دون استخراج نصه</span></div>
                <div className="key-row"><span style={{ flex: 1 }}>📋 نسخ وتصدير</span><span>نسخ أي رد من زر النسخ تحته، أو تصدير الجلسة .md / .json من الإعدادات</span></div>
              </div>
              <h3>الخطة والحدود</h3>
              <p>خطتك الحالية: <b>{planInfo.name}</b> — حد اليوم {formatTokens(planInfo.limit)} توكن، {planInfo.images} صورة.</p>
              <p>متبقٍ اليوم: <b>{formatTokens(remaining)}</b> توكن · {Math.max(0, planInfo.images - daily.images)} صورة.</p>
              <div className="note">كل الأرقام هنا محسوبة محلياً في متصفحك من جلساتك ومفاتيحك. مزود FreeLLMAPI يستخدم راوتراً مستضافاً على Railway — حدود كل مزود تظهر في لوحة الراوتر نفسها.</div>
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
              <h3>تصدير الجلسة الحالية</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn ghost small" onClick={() => copyText(current?.messages.map((m) => (m.role === 'user' ? 'أنت: ' : 'OmniAI: ') + textOf(m)).join('\n\n') || '', 'all')}>{copied === 'all' ? '✓ تم النسخ' : '📋 نسخ الجلسة'}</button>
                <button className="btn ghost small" onClick={() => exportSession('md')}>⬇ تصدير .md</button>
                <button className="btn ghost small" onClick={() => exportSession('json')}>⬇ تصدير .json</button>
              </div>
              <h3>نقطة نهاية مخصصة (للمزود «نقطة نهاية مخصصة» فقط)</h3>
              <input value={customBase} onChange={(e) => saveCustomBase(e.target.value)} dir="ltr" placeholder="https://example.com/v1" />
              <p style={{ fontSize: 13 }}>راوتر FreeLLMAPI مستضاف على Railway ويعمل على مدار الساعة — <a href={FL_DASHBOARD_URL} target="_blank" rel="noreferrer">لوحة الراوتر</a> · إعداداته في القائمة الجانبية ← «إعدادات FreeLLMAPI». المشروع مفتوح المصدر على <a href="https://github.com/tashfeenahmed/freellmapi" target="_blank" rel="noreferrer">GitHub</a>.</p>
              <h3>البيانات المحلية</h3>
              <p>كل الجلسات والمفاتيح محفوظة في متصفحك فقط (localStorage). مسحها يحذف كل شيء نهائياً من هذا الجهاز.</p>
              <button className="btn danger" onClick={() => { if (confirm('حذف كل الجلسات والمفاتيح من هذا المتصفح؟')) { try { localStorage.clear(); } catch {} location.reload(); } }}>🗑 مسح كل البيانات المحلية</button>
              <h3>روابط مفيدة</h3>
              <p><a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">مفتاح Groq المجاني</a><br /><a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">مفتاح OpenRouter</a><br /><a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">توكن Hugging Face</a></p>
            </>)}
          </div>
        </>
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

      {/* دليل FreeLLMAPI — الراوتر المستضاف */}
      {guideOpen && (
        <div className="modal-back" onClick={() => setGuideOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>🚀 دليل FreeLLMAPI — 10.1 مليار توكن</h2>
            <p>FreeLLMAPI راوتر مفتوح المصدر <b>مستضاف على Railway</b> ويعمل على مدار الساعة: تضيف مفاتيح مزوديك فيه، فيعطيك مفتاحاً موحداً واحداً (freellmapi-…) يوجّه طلباتك عبر كل المزودين مع انتقال تلقائي للبديل عند بلوغ حدّ أو عطل. لا Termux، لا Docker، لا تثبيت على هاتفك — كل شيء من الموقع.</p>
            <ol style={{ fontSize: 13.5, lineHeight: 1.9, paddingInlineStart: 20, marginBottom: 12 }}>
              <li><b>الراوتر جاهز أصلاً</b> — مستضاف على <a href={FL_DASHBOARD_URL} target="_blank" rel="noreferrer">Railway</a>. لا تثبيت ولا تشغيل من جهتك.</li>
              <li><b>أضف مفاتيح مزوديك في لوحة الراوتر</b> (صفحة Keys) — ابدأ بمفتاح Groq المجاني من <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>، ثم إن أردت: <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter</a>، <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">DeepSeek</a>، <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">Hugging Face</a>، <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noreferrer">Mistral</a>، <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>.</li>
              <li><b>انسخ المفتاح الموحد</b> (freellmapi-…) من أعلى صفحة Keys في اللوحة.</li>
              <li><b>الصقه في الموقع:</b> القائمة الجانبية ← «إعدادات FreeLLMAPI» ← «إضافة مفتاح موحد جديد» ← «اختبار كل المفاتيح». يُحفظ في متصفحك فقط. يمكنك إضافة مفاتيح موحدة من عدة حسابات — عند نفاد رصيد مفتاح ينتقل الموقع تلقائياً للمفتاح التالي.</li>
              <li><b>اختر المزود «FreeLLMAPI Router (سحابي)»</b> من ورقة اختيار النموذج (اضغط اسم النموذج فوق صندوق الكتابة)، اترك النموذج «auto» (أو اكتب اسم نموذج)، وأرسل رسالتك.</li>
            </ol>
            <div className="note">ملاحظة صادقة: «10.1 مليار توكن / 87 مزوداً» هي مجموع الحصص المجانية لكل المزودين معاً، وليست رصيداً يمنحه لك أحد — كل مزود يحتاج حسابه ومفتاحه وحدوده. الكتالوج المجاني لقطة شهرية تتأخر 30 يوماً؛ الكتالوج الحي Premium بـ 19$/سنة (أو 49$ مدى الحياة). المشروع «للتجربة الشخصية فقط».</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => { setGuideOpen(false); setDrawer('freellmapi'); }}>فتح إعدادات FreeLLMAPI</button>
              <button className="btn ghost" onClick={() => setGuideOpen(false)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
