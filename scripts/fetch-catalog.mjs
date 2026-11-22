// scripts/fetch-catalog.mjs — يجلب لقطة كتالوج FreeLLMAPI العامة
// (https://freellmapi.co/assets/data.js) ويحفظها مجمّعة في
// lib/freellmapi-catalog.json كبديل احتياطي عندما يتعذّر الجلب الحي من /api/models.
// التشغيل: npm run catalog
// (أداة بناء وقتية فقط — تجلب ملف بيانات عاماً إلى المستودع، مثل تثبيت اعتماد.)
import { writeFileSync } from 'node:fs';
import { groupCatalog, parseCatalogJs } from '../lib/freellmapi-catalog.js';

const CATALOG_URL = 'https://freellmapi.co/assets/data.js';
const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error('HTTP ' + res.status);
const text = await res.text();
console.log('data.js bytes:', text.length);
const snap = parseCatalogJs(text);
if (!snap) throw new Error('CATALOG_SNAPSHOT not found or not JSON');
console.log('snapshot keys:', Object.keys(snap).join(', '));
const grouped = groupCatalog(snap);
const out = {
  source: CATALOG_URL,
  fetchedAt: new Date().toISOString(),
  version: grouped.version,
  generatedAt: grouped.generatedAt,
  totalModels: grouped.totalModels,
  totalEndpoints: grouped.totalEndpoints,
  models: grouped.models
};
writeFileSync(new URL('../lib/freellmapi-catalog.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('models:', grouped.totalModels, '| endpoints:', grouped.totalEndpoints, '| version:', grouped.version, '| generatedAt:', grouped.generatedAt);
console.log('first 5:', grouped.models.slice(0, 5).map((m) => m.id + ' (' + m.contextLabel + ')').join(' | '));
console.log('wrote lib/freellmapi-catalog.json');
