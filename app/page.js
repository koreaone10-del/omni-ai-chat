'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { PROVIDERS, getProvider, AUTO_ORDER, modelDesc } from '@/lib/providers';
import { USDT_WALLET, PLAN_USDT, PLAN_FEATURES } from '@/lib/payments';
import QRCode from 'qrcode';
import { estimateTokens, formatTokens } from '@/lib/tokens';
import { loadKeyPool, saveKeyPool, addKeyToPool, generateAppApiKey } from '@/lib/keys';
import { detectIntent, ROUTE_LABELS } from '@/lib/intent';
import { useSession, signIn, signOut } from 'next-auth/react';
import { t, LANGS, isRTL } from '@/lib/i18n';
import { BUILTIN_SKILLS } from '@/lib/skills';
import { INTEGRATIONS, INTEGRATION_TEST_ACTION, integrationById } from '@/lib/integrations';
import { JOB_TYPES, jobTypeById, loadJobs, saveJobs, jobStatusLabel } from '@/lib/jobs';
import { routeTemperature } from '@/lib/agent-router';
import { DEFAULT_AGENT_CONFIG, DEFAULT_SYSTEM_PROMPT, TOOLS_STORE, toolDef, normalizeAgentConfig, buildStateLedger, searchKnowledge } from '@/lib/agent-config';

const PLANS = {
  free: { name: 'مجانية', price: '0$', limit: 500000, images: 10, videos: 2, compares: 20, deeps: 10, usdt: PLAN_USDT.free.price, features: PLAN_FEATURES.free },
  pro: { name: 'Pro', price: '4.99$/شهر', limit: 2000000, images: 200, videos: 20, compares: 200, deeps: 100, usdt: PLAN_USDT.pro.price, features: PLAN_FEATURES.pro },
  business: { name: 'Business', price: '14.99$/شهر', limit: 10000000, images: 2000, videos: 200, compares: 1000, deeps: 500, usdt: PLAN_USDT.business.price, features: PLAN_FEATURES.business }
};
const FREE_LIMIT = 500000;
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
      out.push(
        <div key={'pre' + i} className="code-block">
          <div className="code-block-head">
            <span dir="ltr">{curLang || 'code'}</span>
            <button onClick={() => actions?.onOpenCode?.(code, curLang)}>🚀 {actions?.openLabel || 'فتح'}</button>
            <button onClick={() => actions?.onCopyCode?.(code, 'code' + i)}>{actions?.copiedCode === 'code' + i ? '✓ تم النسخ' : '📋 نسخ'}</button>
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
// تقسيم حي لنص يحمل «التفكير:» و«الإجابة:» (v2.0): أثناء البث يظهر التفكير
// خافتاً فوق الإجابة وهي تُكتب، وبعد اكتمالها يتحول إلى سطر «عرض التفكير».
function splitThinkText(content) {
  const t = String(content || '');
  if (!t.includes('التفكير:')) return null;
  const afterThink = t.split('التفكير:').slice(1).join('التفكير:');
  const parts = afterThink.split('الإجابة:');
  if (parts.length > 1) return { thinking: parts[0].trim(), answer: parts.slice(1).join('الإجابة:').trim() };
  return { thinking: afterThink.trim(), answer: '' };
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
  const { data: session, status: sessionStatus } = useSession(); // جلسة Google OAuth (next-auth)
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
  const [daily, setDaily] = useState({ date: todayKey(), tokens: 0, images: 0, videos: 0, compares: 0, deeps: 0 });
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
  const [flSlotValues, setFlSlotValues] = useState(['', '', '', '']); // 4 خانات مفاتيح إضافية (v1.9)
  const [flTest, setFlTest] = useState('');
  const [guideOpen, setGuideOpen] = useState(false); // دليل FreeLLMAPI
  const [appKey, setAppKey] = useState('');
  const [testResult, setTestResult] = useState('');
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgSize, setImgSize] = useState('1024x1024');
  const [imgResult, setImgResult] = useState(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [vidPrompt, setVidPrompt] = useState('');
  const [vidProvider, setVidProvider] = useState('puter'); // Puter مجاني — الافتراضي في v2.0
  const [vidResult, setVidResult] = useState(null);
  const [vidLoading, setVidLoading] = useState(false);
  const [showThink, setShowThink] = useState({});
  const [thinkFlash, setThinkFlash] = useState({}); // تفكير يُعرض خافتاً ثوانيَ ثم يختفي (v1.9)
  const thinkFlashedRef = useRef({});
  const [lang, setLang] = useState('ar');
  const [starsOn, setStarsOn] = useState(true);
  const [browserWin, setBrowserWin] = useState(null); // نافذة المتصفح الداخلي العائمة (v1.9): { kind:'html'|'url', code|url, hist, hIndex, x, y, w, h, min }
  const [bwReloadTick, setBwReloadTick] = useState(0);
  const bwAddrRef = useRef(null);
  const [expandedCompare, setExpandedCompare] = useState(null); // { msg, idx }
  // --- الدفع بـ USDT (TRC20) — v1.8 ---
  const [payPlan, setPayPlan] = useState(null); // الخطة الجاري شراؤها (id) — null تعني لا نافذة
  const [payEmail, setPayEmail] = useState('');
  const [payTxid, setPayTxid] = useState('');
  const [payStatus, setPayStatus] = useState(null); // {state:'verifying'|'ok'|'fail', message, details}
  const [payQr, setPayQr] = useState('');
  const [subscription, setSubscription] = useState(null); // {plan, txid, email, verifiedAt, expiresAt}
  const subVerifiedRef = useRef(false); // إعادة التحقق من الاشتراك مرة واحدة عند التحميل
  // --- لوحة نماذج المزود (v1.9): النماذج الفعلية للمزود، لا أدوات مجردة ---
  const [modelsSheet, setModelsSheet] = useState(null); // id المزود الذي ورقته الطويلة مفتوحة
  const [imgPreferred, setImgPreferred] = useState('auto'); // نموذج الصور المفضل: auto | nanobanana | nanobanana-2.1 | nanobanana-pro | dalle | flux
  // --- مهام الفيديو غير المتزامنة (v1.8) ---
  const [vidJob, setVidJob] = useState(null); // مهمة فيديو الدرج: {jobId, endpoint, provider, status, url, error}
  const [vidDuration, setVidDuration] = useState('8s');
  const [vidAspect, setVidAspect] = useState('16:9');
  const [vidResolution, setVidResolution] = useState('720p');
  // --- v2.0 ---
  const [flCatalog, setFlCatalog] = useState(null); // كتالوج FreeLLMAPI الكامل من /api/models
  const [flCatalogLoading, setFlCatalogLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const [unreadNew, setUnreadNew] = useState(0);
  const [streamingId, setStreamingId] = useState(null); // رسالة تُبث الآن عبر SSE
  const [showArchived, setShowArchived] = useState(false);
  const [vidRefFile, setVidRefFile] = useState(null); // الصورة المرجعية للفيديو (Puter/Wan/LTX)
  const [vidRefPreview, setVidRefPreview] = useState('');
  const [vidPuterModel, setVidPuterModel] = useState('togetherai:wan-ai/wan2.7-t2v');
  const [vidPuterSeconds, setVidPuterSeconds] = useState('8');
  const [vidFreeDuration, setVidFreeDuration] = useState(2); // مدة Wan/LTX المجانية (ثوانٍ)
  const [vidFreeSteps, setVidFreeSteps] = useState(8); // خطوات Wan = الجودة
  const [vidNegPrompt, setVidNegPrompt] = useState('');
  const [vidProgress, setVidProgress] = useState('');
  const [imgRefFile, setImgRefFile] = useState(null); // الصورة المرجعية لتعديل الصور
  const [imgRefPreview, setImgRefPreview] = useState('');
  const [imgEditGuidance, setImgEditGuidance] = useState(4); // قوة التعديل 1-10
  const [imgEditSteps, setImgEditSteps] = useState(20); // جودة التعديل 1-50
  const [imgProgress, setImgProgress] = useState('');
  const vidRefInputRef = useRef(null);
  const imgRefInputRef = useRef(null);
  const atBottomRef = useRef(true);
  const lastMsgCountRef = useRef(0);
  const [activeSkills, setActiveSkills] = useState([]);
  const [customSkills, setCustomSkills] = useState([]);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillInstr, setNewSkillInstr] = useState('');
  const [conn, setConn] = useState({ github: '', vercel: '', render: '', cloudflare: '', facebook: '', gmail: '' });
  const [connStatus, setConnStatus] = useState({});
  const [connMsg, setConnMsg] = useState('');
  // v2.1: خلفية الصورة الشخصية + الوكيل الذكي + مهام Live الخلفية
  const [portraitOn, setPortraitOn] = useState(true);
  const [agentOn, setAgentOn] = useState(false);
  const [agentCfg, setAgentCfg] = useState(() => normalizeAgentConfig({}));
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentTaskInput, setAgentTaskInput] = useState('');
  const [agentMsg, setAgentMsg] = useState('');
  const [agentTestText, setAgentTestText] = useState('');
  const [agentNewKey, setAgentNewKey] = useState({ groq: '', fl: '', cf: '', cfAccount: '' });
  const [cfAccountId, setCfAccountId] = useState('');
  const [jobs, setJobs] = useState([]);
  const [jobType, setJobType] = useState('research');
  const [jobTitle, setJobTitle] = useState('');
  const [jobPrompt, setJobPrompt] = useState('');
  const [jobBusy, setJobBusy] = useState(false);
  const [jobMsg, setJobMsg] = useState('');
  const [newMemory, setNewMemory] = useState('');
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
      // إصلاح عدّاد الخطة (v1.9): خطة مدفوعة محفوظة بلا اشتراك موثّق تعود مجانية —
      // وإلا يظهر العدّاد حدّاً خاطئاً (مثلاً 10.00M بلا اشتراك).
      try {
        const storedPlan = localStorage.getItem('omni_plan') || 'free';
        const sub2 = JSON.parse(localStorage.getItem('omni_subscription') || 'null');
        const validSub = sub2 && sub2.plan && sub2.expiresAt > Date.now() && sub2.plan !== 'free' ? sub2 : null;
        if (storedPlan !== 'free' && (!validSub || validSub.plan !== storedPlan)) {
          setPlan('free');
          localStorage.setItem('omni_plan', 'free');
        }
      } catch {}
      const d = JSON.parse(localStorage.getItem('omni_daily') || 'null');
      if (d && d.date === todayKey()) setDaily({ date: d.date, tokens: d.tokens || 0, images: d.images || 0, videos: d.videos || 0, compares: d.compares || 0, deeps: d.deeps || 0 });
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
      try { const cn = JSON.parse(localStorage.getItem('omni_connections') || '{}'); if (cn && typeof cn === 'object') setConn({ github: cn.github || '', vercel: cn.vercel || '', render: cn.render || '', cloudflare: cn.cloudflare || '', facebook: cn.facebook || '', gmail: cn.gmail || '' }); } catch {}
      // v2.1: إعدادات الوكيل + مهام Live + خلفية الصورة — v2.2: دمج فوق الافتراضية مع تقييد القيم
      try { const ac = JSON.parse(localStorage.getItem('omni_agent_cfg') || 'null'); if (ac && typeof ac === 'object') setAgentCfg(normalizeAgentConfig(ac)); } catch {}
      try { setCfAccountId(localStorage.getItem('omni_cf_account_id') || ''); } catch {}
      try { setJobs(loadJobs()); } catch {}
      try { setPortraitOn(localStorage.getItem('omni_portrait') !== '0'); } catch {}
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
  useEffect(() => { try { localStorage.setItem('omni_agent_cfg', JSON.stringify(agentCfg)); } catch {} }, [agentCfg]);
  useEffect(() => { try { localStorage.setItem('omni_cf_account_id', cfAccountId); } catch {} }, [cfAccountId]);
  useEffect(() => { saveJobs(jobs); }, [jobs]);
  useEffect(() => { try { localStorage.setItem('omni_portrait', portraitOn ? '1' : '0'); } catch {} }, [portraitOn]);
  // v2.1: تحديث تلقائي لحالة مهام Live كل 20 ثانية أثناء فتح لوحة Live.
  useEffect(() => {
    if (drawer !== 'live') return;
    const t = setInterval(() => { refreshJobs(); }, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [currentId]); // جلسة جديدة = أول 50 رسالة
  // التمرير للأسفل (v2.0): تلقائي فقط إن كان المستخدم أصلاً في الأسفل؛
  // وإن وصلت رسائل جديدة وهو في الأعلى، تظهر شارة على زر ↓ بدل القفز به.
  function onChatScroll() {
    const el = chatRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setUnreadNew(0);
  }
  function scrollToBottom() {
    atBottomRef.current = true; setAtBottom(true); setUnreadNew(0);
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }
  useEffect(() => {
    const count = current?.messages?.length || 0;
    const prev = lastMsgCountRef.current;
    lastMsgCountRef.current = count;
    if (count <= prev) return;
    const last = current.messages[count - 1];
    if (atBottomRef.current) chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
    else if (last?.role === 'assistant') setUnreadNew((n) => n + 1);
  }, [sessions]);
  // كتالوج FreeLLMAPI الكامل (v2.0): يُجلب عند فتح ورقة نماذج الراوتر فقط.
  async function loadFlCatalog() {
    if (flCatalog || flCatalogLoading) return;
    setFlCatalogLoading(true);
    try {
      const r = await fetch('/api/models');
      const d = await r.json();
      if (d.freellmapiCatalog) setFlCatalog(d.freellmapiCatalog);
    } catch {}
    setFlCatalogLoading(false);
  }
  useEffect(() => { if (modelsSheet === 'freellmapi') loadFlCatalog(); }, [modelsSheet]);
  useEffect(() => { if (!modelsSheet) setModelSearch(''); }, [modelsSheet]);
  // إغلاق القائمة/الدرج/الورقة/النافذة بزر Escape — يعيد دائماً إلى عرض محادثة نظيف
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSidebarOpen(false); setDrawer(null); setAuthOpen(false); setGuideOpen(false); setSheet(null); setBrowserWin(null); setExpandedCompare(null); setModelsSheet(null); setPayPlan(null); }
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
  const previewActions = { onPreviewHtml: (code) => openBrowserWin({ kind: 'html', code }), onOpenUrl: (url) => openBrowserWin({ kind: 'url', url }), onOpenCode: (code, lang) => openCodeWin(code, lang), onCopyCode: (code, id) => copyText(code, id || 'codeblock'), copiedCode: copied, openLabel: tt('open') };

  // ---------- نافذة المتصفح الداخلي العائمة (v1.9) ----------
  // متوسطة الحجم، قابلة للسحب من رأسها، وإعادة التحجيم من الزاوية، مع تصغير/إغلاق وشريط عناوين.
  // v2.0: أنواع جديدة — 'code' (أي كود بأي لغة) و 'md' (محتوى Markdown مقروء).
  function openCodeWin(code, lang) {
    const l = String(lang || '').toLowerCase();
    if (l === 'html') openBrowserWin({ kind: 'html', code });
    else if (l === 'md' || l === 'markdown') openBrowserWin({ kind: 'md', code });
    else openBrowserWin({ kind: 'code', code, lang: l || 'code' });
  }
  function openBrowserWin(init) {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 600;
    const w = Math.min(720, vw - 24);
    const h = Math.min(520, Math.floor(vh * 0.72));
    const x = Math.max(8, Math.floor((vw - w) / 2));
    const y = Math.max(8, Math.floor((vh - h) / 3));
    if (init.kind === 'html') setBrowserWin({ kind: 'html', code: init.code, hist: [], hIndex: 0, x, y, w, h, min: false });
    else if (init.kind === 'code') setBrowserWin({ kind: 'code', code: init.code, lang: init.lang || 'code', hist: [], hIndex: 0, x, y, w, h, min: false });
    else if (init.kind === 'md') setBrowserWin({ kind: 'md', code: init.code, hist: [], hIndex: 0, x, y, w, h, min: false });
    else setBrowserWin({ kind: 'url', url: init.url, hist: [init.url], hIndex: 0, x, y, w, h, min: false });
  }
  function bwGo(raw) {
    let v = String(raw || '').trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    setBrowserWin((b) => {
      if (!b || b.kind !== 'url') return b;
      const hist = [...b.hist.slice(0, b.hIndex + 1), v];
      return { ...b, url: v, hist, hIndex: hist.length - 1 };
    });
  }
  function bwStep(delta) {
    setBrowserWin((b) => {
      if (!b || b.kind !== 'url') return b;
      const ni = Math.max(0, Math.min(b.hist.length - 1, b.hIndex + delta));
      return { ...b, hIndex: ni, url: b.hist[ni] };
    });
  }
  function startBrowserDrag(e) {
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input') || e.target.closest('form')) return;
    const b = browserWin;
    if (!b) return;
    const startX = e.clientX, startY = e.clientY, ox = b.x, oy = b.y;
    const move = (ev) => {
      const nx = Math.max(0, Math.min(window.innerWidth - 80, ox + ev.clientX - startX));
      const ny = Math.max(0, Math.min(window.innerHeight - 56, oy + ev.clientY - startY));
      setBrowserWin((cur) => (cur ? { ...cur, x: nx, y: ny } : cur));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // التفكير الخافت (v1.9): عند وصول ردّ يحمل تفكيراً يُعرض خافتاً 8 ثوانٍ ثم يختفي،
  // ويبقى سطر «عرض التفكير» الواحد للرجوع إليه.
  const currentMsgCount = current?.messages?.length || 0;
  useEffect(() => {
    const msgs = current?.messages || [];
    if (!msgs.length) return;
    const i = msgs.length - 1;
    const last = msgs[i];
    if (last?.role === 'assistant' && last.reasoning && !thinkFlashedRef.current[i]) {
      thinkFlashedRef.current[i] = true;
      setThinkFlash((p) => ({ ...p, [i]: true }));
      const t = setTimeout(() => setThinkFlash((p) => { const n = { ...p }; delete n[i]; return n; }), 8000);
      return () => { clearTimeout(t); setThinkFlash((p) => { const n = { ...p }; delete n[i]; return n; }); };
    }
  }, [currentMsgCount]);

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
  function addFlKey(value, slotIndex) {
    const v = String(value || '').trim();
    if (!v) return;
    if (flKeys.some((k) => k.value === v)) { setFlTest('هذا المفتاح مضاف أصلاً.'); return; }
    setFlKeys((p) => [...p, { id: uid(), label: 'حساب ' + (p.length + 1), value: v, status: 'active', lastUsed: null, lastError: null }]);
    if (slotIndex != null) setFlSlotValues((p) => { const n = [...p]; n[slotIndex] = ''; return n; });
    setFlTest('تمت إضافة المفتاح — جرّب «اختبار كل المفاتيح» للتأكد منه.');
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
    if (/فيسبوك|facebook|صفح/i.test(tx)) return 'facebook';
    if (/cloudflare|كلاودفلير|نطاق|zone/i.test(tx)) return 'cloudflare';
    if (/gmail|جيميل|بريد|رسائل/i.test(tx)) return 'gmail';
    return null;
  }
  async function connectionContextFor(text) {
    const svc = connectionIntent(text);
    if (!svc || !conn[svc]) return '';
    try {
      const action = svc === 'github' ? 'listRepos' : svc === 'vercel' ? 'listProjects' : svc === 'render' ? 'listServices' : svc === 'cloudflare' ? 'listZones' : svc === 'facebook' ? 'listPages' : 'listMessages';
      const r = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: svc, action, token: conn[svc] }), signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (!r.ok) return '';
      const items = d.repos || d.projects || d.services || d.zones || d.pages || d.messages || [];
      if (!items.length) return '\n\n[بيانات حقيقية من ' + svc + ': لا توجد عناصر بعد.]';
      const lines = items.slice(0, 20).map((x) => {
        if (svc === 'gmail') return '- ' + (x.subject || '(بلا موضوع)') + ' — من ' + (x.from || '?') + (x.date ? ' (' + x.date + ')' : '');
        if (svc === 'cloudflare') return '- ' + (x.name || x.id) + (x.status ? ' (' + x.status + ')' : '');
        return '- ' + (x.name || x.id) + (x.url ? ' (' + x.url + ')' : '');
      }).join('\n');
      return '\n\n[بيانات حقيقية من ' + svc + ' — أجب بناءً عليها فقط:\n' + lines + ']';
    } catch { return ''; }
  }
  async function testConnection(svc) {
    const token = conn[svc];
    if (!token) { setConnStatus((p) => ({ ...p, [svc]: 'missing' })); setConnMsg('ألصق التوكن أولاً ثم اضغط «اختبار الاتصال».'); return; }
    setConnStatus((p) => ({ ...p, [svc]: 'testing' }));
    try {
      const action = INTEGRATION_TEST_ACTION[svc] || 'test';
      const r = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: svc, action, token }) });
      const d = await r.json();
      setConnStatus((p) => ({ ...p, [svc]: r.ok ? 'ok' : 'fail' }));
      setConnMsg(r.ok ? svc + ' ✓ متصل — ' + (d.count ?? 0) + ' عنصر' : (d.error || 'فشل الاتصال'));
    } catch (e) { setConnStatus((p) => ({ ...p, [svc]: 'fail' })); setConnMsg('تعذّر الاتصال: ' + String(e.message || e)); }
  }

  // ---------- الوكيل الذكي (v2.2) ----------
  // يعمل بنماذج موجودة (الراوتر / Groq / Gemini) — ليس نموذجاً مدرّباً من الصفر.
  // البرومبت النظامي مخزّن ومُصدَّر من المستخدم، لا مكتوب في الكود.
  // يخطط المهمة، ينفّذ خطواتها بأدوات الموقع، ويعرض سجلاً حياً لكل خطوة.
  function agentSystemPrompt(task = '', ledger = '') {
    const cfg = agentCfg;
    const mem = (cfg.memory || []).filter(Boolean);
    const kb = searchKnowledge(cfg.knowledge || [], task);
    let sys = (cfg.systemPrompt || DEFAULT_SYSTEM_PROMPT).trim() || DEFAULT_SYSTEM_PROMPT;
    if (cfg.instructions) sys += '\nUser behaviour instructions:\n' + cfg.instructions.slice(0, 1500);
    if (mem.length) sys += '\nLessons learned from past tasks (follow them):\n- ' + mem.slice(0, 12).join('\n- ');
    if (kb.length) sys += '\nReference files (found by in-browser keyword search — no vector database):\n' + kb.map((k) => '### ' + k.name + '\n' + k.snippet).join('\n');
    if (ledger) sys += '\n' + ledger;
    return sys;
  }
  // سجل استدعاءات الأدوات — للتحقق والمراجعة (يُحفظ في المتصفح فقط).
  function agentLog(tool, label, status, detail) {
    setAgentCfg((p) => ({ ...p, log: [{ at: Date.now(), tool, label: String(label || '').slice(0, 120), status, detail: String(detail || '').slice(0, 160) }, ...(p.log || [])].slice(0, 50) }));
  }
  // حاجز الأمان: النطاقات المسموح جلبها فقط.
  function isUrlAllowed(raw) {
    try {
      const h = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
      return (agentCfg.safety?.whitelist || []).some((w) => h === w || h.endsWith('.' + w));
    } catch { return false; }
  }
  // طلب وكيل واحد متدفق (stream:true — وإلا النبضات تتكدس) بحرارة الموجّه
  // ومعاملات إعدادات الوكيل. يرجع {content, tokens, fallback} ويستدعي onDelta أثناء البث.
  async function chatAgentOnce(userMessages, { sys = null, userText = '', onDelta = null } = {}) {
    const cfg = agentCfg;
    const rCfg = cfg.router || {};
    const temp = rCfg.enabled === false
      ? 0.6
      : routeTemperature(userText, { bands: { cold: rCfg.cold ?? 0.2, warm: rCfg.warm ?? 0.6, hot: rCfg.hot ?? 0.95 }, coldWords: rCfg.coldWords, hotWords: rCfg.hotWords }).temperature;
    const rq = cfg.request || {};
    const sampling = {
      temperature: temp,
      top_p: rq.topP ?? 0.95,
      max_tokens: rq.maxTokens ?? 4096,
      presence_penalty: rq.presencePenalty ?? 0.1,
      frequency_penalty: rq.frequencyPenalty ?? 0.2,
      stop: rq.stop ? rq.stop : undefined,
      seed: rq.seed === '' || rq.seed == null ? undefined : parseInt(String(rq.seed), 10),
      reasoning_effort: rq.reasoningEffort || undefined,
      response_format: rq.responseFormat === 'json_object' ? 'json_object' : undefined
    };
    if (sampling.seed != null && !Number.isInteger(sampling.seed)) delete sampling.seed;
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: userMessages,
        providerId, model: (rq.model || model) || undefined,
        apiKeys: providerId === 'freellmapi' ? { ...keys, freellmapi: flKeyEntries() } : keys,
        baseURL: flUrl || FL_DEFAULT_URL, deepThinking: false, lang,
        skills: activeSkillInstructions(),
        systemPrompt: sys ?? agentSystemPrompt(userText),
        sampling, stream: true
      }),
      signal: AbortSignal.timeout(120000)
    });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/event-stream')) {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'فشل الطلب.');
      return { content: data.content || '', tokens: data.usage?.total_tokens || estimateTokens(data.content || ''), fallback: !!data.fallback };
    }
    let content = ''; let reasoning = ''; let usage = null; let fallback = false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.type === 'content' && ev.delta) { content += ev.delta; if (onDelta) onDelta(content); }
          else if (ev.type === 'reasoning' && ev.delta) { reasoning += ev.delta; }
          else if (ev.type === 'done') { usage = ev.usage; fallback = !!ev.fallback; }
          else if (ev.type === 'error') throw new Error(ev.error || 'خطأ أثناء البث.');
        }
      }
    }
    return { content, tokens: usage?.total_tokens || estimateTokens(content), fallback };
  }
  function parseAgentPlan(text, cap = 10) {
    const steps = [];
    for (const line of String(text || '').split('\n')) {
      const m = line.match(/^\s*\d+[.)]\s*(?:\[(\w+)\]\s*)?(.+)$/);
      if (m && m[2] && m[2].trim().length > 2) {
        const tool = (m[1] || 'chat').toLowerCase();
        steps.push({ label: m[2].trim().slice(0, 200), tool: ['chat', 'image', 'video', 'web', 'github', 'vercel', 'render', 'cloudflare', 'facebook', 'gmail'].includes(tool) ? tool : 'chat', status: 'pending', detail: '' });
      }
      if (steps.length >= cap) break;
    }
    return steps;
  }
  function agentAllowedTools() {
    const t = agentCfg.tools || {};
    const out = [];
    if (t.chat) out.push('chat');
    if (t.image) out.push('image');
    if (t.video) out.push('video');
    if (t.web) out.push('web');
    if (t.integrations) out.push('github', 'vercel', 'render', 'cloudflare', 'facebook', 'gmail');
    return out.length ? out : ['chat'];
  }
  // تصدير/استيراد إعدادات الوكيل (البرومبت + الموجّه + حقول الطلب) — JSON في يد المستخدم.
  function exportAgentConfig() {
    try {
      const blob = new Blob([JSON.stringify({ app: 'CHIBANI AI Agent', version: '2.2', exportedAt: new Date().toISOString(), systemPrompt: agentCfg.systemPrompt, router: agentCfg.router, request: agentCfg.request, agent: agentCfg.agent }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'chibani-agent-config.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setAgentMsg('✓ تم تصدير إعدادات الوكيل (JSON).');
    } catch { setAgentMsg('تعذّر التصدير.'); }
  }
  function importAgentConfig(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((txt) => {
      try {
        const d = JSON.parse(txt);
        setAgentCfg((p) => normalizeAgentConfig({
          ...p,
          systemPrompt: typeof d.systemPrompt === 'string' ? d.systemPrompt : p.systemPrompt,
          router: d.router ? { ...p.router, ...d.router } : p.router,
          request: d.request ? { ...p.request, ...d.request } : p.request,
          agent: d.agent ? { ...p.agent, ...d.agent } : p.agent
        }));
        setAgentMsg('✓ تم استيراد إعدادات الوكيل.');
      } catch { setAgentMsg('ملف غير صالح — يجب أن يكون JSON صادراً من إعدادات الوكيل.'); }
    }).catch(() => setAgentMsg('تعذّرت قراءة الملف.'));
    e.target.value = '';
  }
  // ملفات مرجعية نصية للوكيل (RAG خفيف — بحث نصي داخل المتصفح).
  async function addKnowledgeFiles(fileList) {
    const files = [...(fileList || [])].slice(0, 5);
    for (const f of files) {
      if (!/\.(txt|md|json)$/i.test(f.name)) { setAgentMsg('تُقبل الملفات النصية فقط (txt / md / json): ' + f.name); continue; }
      try {
        const text = await f.text();
        setAgentCfg((p) => ({ ...p, knowledge: [...(p.knowledge || []), { id: uid(), name: f.name.slice(0, 60), text: String(text).slice(0, 50000) }].slice(0, 5) }));
      } catch { setAgentMsg('تعذّرت قراءة الملف: ' + f.name); }
    }
  }
  // مفاتيح المزودين من إعدادات الوكيل — نفس أماكن التخزين في مدير المفاتيح
  // والتكاملات (localStorage في المتصفح فقط)، بلا أي قيمة مكتوبة في الكود.
  function addAgentGroqKey() {
    const v = (agentNewKey.groq || '').trim();
    if (!v) return;
    setKeys((p) => addKeyToPool(p, 'groq', v));
    setAgentNewKey((p) => ({ ...p, groq: '' }));
    setAgentMsg('✓ أُضيف مفتاح Groq إلى تجمع المفاتيح.');
  }
  function addAgentFlKey() {
    const v = (agentNewKey.fl || '').trim();
    if (!v) return;
    addFlKey(v);
    setAgentNewKey((p) => ({ ...p, fl: '' }));
  }
  function saveAgentCfToken() {
    const v = (agentNewKey.cf || '').trim();
    if (!v) return;
    setConn((p) => ({ ...p, cloudflare: v }));
    setAgentNewKey((p) => ({ ...p, cf: '' }));
    setAgentMsg('✓ حُفظ توكن Cloudflare في التكاملات.');
  }
  function saveAgentCfAccount() {
    const v = (agentNewKey.cfAccount || '').trim();
    if (!v) return;
    setCfAccountId(v);
    setAgentNewKey((p) => ({ ...p, cfAccount: '' }));
    setAgentMsg('✓ حُفظ معرّف حساب Cloudflare.');
  }
  async function runAgentTask(taskText) {
    const task = (taskText ?? input).trim();
    if (!task || agentRunning) return;
    if (daily.tokens >= planInfo.limit) { setError(tt('dailyLimitReached')); setDrawer('pricing'); return; }
    if (!current) return;
    setError('');
    const userMsg = { role: 'user', content: task, tokens: estimateTokens(task), route: 'agent' };
    const agentId = uid();
    const agentMsgObj = { id: agentId, role: 'assistant', kind: 'agent', task, steps: [], status: 'running', content: '', tokens: 0 };
    updateSession(current.id, (s) => ({ ...s, title: s.messages.length === 0 ? task.slice(0, 40) : s.title, messages: [...s.messages, userMsg, agentMsgObj], tokens: (s.tokens || 0) + userMsg.tokens }));
    setInput(''); setAttachments([]); setAgentTaskInput(''); setLoading(true); setAgentRunning(true);
    const updateAgent = (patch) => updateSession(current.id, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === agentId ? { ...m, ...patch } : m)) }));
    let totalTokens = userMsg.tokens;
    const ctxNotes = [];
    const maxSteps = Math.min(15, Math.max(1, agentCfg.agent?.maxSteps ?? 10));
    const maxCallsPerTool = Math.min(10, Math.max(1, agentCfg.agent?.maxCallsPerTool ?? 3));
    const toolCalls = {};
    const ledger = () => buildStateLedger({ task, steps, notes: ctxNotes, memory: agentCfg.memory || [] });
    let steps = [];
    try {
      const allowed = agentAllowedTools();
      const sys = agentSystemPrompt(task);
      // tool_choice: none — إجابة مباشرة بلا تخطيط ولا أدوات.
      if (agentCfg.agent?.toolChoice === 'none') {
        const direct = await chatAgentOnce([{ role: 'user', content: task }], { sys, userText: task, onDelta: (txt) => updateAgent({ content: txt }) });
        totalTokens += direct.tokens;
        updateAgent({ steps: [{ label: 'إجابة مباشرة (بلا أدوات)', tool: 'chat', status: 'done', detail: 'tool_choice: none' }], status: 'done', content: direct.content, tokens: totalTokens });
        setDaily((d) => ({ ...d, tokens: d.tokens + totalTokens }));
        agentLog('chat', 'إجابة مباشرة', 'done', direct.content.slice(0, 120));
        if (agentCfg.agent?.storeHistory !== false) setAgentCfg((p) => ({ ...p, history: [{ task: task.slice(0, 80), status: 'done', at: Date.now() }, ...(p.history || [])].slice(0, 10) }));
        return;
      }
      const toolList = allowed.map((id) => { const d = toolDef(id); return d ? id + ' (' + d.desc + ')' : id; }).join('، ');
      // الخطوة 0: التخطيط (بث حي — يظهر النص في بطاقة الوكيل لحظة بلحظة)
      const planRes = await chatAgentOnce([
        { role: 'user', content: 'المهمة: ' + task + '\n\nقسّمها إلى خطوات مرقمة (' + maxSteps + ' خطوات كحد أقصى). الأدوات المتاحة: ' + toolList + '. اكتب كل خطوة في سطر بهذا الشكل: "1. [chat] ...". أداة image لتوليد صورة، video لفيديو، web لجلب صفحة ويب (اكتب الرابط كاملاً في الخطوة، ومن النطاقات المسموحة فقط: ' + (agentCfg.safety?.whitelist || []).join('، ') + ')، وأسماء التكاملات (github/vercel/...) لجلب بياناتها. لا خطوات وهمية.' }
      ], { sys, userText: task, onDelta: (txt) => updateAgent({ content: txt }) });
      totalTokens += planRes.tokens;
      agentLog('chat', 'تخطيط المهمة', 'done', planRes.content.slice(0, 120));
      steps = parseAgentPlan(planRes.content, maxSteps);
      if (!steps.length) steps = [{ label: 'الإجابة المباشرة عن المهمة', tool: 'chat', status: 'pending', detail: '' }];
      // إسقاط أدوات غير مسموحة من الوكيل
      steps = steps.map((s) => ({ ...s, tool: allowed.includes(s.tool) ? s.tool : 'chat' }));
      updateAgent({ steps: steps.map((s) => ({ ...s })), content: '' });
      // تنفيذ الخطوات بالتسلسل
      for (let si = 0; si < steps.length; si++) {
        if (daily.tokens + totalTokens >= planInfo.limit) { steps[si] = { ...steps[si], status: 'failed', detail: 'بلغت حد التوكنات اليومي.' }; updateAgent({ steps: steps.map((s) => ({ ...s })) }); break; }
        steps[si] = { ...steps[si], status: 'running' };
        updateAgent({ steps: steps.map((s) => ({ ...s })) });
        try {
          const st = steps[si];
          toolCalls[st.tool] = (toolCalls[st.tool] || 0) + 1;
          if (toolCalls[st.tool] > maxCallsPerTool) throw new Error('بلغ الحد الأقصى لاستدعاءات أداة ' + st.tool + ' (' + maxCallsPerTool + ' في المهمة).');
          let out = '';
          if (st.tool === 'web') {
            const urlMatch = st.label.match(/https?:\/\/[^\s<>"')\]]+/);
            let url = urlMatch ? urlMatch[0] : '';
            if (!url) {
              const ask = await chatAgentOnce([
                { role: 'user', content: 'لهذه الخطوة من المهمة: "' + st.label + '" (المهمة: ' + task + ') — أعطِ أفضل رابط ويب واحد فقط لقراءته، من هذه النطاقات فقط: ' + (agentCfg.safety?.whitelist || []).join('، ') + '، بلا شرح.' }
              ], { sys: agentSystemPrompt(task, ledger()), userText: task });
              totalTokens += ask.tokens;
              const u2 = (ask.content.match(/https?:\/\/[^\s<>"')\]]+/) || [])[0];
              if (u2) url = u2;
            }
            if (!url) throw new Error('لم يُعثر على رابط لهذه الخطوة.');
            if (!isUrlAllowed(url)) throw new Error('النطاق غير مسموح في القائمة البيضاء — أضفه من إعدادات الوكيل ← حاجز الأمان.');
            const fr = await fetch('/api/fetch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: AbortSignal.timeout((agentCfg.safety?.timeoutSec || 12) * 1000) });
            const fd = await fr.json();
            if (!fr.ok) throw new Error(fd.error || 'فشل جلب الصفحة.');
            out = 'صفحة: ' + (fd.title || url) + '\n' + String(fd.text || '').slice(0, agentCfg.safety?.fetchChars || 3000);
            steps[si] = { ...st, status: 'done', detail: (fd.title || url).slice(0, 120) };
            agentLog('web', st.label, 'done', fd.title || url);
          } else if (st.tool === 'image') {
            const ir = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: st.label + ' — ' + task, apiKeys: keys, flKeys, flUrl }) });
            const id = await ir.json();
            if (!ir.ok) throw new Error(id.error || 'فشل توليد الصورة.');
            out = 'صورة مولّدة عبر ' + (id.via || 'المسار المجاني');
            steps[si] = { ...st, status: 'done', detail: out, imageUrl: id.url && String(id.url).startsWith('http') ? id.url : undefined };
            agentLog('image', st.label, 'done', out);
          } else if (st.tool === 'video') {
            const vr = await fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: st.label + ' — ' + task, apiKeys: keys }) });
            const vd = await vr.json();
            if (!vr.ok) throw new Error(vd.error || 'فشل توليد الفيديو.');
            out = vd.url ? 'فيديو مولّد: ' + vd.url : 'فيديو قيد التوليد — المهمة ' + String(vd.jobId || '').slice(0, 8);
            steps[si] = { ...st, status: 'done', detail: out.slice(0, 140), videoUrl: vd.url || undefined };
            agentLog('video', st.label, 'done', out);
          } else if (['github', 'vercel', 'render', 'cloudflare', 'facebook', 'gmail'].includes(st.tool)) {
            const ctx = await connectionContextFor(st.label + ' ' + task);
            if (!ctx) throw new Error('التكامل ' + st.tool + ' غير موصول أو لا توجد بيانات — أضف توكنه من «التكاملات».');
            out = ctx.slice(0, 3000);
            steps[si] = { ...st, status: 'done', detail: 'بيانات حقيقية من ' + st.tool };
            agentLog(st.tool, st.label, 'done', 'بيانات حقيقية');
          } else {
            const cr = await chatAgentOnce([
              { role: 'user', content: 'المهمة: ' + task + '\nالخطوة الحالية: ' + st.label + '\nنتائج الخطوات السابقة:\n' + (ctxNotes.join('\n') || 'لا شيء بعد.') + '\n\nنفّذ هذه الخطوة فقط، باختصار ودقة.' }
            ], { sys: agentSystemPrompt(task, ledger()), userText: task });
            totalTokens += cr.tokens;
            out = cr.content;
            steps[si] = { ...st, status: 'done', detail: String(cr.content || '').replace(/\s+/g, ' ').slice(0, 160) };
            agentLog('chat', st.label, 'done', String(cr.content || '').slice(0, 120));
          }
          if (out) ctxNotes.push('- ' + steps[si].label + ':\n' + String(out).slice(0, 2500));
        } catch (e) {
          steps[si] = { ...steps[si], status: 'failed', detail: String(e.message || e).slice(0, 140) };
          ctxNotes.push('- ' + steps[si].label + ': (فشلت — ' + String(e.message || e).slice(0, 120) + ')');
          agentLog(steps[si].tool, steps[si].label, 'failed', String(e.message || e).slice(0, 140));
        }
        updateAgent({ steps: steps.map((s) => ({ ...s })) });
      }
      // الخلاصة النهائية (بث حي)
      const fin = await chatAgentOnce([
        { role: 'user', content: 'المهمة: ' + task + '\n\nنتائج الخطوات:\n' + (ctxNotes.join('\n') || 'لا نتائج.') + '\n\nاكتب الإجابة النهائية المنظمة للمستخدم بالعربية، مع ذكر ما فشل إن وُجد.' }
      ], { sys: agentSystemPrompt(task, ledger()), userText: task, onDelta: (txt) => updateAgent({ content: txt }) });
      totalTokens += fin.tokens;
      updateAgent({ steps: steps.map((s) => ({ ...s })), status: 'done', content: fin.content, tokens: totalTokens });
      setDaily((d) => ({ ...d, tokens: d.tokens + totalTokens }));
      agentLog('chat', 'الإجابة النهائية', 'done', fin.content.slice(0, 120));
      if (agentCfg.agent?.storeHistory !== false) setAgentCfg((p) => ({ ...p, history: [{ task: task.slice(0, 80), status: 'done', at: Date.now() }, ...(p.history || [])].slice(0, 10) }));
    } catch (e) {
      updateAgent({ status: 'failed', content: 'تعذّر إكمال المهمة: ' + String(e.message || e).slice(0, 200), tokens: totalTokens });
      agentLog('chat', 'المهمة', 'failed', String(e.message || e).slice(0, 140));
      if (agentCfg.agent?.storeHistory !== false) setAgentCfg((p) => ({ ...p, history: [{ task: task.slice(0, 80), status: 'failed', at: Date.now() }, ...(p.history || [])].slice(0, 10) }));
    } finally {
      setLoading(false); setAgentRunning(false);
    }
  }

  // ---------- مهام Live الخلفية (v2.1) ----------
  // التشغيل على GitHub Actions (مجاني 2000 دقيقة/شهر) — تستمر حتى لو أغلق المستخدم الإنترنت.
  async function createJob() {
    if (!conn.github) { setJobMsg(tt('jobNeedGithub')); setDrawer('connections'); return; }
    if (!jobPrompt.trim()) { setJobMsg('اكتب وصف المهمة أولاً.'); return; }
    setJobBusy(true); setJobMsg('');
    try {
      const r = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', token: conn.github, type: jobType, title: jobTitle.trim() || jobPrompt.trim().slice(0, 60), prompt: jobPrompt.trim() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإنشاء.');
      const rec = { id: d.jobId, type: jobType, title: jobTitle.trim() || jobPrompt.trim().slice(0, 60), prompt: jobPrompt.trim(), status: 'queued', progress: 0, steps: [], createdAt: Date.now() };
      setJobs((p) => [rec, ...p]);
      setJobPrompt(''); setJobTitle(''); setJobMsg(tt('jobCreated'));
    } catch (e) { setJobMsg('✗ ' + String(e.message || e)); }
    finally { setJobBusy(false); }
  }
  async function refreshJobs() {
    if (!conn.github) return;
    const actives = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
    if (!actives.length) return;
    for (const j of actives) {
      try {
        const r = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', token: conn.github, jobId: j.id }) });
        const d = await r.json();
        if (!r.ok) continue;
        setJobs((p) => p.map((x) => (x.id === j.id ? { ...x, status: d.status, progress: d.progress ?? x.progress, steps: d.steps || x.steps, result: d.result || x.result, error: d.error || null, runUrl: d.run?.url || x.runUrl } : x)));
      } catch {}
    }
  }

  function updateSession(id, fn) { setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s))); }
  function newChat() {
    const s = { id: uid(), title: 'محادثة جديدة', messages: [], tokens: 0, createdAt: Date.now() };
    setSessions((p) => [s, ...p]); setCurrentId(s.id); setAttachments([]); setSidebarOpen(false);
  }
  // ---------- نقل الجلسة (v2.0): «متابعة في جلسة جديدة» ----------
  // ملخص تلقائي موجز من أسئلة المستخدم الأولى + آخر ~10 رسائل حرفياً،
  // والجلسة القديمة تُؤرشف (تبقى في القائمة وقابلة للاستعادة).
  function summarizeSession(s) {
    const msgs = s.messages || [];
    if (!msgs.length) return '';
    const userQs = msgs.filter((m) => m.role === 'user').map((m) => textOf(m).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const topics = userQs.slice(0, 12).map((q, i) => (i + 1) + '. ' + q.slice(0, 120)).join('\n');
    return 'جلسة «' + (s.title || 'محادثة') + '» — ' + msgs.length + ' رسالة. أبرز ما سُئل عنه:\n' + topics;
  }
  function transferSession(s) {
    if (!s || !(s.messages || []).length) return;
    const summary = summarizeSession(s);
    const tail = (s.messages || []).slice(-10);
    const ns = {
      id: uid(), title: (s.title || 'محادثة') + ' — متابعة',
      messages: [{ role: 'assistant', kind: 'summary', content: summary, tokens: 0 }, ...tail.map((m) => ({ ...m }))],
      tokens: tail.reduce((n, m) => n + (m.tokens || 0), 0),
      createdAt: Date.now(), summary, continuedFrom: s.id
    };
    setSessions((p) => [ns, ...p.map((x) => (x.id === s.id ? { ...x, archived: true } : x))]);
    setCurrentId(ns.id); setSidebarOpen(false);
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

  // ---------- الملفات (v2.0): بلا حد 2MB — الصور تُصغَّر للعرض، والنص يُقرأ كاملاً ----------
  // تصغير صورة في المتصفح (canvas): الأصل للعرض، والمصغّرة للنموذج فقط.
  function downscaleImage(dataUrl, maxDim) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth <= maxDim && img.naturalHeight <= maxDim) { resolve(dataUrl); return; }
        const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const mime = String(dataUrl).startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
        resolve(c.toDataURL(mime, 0.88));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }
  // استخراج نص PDF في المتصفح عبر pdf.js (تحميل ديناميكي عند الحاجة فقط — أول 30 صفحة).
  async function extractPdfText(file) {
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs';
      const buf = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      let out = '';
      const pages = Math.min(pdf.numPages, 30);
      for (let p = 1; p <= pages && out.length < 120000; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        out += tc.items.map((it) => it.str || '').join(' ') + '\n';
      }
      return out.trim();
    } catch { return ''; }
  }
  function handleFiles(files) {
    [...files].forEach((f) => {
      if (f.type.startsWith('image/')) {
        const r = new FileReader();
        r.onload = async () => {
          const original = String(r.result);
          const display = await downscaleImage(original, 1600).catch(() => original);
          setAttachments((p) => [...p, { id: uid(), name: f.name, kind: 'image', dataUrl: display, tokens: 800 }]);
        };
        r.readAsDataURL(f);
      } else if (f.name.toLowerCase().endsWith('.pdf')) {
        extractPdfText(f).then((text) => {
          if (text) {
            const stored = text.length > 500000 ? text.slice(0, 500000) : text;
            setAttachments((p) => [...p, { id: uid(), name: f.name, kind: 'text', content: stored, tokens: estimateTokens(stored), note: text.length > 500000 ? 'حُفظ أول 500 ألف حرف (الملف أكبر من ذلك)' : '' }]);
          } else {
            setAttachments((p) => [...p, { id: uid(), name: f.name, kind: 'pdf', content: '', tokens: 0, note: 'PDF: لم يُستخرج نصه — انسخ النص من الملف والصقه هنا.' }]);
          }
        });
      } else {
        const r = new FileReader();
        r.onload = () => {
          const text = String(r.result || '');
          const stored = text.length > 500000 ? text.slice(0, 500000) : text;
          setAttachments((p) => [...p, { id: uid(), name: f.name, kind: 'text', content: stored, tokens: estimateTokens(stored), note: text.length > 500000 ? 'حُفظ أول 500 ألف حرف (الملف أكبر من ذلك)' : '' }]);
        };
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
    if (m.kind === 'summary') return ''; // ملخص الجلسة المنقولة يُمرَّر كبادئة سياق، لا كرسالة
    if (m.compare) return 'نتائج مقارنة سابقة:\n' + (m.results || []).map((r) => `[${getProvider(r.provider).name}]: ${r.error ? 'خطأ — ' + r.error : (r.content || '')}`).join('\n');
    return m.content;
  }
  function historyApiMessages(history, userMsg, apiContent) {
    return history.map((m) => ({ role: m.role, content: (m.role === 'user' && m === userMsg) ? apiContent : apiContentOf(m) }));
  }
  // طلب واحد لمزود واحد (نفس مسار الإرسال العادي، دون التبديل التلقائي)
  async function fetchOneProvider(pid, history, userMsg, userContent, imageAtt) {
    const prov = getProvider(pid);
    const visionUrl = imageAtt && prov.supportsVision ? await downscaleImage(imageAtt.dataUrl, 1024).catch(() => imageAtt.dataUrl) : null;
    const apiContent = visionUrl
      ? [{ type: 'text', text: userContent || 'صف هذه الصورة وحلّلها.' }, { type: 'image_url', image_url: { url: visionUrl } }]
      : userContent;
    const apiMessages = (current.summary ? [{ role: 'user', content: 'ملخص الجلسة السابقة — تابع المحادثة من هنا دون طلب إعادة الشرح:\n' + current.summary }] : []).concat(historyApiMessages(history, userMsg, apiContent));
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
    if (daily.compares >= planInfo.compares) { setError(tt('toolLimitReached')); setDrawer('pricing'); return; }
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
      setDaily((d) => ({ ...d, tokens: d.tokens + totalUsed, compares: d.compares + 1 }));
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
    if (deep && daily.deeps >= planInfo.deeps) { setError(tt('toolLimitReached')); setDrawer('pricing'); return; }
    setError('');
    const attachText = attachments.filter((a) => a.kind === 'text').map((a) => `\n\n[ملف: ${a.name}]\n${a.content.slice(0, 12000)}`).join('');
    const imageAtt = attachments.find((a) => a.kind === 'image');
    const pdfNote = attachments.filter((a) => a.kind === 'pdf').map((a) => `\n[ملف PDF مرفق: ${a.name} — لم يُستخرج نصه، انسخ نصه والصقه.]`).join('');
    let userContent = text + attachText + pdfNote + (opts.context || '');
    let apiContent = userContent;
    if (imageAtt && providerId !== 'auto' && provider.supportsVision) {
      // الصورة تُصغَّر إلى 1024px قبل الإرسال للنموذج فقط (الأصل يبقى للعرض) —
      // جسم طلب Vercel محدود بـ ~4.5MB، فصورة هاتف كاملة قد تتجاوزه.
      const visionUrl = await downscaleImage(imageAtt.dataUrl, 1024).catch(() => imageAtt.dataUrl);
      apiContent = [{ type: 'text', text: userContent || 'صف هذه الصورة وحلّلها.' }, { type: 'image_url', image_url: { url: visionUrl } }];
    }
    const userMsg = { role: 'user', content: userContent, tokens: estimateTokens(userContent), route: opts.route || null };
    const history = [...current.messages, userMsg];
    updateSession(current.id, (s) => ({ ...s, title: s.messages.length === 0 ? text.slice(0, 40) || 'محادثة جديدة' : s.title, messages: history, tokens: (s.tokens || 0) + userMsg.tokens }));
    setInput(''); setAttachments([]); setLoading(true);
    try {
      // كل المزودين يمرون عبر وكيل خادم الموقع /api/chat — ببث SSE حي (v2.0).
      const summaryPrefix = current.summary
        ? [{ role: 'user', content: 'ملخص الجلسة السابقة — تابع المحادثة من هنا دون طلب إعادة الشرح:\n' + current.summary }]
        : [];
      const apiMessages = summaryPrefix.concat(historyApiMessages(history, userMsg, apiContent));
      let reqBody;
      let sentFl = null;
      if (providerId === 'freellmapi') {
        // --- FreeLLMAPI: الراوتر المستضاف على Railway — دائماً عبر وكيل الخادم ---
        sentFl = flKeyEntries();
        if (!sentFl.length) {
          setError('أضف المفتاح الموحد (freellmapi-…) من لوحة الراوتر في إعدادات FreeLLMAPI أولاً.');
          setDrawer('freellmapi');
          return;
        }
        reqBody = {
          messages: apiMessages,
          providerId, model: (model || '').trim() || 'auto',
          apiKeys: { ...keys, freellmapi: sentFl },
          baseURL: flUrl || FL_DEFAULT_URL, deepThinking: deep, lang, skills: activeSkillInstructions(), stream: true
        };
      } else {
        reqBody = {
          messages: apiMessages,
          providerId, model: providerId === 'auto' ? undefined : (model || provider.models[0]),
          apiKeys: keys, baseURL: providerId === 'custom' ? customBase : undefined,
          deepThinking: deep, lang, skills: activeSkillInstructions(), stream: true
        };
      }
      // رسالة مؤقتة تُملأ لحظة بلحظة أثناء البث (تفكير خافت + إجابة تُكتب).
      const streamId = uid();
      const modelForMsg = reqBody.model || (providerId === 'auto' ? 'تلقائي' : provider.models[0]);
      updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, { id: streamId, role: 'assistant', content: '', reasoning: '', streaming: true, provider: providerId === 'auto' ? null : providerId, model: modelForMsg, tokens: 0 }] }));
      setStreamingId(streamId);
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/event-stream')) {
        let content = ''; let reasoning = ''; let usage = null; let modelUsed = null; let providerUsed = null; let keyIndex = null;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        const applyUpdate = () => updateSession(current.id, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === streamId ? { ...m, content, reasoning, model: modelUsed || m.model, provider: providerUsed || m.provider } : m)) }));
        let streamError = null;
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
            for (const line of block.split('\n')) {
              if (!line.startsWith('data:')) continue;
              let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
              if (ev.type === 'content' && ev.delta) { content += ev.delta; applyUpdate(); }
              else if (ev.type === 'reasoning' && ev.delta) { reasoning += ev.delta; applyUpdate(); }
              else if (ev.type === 'done') { usage = ev.usage; modelUsed = ev.modelUsed; providerUsed = ev.providerUsed; keyIndex = ev.keyIndex; }
              else if (ev.type === 'error') { streamError = ev.error || 'خطأ أثناء البث.'; break outer; }
            }
          }
        }
        if (streamError) throw new Error(streamError);
        if (sentFl && keyIndex != null) noteFlKeyUsed(sentFl, keyIndex, true);
        if (!reasoning && deep && content.includes('التفكير:')) {
          const parts = content.split('الإجابة:');
          if (parts.length > 1) { reasoning = parts[0].replace('التفكير:', '').trim(); content = parts.slice(1).join('الإجابة:').trim(); }
        }
        const used = usage?.total_tokens || estimateTokens(content);
        updateSession(current.id, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === streamId ? { ...m, content, reasoning: reasoning || null, streaming: false, tokens: used } : m)), tokens: (s.tokens || 0) + used }));
        setDaily((d) => ({ ...d, tokens: d.tokens + used, deeps: deep ? d.deeps + 1 : d.deeps }));
        // التفكير الخافت 8 ثوانٍ بعد اكتمال البث (العدّاد لا يتغير عند التحديث، فيُشغَّل يدوياً هنا).
        if (reasoning) {
          const fi = history.length;
          thinkFlashedRef.current[fi] = true;
          setThinkFlash((p) => ({ ...p, [fi]: true }));
          setTimeout(() => setThinkFlash((p) => { const n = { ...p }; delete n[fi]; return n; }), 8000);
        }
      } else {
        // رد JSON (احتياطي أو خطأ) — أزل الرسالة المؤقتة وعاملها كالسابق.
        updateSession(current.id, (s) => ({ ...s, messages: s.messages.filter((m) => m.id !== streamId) }));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل الطلب.');
        if (sentFl) noteFlKeyUsed(sentFl, data.keyIndex, true);
        const used = data.usage?.total_tokens || estimateTokens(data.content);
        const aiMsg = { role: 'assistant', content: data.content, provider: data.providerUsed, model: data.modelUsed, tokens: used, reasoning: data.reasoning || null, via: data.via || 'عبر خادم الموقع' };
        updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, aiMsg], tokens: (s.tokens || 0) + used }));
        setDaily((d) => ({ ...d, tokens: d.tokens + used, deeps: deep ? d.deeps + 1 : d.deeps }));
      }
    } catch (e) {
      setError(String(e.message || e));
      // أزل رسالة البث المؤقتة الفارغة إن بقيت
      updateSession(current.id, (s) => ({ ...s, messages: s.messages.filter((m) => !(m.streaming && !m.content && !m.reasoning)) }));
    } finally { setLoading(false); setStreamingId(null); }
  }

  // ---------- Puter.js (v1.9): صور وفيديو مجانيان من حساب Puter المجاني للمستخدم ----------
  // يعمل في المتصفح فقط (لا مفتاح خادم): أول استخدام يطلب من المستخدم إنشاء/تسجيل دخول
  // حساب Puter مجاني، والتوليد يُحسب على رصيده الخاص — بلا أي تكلفة على الموقع.
  // المصدر: https://developer.puter.com/tutorials/free-unlimited-vidu-api/
  // v2.0: txt2vid بصورة مرجعية (input_reference) + حجم + مدة + اختيار النموذج.
  // المصدر: https://docs.puter.com/AI/txt2vid/
  async function puterClient() {
    const mod = await import('@heyputer/puter.js');
    return mod.puter || mod.default;
  }
  async function puterImage(prompt) {
    const puter = await puterClient();
    const img = await puter.ai.txt2img(prompt, { model: 'black-forest-labs/flux-schnell' });
    return img?.src || null;
  }
  async function puterVideo(prompt, opts = {}) {
    const puter = await puterClient();
    const args = { model: opts.model || 'togetherai:wan-ai/wan2.7-t2v' };
    if (opts.image) args.input_reference = opts.image;
    if (opts.size) args.size = opts.size;
    if (opts.seconds) args.seconds = opts.seconds;
    const video = await puter.ai.txt2vid(prompt, args);
    return video?.src || null;
  }
  function aspectSize(a) {
    return a === '9:16' ? '720x1280' : a === '1:1' ? '1024x1024' : '1280x720';
  }

  // ---------- Gradio Spaces المجانية (v2.0): من المتصفح مباشرة — حصة ZeroGPU للزائر نفسه ----------
  // مهم: لا تمر هذه المكالمات عبر خادم Vercel أبداً — الخادم بلا GPU ومهلته 60 ثانية،
  // وحصة ZeroGPU المجهولة (دقيقتان/يوم) مشتركة لكل الموقع إن جاءت من الخادم.
  // نقاط النهاية والمعاملات مُتحقق منها حياً من /gradio_api/info في 2026-11-22
  // (انظر research/free-video-apis-2026-11-22.md).
  async function gradioClient(space) {
    const { Client } = await import('@gradio/client');
    return Client.connect(space);
  }
  function gradioFileUrl(file, origin) {
    if (!file) return null;
    const inner = file.video || file;
    if (inner?.url && String(inner.url).startsWith('http')) return inner.url;
    if (inner?.url && origin) return origin + inner.url;
    if (inner?.path) return origin + '/gradio_api/file=' + String(inner.path);
    if (file?.url && String(file.url).startsWith('http')) return file.url;
    return null;
  }
  // تشغيل مهمة Gradio مع تقدّم الطابور (status: pending/generating + position/eta).
  async function gradioRun(space, endpoint, data, onStatus) {
    const client = await gradioClient(space);
    const job = client.submit(endpoint, data);
    let result = null;
    for await (const msg of job) {
      if (msg.type === 'status' && onStatus) {
        if (msg.stage === 'pending') onStatus('في الطابور' + (msg.position != null ? ' — موقعك ' + msg.position : '') + (msg.eta ? ' — ~' + Math.round(msg.eta) + ' ث' : '') + '…');
        else if (msg.stage === 'generating') onStatus('جارٍ التوليد…');
        else if (msg.stage === 'error') throw new Error('فشلت المهمة على المساحة.');
      } else if (msg.type === 'data') { result = msg.data; }
    }
    return result;
  }
  // Wan 2.1 Fast (multimodalart/wan2-1-fast — /generate_video): صورة → فيديو حتى 3.4 ث.
  async function gradioWanVideo(imageFile, prompt, onStatus) {
    const [w, h] = vidAspect === '9:16' ? [480, 832] : vidAspect === '1:1' ? [512, 512] : [832, 480];
    const data = await gradioRun('multimodalart/wan2-1-fast', '/generate_video', {
      input_image: imageFile,
      prompt: prompt || 'make this image come alive, cinematic motion, smooth animation',
      height: h, width: w,
      negative_prompt: vidNegPrompt || '',
      duration_seconds: Math.min(3.4, Math.max(0.5, vidFreeDuration || 2)),
      guidance_scale: 1.0,
      steps: Math.min(30, Math.max(1, vidFreeSteps || 8)),
      seed: Math.floor(Math.random() * 2147483647),
      randomize_seed: true
    }, onStatus);
    const url = gradioFileUrl(data?.[0], 'https://multimodalart-wan2-1-fast.hf.space');
    if (!url) throw new Error('اكتملت المهمة دون رابط فيديو.');
    return url;
  }
  // LTX Video (Lightricks/ltx-video-distilled — /image_to_video): صورة → فيديو حتى 8.5 ث.
  async function gradioLtxVideo(imageFile, prompt, onStatus) {
    const [w, h] = vidAspect === '9:16' ? [704, 1024] : vidAspect === '1:1' ? [768, 768] : [1024, 576];
    const data = await gradioRun('Lightricks/ltx-video-distilled', '/image_to_video', {
      prompt: prompt || 'The creature from the image starts to move',
      negative_prompt: vidNegPrompt || 'worst quality, inconsistent motion, blurry, jittery, distorted',
      input_image_filepath: imageFile,
      input_video_filepath: null,
      height_ui: h, width_ui: w,
      mode: 'image-to-video',
      duration_ui: Math.min(8.5, Math.max(0.5, vidFreeDuration || 2)),
      ui_frames_to_use: 9,
      seed_ui: Math.floor(Math.random() * 2147483647),
      randomize_seed: true,
      ui_guidance_scale: 1,
      improve_texture_flag: true
    }, onStatus);
    const url = gradioFileUrl(data?.[0], 'https://lightricks-ltx-video-distilled.hf.space');
    if (!url) throw new Error('اكتملت المهمة دون رابط فيديو.');
    return url;
  }
  // Qwen Image Edit (Qwen/Qwen-Image-Edit — /infer): تعديل صورة مرجعية بتعليمات نصية.
  async function gradioQwenEdit(imageFile, prompt, onStatus) {
    const data = await gradioRun('Qwen/Qwen-Image-Edit', '/infer', {
      image: imageFile,
      prompt,
      seed: Math.floor(Math.random() * 2147483647),
      randomize_seed: true,
      true_guidance_scale: Math.min(10, Math.max(1, imgEditGuidance || 4)),
      num_inference_steps: Math.min(50, Math.max(1, imgEditSteps || 20)),
      rewrite_prompt: true
    }, onStatus);
    const url = gradioFileUrl(data?.[0], 'https://qwen-qwen-image-edit.hf.space');
    if (!url) throw new Error('اكتملت المهمة دون رابط صورة.');
    return url;
  }

  // ---------- توليد صورة من داخل المحادثة (عبر الموجّه الذكي) ----------
  // طلب صورة لا يردّ عليه بنص أبداً: إما صورة ظاهرة في المحادثة أو خطأ صريح.
  async function genImageChat(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!current) return;
    if (daily.images >= planInfo.images) { setError('بلغت حد صور اليوم في خطتك (' + planInfo.images + ').'); setDrawer('pricing'); return; }
    let prompt = detectIntent(text, {}).prompt;
    if (!prompt) prompt = subjectFromHistory(current.messages) || 'مشهد جميل';
    const imageAtt = attachments.find((a) => a.kind === 'image'); // صورة مرجعية مرفقة — تُعدَّل بدل توليد جديدة
    setError('');
    const userMsg = { role: 'user', content: text, tokens: estimateTokens(text), route: 'image' };
    const history = [...current.messages, userMsg];
    updateSession(current.id, (s) => ({ ...s, title: s.messages.length === 0 ? prompt.slice(0, 40) : s.title, messages: history, tokens: (s.tokens || 0) + userMsg.tokens }));
    setInput(''); setAttachments([]); setLoading(true);
    try {
      // صورة مرجعية مرفقة → تعديلها عبر Qwen Image Edit (مجاني، Hugging Face ZeroGPU).
      if (imageAtt) {
        try {
          const blob = await fetch(imageAtt.dataUrl).then((r) => r.blob());
          const url = await gradioQwenEdit(blob, prompt, null);
          const imgMsg = { role: 'assistant', kind: 'image', imageUrl: url, prompt, via: 'Qwen Image Edit (مجاني، Hugging Face)', note: 'تعديل الصورة المرجعية «' + (imageAtt.name || '') + '»', tokens: 0 };
          updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, imgMsg] }));
          setDaily((d) => ({ ...d, images: d.images + 1 }));
          return;
        } catch (e) {
          const errMsg = { role: 'assistant', content: 'تعذّر تعديل الصورة المرجعية عبر Qwen Image Edit: ' + String(e.message || e) + '\n\nأعد المحاولة بعد قليل (حصة ZeroGPU اليومية قد تكون مستنفدة)، أو أرسل الوصف دون صورة مرجعية لتوليد صورة جديدة.', tokens: 0 };
          updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, errMsg] }));
          return;
        }
      }
      if (imgPreferred === 'puter') {
        const url = await puterImage(prompt);
        if (!url) throw new Error('لم يرجع Puter رابط صورة.');
        const imgMsg = { role: 'assistant', kind: 'image', imageUrl: url, prompt, via: 'Puter — مجاني بحساب Puter مجاني', note: null, tokens: 0 };
        updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, imgMsg] }));
        setDaily((d) => ({ ...d, images: d.images + 1 }));
        return;
      }
      const res = await fetch('/api/image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, apiKeys: keys, flKeys: flKeys.filter((k) => k.status !== 'exhausted').map((k) => ({ value: k.value })), flUrl: flUrl || FL_DEFAULT_URL, size: '1024x1024', preferred: imgPreferred })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل توليد الصورة.');
      const viaName = data.via === 'huggingface-space' ? 'Hugging Face FLUX (مجاني بدون مفتاح)' : data.via === 'freellmapi' ? 'FreeLLMAPI Router' : data.via === 'gemini' ? 'Nano Banana (Google Gemini)' : data.via === 'cloudflare' ? 'Cloudflare Workers AI FLUX (مجاني)' : data.via === 'puter' ? 'Puter — مجاني بحساب Puter مجاني' : getProvider(data.via).name;
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
    if (daily.videos >= planInfo.videos) { setError(tt('toolLimitReached')); setDrawer('pricing'); return; }
    const prompt = detectIntent(text, {}).prompt || text;
    const imageAtt = attachments.find((a) => a.kind === 'image'); // صورة مرجعية مرفقة في المحادثة
    setError('');
    const userMsg = { role: 'user', content: text, tokens: estimateTokens(text), route: 'video' };
    const history = [...current.messages, userMsg];
    updateSession(current.id, (s) => ({ ...s, title: s.messages.length === 0 ? prompt.slice(0, 40) : s.title, messages: history, tokens: (s.tokens || 0) + userMsg.tokens }));
    setInput(''); setAttachments([]); setLoading(true);
    try {
      // المسارات المجانية من المتصفح (v2.0): Puter بصورة مرجعية وحجم ومدة،
      // وWan 2.1 / LTX عبر Hugging Face ZeroGPU — كلها بلا مفتاح خادم.
      if (vidProvider === 'puter' || vidProvider === 'wan' || vidProvider === 'ltx') {
        const label = vidProvider === 'puter' ? 'Puter — ' + vidPuterModel : vidProvider === 'wan' ? 'Wan 2.1 Fast (مجاني)' : 'LTX Video (مجاني)';
        const msgId = uid();
        updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, { id: msgId, role: 'assistant', kind: 'video', prompt, videoJob: { jobId: 'free-' + vidProvider, endpoint: vidProvider, provider: label, model: label, status: 'queued' }, tokens: 0 }] }));
        (async () => {
          try {
            let url;
            const onStatus = (txt) => updateSession(current.id, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === msgId ? { ...m, videoJob: { ...m.videoJob, progress: txt } } : m)) }));
            if (vidProvider === 'puter') {
              url = await puterVideo(prompt, { model: vidPuterModel, image: vidRefFile || undefined, size: aspectSize(vidAspect), seconds: Number(vidPuterSeconds) || 8 });
            } else {
              const refBlob = vidRefFile || (imageAtt ? await fetch(imageAtt.dataUrl).then((r) => r.blob()).catch(() => null) : null);
              if (!refBlob) throw new Error('فيديو Wan و LTX يحتاج صورة مرجعية — أرفق صورة أولاً من زر 📷 أو من درج الفيديو.');
              url = vidProvider === 'wan' ? await gradioWanVideo(refBlob, prompt, onStatus) : await gradioLtxVideo(refBlob, prompt, onStatus);
            }
            if (!url) throw new Error('لم يرجع المزود رابط فيديو.');
            updateSession(current.id, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === msgId ? { ...m, videoUrl: url, videoJob: null, note: vidProvider === 'puter' ? 'عبر Puter — مجاني بحساب Puter مجاني' : 'عبر Hugging Face ZeroGPU — مجاني بدون حساب' } : m)) }));
            setDaily((d) => ({ ...d, videos: d.videos + 1 }));
          } catch (e) {
            updateSession(current.id, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === msgId ? { ...m, videoJob: null, note: 'تعذّر توليد الفيديو: ' + String(e.message || e) + (vidProvider === 'puter' ? ' — سجّل الدخول بحساب Puter مجاني عند الطلب، ثم أعد المحاولة.' : ' — حصة ZeroGPU اليومية قد تكون مستنفدة، أو المساحة مشغولة؛ أعد المحاولة لاحقاً.') } : m)) }));
          }
        })();
        return;
      }
      const res = await fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, provider: vidProvider, apiKeys: keys, duration: vidDuration, aspectRatio: vidAspect, resolution: vidResolution }) });
      const data = await res.json();
      if (res.ok && data.status === 'queued') {
        const msgId = uid();
        updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, { id: msgId, role: 'assistant', kind: 'video', prompt, videoJob: { jobId: data.jobId, endpoint: data.endpoint, provider: data.provider, model: data.model, status: 'queued' }, tokens: 0 }] }));
        pollVideoJob(current.id, data.jobId, data.endpoint, data.provider, msgId);
        setDaily((d) => ({ ...d, videos: d.videos + 1 }));
      } else if (res.ok && data.status === 'completed' && (data.url || data.videoUrl)) {
        updateSession(current.id, (s) => ({ ...s, messages: [...s.messages, { role: 'assistant', kind: 'video', prompt, videoUrl: data.url || data.videoUrl, note: data.model ? 'عبر: ' + data.model : null, tokens: 0 }] }));
        setDaily((d) => ({ ...d, videos: d.videos + 1 }));
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
    if (tool === 'image') { genImageChat(textOverride); return; }
    if (tool === 'video') { genVideoChat(textOverride); return; }
    // v2.1: وضع الوكيل — يخطط المهمة وينفّذها خطوة بخطوة بدل الرد المباشر.
    if (agentOn) { runAgentTask(text); return; }
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
    setImgLoading(true); setImgResult(null); setImgProgress('');
    try {
      // صورة مرجعية مرفقة → تعديلها عبر Qwen Image Edit (مجاني، Hugging Face).
      if (imgRefFile) {
        const url = await gradioQwenEdit(imgRefFile, imgPrompt, (txt) => setImgProgress(txt));
        setImgResult({ url, via: 'qwen-edit', free: true }); setDaily((d) => ({ ...d, images: d.images + 1 }));
        return;
      }
      if (imgPreferred === 'qwen-edit' && !imgRefFile) {
        setImgResult({ error: 'Qwen Image Edit يحتاج صورة مرجعية — أرفق صورة من زر «صورة مرجعية» أعلاه أولاً.' });
        return;
      }
      if (imgPreferred === 'puter') {
        const url = await puterImage(imgPrompt);
        if (!url) throw new Error('لم يرجع Puter رابط صورة.');
        setImgResult({ url, via: 'puter', free: true }); setDaily((d) => ({ ...d, images: d.images + 1 }));
        return;
      }
      const res = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: imgPrompt, apiKeys: keys, flKeys: flKeys.filter((k) => k.status !== 'exhausted').map((k) => ({ value: k.value })), flUrl: flUrl || FL_DEFAULT_URL, size: imgSize, preferred: imgPreferred }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل توليد الصورة.');
      setImgResult(data); setDaily((d) => ({ ...d, images: d.images + 1 }));
    } catch (e) { setImgResult({ error: String(e.message || e) }); }
    finally { setImgLoading(false); setImgProgress(''); }
  }
  async function genVideo() {
    if (!vidPrompt.trim()) return;
    if (daily.videos >= planInfo.videos) { setError(tt('toolLimitReached')); setDrawer('pricing'); return; }
    setVidLoading(true); setVidResult(null); setVidJob(null); setVidProgress('');
    // المسارات المجانية من المتصفح (v2.0): Puter بصورة مرجعية وحجم ومدة، وWan 2.1 / LTX عبر Hugging Face.
    if (vidProvider === 'puter' || vidProvider === 'wan' || vidProvider === 'ltx') {
      const label = vidProvider === 'puter' ? 'Puter — ' + vidPuterModel : vidProvider === 'wan' ? 'Wan 2.1 Fast (مجاني)' : 'LTX Video (مجاني)';
      setVidJob({ jobId: 'free-' + vidProvider, endpoint: vidProvider, provider: label, model: label, status: 'queued' });
      try {
        let url;
        const onStatus = (txt) => { setVidProgress(txt); setVidJob((j) => (j ? { ...j, progress: txt } : j)); };
        if (vidProvider === 'puter') {
          url = await puterVideo(vidPrompt, { model: vidPuterModel, image: vidRefFile || undefined, size: aspectSize(vidAspect), seconds: Number(vidPuterSeconds) || 8 });
        } else {
          if (!vidRefFile) throw new Error('فيديو Wan و LTX يحتاج صورة مرجعية — أرفق صورة من زر «صورة مرجعية» أعلاه.');
          url = vidProvider === 'wan' ? await gradioWanVideo(vidRefFile, vidPrompt, onStatus) : await gradioLtxVideo(vidRefFile, vidPrompt, onStatus);
        }
        if (!url) throw new Error('لم يرجع المزود رابط فيديو.');
        setVidJob({ jobId: 'free-' + vidProvider, endpoint: vidProvider, provider: label, model: label, status: 'completed', url });
        setDaily((d) => ({ ...d, videos: d.videos + 1 }));
      } catch (e) {
        setVidJob({ jobId: 'free-' + vidProvider, endpoint: vidProvider, provider: label, model: label, status: 'failed', error: String(e.message || e) + (vidProvider === 'puter' ? ' — سجّل الدخول بحساب Puter مجاني عند الطلب، ثم أعد المحاولة.' : ' — حصة ZeroGPU اليومية قد تكون مستنفدة، أو المساحة مشغولة؛ أعد المحاولة لاحقاً.') });
      } finally { setVidLoading(false); setVidProgress(''); }
      return;
    }
    try {
      const res = await fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: vidPrompt, provider: vidProvider, apiKeys: keys, duration: vidDuration, aspectRatio: vidAspect, resolution: vidResolution }) });
      const data = await res.json();
      if (res.ok && data.status === 'queued') {
        setVidJob({ jobId: data.jobId, endpoint: data.endpoint, provider: data.provider, model: data.model, status: 'queued' });
        pollVideoJob(null, data.jobId, data.endpoint, data.provider, null);
        setDaily((d) => ({ ...d, videos: d.videos + 1 }));
      } else {
        setVidResult({ status: res.status, ...data });
        if (res.ok && data.status === 'completed' && (data.url || data.videoUrl)) setDaily((d) => ({ ...d, videos: d.videos + 1 }));
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

  const currentModelName = providerId === 'freellmapi' && model && flCatalog
    ? (flCatalog.models.find((m) => m.id === model)?.name || model)
    : model;
  const currentModelLabel = compareOn ? '⚔️ ' + tt('compare') + ' (' + compareProviders.length + ')' : (providerId === 'auto' ? '⚡ تلقائي' : provider.name + (model ? ' · ' + currentModelName : ''));
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
  const authed = !!googleUser || !!user;

  // جدار تسجيل الدخول (v1.9): لا استخدام للمحادثة بلا حساب Google — بلا وضع ضيف.
  // الجلسة تُحفظ في ملف تعريف آمن، فالعودة للموقع تسجّل الدخول تلقائياً.
  if (sessionStatus === 'loading') {
    return (
      <div className={'app' + (starsOn ? '' : ' glow-off')}>
        <div className="login-wall">
          <div className="logo glow-brand" style={{ fontSize: 34 }}>CHIBANI AI</div>
          <p>جارٍ التحقق من الجلسة…</p>
        </div>
      </div>
    );
  }
  if (!authed) {
    return (
      <div className={'app' + (starsOn ? '' : ' glow-off')}>
        <Starfield enabled={starsOn} />
        {portraitOn && <div className="portrait-bg" aria-hidden="true" />}
        <div className="login-wall">
          <div className="logo glow-brand" style={{ fontSize: 34 }}>CHIBANI AI</div>
          <p className="login-wall-tag">{tt('tagline')}</p>
          <p>{tt('loginRequired')}</p>
          <button className="btn btn-block" style={{ maxWidth: 320 }} onClick={googleLogin}>🔵 {tt('loginGoogle')}</button>
          {authMsg && <div className="note" style={{ marginTop: 12, maxWidth: 340 }}>{authMsg}</div>}
          <div className="login-wall-lang">
            <label>{tt('language')}</label>
            <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={tt('language')}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
            </select>
          </div>
          <p className="login-wall-note">{tt('googleSigninNote')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={'app' + (starsOn ? '' : ' glow-off')}>
      <Starfield enabled={starsOn} />
      {portraitOn && <div className="portrait-bg" aria-hidden="true" />}
      {/* خلفية معتمة للقائمة الجانبية على الهاتف — النقر عليها يغلقها */}
      {sidebarOpen && <div className="backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      {/* الشريط الجانبي — كل التفاصيل هنا، لا شيء منها في الواجهة الرئيسية */}
      <aside className={'sidebar' + (sidebarOpen ? ' open' : '')}>
        <div className="sidebar-head">
          <div className="logo glow-brand">CHIBANI AI <small>{tt('tagline')}</small></div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="إغلاق القائمة">✕</button>
        </div>
        <button className="btn btn-block" onClick={newChat}>{tt('newChat')}</button>
        <div className="stat-box">
          {tt('plan')}: <b>{planInfo.name}</b> — {planInfo.price}<br />
          {tt('tokensToday')}: <b>{formatTokens(daily.tokens)}</b> / {formatTokens(planInfo.limit)} — {tt('remaining')} <b>{formatTokens(remaining)}</b><br />
          🖼 {daily.images}/{planInfo.images} · 🎬 {daily.videos}/{planInfo.videos} · ⚔️ {daily.compares}/{planInfo.compares} · 🧠 {daily.deeps}/{planInfo.deeps}<br />
          {tt('allSessions')}: <b>{formatTokens(totalTokens)}</b> توكن · {sessions.length} {tt('sessions')}<br />
          {googleUser ? <>{tt('account')}: {googleUser.email || googleUser.name}</> : tt('notLoggedIn')}
        </div>
        <div className="session-list">
          {sessions.filter((s) => !s.archived).map((s) => (
            <div key={s.id} className={'session-item' + (s.id === currentId ? ' active' : '')} onClick={() => { setCurrentId(s.id); setSidebarOpen(false); }}>
              <span>{s.title}</span><small>{formatTokens(s.tokens || 0)}</small>
              <span className="row-btns">
                {s.messages.length > 0 && <button className="icon-btn" title={tt('transferSession')} onClick={(e) => { e.stopPropagation(); transferSession(s); }}>↪</button>}
                <button className="icon-btn" title="إعادة تسمية" onClick={(e) => { e.stopPropagation(); renameSession(s); }}>✏️</button>
                <button className="icon-btn" title="حذف" onClick={(e) => { e.stopPropagation(); setSessions((p) => p.filter((x) => x.id !== s.id)); if (s.id === currentId) setCurrentId(sessions[0]?.id || null); }}>🗑</button>
              </span>
            </div>
          ))}
        </div>
        {sessions.some((s) => s.archived) && (
          <div className="archived-box">
            <button className="btn ghost small" onClick={() => setShowArchived((v) => !v)}>📦 {tt('archivedSessions')} ({sessions.filter((s) => s.archived).length}) {showArchived ? '⌃' : '⌄'}</button>
            {showArchived && sessions.filter((s) => s.archived).map((s) => (
              <div key={s.id} className={'session-item archived' + (s.id === currentId ? ' active' : '')} onClick={() => { setCurrentId(s.id); setSidebarOpen(false); }}>
                <span>{s.title}</span><small>{formatTokens(s.tokens || 0)}</small>
                <span className="row-btns">
                  <button className="icon-btn" title={tt('restore')} onClick={(e) => { e.stopPropagation(); updateSession(s.id, (x) => ({ ...x, archived: false })); }}>↩️</button>
                  <button className="icon-btn" title="حذف" onClick={(e) => { e.stopPropagation(); setSessions((p) => p.filter((x) => x.id !== s.id)); if (s.id === currentId) setCurrentId(sessions[0]?.id || null); }}>🗑</button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="sidebar-foot">
          <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)' }}>{tt('language')}</label>
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={tt('language')}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
          </select>
          <button className="btn ghost" onClick={() => { setDrawer('skills'); setSidebarOpen(false); }}>🎯 {tt('skills')}</button>
          <button className="btn ghost" onClick={() => { setDrawer('agent'); setSidebarOpen(false); }}>🤖 {tt('agent')}</button>
          <button className="btn ghost" onClick={() => { setDrawer('live'); setSidebarOpen(false); }}>🔴 {tt('live')} {jobs.filter((j) => j.status === 'queued' || j.status === 'running').length ? '· ' + jobs.filter((j) => j.status === 'queued' || j.status === 'running').length + ' ⏳' : ''}</button>
          <button className="btn ghost" onClick={() => { setDrawer('connections'); setSidebarOpen(false); }}>🌐 {tt('integrations')}</button>
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
          <span className="brand-wrap"><span className="brand glow-brand">CHIBANI AI</span><span className="brand-spark" aria-hidden="true">✦</span><span className="brand-spark s2" aria-hidden="true">✦</span></span>
          <span className="session-title">{current?.title || ''}</span>
          <span className="plan-meter" title={tt('dailyTokens') + ': ' + formatTokens(daily.tokens) + ' / ' + formatTokens(planInfo.limit)}>
            <span className="plan-meter-label">{formatTokens(daily.tokens)} / {formatTokens(planInfo.limit)}</span>
            <span className="plan-meter-bar"><i style={{ width: Math.min(100, (daily.tokens / planInfo.limit) * 100) + '%' }} /></span>
          </span>
          <button className="live-btn" onClick={() => setDrawer('live')} aria-label={tt('live')} title={tt('live')}>🔴 Live{jobs.filter((j) => j.status === 'queued' || j.status === 'running').length ? ' ' + jobs.filter((j) => j.status === 'queued' || j.status === 'running').length : ''}</button>
          <button className="subscribe-btn" onClick={() => setDrawer('pricing')} aria-label={tt('subscribe')}>💎 <span className="subscribe-btn-text">{tt('subscribe')}</span></button>
          <span className="spacer" />
        </header>

        <div className="chat" ref={chatRef} onScroll={onChatScroll}>
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
                        {m.kind === 'summary' ? (
                          <div className="note blue" style={{ marginTop: 0 }}><b>📋 {tt('sessionSummary')}</b><div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{m.content}</div></div>
                        ) : m.kind === 'video' ? (
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
                              <div className="note blue" style={{ marginTop: 10 }}>🎬 جارٍ توليد الفيديو عبر {m.videoJob.model || m.videoJob.provider}… {m.videoJob.progress || ('المهمة ' + String(m.videoJob.jobId).slice(0, 8) + ' — قد تستغرق 1–3 دقائق، وسيظهر الفيديو هنا فور اكتماله.')}</div>
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
                        ) : m.kind === 'agent' ? (
                          <div className="agent-card">
                            <div className="agent-head">
                              <span>🤖 {tt('agent')}</span>
                              <span className={'badge ' + (m.status === 'done' ? 'ok' : m.status === 'failed' ? 'fail' : 'running')}>{m.status === 'done' ? tt('jobDone') : m.status === 'failed' ? tt('jobFailed') : tt('jobRunning')}</span>
                            </div>
                            <div className="agent-task">«{m.task}»</div>
                            <div className="agent-steps">
                              {(m.steps || []).map((s, si) => (
                                <div key={si} className={'agent-step ' + (s.status || 'pending')}>
                                  <span className="agent-step-ico">{s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'running' ? '⏳' : '•'}</span>
                                  <span className="agent-step-body">
                                    <b>{s.label}</b>
                                    {s.detail ? <small>{s.detail}</small> : null}
                                  </span>
                                  {s.imageUrl && <img className="gen agent-step-img" src={s.imageUrl} alt={s.label} />}
                                </div>
                              ))}
                            </div>
                            {m.status === 'running' && <div className="thinking-live">🧠 {tt('agentPlanning')}</div>}
                            {m.content ? <div className="agent-result">{renderMd(m.content, previewActions)}</div> : null}
                            <div className="msg-actions">
                              {m.content && <button onClick={() => copyText(m.content, 'ag' + i)}>{copied === 'ag' + i ? '✓ تم النسخ' : '📋 نسخ'}</button>}
                            </div>
                          </div>
                        ) : (
                          <>
                            {(() => {
                              // التفكير الحي (v2.0): أثناء البث يظهر التفكير خافتاً فوق الإجابة
                              // وهي تُكتب، وبعد اكتمالها يتحول إلى سطر «عرض التفكير» الواحد.
                              const lt = !m.reasoning && m.role === 'assistant' ? splitThinkText(m.content) : null;
                              const thinkingText = m.reasoning || (lt ? lt.thinking : '');
                              const answerText = lt ? lt.answer : textOf(m);
                              const live = m.streaming || thinkFlash[i];
                              return (<>
                                {m.streaming && !answerText && !thinkingText && <div className="thinking-live">🧠 {tt('thinkingNow')}</div>}
                                {thinkingText && (live ? (
                                  <div className="think-flash">{renderMd(thinkingText, previewActions)}</div>
                                ) : (
                                  <details className="think" open={!!showThink[i]} onToggle={(e) => setShowThink((p) => ({ ...p, [i]: e.target.open }))}>
                                    <summary>{tt('showThinking')}</summary>
                                    <div style={{ marginTop: 6 }}>{renderMd(thinkingText, previewActions)}</div>
                                  </details>
                                ))}
                                {renderMd(answerText, previewActions)}
                                {m.streaming && !!answerText && <div className="typing" style={{ marginTop: 4 }}><i /><i /><i /></div>}
                              </>);
                            })()}
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
            {loading && !streamingId && <div className="msg"><div className="avatar ai">✦</div><div className="msg-body">{deepThinking ? <div className="thinking-live">🧠 {tt('thinkingNow')}<br /><span>أحلّل سؤالك خطوة بخطوة قبل كتابة الإجابة النهائية…</span></div> : <><div className="typing"><i /><i /><i /></div><span style={{ fontSize: 13, color: 'var(--muted)' }}>جارٍ التفكير…</span></>}</div></div>}
            {error && <div className="note" style={{ borderColor: 'rgba(248,113,113,.5)', background: 'rgba(248,113,113,.08)' }}>⚠️ {error}</div>}
          </div>
        </div>

        {/* زر الانتقال إلى الأسفل (v2.0): يظهر عند التمرير لأعلى، مع شارة للرسائل الجديدة */}
        {!atBottom && current?.messages?.length > 0 && (
          <button className="scroll-down-btn" onClick={scrollToBottom} aria-label={tt('scrollToBottom')}>↓{unreadNew > 0 && <span className="scroll-down-badge">{unreadNew > 99 ? '99+' : unreadNew}</span>}</button>
        )}

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
            <button className={'mini-chip chip-btn' + (agentOn ? ' active' : '')} onClick={() => setAgentOn((v) => !v)} title={tt('agentIntro')}>🤖 {tt('agentMode')}{agentOn ? ' ✓' : ''}</button>
            {activeSkills.length > 0 && <span className="mini-chip" title={tt('skills')}>🎯 {activeSkills.length} {tt('skills')}</span>}
          </div>
          {/* v2.0: لا شريط نماذج فوق صندوق الكتابة — يبقى زر النموذج المختار فقط في الأعلى،
              وورقة النماذج العمودية (مع بحث ووصف) هي مكان الاختيار. */}
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
                  <button key={p.id} className={'model-card' + (selected ? ' selected' : '')} onClick={() => { setProviderId(p.id); setModel(''); setCompareOn(false); setSheet(null); if (p.id === 'freellmapi' && !flKeys.length) { setDrawer('freellmapi'); } else { setModelsSheet(p.id); } }}>
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
            {/* v2.0: اختيار النموذج يتم في ورقة النماذج العمودية (بحث + وصف) — لا حقول هنا. */}
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
                <span className="tool-text"><b>توليد فيديو</b><small>Wan و LTX مجاناً بدون حساب (بصورة مرجعية)، أو Puter بحساب مجاني، أو Veo 3 و Seedance 2.5 بمفتاح fal.ai، أو Omni بمفتاح Gemini</small></span>
              </button>
              <button className="tool-row" onClick={() => { setSheet(null); fileImageOnlyRef.current?.click(); }}>
                <span className="tool-icon">📷</span>
                <span className="tool-text"><b>إرفاق صورة</b><small>من معرض هاتفك — لتحليلها أو وصفها</small></span>
              </button>
              <button className="tool-row" onClick={() => { setSheet(null); fileRef.current?.click(); }}>
                <span className="tool-icon">📁</span>
                <span className="tool-text"><b>إرفاق ملف</b><small>نص أو PDF — يُستخرج نصه في متصفحك ويُحلَّل مع رسالتك</small></span>
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
              <button className="tool-row" onClick={() => { setAgentOn((v) => !v); setSheet(null); }}>
                <span className="tool-icon">🤖</span>
                <span className="tool-text"><b>{tt('agentMode')}</b><small>الوكيل يخطط مهمتك وينفّذها خطوة بخطوة بأدوات الموقع — فعّلها ثم اكتب مهمتك وأرسل</small></span>
                <span className={'switch' + (agentOn ? ' on' : '')}><i /></span>
              </button>
              <button className="tool-row" onClick={() => { setSheet(null); setDrawer('skills'); }}>
                <span className="tool-icon">🎯</span>
                <span className="tool-text"><b>{tt('skills')}</b><small>اختر مهارة (بحث ويب، تحليل ملف، مراجعة كود…) تُوجّه إجابات النموذج — مفاتيح توجيه، لا سحر</small></span>
              </button>
              <button className="tool-row" onClick={() => { setSheet(null); setDrawer('live'); }}>
                <span className="tool-icon">🔴</span>
                <span className="tool-text"><b>{tt('live')}</b><small>مشاريع طويلة تعمل في الخلفية على GitHub Actions حتى لو أغلقت الإنترنت</small></span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ورقة نماذج المزود الطويلة (v2.0): قائمة عمودية قابلة للتمرير، مع بحث،
          ووصف صغير لكل نموذج (سطرين كحد أقصى)، وشارات السياق والسعر والقدرات.
          لـ FreeLLMAPI: الكتالوج الكامل من /api/models (حي أو لقطة محفوظة). */}
      {modelsSheet && (() => {
        const p = getProvider(modelsSheet) || provider;
        const hasKey = !p.needsKey || (keys[p.id] || []).some((k) => k.status !== 'exhausted') || (p.id === 'freellmapi' && flKeys.some((k) => k.status !== 'exhausted'));
        const isFL = p.id === 'freellmapi';
        const catalogModels = isFL && flCatalog ? flCatalog.models : null;
        const staticRows = p.models.map((m) => ({ id: m, name: m, desc: modelDesc(p, m), contextLabel: '', tools: false, vision: p.supportsVision, providers: [p.name], providersCount: 1, price: '' }));
        const allRows = catalogModels || staticRows;
        const q = modelSearch.trim().toLowerCase();
        const rows = q ? allRows.filter((m) => (m.name + ' ' + m.id + ' ' + (m.providers || []).join(' ')).toLowerCase().includes(q)) : allRows;
        const cur = model || p.models[0];
        return (
          <>
            <div className="sheet-back" onClick={() => setModelsSheet(null)} aria-hidden="true" />
            <div className="sheet tall" role="dialog" aria-label={tt('models') + ' — ' + p.name}>
              <div className="sheet-grip" />
              <div className="sheet-head">
                <h2>🤖 {tt('models')} — {p.name}</h2>
                <button className="sidebar-close" style={{ display: 'inline-flex' }} onClick={() => setModelsSheet(null)} aria-label="إغلاق">✕</button>
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <input type="search" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder={tt('searchModels')} aria-label={tt('searchModels')} dir="auto" />
              </div>
              {isFL && (
                <div className="note blue" style={{ marginTop: 0 }}>
                  {flCatalogLoading ? 'جارٍ تحميل الكتالوج الكامل…' : flCatalog ? (
                    <>📚 {flCatalog.totalModels} نموذج · {flCatalog.totalEndpoints} نقطة نهاية · المصدر: {flCatalog.source === 'live' ? 'حي من freellmapi.co' : 'لقطة محفوظة'} (نسخة {flCatalog.version || '—'})<br />{tt('catalogNote')}</>
                  ) : 'تعذّر تحميل الكتالوج الكامل — تُعرض النماذج الأساسية فقط.'}
                </div>
              )}
              <div className="model-list">
                {rows.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>لا نتائج مطابقة لبحثك.</p>}
                {rows.map((m) => {
                  const on = cur === m.id;
                  return (
                    <button key={m.id} className={'model-row' + (on ? ' on' : '')} onClick={() => { setProviderId(p.id); setModel(m.id); setCompareOn(false); setModelsSheet(null); if (p.id === 'freellmapi' && !flKeys.length && m.id !== 'auto') setDrawer('freellmapi'); }}>
                      <span className="model-row-main">
                        <span className="model-row-name">{m.id === 'auto' ? 'auto — يختار الراوتر' : m.name}</span>
                        <span className="model-row-desc">{m.id === 'auto' ? 'يختار الراوتر أفضل نموذج متاح تلقائياً' : (m.desc || '')}</span>
                        <span className="model-row-meta">
                          {m.id !== 'auto' && <span dir="ltr" style={{ opacity: .75 }}>{m.id}</span>}
                          {m.contextLabel ? <span>سياق {m.contextLabel}</span> : null}
                          {m.providersCount > 1 ? <span>{m.providersCount} مزودين</span> : null}
                          {m.price ? <span>{m.price}</span> : null}
                          {m.tools ? <span className="mini-badge tools">🛠 أدوات</span> : null}
                          {m.vision ? <span className="mini-badge vision">👁 رؤية</span> : null}
                        </span>
                      </span>
                      <span className="model-row-tag">{m.id === 'auto' ? 'تلقائي' : hasKey ? (p.id === 'groq' ? 'الأسرع' : p.needsKey ? 'بمفتاحك' : 'مجاني') : 'يحتاج مفتاحاً'}</span>
                      {on && <span className="model-check">✓</span>}
                    </button>
                  );
                })}
              </div>
              <div className="note blue" style={{ marginTop: 12 }}>النقر على نموذج يختاره نموذج العمل للمحادثة فوراً. {p.needsKey && !hasKey ? 'هذا المزود يحتاج مفتاحاً — أضفه من «مدير المفاتيح» (كل مفتاح إضافي يدخل في التناوب التلقائي عند نفاد رصيد الأول).' : 'النماذج هنا هي أدوات المزود الفعلية — اختر منها ما يعمل به الموقع.'}</div>
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
              <h2>{drawer === 'keys' ? '🔑 ' + tt('keys') : drawer === 'freellmapi' ? '🚀 FreeLLMAPI — الراوتر المستضاف' : drawer === 'image' ? '🖼 ' + tt('imageGen') : drawer === 'video' ? '🎬 ' + tt('videoGen') : drawer === 'stats' ? '📊 ' + tt('stats') : drawer === 'pricing' ? '💎 ' + tt('pricing') : drawer === 'skills' ? '🎯 ' + tt('skills') : drawer === 'connections' ? '🌐 ' + tt('integrations') : drawer === 'agent' ? '🤖 ' + tt('agent') : drawer === 'live' ? '🔴 ' + tt('live') : '⚙️ ' + tt('settings')}</h2>
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
              <h3>خانات مفاتيح إضافية — 4 حسابات</h3>
              <p>أربع خانات جاهزة لمفاتيح موحدة إضافية (حساب {flKeys.length + 1} إلى حساب {flKeys.length + 4}) — كل مفتاح يُضاف هنا يدخل في التداول الدوري والتبديل التلقائي مع بقية المفاتيح.</p>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="field" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label>حساب {flKeys.length + i + 1} — مفتاح موحد جديد (freellmapi-…)</label>
                    <input type="password" value={flSlotValues[i] || ''} onChange={(e) => setFlSlotValues((p) => { const n = [...p]; n[i] = e.target.value; return n; })} placeholder="freellmapi-…" dir="ltr" />
                  </div>
                  <button className="btn small" onClick={() => addFlKey(flSlotValues[i] || '', i)} disabled={!(flSlotValues[i] || '').trim()}>إضافة</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
              <p>بمفتاح محفوظ: Nano Banana 2 (Google) أو DALL·E 3 أو FLUX بجودة عالية. بدون مفتاح: Cloudflare Workers AI المجاني (FLUX — يحتاج إعداداً مرة واحدة في Vercel)، أو Puter بحساب مجاني، أو مساحة FLUX.1-schnell مفتوحة المصدر (قد تنتظر في الطابور). الوصف العربي يُترجم تلقائياً إلى الإنجليزية قبل التوليد. لتعديل صورة موجودة: أرفق صورة مرجعية واكتب ما تريد تغييره.</p>
              <div className="field"><label>وصف الصورة</label><textarea value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)} rows={3} placeholder="مدينة مستقبلية عند الغروب، أسلوب سينمائي…" /></div>
              <div className="field"><label>{tt('refImage')} — {tt('attachRefImage')}</label>
                {imgRefPreview ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <img src={imgRefPreview} alt="مرجعية" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--border)' }} />
                    <button className="btn ghost small" onClick={() => { setImgRefFile(null); setImgRefPreview(''); }}>{tt('removeRefImage')}</button>
                  </div>
                ) : (
                  <button className="btn ghost small" onClick={() => imgRefInputRef.current?.click()}>📷 {tt('attachRefImage')}</button>
                )}
                <input ref={imgRefInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) { setImgRefFile(f); const r = new FileReader(); r.onload = () => setImgRefPreview(String(r.result)); r.readAsDataURL(f); } e.target.value = ''; }} />
              </div>
              {imgRefFile && (<>
                <div className="field"><label>{tt('editStrength')}: {imgEditGuidance}</label><input type="range" min="1" max="10" step="0.5" value={imgEditGuidance} onChange={(e) => setImgEditGuidance(Number(e.target.value))} /></div>
                <div className="field"><label>{tt('editQuality')}: {imgEditSteps} خطوة</label><input type="range" min="4" max="50" step="1" value={imgEditSteps} onChange={(e) => setImgEditSteps(Number(e.target.value))} /></div>
                <div className="note blue">تعديل الصورة المرجعية عبر Qwen Image Edit — مجاني بدون حساب (Hugging Face ZeroGPU، حصة يومية صغيرة لكل زائر).</div>
              </>)}
              <div className="field"><label>نموذج الصور</label><select value={imgPreferred} onChange={(e) => setImgPreferred(e.target.value)}>
                <option value="auto">تلقائي — الأفضل المتاح بمفاتيحك</option>
                <option value="qwen-edit">Qwen Image Edit — تعديل صورة مرجعية (مجاني، Hugging Face)</option>
                <option value="puter">Puter — مجاني بحساب Puter مجاني (FLUX)</option>
                <option value="nanobanana-2.1">Nano Banana 2.1 — الأحدث (مفتاح Gemini)</option>
                <option value="nanobanana">Nano Banana 2 (مفتاح Gemini)</option>
                <option value="nanobanana-pro">Nano Banana Pro — أعلى جودة (مفتاح Gemini)</option>
                <option value="dalle">DALL·E 3 (مفتاح OpenAI)</option>
                <option value="flux">FLUX (مفتاح Together أو Hugging Face)</option>
              </select></div>
              <div className="field"><label>الحجم</label><select value={imgSize} onChange={(e) => setImgSize(e.target.value)}><option>1024x1024</option><option>1024x1792</option><option>1792x1024</option></select></div>
              <button className="btn" onClick={genImage} disabled={imgLoading}>{imgLoading ? 'جارٍ التوليد…' : 'توليد الصورة'}</button>
              {imgLoading && imgProgress && <div className="note blue">{imgProgress}</div>}
              {imgResult?.note && <div className="note blue">{imgResult.note}</div>}
              {imgResult?.error && <div className="note">{imgResult.error}</div>}
              {imgResult?.url && (<>
                <img className="gen" src={imgResult.url} alt={imgPrompt} />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <a className="btn ghost small" href={imgResult.url} download target="_blank" rel="noreferrer">⬇ تنزيل الصورة</a>
                  <button className="btn ghost small" onClick={() => copyText(imgResult.url, 'imgurl')}>{copied === 'imgurl' ? '✓ نُسخ الرابط' : 'نسخ رابط الصورة'}</button>
                </div>
                <p>تم التوليد عبر: {imgResult.via === 'huggingface-space' ? 'Hugging Face FLUX (مجاني بدون مفتاح)' : imgResult.via === 'qwen-edit' ? 'Qwen Image Edit (مجاني، Hugging Face)' : imgResult.via === 'freellmapi' ? 'FreeLLMAPI Router' : imgResult.via === 'gemini' ? 'Nano Banana (Google Gemini)' : imgResult.via === 'cloudflare' ? 'Cloudflare Workers AI FLUX (مجاني)' : imgResult.via === 'puter' ? 'Puter — مجاني بحساب Puter مجاني' : getProvider(imgResult.via).name}</p>
              </>)}
            </>)}

            {drawer === 'video' && (<>
              <p>فيديو حقيقي فقط — بلا فيديو وهمي أبداً. مجاناً بدون حساب: Wan 2.1 و LTX عبر Hugging Face (صورة مرجعية مطلوبة، حصة GPU يومية صغيرة لكل زائر). Puter مجاني بحساب Puter مجاني (Vidu / Wan — التوليد يُحسب على رصيدك الخاص)، أو Veo 3 و Seedance 2.5 بمفتاح fal.ai واحد (مدفوع حسب الاستخدام، بلا اشتراك)، أو Omni Flash بمفتاح Gemini المجاني. الفيديو يُولَّد في الخلفية وتظهر حالته هنا حتى يكتمل.</p>
              <div className="field"><label>وصف الفيديو</label><textarea value={vidPrompt} onChange={(e) => setVidPrompt(e.target.value)} rows={3} placeholder="موجة بحر تتحرك ببطء عند الفجر…" /></div>
              <div className="field"><label>النموذج</label><select value={vidProvider} onChange={(e) => setVidProvider(e.target.value)}>
                <option value="wan">Wan 2.1 Fast — مجاني بدون حساب (صورة → فيديو، حتى 3.4 ث)</option>
                <option value="ltx">LTX Video — مجاني بدون حساب (صورة → فيديو، حتى 8.5 ث)</option>
                <option value="puter">Puter — مجاني بحساب Puter مجاني (Vidu / Wan)</option>
                <option value="veo3">Veo 3 — سينمائي حتى 8 ثوانٍ بصوت (fal.ai)</option>
                <option value="seedance">Seedance 2.5 — حتى 30 ثانية، حتى 4K (fal.ai)</option>
                <option value="omni">Gemini Omni Flash — حتى 15 ثانية بصوت (Gemini)</option>
                <option value="replicate">Replicate</option>
                <option value="luma">Luma</option>
                <option value="runway">Runway</option>
              </select></div>
              {(vidProvider === 'puter' || vidProvider === 'wan' || vidProvider === 'ltx') && (<>
                <div className="field"><label>نسبة العرض</label><select value={vidAspect} onChange={(e) => setVidAspect(e.target.value)}><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option></select></div>
                <div className="field"><label>{tt('refImage')}{vidProvider !== 'puter' ? ' (مطلوبة)' : ' (اختيارية)'}</label>
                  {vidRefPreview ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <img src={vidRefPreview} alt="مرجعية" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--border)' }} />
                      <button className="btn ghost small" onClick={() => { setVidRefFile(null); setVidRefPreview(''); }}>{tt('removeRefImage')}</button>
                    </div>
                  ) : (
                    <button className="btn ghost small" onClick={() => vidRefInputRef.current?.click()}>📷 {tt('attachRefImage')}</button>
                  )}
                  <input ref={vidRefInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) { setVidRefFile(f); const r = new FileReader(); r.onload = () => setVidRefPreview(String(r.result)); r.readAsDataURL(f); } e.target.value = ''; }} />
                </div>
              </>)}
              {vidProvider === 'puter' && (<>
                <div className="field"><label>نموذج Puter</label><select value={vidPuterModel} onChange={(e) => setVidPuterModel(e.target.value)}>
                  <option value="togetherai:wan-ai/wan2.7-t2v">Wan 2.7 — مفتوح المصدر (افتراضي)</option>
                  <option value="byteplus/seedance-2.5">Seedance 2.5 — حتى 4K و15 ثانية</option>
                  <option value="veo-3.1-lite-generate-preview">Veo 3.1 Lite — سينمائي (Gemini)</option>
                  <option value="vidu/vidu-q3-turbo">Vidu Q3 Turbo — حتى 16 ثانية</option>
                </select></div>
                <div className="field"><label>المدة (ثوانٍ)</label><select value={vidPuterSeconds} onChange={(e) => setVidPuterSeconds(e.target.value)}><option value="4">4</option><option value="5">5</option><option value="8">8</option><option value="10">10</option></select></div>
                <div className="note blue">{tt('puterVideoNote')}</div>
              </>)}
              {vidProvider === 'wan' && (<>
                <div className="field"><label>المدة: {vidFreeDuration} ثانية (حتى 3.4)</label><input type="range" min="0.5" max="3.4" step="0.1" value={vidFreeDuration} onChange={(e) => setVidFreeDuration(Number(e.target.value))} /></div>
                <div className="field"><label>{tt('videoQuality')}: {vidFreeSteps} خطوة</label><input type="range" min="4" max="30" step="1" value={vidFreeSteps} onChange={(e) => setVidFreeSteps(Number(e.target.value))} /></div>
                <div className="field"><label>وصف سلبي (اختياري)</label><input value={vidNegPrompt} onChange={(e) => setVidNegPrompt(e.target.value)} placeholder="blurry, low quality…" dir="ltr" /></div>
                <div className="note blue">{tt('freeVideoNote')}</div>
              </>)}
              {vidProvider === 'ltx' && (<>
                <div className="field"><label>المدة: {vidFreeDuration} ثانية (حتى 8.5)</label><input type="range" min="0.5" max="8.5" step="0.5" value={vidFreeDuration} onChange={(e) => setVidFreeDuration(Number(e.target.value))} /></div>
                <div className="field"><label>وصف سلبي (اختياري)</label><input value={vidNegPrompt} onChange={(e) => setVidNegPrompt(e.target.value)} placeholder="worst quality, blurry…" dir="ltr" /></div>
                <div className="note blue">{tt('freeVideoNote')}</div>
              </>)}
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
              {vidLoading && vidProgress && <div className="note blue">{vidProgress}</div>}
              {vidJob && (
                <div className="note blue" style={{ marginTop: 12 }}>
                  {vidJob.status === 'queued' && <>🎬 المهمة قيد التوليد عبر {vidJob.model || vidJob.provider}… {vidJob.progress || 'قد تستغرق 1–3 دقائق. سأعرض الفيديو هنا فور اكتماله.'}</>}
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
                <div className="key-row"><span style={{ flex: 1 }}>📁 رفع ملفات وتحليلها</span><span>ملفات نصية وPDF — نصها يُستخرج في متصفحك (الصور تُصغَّر قبل الإرسال للنموذج)</span></div>
                <div className="key-row"><span style={{ flex: 1 }}>📋 نسخ وتصدير</span><span>نسخ أي رد من زر النسخ تحته، أو تصدير الجلسة .md / .json من الإعدادات</span></div>
              </div>
              <h3>الخطة والحدود</h3>
              <p>خطتك الحالية: <b>{planInfo.name}</b> — حد اليوم {formatTokens(planInfo.limit)} توكن، {planInfo.images} صورة، {planInfo.videos} فيديو، {planInfo.compares} مقارنة، {planInfo.deeps} تفكير عميق.</p>
              <p>متبقٍ اليوم: <b>{formatTokens(remaining)}</b> توكن · {Math.max(0, planInfo.images - daily.images)} صورة · {Math.max(0, planInfo.videos - daily.videos)} فيديو · {Math.max(0, planInfo.compares - daily.compares)} مقارنة · {Math.max(0, planInfo.deeps - daily.deeps)} تفكير عميق.</p>
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
                    <div className="pay-limits">{formatTokens(p.limit)} توكن/يوم · {p.images} صورة/يوم · {p.videos} فيديو/يوم · {p.compares} مقارنة/يوم · {p.deeps} تفكير عميق/يوم</div>
                    {plan === id ? <div className="badge" style={{ marginTop: 8 }}>خطتك الحالية</div>
                      : id === 'free' ? <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => { changePlan('free'); try { localStorage.setItem('omni_plan', 'free'); } catch {} }}>اختيار المجانية</button>
                      : <button className="btn small" style={{ marginTop: 8 }} onClick={() => openPay(id)}>شراء بـ USDT</button>}
                  </div>
                ))}
              </div>
              <div className="note">الخطة المجانية: 500 ألف توكن/يوم تقديرياً عبر المزودين المجانيين، 10 صور/يوم، 2 فيديو/يوم، 20 مقارنة/يوم، 10 تفكير عميق/يوم. الحدود تُحسب من تقدير التوكنات المحلي ومن usage المزود عند توفره. عداد الاستخدام محلي في متصفحك (localStorage) وليس فوترة خادم. التحقق من الدفع يقرأ سلسلة TRON مباشرة — لا نطلب مفتاحك الخاص أبداً.</div>
            </>)}

            {drawer === 'skills' && (<>
              <p>المهارات المفعّلة تُضاف إلى تعليمات النموذج في كل رسالة — فعّل مهارة أو أكثر ثم أرسل سؤالك. المهارات مفاتيح توجيه للنموذج، ليست برامج سحرية: لا تجلب بيانات جديدة بنفسها، بل تغيّر طريقة إجابة النموذج.</p>
              <div className="skill-list">
                {BUILTIN_SKILLS.map((sk) => {
                  const on = activeSkills.includes(sk.id);
                  return (
                    <div key={sk.id} className="skill-row" onClick={() => toggleSkill(sk.id)} role="button" tabIndex={0}>
                      <span className="tool-icon">{sk.icon}</span>
                      <span className="tool-text"><b>{sk.name}</b><small>{sk.desc}</small></span>
                      <span className={'switch' + (on ? ' on' : '')}><i /></span>
                    </div>
                  );
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
              <p>{tt('integrationsIntro')}</p>
              {INTEGRATIONS.map((svc) => (
                <div key={svc.id} className="hub-card">
                  <div className="hub-head">
                    <span className="tool-icon">{svc.icon}</span>
                    <span className="tool-text"><b>{svc.name}</b><small>{svc.canDo}</small></span>
                    {connStatus[svc.id] === 'ok' && <span className="badge">✓ {tt('connected')}</span>}
                    {connStatus[svc.id] === 'fail' && <span className="badge exhausted">{tt('notConnected')}</span>}
                    {svc.notReady && <span className="badge">قريباً</span>}
                  </div>
                  <p className="hub-hint">{svc.hint}</p>
                  {svc.id === 'gmail' && <div className="note">{tt('gmailScopeNote')}</div>}
                  <div className="field"><input type="password" value={conn[svc.id] || ''} onChange={(e) => setConn((p) => ({ ...p, [svc.id]: e.target.value }))} placeholder="الصق التوكن هنا…" dir="ltr" autoComplete="off" /></div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn ghost small" onClick={() => testConnection(svc.id)} disabled={connStatus[svc.id] === 'testing'}>{connStatus[svc.id] === 'testing' ? 'جارٍ الاختبار…' : '🔗 ' + tt('testConnection')}</button>
                    {conn[svc.id] && <button className="btn danger small" onClick={() => { setConn((p) => ({ ...p, [svc.id]: '' })); setConnStatus((p) => ({ ...p, [svc.id]: undefined })); }}>حذف التوكن</button>}
                  </div>
                </div>
              ))}
              {connMsg && <div className="note blue">{connMsg}</div>}
              <div className="note">اسأل في المحادثة وسيُجلب السياق تلقائياً قبل الرد — مثال: «اعرض مشاريعي في Vercel» أو «ما مستودعاتي في GitHub؟» أو «ما صفحاتي على فيسبوك؟».</div>
            </>)}

            {drawer === 'agent' && (<>
              <p>{tt('agentIntro')}</p>
              <div className="note">{tt('agentHonestNote')}</div>
              <div className="field"><label>{tt('agentStart')}</label>
                <textarea value={agentTaskInput} onChange={(e) => setAgentTaskInput(e.target.value)} rows={3} placeholder="مثال: ابحث عن أفضل طريقة لتعلم الإنجليزية ولخّصها في 5 نقاط… أو: جهّز لي صورة غلاف لموقعي…" />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => { if (!agentTaskInput.trim()) return; setDrawer(null); runAgentTask(agentTaskInput); }} disabled={agentRunning || !agentTaskInput.trim()}>{agentRunning ? tt('jobRunning') : '🤖 ' + tt('runAgent')}</button>
                <button className={'btn ghost' + (agentOn ? '' : '')} onClick={() => setAgentOn((v) => !v)}>{agentOn ? 'وضع الوكيل مفعّل ✓ — اضغط لإيقافه' : 'تفعيل وضع الوكيل في صندوق الكتابة'}</button>
              </div>
              {agentMsg && <div className="note blue">{agentMsg}</div>}
              <h3>{tt('agentInstructions')}</h3>
              <div className="field"><textarea value={agentCfg.instructions} onChange={(e) => setAgentCfg((p) => ({ ...p, instructions: e.target.value }))} rows={3} placeholder="مثال: أجب دائماً بالعربية الفصحى البسيطة، واذكر مصادرك، ولا تخترع أرقاماً…" /></div>
              <h3>{tt('agentTools')}</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { id: 'chat', label: '💬 محادثة' }, { id: 'image', label: '🖼 صور' }, { id: 'video', label: '🎬 فيديو' }, { id: 'web', label: '🌐 جلب ويب' }, { id: 'integrations', label: '🔗 التكاملات' }
                ].map((t) => (
                  <button key={t.id} className={'cmp-chip' + (agentCfg.tools[t.id] ? ' on' : '')} onClick={() => setAgentCfg((p) => ({ ...p, tools: { ...p.tools, [t.id]: !p.tools[t.id] } }))}>{t.label}</button>
                ))}
              </div>
              <h3>{tt('agentMemory')}</h3>
              <p style={{ fontSize: 12.5 }}>هكذا «تدرّب» وكيلك: أضف دروساً وأمثلة من مهامه السابقة، فيتذكرها ويطبّقها في المهام القادمة. ذاكرته تُحفظ في متصفحك فقط.</p>
              {(!agentCfg.memory || agentCfg.memory.length === 0) ? <p>{tt('agentNoMemory')}</p> : agentCfg.memory.map((m, mi) => (
                <div key={mi} className="key-row">
                  <span style={{ flex: 1 }}>📝 {m}</span>
                  <button className="btn danger small" onClick={() => setAgentCfg((p) => ({ ...p, memory: p.memory.filter((_, x) => x !== mi) }))}>حذف</button>
                </div>
              ))}
              <div className="field" style={{ display: 'flex', gap: 8 }}>
                <input style={{ flex: 1 }} value={newMemory} onChange={(e) => setNewMemory(e.target.value)} placeholder={tt('agentMemoryPlaceholder')} />
                <button className="btn small" onClick={() => { if (!newMemory.trim()) return; setAgentCfg((p) => ({ ...p, memory: [...(p.memory || []), newMemory.trim()] })); setNewMemory(''); }}>{tt('agentAddMemory')}</button>
              </div>
              <h3>{tt('agentHistory')}</h3>
              {(!agentCfg.history || agentCfg.history.length === 0) ? <p>{tt('agentNoHistory')}</p> : agentCfg.history.map((h, hi) => (
                <div key={hi} className="key-row">
                  <span style={{ flex: 1 }}>🤖 {h.task}</span>
                  <span className={'badge ' + (h.status === 'done' ? '' : 'exhausted')}>{h.status === 'done' ? tt('jobDone') : tt('jobFailed')}</span>
                  <small style={{ color: 'var(--muted)' }}>{h.at ? new Date(h.at).toLocaleString('ar') : ''}</small>
                </div>
              ))}

              {/* إعدادات الوكيل الخاصة (v2.2) — البرومبت النظامي، الموجّه، حقول الطلب، مخزن الأدوات، المعرفة، الأمان، السجل، المفاتيح */}
              <h3 className="agent-sec">📜 {tt('agentSysPrompt')}</h3>
              <p style={{ fontSize: 12.5 }}>{tt('agentSysPromptNote')}</p>
              <div className="field"><textarea value={agentCfg.systemPrompt || ''} onChange={(e) => setAgentCfg((p) => ({ ...p, systemPrompt: e.target.value.slice(0, 20000) }))} rows={4} dir="ltr" placeholder="You are CHIBANI AI Agent…" /></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                <span className={'char-count' + ((agentCfg.systemPrompt || '').length > 8000 ? ' warn' : '')}>{(agentCfg.systemPrompt || '').length} {tt('agentChars')}</span>
                {(agentCfg.systemPrompt || '').length > 8000 && <span className="char-count warn">⚠ {tt('agentCharsWarn')}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn ghost small" onClick={exportAgentConfig}>⬇ {tt('agentExport')}</button>
                <label className="btn ghost small" style={{ cursor: 'pointer' }}>⬆ {tt('agentImport')}<input type="file" accept=".json" style={{ display: 'none' }} onChange={importAgentConfig} /></label>
                <button className="btn ghost small" onClick={() => { setAgentCfg((p) => ({ ...p, systemPrompt: DEFAULT_SYSTEM_PROMPT })); setAgentMsg('✓ أُعيد البرومبت الافتراضي.'); }}>{tt('agentResetPrompt')}</button>
                <button className="btn ghost small" onClick={() => copyText(agentCfg.systemPrompt || '', 'agent-prompt')}>{copied === 'agent-prompt' ? '✓ تم النسخ' : '📋 نسخ البرومبت'}</button>
              </div>

              <h3 className="agent-sec">🌡 {tt('agentRouter')}</h3>
              <p style={{ fontSize: 12.5 }}>{tt('agentRouterNote')}</p>
              <label className="cmp-chip" style={{ cursor: 'pointer', marginBottom: 8 }}><input type="checkbox" checked={agentCfg.router?.enabled !== false} onChange={(e) => setAgentCfg((p) => ({ ...p, router: { ...p.router, enabled: e.target.checked } }))} /> {tt('agentRouter')}</label>
              <div className="agent-grid">
                <div className="field"><label>{tt('agentBandCold')}</label><input type="number" step="0.05" min="0" max="2" value={agentCfg.router?.cold ?? 0.2} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, router: { ...p.router, cold: v } })); }} /></div>
                <div className="field"><label>{tt('agentBandWarm')}</label><input type="number" step="0.05" min="0" max="2" value={agentCfg.router?.warm ?? 0.6} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, router: { ...p.router, warm: v } })); }} /></div>
                <div className="field"><label>{tt('agentBandHot')}</label><input type="number" step="0.05" min="0" max="2" value={agentCfg.router?.hot ?? 0.95} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, router: { ...p.router, hot: v } })); }} /></div>
              </div>
              <div className="field"><label>{tt('agentColdWords')}</label><textarea value={(agentCfg.router?.coldWords || []).join(', ')} onChange={(e) => setAgentCfg((p) => ({ ...p, router: { ...p.router, coldWords: e.target.value.split(',').map((w) => w.trim()).filter(Boolean) } }))} rows={2} dir="ltr" /></div>
              <div className="field"><label>{tt('agentHotWords')}</label><textarea value={(agentCfg.router?.hotWords || []).join(', ')} onChange={(e) => setAgentCfg((p) => ({ ...p, router: { ...p.router, hotWords: e.target.value.split(',').map((w) => w.trim()).filter(Boolean) } }))} rows={2} dir="ltr" /></div>
              <div className="field"><label>{tt('agentRouterTest')}</label>
                <input value={agentTestText} onChange={(e) => setAgentTestText(e.target.value)} placeholder={tt('agentRouterTestPh')} />
                {agentTestText.trim() ? (() => { const r = routeTemperature(agentTestText, { bands: { cold: agentCfg.router?.cold ?? 0.2, warm: agentCfg.router?.warm ?? 0.6, hot: agentCfg.router?.hot ?? 0.95 }, coldWords: agentCfg.router?.coldWords, hotWords: agentCfg.router?.hotWords }); return <div style={{ marginTop: 6, fontSize: 13 }}>{tt('agentTempIs')} <b>{r.temperature}</b> ({r.band === 'cold' ? tt('agentBandCold') : r.band === 'hot' ? tt('agentBandHot') : tt('agentBandWarm')})</div>; })() : null}
              </div>

              <h3 className="agent-sec">⚙️ {tt('agentRequest')}</h3>
              <div className="agent-grid">
                <div className="field"><label>{tt('agentModel')}</label><input value={agentCfg.request?.model || ''} onChange={(e) => setAgentCfg((p) => ({ ...p, request: { ...p.request, model: e.target.value.slice(0, 120) } }))} dir="ltr" placeholder={model || '—'} /></div>
                <div className="field"><label>{tt('agentMaxTokens')}</label><input type="number" step="256" min="256" max="32000" value={agentCfg.request?.maxTokens ?? 4096} onChange={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, request: { ...p.request, maxTokens: v } })); }} /></div>
                <div className="field"><label>top_p</label><input type="number" step="0.05" min="0.01" max="1" value={agentCfg.request?.topP ?? 0.95} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, request: { ...p.request, topP: v } })); }} /></div>
                <div className="field"><label>presence_penalty</label><input type="number" step="0.1" min="-2" max="2" value={agentCfg.request?.presencePenalty ?? 0.1} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, request: { ...p.request, presencePenalty: v } })); }} /></div>
                <div className="field"><label>frequency_penalty</label><input type="number" step="0.1" min="-2" max="2" value={agentCfg.request?.frequencyPenalty ?? 0.2} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, request: { ...p.request, frequencyPenalty: v } })); }} /></div>
                <div className="field"><label>{tt('agentStop')}</label><input value={agentCfg.request?.stop || ''} onChange={(e) => setAgentCfg((p) => ({ ...p, request: { ...p.request, stop: e.target.value.slice(0, 200) } }))} dir="ltr" placeholder="###, END" /></div>
                <div className="field"><label>{tt('agentSeed')}</label><input value={agentCfg.request?.seed || ''} onChange={(e) => setAgentCfg((p) => ({ ...p, request: { ...p.request, seed: e.target.value.replace(/[^0-9-]/g, '').slice(0, 20) } }))} dir="ltr" inputMode="numeric" placeholder="—" /></div>
                <div className="field"><label>reasoning_effort</label><select value={agentCfg.request?.reasoningEffort || ''} onChange={(e) => setAgentCfg((p) => ({ ...p, request: { ...p.request, reasoningEffort: e.target.value } }))}><option value="">— {tt('agentAuto')} —</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></div>
                <div className="field"><label>{tt('agentResponseFormat')}</label><select value={agentCfg.request?.responseFormat || 'text'} onChange={(e) => setAgentCfg((p) => ({ ...p, request: { ...p.request, responseFormat: e.target.value } }))}><option value="text">{tt('agentText')}</option><option value="json_object">JSON (json_object)</option></select></div>
              </div>

              <h3 className="agent-sec">🧰 {tt('agentToolsStore')}</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {TOOLS_STORE.map((tool) => {
                  const on = ['chat', 'image', 'video', 'web'].includes(tool.id) ? !!agentCfg.tools?.[tool.id] : !!agentCfg.tools?.integrations;
                  return <button key={tool.id} className={'cmp-chip' + (on ? ' on' : '')} onClick={() => setAgentCfg((p) => ({ ...p, tools: ['chat', 'image', 'video', 'web'].includes(tool.id) ? { ...p.tools, [tool.id]: !p.tools[tool.id] } : { ...p.tools, integrations: !p.tools.integrations } }))}>{tool.name}</button>;
                })}
              </div>
              {TOOLS_STORE.map((tool) => (
                <details key={tool.id} style={{ marginBottom: 6 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13.5 }}><b>{tool.name}</b> · {tool.desc} · ⏱ {tool.timeoutSec}ث</summary>
                  <pre className="schema-box">{JSON.stringify(tool.schema, null, 2)}</pre>
                </details>
              ))}
              <div className="agent-grid" style={{ marginTop: 8 }}>
                <div className="field"><label>tool_choice</label><select value={agentCfg.agent?.toolChoice || 'auto'} onChange={(e) => setAgentCfg((p) => ({ ...p, agent: { ...p.agent, toolChoice: e.target.value } }))}><option value="auto">auto</option><option value="none">none ({tt('agentDirectOnly')})</option></select></div>
                <div className="field"><label>{tt('agentMaxSteps')}</label><input type="number" min="1" max="15" value={agentCfg.agent?.maxSteps ?? 10} onChange={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, agent: { ...p.agent, maxSteps: v } })); }} /></div>
                <div className="field"><label>{tt('agentMaxCalls')}</label><input type="number" min="1" max="10" value={agentCfg.agent?.maxCallsPerTool ?? 3} onChange={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, agent: { ...p.agent, maxCallsPerTool: v } })); }} /></div>
              </div>
              <label className="cmp-chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={agentCfg.agent?.parallelToolCalls !== false} onChange={(e) => setAgentCfg((p) => ({ ...p, agent: { ...p.agent, parallelToolCalls: e.target.checked } }))} /> {tt('agentParallel')}</label>
              <p style={{ fontSize: 12.5 }}>البث (stream) مفعّل دائماً للوكيل — بدونه تتكدس النبضات ولا يظهر التقدم لحظة بلحظة.</p>

              <h3 className="agent-sec">📚 {tt('agentKnowledge')}</h3>
              <p style={{ fontSize: 12.5 }}>{tt('agentKnowledgeNote')}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <label className="btn ghost small" style={{ cursor: 'pointer' }}>⬆ {tt('agentUploadRef')}<input type="file" multiple accept=".txt,.md,.json" style={{ display: 'none' }} onChange={(e) => addKnowledgeFiles(e.target.files)} /></label>
              </div>
              {(!agentCfg.knowledge || agentCfg.knowledge.length === 0) ? <p>لا ملفات مرجعية بعد.</p> : agentCfg.knowledge.map((k) => (
                <div key={k.id} className="key-row">
                  <span style={{ flex: 1 }}>📄 {k.name} <small style={{ color: 'var(--muted)' }}>· {(k.text || '').length} حرف</small></span>
                  <button className="btn danger small" onClick={() => setAgentCfg((p) => ({ ...p, knowledge: p.knowledge.filter((x) => x.id !== k.id) }))}>حذف</button>
                </div>
              ))}

              <h3 className="agent-sec">🛡 {tt('agentSafety')}</h3>
              <div className="field"><label>{tt('agentWhitelist')}</label><textarea value={(agentCfg.safety?.whitelist || []).join('\n')} onChange={(e) => setAgentCfg((p) => ({ ...p, safety: { ...p.safety, whitelist: e.target.value.split('\n').map((w) => w.trim().toLowerCase()).filter(Boolean) } }))} rows={3} dir="ltr" /></div>
              <div className="agent-grid">
                <div className="field"><label>{tt('agentFetchChars')}</label><input type="number" step="500" min="500" max="8000" value={agentCfg.safety?.fetchChars ?? 3000} onChange={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, safety: { ...p.safety, fetchChars: v } })); }} /></div>
                <div className="field"><label>{tt('agentTimeout')}</label><input type="number" min="5" max="60" value={agentCfg.safety?.timeoutSec ?? 12} onChange={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) setAgentCfg((p) => ({ ...p, safety: { ...p.safety, timeoutSec: v } })); }} /></div>
              </div>

              <h3 className="agent-sec">📋 {tt('agentLog')}</h3>
              <div style={{ marginBottom: 8 }}><button className="btn ghost small" onClick={() => setAgentCfg((p) => ({ ...p, log: [] }))}>{tt('agentClearLog')}</button></div>
              {(!agentCfg.log || agentCfg.log.length === 0) ? <p>لا استدعاءات مسجلة بعد.</p> : (
                <div className="log-panel">
                  {agentCfg.log.map((l, li) => (
                    <div key={li} className="log-row">{l.status === 'done' ? '✓' : '✗'} <b>{l.tool}</b> — {l.label} <small style={{ color: 'var(--muted)' }}>{l.at ? new Date(l.at).toLocaleTimeString('ar') : ''}</small><br /><span style={{ color: 'var(--muted)' }}>{l.detail}</span></div>
                  ))}
                </div>
              )}

              <h3 className="agent-sec">🔑 {tt('agentKeys')}</h3>
              <p style={{ fontSize: 12.5 }}>{tt('agentKeysNote')}</p>
              <div className="field"><label>{tt('agentGroqKey')} {(keys.groq || []).length ? '· ✓ ' + keys.groq.length + ' محفوظ' : ''}</label>
                <div style={{ display: 'flex', gap: 8 }}><input style={{ flex: 1 }} type="password" value={agentNewKey.groq} onChange={(e) => setAgentNewKey((p) => ({ ...p, groq: e.target.value }))} dir="ltr" placeholder="gsk_…" autoComplete="off" /><button className="btn small" onClick={addAgentGroqKey}>إضافة</button></div>
              </div>
              <div className="field"><label>{tt('agentFlKey')} {flKeys.length ? '· ✓ ' + flKeys.length + ' محفوظ' : ''}</label>
                <div style={{ display: 'flex', gap: 8 }}><input style={{ flex: 1 }} type="password" value={agentNewKey.fl} onChange={(e) => setAgentNewKey((p) => ({ ...p, fl: e.target.value }))} dir="ltr" placeholder="freellmapi-…" autoComplete="off" /><button className="btn small" onClick={addAgentFlKey}>إضافة</button></div>
              </div>
              <div className="field"><label>{tt('agentCfToken')} {conn.cloudflare ? '· ✓ محفوظ' : ''}</label>
                <div style={{ display: 'flex', gap: 8 }}><input style={{ flex: 1 }} type="password" value={agentNewKey.cf} onChange={(e) => setAgentNewKey((p) => ({ ...p, cf: e.target.value }))} dir="ltr" placeholder="توكن Cloudflare API" autoComplete="off" /><button className="btn small" onClick={saveAgentCfToken}>حفظ</button></div>
              </div>
              <div className="field"><label>{tt('agentCfAccount')} {cfAccountId ? '· ✓ محفوظ' : ''}</label>
                <div style={{ display: 'flex', gap: 8 }}><input style={{ flex: 1 }} value={agentNewKey.cfAccount} onChange={(e) => setAgentNewKey((p) => ({ ...p, cfAccount: e.target.value }))} dir="ltr" placeholder="معرّف الحساب (Account ID)" autoComplete="off" /><button className="btn small" onClick={saveAgentCfAccount}>حفظ</button></div>
              </div>

              <h3 className="agent-sec">💾 {tt('agentStore')}</h3>
              <label className="cmp-chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={agentCfg.agent?.storeHistory !== false} onChange={(e) => setAgentCfg((p) => ({ ...p, agent: { ...p.agent, storeHistory: e.target.checked } }))} /> {tt('agentStore')}</label>
              <p style={{ fontSize: 12.5 }}>{tt('agentSessionId')}: <code dir="ltr">{agentCfg.sessionId || '—'}</code> · {tt('agentMetadataNote')}</p>
            </>)}

            {drawer === 'live' && (<>
              <p>{tt('liveNote')}</p>
              <h3>{tt('createJob')}</h3>
              <div className="field"><label>{tt('jobType')}</label>
                <select value={jobType} onChange={(e) => setJobType(e.target.value)}>
                  {JOB_TYPES.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div className="field"><label>{tt('jobTitle')}</label><input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder={jobTypeById(jobType).titlePlaceholder} /></div>
              <div className="field"><label>{tt('jobPrompt')}</label><textarea value={jobPrompt} onChange={(e) => setJobPrompt(e.target.value)} rows={3} placeholder={jobTypeById(jobType).promptPlaceholder} /></div>
              <button className="btn" onClick={createJob} disabled={jobBusy}>{jobBusy ? 'جارٍ الإنشاء…' : '🔴 ' + tt('createJob')}</button>
              {jobMsg && <div className="note blue" style={{ marginTop: 10 }}>{jobMsg}</div>}
              <p style={{ fontSize: 12.5 }}>{tt('liveCreateNote')}</p>
              <h3>{tt('liveJobs')} {jobs.filter((j) => j.status === 'queued' || j.status === 'running').length ? '· ' + jobs.filter((j) => j.status === 'queued' || j.status === 'running').length + ' ' + tt('jobRunning') : ''}</h3>
              <div style={{ marginBottom: 10 }}><button className="btn ghost small" onClick={refreshJobs}>↻ {tt('jobRefresh')}</button></div>
              {jobs.length === 0 ? <p>لا مهام بعد — أنشئ أول مهمة خلفية من الأعلى.</p> : jobs.map((j) => (
                <div key={j.id} className="job-card">
                  <div className="job-head">
                    <span>{jobTypeById(j.type).icon} <b>{j.title}</b></span>
                    <span className={'badge ' + (j.status === 'done' ? 'ok' : j.status === 'failed' ? 'fail' : 'running')}>{jobStatusLabel(j.status, tt)}</span>
                  </div>
                  <div className="job-progress"><i style={{ width: Math.min(100, j.progress || 0) + '%' }} /></div>
                  {j.steps && j.steps.length > 0 && <div className="job-steps">{j.steps.map((s, si) => <div key={si}>{s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : '⏳'} {s.label}</div>)}</div>}
                  {j.status === 'done' && j.result && (
                    <div className="job-result">
                      {String(j.result).slice(0, 600)}{String(j.result).length > 600 ? '…' : ''}
                      <div className="msg-actions"><button onClick={() => openBrowserWin({ kind: 'md', code: j.result })}>{tt('viewResult')}</button></div>
                    </div>
                  )}
                  {j.status === 'failed' && j.error && <div className="note">⚠️ {String(j.error).slice(0, 200)}</div>}
                  <div className="msg-actions">
                    {j.runUrl && <a className="btn ghost small" href={j.runUrl} target="_blank" rel="noreferrer">{tt('openActionsRun')}</a>}
                    <button className="btn danger small" onClick={() => setJobs((p) => p.filter((x) => x.id !== j.id))}>حذف</button>
                  </div>
                </div>
              ))}
            </>)}

            {drawer === 'settings' && (<>
              <h3>{tt('language')}</h3>
              <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={tt('language')}>
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
              </select>
              <h3>{tt('starsBg')}</h3>
              <label className="cmp-chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={starsOn} onChange={(e) => setStarsOn(e.target.checked)} /> {tt('starsBg')}</label>
              <p style={{ fontSize: 12.5 }}>نجوم ذهبية خافتة متحركة خلف الواجهة. تُطفأ تلقائياً عند تفعيل «تقليل الحركة» في جهازك.</p>
              <h3>{tt('portraitBg')}</h3>
              <label className="cmp-chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={portraitOn} onChange={(e) => setPortraitOn(e.target.checked)} /> {tt('portraitBg')}</label>
              <p style={{ fontSize: 12.5 }}>صورتك الشخصية خلفية خافتة جداً خلف المحادثة، فوقها طبقة داكنة والنجوم الذهبية — النص يبقى واضحاً تماماً. أطفئها إن أردت خلفية صافية.</p>
              <h3>{tt('plan')}</h3>
              <select value={plan} onChange={(e) => { changePlan(e.target.value); if (e.target.value === 'free') { try { localStorage.setItem('omni_plan', 'free'); } catch {} } }}>
                {Object.entries(PLANS).map(([id, p]) => <option key={id} value={id}>{p.name} — {p.price}</option>)}
              </select>
              <h3>💎 {tt('subscribe')}</h3>
              <p>خطتك الحالية: <b>{planInfo.name}</b> — {formatTokens(planInfo.limit)} توكن/يوم · {planInfo.images} صورة/يوم · {planInfo.videos} فيديو/يوم.{subscription && subscription.expiresAt > Date.now() ? ' اشتراكك صالح حتى ' + new Date(subscription.expiresAt).toLocaleDateString('ar') + '.' : ''}</p>
              <button className="btn" onClick={() => setDrawer('pricing')}>💎 {tt('subscribe')} — {tt('pricing')}</button>
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

      {/* نافذة المتصفح الداخلي العائمة (v1.9): متوسطة الحجم، قابلة للسحب وإعادة التحجيم، مع شريط عناوين
          v2.0: أنواع جديدة — 'code' (أي كود بأي لغة) و 'md' (محتوى Markdown مقروء). */}
      {browserWin && (
        <div className={'browser-win' + (browserWin.min ? ' min' : '')} style={{ left: browserWin.x, top: browserWin.y, width: browserWin.w, height: browserWin.min ? 'auto' : browserWin.h }} role="dialog" aria-label="متصفح داخلي">
          <div className="browser-win-head" onPointerDown={startBrowserDrag}>
            <span className="browser-win-title">{browserWin.kind === 'html' ? '👁 ' + tt('preview') + ' — HTML' : browserWin.kind === 'code' ? '⌨ ' + tt('codeFile') + ' — ' + (browserWin.lang || 'code') : browserWin.kind === 'md' ? '📄 Markdown' : '🌐 ' + (browserWin.url || '')}</span>
            {browserWin.kind !== 'url' && <button onClick={() => copyText(browserWin.code, 'preview-code')} aria-label={tt('copy')}>{copied === 'preview-code' ? '✓' : '📋'}</button>}
            <button onClick={() => setBrowserWin((b) => (b ? { ...b, min: !b.min } : b))} aria-label="تصغير">{browserWin.min ? '▢' : '—'}</button>
            <button onClick={() => setBrowserWin(null)} aria-label={tt('close')}>✕</button>
          </div>
          {!browserWin.min && (<>
            <div className="browser-win-bar">
              {browserWin.kind === 'url' && (<>
                <button disabled={browserWin.hIndex <= 0} onClick={() => bwStep(-1)} aria-label="رجوع">‹</button>
                <button disabled={browserWin.hIndex >= browserWin.hist.length - 1} onClick={() => bwStep(1)} aria-label="تقدّم">›</button>
                <button onClick={() => setBwReloadTick((t) => t + 1)} aria-label="إعادة تحميل">↻</button>
              </>)}
              {browserWin.kind === 'url' ? (
                <form onSubmit={(e) => { e.preventDefault(); bwGo(bwAddrRef.current?.value); }}>
                  <input ref={bwAddrRef} key={browserWin.url} defaultValue={browserWin.url} dir="ltr" aria-label="عنوان URL" />
                </form>
              ) : browserWin.kind === 'html' ? (
                <span className="browser-win-addr">HTML معزول (sandbox) — لا يصل إلى بيانات الموقع</span>
              ) : (
                <span className="browser-win-addr">معاينة داخل التطبيق — انسخ منها أو أغلقها متى شئت</span>
              )}
              {browserWin.kind === 'url' && <a className="btn ghost small" href={browserWin.url} target="_blank" rel="noreferrer">{tt('openInBrowser')}</a>}
            </div>
            {browserWin.kind === 'html' ? (
              <iframe key={'html-' + bwReloadTick} title="html-preview" className="browser-win-frame" sandbox="allow-scripts" srcDoc={browserWin.code} />
            ) : browserWin.kind === 'code' ? (
              <pre className="browser-win-code" dir="ltr">{browserWin.code}</pre>
            ) : browserWin.kind === 'md' ? (
              <div className="browser-win-md">{renderMd(browserWin.code, previewActions)}</div>
            ) : (
              <>
                <iframe key={browserWin.url + '-' + bwReloadTick} title="url-preview" className="browser-win-frame" sandbox="allow-scripts allow-forms allow-popups" src={browserWin.url} />
                <div className="browser-win-fallback">إن ظهرت الصفحة فارغة فالموقع يمنع العرض داخل إطار (X-Frame-Options) — <a href={browserWin.url} target="_blank" rel="noreferrer">{tt('openInBrowser')}</a></div>
              </>
            )}
          </>)}
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
              <li><b>الصقه في الموقع:</b> القائمة الجانبية ← «إعدادات FreeLLMAPI» ← «خانات مفاتيح إضافية» ← «اختبار كل المفاتيح». يُحفظ في متصفحك فقط. يمكنك إضافة مفاتيح موحدة من عدة حسابات — عند نفاد رصيد مفتاح ينتقل الموقع تلقائياً للمفتاح التالي.</li>
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
