import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/config — هل بيانات Google OAuth مضبوطة؟
// لا يرجع أي سر، فقط علامة منطقية تستعملها الواجهة لإظهار
// رسالة الإعداد بدل الفشل الصامت عند الضغط على زر الدخول.
export async function GET() {
  return NextResponse.json({
    googleConfigured: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    )
  });
}
