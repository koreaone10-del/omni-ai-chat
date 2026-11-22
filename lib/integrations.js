// lib/integrations.js — سجل التكاملات العالمية (v2.1، بأسلوب Perplexity)
// كل تكامل: ما يفعله، وما يحتاجه، وما يستطيع الموقع فعله به.
// التوكنات تُحفظ في متصفح المستخدم فقط (localStorage) وتُرسل إلى الخدمة نفسها فقط.
// صدق: Gmail غير متاح بعد — عميل Google OAuth الحالي بلا نطاق gmail.readonly،
// فيحتاج إضافة النطاق في Google Cloud + إعادة الموافقة؛ مسار API جاهز لذلك.

export const INTEGRATIONS = [
  {
    id: 'github',
    name: 'GitHub',
    icon: '🐙',
    kind: 'token',
    hint: 'Personal Access Token — من github.com/settings/tokens (صلاحية repo للقراءة)',
    canDo: 'عرض مستودعاتك وقراءة أي ملف منها داخل المحادثة',
    actions: ['listRepos', 'readFile'],
    setup: 'أنشئ توكناً من github.com/settings/tokens بصلاحية repo (قراءة فقط تكفي).'
  },
  {
    id: 'vercel',
    name: 'Vercel',
    icon: '▲',
    kind: 'token',
    hint: 'Token — من vercel.com/account/tokens',
    canDo: 'عرض مشاريعك ونشرها وحالتها داخل المحادثة',
    actions: ['listProjects'],
    setup: 'أنشئ توكناً من vercel.com/account/tokens.'
  },
  {
    id: 'render',
    name: 'Render',
    icon: '🎛',
    kind: 'token',
    hint: 'API Key — من dashboard.render.com/account/api-keys',
    canDo: 'عرض خدماتك وحالتها داخل المحادثة',
    actions: ['listServices'],
    setup: 'أنشئ مفتاح API من dashboard.render.com/account/api-keys.'
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    icon: '☁️',
    kind: 'token',
    hint: 'API Token — من dash.cloudflare.com/profile/api-tokens (قالب Workers AI أو صلاحية Account:Read)',
    canDo: 'التحقق من التوكن، عرض النطاقات وحسابك، وتوليد الصور عبر Workers AI',
    actions: ['test', 'listZones', 'account'],
    setup: 'أنشئ توكناً من لوحة Cloudflare — قالب «Workers AI» يكفي للصور، وأضف Account:Read للنطاقات.'
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: '📘',
    kind: 'token',
    hint: 'User Access Token — من developers.facebook.com (صلاحية pages_read_engagement)',
    canDo: 'عرض صفحاتك وأحدث منشورات كل صفحة داخل المحادثة',
    actions: ['listPages', 'listPosts'],
    setup: 'من Graph API Explorer في developers.facebook.com أنشئ توكن مستخدم بصلاحية pages_read_engagement.'
  },
  {
    id: 'gmail',
    name: 'Gmail',
    icon: '✉️',
    kind: 'oauth-scope',
    hint: 'يحتاج نطاق gmail.readonly في عميل Google OAuth — غير مضاف حالياً',
    canDo: 'قراءة رسائلك وعرض أحدثها (بعد إضافة النطاق وإعادة الموافقة)',
    actions: ['listMessages'],
    setup: 'في Google Cloud Console ← مشروع CHIBANI AI ← OAuth consent ← أضف النطاق https://www.googleapis.com/auth/gmail.readonly ثم سجّل خروجك ودخولك من جديد للموافقة عليه. مسار /api/connect جاهز لهذا النطاق.',
    notReady: true
  }
];

export function integrationById(id) {
  return INTEGRATIONS.find((x) => x.id === id) || null;
}

// خريطة الإجراء الافتراضي لكل تكامل عند «اختبار الاتصال».
export const INTEGRATION_TEST_ACTION = {
  github: 'listRepos',
  vercel: 'listProjects',
  render: 'listServices',
  cloudflare: 'test',
  facebook: 'listPages',
  gmail: 'listMessages'
};
