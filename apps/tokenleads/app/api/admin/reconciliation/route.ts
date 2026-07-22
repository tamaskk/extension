import { NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { Reconciliation } from '@/lib/models';
import { requireAdmin, isResponse } from '@/lib/apiUtil';

export async function GET() {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  await dbConnect();
  const last = await Reconciliation.findOne().sort({ ranAt: -1 }).lean() as
    { ranAt: Date; checked: number; mismatches: unknown[]; fixed: number } | null;
  return NextResponse.json({ ok: true, last });
}
