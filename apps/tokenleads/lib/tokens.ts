import { Types } from 'mongoose';
import { dbConnect } from './db';
import { Wallet, TokenTransaction, TxType } from './models';

export class InsufficientTokensError extends Error {
  constructor(public balance: number, public required: number) {
    super('insufficient_tokens');
  }
}

export interface TxRef { leadId?: string | Types.ObjectId | null; query?: string; purchaseId?: Types.ObjectId | null; }
export interface TxResult { balance: number; txId: string; duplicate?: boolean; }

interface SpendOpts {
  userId: string; cost: number; type: TxType; description: string;
  ref?: TxRef; idempotencyKey?: string;
}

// Race-safe spend:
//  1. conditional atomic decrement — balance can never go negative, no lock needed
//  2. append ledger row; a duplicate idempotencyKey (double-click / client retry)
//     means someone else already charged this exact action → compensate the
//     decrement and report the existing transaction instead of charging twice
export async function spend(opts: SpendOpts): Promise<TxResult> {
  await dbConnect();
  const userId = new Types.ObjectId(opts.userId);
  const cost = Math.floor(opts.cost);
  if (cost < 0) throw new Error('spend() cost must be >= 0');

  if (cost === 0) {
    const w = await Wallet.findOne({ userId }).lean() as { balance: number } | null;
    return { balance: w?.balance ?? 0, txId: '' };
  }

  const w = await Wallet.findOneAndUpdate(
    { userId, balance: { $gte: cost } },
    { $inc: { balance: -cost, lifetimeSpent: cost }, $set: { updatedAt: new Date() } },
    { new: true },
  ).lean() as { balance: number } | null;

  if (!w) {
    const cur = await Wallet.findOne({ userId }).lean() as { balance: number } | null;
    throw new InsufficientTokensError(cur?.balance ?? 0, cost);
  }

  try {
    const tx = await TokenTransaction.create({
      userId, type: opts.type, amount: -cost, balanceAfter: w.balance,
      description: opts.description, ref: opts.ref || {},
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
    return { balance: w.balance, txId: String(tx._id) };
  } catch (e: unknown) {
    if ((e as { code?: number })?.code === 11000 && opts.idempotencyKey) {
      // Concurrent duplicate — undo our decrement, surface the original tx.
      const undone = await Wallet.findOneAndUpdate(
        { userId },
        { $inc: { balance: cost, lifetimeSpent: -cost }, $set: { updatedAt: new Date() } },
        { new: true },
      ).lean() as { balance: number } | null;
      const existing = await TokenTransaction.findOne({ idempotencyKey: opts.idempotencyKey }).lean() as { _id: Types.ObjectId } | null;
      return { balance: undone?.balance ?? w.balance + cost, txId: existing ? String(existing._id) : '', duplicate: true };
    }
    throw e;
  }
}

interface CreditOpts {
  userId: string | Types.ObjectId; amount: number; type: TxType; description: string;
  ref?: TxRef; idempotencyKey?: string;
}

export async function credit(opts: CreditOpts): Promise<TxResult> {
  await dbConnect();
  const userId = new Types.ObjectId(opts.userId);
  const amount = Math.floor(opts.amount);
  if (amount === 0) {
    const w = await Wallet.findOne({ userId }).lean() as { balance: number } | null;
    return { balance: w?.balance ?? 0, txId: '' };
  }

  // Negative admin adjustments go through spend() semantics elsewhere; credit()
  // accepts negatives only for admin_adjust and lets balance floor at whatever
  // the conditional matched (no $gte guard would allow negatives — so guard it).
  if (amount < 0) {
    return spend({
      userId: String(userId), cost: -amount, type: opts.type,
      description: opts.description, ref: opts.ref, idempotencyKey: opts.idempotencyKey,
    });
  }

  const w = await Wallet.findOneAndUpdate(
    { userId },
    { $inc: { balance: amount, lifetimeGranted: amount }, $set: { updatedAt: new Date() } },
    { new: true, upsert: true },
  ).lean() as { balance: number };

  try {
    const tx = await TokenTransaction.create({
      userId, type: opts.type, amount, balanceAfter: w.balance,
      description: opts.description, ref: opts.ref || {},
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
    return { balance: w.balance, txId: String(tx._id) };
  } catch (e: unknown) {
    if ((e as { code?: number })?.code === 11000 && opts.idempotencyKey) {
      const undone = await Wallet.findOneAndUpdate(
        { userId },
        { $inc: { balance: -amount, lifetimeGranted: -amount }, $set: { updatedAt: new Date() } },
        { new: true },
      ).lean() as { balance: number } | null;
      const existing = await TokenTransaction.findOne({ idempotencyKey: opts.idempotencyKey }).lean() as { _id: Types.ObjectId } | null;
      return { balance: undone?.balance ?? w.balance - amount, txId: existing ? String(existing._id) : '', duplicate: true };
    }
    throw e;
  }
}
