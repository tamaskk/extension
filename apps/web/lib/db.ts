import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;

// Cache the connection across hot reloads / serverless invocations.
interface Cached { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null; }
const g = globalThis as unknown as { __mongoose?: Cached };
const cached: Cached = g.__mongoose || (g.__mongoose = { conn: null, promise: null });

export async function dbConnect() {
  if (cached.conn) return cached.conn;
  if (!uri) throw new Error('MONGODB_URI is not set in the environment (.env)');
  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, { bufferCommands: false }).then((m) => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
