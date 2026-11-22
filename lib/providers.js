// كتالوج المزودين — كل مزود متوافق مع OpenAI API (‏/chat/completions)
// ملاحظة صادقة: الحصص المجانية ملكٌ لكل مزود على حدة، محدودة، وليست غير محدودة.
// لا يوجد مفتاح واحد يمنحك كل النماذج مجاناً.

export const PROVIDERS = [
  {
    id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1',
    needsKey: true, freeTier: 'طبقة مجانية سخية وسرعة عالية — تحتاج حساباً ومفتاحاً مجانياً.',
    signup: 'https://console.groq.com/keys',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'allam-2-7b'],
    supportsVision: false
  },
  {
    id: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1',
    needsKey: true, freeTier: 'نماذج مجانية كثيرة (تنتهي بـ :free) — تحتاج حساباً ومفتاحاً.',
    signup: 'https://openrouter.ai/keys',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free', 'deepseek/deepseek-r1:free', 'qwen/qwen-2.5-7b-instruct:free'],
    supportsVision: true
  },
  {
    id: 'together', name: 'Together AI', baseURL: 'https://api.together.xyz/v1',
    needsKey: true, freeTier: 'رصيد مجاني عند التسجيل — تحتاج حساباً ومفتاحاً.',
    signup: 'https://api.together.ai/settings/api-keys',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-R1'],
    supportsVision: false
  },
  {
    id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1',
    needsKey: true, freeTier: 'رخيص جداً وليس مجانياً بالكامل — تحتاج رصيداً.',
    signup: 'https://platform.deepseek.com/api_keys',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    supportsVision: false
  },
  {
    id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1',
    needsKey: true, freeTier: 'مدفوع — لا توجد طبقة مجانية دائمة. يحتاج رصيداً.',
    signup: 'https://platform.openai.com/api-keys',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    supportsVision: true
  },
  {
    id: 'gemini', name: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsKey: true, freeTier: 'طبقة مجانية يومية — تحتاج مفتاح Google AI Studio.',
    signup: 'https://aistudio.google.com/apikey',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'],
    supportsVision: true
  },
  {
    id: 'mistral', name: 'Mistral', baseURL: 'https://api.mistral.ai/v1',
    needsKey: true, freeTier: 'طبقة تجريبية محدودة — تحتاج حساباً ومفتاحاً.',
    signup: 'https://console.mistral.ai/api-keys',
    models: ['mistral-large-latest', 'mistral-small-latest', 'mistral-medium-latest'],
    supportsVision: false
  },
  {
    id: 'huggingface', name: 'Hugging Face', baseURL: 'https://router.huggingface.co/v1',
    needsKey: true, freeTier: 'طبقة مجانية محدودة عبر Inference Providers — تحتاج توكن HF.',
    signup: 'https://huggingface.co/settings/tokens',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-R1'],
    supportsVision: false
  },
  {
    id: 'pollinations', name: 'Pollinations (نص مجاني)', baseURL: 'https://text.pollinations.ai',
    needsKey: false, freeTier: 'نص مجاني بدون مفتاح — حدود استخدام عادلة، وقد يتأخر أحياناً.',
    signup: 'https://pollinations.ai',
    models: ['openai', 'openai-large', 'mistral'],
    supportsVision: false
  },
  {
    id: 'freellmapi', name: 'FreeLLMAPI Router (سحابي)', baseURL: 'https://freellmapi-production-c529c3c7.up.railway.app/v1',
    needsKey: true, freeTier: 'راوتر مستضاف يجمع الحصص المجانية لـ 87 مزوداً خلف مفتاح موحد واحد — ألصق المفتاح الموحد من لوحة الراوتر في إعدادات FreeLLMAPI.',
    signup: 'https://freellmapi-production-c529c3c7.up.railway.app/',
    models: ['auto', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'deepseek/deepseek-r1:free', 'google/gemini-2.0-flash-exp:free'],
    supportsVision: false
  },
  {
    id: 'ollama', name: 'Ollama (محلي)', baseURL: 'http://localhost:11434/v1',
    needsKey: false, freeTier: 'تشغيل محلي على جهازك — مجاني بعد تنزيل النموذج، ولا يعمل على Vercel.',
    signup: 'https://ollama.com',
    models: ['llama3.1', 'qwen2.5', 'mistral'],
    supportsVision: false
  },
  {
    id: 'custom', name: 'نقطة نهاية مخصصة', baseURL: '',
    needsKey: true, freeTier: 'أي خادم متوافق مع OpenAI — أدخل رابطه ومفتاحه بنفسك.',
    signup: '',
    models: ['custom-model'],
    supportsVision: true
  }
];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

// ترتيب الوضع التلقائي: المجاني أولاً، ثم المدفوع إن وُجدت مفاتيحه
export const AUTO_ORDER = ['groq', 'openrouter', 'pollinations', 'together', 'gemini', 'deepseek', 'mistral', 'huggingface', 'openai'];
