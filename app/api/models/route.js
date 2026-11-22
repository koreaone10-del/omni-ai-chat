import { NextResponse } from 'next/server';
import { PROVIDERS } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/models — الكتالوج العام فقط، بلا أي أسرار.
export async function GET() {
  const safe = PROVIDERS.map((p) => ({
    id: p.id, name: p.name, baseURL: p.baseURL, needsKey: p.needsKey,
    freeTier: p.freeTier, signup: p.signup, models: p.models, supportsVision: p.supportsVision
  }));
  return NextResponse.json({ providers: safe });
}
