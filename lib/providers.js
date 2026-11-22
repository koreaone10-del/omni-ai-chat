// كتالوج المزودين — كل مزود متوافق مع OpenAI API (‏/chat/completions)
// ملاحظة صادقة: الحصص المجانية ملكٌ لكل مزود على حدة، محدودة، وليست غير محدودة.
// لا يوجد مفتاح واحد يمنحك كل النماذج مجاناً.
// blurb: وصف قصير من سطر واحد يظهر في ورقة اختيار النموذج.
// imageModel: نموذج الصور الخاص بالمزود (لأداة توليد الصور — تُجرَّب قبل البديل المجاني).
// tools: أدوات المزود — تظهر كشرائح صغيرة فوق صندوق الكتابة، والنقر عليها
// يفتح ورقة طويلة بكل الأدوات مع شارة الميزة الأهم بلونها الخاص (v1.8).
// videoOnly: مزود فيديو فقط (fal.ai) — لا يظهر كمزوّد محادثة في ورقة النموذج.

// أهم ميزة في كل أداة — كل ميزة بلون مختلف ثابت في كل الواجهة.
export const FEATURES = {
  chat: { label: 'محادثة', color: '#6b7280' },
  code: { label: 'برمجة', color: '#3b82f6' },
  analysis: { label: 'تحليل', color: '#8b5cf6' },
  research: { label: 'بحث عميق', color: '#f59e0b' },
  image: { label: 'توليد صور', color: '#22c55e' },
  video: { label: 'توليد فيديو', color: '#f43f5e' },
  compare: { label: 'مقارنة', color: '#a855f7' }
};

export const PROVIDERS = [
  {
    id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1',
    color: '#f97316',
    needsKey: true, freeTier: 'طبقة مجانية سخية وسرعة عالية — تحتاج حساباً ومفتاحاً مجانياً.',
    signup: 'https://console.groq.com/keys',
    blurb: 'الأسرع — ردود فورية تقريباً',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'allam-2-7b'],
    supportsVision: false,
    tools: [
      { id: 'chat', name: 'محادثة سريعة', desc: 'ردود فورية تقريباً لأي سؤال', feature: 'chat' },
      { id: 'code', name: 'برمجة', desc: 'كتابة وشرح وتصحيح الكود بسرعة', feature: 'code' },
      { id: 'analysis', name: 'تحليل', desc: 'تحليل نصوص وبيانات وأفكار بعمق', feature: 'analysis' }
    ]
  },
  {
    id: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1',
    color: '#8b5cf6',
    needsKey: true, freeTier: 'نماذج مجانية كثيرة (تنتهي بـ :free) — تحتاج حساباً ومفتاحاً.',
    signup: 'https://openrouter.ai/keys',
    blurb: 'نماذج مجانية كثيرة من كل الشركات',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free', 'deepseek/deepseek-r1:free', 'qwen/qwen-2.5-7b-instruct:free'],
    supportsVision: true,
    tools: [
      { id: 'chat', name: 'محادثة', desc: 'نماذج مجانية كثيرة من كل الشركات', feature: 'chat' },
      { id: 'code', name: 'برمجة', desc: 'كود من أقوى النماذج المفتوحة', feature: 'code' },
      { id: 'analysis', name: 'تحليل', desc: 'تحليل معمّق بالنموذج الأنسب', feature: 'analysis' },
      { id: 'research', name: 'بحث عميق', desc: 'تفكير مطوّل واستدلال خطوة بخطوة', feature: 'research' }
    ]
  },
  {
    id: 'together', name: 'Together AI', baseURL: 'https://api.together.xyz/v1',
    color: '#3b82f6',
    needsKey: true, freeTier: 'رصيد مجاني عند التسجيل — تحتاج حساباً ومفتاحاً.',
    signup: 'https://api.together.ai/settings/api-keys',
    blurb: 'نماذج مفتوحة قوية وصور FLUX',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-R1'],
    imageModel: 'black-forest-labs/FLUX.1-schnell-Free',
    supportsVision: false,
    tools: [
      { id: 'chat', name: 'محادثة', desc: 'نماذج مفتوحة قوية (Llama و Qwen)', feature: 'chat' },
      { id: 'code', name: 'برمجة', desc: 'برمجة بنماذج مفتوحة قوية', feature: 'code' },
      { id: 'image-flux', name: 'توليد صور FLUX', desc: 'صور FLUX.1-schnell بجودة عالية', feature: 'image' }
    ]
  },
  {
    id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1',
    color: '#7c3aed',
    needsKey: true, freeTier: 'رخيص جداً وليس مجانياً بالكامل — تحتاج رصيداً.',
    signup: 'https://platform.deepseek.com/api_keys',
    blurb: 'رخيص ودقيق في البرمجة',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    supportsVision: false,
    tools: [
      { id: 'chat', name: 'محادثة', desc: 'ردود دقيقة ورخيصة', feature: 'chat' },
      { id: 'code', name: 'برمجة', desc: 'أدق النماذج الرخيصة في الكود', feature: 'code' },
      { id: 'analysis', name: 'تحليل', desc: 'استدلال عميق (reasoner)', feature: 'analysis' }
    ]
  },
  {
    id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1',
    color: '#14b8a6',
    needsKey: true, freeTier: 'مدفوع — لا توجد طبقة مجانية دائمة. يحتاج رصيداً.',
    signup: 'https://platform.openai.com/api-keys',
    blurb: 'الأذكى — GPT-4o وصور DALL·E',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    imageModel: 'dall-e-3',
    supportsVision: true,
    tools: [
      { id: 'chat', name: 'محادثة', desc: 'GPT-4o — الأذكى في الفهم والكتابة', feature: 'chat' },
      { id: 'code', name: 'برمجة', desc: 'كود احترافي وشرح دقيق', feature: 'code' },
      { id: 'image', name: 'توليد صور DALL·E', desc: 'صور DALL·E 3 عالية الجودة', feature: 'image' }
    ]
  },
  {
    id: 'gemini', name: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    color: '#2563eb',
    needsKey: true, freeTier: 'طبقة مجانية يومية — تحتاج مفتاح Google AI Studio.',
    signup: 'https://aistudio.google.com/apikey',
    blurb: 'طبقة مجانية يومية من Google',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'],
    imageModel: 'gemini-nano-banana-2.1',
    videoModel: 'gemini-omni-1.2-flash',
    supportsVision: true,
    tools: [
      { id: 'chat', name: 'محادثة', desc: 'طبقة مجانية يومية من Google', feature: 'chat' },
      { id: 'image-nanobanana', name: 'Nano Banana 2 — صور', desc: 'صور Nano Banana 2 السريعة (gemini-3.1-flash-image)', feature: 'image' },
      { id: 'image-nanobanana-pro', name: 'Nano Banana Pro — صور', desc: 'أعلى جودة للصور والنص داخل الصورة', feature: 'image' },
      { id: 'video-omni', name: 'Omni Flash — فيديو', desc: 'فيديو حتى 15 ثانية بصوت أصلي', feature: 'video' },
      { id: 'research', name: 'بحث عميق', desc: 'تفكير مطوّل مع معرفة واسعة', feature: 'research' }
    ]
  },
  {
    id: 'mistral', name: 'Mistral', baseURL: 'https://api.mistral.ai/v1',
    color: '#ea580c',
    needsKey: true, freeTier: 'طبقة تجريبية محدودة — تحتاج حساباً ومفتاحاً.',
    signup: 'https://console.mistral.ai/api-keys',
    blurb: 'أوروبي سريع ومتوازن',
    models: ['mistral-large-latest', 'mistral-small-latest', 'mistral-medium-latest'],
    supportsVision: false,
    tools: [
      { id: 'chat', name: 'محادثة', desc: 'أوروبي سريع ومتوازن', feature: 'chat' },
      { id: 'code', name: 'برمجة', desc: 'كود نظيف وسريع', feature: 'code' },
      { id: 'analysis', name: 'تحليل', desc: 'تحليل متوازن وواضح', feature: 'analysis' }
    ]
  },
  {
    id: 'huggingface', name: 'Hugging Face', baseURL: 'https://router.huggingface.co/v1',
    color: '#eab308',
    needsKey: true, freeTier: 'طبقة مجانية محدودة عبر Inference Providers — تحتاج توكن HF.',
    signup: 'https://huggingface.co/settings/tokens',
    blurb: 'نماذج مفتوحة مجانية وصور FLUX',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-R1'],
    imageModel: 'black-forest-labs/FLUX.1-schnell',
    supportsVision: false,
    tools: [
      { id: 'chat', name: 'محادثة', desc: 'نماذج مفتوحة مجانية عبر Inference Providers', feature: 'chat' },
      { id: 'image-flux', name: 'توليد صور FLUX', desc: 'صور FLUX.1-schnell مفتوحة المصدر', feature: 'image' },
      { id: 'code', name: 'برمجة', desc: 'كود بنماذج مفتوحة', feature: 'code' }
    ]
  },
  {
    id: 'pollinations', name: 'Pollinations (نص مجاني)', baseURL: 'https://text.pollinations.ai',
    color: '#22c55e',
    needsKey: false, freeTier: 'نص مجاني بدون مفتاح — حدود استخدام عادلة، وقد يتأخر أحياناً.',
    signup: 'https://pollinations.ai',
    blurb: 'مجاني بدون مفتاح — للبدء فوراً',
    models: ['openai', 'openai-large', 'mistral'],
    supportsVision: false,
    tools: [
      { id: 'chat', name: 'محادثة مجانية', desc: 'نص مجاني بدون مفتاح — للبدء فوراً', feature: 'chat' }
    ]
  },
  {
    id: 'freellmapi', name: 'FreeLLMAPI Router (سحابي)', baseURL: 'https://freellmapi-production-c529c3c7.up.railway.app/v1',
    color: '#a855f7',
    needsKey: true, freeTier: 'راوتر مستضاف يجمع الحصص المجانية لـ 87 مزوداً خلف مفتاح موحد واحد — ألصق المفتاح الموحد من لوحة الراوتر في إعدادات FreeLLMAPI.',
    signup: 'https://freellmapi-production-c529c3c7.up.railway.app/',
    blurb: 'راوتر سحابي — 10.1 مليار توكن مجمّعة',
    models: ['auto', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'deepseek/deepseek-r1:free', 'google/gemini-2.0-flash-exp:free'],
    imageModel: 'black-forest-labs/FLUX.1-schnell',
    supportsVision: false,
    tools: [
      { id: 'chat', name: 'محادثة', desc: '87 مزوداً خلف مفتاح موحد واحد', feature: 'chat' },
      { id: 'image', name: 'توليد صور', desc: 'صور عبر الراوتر إن توفر نموذج صور', feature: 'image' },
      { id: 'compare', name: 'مقارنة', desc: 'نفس السؤال لعدة مزودين دفعة واحدة', feature: 'compare' }
    ]
  },
  {
    id: 'fal', name: 'fal.ai (فيديو)', baseURL: 'https://queue.fal.run/fal-ai',
    color: '#38bdf8',
    videoOnly: true, // مزود فيديو فقط — لا يظهر كمزوّد محادثة
    needsKey: true, freeTier: 'مدفوع حسب الاستخدام (بلا اشتراك) — Veo 3 و Seedance 2.5 بمفتاح واحد.',
    signup: 'https://fal.ai/dashboard/keys',
    blurb: 'فيديو Veo 3 و Seedance 2.5 — مفتاح fal.ai واحد',
    models: [],
    supportsVision: false,
    tools: [
      { id: 'video-veo3', name: 'Veo 3 — فيديو', desc: 'فيديو سينمائي حتى 8 ثوانٍ بصوت أصلي', feature: 'video' },
      { id: 'video-seedance', name: 'Seedance 2.5 — فيديو', desc: 'فيديو حتى 30 ثانية بصوت، جودة حتى 4K', feature: 'video' }
    ]
  },
  {
    id: 'ollama', name: 'Ollama (محلي)', baseURL: 'http://localhost:11434/v1',
    color: '#6b7280',
    needsKey: false, freeTier: 'تشغيل محلي على جهازك — مجاني بعد تنزيل النموذج، ولا يعمل على Vercel.',
    signup: 'https://ollama.com',
    blurb: 'محلي على جهازك — بدون إنترنت',
    models: ['llama3.1', 'qwen2.5', 'mistral'],
    supportsVision: false,
    tools: [
      { id: 'chat', name: 'محادثة محلية', desc: 'بدون إنترنت وبدون إرسال بياناتك لأي خادم', feature: 'chat' }
    ]
  },
  {
    id: 'custom', name: 'نقطة نهاية مخصصة', baseURL: '',
    color: '#64748b',
    needsKey: true, freeTier: 'أي خادم متوافق مع OpenAI — أدخل رابطه ومفتاحه بنفسك.',
    signup: '',
    blurb: 'أي خادم متوافق مع OpenAI',
    models: ['custom-model'],
    supportsVision: true,
    tools: [
      { id: 'chat', name: 'محادثة', desc: 'أي خادم متوافق مع OpenAI', feature: 'chat' }
    ]
  }
];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

// وصف قصير من سطر واحد لنموذج محدد — يظهر بنص صغير في ورقة اختيار النموذج (v2.0).
// النماذج المعروفة لها وصف حقيقي؛ الباقي يأخذ وصف المزود نفسه.
const MODEL_DESCRIPTIONS = {
  'openai/gpt-oss-120b': 'نموذج مفتوح ضخم (120B) — قوي في الاستدلال والبرمجة',
  'qwen/qwen3.8-27b': 'Qwen 3.8 — متوازن وسريع، جيد في البرمجة والعربية',
  'openai/gpt-oss-20b': 'نموذج مفتوح خفيف (20B) — سريع ومناسب للأسئلة اليومية',
  'allam-2-7b': 'علّام 2 — نموذج عربي من SDAIA، ممتاز للعربية',
  'meta-llama/llama-3.3-70b-instruct:free': 'Llama 3.3 (70B) — قوي ومتوازن، مجاني عبر OpenRouter',
  'google/gemini-2.0-flash-exp:free': 'Gemini 2.0 Flash — سريع ومتعدد الوسائط، مجاني',
  'deepseek/deepseek-r1:free': 'DeepSeek R1 — استدلال عميق خطوة بخطوة، مجاني',
  'qwen/qwen-2.5-7b-instruct:free': 'Qwen 2.5 (7B) — خفيف وسريع، مجاني',
  'meta-llama/Llama-3.3-70B-Instruct-Turbo': 'Llama 3.3 (70B) — استدلال قوي عبر Together',
  'Qwen/Qwen2.5-72B-Instruct-Turbo': 'Qwen 2.5 (72B) — كبير ودقيق عبر Together',
  'deepseek-ai/DeepSeek-R1': 'DeepSeek R1 — استدلال عميق، مفتوح المصدر',
  'deepseek-chat': 'DeepSeek Chat — دقيق ورخيص للمحادثة اليومية',
  'deepseek-reasoner': 'DeepSeek Reasoner — تفكير مطوّل واستدلال عميق',
  'gpt-4o-mini': 'GPT-4o mini — سريع ورخيص من OpenAI',
  'gpt-4o': 'GPT-4o — الأذكى في الفهم والكتابة والرؤية',
  'gpt-4.1-mini': 'GPT-4.1 mini — حديث وسريع ورخيص',
  'gemini-2.0-flash': 'Gemini 2.0 Flash — سريع بطبقة مجانية يومية',
  'gemini-2.5-flash': 'Gemini 2.5 Flash — الأحدث المتوازن من Google',
  'gemini-1.5-flash': 'Gemini 1.5 Flash — سريع وموثوق',
  'mistral-large-latest': 'Mistral Large — الأقوى من Mistral، أوروبي',
  'mistral-small-latest': 'Mistral Small — سريع واقتصادي',
  'mistral-medium-latest': 'Mistral Medium — متوازن بين القوة والسرعة',
  'meta-llama/Llama-3.3-70B-Instruct': 'Llama 3.3 (70B) — مفتوح المصدر عبر Hugging Face',
  'Qwen/Qwen2.5-72B-Instruct': 'Qwen 2.5 (72B) — كبير ودقيق عبر Hugging Face',
  'openai': 'Pollinations — نموذج نصي مجاني بدون مفتاح',
  'openai-large': 'Pollinations — النموذج الكبير المجاني بدون مفتاح',
  'pollinations:mistral': 'Pollinations — Mistral مجاني بدون مفتاح',
  'llama3.1': 'Llama 3.1 — يعمل محلياً على جهازك عبر Ollama',
  'qwen2.5': 'Qwen 2.5 — يعمل محلياً على جهازك عبر Ollama',
  'ollama:mistral': 'Mistral — يعمل محلياً على جهازك عبر Ollama',
  'custom-model': 'نموذج نقطة النهاية المخصصة التي أدخلتها'
};
export function modelDesc(provider, modelId) {
  if (modelId === 'auto') return 'يختار الراوتر أفضل نموذج متاح تلقائياً';
  return MODEL_DESCRIPTIONS[provider.id + ':' + modelId] || MODEL_DESCRIPTIONS[modelId] || (provider.blurb || provider.name);
}

// ترتيب الوضع التلقائي: المجاني أولاً، ثم المدفوع إن وُجدت مفاتيحه
export const AUTO_ORDER = ['groq', 'openrouter', 'pollinations', 'together', 'gemini', 'deepseek', 'mistral', 'huggingface', 'openai'];
