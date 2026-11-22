// lib/agent-config.js — إعدادات الوكيل الذكي v2.2
// كل الإعدادات تُحفظ في متصفح المستخدم فقط (localStorage: omni_agent_cfg).
// البرومبت النظامي مخزّن ومُصدَّر من عند المستخدم، لا مكتوب في الكود.
// لا توجد قاعدة بيانات خادم ولا vector DB على Vercel المجاني — البحث في
// الملفات المرجعية نصي داخل المتصفح، وهذا موضّح صراحة في الواجهة والتوثيق.

import { DEFAULT_BANDS, DEFAULT_COLD_WORDS, DEFAULT_HOT_WORDS } from './agent-router';

export const DEFAULT_SYSTEM_PROMPT =
  'You are CHIBANI AI Agent — a careful autonomous agent. ' +
  'Plan the task into clear steps, use the available tools, verify each result, ' +
  "and say plainly when something cannot be done. Answer in the user's language.";

export const DEFAULT_AGENT_CONFIG = {
  instructions: '',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  tools: { chat: true, image: true, video: true, web: true, integrations: true },
  memory: [],
  history: [],
  router: {
    enabled: true,
    cold: DEFAULT_BANDS.cold,
    warm: DEFAULT_BANDS.warm,
    hot: DEFAULT_BANDS.hot,
    coldWords: [...DEFAULT_COLD_WORDS],
    hotWords: [...DEFAULT_HOT_WORDS]
  },
  request: {
    model: '',
    maxTokens: 4096,
    topP: 0.95,
    presencePenalty: 0.1,
    frequencyPenalty: 0.2,
    stop: '',
    seed: '',
    reasoningEffort: '',
    responseFormat: 'text'
  },
  agent: {
    maxSteps: 10,
    toolChoice: 'auto',
    parallelToolCalls: true,
    stream: true,
    maxCallsPerTool: 3,
    storeHistory: true
  },
  knowledge: [], // [{id, name, text}] — ملفات مرجعية نصية للـ RAG الخفيف
  safety: {
    whitelist: ['wikipedia.org', 'github.com', 'developer.mozilla.org', 'stackoverflow.com', 'arxiv.org'],
    fetchChars: 3000,
    timeoutSec: 12
  },
  log: [], // [{at, tool, label, status, detail}]
  sessionId: ''
};

// مخزن الأدوات: كل أداة اسم + وصف + مخطط معاملات JSON Schema + مهلة + حد استدعاءات.
export const TOOLS_STORE = [
  {
    id: 'chat', name: 'محادثة', desc: 'تفكير وكتابة وتلخيص وتحليل بالنموذج.',
    timeoutSec: 90, maxCalls: 3,
    schema: { type: 'object', properties: { prompt: { type: 'string', description: 'نص الخطوة المطلوب تنفيذها' }, context: { type: 'string', description: 'نتائج الخطوات السابقة' } }, required: ['prompt'] }
  },
  {
    id: 'image', name: 'توليد صورة', desc: 'توليد صورة من وصف نصي عبر مسارات الصور.',
    timeoutSec: 120, maxCalls: 3,
    schema: { type: 'object', properties: { prompt: { type: 'string', description: 'وصف الصورة بالإنجليزية' } }, required: ['prompt'] }
  },
  {
    id: 'video', name: 'توليد فيديو', desc: 'توليد فيديو قصير من وصف نصي.',
    timeoutSec: 300, maxCalls: 2,
    schema: { type: 'object', properties: { prompt: { type: 'string', description: 'وصف الفيديو' }, seconds: { type: 'number', description: 'المدة بالثواني' } }, required: ['prompt'] }
  },
  {
    id: 'web', name: 'جلب ويب', desc: 'جلب صفحة ويب وتحويلها إلى نص مقروء (ضمن القائمة البيضاء فقط).',
    timeoutSec: 12, maxCalls: 3,
    schema: { type: 'object', properties: { url: { type: 'string', format: 'uri', description: 'الرابط الكامل للصفحة' } }, required: ['url'] }
  },
  {
    id: 'github', name: 'GitHub', desc: 'قراءة مستودعات وملفات GitHub عبر التكامل.',
    timeoutSec: 30, maxCalls: 3,
    schema: { type: 'object', properties: { query: { type: 'string', description: 'ما الذي يُجلب من GitHub' } }, required: ['query'] }
  },
  {
    id: 'vercel', name: 'Vercel', desc: 'قراءة مشاريع ونشر Vercel عبر التكامل.',
    timeoutSec: 30, maxCalls: 3,
    schema: { type: 'object', properties: { query: { type: 'string', description: 'ما الذي يُجلب من Vercel' } }, required: ['query'] }
  },
  {
    id: 'render', name: 'Render', desc: 'قراءة خدمات Render عبر التكامل.',
    timeoutSec: 30, maxCalls: 3,
    schema: { type: 'object', properties: { query: { type: 'string', description: 'ما الذي يُجلب من Render' } }, required: ['query'] }
  },
  {
    id: 'cloudflare', name: 'Cloudflare', desc: 'قراءة النطاقات وحساب Cloudflare عبر التكامل.',
    timeoutSec: 30, maxCalls: 3,
    schema: { type: 'object', properties: { query: { type: 'string', description: 'ما الذي يُجلب من Cloudflare' } }, required: ['query'] }
  },
  {
    id: 'facebook', name: 'Facebook', desc: 'قراءة الصفحات والمنشورات عبر التكامل.',
    timeoutSec: 30, maxCalls: 3,
    schema: { type: 'object', properties: { query: { type: 'string', description: 'ما الذي يُجلب من Facebook' } }, required: ['query'] }
  },
  {
    id: 'gmail', name: 'Gmail', desc: 'قراءة رسائل Gmail (يحتاج نطاق gmail.readonly — غير مفعّل بعد).',
    timeoutSec: 30, maxCalls: 3,
    schema: { type: 'object', properties: { query: { type: 'string', description: 'ما الذي يُبحث عنه في Gmail' } }, required: ['query'] }
  }
];

export function toolDef(id) {
  return TOOLS_STORE.find((t) => t.id === id) || null;
}

function clampNum(v, dflt, min, max) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

// دمج إعدادات محفوظة (v2.1 أو v2.2) فوق الافتراضية مع تقييد القيم.
export function normalizeAgentConfig(saved = {}) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const d = DEFAULT_AGENT_CONFIG;
  const words = (arr, dflt) => (Array.isArray(arr) && arr.length ? arr.map((w) => String(w).trim()).filter(Boolean) : [...dflt]);
  return {
    instructions: typeof s.instructions === 'string' ? s.instructions : '',
    systemPrompt: typeof s.systemPrompt === 'string' && s.systemPrompt.trim() ? s.systemPrompt.slice(0, 20000) : DEFAULT_SYSTEM_PROMPT,
    tools: { ...d.tools, ...(s.tools || {}) },
    memory: Array.isArray(s.memory) ? s.memory.filter(Boolean).slice(0, 50) : [],
    history: Array.isArray(s.history) ? s.history.slice(0, 10) : [],
    router: {
      enabled: s.router?.enabled !== false,
      cold: clampNum(s.router?.cold, d.router.cold, 0, 2),
      warm: clampNum(s.router?.warm, d.router.warm, 0, 2),
      hot: clampNum(s.router?.hot, d.router.hot, 0, 2),
      coldWords: words(s.router?.coldWords, DEFAULT_COLD_WORDS),
      hotWords: words(s.router?.hotWords, DEFAULT_HOT_WORDS)
    },
    request: {
      model: typeof s.request?.model === 'string' ? s.request.model.slice(0, 120) : '',
      maxTokens: clampNum(s.request?.maxTokens, d.request.maxTokens, 256, 32000),
      topP: clampNum(s.request?.topP, d.request.topP, 0.01, 1),
      presencePenalty: clampNum(s.request?.presencePenalty, d.request.presencePenalty, -2, 2),
      frequencyPenalty: clampNum(s.request?.frequencyPenalty, d.request.frequencyPenalty, -2, 2),
      stop: typeof s.request?.stop === 'string' ? s.request.stop.slice(0, 200) : '',
      seed: s.request?.seed === '' || s.request?.seed == null ? '' : String(s.request.seed).slice(0, 20),
      reasoningEffort: ['low', 'medium', 'high'].includes(s.request?.reasoningEffort) ? s.request.reasoningEffort : '',
      responseFormat: s.request?.responseFormat === 'json_object' ? 'json_object' : 'text'
    },
    agent: {
      maxSteps: Math.round(clampNum(s.agent?.maxSteps, d.agent.maxSteps, 1, 15)),
      toolChoice: ['auto', 'none'].includes(s.agent?.toolChoice) ? s.agent.toolChoice : 'auto',
      parallelToolCalls: s.agent?.parallelToolCalls !== false,
      stream: s.agent?.stream !== false,
      maxCallsPerTool: Math.round(clampNum(s.agent?.maxCallsPerTool, d.agent.maxCallsPerTool, 1, 10)),
      storeHistory: s.agent?.storeHistory !== false
    },
    knowledge: Array.isArray(s.knowledge)
      ? s.knowledge.filter((k) => k && k.name && k.text).map((k) => ({ id: k.id || Math.random().toString(36).slice(2, 10), name: String(k.name).slice(0, 60), text: String(k.text).slice(0, 50000) })).slice(0, 5)
      : [],
    safety: {
      whitelist: Array.isArray(s.safety?.whitelist) && s.safety.whitelist.length
        ? s.safety.whitelist.map((w) => String(w).trim().toLowerCase()).filter(Boolean)
        : [...d.safety.whitelist],
      fetchChars: Math.round(clampNum(s.safety?.fetchChars, d.safety.fetchChars, 500, 8000)),
      timeoutSec: Math.round(clampNum(s.safety?.timeoutSec, d.safety.timeoutSec, 5, 60))
    },
    log: Array.isArray(s.log) ? s.log.slice(0, 50) : [],
    sessionId: typeof s.sessionId === 'string' && s.sessionId ? s.sessionId : 'agent-' + Math.random().toString(36).slice(2, 10)
  };
}

// سجل الحالة (STATE LEDGER): يُحقن في بداية كل دور — المهمة، ما اكتمل، ما بقي.
export function buildStateLedger({ task, steps = [], notes = [], memory = [] }) {
  const done = steps.filter((s) => s.status === 'done');
  const open = steps.filter((s) => s.status !== 'done');
  let out = '[STATE LEDGER — injected at the start of this turn]\nTask: ' + String(task || '').slice(0, 300);
  if (done.length) out += '\nCompleted steps:\n' + done.map((s) => '- ' + s.label + ': ' + String(s.detail || '').slice(0, 160)).join('\n');
  if (open.length) out += '\nOpen steps:\n' + open.map((s) => '- ' + s.label + ' (' + (s.tool || 'chat') + ')').join('\n');
  if (notes.length) out += '\nResults so far:\n' + notes.join('\n').slice(0, 2000);
  if (memory.length) out += '\nLessons: ' + memory.slice(0, 5).join(' | ');
  return out;
}

// بحث نصي داخل المتصفح في الملفات المرجعية (بديل صريح عن vector DB — لا يوجد
// فهرس متجهات على Vercel المجاني). يرجع أفضل مقتطفين حسب تداخل الكلمات.
export function searchKnowledge(files, text, maxSnippets = 2) {
  const words = String(text || '').toLowerCase().split(/[^a-z0-9\u0600-\u06FF]+/).filter((w) => w.length >= 3);
  if (!words.length || !Array.isArray(files) || !files.length) return [];
  const scored = files.map((f) => {
    const body = String(f.text || '').toLowerCase();
    let score = 0;
    for (const w of new Set(words)) if (body.includes(w)) score += 1;
    return { f, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, maxSnippets);
  return scored.map(({ f }) => ({ name: f.name, snippet: String(f.text || '').slice(0, 1500) }));
}
