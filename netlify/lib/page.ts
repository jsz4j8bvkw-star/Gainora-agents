// A plain, branded page for the few public pages Gainora shows outside the apps (proposals, unsubscribing).
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export { esc };
export function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Manrope:wght@400;500;600;700&display=swap">
<style>
:root{--ink:#1A1A1C;--soft:#55524C;--faint:#6E6A63;--line:#E4E3DF;--canvas:#F4F4F2;--gold:#7A6436;--champ:#C9B37E;--black:#111214}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:400 16px/1.6 Manrope,system-ui,sans-serif}
.top{background:var(--black);color:#E9E5DD;padding:18px max(20px,env(safe-area-inset-left))}.top b{font:600 22px/1 "Cormorant Garamond",Georgia,serif;letter-spacing:.02em}.top b span{color:var(--champ)}
main{max-width:720px;margin:0 auto;padding:40px max(20px,env(safe-area-inset-left)) 64px;display:grid;gap:24px}
h1{font:500 clamp(2rem,6vw,2.8rem)/1.1 "Cormorant Garamond",Georgia,serif;margin:0}h2{font:600 1.05rem/1.3 Manrope,sans-serif;margin:0 0 8px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:24px;display:grid;gap:14px}
.muted{color:var(--soft)}.small{font-size:.9rem}.faint{color:var(--faint)}
.item{display:grid;gap:4px;padding-bottom:14px;border-bottom:1px solid var(--line)}.item:last-child{border:0;padding:0}
.row{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.total{font:600 1.1rem/1.4 Manrope,sans-serif}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 26px;border-radius:8px;background:var(--black);color:#F6F2EA;font:600 1rem Manrope,sans-serif;border:1px solid var(--champ);cursor:pointer;width:100%}
.btn:hover{background:#2B2C30}.btn:focus-visible{outline:3px solid var(--champ);outline-offset:2px}
ol{margin:0;padding-left:20px;display:grid;gap:6px}a{color:var(--gold)}
.note{border-left:3px solid var(--champ);padding-left:14px;white-space:pre-line}
</style></head><body><header class="top"><b>Gainora<span>.</span></b></header><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' } });
}
