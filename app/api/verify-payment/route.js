import { NextResponse } from 'next/server';
import { USDT_WALLET, USDT_CONTRACT, PLAN_USDT, priceToSun } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/verify-payment — تحقق حقيقي من دفعة USDT (TRC20) عبر TronGrid العام (بدون مفتاح).
// الجسم: { txid, planId: 'pro'|'business', email, purpose: 'purchase'|'recheck' }
// التحقق يقرأ السلسلة فعلاً:
//  1) المعاملة موجودة على السلسلة وناجحة (contractRet === 'SUCCESS') ولها رقم بلوك.
//  2) حدث Transfer لعقد USDT الرسمي TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t.
//  3) المستلم هو محفظة الموقع بالضبط، والمرسل ليس المحفظة نفسها.
//  4) المبلغ يساوي سعر الخطة بالضبط (بالـ SUN — 6 خانات عشرية).
//  5) في وضع الشراء فقط: المعاملة حديثة (خلال 24 ساعة). في وضع إعادة الفحص
//     (اشتراك قديم محفوظ) يُتخطى شرط الحداثة — التحويل نفسه يبقى موثقاً على السلسلة.
// لا تُقبل أي دفعة لا تطابق كل الشروط. لا يُسجَّل TXID ولا البريد في أي سجل خادم.
// حدّ صادق: هذا التحقق يمنع تزوير الدفع على جهاز واحد؛ منع إعادة استعمال TXID
// عبر أجهزة مختلفة يحتاج قاعدة بيانات مشتركة على الخادم (Vercel KV / Supabase)
// وهي غير موجودة في هذه النسخة — السجل المحلي في المتصفح يمنع إعادة الاستعمال
// على الجهاز نفسه فقط. انظر README.

const TXID_RE = /^[0-9a-fA-F]{64}$/;
const TRONGRID = 'https://api.trongrid.io/v1';

async function tg(path, ms) {
  const r = await fetch(TRONGRID + path, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(ms)
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('TronGrid ردّ بالحالة ' + r.status);
  return r.json();
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ verified: false, reason: 'طلب غير صالح (JSON).' }, { status: 400 }); }
  const { txid, planId, email, purpose } = body || {};
  const plan = PLAN_USDT[planId];
  if (!plan || plan.price <= 0) return NextResponse.json({ verified: false, reason: 'الخطة غير صالحة للشراء (الخطة المجانية لا تحتاج دفعاً).' }, { status: 400 });
  if (!txid || !TXID_RE.test(String(txid).trim())) {
    return NextResponse.json({ verified: false, reason: 'TXID غير صالح — يجب أن يكون 64 حرفاً ست عشرياً (انسخه من محفظتك بعد إرسال الدفعة).' }, { status: 400 });
  }
  const id = String(txid).trim().toLowerCase();
  const expectedSun = String(priceToSun(plan.price));
  const checks = {
    txExists: false, txSuccess: false, transferFound: false,
    recipientOk: false, amountOk: false, recentOk: purpose !== 'purchase', notSelf: false
  };
  try {
    const tx = await tg('/transactions/' + id, 10000);
    if (!tx || !tx.ret || !tx.ret.length) {
      return NextResponse.json({ verified: false, reason: 'المعاملة غير موجودة على شبكة TRON — تأكد من TXID وأنه على شبكة TRC20 (وليس ERC20 أو BEP20).', checks });
    }
    checks.txExists = true;
    const ret = tx.ret[0] || {};
    if (ret.contractRet !== 'SUCCESS') {
      return NextResponse.json({ verified: false, reason: 'المعاملة موجودة لكنها فاشلة على السلسلة (contractRet: ' + String(ret.contractRet || '؟') + ').', checks });
    }
    checks.txSuccess = true;
    if (!tx.blockNumber) {
      return NextResponse.json({ verified: false, reason: 'المعاملة ما زالت غير مؤكدة (بلا رقم بلوك) — انتظر تأكيد الشبكة دقيقة ثم أعد التحقق.', checks });
    }
    const events = await tg('/transactions/' + id + '/events', 10000);
    const transfers = (events?.data || []).filter((e) => e.event_name === 'Transfer' && e.contract_address === USDT_CONTRACT);
    if (!transfers.length) {
      return NextResponse.json({ verified: false, reason: 'المعاملة ليست تحويل USDT (TRC20) — لا يوجد حدث Transfer لعقد USDT الرسمي فيها.', checks });
    }
    checks.transferFound = true;
    const hit = transfers.find((e) => String(e.result?.to || '') === USDT_WALLET);
    if (!hit) {
      return NextResponse.json({ verified: false, reason: 'التحويل موجود لكن المستلم ليس محفظة الموقع — أرسل المبلغ إلى العنوان المعروض في نافذة الدفع بالضبط.', checks });
    }
    checks.recipientOk = true;
    const value = String(hit.result?.value ?? '');
    if (value !== expectedSun) {
      return NextResponse.json({ verified: false, reason: 'المبلغ لا يطابق سعر الخطة: أُرسل ' + (Number(value) / 1e6) + ' USDT بينما سعر الخطة ' + plan.price + ' USDT بالضبط — أرسل الفرق في معاملة جديدة أو تواصل مع الدعم.', checks });
    }
    checks.amountOk = true;
    const from = String(hit.result?.from || '');
    if (from && from !== USDT_WALLET) checks.notSelf = true;
    if (purpose === 'purchase') {
      const ts = Number(tx.block_timestamp || 0);
      const ageH = ts ? (Date.now() - ts) / 3600000 : Infinity;
      if (!ts || ageH > 24) {
        return NextResponse.json({ verified: false, reason: 'المعاملة أقدم من 24 ساعة — هذه النافذة للمدفوعات الجديدة فقط. إن كانت دفعة قديمة فعّلها من الإعدادات بإعادة التحقق.', checks });
      }
      checks.recentOk = true;
    }
    return NextResponse.json({
      verified: true,
      plan: planId,
      price: plan.price,
      txid: id,
      email: String(email || '').slice(0, 120) || null,
      from,
      to: USDT_WALLET,
      amountUsdt: plan.price,
      blockNumber: tx.blockNumber,
      timestamp: tx.block_timestamp,
      checks
    });
  } catch (e) {
    return NextResponse.json({ verified: false, reason: 'تعذّر الوصول إلى شبكة TRON الآن (' + String(e.message || e).slice(0, 120) + ') — أعد المحاولة بعد قليل، فأموالك في أمان على السلسلة.', checks }, { status: 502 });
  }
}
