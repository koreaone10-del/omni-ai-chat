// lib/agent-router.js — موجّه حرارة الوكيل (v2.2)
// ترجمة حرفية لمنطق بايثون الذي أرسله المستخدم: نطاقات بارد/دافئ/ساخن
// حسب كلمات المهمة. القيم والكلمات قابلة للتعديل من إعدادات الوكيل.
// لا تضبط temperature وtop_p معاً بقيم متطرفة — top_p ثابت 0.95 هنا
// والحرارة وحدها تتحرك بين النطاقات.

export const DEFAULT_BANDS = { cold: 0.2, warm: 0.6, hot: 0.95 };

export const DEFAULT_COLD_WORDS = [
  'fix', 'bug', 'error', 'traceback', 'regex', 'config', 'install',
  'convert', 'calc', 'compile', 'patch', 'cve', 'exploit', 'offset', 'gadget'
];
export const DEFAULT_HOT_WORDS = [
  'idea', 'brainstorm', 'name', 'creative', 'story', 'strategy',
  'threat model', 'what if', 'alternatives', 'redesign'
];

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// يبني تعبيراً نمطياً من قائمة كلمات/عبارات (حدود كلمات حول كل عنصر،
// كما في نسخة بايثون الأصلية \b(...)\b).
export function buildWordRegex(words) {
  const list = (words || []).map((w) => String(w).trim()).filter(Boolean);
  if (!list.length) return null;
  const parts = list.map((w) => '\\b' + escapeRegExp(w) + '\\b');
  return new RegExp('(' + parts.join('|') + ')', 'i');
}

// النسخة الكاملة: ترجع الحرارة واسم النطاق.
export function routeTemperature(text, cfg = {}) {
  const bands = {
    cold: typeof cfg.bands?.cold === 'number' ? cfg.bands.cold : DEFAULT_BANDS.cold,
    warm: typeof cfg.bands?.warm === 'number' ? cfg.bands.warm : DEFAULT_BANDS.warm,
    hot: typeof cfg.bands?.hot === 'number' ? cfg.bands.hot : DEFAULT_BANDS.hot
  };
  const coldRe = buildWordRegex(cfg.coldWords || DEFAULT_COLD_WORDS);
  const hotRe = buildWordRegex(cfg.hotWords || DEFAULT_HOT_WORDS);
  const t = String(text || '').toLowerCase();
  const hasCold = coldRe ? coldRe.test(t) : false;
  const hasHot = hotRe ? hotRe.test(t) : false;
  if (hasCold && !hasHot) return { temperature: bands.cold, band: 'cold' };
  if (hasHot && !hasCold) return { temperature: bands.hot, band: 'hot' };
  return { temperature: bands.warm, band: 'warm' };
}

// الشكل البسيط المطابق لدالة بايثون route(text) -> float
export function route(text) {
  return routeTemperature(text).temperature;
}
