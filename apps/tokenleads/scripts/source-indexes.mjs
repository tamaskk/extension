// Creates the search indexes on the SOURCE database (myapp.leads).
// Atlas builds indexes online — safe on a live collection, but run off-peak.
// Rollback: db.leads.dropIndex('<name>').
//
// Usage: MONGODB_URI=... node scripts/source-indexes.mjs
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const INDEXES = [
  // Unfiltered search sorts by leadScore desc — without this every page is a 1.1M-doc sort.
  { keys: { leadScore: -1, _id: 1 }, name: 'tl_leadscore_sort' },
  // Category is the most selective dropdown filter, sorted by score.
  { keys: { category: 1, leadScore: -1 }, name: 'tl_category_score' },
  // Website status ("no website" prospecting) + temperature filters.
  { keys: { websiteStatus: 1, leadScore: -1 }, name: 'tl_websitestatus_score' },
  { keys: { leadTemperature: 1, leadScore: -1 }, name: 'tl_temperature_score' },
];

const client = await MongoClient.connect(uri);
const col = client.db('myapp').collection('leads');

for (const idx of INDEXES) {
  const started = Date.now();
  try {
    const name = await col.createIndex(idx.keys, { name: idx.name, background: true });
    console.log(`created ${name} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(`failed ${idx.name}:`, e.message);
  }
}

console.log('\ncurrent indexes:');
for (const i of await col.indexes()) console.log(` - ${i.name}: ${JSON.stringify(i.key)}`);
await client.close();
