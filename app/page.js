'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { PROVIDERS, getProvider, AUTO_ORDER, FEATURES } from '@/lib/providers';
import { USDT_WALLET, PLAN_USDT, PLAN_FEATURES } from '@/lib/payments';
import QRCode from 'qrcode';
import { estimateTokens, formatTokens } from '@/lib/tokens';
import { loadKeyPool, saveKeyPool, addKeyToPool, generateAppApiKey } from '@/lib/keys';
import { detectIntent, ROUTE_LABELS } from '@/lib/intent';
import { useSession, signIn, signOut } from 'next-auth/react';
import { t, LANGS, isRTL } from '@/lib/i18n';
import { BUILTIN_SKILLS } from '@/lib/skills';

const PLANS = {
  free: { name: 'مجانية', price: '0$', limit: 100000, images: 5, usdt: PLAN_USDT.free.price, features: PLAN_FEATURES.free },
  pro: { name: 'Pro', price: '4.99$/شهر', limit: 2000000, images: 200, usdt: PLAN_USDT.pro.price, features: PLAN_FEATURES.pro },
  business: { name: 'Business', price: '14.99$/شهر', limit: 10000000, images: 2000, usdt: PLAN_USDT.business.price, features: PLAN_FEATURES.business }
};
const FREE_LIMIT = 100000;
// راوتر FreeLLMAPI المستضاف على Railway (عام، HTTPS) — لا Termux ولا localhost
const FL_DEFAULT_URL = 'https://freellmapi-production-c529c3c7.up.railway.app/v1';
const FL_DASHBOARD_URL = 'https://freellmapi-production-c529c3c7.up.railway.app/';
const PAGE_SIZE = 50; // نافذة عرض الرسائل — للجلسات الطويلة جداً

// ---------- markdown خفيف (بدون مكتبات) ----------
// actions: { onPreviewHtml(code), onOpenUrl(url), onCopyCode(code), copiedCode } — معاينة HTML والروابط داخل التطبيق (v1.7)
function inlineMd(text, keyPrefix, actions) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>"')\]]+)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={keyPrefix + i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={keyPrefix + i}>{p.slice(1, -1)}</code>;
    if (/^https?:\/\//.test(p)) return <a key={keyPrefix + i} href={p} onClick={(e) => { e.preventDefault(); actions?.onOpenUrl?.(p); }}>{p}</a>;
    return <span key={keyPrefix + i}>{p}</span>;
  });
}
function renderMd(text, actions) {
  const t = String(text || '');
  const blocks = t.split(/```(\w*)\n?([\s\S]*?)```/g);
  const out = [];
  let curLang = '';
  for (let i = 0; i < blocks.length; i++) {
    if (i % 3 === 1) { curLang = (blocks[i] || '').toLowerCase(); continue; } // لغة الكتلة
    if (i % 3 === 2) {
      const code = blocks[i];
      const isHtml = curLang === 'html';
      out.push(
        <div key={'pre' + i} className="code-block">
          <div className="code-block-head">
            <span dir="ltr">{curLang || 'code'}</span>
            {isHtml && <button onClick={() => actions?.onPreviewHtml?.(code)}>👁 معاينة</button>}
            <button onClick={() => actions?.onCopyCode?.(code)}>{actions?.copiedCode ? '✓ تم النسخ' : '📋 نسخ'}</button>
          </div>
          <pre dir="ltr"><code>{code}</code></pre>
        </div>
      );
      continue;
    }
    const lines = blocks[i].split('\n');
    let list = [];
    const flush = () => { if (list.length) { out.push(<ul key={'ul' + out.length}>{list.map((li, j) => <li key={j}>{inlineMd(li, 'li' + j, actions)}</li>)}</ul>); list = []; } };
    lines.forEach((line, j) => {
      if (line.startsWith('### ')) { flush(); out.push(<h3 key={'h' + i + j}>{inlineMd(line.slice(4), 'h', actions)}</h3>); }
      else if (line.startsWith('## ')) { flush(); out.push(<h2 key={'h' + i + j}>{inlineMd(line.slice(3), 'h', actions)}</h2>); }
      else if (line.startsWith('# ')) { flush(); out.push(<h1 key={'h' + i + j}>{inlineMd(line.slice(2), 'h', actions)}</h1>); }
      else if (/^[-*]\s+/.test(line)) { list.push(line.replace(/^[-*]\s+/, '')); }
      else if (/^\d+\.\s+/.test(line)) { list.push(line.replace(/^\d+\.\s+/, '')); }
      else if (line.trim()) { flush(); out.push(<p key={'p' + i + j}>{inlineMd(line, 'p' + j, actions)}</p>); }
    });
    flush();
  }
  return <div className="md">{out}</div>;
}
function textOf(msg) {
  if (msg.compare) return (msg.results || []).map((r) => `[${getProvider(r.provider).name}]: ${r.error ? 'خطأ — ' + r.error : (r.content || '')}`).join('\n\n');
  if (msg.kind === 'image') return '[صورة مولّدة: ' + (msg.prompt || '') + '] ' + (msg.imageUrl || '');
  if (msg.kind === 'video') return '[فيديو مولّد: ' + (msg.prompt || '') + '] ' + (msg.videoUrl || (msg.videoJob ? 'قيد التوليد…' : ''));
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return '';
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// شعار USDT — رسم SVG مضمّن (لا يعتمد على أي صورة خارجية)
function UsdtLogo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="USDT" role="img" style={{ flexShrink: 0 }}>
      <circle cx="16" cy="16" r="16" fill="#26a17b" />
      <path d="M9 8h14v3.2h-5.4v12.8h-3.2V11.2H9z" fill="#fff" />
    </svg>
  );
}
function todayKey() { return new Date().toISOString().slice(0, 10); }
// وصف صورة من سياق الجلسة — عندما يقول المستخدم «اريد صورة هنا» دون موضوع
function subjectFromHistory(messages) {
  const last = [...(messages || [])].reverse().find((m) => m.role === 'assistant' && textOf(m).trim());
  if (!last) return '';
  return textOf(last).replace(/https?:\/\/\S+/g, ' ').replace(/[#*`_[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

// ---------- خلفية نجوم ذهبية متحركة (canvas خفيف، v1.7) ----------
// شفافة وخافتة حتى يبقى النص مقروءاً؛ تُطفأ عند prefers-reduced-motion.
function Starfield({ enabled }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let stars = [];
    let w = 0, h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const seed = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(40, Math.min(90, Math.floor((w * h) / 22000)));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: 0.6 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.9,
        vx: (Math.random() - 0.5) * 0.08,
        vy: 0.02 + Math.random() * 0.08
      }));
    };
    seed();
    window.addEventListener('resize', seed);
    const tick = (now) => {
      ctx.clearRect(0, 0, w, h);
      for (const st of stars) {
        st.x += st.vx; st.y += st.vy;
        if (st.y > h + 4) { st.y = -4; st.x = Math.random() * w; }
        if (st.x > w + 4) st.x = -4;
        if (st.x < -4) st.x = w + 4;
        const tw = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(now / 1000 * st.speed + st.phase));
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, ' + tw.toFixed(3) + ')';
        ctx.fill();
        if (st.r > 1.8) {
          ctx.strokeStyle = 'rgba(251, 191, 36, ' + (tw * 0.5).toFixed(3) + ')';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(st.x - st.r * 3, st.y); ctx.lineTo(st.x + st.r * 3, st.y);
          ctx.moveTo(st.x, st.y - st.r * 3); ctx.lineTo(st.x, st.y + st.r * 3);
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', seed); };
  }, [enabled]);
  if (!enabled) return null;
  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}

export default function Home() {
  const { data: session } = useSession(); // جلسة Google OAuth (next-auth)
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
  const googleUser = session?.user || null;
  const [plan, setPlan] = useState('free');
  const [daily, setDaily] = useState({ date: todayKey(), tokens: 0, images: 0 });
  const [keys, setKeys] = useState({});
  const [attachments, setAttachments] = useState([]);
  const [copied, setCopied] = useState('');
  const [authMsg, setAuthMsg] = useState('');
  const [googleConfigured, setGoogleConfigured] = useState(null);
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
  const [vidProvider, setVidProvider] = useState('veo3'); // Veo 3 مكتمل الآن — الافتراضي
  const [vidResult, setVidResult] = useState(null);
  const [vidLoading, setVidLoading] = useState(false);
  const [showThink, setShowThink] = useState({});
  const [lang, setLang] = useState('ar');
  const [starsOn, setStarsOn] = useState(true);
  const [preview, setPreview] = useState(null); // { kind: 'html', code } | { kind: 'url', url }
  const [expandedCompare, setExpandedCompare] = useState(null); // { msg, idx }
  // --- الدفع بـ USDT (TRC20) — v1.8 ---
  const [payPlan, setPayPlan] = useState(null); // الخطة الجاري شراؤها (id) — null تعني لا نافذة
  const [payEmail, setPayEmail] = useState('');
  const [payTxid, setPayTxid] = useState('');
  const [payStatus, setPayStatus] = useState(null); // {state:'verifying'|'ok'|'fail', message, details}
  const [payQr, setPayQr] = useState('');
  const [subscription, setSubscription] = useState(null); // {plan, txid, email, verifiedAt, expiresAt}
  const subVerifiedRef = useRef(false); // إعادة التحقق من الاشتراك مرة واحدة عند التحميل
  // --- لوحة أدوات المزود (v1.8) ---
  const [toolsSheet, setToolsSheet] = useState(null); // id المزود الذي ورقته الطويلة مفتوحة
  const [selectedTool, setSelectedTool] = useState(null); // آخر أداة اختارها المستخدم
  const [imgPreferred, setImgPreferred] = useState('auto'); // نموذج الصور المفضل: auto | nanobanana | nanobanana-2.1 | nanobanana-pro | dalle | flux
  // --- مهام الفيديو غير المتزامنة (v1.8) ---
  const [vidJob, setVidJob] = useState(null); // مهمة فيديو الدرج: {jobId, endpoint, provider, status, url, error}
  const [vidDuration, setVidDuration] = useState('8s');
  const [vidAspect, setVidAspect] = useState('16:9');
  const [vidResolution, setVidResolution] = useState('720p');
  const [activeSkills, setActiveSkills] = useState([]);
  const [customSkills, setCustomSkills] = useState([]);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillInstr, setNewSkillInstr] = useState('');
  const [conn, setConn] = useState({ github: '', vercel: '', render: '' });
  const [connStatus, setConnStatus] = useState({});
  const [connMsg, setConnMsg] = useState('');
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
      const storedUser = JSON.parse(localStorage.getItem('omni_user') || 'null');
      if (storedUser && storedUser.google) setUser(storedUser); // حسابات العرض التجريبي القديمة لا تُستعاد
      setPlan(localStorage.getItem('omni_plan') || 'free');
      // الاشتراك المدفوع (USDT): يُستعاد من المتصفح، ويُعاد التحقق منه من السلسلة (انظر useEffect أدناه)
      try {
        const sub = JSON.parse(localStorage.getItem('omni_subscription') || 'null');
        if (sub && sub.plan && sub.expiresAt > Date.now() && PLANS[sub.plan] && sub.plan !== 'free') {
          setSubscription(sub);
          setPlan(sub.plan);
        } else if (sub) {
          localStorage.removeItem('omni_subscription');
        }
      } catch {}
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
      const savedLang = localStorage.getItem('omni_lang');
      if (savedLang) setLang(savedLang);
      setStarsOn(localStorage.getItem('omni_stars') !== '0');
      try { const a = JSON.parse(localStorage.getItem('omni_skills_active') || '[]'); if (Array.isArray(a)) setActiveSkills(a); } catch {}
      try { const c = JSON.parse(localStorage.getItem('omni_custom_skills') || '[]'); if (Array.isArray(c)) setCustomSkills(c); } catch {}
      try { const cn = JSON.parse(localStorage.getItem('omni_connections') || '{}'); if (cn && typeof cn === 'object') setConn({ github: cn.github || '', vercel: cn.vercel || '', render: cn.render || '' }); } catch {}
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
  useEffect(() => { try { localStorage.setItem('omni_stars', starsOn ? '1' : '0'); } catch {} }, [starsOn]);
  useEffect(() => { try { localStorage.setItem('omni_skills_active', JSON.stringify(activeSkills)); } catch {} }, [activeSkills]);
  useEffect(() => { try { localStorage.setItem('omni_custom_skills', JSON.stringify(customSkills)); } catch {} }, [customSkills]);
  useEffect(() => { try { localStorage.setItem('omni_connections', JSON.stringify(conn)); } catch {} }, [conn]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [currentId]); // جلسة جديدة = أول 50 رسالة
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }); }, [sessions, loading]);
  // إغلاق القائمة/الدرج/الورقة/النافذة بزر Escape — يعيد دائماً إلى عرض محادثة نظيف
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSidebarOpen(false); setDrawer(null); setAuthOpen(false); setGuideOpen(false); setSheet(null); setPreview(null); setExpandedCompare(null); setToolsSheet(null); setPayPlan(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // اتجاه الصفحة ولغتها من اختيار المستخدم (v1.7)
  useEffect(() => {
    try {
      document.documentElement.lang = lang;
      document.documentElement.dir = isRTL(lang) ? 'rtl' : 'ltr';
      localStorage.setItem('omni_lang', lang);
    } catch {}
  }, [lang]);
  // هل بيانات Google OAuth مضبوطة في الخادم؟ (رسالة واضحة بدل الفشل الصامت)
  useEffect(() => {
    fetch('/api/auth/config').then((r) => r.json()).then((d) => setGoogleConfigured(!!d.googleConfigured)).catch(() => setGoogleConfigured(false));
  }, []);
  // إعادة التحقق من الاشتراك المدفوع عند التحميل: TXID مزوَّر في localStorage يسقط هنا.
  useEffect(() => {
    if (subVerifiedRef.current) return;
    let sub = null;
    try { sub = JSON.parse(localStorage.getItem('omni_subscription') || 'null'); } catch {}
    if (!sub || !sub.txid || !sub.plan || sub.plan === 'free') return;
    subVerifiedRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/verify-payment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid: sub.txid, planId: sub.plan, email: sub.email, purpose: 'recheck' })
        });
        const data = await res.json();
        if (!data.verified) {
          try { localStorage.removeItem('omni_subscription'); localStorage.setItem('omni_plan', 'free'); } catch {}
          setSubscription(null); setPlan('free');
        }
      } catch {}
    })();
  }, []);
  // توليد QR لعنوان محفظة USDT عند فتح نافذة الدفع
  useEffect(() => {
    if (!payPlan) { setPayQr(''); return; }
    let alive = true;
    QRCode.toDataURL(USDT_WALLET, { width: 220, margin: 1, color: { dark: '#111111', light: '#ffffff' } })
      .then((url) => { if (alive) setPayQr(url); })
      .catch(() => { if (alive) setPayQr(''); });
    return () => { alive = false; };
  }, [payPlan]);
  // مزامنة حساب Google من جلسة next-auth إلى حالة الواجهة
  useEffect(() => {
    if (session?.user) {
      const u = { contact: session.user.email || session.user.name, name: session.user.name, email: session.user.email, image: session.user.image, google: true };
      setUser(u);
      try { localStorage.setItem('omni_user', JSON.stringify(u)); } catch {}
    }
  }, [session]);

  const current = sessions.find((s) => s.id === currentId) || sessions[0];
  const totalTokens = useMemo(() => sessions.reduce((n, s) => n + (s.tokens || 0), 0), [sessions]);
  const planInfo = PLANS[plan];
  const remaining = Math.max(0, planInfo.limit - daily.tokens);
  const provider = getProvider(providerId === 'auto' ? 'groq' : providerId);
  const tt = (k) => t(lang, k);
  const dailyExhausted = daily.tokens >= planInfo.limit;
  const previewActions = { onPreviewHtml: (code) => setPreview({ kind: 'html', code }), onOpenUrl: (url) => setPreview({ kind: 'url', url }), onCopyCode: (code) => copyText(code, 'codeblock'), copiedCode: copied === 'codeblock' };

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
  function saveCustomBase(v) { setCustomBase(v); try { localStorage.setItem('omni_custom_base', v); } catch {} }
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

  // ---------- المهارات: تعليمات تُلحق بموجه النظام (v1.7) ----------
  function activeSkillInstructions() {
    const out = [];
    for (const id of activeSkills) {
      if (id.startsWith('custom:')) {
        const c = customSkills.find((x) => 'custom:' + x.id === id);
        if (c) out.push(String(c.instructions || '').slice(0, 800));
      } else {
        const b = BUILTIN_SKILLS.find((x) => x.id === id);
        if (b) out.push(b.instructions);
      }
    }
    return out;
  }
  function toggleSkill(id) { setActiveSkills((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); }
  function addCustomSkill() {
    const name = newSkillName.trim();
    const instr = newSkillInstr.trim();
    if (!name || !instr) { setError('اكتب اسم المهارة وتعليماتها أولاً.'); return; }
    const s = { id: uid(), name: name.slice(0, 40), instructions: instr.slice(0, 1000) };
    setCustomSkills((p) => [...p, s]);
    setActiveSkills((p) => [...p, 'custom:' + s.id]);
    setNewSkillName(''); setNewSkillInstr(''); setError('');
  }

  // ---------- الربط: سياق حقيقي من خدمة موصولة يُضمَّن في المحادثة (v1.7) ----------
  function connectionIntent(text) {
    const tx = String(text || '');
    if (/vercel|فيرسل|فيرسيل/i.test(tx) && /مشروع|مشاريع|project/i.test(tx)) return 'vercel';
    if (/github|جيت\s?هب|غيت\s?هب|مستودع|مستودعات|repo/i.test(tx)) return 'github';
    if (/render|ريندر/i.test(tx) && /خدم|service/i.test(tx)) return 'render';
    return null;
  }
  async function connectionContextFor(text) {
    const svc = connectionIntent(text);
    if (!svc || !conn[svc]) return '';
    try {
      const action = svc === 'github' ? 'listRepos' : svc === 'vercel' ? 'listProjects' : 'listServices';
      const r = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: svc, action, token: conn[svc] }), signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (!r.ok) return '';
      const items = d.repos || d.projects || d.services || [];
      if (!items.length) return '\n\n[بيانات حقيقية من ' + svc + ': لا توجد عناصر بعد.]';
      const lines = items.slice(0, 20).map((x) => '- ' + (x.name || x.id) + (x.url ? ' (' + x.url + ')' : '')).join('\n');
      return '\n\n[بيانات حقيقية من ' + svc + ' — أجب بناءً عليها فقط:\n' + lines + ']';
    } catch { return ''; }
  }
  async function testConnection(svc) {
    const token = conn[svc];
    if (!token) { setConnStatus((p) => ({ ...p, [svc]: 'missing' })); setConnMsg('ألصق التوكن أولاً ثم اضغط «اختبار الاتصال».'); return; }
    setConnStatus((p) => ({ ...p, [svc]: 'testing' }));
    try {
      const action = svc === 'github' ? 'listRepos' : svc === 'vercel' ? 'listProjects' : 'listServices';
      const r = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: svc, action, token }) });
      const d = await r.json();
      setConnStatus((p) => ({ ...p, [svc]: r.ok ? 'ok' : 'fail' }));
      setConnMsg(r.ok ? svc + ' ✓ متصل — ' + (d.count ?? 0) + ' عنصر' : (d.error || 'فشل الاتصال'));
    } catch (e) { setConnStatus((p) => ({ ...p, [svc]: 'fail' })); setConnMsg('تعذّر الاتصال: ' + String(e.message || e)); }
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
            baseURL: flUrl || FL_DEFAULT_URL, deepThinking, lang, skills: activeSkillInstructions()
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
            apiKeys: keys, deepThinking, lang, skills: activeSkillInstructions()
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

  async function sendCompare(textOverride, opts = {}) {
    const text = (textOverride ?? input).trim();
    if (!text && attachments.length === 0) return;
    if (daily.tokens >= planInfo.limit) { setError(tt('dailyLimitReached')); setDrawer('pricing'); return; }
    if (!current) return;
    if (!compareProviders.length) { setError('اختر مزوداً واحداً على الأقل للمقارنة.'); return; }
    setError('');
    const attachText = attachments.filter((a) => a.kind === 'text').map((a) => `\n\n[ملف: ${a.name}]\n${a.content.slice(0, 12000)}`).join('');
    const imageAtt = attachments.find((a) => a.kind === 'image');
    const pdfNote = attachments.filter((a) => a.kind === 'pdf').map((a) => `\n[ملف PDF مرفق: ${a.name} — لم يُستخرج نصه، انسخ نصه والصقه.]`).join('');
    const userContent = text + attachText + pdfNote + (opts.context || '');
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
    if (daily.tokens >= planInfo.limit) { setError(tt('dailyLimitReached')); setDrawer('pricing'); return; }
    if (!current) return;
    const deep = opts.deep || deepThinking;
    setError('');
    const attachText = attachments.filter((a) => a.kind === 'text').map((a) => `\n\n[ملف: ${a.name}]\n${a.content.slice(0, 12000)}`).join('');
    const imageAtt = attachments.find((a) => a.kind === 'image');
    const pdfNote = attachments.filter((a) => a.kind === 'pdf').map((a) => `\n[ملف PDF مرفق: ${a.name} — لم يُستخرج نصه، انسخ نصه والصقه.]`).join('');
    let userContent = text + attachText + pdfNote + (opts.context || '');
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
            baseURL: flUrl || FL_DEFAULT_URL, deepThinking: deep, lang, skills: activeSkillInstructions()
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
            deepThinking: deep, lang, skills: activeSkillInstructions()
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
        body: JSON.stringify({ prompt, apiKeys: keys, flKeys: flKeys.filter((k) => k.status !== 'exhausted').map((k) => ({ value: k.value })), flUrl: flUrl || FL_DEFAULT_URL, size: '1024x1024', preferred: imgPreferred })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل توليد الصورة.');
      const viaName = data.via === 'huggingface-space' ? 'Hugging Face FLUX (مجاني بدون مفتاح)' : data.via === 'freellmapi' ? 'FreeLLMAPI Router' : data.via === 'gemini' ? 'Nano Banana (Google Gemini)' : getProvider(data.via).name;
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
  // الفيديو غير متزامن: المهمة تُعرض في رسالة وتُحدَّث عند اكتمالها (استطلاع كل 8 ثوانٍ).
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
      const res = await fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, provider: vidProvider, apiKeys: keys, duration: vidDuration, aspectRatio: vidAspect, resolution: vidResolution }) });
      const data = await res.json();
      if (res.ok && data.status === 'queued') {
        const msgId = uid();
        updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, { id: msgId, role: 'assistant', kind: 'video', prompt, videoJob: { jobId: data.jobId, endpoint: data.endpoint, provider: data.provider, model: data.model, status: 'queued' }, tokens: 0 }] }));
        pollVideoJob(current.id, data.jobId, data.endpoint, data.provider, msgId);
      } else if (res.ok && data.status === 'completed' && (data.url || data.videoUrl)) {
        updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, { role: 'assistant', kind: 'video', prompt, videoUrl: data.url || data.videoUrl, note: data.model ? 'عبر: ' + data.model : null, tokens: 0 }] }));
      } else {
        const content = (data.error || 'تعذّر توليد الفيديو.') + (data.howTo ? '\n\n' + data.howTo : '');
        updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, { role: 'assistant', content, tokens: estimateTokens(content) }] }));
      }
    } catch (e) {
      updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, { role: 'assistant', content: 'تعذّر توليد الفيديو: ' + String(e.message || e), tokens: 0 }] }));
    } finally { setLoading(false); }
  }

  // ---------- نقطة الدخول الواحدة للإرسال: الأداة الصريحة تفوز، ثم الكشف الذكي ----------
  async function sendCurrent(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!text && attachments.length === 0) return;
    const tool = pendingTool;
    setPendingTool(null);
    setSelectedTool(null);
    if (tool === 'image') { genImageChat(textOverride); return; }
    if (tool === 'video') { genVideoChat(textOverride); return; }
    const hasImage = attachments.some((a) => a.kind === 'image');
    const intent = detectIntent(text, { hasImageAttachment: hasImage });
    if (intent.type === 'image') { genImageChat(textOverride); return; }
    if (intent.type === 'video') { genVideoChat(textOverride); return; }
    // سياق خدمة موصولة (GitHub/Vercel/Render) يُجلب أولاً إن سُئل عنها
    const ctx = await connectionContextFor(text);
    if (intent.type === 'compare') { if (!compareOn) enableCompare(); sendCompare(textOverride, { context: ctx }); return; }
    if (intent.type === 'deep') { sendMessage(textOverride, { deep: true, context: ctx }); return; }
    if (compareOn) sendCompare(textOverride, { context: ctx }); else sendMessage(textOverride, { context: ctx });
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

  // --- الدفع بـ USDT (TRC20) — v1.8 ---
  const CHECK_LABELS = {
    txExists: 'المعاملة موجودة على سلسلة TRON',
    txSuccess: 'المعاملة ناجحة (مؤكدة)',
    transferFound: 'تحويل USDT موجود في المعاملة',
    recipientOk: 'المستلم هو محفظة الموقع',
    amountOk: 'المبلغ يطابق سعر الخطة بالضبط',
    recentOk: 'المعاملة حديثة (آخر 24 ساعة)',
    notSelf: 'المرسل ليس المحفظة نفسها'
  };
  function openPay(id) {
    setPayPlan(id);
    setPayEmail((googleUser && googleUser.email) || (user && user.email) || '');
    setPayTxid(''); setPayStatus(null);
  }
  // تغيير الخطة من الإعدادات: المدفوعة لا تُختار إلا باشتراك موثّق، وإلا تُفتح بطاقات الأسعار.
  function changePlan(id) {
    if (id === 'free') { setPlan('free'); return; }
    if (subscription && subscription.plan === id && subscription.expiresAt > Date.now()) { setPlan(id); return; }
    setDrawer('pricing'); setError('خطة ' + (PLANS[id] ? PLANS[id].name : id) + ' تحتاج شراءً بـ USDT — اخترها من بطاقات الأسعار وأكمل الدفع.');
  }
  async function verifyPayment() {
    const planId = payPlan; if (!planId) return;
    const txid = payTxid.trim();
    if (!txid) { setPayStatus({ state: 'fail', message: 'الصق رقم المعاملة (TXID) بعد إرسال الدفع أولاً.' }); return; }
    let used = [];
    try { used = JSON.parse(localStorage.getItem('omni_used_txids') || '[]'); } catch {}
    if (used.map((x) => String(x).toLowerCase()).includes(txid.toLowerCase())) {
      setPayStatus({ state: 'fail', message: 'هذا TXID استُخدم من قبل على هذا الجهاز — كل دفعة معاملة جديدة.' });
      return;
    }
    setPayStatus({ state: 'verifying', message: 'جارٍ التحقق من سلسلة TRON…' });
    try {
      const res = await fetch('/api/verify-payment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid, planId, email: payEmail.trim() })
      });
      const data = await res.json();
      if (data.verified) {
        const sub = { plan: planId, txid: data.txid, email: data.email, verifiedAt: Date.now(), expiresAt: Date.now() + 30 * 24 * 3600 * 1000 };
        try {
          localStorage.setItem('omni_subscription', JSON.stringify(sub));
          localStorage.setItem('omni_plan', planId);
          localStorage.setItem('omni_used_txids', JSON.stringify([...used, data.txid].slice(-50)));
        } catch {}
        setPlan(planId); setSubscription(sub);
        setPayStatus({ state: 'ok', message: 'تم التحقق من الدفع وتفعيل خطة ' + PLANS[planId].name + ' لمدة شهر ✓', details: data });
      } else {
        setPayStatus({ state: 'fail', message: data.reason || 'تعذّر التحقق من الدفع.', details: data });
      }
    } catch (e) {
      setPayStatus({ state: 'fail', message: 'تعذّر الوصول إلى خادم التحقق: ' + String(e.message || e) });
    }
  }

  // --- لوحة أدوات المزود (v1.8) ---
  function toolNameById(id) {
    for (const p of PROVIDERS) for (const t of (p.tools || [])) if (t.id === id) return t.name;
    return null;
  }
  function applyTool(tool) {
    setToolsSheet(null);
    setSelectedTool(tool.id);
    if (tool.id === 'chat') return;
    if (tool.id === 'code') {
      if (!activeSkills.includes('web-dev')) toggleSkill('web-dev');
      setDeepThinking(false);
      setTimeout(() => composerRef.current?.focus(), 50);
      return;
    }
    if (tool.id === 'analysis') {
      if (!activeSkills.includes('data-analyst')) toggleSkill('data-analyst');
      setTimeout(() => composerRef.current?.focus(), 50);
      return;
    }
    if (tool.id === 'research') { setDeepThinking(true); setTimeout(() => composerRef.current?.focus(), 50); return; }
    if (tool.id === 'compare') {
      if (!compareOn) setCompareOn(true);
      setTimeout(() => composerRef.current?.focus(), 50);
      return;
    }
    if (tool.id === 'image' || tool.id === 'image-flux') { setImgPreferred(tool.id === 'image-flux' ? 'flux' : 'auto'); setPendingTool('image'); setTimeout(() => composerRef.current?.focus(), 50); return; }
    if (tool.id === 'image-nanobanana') { setImgPreferred('nanobanana'); setPendingTool('image'); setTimeout(() => composerRef.current?.focus(), 50); return; }
    if (tool.id === 'image-nanobanana-pro') { setImgPreferred('nanobanana-pro'); setPendingTool('image'); setTimeout(() => composerRef.current?.focus(), 50); return; }
    if (tool.id === 'video-veo3') { setVidProvider('veo3'); setPendingTool('video'); setTimeout(() => composerRef.current?.focus(), 50); return; }
    if (tool.id === 'video-seedance') { setVidProvider('seedance'); setPendingTool('video'); setTimeout(() => composerRef.current?.focus(), 50); return; }
    if (tool.id === 'video-omni') { setVidProvider('omni'); setPendingTool('video'); setTimeout(() => composerRef.current?.focus(), 50); return; }
  }
  // --- مهام الفيديو غير المتزامنة (v1.8) ---
  // استطلاع حالة مهمة fal حتى اكتمالها (كل 8 ثوانٍ، بحد أقصى ~10 دقائق)،
  // ثم تحديث رسالة الفيديو في المحادثة (أو بطاقة الدرج) بالنتيجة.
  function pollVideoJob(sessionId, jobId, endpoint, providerName, chatMsgId) {
    let tries = 0;
    const tick = async () => {
      tries += 1;
      if (tries > 75) {
        const err = 'انتهت مهلة الانتظار (10 دقائق) — الفيديو قد يكون ما زال يُولَّد؛ جرّب لاحقاً.';
        if (chatMsgId) updateSession(sessionId, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === chatMsgId ? { ...m, videoJob: null, note: err } : m)) }));
        else setVidJob((j) => (j && j.jobId === jobId ? { ...j, status: 'failed', error: err } : j));
        return;
      }
      try {
        const res = await fetch('/api/video/status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, jobId, apiKeys: keys })
        });
        const data = await res.json();
        if (data.status === 'completed' && data.url) {
          if (chatMsgId) updateSession(sessionId, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === chatMsgId ? { ...m, videoUrl: data.url, videoJob: null, note: null } : m)) }));
          else setVidJob((j) => (j && j.jobId === jobId ? { ...j, status: 'completed', url: data.url } : j));
          return;
        }
        if (data.status === 'failed' || res.status >= 400) {
          const err = data.error || 'فشل توليد الفيديو.';
          if (chatMsgId) updateSession(sessionId, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === chatMsgId ? { ...m, videoJob: null, note: err } : m)) }));
          else setVidJob((j) => (j && j.jobId === jobId ? { ...j, status: 'failed', error: err } : j));
          return;
        }
        setTimeout(tick, 8000);
      } catch (e) {
        setTimeout(tick, 8000);
      }
    };
    setTimeout(tick, 8000);
  }

  // ---------- المصادقة الحقيقية: Google OAuth عبر next-auth (v1.7) ----------
  // الجلسة تُحفظ في ملف تعريف (cookie) آمن — إعادة فتح الموقع تسجّل الدخول تلقائياً.
  async function googleLogin() {
    setAuthMsg('');
    if (googleConfigured === false) { setAuthMsg(tt('googleSetupMissing')); return; }
    try { await signIn('google', { callbackUrl: '/' }); }
    catch (e) { setAuthMsg('تعذّر فتح تسجيل الدخول: ' + String(e.message || e)); }
  }
  async function googleLogout() {
    try { await signOut({ callbackUrl: '/' }); } catch {}
    setUser(null);
    try { localStorage.removeItem('omni_user'); } catch {}
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
      const res = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: imgPrompt, apiKeys: keys, flKeys: flKeys.filter((k) => k.status !== 'exhausted').map((k) => ({ value: k.value })), flUrl: flUrl || FL_DEFAULT_URL, size: imgSize, preferred: imgPreferred }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل توليد الصورة.');
      setImgResult(data); setDaily((d) => ({ ...d, images: d.images + 1 }));
    } catch (e) { setImgResult({ error: String(e.message || e) }); }
    finally { setImgLoading(false); }
  }
  async function genVideo() {
    if (!vidPrompt.trim()) return;
    setVidLoading(true); setVidResult(null); setVidJob(null);
    try {
      const res = await fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: vidPrompt, provider: vidProvider, apiKeys: keys, duration: vidDuration, aspectRatio: vidAspect, resolution: vidResolution }) });
      const data = await res.json();
      if (res.ok && data.status === 'queued') {
        setVidJob({ jobId: data.jobId, endpoint: data.endpoint, provider: data.provider, model: data.model, status: 'queued' });
        pollVideoJob(null, data.jobId, data.endpoint, data.provider, null);
      } else {
        setVidResult({ status: res.status, ...data });
      }
    } catch (e) { setVidResult({ error: String(e.message || e) }); }
    finally { setVidLoading(false); }
  }

  function exportSession(fmt) {
    if (!current) return;
    const data = fmt === 'json'
      ? JSON.stringify(current, null, 2)
      : '# ' + current.title + '\n\n' + current.messages.map((m) => (m.role === 'user' ? '## أنت' : '## CHIBANI AI' + (m.provider ? ` (${m.provider} / ${m.model})` : '')) + '\n\n' + textOf(m) + '\n').join('\n');
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

  const currentModelLabel = compareOn ? '⚔️ ' + tt('compare') + ' (' + compareProviders.length + ')' : (providerId === 'auto' ? '⚡ تلقائي' : provider.name + (model ? ' · ' + model : ''));
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
      <Starfield enabled={starsOn} />
      {/* خلفية معتمة للقائمة الجانبية على الهاتف — النقر عليها يغلقها */}
      {sidebarOpen && <div className="backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      {/* الشريط الجانبي — كل التفاصيل هنا، لا شيء منها في الواجهة الرئيسية */}
      <aside className={'sidebar' + (sidebarOpen ? ' open' : '')}>
        <div className="sidebar-head">
          <div className="logo">CHIBANI AI <small>{tt('tagline')}</small></div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="إغلاق القائمة">✕</button>
        </div>
        <button className="btn btn-block" onClick={newChat}>{tt('newChat')}</button>
        <div className="stat-box">
          {tt('plan')}: <b>{planInfo.name}</b> — {planInfo.price}<br />
          {tt('tokensToday')}: <b>{formatTokens(daily.tokens)}</b> / {formatTokens(planInfo.limit)} — {tt('remaining')} <b>{formatTokens(remaining)}</b><br />
          {tt('allSessions')}: <b>{formatTokens(totalTokens)}</b> توكن · {sessions.length} {tt('sessions')}<br />
          {googleUser ? <>{tt('account')}: {googleUser.email || googleUser.name}</> : tt('notLoggedIn')}
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
          <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)' }}>{tt('language')}</label>
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={tt('language')}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
          </select>
          <button className="btn ghost" onClick={() => { setDrawer('skills'); setSidebarOpen(false); }}>🎯 {tt('skills')}</button>
          <button className="btn ghost" onClick={() => { setDrawer('connections'); setSidebarOpen(false); }}>🔗 {tt('connections')}</button>
          <button className="btn ghost" onClick={() => { setGuideOpen(true); setSidebarOpen(false); }}>🚀 {tt('freellmapiGuide')}</button>
          <button className="btn ghost" onClick={() => { setDrawer('freellmapi'); setSidebarOpen(false); }}>⚙️ {tt('freellmapi')} {flKeys.length ? '✓ ' + flKeys.length : ''}</button>
          <button className="btn ghost" onClick={() => { setDrawer('keys'); setSidebarOpen(false); }}>🔑 {tt('keys')}</button>
          <button className="btn ghost" onClick={() => { setDrawer('image'); setSidebarOpen(false); }}>🖼 {tt('imageGen')}</button>
          <button className="btn ghost" onClick={() => { setDrawer('video'); setSidebarOpen(false); }}>🎬 {tt('videoGen')}</button>
          <button className="btn ghost" onClick={() => { setDrawer('stats'); setSidebarOpen(false); }}>📊 {tt('stats')}</button>
          <button className="btn ghost" onClick={() => { setDrawer('pricing'); setSidebarOpen(false); }}>💎 {tt('pricing')}</button>
          <button className="btn ghost" onClick={() => { setDrawer('settings'); setSidebarOpen(false); }}>⚙️ {tt('settings')}</button>
          {googleUser
            ? <button className="btn ghost" onClick={googleLogout}>🚪 {tt('logout')} ({googleUser.name || googleUser.email})</button>
            : <button className="btn ghost" onClick={() => { setAuthOpen(true); setSidebarOpen(false); }}>👤 {tt('login')}</button>}
        </div>
      </aside>

      {/* الرئيسي — واجهة نظيفة بأسلوب Claude: لا أشرطة مزدحمة ولا أزرار زائدة */}
      <main className="main">
        <header className="topbar-main">
          <button className="menu-btn" onClick={() => setSidebarOpen(true)} aria-label="فتح القائمة">☰</button>
          <span className="brand">CHIBANI AI</span>
          <span className="session-title">{current?.title || ''}</span>
          <span className="plan-meter" title={tt('dailyTokens') + ': ' + formatTokens(daily.tokens) + ' / ' + formatTokens(planInfo.limit)}>
            <span className="plan-meter-label">{formatTokens(daily.tokens)} / {formatTokens(planInfo.limit)}</span>
            <span className="plan-meter-bar"><i style={{ width: Math.min(100, (daily.tokens / planInfo.limit) * 100) + '%' }} /></span>
          </span>
          <span className="spacer" />
        </header>

        <div className="chat" ref={chatRef}>
          <div className="chat-inner">
            {!current || current.messages.length === 0 ? (
              <div className="empty">
                <h2>{tt('greeting')}</h2>
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
                          <div key={j} className={'compare-card' + (r.error ? ' failed' : '') + (r.fastest ? ' fastest winner' : '')} style={{ borderTop: '3px solid ' + (getProvider(r.provider).color || '#8b5cf6') }} onClick={() => { if (!r.error) setExpandedCompare({ msg: i, idx: j }); }}>
                            <div className="compare-card-head">
                              <b>{getProvider(r.provider).name}</b>
                              {r.fastest && <><span className="badge fast">{tt('fastest')}</span><span className="badge winner">{tt('winner')}</span></>}
                              <span dir="ltr">{r.model || ''}</span>
                            </div>
                            {r.error ? (
                              <div className="note">⚠️ {r.error}</div>
                            ) : (
                              <>
                                {renderMd(r.content, previewActions)}
                                {r.reasoning && (
                                  <details className="think">
                                    <summary>{tt('showThinking')}</summary>
                                    <div style={{ marginTop: 6 }}>{renderMd(r.reasoning, previewActions)}</div>
                                  </details>
                                )}
                              </>
                            )}
                            <div className="compare-card-foot">
                              <span>{formatTokens(r.tokens || 0)} توكن</span>
                              <span>{Number(r.seconds || 0).toFixed(1)} ثانية</span>
                              {r.via && <span>المسار: {r.via}</span>}
                              {!r.error && <button onClick={(e) => { e.stopPropagation(); copyText(r.content, 'cmp' + i + '-' + j); }}>{copied === 'cmp' + i + '-' + j ? '✓ تم النسخ' : '📋 نسخ'}</button>}
                              {!r.error && <button onClick={(e) => { e.stopPropagation(); setExpandedCompare({ msg: i, idx: j }); }}>⤢ {tt('expand')}</button>}
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
                          <span>{m.role === 'user' ? 'أنت' : 'CHIBANI AI'}</span>
                          {m.provider && <span>المزود: {getProvider(m.provider).name} · {m.model}</span>}
                          {m.via && <span>المسار: {m.via}</span>}
                          <span>{formatTokens(m.tokens || estimateTokens(textOf(m)))} توكن</span>
                        </div>
                        {m.route && m.role === 'user' && <div className="route-chip">تم التوجيه إلى: {ROUTE_LABELS[m.route] || m.route}</div>}
                        {m.kind === 'video' ? (
                          <>
                            {m.videoUrl ? (
                              <>
                                <video className="gen" src={m.videoUrl} controls playsInline />
                                <div className="msg-actions">
                                  <a className="btn ghost small" href={m.videoUrl} download target="_blank" rel="noreferrer">⬇ تنزيل الفيديو</a>
                                  <button onClick={() => copyText(m.videoUrl, 'vid' + i)}>{copied === 'vid' + i ? '✓ نُسخ الرابط' : 'نسخ رابط الفيديو'}</button>
                                </div>
                              </>
                            ) : m.videoJob ? (
                              <div className="note blue" style={{ marginTop: 10 }}>🎬 جارٍ توليد الفيديو عبر {m.videoJob.model || m.videoJob.provider}… المهمة {String(m.videoJob.jobId).slice(0, 8)} — قد تستغرق 1–3 دقائق، وسيظهر الفيديو هنا فور اكتماله.</div>
                            ) : null}
                            {m.note && <div className="note blue" style={{ marginTop: 10 }}>{m.note}</div>}
                          </>
                        ) : m.kind === 'image' ? (
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
                            {renderMd(textOf(m, previewActions), previewActions)}
                            {m.reasoning && (
                              <details className="think" open={!!showThink[i]} onToggle={(e) => setShowThink((p) => ({ ...p, [i]: e.target.open }))}>
                                <summary>{tt('showThinking')}</summary>
                                <div style={{ marginTop: 6 }}>{renderMd(m.reasoning, previewActions)}</div>
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
            {loading && <div className="msg"><div className="avatar ai">✦</div><div className="msg-body">{deepThinking ? <div className="thinking-live">🧠 {tt('thinkingNow')}<br /><span>أحلّل سؤالك خطوة بخطوة قبل كتابة الإجابة النهائية…</span></div> : <><div className="typing"><i /><i /><i /></div><span style={{ fontSize: 13, color: 'var(--muted)' }}>جارٍ التفكير…</span></>}</div></div>}
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
          {dailyExhausted && (
            <div className="note" style={{ margin: '0 0 10px' }}>⚠️ {tt('dailyLimitReached')}{' '}<button className="btn small" onClick={() => setDrawer('pricing')}>{tt('pricing')}</button></div>
          )}
          <div className="composer-top">
            <button className="model-pill-btn" onClick={() => setSheet('model')} aria-label="اختيار النموذج">{currentModelLabel} <span aria-hidden="true">⌄</span></button>
            {deepThinking && <span className="mini-chip">🧠 {tt('deepThinking')}</span>}
            {pendingTool && <span className="mini-chip">الأداة: {pendingTool === 'image' ? '🖼 توليد صورة' : '🎬 توليد فيديو'} <button onClick={() => setPendingTool(null)} aria-label="إلغاء الأداة">✕</button></span>}
            {selectedTool && !pendingTool && <span className="mini-chip">الأداة: {toolNameById(selectedTool) || selectedTool} <button onClick={() => setSelectedTool(null)} aria-label="إلغاء الأداة">✕</button></span>}
          </div>
          {/* شريط أدوات المزود المحدد — نص صغير، قابل للتمرير؛ النقر يفتح الورقة الطويلة (v1.8) */}
          <div className="tools-strip" role="group" aria-label={'أدوات ' + provider.name}>
            {(provider.tools || []).map((tool) => (
              <button key={tool.id} className={'tool-chip' + (selectedTool === tool.id ? ' on' : '')} onClick={() => setToolsSheet(provider.id)} title={tool.desc}>
                <span className="tool-chip-dot" style={{ background: (FEATURES[tool.feature] || FEATURES.chat).color }} />
                {tool.name}
              </button>
            ))}
            <button className="tool-chip more" onClick={() => setToolsSheet(provider.id)} aria-label="كل أدوات المزود">⋯ كل الأدوات</button>
          </div>
          <div className="composer-row">
            <button className="plus-btn" onClick={() => setSheet('tools')} title="إضافة أداة" aria-label="إضافة أداة">+</button>
            <textarea ref={composerRef} value={input} onChange={(e) => setInput(e.target.value)} onPaste={onPaste}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); } }}
              aria-label="اكتب رسالتك" disabled={loading || dailyExhausted} />
            <button className="send-btn" onClick={() => sendCurrent()} disabled={loading || dailyExhausted}>{loading ? '…' : tt('send')}</button>
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
              <h2>{tt('chooseModel')}</h2>
              <button className="sidebar-close" style={{ display: 'inline-flex' }} onClick={() => setSheet(null)} aria-label="إغلاق">✕</button>
            </div>
            <div className="model-list">
              <button className={'model-card' + (providerId === 'auto' && !compareOn ? ' selected' : '')} onClick={() => { setProviderId('auto'); setModel(''); setCompareOn(false); setSheet(null); }}>
                <span className="model-name">⚡ تلقائي</span>
                <span className="model-badge">الأسرع</span>
                <span className="model-desc">يختار أفضل مزود متاح، وينتقل للبديل تلقائياً عند نفاد الرصيد</span>
                {providerId === 'auto' && !compareOn && <span className="model-check">✓</span>}
              </button>
              {PROVIDERS.filter((p) => !p.videoOnly).map((p) => {
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
                {PROVIDERS.filter((p) => p.id !== 'ollama' && p.id !== 'custom' && !p.videoOnly).map((p) => {
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
              <h2>{tt('addToChat')}</h2>
              <button className="sidebar-close" style={{ display: 'inline-flex' }} onClick={() => setSheet(null)} aria-label="إغلاق">✕</button>
            </div>
            <div className="tool-list-sheet">
              <button className="tool-row" onClick={() => chooseTool('image')}>
                <span className="tool-icon">🖼</span>
                <span className="tool-text"><b>توليد صورة</b><small>صورة من وصفك — DALL·E أو FLUX إن وُجد مفتاح، وإلا بديل مجاني</small></span>
              </button>
              <button className="tool-row" onClick={() => chooseTool('video')}>
                <span className="tool-icon">🎬</span>
                <span className="tool-text"><b>توليد فيديو</b><small>Veo 3 و Seedance 2.5 بمفتاح fal.ai، أو Omni بمفتاح Gemini</small></span>
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

      {/* ورقة أدوات المزود الطويلة (v1.8): كل أدوات المزود المحدد مع شارة ميزته بلونها */}
      {toolsSheet && (() => {
        const p = getProvider(toolsSheet) || provider;
        return (
          <>
            <div className="sheet-back" onClick={() => setToolsSheet(null)} aria-hidden="true" />
            <div className="sheet tall" role="dialog" aria-label={'أدوات ' + p.name}>
              <div className="sheet-grip" />
              <div className="sheet-head">
                <h2>🛠 أدوات {p.name}</h2>
                <button className="sidebar-close" style={{ display: 'inline-flex' }} onClick={() => setToolsSheet(null)} aria-label="إغلاق">✕</button>
              </div>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' }}>اختر أداة — ستُفعَّل للرسالة التالية (برمجة، بحث عميق، توليد صورة أو فيديو…).</p>
              <div className="tool-list-sheet">
                {(p.tools || []).map((tool) => {
                  const f = FEATURES[tool.feature] || FEATURES.chat;
                  return (
                    <button key={tool.id} className="tool-row" onClick={() => applyTool(tool)}>
                      <span className="tool-icon" style={{ background: f.color + '22', color: f.color }}>●</span>
                      <span className="tool-text"><b>{tool.name}</b><small>{tool.desc}</small></span>
                      <span className="feature-badge" style={{ background: f.color }}>{f.label}</span>
                      {selectedTool === tool.id && <span className="model-check">✓</span>}
                    </button>
                  );
                })}
              </div>
              <div className="note blue" style={{ marginTop: 12 }}>الأدوات التي تحتاج مفتاحاً (Nano Banana، Veo 3، Seedance) تُضاف مفاتيحها من «مدير المفاتيح» — كل مفتاح إضافي يدخل في التناوب التلقائي عند نفاد رصيد الأول.</div>
            </div>
          </>
        );
      })()}

      {/* درج جانبي: مفاتيح / صور / فيديو / إحصائيات / أسعار / إعدادات */}
      {drawer && (
        <>
          <div className="backdrop" style={{ display: 'block', zIndex: 65 }} onClick={() => setDrawer(null)} aria-hidden="true" />
          <div className="drawer">
            <div className="drawer-head">
              <h2>{drawer === 'keys' ? '🔑 ' + tt('keys') : drawer === 'freellmapi' ? '🚀 FreeLLMAPI — الراوتر المستضاف' : drawer === 'image' ? '🖼 ' + tt('imageGen') : drawer === 'video' ? '🎬 ' + tt('videoGen') : drawer === 'stats' ? '📊 ' + tt('stats') : drawer === 'pricing' ? '💎 ' + tt('pricing') : drawer === 'skills' ? '🎯 ' + tt('skills') : drawer === 'connections' ? '🔗 ' + tt('connections') : '⚙️ ' + tt('settings')}</h2>
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
              <p>بمفتاح محفوظ: Nano Banana 2 (Google) أو DALL·E 3 أو FLUX بجودة عالية. بدون مفتاح: نموذج FLUX.1-schnell مفتوح المصدر مجاناً (قد ينتظر في الطابور). الوصف العربي يُترجم تلقائياً إلى الإنجليزية قبل التوليد.</p>
              <div className="field"><label>وصف الصورة</label><textarea value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)} rows={3} placeholder="مدينة مستقبلية عند الغروب، أسلوب سينمائي…" /></div>
              <div className="field"><label>نموذج الصور</label><select value={imgPreferred} onChange={(e) => setImgPreferred(e.target.value)}>
                <option value="auto">تلقائي — الأفضل المتاح بمفاتيحك</option>
                <option value="nanobanana-2.1">Nano Banana 2.1 — الأحدث (مفتاح Gemini)</option>
                <option value="nanobanana">Nano Banana 2 (مفتاح Gemini)</option>
                <option value="nanobanana-pro">Nano Banana Pro — أعلى جودة (مفتاح Gemini)</option>
                <option value="dalle">DALL·E 3 (مفتاح OpenAI)</option>
                <option value="flux">FLUX (مفتاح Together أو Hugging Face)</option>
              </select></div>
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
                <p>تم التوليد عبر: {imgResult.via === 'huggingface-space' ? 'Hugging Face FLUX (مجاني بدون مفتاح)' : imgResult.via === 'freellmapi' ? 'FreeLLMAPI Router' : imgResult.via === 'gemini' ? 'Nano Banana (Google Gemini)' : getProvider(imgResult.via).name}</p>
              </>)}
            </>)}

            {drawer === 'video' && (<>
              <p>فيديو حقيقي فقط — بلا فيديو وهمي أبداً. Veo 3 و Seedance 2.5 بمفتاح fal.ai واحد (مدفوع حسب الاستخدام، بلا اشتراك)، أو Omni Flash بمفتاح Gemini المجاني. الفيديو يُولَّد في الخلفية وتظهر حالته هنا حتى يكتمل.</p>
              <div className="field"><label>وصف الفيديو</label><textarea value={vidPrompt} onChange={(e) => setVidPrompt(e.target.value)} rows={3} placeholder="موجة بحر تتحرك ببطء عند الفجر…" /></div>
              <div className="field"><label>النموذج</label><select value={vidProvider} onChange={(e) => setVidProvider(e.target.value)}>
                <option value="veo3">Veo 3 — سينمائي حتى 8 ثوانٍ بصوت (fal.ai)</option>
                <option value="seedance">Seedance 2.5 — حتى 30 ثانية، حتى 4K (fal.ai)</option>
                <option value="omni">Gemini Omni Flash — حتى 15 ثانية بصوت (Gemini)</option>
                <option value="replicate">Replicate</option>
                <option value="luma">Luma</option>
                <option value="runway">Runway</option>
              </select></div>
              {(vidProvider === 'veo3' || vidProvider === 'seedance') && (<>
                <div className="field"><label>المدة</label><select value={vidDuration} onChange={(e) => setVidDuration(e.target.value)}>
                  {vidProvider === 'veo3' ? (<><option value="4s">4 ثوانٍ</option><option value="6s">6 ثوانٍ</option><option value="8s">8 ثوانٍ</option></>) : (<><option value="auto">تلقائي</option><option value="4">4 ثوانٍ</option><option value="8">8 ثوانٍ</option><option value="12">12 ثانية</option><option value="30">30 ثانية</option></>)}
                </select></div>
                <div className="field"><label>نسبة العرض</label><select value={vidAspect} onChange={(e) => setVidAspect(e.target.value)}><option value="16:9">16:9</option><option value="9:16">9:16</option>{vidProvider === 'seedance' && (<><option value="21:9">21:9</option><option value="4:3">4:3</option><option value="1:1">1:1</option><option value="auto">تلقائي</option></>)}</select></div>
                <div className="field"><label>الدقة</label><select value={vidResolution} onChange={(e) => setVidResolution(e.target.value)}>
                  {vidProvider === 'veo3' ? (<><option value="720p">720p</option><option value="1080p">1080p</option></>) : (<><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4K</option></>)}
                </select></div>
              </>)}
              <button className="btn" onClick={genVideo} disabled={vidLoading}>{vidLoading ? 'جارٍ إرسال المهمة…' : 'توليد الفيديو'}</button>
              {vidJob && (
                <div className="note blue" style={{ marginTop: 12 }}>
                  {vidJob.status === 'queued' && <>🎬 المهمة قيد التوليد عبر {vidJob.model || vidJob.provider}… قد تستغرق 1–3 دقائق. سأعرض الفيديو هنا فور اكتماله.</>}
                  {vidJob.status === 'completed' && vidJob.url && <><video className="gen" src={vidJob.url} controls playsInline /><div style={{ display: 'flex', gap: 8, marginTop: 10 }}><a className="btn ghost small" href={vidJob.url} download target="_blank" rel="noreferrer">⬇ تنزيل الفيديو</a><button className="btn ghost small" onClick={() => copyText(vidJob.url, 'vidurl')}>{copied === 'vidurl' ? '✓ نُسخ الرابط' : 'نسخ رابط الفيديو'}</button></div></>}
                  {vidJob.status === 'failed' && <>❌ فشل توليد الفيديو: {vidJob.error || 'خطأ غير معروف.'}</>}
                </div>
              )}
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
                <div className="key-row"><span style={{ flex: 1 }}>🎬 توليد الفيديو</span><span>Veo 3 و Seedance 2.5 بمفتاح fal.ai، أو Omni بمفتاح Gemini — أو مفتاح Replicate / Luma / Runway</span></div>
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
              <p>الدفع بـ USDT على شبكة TRON (TRC20) — آمن وموثّق على سلسلة البلوكشين. اختر خطة، أرسل المبلغ بالضبط إلى محفظة الموقع، ثم الصق رقم المعاملة (TXID) للتحقق الفوري.</p>
              {subscription && subscription.expiresAt > Date.now() && (
                <div className="note green">اشتراكك الحالي: خطة {PLANS[subscription.plan]?.name || subscription.plan} — صالح حتى {new Date(subscription.expiresAt).toLocaleDateString('ar')}.<br />البريد المرتبط: {subscription.email || '—'} · TXID: <code dir="ltr">{String(subscription.txid).slice(0, 12)}…{String(subscription.txid).slice(-6)}</code></div>
              )}
              <div className="pay-grid">
                {Object.entries(PLANS).map(([id, p]) => (
                  <div key={id} className={'pay-card' + (plan === id ? ' current' : '') + (id !== 'free' ? ' paid' : '')}>
                    <div className="pay-card-head"><b>{p.name}</b>{id !== 'free' && <UsdtLogo />}</div>
                    <div className="pay-price">{id === 'free' ? 'مجانية' : p.usdt + ' USDT'}</div>
                    <div className="pay-per">{id === 'free' ? 'للأبد' : ' / شهر'}</div>
                    <ul className="pay-features">{p.features.map((f) => <li key={f}>✓ {f}</li>)}</ul>
                    <div className="pay-limits">{formatTokens(p.limit)} توكن/يوم · {p.images} صورة/يوم</div>
                    {plan === id ? <div className="badge" style={{ marginTop: 8 }}>خطتك الحالية</div>
                      : id === 'free' ? <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => { changePlan('free'); try { localStorage.setItem('omni_plan', 'free'); } catch {} }}>اختيار المجانية</button>
                      : <button className="btn small" style={{ marginTop: 8 }} onClick={() => openPay(id)}>شراء بـ USDT</button>}
                  </div>
                ))}
              </div>
              <div className="note">الخطة المجانية: 100 ألف توكن/يوم تقديرياً عبر المزودين المجانيين و5 صور/يوم. الحدود تُحسب من تقدير التوكنات المحلي ومن usage المزود عند توفره. عداد الاستخدام محلي في متصفحك (localStorage) وليس فوترة خادم. التحقق من الدفع يقرأ سلسلة TRON مباشرة — لا نطلب مفتاحك الخاص أبداً.</div>
            </>)}

            {drawer === 'skills' && (<>
              <p>المهارات المفعّلة تُضاف إلى تعليمات النموذج في كل رسالة — فعّل مهارة أو أكثر ثم أرسل سؤالك.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
                {BUILTIN_SKILLS.map((sk) => {
                  const on = activeSkills.includes(sk.id);
                  return (<button key={sk.id} className={'cmp-chip' + (on ? ' on' : '')} onClick={() => toggleSkill(sk.id)}>{sk.icon} {sk.name}</button>);
                })}
              </div>
              <h3>مهارة مخصصة</h3>
              <div className="field"><label>{tt('customSkillName')}</label><input value={newSkillName} onChange={(e) => setNewSkillName(e.target.value)} placeholder="مثال: خبير تسويق" /></div>
              <div className="field"><label>{tt('customSkillInstructions')}</label><textarea value={newSkillInstr} onChange={(e) => setNewSkillInstr(e.target.value)} rows={3} placeholder="اكتب تعليمات المهارة هنا…" /></div>
              <button className="btn" onClick={addCustomSkill}>{tt('addSkill')}</button>
              {customSkills.length === 0 ? <p style={{ marginTop: 10 }}>{tt('noSkills')}</p> : customSkills.map((sk) => {
                const id = 'custom:' + sk.id;
                const on = activeSkills.includes(id);
                return (
                  <div key={sk.id} className="key-row">
                    <span style={{ flex: 1 }}>🛠 <b>{sk.name}</b><br /><small style={{ color: 'var(--muted)' }}>{String(sk.instructions).slice(0, 120)}</small></span>
                    <button className={'btn small' + (on ? '' : ' ghost')} onClick={() => toggleSkill(id)}>{on ? 'مفعّلة ✓' : 'تفعيل'}</button>
                    <button className="btn danger small" onClick={() => { setCustomSkills((p) => p.filter((x) => x.id !== sk.id)); setActiveSkills((p) => p.filter((x) => x !== id)); }}>حذف</button>
                  </div>
                );
              })}
            </>)}

            {drawer === 'connections' && (<>
              <p>اربط حساباتك لتسأل عنها في المحادثة — مثال: «اعرض مشاريعي في Vercel» أو «ما مستودعاتي في GitHub؟». التوكنات تُحفظ في متصفحك فقط، ولا تُرسل إلا إلى الخدمة نفسها، ولا تُسجَّل في أي سجل.</p>
              {[
                { id: 'github', name: 'GitHub', hint: 'Personal Access Token — من github.com/settings/tokens (صلاحية repo للقراءة)', action: 'listRepos' },
                { id: 'vercel', name: 'Vercel', hint: 'Token — من vercel.com/account/tokens', action: 'listProjects' },
                { id: 'render', name: 'Render', hint: 'API Key — من dashboard.render.com/account/api-keys', action: 'listServices' }
              ].map((svc) => (
                <div key={svc.id} style={{ marginBottom: 16 }}>
                  <h3 style={{ marginBottom: 4 }}>{svc.name} {connStatus[svc.id] === 'ok' && <span className="badge">✓ {tt('connected')}</span>}{connStatus[svc.id] === 'fail' && <span className="badge exhausted">{tt('notConnected')}</span>}</h3>
                  <p style={{ fontSize: 12.5 }}>{svc.hint}</p>
                  <div className="field"><input type="password" value={conn[svc.id] || ''} onChange={(e) => setConn((p) => ({ ...p, [svc.id]: e.target.value }))} placeholder="الصق التوكن هنا…" dir="ltr" autoComplete="off" /></div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn ghost small" onClick={() => testConnection(svc.id)} disabled={connStatus[svc.id] === 'testing'}>{connStatus[svc.id] === 'testing' ? 'جارٍ الاختبار…' : '🔗 ' + tt('testConnection')}</button>
                    {conn[svc.id] && <button className="btn danger small" onClick={() => { setConn((p) => ({ ...p, [svc.id]: '' })); setConnStatus((p) => ({ ...p, [svc.id]: undefined })); }}>حذف التوكن</button>}
                  </div>
                </div>
              ))}
              {connMsg && <div className="note blue">{connMsg}</div>}
              <div className="note">ما يستطيع الموقع فعله بكل خدمة: GitHub — عرض مستودعاتك وقراءة ملف؛ Vercel — عرض مشاريعك؛ Render — عرض خدماتك. اسأل في المحادثة وسيُجلب السياق تلقائياً قبل الرد.</div>
            </>)}

            {drawer === 'settings' && (<>
              <h3>{tt('language')}</h3>
              <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={tt('language')}>
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
              </select>
              <h3>{tt('starsBg')}</h3>
              <label className="cmp-chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={starsOn} onChange={(e) => setStarsOn(e.target.checked)} /> {tt('starsBg')}</label>
              <p style={{ fontSize: 12.5 }}>نجوم ذهبية خافتة متحركة خلف الواجهة. تُطفأ تلقائياً عند تفعيل «تقليل الحركة» في جهازك.</p>
              <h3>{tt('plan')}</h3>
              <select value={plan} onChange={(e) => { changePlan(e.target.value); if (e.target.value === 'free') { try { localStorage.setItem('omni_plan', 'free'); } catch {} } }}>
                {Object.entries(PLANS).map(([id, p]) => <option key={id} value={id}>{p.name} — {p.price}</option>)}
              </select>
              <h3>تصدير الجلسة الحالية</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn ghost small" onClick={() => copyText(current?.messages.map((m) => (m.role === 'user' ? 'أنت: ' : 'CHIBANI AI: ') + textOf(m)).join('\n\n') || '', 'all')}>{copied === 'all' ? '✓ تم النسخ' : '📋 نسخ الجلسة'}</button>
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

      {/* عارض المعاينة داخل التطبيق: HTML معزول + روابط (v1.7) */}
      {preview && (
        <div className="modal-back preview-back" onClick={() => setPreview(null)}>
          <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-head">
              <h2>{preview.kind === 'html' ? '👁 ' + tt('preview') + ' — HTML' : '🌐 ' + tt('openInApp')}</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {preview.kind === 'html' && <button className="btn ghost small" onClick={() => copyText(preview.code, 'preview-html')}>{copied === 'preview-html' ? tt('copied') : tt('copy')}</button>}
                {preview.kind === 'url' && <a className="btn ghost small" href={preview.url} target="_blank" rel="noreferrer">{tt('openInBrowser')}</a>}
                <button className="sidebar-close" style={{ display: 'inline-flex' }} onClick={() => setPreview(null)} aria-label={tt('close')}>✕</button>
              </div>
            </div>
            {preview.kind === 'html' ? (
              <iframe title="html-preview" className="preview-frame" sandbox="allow-scripts" srcDoc={preview.code} />
            ) : (
              <>
                <iframe title="url-preview" className="preview-frame" sandbox="allow-scripts allow-forms allow-popups" src={preview.url} />
                <p className="preview-fallback">إن ظهرت الصفحة فارغة فالموقع يمنع العرض داخل إطار (X-Frame-Options) — <a href={preview.url} target="_blank" rel="noreferrer">{tt('openInBrowser')}</a></p>
              </>
            )}
          </div>
        </div>
      )}

      {/* بطاقة مقارنة موسّعة (ملء الشاشة) */}
      {expandedCompare && (() => {
        const em = current?.messages?.[expandedCompare.msg];
        const er = em?.results?.[expandedCompare.idx];
        if (!er) return null;
        return (
          <div className="modal-back preview-back" onClick={() => setExpandedCompare(null)}>
            <div className="modal preview-modal" onClick={(e) => e.stopPropagation()} style={{ borderTop: '3px solid ' + (getProvider(er.provider).color || '#8b5cf6') }}>
              <div className="preview-head">
                <h2>{getProvider(er.provider).name} <span dir="ltr" style={{ fontSize: 12, color: 'var(--muted)' }}>{er.model || ''}</span> {er.fastest && <span className="badge winner">{tt('winner')}</span>}</h2>
                <button className="sidebar-close" style={{ display: 'inline-flex' }} onClick={() => setExpandedCompare(null)} aria-label={tt('close')}>✕</button>
              </div>
              {er.error ? <div className="note">⚠️ {er.error}</div> : renderMd(er.content, previewActions)}
              <div className="compare-card-foot">
                <span>{formatTokens(er.tokens || 0)} توكن</span>
                <span>{Number(er.seconds || 0).toFixed(1)} ثانية</span>
                {er.via && <span>المسار: {er.via}</span>}
                {!er.error && <button onClick={() => copyText(er.content, 'expcopy')}>{copied === 'expcopy' ? '✓ تم النسخ' : '📋 نسخ'}</button>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* نافذة الدفع بـ USDT (TRC20) — v1.8: محفظة + QR + بريد + TXID + تحقق حقيقي من السلسلة */}
      {payPlan && (
        <div className="modal-back" onClick={() => setPayPlan(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>💎 شراء خطة {PLANS[payPlan].name} — {PLANS[payPlan].usdt} USDT</h2>
            <p>أرسل المبلغ بالضبط عبر شبكة TRON (TRC20) إلى العنوان التالي، ثم الصق رقم المعاملة (TXID) للتحقق الفوري وتفعيل خطتك لمدة شهر.</p>
            <div className="qr-box">{payQr ? <img src={payQr} alt="QR لمحفظة USDT" /> : 'جارٍ توليد QR…'}</div>
            <div className="key-row"><code dir="ltr" style={{ wordBreak: 'break-all' }}>{USDT_WALLET}</code><button className="btn ghost small" onClick={() => copyText(USDT_WALLET, 'wallet')}>{copied === 'wallet' ? '✓ نُسخ' : 'نسخ العنوان'}</button></div>
            <div className="field"><label>المبلغ (بالضبط)</label><div className="pay-amount"><UsdtLogo /> <b dir="ltr">{PLANS[payPlan].usdt} USDT</b> <span>شبكة TRC20</span></div></div>
            <div className="field"><label>بريدك الإلكتروني (يُربط به الدفع)</label><input type="email" value={payEmail} onChange={(e) => setPayEmail(e.target.value)} dir="ltr" placeholder="name@email.com" /></div>
            <div className="field"><label>رقم المعاملة TXID (بعد الدفع)</label><input value={payTxid} onChange={(e) => setPayTxid(e.target.value)} dir="ltr" placeholder="الصق TXID هنا…" /></div>
            <button className="btn btn-block" onClick={verifyPayment} disabled={payStatus?.state === 'verifying' || !payTxid.trim()}>{payStatus?.state === 'verifying' ? 'جارٍ التحقق من السلسلة…' : 'تحقق من الدفع'}</button>
            {payStatus && <div className={'note ' + (payStatus.state === 'ok' ? 'green' : '')} style={{ marginTop: 12 }}>{payStatus.state === 'ok' ? '✓ ' : payStatus.state === 'fail' ? '✗ ' : ''}{payStatus.message}</div>}
            {payStatus?.details?.checks && <div className="pay-checks">{Object.entries(payStatus.details.checks).map(([k, v]) => <div key={k}>{v ? '✓ ' : '✗ '}{CHECK_LABELS[k] || k}</div>)}</div>}
            <p style={{ marginTop: 12, fontSize: 12.5 }}>التحقق يقرأ سلسلة TRON مباشرة: وجود المعاملة، نجاحها، المستلم، المبلغ بالضبط، وحداثتها (24 ساعة). لا نطلب مفتاحك الخاص أبداً. إن أغلقت النافذة بعد الدفع، يمكنك إعادة فتحها ولصق TXID نفسه لاحقاً (خلال 24 ساعة).</p>
          </div>
        </div>
      )}

      {/* نافذة المصادقة — Google OAuth حقيقي + وضع ضيف (v1.7) */}
      {authOpen && (
        <div className="modal-back" onClick={() => setAuthOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>👤 {tt('login')}</h2>
            <p>{tt('googleSigninNote')}</p>
            <button className="btn btn-block" onClick={googleLogin}>🔵 {tt('loginGoogle')}</button>
            {authMsg && <div className="note" style={{ marginTop: 12 }}>{authMsg}</div>}
            <button className="btn ghost btn-block" style={{ marginTop: 10 }} onClick={() => setAuthOpen(false)}>{tt('guest')}</button>
            <p style={{ marginTop: 12, fontSize: 12.5 }}>حسابك يُحفظ في ملف تعريف (cookie) آمن عبر next-auth — عند إعادة فتح الموقع تُسجَّل دخولك تلقائياً دون إدخال أي بيانات من جديد.</p>
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
