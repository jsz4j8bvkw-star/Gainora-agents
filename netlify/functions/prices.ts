import { priceBook } from '../lib/business';
import { toWebsitePrices } from '../../shared/admin/prices';

// Gainora's prices for gainora.co.uk, from the price book in the admin. The website reads this when it's built.
//   GET /api/prices
export default async () => {
  try {
    return new Response(JSON.stringify({ prices: toWebsitePrices(await priceBook()) }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
  } catch {
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
};
export const config = { path: '/api/prices', method: 'GET' };
