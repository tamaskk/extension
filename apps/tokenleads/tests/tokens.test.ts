// Token core invariants — the money path. Runs against an in-memory MongoDB.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120_000 } });
  process.env.MONGODB_URI = mongod.getUri('leadtokens-test');
  const { dbConnect } = await import('../lib/db');
  await dbConnect();
  // Unique indexes (idempotencyKey) build asynchronously — wait before testing them.
  const { TokenTransaction, Wallet } = await import('../lib/models');
  await TokenTransaction.init();
  await Wallet.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function libs() {
  const tokens = await import('../lib/tokens');
  const models = await import('../lib/models');
  return { ...tokens, ...models };
}

function uid() { return new Types.ObjectId().toString(); }

beforeEach(async () => {
  const { Wallet, TokenTransaction } = await libs();
  await Wallet.deleteMany({});
  await TokenTransaction.deleteMany({});
});

describe('credit()', () => {
  it('creates the wallet on first credit and records a ledger row', async () => {
    const { credit, Wallet, TokenTransaction } = await libs();
    const userId = uid();
    const r = await credit({ userId, amount: 25, type: 'signup_bonus', description: 'bónusz', idempotencyKey: `signup:${userId}` });
    expect(r.balance).toBe(25);

    const w = await Wallet.findOne({ userId }).lean() as { balance: number; lifetimeGranted: number };
    expect(w.balance).toBe(25);
    expect(w.lifetimeGranted).toBe(25);

    const txs = await TokenTransaction.find({ userId }).lean() as { amount: number; balanceAfter: number }[];
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(25);
    expect(txs[0].balanceAfter).toBe(25);
  });

  it('is idempotent on the same key', async () => {
    const { credit, Wallet } = await libs();
    const userId = uid();
    await credit({ userId, amount: 25, type: 'signup_bonus', description: 'x', idempotencyKey: `signup:${userId}` });
    const r2 = await credit({ userId, amount: 25, type: 'signup_bonus', description: 'x', idempotencyKey: `signup:${userId}` });
    expect(r2.duplicate).toBe(true);
    const w = await Wallet.findOne({ userId }).lean() as { balance: number };
    expect(w.balance).toBe(25); // not 50
  });
});

describe('spend()', () => {
  it('rejects when balance is insufficient and never goes negative', async () => {
    const { credit, spend, InsufficientTokensError, Wallet } = await libs();
    const userId = uid();
    await credit({ userId, amount: 3, type: 'signup_bonus', description: 'x' });
    await expect(spend({ userId, cost: 5, type: 'spend_search', description: 'k' }))
      .rejects.toBeInstanceOf(InsufficientTokensError);
    const w = await Wallet.findOne({ userId }).lean() as { balance: number };
    expect(w.balance).toBe(3);
  });

  it('exposes balance + required on the insufficiency error', async () => {
    const { credit, spend, InsufficientTokensError } = await libs();
    const userId = uid();
    await credit({ userId, amount: 1, type: 'signup_bonus', description: 'x' });
    try {
      await spend({ userId, cost: 2, type: 'spend_lead_unlock', description: 'u' });
      expect.unreachable();
    } catch (e) {
      const err = e as InstanceType<typeof InsufficientTokensError>;
      expect(err.balance).toBe(1);
      expect(err.required).toBe(2);
    }
  });

  it('handles concurrent spends without overdraft (10x10 against 50)', async () => {
    const { credit, spend, Wallet, TokenTransaction } = await libs();
    const userId = uid();
    await credit({ userId, amount: 50, type: 'purchase', description: 'p' });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        spend({ userId, cost: 10, type: 'spend_search', description: `s${i}` })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(5);

    const w = await Wallet.findOne({ userId }).lean() as { balance: number };
    expect(w.balance).toBe(0);

    const sum = (await TokenTransaction.find({ userId }).lean() as { amount: number }[])
      .reduce((s, t) => s + t.amount, 0);
    expect(sum).toBe(0); // +50 −5×10
  });

  it('compensates the decrement on idempotency-key collision', async () => {
    const { credit, spend, Wallet } = await libs();
    const userId = uid();
    await credit({ userId, amount: 20, type: 'purchase', description: 'p' });

    const key = `unlock:lead:${userId}:abc`;
    const r1 = await spend({ userId, cost: 2, type: 'spend_lead_unlock', description: 'u', idempotencyKey: key });
    expect(r1.duplicate).toBeUndefined();
    const r2 = await spend({ userId, cost: 2, type: 'spend_lead_unlock', description: 'u', idempotencyKey: key });
    expect(r2.duplicate).toBe(true);

    const w = await Wallet.findOne({ userId }).lean() as { balance: number };
    expect(w.balance).toBe(18); // charged exactly once
  });

  it('negative credit() routes through spend() and respects the floor', async () => {
    const { credit, InsufficientTokensError } = await libs();
    const userId = uid();
    await credit({ userId, amount: 10, type: 'purchase', description: 'p' });
    const r = await credit({ userId, amount: -4, type: 'admin_adjust', description: 'korrekció' });
    expect(r.balance).toBe(6);
    await expect(credit({ userId, amount: -100, type: 'admin_adjust', description: 'túl sok' }))
      .rejects.toBeInstanceOf(InsufficientTokensError);
  });
});
