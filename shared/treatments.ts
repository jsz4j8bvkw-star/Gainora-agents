// A canonical catalogue of aesthetics and beauty treatments, and a matcher that maps the names
// businesses use ("Anti-Wrinkle – 3 Areas", "Lip Filler 1ml Juvederm", "Morpheus8 full face")
// to one catalogue entry plus the amount it is sold in. Prices are only ever compared like for
// like: the same treatment in the same amount (1 area vs 3 areas, 0.5ml vs 1ml, one session vs a
// course are all different rows). Pure logic, shared by the server, the app and the tests.
//
// The keyword matcher runs first. Only names it can't place go to the fast AI model, which may
// only answer with a catalogue id or "none"; the amount is always read from the name by code,
// never by the AI.

export type TreatmentGroup = 'Anti-wrinkle' | 'Fillers' | 'Skin boosters' | 'Skin treatments' | 'Laser and light' | 'Body' | 'Wellness' | 'Brows and lashes' | 'Nails';
export const GROUP_ORDER: TreatmentGroup[] = ['Anti-wrinkle', 'Fillers', 'Skin boosters', 'Skin treatments', 'Laser and light', 'Body', 'Wellness', 'Brows and lashes', 'Nails'];

/**
 * How the amount is read from the name:
 * - areas: anti-wrinkle areas; required, so "Anti-wrinkle from £150" is listed but not compared.
 * - ml: millilitres; required (lip filler is always sold by the ml).
 * - ml?: millilitres if stated, otherwise "per treatment" (cheek, jawline and other fillers).
 * - body: the area of the body (laser hair removal); required.
 */
type UnitKind = 'areas' | 'ml' | 'ml?' | 'body';

export interface Treatment { id: string; label: string; group: TreatmentGroup; unit?: UnitKind }
interface Def extends Treatment { test: (s: string) => boolean }

const has = (re: RegExp) => (s: string) => re.test(s);
const all = (...res: RegExp[]) => (s: string) => res.every((r) => r.test(s));
const FILL = /fill|augment|enhanc|volum|contour|define|definition|sculpt(?!ra)|\bml\b|\d\s*ml|juvederm|restylane|teosyal|belotero|stylage|revolax|rha\b/;
const NAILS_SKIP = /infill|in-fill|refill|removal|soak ?off|repair|nail art|file and polish|toes? only/;
const LASER_HAIR = /laser hair|hair removal|\blhr\b|diode|soprano|alexandrite|lightsheer|gentlelase|splendor/;

/** Order matters: the first entry that matches wins, so specific entries come before general ones. */
const DEFS: Def[] = [
  // Body and removals first, so "fat dissolving" and "filler dissolving" never read as filler.
  { id: 'fat-dissolving', label: 'Fat dissolving injections', group: 'Body', test: has(/fat dissolv|aqualyx|lemon ?bottle|kybella|belkyra|deoxycholic|lipolysis|desoface|lipo ?lab|\blipo inject/) },
  { id: 'filler-dissolving', label: 'Filler dissolving', group: 'Fillers', test: has(/dissolv|hyalase|hyaluronidase|hylase/) },
  { id: 'fat-freezing', label: 'Fat freezing', group: 'Body', test: has(/cryolipolysis|fat freez|coolsculpt|cryo ?sculpt/) },
  // Laser hair removal is priced by area of the body.
  { id: 'laser-hair-removal', label: 'Laser hair removal', group: 'Laser and light', unit: 'body', test: (s) => LASER_HAIR.test(s) && !/\bipl\b/.test(s) },
  // Anti-wrinkle, special areas first.
  { id: 'lip-flip', label: 'Lip flip (anti-wrinkle)', group: 'Anti-wrinkle', test: has(/lip flip/) },
  { id: 'masseter', label: 'Jaw slimming (masseter anti-wrinkle)', group: 'Anti-wrinkle', test: has(/masseter|jaw ?(slim|reduction|clench)|bruxism|teeth grinding/) },
  { id: 'hyperhidrosis', label: 'Excessive sweating (hyperhidrosis)', group: 'Anti-wrinkle', test: has(/hyperhidrosis|excessive sweat|sweat(ing)? (treatment|injections?)|underarm sweat/) },
  { id: 'anti-wrinkle', label: 'Anti-wrinkle', group: 'Anti-wrinkle', unit: 'areas', test: has(/anti ?wrinkle|botox|botulinum|bocouture|azzalure|dysport|xeomin|letybo|relfydess|alluzience|\btoxin|wrinkle relax|\bbtx\b|baby tox|tox(in)? treatment/) },
  // Fillers.
  { id: 'tear-trough-filler', label: 'Tear trough filler', group: 'Fillers', unit: 'ml?', test: has(/tear ?trough|under ?eye (filler|hollow)/) },
  { id: 'lip-filler', label: 'Lip filler', group: 'Fillers', unit: 'ml', test: (s) => /lip filler|lip augment|lip enhanc|russian lips?|lip (volume|plump)/.test(s) || (/\blips?\b/.test(s) && FILL.test(s) && !/lip (hydration|booster|balm|wax|tint|blush)|upper lip wax/.test(s)) },
  { id: 'cheek-filler', label: 'Cheek filler', group: 'Fillers', unit: 'ml?', test: all(/cheek/, FILL) },
  { id: 'jawline-filler', label: 'Jawline filler', group: 'Fillers', unit: 'ml?', test: all(/jaw ?line|\bjaw\b/, FILL) },
  { id: 'chin-filler', label: 'Chin filler', group: 'Fillers', unit: 'ml?', test: all(/\bchin\b/, FILL) },
  { id: 'nose-filler', label: 'Non-surgical nose job (nose filler)', group: 'Fillers', unit: 'ml?', test: has(/non ?surgical rhinoplasty|nose (filler|job|reshap)|\bnsr\b|liquid rhinoplasty/) },
  { id: 'smile-lines-filler', label: 'Smile lines filler', group: 'Fillers', unit: 'ml?', test: (s) => /nasolabial|smile lines?|nose to mouth/.test(s) && !/peel|facial/.test(s) },
  { id: 'marionette-filler', label: 'Marionette lines filler', group: 'Fillers', unit: 'ml?', test: has(/marionette/) },
  // Skin boosters and collagen stimulators.
  { id: 'profhilo', label: 'Profhilo', group: 'Skin boosters', test: has(/profhilo/) },
  { id: 'polynucleotides', label: 'Polynucleotides', group: 'Skin boosters', test: has(/polynucleotide|plinest|nucleofill|ameela|\bpn(s|\b) (treatment|eyes|face)|\bpdrn\b|salmon dna/) },
  { id: 'sculptra', label: 'Sculptra', group: 'Skin boosters', test: has(/sculptra|\bplla\b|poly ?l ?lactic/) },
  { id: 'skin-booster', label: 'Skin booster', group: 'Skin boosters', test: has(/skin ?booster|seventy ?hyal|sunekos|jalupro|skinvive|lumi eyes|volite|redensity|hydrafill|bio ?remodel|harmonyca|neauvia hydro|innoaesthetics|viscoderm/) },
  { id: 'prp', label: 'PRP (vampire facial)', group: 'Skin treatments', test: has(/\bprp\b|platelet rich|vampire/) },
  // Skin treatments.
  { id: 'rf-microneedling', label: 'RF microneedling (such as Morpheus8)', group: 'Skin treatments', test: (s) => /morpheus|potenza|secret rf|virtue rf|sylfirm|\brf micro|radio ?frequency micro|fractional rf|intensif/.test(s) || (/micro ?needl/.test(s) && /\brf\b|radio ?frequency/.test(s)) },
  { id: 'microneedling', label: 'Microneedling', group: 'Skin treatments', test: has(/micro ?needl|collagen induction|dermapen|skinpen|derma ?roll|\bcit\b/) },
  { id: 'hydrafacial', label: 'HydraFacial', group: 'Skin treatments', test: has(/hydr[ao] ?facial|hydro ?dermabrasion|aqua ?facial|hydro ?peel facial/) },
  { id: 'chemical-peel', label: 'Chemical peel', group: 'Skin treatments', test: (s) => /\bpeel|prx|biorepeel|bio ?re ?peel|obagi blue|jessner/.test(s) && !/(gel|polish|lash|nail|biab|mask)/.test(s) },
  { id: 'dermaplaning', label: 'Dermaplaning', group: 'Skin treatments', test: has(/derma ?plan/) },
  { id: 'microdermabrasion', label: 'Microdermabrasion', group: 'Skin treatments', test: has(/micro ?dermabrasion|diamond peel/) },
  { id: 'led', label: 'LED light therapy', group: 'Skin treatments', test: has(/\bled\b|light therapy|dermalux|lightwave|celluma|omnilux/) },
  // Laser and light (not hair removal).
  { id: 'hifu', label: 'HIFU skin tightening', group: 'Laser and light', test: has(/\bhifu\b|ultherapy|ultraformer|high intensity focused|sofwave/) },
  { id: 'ipl', label: 'IPL photofacial', group: 'Laser and light', test: (s) => /\bipl\b|photo ?facial|photo ?rejuv|\bbbl\b|broad ?band light|lumecca/.test(s) && !/hair/.test(s) },
  { id: 'laser-resurfacing', label: 'Laser skin resurfacing', group: 'Laser and light', test: has(/co2 laser|fraxel|laser resurfac|erbium|halo laser|moxi|clear ?\+ ?brilliant|pico ?(laser|facial)|laser facial|carbon (laser|peel)|hollywood (laser )?peel/) },
  // Wellness.
  { id: 'b12', label: 'Vitamin B12 injection', group: 'Wellness', test: has(/\bb ?12\b|vitamin b|cyanocobalamin|hydroxocobalamin/) },
  { id: 'iv-drip', label: 'IV vitamin drip', group: 'Wellness', test: has(/\biv\b|vitamin drip|nad\+|\bdrip\b/) },
  // Brows and lashes.
  { id: 'hd-brows', label: 'HD Brows', group: 'Brows and lashes', test: has(/\bhd brows?|high definition brows?/) },
  { id: 'brow-lamination', label: 'Brow lamination', group: 'Brows and lashes', test: has(/brow lami|laminated brows?|brow sculpt/) },
  { id: 'microblading', label: 'Microblading', group: 'Brows and lashes', test: has(/microblad|nano ?brows?|powder brows?|ombre brows?/) },
  { id: 'lash-lift', label: 'Lash lift', group: 'Brows and lashes', test: has(/lash lift|\blvl\b|lash lami|lash perm/) },
  // Nails.
  { id: 'biab', label: 'BIAB nails', group: 'Nails', test: (s) => /\bbiab\b|builder in a bottle|builder gel/.test(s) && !NAILS_SKIP.test(s) },
  { id: 'gel-pedicure', label: 'Gel pedicure', group: 'Nails', test: (s) => /(gel|shellac).*(pedi|toes|feet)|(pedi|toes|feet).*(gel|shellac)/.test(s) && !NAILS_SKIP.test(s) },
  { id: 'gel-manicure', label: 'Gel manicure', group: 'Nails', test: (s) => /(gel|shellac).*(mani|hands|fingers|nails|polish)|(mani|hands|fingers).*(gel|shellac)|^gel nails?$/.test(s) && !/acrylic|extension|pedi|toes|feet/.test(s) && !NAILS_SKIP.test(s) },
];

export const CATALOGUE: Treatment[] = DEFS.map(({ id, label, group, unit }) => ({ id, label, group, ...(unit ? { unit } : {}) }));
const BY_ID = new Map(DEFS.map((d) => [d.id, d]));
export const treatmentById = (id: string): Treatment | undefined => BY_ID.get(id);

/* ---------- Reading the amount ---------- */
const WORD_N: Record<string, number> = { one: 1, single: 1, two: 2, double: 2, three: 3, triple: 3, four: 4, five: 5, six: 6 };
const NAMED_AREAS = [/forehead/, /frown|glabella|between the brows/, /crow'?s ?feet|eye lines|around the eyes/, /bunny lines/, /gummy smile/, /chin (dimpl|pebbl)|dimpled chin/, /brow lift/, /neck|nefertiti|platysma/, /smokers'? lines|barcode/, /dao|mouth corners?|downturned/];

function areasIn(s: string): number | null {
  const m = s.match(/\b(\d|one|single|two|double|three|triple|four|five)\s*(?:x\s*)?(?:areas?|zones?|regions?)\b/) || s.match(/\bareas?\s*(?:x\s*)?(\d)\b/) || s.match(/\b(\d)\s*x\s*areas?/);
  if (m) { const n = WORD_N[m[1]] ?? Number(m[1]); return n >= 1 && n <= 6 ? n : null; }
  if (/full face/.test(s)) return null;
  const named = NAMED_AREAS.filter((re) => re.test(s)).length;
  return named ? named : null;
}

function mlIn(s: string): number | null {
  const m = s.match(/(\d+(?:\.\d+)?|\.\d+)\s*(?:ml|mls|millilit(?:re|er)s?|cc)\b/);
  if (m) { const n = Number(m[1]); return n > 0 && n <= 10 ? Math.round(n * 10) / 10 : null; }
  if (/half (a )?(ml|syringe)/.test(s)) return 0.5;
  if (/\b(one|full|whole) (ml|syringe)\b/.test(s)) return 1;
  return null;
}

const BODY: [RegExp, string][] = [
  [/hollywood/, 'Hollywood'], [/brazilian/, 'Brazilian'], [/extended bikini|deep bikini/, ''], [/bikini/, 'bikini line'],
  [/under ?arms?|armpits?|axilla/, 'underarms'], [/upper lip|top lip|\blip\b/, 'upper lip'], [/\bchin\b/, 'chin'], [/full face|whole face/, 'full face'],
  [/full legs?|whole legs?/, 'full legs'], [/half legs?|lower legs?|upper legs?|thighs?/, 'half legs'], [/full arms?|whole arms?/, 'full arms'], [/half arms?|forearms?|lower arms?/, 'half arms'],
  [/full back|\bback\b/, 'back'], [/chest/, 'chest'], [/abdomen|stomach|navel|happy trail/, 'stomach'], [/sideburns?/, 'sideburns'], [/neck/, 'neck'],
];
function bodyIn(s: string): string | null {
  const hits = BODY.filter(([re]) => re.test(s));
  if (hits.length !== 1 && !(hits.length === 2 && hits.some((h) => h[1] === 'bikini line') && hits.some((h) => /Hollywood|Brazilian/.test(h[1])))) return null; // combos and packages aren't compared
  return hits[0][1] || null;
}

/** A course of several sessions is a different thing to buy from one session. */
function courseIn(s: string): number | null {
  const m = s.match(/course of (\d+|two|three|four|five|six)/) || s.match(/\b(\d+|two|three|four|five|six)\s*(?:x\s*)?(?:sessions?|treatments?|vials?)\b/) || s.match(/\bpack(?:age)? of (\d+)/) || s.match(/\b(\d)\s*x\s*(?:sessions?|treatments?)/);
  if (!m) return null;
  const n = WORD_N[m[1]] ?? Number(m[1]);
  return n >= 2 && n <= 12 ? n : null;
}

/* ---------- Matching ---------- */
/** Lower case, plain apostrophes, dashes and slashes as spaces, so the patterns stay simple. */
export const plainName = (s: string) => String(s || '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/&/g, ' and ').replace(/[–—\-_/|:,()[\]+]/g, ' ').replace(/(\d)\s*\.\s*(\d)/g, '$1.$2').replace(/\s+/g, ' ').trim();

// Not something to compare: consultations, reviews, top-ups, deposits and vouchers. A name that
// only mentions a consultation in passing ("... with free consultation") is still a treatment.
const IGNORED_ANY = /top ?up|touch ?up|follow ?up|patch test|deposit|aftercare|check ?up|gift (card|voucher)|voucher|cancellation|no ?show|booking fee/;
const IGNORED_START = /^(free |complimentary |initial |skin |aesthetic |aesthetics |medical |virtual |online |video |new client |treatment )?(consultation|consult|review|assessment)\b/;
const IGNORED_END = /\b(consultation|consult|review|assessment)( appointment| only)?$/;
const isIgnored = (s: string) => IGNORED_ANY.test(s) || IGNORED_START.test(s) || (IGNORED_END.test(s) && !/\b(with|includ\w*|plus)\b/.test(s));

export interface TreatmentMatch {
  id: string;
  /** The comparison key: treatment plus amount; null when the amount the price is for isn't stated. */
  key: string | null;
  label: string;      // "Anti-wrinkle, 3 areas"
  base: string;       // "Anti-wrinkle"
  group: TreatmentGroup;
  amount: string | null; // "3 areas", "1ml", "underarms", "per treatment"
  course: number | null;
}
export type Classified = { kind: 'match'; match: TreatmentMatch } | { kind: 'ignored' } | { kind: 'unmatched' };

function buildMatch(def: Def, s: string): TreatmentMatch {
  const course = def.id === 'anti-wrinkle' ? null : courseIn(s);
  let amount: string | null = null;
  if (def.unit === 'areas') { const n = areasIn(s); amount = n ? `${n} area${n === 1 ? '' : 's'}` : null; }
  else if (def.unit === 'ml' || def.unit === 'ml?') { const n = mlIn(s); amount = n != null ? `${n}ml` : def.unit === 'ml?' ? 'per treatment' : null; }
  else if (def.unit === 'body') amount = bodyIn(s);
  const needs = def.unit === 'areas' || def.unit === 'ml' || def.unit === 'body';
  const known = !needs || amount != null;
  const parts = [def.label, ...(amount && amount !== 'per treatment' ? [amount] : []), ...(course ? [`course of ${course}`] : [])];
  return {
    id: def.id, base: def.label, group: def.group, amount, course,
    key: known ? [def.id, amount && amount !== 'per treatment' ? amount : '', course ? `x${course}` : ''].join('|') : null,
    label: parts.join(', '),
  };
}

/**
 * Places one service on the catalogue. `category` is the section it was listed under (Fresha lists
 * "3 areas" under "Anti-wrinkle"), used only when the name alone doesn't match. `learned` holds the
 * AI's answers for names the keywords couldn't place (plain name → catalogue id or "none").
 */
export function classifyService(name: string, category?: string | null, learned?: Record<string, string> | null): Classified {
  const s = plainName(name);
  if (!s) return { kind: 'unmatched' };
  const withCat = category ? plainName(`${category} ${name}`) : s;
  if (isIgnored(s)) return { kind: 'ignored' };
  for (const text of category ? [s, withCat] : [s]) {
    const def = DEFS.find((d) => d.test(text));
    if (def) return { kind: 'match', match: buildMatch(def, withCat) };
  }
  const hint = learned?.[s] ?? (category ? learned?.[withCat] : undefined);
  const def = hint && hint !== 'none' ? BY_ID.get(hint) : undefined;
  if (def) return { kind: 'match', match: buildMatch(def, withCat) };
  return { kind: 'unmatched' };
}

/** Names the keyword matcher couldn't place and the AI hasn't been asked about yet. */
export function leftovers(items: { name: string; category?: string | null }[], learned?: Record<string, string> | null, max = 40): string[] {
  const out: string[] = [];
  for (const it of items) {
    const s = plainName(it.name);
    if (!s || out.includes(s) || learned?.[s] !== undefined) continue;
    if (classifyService(it.name, it.category, learned).kind === 'unmatched') out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Keeps only AI answers that are a real catalogue id (or "none") for a name that was asked about. */
export function validateAiMatches(raw: any, asked: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const want = new Set(asked);
  for (const r of Array.isArray(raw) ? raw : []) {
    const name = plainName(String(r?.name ?? ''));
    const id = String(r?.id ?? '').trim();
    if (!want.has(name)) continue;
    out[name] = BY_ID.has(id) ? id : 'none';
  }
  for (const a of asked) out[a] ??= 'none'; // asked once; not asked again
  return out;
}

/** The catalogue as a short list for the AI prompt. */
export const catalogueForPrompt = () => DEFS.map((d) => `${d.id}: ${d.label} (${d.group})`).join('\n');

/** Caps the stored AI answers so the state stays small (newest kept). */
export function mergeLearned(prev: Record<string, string> | undefined, fresh: Record<string, string>, max = 400): Record<string, string> {
  const merged = { ...(prev ?? {}), ...fresh };
  const keys = Object.keys(merged);
  return keys.length <= max ? merged : Object.fromEntries(keys.slice(keys.length - max).map((k) => [k, merged[k]]));
}
