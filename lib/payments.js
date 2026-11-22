// lib/payments.js — الدفع بـ USDT على شبكة TRON (TRC20) — v1.8
// عنوان محفظة الاستقبال العام الذي نشره مالك الموقع لزبائنه.
// هذا العنوان علني بطبيعته (يُظهره الموقع للزبائن للدفع) وليس سراً.
// لا يوجد أي مفتاح خاص هنا أبداً — لا يُسأل عنه ولا يُخزَّن ولا يُولَّد.
// لتغيير العنوان: عدّل هذا الثابت الواحد فقط — كل الواجهة والتحقق يقرآن منه.

export const USDT_WALLET = 'TTrYhS7Y8t1bqJEPST2DaGrAH3oKUni6YN';
// عقد USDT الرسمي على TRON (TRC20) — 6 خانات عشرية.
export const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const USDT_DECIMALS = 6;

// أسعار الخطط بـ USDT — دفعة واحدة = شهر واحد من الخطة.
export const PLAN_USDT = {
  free: { price: 0, label: '0 USDT' },
  pro: { price: 4.99, label: '4.99 USDT' },
  business: { price: 14.99, label: '14.99 USDT' }
};

// مزايا كل خطة — تظهر في بطاقات الأسعار الأنيقة.
export const PLAN_FEATURES = {
  free: ['100K توكن / يوم', '5 صور / يوم', 'كل المزودين المجانيين', 'وضع المقارنة ⚔️'],
  pro: ['2M توكن / يوم', '200 صورة / يوم', 'Nano Banana و Veo 3 بمفاتيحك', 'أولوية السرعة', 'بدون إعلانات'],
  business: ['10M توكن / يوم', '2000 صورة / يوم', 'كل مزايا Pro', 'أدوات الفيديو الاحترافية', 'دعم ذو أولوية']
};

// السعر بوحدة SUN (أصغر وحدة في USDT على TRON: 1 USDT = 1,000,000 SUN).
export function priceToSun(price) {
  return Math.round(Number(price) * 1e6);
}
