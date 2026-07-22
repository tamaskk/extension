import { NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { Outbox } from '@/lib/models';
import { requireAdmin, isResponse } from '@/lib/apiUtil';

// Email outbox — in dev mode (no RESEND_API_KEY) this IS the inbox: the
// verification links and radar alerts land here, readable by the admin.
export async function GET() {
  const s = await requireAdmin();
  if (isResponse(s)) return s;
  await dbConnect();
  const emails = await Outbox.find().sort({ createdAt: -1 }).limit(50).lean() as unknown as
    { _id: unknown; to: string; subject: string; html: string; status: string; provider: string; error: string; createdAt: Date }[];
  return NextResponse.json({
    ok: true,
    emails: emails.map((e) => ({
      id: String(e._id), to: e.to, subject: e.subject, html: e.html,
      status: e.status, provider: e.provider, error: e.error, createdAt: e.createdAt,
    })),
  });
}
