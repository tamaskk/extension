import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { SavedSearch } from '@/lib/models';
import { requireSessionOrKey, isResponse, jsonError } from '@/lib/apiUtil';

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return jsonError(400, 'invalid id');
  const body = await req.json().catch(() => null);

  const patch: Record<string, unknown> = {};
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (['off', 'daily', 'weekly'].includes(body?.alert)) patch.alert = body.alert;
  if (!Object.keys(patch).length) return jsonError(400, 'nothing to update');

  await dbConnect();
  const doc = await SavedSearch.findOneAndUpdate({ _id: id, userId: s.uid }, { $set: patch }, { new: true }).lean();
  if (!doc) return jsonError(404, 'saved search not found');
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return jsonError(400, 'invalid id');
  await dbConnect();
  await SavedSearch.deleteOne({ _id: id, userId: s.uid });
  return NextResponse.json({ ok: true });
}
