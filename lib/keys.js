// إدارة تجمع المفاتيح (client-side + خادم): عدة مفاتيح لكل مزود،
 // تدوير تلقائي عند 429 / تجاوز الحصة / 401، ووضع علامة "مستنفد" على المفتاح الفاشل.
 // المفاتيح لا تُحفظ إلا في localStorage في متصفح المستخدم، ولا تُسجَّل في أي سجل خادم.

export function loadKeyPool() {
  try { return JSON.parse(localStorage.getItem('omni_keys') || '{}'); } catch { return {}; }
}
export function saveKeyPool(pool) {
  try { localStorage.setItem('omni_keys', JSON.stringify(pool)); } catch {}
}
export function addKeyToPool(pool, providerId, key) {
  const next = { ...pool };
  const list = [...(next[providerId] || [])];
  const clean = String(key || '').trim();
  if (clean && !list.some((k) => k.value === clean)) {
    list.push({ value: clean, status: 'active', fails: 0, addedAt: Date.now() });
  }
  next[providerId] = list;
  return next;
}
export function markKeyExhausted(pool, providerId, index) {
  const next = { ...pool };
  if (next[providerId] && next[providerId][index]) {
    next[providerId][index] = { ...next[providerId][index], status: 'exhausted', fails: (next[providerId][index].fails || 0) + 1 };
  }
  return next;
}

// توليد مفتاح API محلي لموقع المستخدم نفسه (للواجهة البرمجية الخاصة به)
export function generateAppApiKey() {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 32);
  return 'chibani_' + b64;
}

// خادم: ترتيب المفاتيح — النشطة أولاً، ثم المستنفدة كملاذ أخير
export function orderKeys(keys) {
  const arr = (keys || []).map((k, i) => ({ value: typeof k === 'string' ? k : k.value, index: i, status: k.status || 'active' }));
  return arr.filter((k) => k.value).sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1));
}

export function isRetryableStatus(status) {
  return status === 429 || status === 401 || status === 403 || status === 402 || status >= 500;
}
