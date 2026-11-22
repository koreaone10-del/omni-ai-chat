// lib/freellmapi-catalog.js — تجميع كتالوج FreeLLMAPI العام (freellmapi.co/assets/data.js)
// window.CATALOG_SNAPSHOT: لقطة فيها ~487 نقطة نهاية (نموذج × مزود) عبر 52 منصة.
// نجمّعها حسب عائلة النموذج (الاسم بعد حذف اللاحقة "(...)")، ونختار معرّفاً
// قانونياً واحداً لكل عائلة يصلح كـ model في طلب OpenAI-compatible.
// ملاحظة صادقة: القائمة كتالوج — توفّر النموذج فعلياً يعتمد على مفاتيح المزودين
// المضافة في لوحة الراوتر (الراوتر حالياً فيه مفتاح Groq فقط).

export function formatContext(n) {
  n = Number(n) || 0;
  if (!n) return '—';
  if (n >= 1000000) return parseFloat((n / 1000000).toFixed(2)) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

import vm from 'node:vm';

export function parseCatalogJs(text) {
  const src = String(text || '');
  const i = src.indexOf('window.CATALOG_SNAPSHOT');
  if (i < 0) return null;
  const start = src.indexOf('{', i);
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    // الملف حرفي بيانات JavaScript (مفاتيح بلا علامات + سلاسل بعلامة واحدة أحياناً)،
    // لا JSON صارماً — لذلك يُقيَّم في سياق vm معزول بلا process/require/fetch
    // ومهلة 5 ثوانٍ، ثم يُتحقق من شكله قبل استعماله. لا تنفيذ لكود بعيد في السياق الرئيسي أبداً.
    const snap = vm.runInNewContext('(' + src.slice(start, end + 1) + ')', Object.create(null), { timeout: 5000 });
    if (!snap || !Array.isArray(snap.models) || !snap.models.length) return null;
    if (!snap.models.every((m) => m && typeof m.modelId === 'string')) return null;
    return snap;
  } catch { return null; }
}

function familyName(displayName) {
  return String(displayName || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function pickCanonicalId(endpoints) {
  const ids = endpoints.map((e) => e.modelId).filter(Boolean);
  const free = ids.find((id) => id.endsWith(':free'));
  if (free) return free;
  const prefixed = ids.find((id) => id.includes('/') && !id.startsWith('@'));
  if (prefixed) return prefixed;
  return ids[0] || '';
}

export function groupCatalog(snapshot) {
  const raw = Array.isArray(snapshot) ? snapshot : (snapshot?.models || snapshot?.endpoints || []);
  const version = snapshot?.version || snapshot?.catalogVersion || null;
  const generatedAt = snapshot?.generatedAt || snapshot?.generated || null;
  const byFamily = new Map();
  for (const e of raw) {
    if (!e || e.enabled === false) continue;
    const name = familyName(e.displayName || e.modelId || '');
    if (!name) continue;
    const key = name.toLowerCase();
    let fam = byFamily.get(key);
    if (!fam) { fam = { name, endpoints: [] }; byFamily.set(key, fam); }
    fam.endpoints.push(e);
  }
  const models = [];
  for (const fam of byFamily.values()) {
    const eps = fam.endpoints;
    const canonicalId = pickCanonicalId(eps);
    const canonical = eps.find((e) => e.modelId === canonicalId) || eps[0];
    const platforms = [...new Set(eps.map((e) => e.platform).filter(Boolean))];
    const context = Math.max(0, ...eps.map((e) => Number(e.contextWindow) || 0));
    const tools = eps.some((e) => e.supportsTools);
    const vision = eps.some((e) => e.supportsVision);
    const budget = typeof canonical?.monthlyTokenBudget === 'string' ? canonical.monthlyTokenBudget : '';
    const rankList = eps.map((e) => Number(e.intelligenceRank) || 0).filter((n) => n > 0);
    const speedList = eps.map((e) => Number(e.speedRank) || 0).filter((n) => n > 0);
    const intelligenceRank = rankList.length ? Math.min(...rankList) : 0;
    const speedRank = speedList.length ? Math.min(...speedList) : 0;
    const sizeLabel = canonical?.sizeLabel || '';
    const descParts = [];
    if (platforms.length) descParts.push(platforms.join('، '));
    if (context) descParts.push('سياق ' + formatContext(context));
    if (tools) descParts.push('يدعم الأدوات');
    if (vision) descParts.push('رؤية');
    if (budget) descParts.push(String(budget));
    models.push({
      id: canonicalId,
      name: fam.name,
      providers: platforms,
      providersCount: platforms.length,
      endpoints: eps.length,
      context,
      contextLabel: formatContext(context),
      tools,
      vision,
      price: '$0',
      budget: String(budget || ''),
      sizeLabel: String(sizeLabel || ''),
      intelligenceRank,
      speedRank,
      desc: descParts.join(' · ') + ' · مجاني'
    });
  }
  // الأذكى أولاً (ثم الأسرع) — نفس الترتيب الافتراضي في freellmapi.co/models.
  // intelligenceRank ترتيب (1 = الأذكى)، لا نقاط — لذلك الترتيب تصاعدي،
  // والنماذج بلا ترتيب (0) تذهب إلى آخر القائمة.
  const rankOf = (m) => (m.intelligenceRank > 0 ? m.intelligenceRank : Infinity);
  const speedOf = (m) => (m.speedRank > 0 ? m.speedRank : Infinity);
  models.sort((a, b) => (rankOf(a) - rankOf(b)) || (speedOf(a) - speedOf(b)) || a.name.localeCompare(b.name));
  return { version, generatedAt, totalModels: models.length, totalEndpoints: raw.length, models };
}
