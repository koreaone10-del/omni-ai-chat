// lib/jobs.js — مهام Live الخلفية (v2.1)
// المهمة تُعرَّف هنا، وتُشغَّل على GitHub Actions (مجاني: 2000 دقيقة/شهر)
// عبر repository_dispatch، ونتائجها تُكتب في فرع `jobs` في المستودع نفسه.
// المتصفح لا يشغّل المهمة — يسجّلها ويتابع حالتها فقط، فتستمر حتى لو أغلق المستخدم الإنترنت.
// حدود صادقة: كل تشغيل GitHub Actions بحد أقصى ~50 دقيقة؛ المهام الطويلة تُقسَّم.

export const JOB_TYPES = [
  {
    id: 'research',
    name: 'بحث معمّق',
    icon: '🔎',
    desc: 'بحث في موضوع من مصادر متعددة مع تقرير منظم وروابط',
    placeholder: 'مثال: ابحث في أحدث نماذج توليد الفيديو مفتوحة المصدر وقارن بينها'
  },
  {
    id: 'summary',
    name: 'تلخيص نص طويل',
    icon: '📝',
    desc: 'تلخيص نص تلصقه هنا في نقاط واضحة مع الأرقام والأسماء',
    placeholder: 'الصق النص الطويل هنا…'
  },
  {
    id: 'image',
    name: 'توليد صورة',
    icon: '🖼',
    desc: 'توليد صورة من وصفك عبر المسار المجاني (Cloudflare أو بديل)',
    placeholder: 'مثال: مدينة مستقبلية عند الغروب، بأسلوب سينمائي'
  },
  {
    id: 'code',
    name: 'كتابة صفحة ويب',
    icon: '💻',
    desc: 'كتابة صفحة HTML كاملة (مع CSS/JS) وحفظها كملف نتيجة',
    placeholder: 'مثال: صفحة هبوط لمطعم عربي بألوان دافئة وقائمة طعام'
  }
];

export function jobTypeById(id) {
  return JOB_TYPES.find((x) => x.id === id) || JOB_TYPES[0];
}

export function loadJobs() {
  try {
    const j = JSON.parse(localStorage.getItem('omni_jobs') || '[]');
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

export function saveJobs(jobs) {
  try { localStorage.setItem('omni_jobs', JSON.stringify(jobs.slice(0, 50))); } catch {}
}

// حالة المهمة: queued | running | done | failed
export function jobStatusLabel(status) {
  return { queued: 'في الانتظار', running: 'يعمل…', done: 'مكتمل ✓', failed: 'فشل ✗' }[status] || status;
}
