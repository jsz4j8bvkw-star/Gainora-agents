import { HttpError } from '../lib/core';
import { addPhoto, askByToken, finishAsk, removePhoto, saveAnswers } from '../lib/asks';
import { esc, page } from '../lib/page';
import { type Ask, progressOf, type Question } from '../../shared/admin/asks';

// The questions a client is sent by Gainora, as a short form that works on a phone. Answers save as they type;
// photos upload one by one (resized in the browser first). Nothing here needs a login: the link is the key.
//   GET  /q/<token>               the form (or a thank-you with their answers once sent)
//   POST /q/<token>/save          {answers}            saves progress
//   POST /q/<token>/send          {answers}            sends it to Gainora
//   POST /q/<token>/photo?question=<id>&name=<file>   one photo (image/jpeg, png or webp)
//   POST /q/<token>/remove        {url}                takes a photo out
//   POST /q/<token>               (form fallback without JavaScript) sends it

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const fail = (e: any) => reply({ error: e instanceof HttpError ? e.message : 'That didn’t save. Try again.' }, e instanceof HttpError ? e.status : 500);

function field(q: Question, a: Ask): string {
  const id = `q_${q.id}`;
  const v = a.answers[q.id] ?? '';
  const help = q.help ? `<span class="help" id="${id}_h">${esc(q.help)}</span>` : '';
  const desc = q.help ? ` aria-describedby="${id}_h"` : '';
  if (q.type === 'text') return `<div class="q"><label for="${id}">${esc(q.label)}</label>${help}<input id="${id}" name="${esc(q.id)}" type="text" value="${esc(v)}"${desc} autocomplete="off"></div>`;
  if (q.type === 'yesno') return `<fieldset class="q"><legend>${esc(q.label)}</legend>${help}<div class="yn"><label><input type="radio" name="${esc(q.id)}" value="yes"${v === 'yes' ? ' checked' : ''}> Yes</label><label><input type="radio" name="${esc(q.id)}" value="no"${v === 'no' ? ' checked' : ''}> No</label></div></fieldset>`;
  if (q.type === 'choice' || q.type === 'multi') {
    const kind = q.type === 'choice' ? 'radio' : 'checkbox';
    const picked = q.type === 'multi' ? v.split('\n') : [v];
    return `<fieldset class="q"><legend>${esc(q.label)}</legend>${help}<div class="opts">${(q.options ?? []).map((o) => `<label><input type="${kind}" name="${esc(q.id)}" value="${esc(o)}"${picked.includes(o) ? ' checked' : ''}> <span>${esc(o)}</span></label>`).join('')}</div></fieldset>`;
  }
  if (q.type === 'photos') {
    const files = a.files.filter((f) => f.question === q.id);
    return `<div class="q photos" data-q="${esc(q.id)}"><span class="lbl" id="${id}_l">${esc(q.label)}</span>${help}
<ul class="thumbs" aria-label="Photos added">${files.map((f) => `<li><img src="${esc(f.url)}" alt="${esc(f.name)}"><button type="button" class="rm" data-url="${esc(f.url)}" aria-label="Remove ${esc(f.name)}">Remove</button></li>`).join('')}</ul>
<label class="btn btn-quiet pick">Add photos<input type="file" accept="image/*" multiple data-q="${esc(q.id)}" aria-labelledby="${id}_l"></label><span class="up" aria-live="polite"></span></div>`;
  }
  return `<div class="q"><label for="${id}">${esc(q.label)}</label>${help}<textarea id="${id}" name="${esc(q.id)}" rows="${q.type === 'links' ? 3 : 4}"${desc}${q.type === 'links' ? ' placeholder="One link per line"' : ''}>${esc(v)}</textarea></div>`;
}

function form(a: Ask): Response {
  const groups: { name: string; qs: Question[] }[] = [];
  for (const q of a.questions) { const g = q.group || ''; const last = groups[groups.length - 1]; if (last && last.name === g) last.qs.push(q); else groups.push({ name: g, qs: [q] }); }
  const p = progressOf(a);
  const body = `<p class="small faint">From Gainora${a.due_on && a.status !== 'answered' ? ` · please answer by ${esc(new Date(`${a.due_on}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }))}` : ''}</p>
<h1>${esc(a.title)}</h1>
${a.intro ? `<p class="muted">${esc(a.intro)}</p>` : ''}
<form id="f" method="post" action="/q/${esc(a.token)}" novalidate>
${groups.map((g) => `<section class="card">${g.name ? `<h2>${esc(g.name)}</h2>` : ''}${g.qs.map((q) => field(q, a)).join('')}</section>`).join('\n')}
<section class="card send"><p class="small muted" id="saved" aria-live="polite">${p.answered ? `${p.answered} of ${p.total} answered. Saved.` : 'Your answers save as you type.'}</p>
<button class="btn" type="submit" id="go">${a.status === 'answered' ? 'Send the changes to Gainora' : 'Send to Gainora'}</button>
<p class="small faint">Photos you add may be used on your website. Questions? Reply to the email this link came in.</p></section>
</form>
<style>
.q{display:grid;gap:6px;margin:0 0 18px;border:0;padding:0}.q:last-child{margin-bottom:0}
.q label,.q legend,.q .lbl{font-weight:600;font-size:.98rem;line-height:1.4;padding:0}
.help{font-size:.88rem;color:var(--soft)}
input[type=text],textarea{width:100%;font:inherit;font-size:16px;padding:12px 14px;border:1px solid #CFCBC3;border-radius:8px;background:#fff;color:var(--ink)}
input[type=text]:focus,textarea:focus{outline:3px solid var(--champ);outline-offset:1px;border-color:var(--ink)}
textarea{resize:vertical;min-height:96px}
.yn{display:flex;gap:18px}.yn label{display:flex;align-items:center;gap:8px;font-weight:500;min-height:44px}.yn input,.opts input{width:20px;height:20px;accent-color:var(--black);flex:none}
.opts{display:grid;gap:2px}.opts label{display:flex;align-items:center;gap:10px;font-weight:500;min-height:44px;line-height:1.35}
.thumbs{list-style:none;margin:4px 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
.thumbs li{display:grid;gap:4px}.thumbs img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.rm{background:none;border:0;color:var(--gold);font:inherit;font-size:.85rem;text-decoration:underline;cursor:pointer;padding:4px 0;text-align:left}
.pick{position:relative;width:auto;background:#fff;color:var(--ink);border:1px solid var(--ink);min-height:48px}.pick input{position:absolute;inset:0;opacity:0;cursor:pointer}
.pick:focus-within{outline:3px solid var(--champ);outline-offset:2px}
.up{font-size:.9rem;color:var(--soft)}
h2{font:600 1.05rem/1.3 Manrope,sans-serif;margin:0 0 14px}
.send{gap:12px}
</style>
<script>
(function(){
  var f=document.getElementById('f'),saved=document.getElementById('saved'),go=document.getElementById('go'),base='/q/${esc(a.token)}',timer=null,busy=false;
  function data(){var o={};f.querySelectorAll('input[type=text],textarea').forEach(function(e){o[e.name]=e.value});f.querySelectorAll('input[type=radio]:checked').forEach(function(e){o[e.name]=e.value});f.querySelectorAll('input[type=checkbox]').forEach(function(e){if(!(e.name in o))o[e.name]='';if(e.checked)o[e.name]+=(o[e.name]?'\\n':'')+e.value});return o}
  function post(path,body,type){return fetch(base+path,{method:'POST',headers:{'Content-Type':type||'application/json'},body:type?body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Not saved');return j})})}
  function save(){clearTimeout(timer);saved.textContent='Saving…';return post('/save',{answers:data()}).then(function(j){saved.textContent=j.answered+' of '+j.total+' answered. Saved.'}).catch(function(e){saved.textContent=e.message+' Your answers are still here; try again in a moment.'})}
  f.addEventListener('input',function(e){if(e.target.type==='file')return;clearTimeout(timer);timer=setTimeout(save,1200)});
  f.addEventListener('change',function(e){if(e.target.type==='radio'||e.target.type==='checkbox')save()});
  f.addEventListener('submit',function(e){e.preventDefault();if(busy)return;busy=true;go.disabled=true;go.textContent='Sending…';post('/send',{answers:data()}).then(function(){location.href=base+'?sent=1'}).catch(function(err){busy=false;go.disabled=false;go.textContent='Send to Gainora';saved.textContent=err.message})});
  function shrink(file){return new Promise(function(res){if(!/^image\\//.test(file.type)){res(null);return}var img=new Image(),u=URL.createObjectURL(file);img.onload=function(){var m=2400,w=img.naturalWidth,h=img.naturalHeight,s=Math.min(1,m/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.round(w*s);c.height=Math.round(h*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(u);c.toBlob(function(b){res(b)},'image/jpeg',0.85)};img.onerror=function(){URL.revokeObjectURL(u);res(/^image\\/(jpeg|png|webp)$/.test(file.type)?file:null)};img.src=u})}
  function thumb(list,file){var li=document.createElement('li');li.innerHTML='<img alt=""><button type="button" class="rm">Remove</button>';li.querySelector('img').src=file.url;li.querySelector('img').alt=file.name;var b=li.querySelector('.rm');b.dataset.url=file.url;b.setAttribute('aria-label','Remove '+file.name);list.appendChild(li)}
  f.querySelectorAll('input[type=file]').forEach(function(inp){inp.addEventListener('change',function(){var box=inp.closest('.photos'),list=box.querySelector('.thumbs'),st=box.querySelector('.up'),files=[].slice.call(inp.files),n=0;inp.value='';
    (function next(){if(!files.length){st.textContent=n?n+' photo'+(n===1?'':'s')+' added.':'';return}var file=files.shift();st.textContent='Adding '+file.name+'…';shrink(file).then(function(b){if(!b)throw new Error(file.name+' isn’t a photo we can use. Choose a JPEG or PNG.');return post('/photo?question='+encodeURIComponent(inp.dataset.q)+'&name='+encodeURIComponent(file.name),b,b.type||'image/jpeg')}).then(function(j){thumb(list,j.file);n++;next()}).catch(function(e){st.textContent=e.message;files=[]})})()})});
  f.addEventListener('click',function(e){var b=e.target.closest('.rm');if(!b)return;var li=b.closest('li');post('/remove',{url:b.dataset.url}).then(function(){li.remove()}).catch(function(err){alert(err.message)})});
})();
</script>`;
  return page(a.title, body);
}

function thanks(a: Ask): Response {
  const body = `<h1>Thank you</h1>
<div class="card"><p>We’ve got your answers${a.files.length ? ` and ${a.files.length} photo${a.files.length === 1 ? '' : 's'}` : ''}. We’ll be in touch if anything’s unclear.</p>
<p class="small muted">Thought of something else? <a href="/q/${esc(a.token)}?edit=1">Add to or change your answers</a>.</p></div>
<section class="card" aria-label="Your answers">${a.questions.map((q) => `<div class="item"><strong class="small">${esc(q.label)}</strong><span class="small muted" style="white-space:pre-line">${q.type === 'photos' ? `${a.files.filter((f) => f.question === q.id).length} photo(s)` : q.type === 'yesno' ? (a.answers[q.id] === 'yes' ? 'Yes' : a.answers[q.id] === 'no' ? 'No' : '–') : q.type === 'multi' ? esc((a.answers[q.id] || '–').split('\n').join(', ')) : esc(a.answers[q.id] || '–')}</span></div>`).join('')}</section>`;
  return page('Thank you', body);
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const [, , token = '', action = ''] = url.pathname.split('/');
  const a = await askByToken(token).catch(() => null);
  if (!a || a.status === 'cancelled' || a.status === 'draft') {
    if (req.method !== 'GET') return reply({ error: 'This link isn’t available any more.' }, 404);
    return page('Questions', '<h1>This link isn’t available</h1><p class="muted">It may have been replaced by a newer one. Email <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a> and we’ll send you the right link.</p>', 404);
  }
  try {
    if (req.method === 'GET') {
      if (a.status === 'answered' && url.searchParams.get('edit') !== '1') return thanks(a);
      if (url.searchParams.get('sent') === '1') return thanks(a);
      if (a.status === 'sent') await saveAnswers(a, {}).catch(() => {});   // marks it opened
      return form(a);
    }
    if (req.method !== 'POST') return reply({ error: 'Not allowed.' }, 405);
    if (action === 'photo') {
      const file = await addPhoto(a, String(url.searchParams.get('question') || ''), String(url.searchParams.get('name') || ''), String(req.headers.get('content-type') || '').split(';')[0], await req.arrayBuffer());
      return reply({ file });
    }
    if (action === 'remove') { const b = await req.json().catch(() => ({})); await removePhoto(a, String(b.url || '')); return reply({ ok: true }); }
    if (action === 'save') { const b = await req.json().catch(() => ({})); const s = await saveAnswers(a, b.answers); return reply({ ok: true, ...progressOf(s) }); }
    if (action === 'send') { const b = await req.json().catch(() => ({})); await finishAsk(a, b.answers); return reply({ ok: true }); }
    if (!action) {
      // Without JavaScript: an ordinary form post.
      const fd = await req.formData().catch(() => null);
      const raw: Record<string, string> = {};
      fd?.forEach((v, k) => { if (typeof v === 'string') raw[k] = raw[k] ? `${raw[k]}\n${v}` : v; });   // ticked boxes arrive one by one
      await finishAsk(a, raw);
      return Response.redirect(`${url.origin}/q/${a.token}?sent=1`, 303);
    }
    return reply({ error: 'Unknown action.' }, 404);
  } catch (e: any) {
    if (!(e instanceof HttpError)) console.error('[gainora] ask', e?.message);
    return fail(e);
  }
};
export const config = { path: '/q/*' };
