import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { Unlock } from '@/lib/models';
import { NextRequest } from 'next/server';
import { requireSessionOrKey, isResponse, jsonError } from '@/lib/apiUtil';
import { getLeadOrSnapshot, shapeLead } from '@/lib/leads';

// Free read — returns the lead shaped by whatever the user already unlocked.
// Falls back to the unlock-time snapshot if the source row was deleted.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const { id } = await ctx.params;
  await dbConnect();
  const doc = await getLeadOrSnapshot(id, new Types.ObjectId(s.uid));
  if (!doc) return jsonError(404, 'lead not found');

  const unlocks = await Unlock.find({ userId: new Types.ObjectId(s.uid), leadId: new Types.ObjectId(id) }).lean() as unknown as
    { scope: 'lead' | 'contact' }[];
  const flags = { lead: false, contact: false };
  for (const u of unlocks) flags[u.scope] = true;
  return NextResponse.json({ ok: true, lead: shapeLead(doc, flags) });
}
