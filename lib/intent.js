// lib/intent.js — كشف نية المستخدم من نص الرسالة (عربي + إنجليزي + فرنسي)
// يوجّه الطلب تلقائياً إلى الأداة المناسبة بدل الرد النصي.
// اختيار صريح من ورقة "+" يفوز دائماً على الكشف التلقائي.
// قاعدة صارمة: طلب صورة لا يردّ عليه بنص أبداً — يولّد صورة أو يشرح بصراحة لماذا تعذّر.

// أسئلة تحليل صورة موجودة — ليست طلب توليد
const IMAGE_NEG = /(ما هذه الصورة|ما هذا في الصورة|صف (هذه )?الصورة|حلّل? (هذه )?الصورة|اشرح (هذه )?الصورة|ماذا (في|يوجد في) (هذه )?الصورة|what('s| is) (in|on) this (image|picture)|describe this (image|picture)|analyse (cette )?image|décris (cette )?image|qu'est-ce (qu'il y a )?sur (cette )?image|que vois-tu sur (cette )?image)/i;

const IMAGE_PATTERNS = [
  /(اريد|أريد|أبي|ابغى|اعطني|أعطني|عطني|انشئ|أنشئ|إنشئ|ولّد|ولد|توليد|اصنع|اعمل|سوّي|سوي|ارسم|ارسم لي|ارسملي|ترسم|ممكن)\s+(صورة|صور|رسمة|رسم)/i,
  /صورة\s+(ل|لـ|لِ|عن|من)\s+\S/i, // «صورة لطائرة» / «صورة عن مدينة»
  /صورة\s+هنا/i, // «اريد صورة هنا»
  /^\s*صورة\s*$/i, // كلمة «صورة» وحدها
  /generate (an? )?image|create (an? )?image|make (me )?(an? )?image|draw (me )?(a|an|the)?|image of|a picture of|show me (an? )?(image|picture) of|give me (an? )?(image|picture)/i,
  /crée(r)? une image|une image de|dessine|génère (une )?image|montre-moi une image|fais-moi une image/i
];

const VIDEO_PATTERNS = [
  /(اريد|أريد|انشئ|أنشئ|ولّد|ولد|توليد|اصنع|اعمل|ممكن)\s+(فيديو|مقطع فيديو|مقطع متحرك)/i,
  /فيديو\s+(ل|لـ|لِ|عن|من)\s+\S/i,
  /generate (a )?video|create (a )?video|make (a )?video|video of|a video of/i,
  /crée(r)? (une )?vidéo|une vidéo de|génère (une )?vidéo/i
];

const COMPARE_PATTERNS = /(قارن|مقارنة|مقارنه|قارن بين|compare|comparer|compare (les|entre|ces))/i;

const DEEP_PATTERNS = /(فكر بعمق|فكّر بعمق|تفكير عميق|اشرح بالتفصيل|حلل بعمق|حلل بالتفصيل|حلّل بعمق|think (deeply|step by step)|deep thinking|réfléchis (bien|profondément)|analyse en détail|explique en détail)/i;

// إزالة كلمات الطلب ليبقى وصف الصورة/الفيديو فقط
function stripTrigger(text, kind) {
  let p = String(text || '');
  if (kind === 'image') {
    p = p.replace(/(اريد|أريد|أبي|ابغى|اعطني|أعطني|عطني|انشئ|أنشئ|إنشئ|ولّد|ولد|توليد|اصنع|اعمل|سوّي|سوي|ارسم|ارسم لي|ارسملي|ترسم|ممكن)\s+(صورة|صور|رسمة|رسم)/gi, ' ');
    p = p.replace(/صورة\s+(ل|لـ|لِ|عن|من)/gi, ' ');
    p = p.replace(/صورة|صور|رسمة/gi, ' ');
    p = p.replace(/generate (an? )?image|create (an? )?image|make (me )?(an? )?image|draw (me )?(a|an|the)?|image of|a picture of|show me (an? )?(image|picture) of|give me (an? )?(image|picture)/gi, ' ');
    p = p.replace(/crée(r)? une image|une image de|dessine|génère (une )?image|montre-moi une image|fais-moi une image/gi, ' ');
  } else {
    p = p.replace(/(اريد|أريد|انشئ|أنشئ|ولّد|ولد|توليد|اصنع|اعمل|ممكن)\s+(فيديو|مقطع فيديو|مقطع متحرك)/gi, ' ');
    p = p.replace(/فيديو\s+(ل|لـ|لِ|عن|من)/gi, ' ');
    p = p.replace(/فيديو|مقطع فيديو|مقطع متحرك/gi, ' ');
    p = p.replace(/generate (a )?video|create (a )?video|make (a )?video|video of|a video of/gi, ' ');
    p = p.replace(/crée(r)? (une )?vidéo|une vidéo de|génère (une )?vidéo/gi, ' ');
  }
  p = p.replace(/\sهنا(?=\s|$)/g, ' ');
  p = p.replace(/[،,؛:]+/g, ' ').replace(/\s+/g, ' ').trim(); // تقليم أولاً لتعمل ^ على البداية الحقيقية
  // حروف جر عربية ملتصقة بلا مسافة («لطائرة» ← «طائرة»)، وإنجليزية/فرنسية في البداية
  p = p.replace(/^(ل|لل|عن|من|إلى|إلي|في|على|بـ|كـ|لـ)\s*/i, '');
  p = p.replace(/^(of|for|about|a|an|the|de|du|des|la|le|les|une|un|pour)\s+/i, '');
  p = p.replace(/^(of|for|about|a|an|the|de|du|des|la|le|les|une|un|pour)\s+/i, '');
  return p.replace(/[،,؛:]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// كشف النية: يرجع { type: 'image'|'video'|'compare'|'deep'|'chat', prompt }
export function detectIntent(text, opts = {}) {
  const t = String(text || '').trim();
  if (!t) return { type: 'chat', prompt: '' };
  // صورة مرفقة = تحليلها في المحادثة، وليس توليداً
  if (opts.hasImageAttachment) return { type: 'chat', prompt: t };
  if (IMAGE_NEG.test(t)) return { type: 'chat', prompt: t };
  if (IMAGE_PATTERNS.some((re) => re.test(t))) return { type: 'image', prompt: stripTrigger(t, 'image') };
  if (VIDEO_PATTERNS.some((re) => re.test(t))) return { type: 'video', prompt: stripTrigger(t, 'video') };
  if (COMPARE_PATTERNS.test(t)) return { type: 'compare', prompt: t };
  if (DEEP_PATTERNS.test(t)) return { type: 'deep', prompt: t };
  return { type: 'chat', prompt: t };
}

export const ROUTE_LABELS = {
  image: 'توليد صورة',
  video: 'توليد فيديو',
  compare: 'المقارنة',
  deep: 'التفكير العميق'
};
