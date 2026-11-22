import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

// CHIBANI AI v1.7 — تسجيل دخول حقيقي بـ Google OAuth عبر next-auth.
// المتغيرات المطلوبة (في Vercel → Settings → Environment Variables):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
//   NEXTAUTH_URL=https://ai-worm-fraud.vercel.app
//   NEXTAUTH_SECRET (سلسلة عشوائية طويلة)
// إن غابت بيانات Google: لا ينهار الموقع — يبقى المزوّد خارجاً،
// وزر الدخول في الواجهة يعرض رسالة واضحة بدل الفشل الصامت.
// وإن غاب NEXTAUTH_SECRET: يُولَّد سر عشوائي عند كل تشغيل للخادم
// (الجلسة تعمل لكنها لا تبقى عبر إعادة النشر — عيّن NEXTAUTH_SECRET
// في Vercel لتثبيت الجلسات).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

const handler = NextAuth({
  providers: googleConfigured
    ? [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET
        })
      ]
    : [],
  secret:
    process.env.NEXTAUTH_SECRET ||
    // سر مؤقت لكل تشغيل — لا يُكتب سر ثابت في الكود أبداً.
    (globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)),
  session: { strategy: 'jwt' },
  callbacks: {
    async session({ session, token }) {
      if (token?.email) session.user.email = token.email;
      if (token?.name) session.user.name = token.name;
      if (token?.picture) session.user.image = token.picture;
      return session;
    }
  }
});

export { handler as GET, handler as POST };
