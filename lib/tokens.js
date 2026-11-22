// تقدير التوكنات: ~حرف واحد = ربع توكن تقريباً للعربية/الإنجليزية المختلطة.
// هذا تقدير للعرض في الواجهة فقط؛ الرقم الدقيق يأتي من usage الذي يرجعه المزود إن وُجد.
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  // العربية أحرفها أثقل توكناً من الإنجليزية قليلاً
  const arabic = (s.match(/[\u0600-\u06FF]/g) || []).length;
  const rest = s.length - arabic;
  return Math.ceil(arabic / 3 + rest / 4);
}

export function estimateMessagesTokens(messages) {
  return (messages || []).reduce((n, m) => n + estimateTokens(m.content || '') + 4, 0);
}

export function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
