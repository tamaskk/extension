import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { dbConnect } from '@/lib/db';
import { ApiKey } from '@/lib/models';
import { requireSession, isResponse, jsonError } from '@/lib/apiUtil';
import { logEvent } from '@/lib/monitoring';

const MAX_KEYS = 5;

export async function GET() {
  const s = await requireSession();
  if (isResponse(s)) return s;
  await dbConnect();
  const keys = await ApiKey.find({ userId: s.uid, revokedAt: null }).sort({ createdAt: -1 }).lean() as unknown as
    { _id: unknown; name: string; prefix: string; lastUsedAt: Date | null; createdAt: Date }[];
  return NextResponse.json({
    ok: true,
    keys: keys.map((k) => ({ id: String(k._id), name: k.name, prefix: k.prefix, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt })),
  });
}

// Creates a key. The FULL key is returned exactly once — only its sha256
// hash is stored, so it cannot be shown again.
export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (isResponse(s)) return s;
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || 'API kulcs').trim().slice(0, 60);

  await dbConnect();
  const count = await ApiKey.countDocuments({ userId: s.uid, revokedAt: null });
  if (count >= MAX_KEYS) return jsonError(409, `max ${MAX_KEYS} active keys`);

  const raw = `tl_live_${randomBytes(24).toString('hex')}`;
  const keyHash = createHash('sha256').update(raw).digest('hex');
  const doc = await ApiKey.create({ userId: s.uid, name, prefix: raw.slice(0, 12) + '…', keyHash });
  logEvent('api_key_created', { userId: s.uid, keyId: String(doc._id) });
  return NextResponse.json({ ok: true, id: String(doc._id), key: raw, prefix: doc.prefix });
}
