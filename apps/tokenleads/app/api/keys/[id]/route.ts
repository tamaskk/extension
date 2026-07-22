import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { ApiKey } from '@/lib/models';
import { requireSession, isResponse, jsonError } from '@/lib/apiUtil';
import { logEvent } from '@/lib/monitoring';

// Revoke — takes effect immediately (lookups filter on revokedAt: null).
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (isResponse(s)) return s;
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return jsonError(400, 'invalid key id');
  await dbConnect();
  const result = await ApiKey.updateOne({ _id: id, userId: s.uid, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (!result.modifiedCount) return jsonError(404, 'key not found');
  logEvent('api_key_revoked', { userId: s.uid, keyId: id });
  return NextResponse.json({ ok: true });
}
