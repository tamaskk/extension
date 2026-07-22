import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { LeadMeta, Unlock, CRM_STATUSES } from '@/lib/models';
import { requireSessionOrKey, isResponse, jsonError } from '@/lib/apiUtil';

// Mini-CRM per unlocked lead: note, pipeline status, tags.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return jsonError(400, 'invalid lead id');
  await dbConnect();
  const meta = await LeadMeta.findOne({ userId: s.uid, leadId: id }).lean() as
    { note: string; status: string; tags: string[] } | null;
  return NextResponse.json({ ok: true, meta: meta ? { note: meta.note, status: meta.status, tags: meta.tags } : null });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return jsonError(400, 'invalid lead id');

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError(400, 'invalid body');

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.note === 'string') patch.note = body.note.slice(0, 5000);
  if (typeof body.status === 'string') {
    if (!(CRM_STATUSES as readonly string[]).includes(body.status)) return jsonError(400, 'invalid status');
    patch.status = body.status;
  }
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 20);
  }

  await dbConnect();
  const userId = new Types.ObjectId(s.uid);
  const leadId = new Types.ObjectId(id);

  // CRM only on leads the user owns.
  const unlock = await Unlock.findOne({ userId, leadId, scope: 'lead' }).lean();
  if (!unlock) return jsonError(409, 'lead not unlocked');

  const meta = await LeadMeta.findOneAndUpdate(
    { userId, leadId },
    { $set: patch },
    { new: true, upsert: true },
  ).lean() as unknown as { note: string; status: string; tags: string[] };
  return NextResponse.json({ ok: true, meta: { note: meta.note, status: meta.status, tags: meta.tags } });
}
