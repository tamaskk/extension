import type { Folder, Lead, Project } from './types';
import { score } from './scoring';

// Build a fully-scored Lead from a small business description.
let cidCounter = 1000;
function lead(input: {
  name: string; category?: string; rating?: number; reviews?: number;
  phone?: string; website?: string; address?: string; lat?: number; lng?: number;
  booking?: boolean; cid?: string;
}): Lead {
  const cid = input.cid || `0x${(cidCounter++).toString(16)}`;
  const s = score({ website: input.website, reviewCount: input.reviews, hasBookingHint: input.booking ?? null });
  const dedupKey = cid;
  return {
    placeId: `PID_${input.name.replace(/\W+/g, '')}`,
    cid,
    dedupKey,
    name: input.name,
    category: input.category || 'Restaurant',
    rating: input.rating ?? null,
    reviewCount: input.reviews ?? null,
    phone: input.phone || '',
    website: input.website || '',
    email: '',
    address: input.address || '',
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    mapsUrl: `https://www.google.com/maps?cid=${cid}`,
    ...s,
  };
}

function project(query: string, name: string, createdAt: string, folderId: string | null, leads: Lead[]): Project {
  const records: Record<string, Lead> = {};
  for (const l of leads) records[l.dedupKey] = l;
  return { query, name, createdAt, folderId: folderId || undefined, records };
}

// Two shared businesses to demonstrate the duplicate finder across projects.
const sharedSalad = () => lead({ name: 'Salad House', category: 'Salad shop', rating: 4.4, reviews: 177, phone: '(201) 408-4015', website: '', address: '33 East Palisade Avenue, Englewood, NJ', cid: '0xSALAD' });
const sharedWonder = () => lead({ name: 'Wonder Financial District', category: 'Restaurant', rating: 4.3, reviews: 90, phone: '(855) 818-5755', website: '', address: '5 Hanover Square, New York, NY', cid: '0xWONDER' });

export function makeSeed(): { projects: Record<string, Project>; folders: Record<string, Folder> } {
  const folders: Record<string, Folder> = {
    f_manhattan: { id: 'f_manhattan', name: 'NYC Manhattan', createdAt: '2026-06-01T10:00:00Z', collapsed: true },
    f_brooklyn: { id: 'f_brooklyn', name: 'NYC Brooklyn', createdAt: '2026-06-02T10:00:00Z', collapsed: true },
  };

  const projects: Record<string, Project> = {};
  const add = (p: Project) => { projects[p.query] = p; };

  add(project('restaurants near Corona newyork', 'restaurants near Corona newyork', '2026-06-03T10:00:00Z', 'f_manhattan', [
    lead({ name: 'Park Side Restaurant', category: 'Italian restaurant', rating: 4.6, reviews: 3319, phone: '(718) 271-9321', website: 'https://parksiderestaurantny.com', address: '107-01 Corona Ave, Queens, NY' }),
    lead({ name: 'Rainhas Churrascaria', category: 'Brazilian restaurant', rating: 4.7, reviews: 11984, phone: '(718) 446-2245', website: '', address: '108-01 Northern Blvd, Queens, NY' }),
    lead({ name: 'Leo\'s Latticini', category: 'Deli', rating: 4.8, reviews: 412, website: '', address: '4602 104th St, Queens, NY' }),
    lead({ name: 'Tortilleria Nixtamal', category: 'Mexican restaurant', rating: 4.5, reviews: 38, website: 'https://facebook.com/nixtamal', address: '104-05 47th Ave, Queens, NY' }),
    sharedWonder(),
  ]));

  add(project('restaurants near Flatbush newyork', 'restaurants near Flatbush newyork', '2026-06-04T10:00:00Z', 'f_brooklyn', [
    lead({ name: 'Brooklyn Barbecue House', category: 'Grill restaurant', rating: 3.8, reviews: 19, phone: '(718) 256-0218', website: '', address: '8515 18th Ave, Brooklyn, NY' }),
    lead({ name: 'Pitkin Pork Truck', category: 'Restaurant', rating: 4.9, reviews: 12, website: '', address: '1594 Pitkin Ave, Brooklyn, NY' }),
    lead({ name: 'Gayle\'s Thrill & Grill', category: 'Restaurant', rating: 4.6, reviews: 18, phone: '(347) 277-5581', website: '', address: '140 Lott Ave, Brooklyn, NY' }),
    lead({ name: 'Condado', category: 'Spanish restaurant', rating: 4.1, reviews: 37, phone: '(718) 927-9302', website: 'https://condadobrooklyn.com', address: '444 Mother Gaston Blvd, Brooklyn, NY' }),
    sharedSalad(),
  ]));

  add(project('restaurants near Midwood newyork', 'restaurants near Midwood newyork', '2026-06-05T10:00:00Z', 'f_brooklyn', [
    lead({ name: 'Di Fara Pizza', category: 'Pizza restaurant', rating: 4.5, reviews: 2841, phone: '(718) 258-1367', website: 'https://difarapizzany.com', address: '1424 Avenue J, Brooklyn, NY' }),
    lead({ name: 'Taci\'s Beyti', category: 'Turkish restaurant', rating: 4.4, reviews: 760, website: '', address: '1955 Coney Island Ave, Brooklyn, NY' }),
    lead({ name: 'Mabat', category: 'Middle Eastern restaurant', rating: 4.3, reviews: 41, website: '', address: '1809 East 7th St, Brooklyn, NY' }),
    sharedSalad(),
    sharedWonder(),
  ]));

  add(project('dentists Miami', 'Dentists Miami', '2026-06-06T10:00:00Z', null, [
    lead({ name: 'Brickell City Dental', category: 'Dentist', rating: 4.9, reviews: 540, phone: '(305) 555-1212', website: 'https://brickellcitydental.com', address: '900 S Miami Ave, Miami, FL', booking: true }),
    lead({ name: 'Sunset Smiles', category: 'Dental clinic', rating: 4.2, reviews: 22, website: '', address: '5800 SW 73rd St, Miami, FL' }),
    lead({ name: 'Coral Gables Family Dental', category: 'Dentist', rating: 4.6, reviews: 9, phone: '(305) 444-9090', website: 'https://instagram.com/cgfamilydental', address: '2030 Ponce de Leon Blvd, Miami, FL' }),
  ]));

  add(project('roofers Dallas', 'Roofers Dallas', '2026-06-07T10:00:00Z', null, [
    lead({ name: 'Lone Star Roofing', category: 'Roofing contractor', rating: 4.8, reviews: 312, phone: '(214) 555-7788', website: 'https://lonestarroof.com', address: '1200 Main St, Dallas, TX' }),
    lead({ name: 'Apex Roofing Dallas', category: 'Roofing contractor', rating: 4.1, reviews: 12, website: 'https://facebook.com/apexroofdallas', address: '5050 Ross Ave, Dallas, TX' }),
    lead({ name: 'Metroplex Roof Pros', category: 'Roofing contractor', rating: 3.9, reviews: 7, website: '', address: '8080 Park Ln, Dallas, TX' }),
  ]));

  return { projects, folders };
}
