import { siteById, APP_ORIGIN } from '../lib/sites';
import { withDefaults } from '../../shared/site/data';
import { siteScript } from '../../shared/site/render';

// The tracking script for a website Gainora builds with Claude Code and hosts elsewhere:
//   <script src="https://app.gainora.co.uk/api/site-track/<site id>.js" defer></script>
// The same script builder sites have: counts visits, call taps ([data-track="call"]) and booking clicks
// ([data-track="book"]) into Command Centre, fills the enquiry form's page and source fields, and loads the owner's
// Google tags only after the visitor says yes. No cookies of its own. An unknown or unpublished site gets an empty script.
const js = (body: string, cache = 'public, max-age=300') => new Response(body, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': cache, 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' } });

export default async (req: Request) => {
  const id = (new URL(req.url).pathname.match(/\/api\/site-track\/([0-9a-f-]{36})\.js$/i) || [])[1] || '';
  try {
    const row = id ? await siteById(id) : null;
    if (!row?.published) return js('/* Gainora: this website isn’t published yet */', 'no-store');
    const html = siteScript(withDefaults(row.published), { base: '/', siteId: row.id, origin: '', api: APP_ORIGIN() });
    return js(html.replace(/^<script>/, '').replace(/<\/script>$/, ''));
  } catch (e: any) {
    console.error('[gainora] site track', e?.message);
    return js('', 'no-store');
  }
};
export const config = { path: '/api/site-track/*', method: 'GET' };
