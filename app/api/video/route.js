import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/video — توليد فيديو حقيقي فقط عبر مزود مدفوع بمفتاح.
// لا يوجد توليد فيديو مجاني موثوق بدون مفتاح، لذلك لا نزيّف فيديو أبداً:
// بدون مفتاح نرجع needsKey مع شرح الخطوات.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'طلب غير صالح.' }, { status: 400 }); }
  const { prompt, provider = 'replicate', apiKeys = {} } = body;
  if (!prompt || !String(prompt).trim()) return NextResponse.json({ error: 'اكتب وصفاً للفيديو أولاً.' }, { status: 400 });

  const key = (apiKeys[provider] || apiKeys.replicate || [])[0];
  const keyValue = typeof key === 'string' ? key : key?.value;

  if (!keyValue) {
    return NextResponse.json({
      error: 'توليد الفيديو يحتاج مفتاحاً مدفوعاً — لا يوجد مزود فيديو مجاني موثوق بدون مفتاح.',
      needsKey: true,
      howTo: 'أنشئ حساباً في Replicate (replicate.com) أو Luma (lumalabs.ai) أو Runway، انسخ مفتاح API، وأضفه من مدير المفاتيح تحت اسم المزود، ثم أعد المحاولة. لن نعرض فيديو وهمياً بدل ذلك.'
    }, { status: 402 });
  }

  // مفتاح موجود لكن التكامل الكامل مع كل مزود فيديو (مهام غير متزامنة + استطلاع)
  // خارج نطاق هذه النسخة — نرد بصراحة بدل ادعاء فيديو غير موجود.
  return NextResponse.json({
    error: 'المفتاح موجود، لكن توليد الفيديو عبر ' + provider + ' (مهام غير متزامنة واستطلاع حالة) غير مكتمل في هذه النسخة بعد.',
    needsKey: false,
    howTo: 'الخطوة التالية للمطوّر: استدعاء نقطة إنشاء التنبؤ في Replicate ثم استطلاع حالتها حتى الاكتمال. الصور والنصوص تعملان بالكامل الآن.'
  }, { status: 501 });
}
