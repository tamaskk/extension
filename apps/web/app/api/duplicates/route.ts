import { dbConnect } from '@/lib/db';
import { Lead, CORS, json } from '@/lib/models';

export const runtime = 'nodejs';
export function OPTIONS() { return new Response(null, { headers: CORS }); }

// Group leads that appear in more than one project by identity
// (cid → placeId → name+coords) — computed server-side over the whole DB.
export async function GET() {
  await dbConnect();
  const groups = await Lead.aggregate([
    { $addFields: {
      _idkey: { $switch: { branches: [
        { case: { $and: [{ $ne: ['$cid', null] }, { $ne: ['$cid', ''] }] }, then: { $concat: ['cid:', '$cid'] } },
        { case: { $and: [{ $ne: ['$placeId', null] }, { $ne: ['$placeId', ''] }] }, then: { $concat: ['pid:', '$placeId'] } },
      ], default: { $concat: ['nm:', { $toLower: { $ifNull: ['$name', ''] } }] } } },
    } },
    { $group: {
      _id: '$_idkey',
      count: { $sum: 1 },
      name: { $first: '$name' },
      address: { $first: '$address' },
      items: { $push: { project: '$project', key: '$dedupKey', name: '$name', category: '$category', rating: '$rating', reviewCount: '$reviewCount', checked: '$checked' } },
    } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1, name: 1 } },
    { $limit: 2000 },
  ]);
  return json(groups.map((g) => ({ name: g.name, address: g.address, items: g.items })));
}
