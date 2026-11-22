import { NextResponse } from 'next/server';
import { PROVIDERS } from '@/lib/providers';
import { groupCatalog, parseCatalogJs } from '@/lib/freellmapi-catalog';
import snapshot from '@/lib/freellmapi-catalog.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/models — الكتالوج العام فقط، بلا أي أسرار.
// + كتالوج FreeLLMAPI الكامل: يُجلب حياً من لقطة freellmapi.co العامة
//   (https://freellmapi.co/assets/data.js — window.CATALOG_SNAPSHOT، 487 نقطة
//   نهاية عبر 52 منصة)، ويُجمَّع حسب عائلة النموذج. عند فشل الجلب الحي أو
//   تحليله يُرجع لقطة المستودع lib/freellmapi-catalog.json (حدّثها بـ npm run catalog).
// ملاحظة صادقة: القائمة كتالوج — توفّر النموذج فعلياً يعتمد على مفاتيح
// المزودين المضافة في لوحة الراوتر (الراوتر حالياً فيه مفتاح Groq فقط).

const CATALOG_URL = 'https://freellmapi.co/assets/data.js';
const CATALOG_TTL_MS = 6 * 3600 * 1000; // 6 ساعات
let liveCache = null; // { at, catalog }

async function fetchLiveCatalog() {
  if (liveCache && Date.now() - liveCache.at < CATALOG_TTL_MS) return liveCache.catalog;
  try {
    const r = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'CHIBANI-AI/2.0' } });
    if (!r.ok) return null;
    const snap = parseCatalogJs(await r.text());
    if (!snap) return null;
    const catalog = groupCatalog(snap);
    liveCache = { at: Date.now(), catalog };
    return catalog;
  } catch { return null; }
}

export async function GET() {
  const safe = PROVIDERS.map((p) => ({
    id: p.id, name: p.name, baseURL: p.baseURL, needsKey: p.needsKey,
    freeTier: p.freeTier, signup: p.signup, models: p.models, supportsVision: p.supportsVision, color: p.color || '#8b5cf6',
    videoOnly: !!p.videoOnly, imageModel: p.imageModel || null, videoModel: p.videoModel || null,
    tools: (p.tools || []).map((t) => ({ id: t.id, name: t.name, desc: t.desc, feature: t.feature }))
  }));
  const live = await fetchLiveCatalog();
  const freellmapiCatalog = live
    ? { source: 'live', sourceUrl: CATALOG_URL, version: live.version, generatedAt: live.generatedAt, totalModels: live.totalModels, totalEndpoints: live.totalEndpoints, models: live.models }
    : { source: 'snapshot', sourceUrl: snapshot.source, fetchedAt: snapshot.fetchedAt, version: snapshot.version, generatedAt: snapshot.generatedAt, totalModels: snapshot.totalModels, totalEndpoints: snapshot.totalEndpoints, models: snapshot.models };
  return NextResponse.json({ providers: safe, freellmapiCatalog });
}
