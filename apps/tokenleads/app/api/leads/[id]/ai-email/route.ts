import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { dbConnect } from '@/lib/db';
import { Unlock, AiDraft } from '@/lib/models';
import { requireSessionOrKey, requireVerified, isResponse, jsonError, rateLimited } from '@/lib/apiUtil';
import { getPricing } from '@/lib/pricing';
import { spend, credit, InsufficientTokensError } from '@/lib/tokens';
import { getLeadOrSnapshot, cityPart } from '@/lib/leads';
import { generateOutreach, AiUnavailableError, aiEnabled } from '@/lib/ai';
import { limit } from '@/lib/rateLimit';

// AI outreach draft for an unlocked lead. Costs AI_EMAIL_COST per generation
// (regenerating costs again — it's compute). If generation fails AFTER the
// charge, the tokens are refunded automatically.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const rl = limit(`ai:${s.uid}`, 5, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfter);
  const gate = await requireVerified(s);
  if (gate) return gate;
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return jsonError(400, 'invalid lead id');

  const body = await req.json().catch(() => ({}));
  const senderName = String(body?.senderName || '').slice(0, 80);
  const senderPitch = String(body?.senderPitch || '').slice(0, 400);

  await dbConnect();
  const userId = new Types.ObjectId(s.uid);
  const leadId = new Types.ObjectId(id);

  const unlock = await Unlock.findOne({ userId, leadId, scope: 'lead' }).lean();
  if (!unlock) return jsonError(409, 'lead not unlocked');

  const doc = await getLeadOrSnapshot(id, userId);
  if (!doc) return jsonError(404, 'lead not found');

  const pricing = await getPricing();
  let charged = 0;
  let balance: number | null = null;
  let txId: string | null = null;
  try {
    const r = await spend({
      userId: s.uid, cost: pricing.AI_EMAIL_COST, type: 'spend_ai',
      description: `AI e-mail generálás — ${doc.name || 'ismeretlen'}`,
      ref: { leadId },
    });
    charged = pricing.AI_EMAIL_COST;
    balance = r.balance;
    txId = r.txId;
  } catch (e) {
    if (e instanceof InsufficientTokensError) {
      return jsonError(402, 'insufficient_tokens', { balance: e.balance, required: e.required });
    }
    throw e;
  }

  try {
    const result = await generateOutreach({
      leadName: String(doc.name || ''), category: String(doc.category || ''),
      city: cityPart(doc.address as string | undefined),
      rating: doc.rating as number | null, reviewCount: doc.reviewCount as number | null,
      websiteStatus: String(doc.websiteStatus || ''),
      aiSummary: String(doc.aiSummary || ''), aiPainPoints: String(doc.aiPainPoints || ''),
      senderName, senderPitch,
    });
    await AiDraft.create({
      userId, leadId, input: { senderName, senderPitch },
      subject: result.subject, body: result.body, source: result.source,
    });
    return NextResponse.json({
      ok: true, draft: result, charged, balance, aiEnabled: aiEnabled(),
    });
  } catch (e) {
    // Generation failed after charging — refund.
    const refund = await credit({
      userId: s.uid, amount: pricing.AI_EMAIL_COST, type: 'refund',
      description: `Visszatérítés — AI e-mail generálás sikertelen (${doc.name || ''})`,
      ref: { leadId },
      idempotencyKey: txId ? `refund:ai:${txId}` : undefined,
    });
    if (e instanceof AiUnavailableError) {
      return jsonError(503, 'ai_unavailable', { reason: e.reason, balance: refund.balance, refunded: charged });
    }
    throw e;
  }
}

// Draft history for this lead.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSessionOrKey(req);
  if (isResponse(s)) return s;
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return jsonError(400, 'invalid lead id');
  await dbConnect();
  const drafts = await AiDraft.find({ userId: s.uid, leadId: id }).sort({ createdAt: -1 }).limit(10).lean() as unknown as
    { subject: string; body: string; source: string; createdAt: Date }[];
  return NextResponse.json({ ok: true, drafts: drafts.map((d) => ({ subject: d.subject, body: d.body, source: d.source, createdAt: d.createdAt })), aiEnabled: aiEnabled() });
}
