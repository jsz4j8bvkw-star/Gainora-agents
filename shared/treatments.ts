// A canonical catalogue of aesthetics and beauty treatments, a deterministic matcher from the
// names businesses actually use to catalogue ids, and the like-for-like price comparison.
//
// Rules the comparison keeps:
// - Never compare different units: 1ml with 1ml, one area with one area, a course with a course.
// - "From £X" is a minimum, shown as such and used as the lowest a business charges.
// - £0 lines, deposits, consultations, reviews, patch tests and top-ups never count.
// - Every figure keeps its source link and the date it was read.
// - Averages and ranges are only over the businesses that list a price for that exact treatment.

import type { ServiceLine } from './competitors';
import { priceValue } from './prices';

export type Group = 'Injectables' | 'Skin' | 'Laser and energy' | 'Body' | 'Brows and lashes' | 'Nails' | 'Hair removal' | 'Hair' | 'Massage and spa' | 'Other';

export interface Treatment { id: string; label: string; group: Group; match: RegExp; unit?: RegExp; not?: RegExp }

/* Names people use, in all their variety. Order matters only for specificity: the most specific entry that matches wins. */
export const CATALOGUE: Treatment[] = [
  // Anti-wrinkle by area
  { id: 'aw-1', label: 'Anti-wrinkle injections, 1 area', group: 'Injectables', match: /anti.?wrinkle|botox|botulinum|wrinkle relax|tox\b|azzalure|bocouture|frown|forehead lines|crow'?s feet/i, unit: /\b(1|one|single)\s*(area|zone)s?\b|\bforehead only\b|\bcrow'?s feet only\b/i, not: /\b(2|two|3|three|4|four)\s*(area|zone)s?\b/i },
  { id: 'aw-2', label: 'Anti-wrinkle injections, 2 areas', group: 'Injectables', match: /anti.?wrinkle|botox|botulinum|wrinkle relax|tox\b|azzalure|bocouture/i, unit: /\b(2|two)\s*(area|zone)s?\b/i },
  { id: 'aw-3', label: 'Anti-wrinkle injections, 3 areas', group: 'Injectables', match: /anti.?wrinkle|botox|botulinum|wrinkle relax|tox\b|azzalure|bocouture/i, unit: /\b(3|three)\s*(area|zone)s?\b|\bupper face\b|\bfull face\b/i },
  { id: 'aw-unspecified', label: 'Anti-wrinkle injections (areas not stated)', group: 'Injectables', match: /anti.?wrinkle|botox|botulinum|wrinkle relax|azzalure|bocouture/i, not: /\b(1|one|single|2|two|3|three|4|four)\s*(area|zone)s?\b|forehead|crow|frown|upper face|full face|masseter|jaw|sweat|hyperhidrosis|lip flip|top.?up/i },
  { id: 'aw-masseter', label: 'Masseter (jaw slimming) injections', group: 'Injectables', match: /masseter|jaw slim|teeth grind|bruxism/i },
  { id: 'aw-hyperhidrosis', label: 'Sweat-reduction injections', group: 'Injectables', match: /hyperhidrosis|sweat/i },
  { id: 'aw-lipflip', label: 'Lip flip', group: 'Injectables', match: /lip flip/i },
  // Fillers by amount
  { id: 'lip-0.5', label: 'Lip filler, 0.5ml', group: 'Injectables', match: /lip (filler|augment|enhance|plump)|lips\b.*filler|filler.*\blips?\b|russian lip/i, unit: /\b0?[.,]5\s?ml\b|half (a )?(ml|syringe)|\b½\s?ml/i },
  { id: 'lip-0.7', label: 'Lip filler, 0.7ml', group: 'Injectables', match: /lip (filler|augment|enhance|plump)|lips\b.*filler|filler.*\blips?\b|russian lip/i, unit: /\b0?[.,]7\s?ml\b/i },
  { id: 'lip-1', label: 'Lip filler, 1ml', group: 'Injectables', match: /lip (filler|augment|enhance|plump)|lips\b.*filler|filler.*\blips?\b|russian lip/i, unit: /\b1(\.0|\.1)?\s?ml\b|\bfull (ml|syringe)\b|\b1\s?syringe\b/i, not: /\b0?[.,][57]\s?ml\b/i },
  { id: 'lip-2', label: 'Lip filler, 2ml', group: 'Injectables', match: /lip (filler|augment|enhance|plump)|lips\b.*filler/i, unit: /\b2(\.0)?\s?ml\b/i },
  { id: 'lip-unspecified', label: 'Lip filler (amount not stated)', group: 'Injectables', match: /lip (filler|augment|enhance|plump)|lips\b.*filler|filler.*\blips?\b|russian lip/i, not: /\d\s?ml|syringe|flip|dissolv|top.?up/i },
  { id: 'filler-1', label: 'Dermal filler, 1ml (area not stated)', group: 'Injectables', match: /dermal filler|\bfiller\b/i, unit: /\b1(\.0)?\s?ml\b/i, not: /lip|cheek|jaw|chin|tear|nasolabial|marionette|nose|dissolv|\b[2-4]\s?ml/i },
  { id: 'cheek-1', label: 'Cheek filler, 1ml', group: 'Injectables', match: /cheek/i, unit: /\b1(\.0)?\s?ml\b/i, not: /\b2\s?ml\b/i },
  { id: 'cheek-2', label: 'Cheek filler, 2ml', group: 'Injectables', match: /cheek/i, unit: /\b2(\.0)?\s?ml\b/i },
  { id: 'jaw-1', label: 'Jawline filler, 1ml', group: 'Injectables', match: /jaw(line)? (filler|contour|sculpt)|filler.*jaw/i, unit: /\b1(\.0)?\s?ml\b/i, not: /\b[2-4]\s?ml\b/i },
  { id: 'jaw-2', label: 'Jawline filler, 2ml', group: 'Injectables', match: /jaw(line)? (filler|contour|sculpt)|filler.*jaw/i, unit: /\b2(\.0)?\s?ml\b/i },
  { id: 'chin-1', label: 'Chin filler, 1ml', group: 'Injectables', match: /chin (filler|augment|contour)|filler.*\bchin\b/i, unit: /\b1(\.0)?\s?ml\b/i },
  { id: 'nose', label: 'Non-surgical rhinoplasty', group: 'Injectables', match: /rhinoplasty|nose (filler|job|reshap)|liquid nose/i },
  { id: 'tear-trough', label: 'Tear trough filler', group: 'Injectables', match: /tear trough|under.?eye filler/i },
  { id: 'nasolabial', label: 'Nasolabial fold filler', group: 'Injectables', match: /nasolabial|nose to mouth|smile lines? filler/i },
  { id: 'marionette', label: 'Marionette line filler', group: 'Injectables', match: /marionette/i },
  { id: 'dissolve', label: 'Filler dissolving', group: 'Injectables', match: /dissolv|hyalase|hyaluronidase/i, not: /fat|aqualyx|lemon|deso|kybella|lipolysis/i },
  { id: 'profhilo-1', label: 'Profhilo, 1 session', group: 'Injectables', match: /profhilo/i, not: /\b(2|two)\s*(session|treatment)s?\b|course|package|full treatment/i },
  { id: 'profhilo-2', label: 'Profhilo, 2 sessions', group: 'Injectables', match: /profhilo/i, unit: /\b(2|two)\s*(session|treatment)s?\b|course|package|full treatment/i },
  { id: 'polynucleotides-1', label: 'Polynucleotides, 1 session', group: 'Injectables', match: /polynucleotide|ameela|nucleofill|plinest|salmon dna/i, not: /\b(2|two|3|three)\s*(session|treatment)s?\b|course|package/i },
  { id: 'polynucleotides-course', label: 'Polynucleotides, course', group: 'Injectables', match: /polynucleotide|ameela|nucleofill|plinest|salmon dna/i, unit: /\b(2|two|3|three)\s*(session|treatment)s?\b|course|package/i },
  { id: 'skin-booster-1', label: 'Skin booster, 1 session', group: 'Injectables', match: /skin ?booster|seventy hyal|redensity|sunekos|jalupro|viscoderm|belotero revive/i, not: /\b(2|two|3|three)\s*(session|treatment)s?\b|course|package/i },
  { id: 'skin-booster-course', label: 'Skin booster, course', group: 'Injectables', match: /skin ?booster|seventy hyal|redensity|sunekos|jalupro|viscoderm/i, unit: /\b(2|two|3|three)\s*(session|treatment)s?\b|course|package/i },
  { id: 'sculptra', label: 'Sculptra', group: 'Injectables', match: /sculptra|poly-?l-?lactic/i },
  { id: 'prp-face', label: 'PRP facial (vampire facial)', group: 'Injectables', match: /\bprp\b|vampire|platelet/i, not: /hair|scalp/i },
  { id: 'prp-hair', label: 'PRP for hair', group: 'Injectables', match: /\bprp\b.*(hair|scalp)|(hair|scalp).*\bprp\b/i },
  { id: 'fat-dissolve', label: 'Fat dissolving injections', group: 'Body', match: /fat dissolv|aqualyx|lemon ?bottle|deso\b|kybella|lipolysis/i },
  { id: 'b12', label: 'Vitamin B12 injection', group: 'Body', match: /\bb12\b/i },
  { id: 'vitamin-drip', label: 'Vitamin drip (IV)', group: 'Body', match: /\biv\b|vitamin (drip|infusion)|drip therapy/i },
  // Skin
  { id: 'microneedling', label: 'Microneedling', group: 'Skin', match: /micro.?needl|dermapen|skinpen|collagen induction|mesotherapy/i, not: /rf|radio|morpheus|potenza|secret|vivace|course|package|\b(2|3|4|6)\s*(session|treatment)/i },
  { id: 'microneedling-course', label: 'Microneedling, course', group: 'Skin', match: /micro.?needl|dermapen|skinpen/i, unit: /course|package|\b(2|3|4|6)\s*(session|treatment)s?\b/i, not: /rf|radio|morpheus|potenza|secret|vivace/i },
  { id: 'rf-microneedling', label: 'RF microneedling (Morpheus8 etc.)', group: 'Skin', match: /morpheus|rf micro|radio.?frequency micro|potenza|secret rf|vivace|sylfirm/i, not: /course|package|\b(2|3|4)\s*(session|treatment)/i },
  { id: 'rf-microneedling-course', label: 'RF microneedling, course', group: 'Skin', match: /morpheus|rf micro|radio.?frequency micro|potenza|secret rf|vivace|sylfirm/i, unit: /course|package|\b(2|3|4)\s*(session|treatment)s?\b/i },
  { id: 'peel', label: 'Chemical peel', group: 'Skin', match: /\bpeel\b/i, not: /course|package|\b(3|4|6)\s*(session|treatment)/i },
  { id: 'peel-course', label: 'Chemical peel, course', group: 'Skin', match: /\bpeel\b/i, unit: /course|package|\b(3|4|6)\s*(session|treatment)s?\b/i },
  { id: 'hydrafacial', label: 'HydraFacial', group: 'Skin', match: /hydra.?facial|hydro.?facial|hydradermabrasion/i, not: /deluxe|platinum|course|package/i },
  { id: 'hydrafacial-deluxe', label: 'HydraFacial, deluxe or platinum', group: 'Skin', match: /hydra.?facial|hydro.?facial/i, unit: /deluxe|platinum|signature plus/i },
  { id: 'dermaplaning', label: 'Dermaplaning', group: 'Skin', match: /dermaplan/i, not: /course|package/i },
  { id: 'led', label: 'LED light therapy', group: 'Skin', match: /\bled\b|light therapy|dermalux|celluma/i, not: /course|package/i },
  { id: 'facial', label: 'Facial (standard)', group: 'Skin', match: /\bfacial\b/i, not: /hydra|hydro|derma|peel|led|micro|rf|vampire|prp|lymph|course|package|mini|express|luxury|deluxe|signature|advanced|bespoke|oxygen|glass/i },
  { id: 'facial-express', label: 'Facial, express or mini', group: 'Skin', match: /\bfacial\b/i, unit: /express|mini|taster|30 ?min/i, not: /hydra|hydro|derma|peel|led|micro|rf/i },
  { id: 'facial-luxury', label: 'Facial, luxury or signature', group: 'Skin', match: /\bfacial\b/i, unit: /luxury|deluxe|signature|advanced|bespoke|90 ?min/i, not: /hydra|hydro|derma|peel|led|micro|rf/i },
  { id: 'microdermabrasion', label: 'Microdermabrasion', group: 'Skin', match: /microderm/i },
  { id: 'oxygen-facial', label: 'Oxygen facial', group: 'Skin', match: /oxygen/i },
  { id: 'skin-tag', label: 'Skin tag or mole removal', group: 'Skin', match: /skin tag|mole removal|milia|cryo(pen|therapy)|lesion removal|wart/i },
  // Laser and energy
  { id: 'hifu-face', label: 'HIFU, face', group: 'Laser and energy', match: /hifu|ultherapy|ultraformer/i, not: /body|stomach|arm|thigh|neck only|half face|jaw only|brow only/i },
  { id: 'hifu-body', label: 'HIFU, body', group: 'Laser and energy', match: /hifu|ultraformer/i, unit: /body|stomach|tummy|abdomen|arm|thigh|buttock/i },
  { id: 'ipl-face', label: 'IPL photofacial', group: 'Laser and energy', match: /\bipl\b|photo.?facial|photo.?rejuv|intense pulsed/i, not: /hair/i },
  { id: 'laser-pigment', label: 'Laser pigmentation or redness treatment', group: 'Laser and energy', match: /pigment|rosacea|thread vein|spider vein|redness|vascular/i },
  { id: 'carbon-laser', label: 'Carbon laser facial', group: 'Laser and energy', match: /carbon (laser|peel|facial)|hollywood (peel|facial)/i },
  { id: 'tattoo-removal', label: 'Laser tattoo removal', group: 'Laser and energy', match: /tattoo removal/i },
  { id: 'co2', label: 'CO2 or fractional laser resurfacing', group: 'Laser and energy', match: /co2|fraxel|fractional laser|resurfac/i },
  { id: 'rf-skin', label: 'Radiofrequency skin tightening', group: 'Laser and energy', match: /radio.?frequency|\brf\b|skin tighten|thermage|exilis|venus|endymed/i, not: /micro|needl|morpheus|body|stomach|arm|thigh/i },
  // Laser hair removal by area
  { id: 'lhr-upper-lip', label: 'Laser hair removal, upper lip', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano|alexandrite/i, unit: /upper lip|\blip\b/i, not: /filler|flip|wax/i },
  { id: 'lhr-chin', label: 'Laser hair removal, chin', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano/i, unit: /\bchin\b/i, not: /filler|wax|lip and chin|lip & chin/i },
  { id: 'lhr-lip-chin', label: 'Laser hair removal, lip and chin', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano/i, unit: /lip (and|&|\+) chin/i, not: /filler|wax/i },
  { id: 'lhr-underarm', label: 'Laser hair removal, underarms', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano/i, unit: /under.?arm|armpit|axilla/i, not: /wax|full body|package/i },
  { id: 'lhr-bikini', label: 'Laser hair removal, bikini line', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano/i, unit: /\bbikini\b/i, not: /wax|hollywood|brazilian|extended|full body/i },
  { id: 'lhr-hollywood', label: 'Laser hair removal, Hollywood or Brazilian', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano/i, unit: /hollywood|brazilian|extended bikini/i, not: /wax|full body|carbon|peel|facial/i },
  { id: 'lhr-half-leg', label: 'Laser hair removal, half leg', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano/i, unit: /half leg|lower leg|upper leg/i, not: /wax/i },
  { id: 'lhr-full-leg', label: 'Laser hair removal, full leg', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano/i, unit: /full leg/i, not: /wax|full body/i },
  { id: 'lhr-full-face', label: 'Laser hair removal, full face', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano/i, unit: /full face|whole face/i, not: /wax|carbon|peel|facial\b/i },
  { id: 'lhr-back', label: 'Laser hair removal, back', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano/i, unit: /\bback\b/i, not: /wax|full body/i },
  { id: 'lhr-full-body', label: 'Laser hair removal, full body', group: 'Hair removal', match: /laser|ipl|hair removal|hair reduction|diode|soprano/i, unit: /full body/i, not: /wax/i },
  { id: 'electrolysis', label: 'Electrolysis', group: 'Hair removal', match: /electrolysis/i },
  // Waxing (common units)
  { id: 'wax-hollywood', label: 'Hollywood or Brazilian wax', group: 'Hair removal', match: /wax/i, unit: /hollywood|brazilian/i, not: /laser|ipl/i },
  { id: 'wax-bikini', label: 'Bikini wax', group: 'Hair removal', match: /wax/i, unit: /bikini/i, not: /laser|ipl|hollywood|brazilian|extended/i },
  { id: 'wax-half-leg', label: 'Half leg wax', group: 'Hair removal', match: /wax/i, unit: /half leg|lower leg/i },
  { id: 'wax-full-leg', label: 'Full leg wax', group: 'Hair removal', match: /wax/i, unit: /full leg/i },
  { id: 'wax-underarm', label: 'Underarm wax', group: 'Hair removal', match: /wax/i, unit: /under.?arm/i },
  { id: 'wax-lip', label: 'Lip wax', group: 'Hair removal', match: /wax/i, unit: /\blip\b/i, not: /laser/i },
  // Brows and lashes
  { id: 'hd-brows', label: 'HD Brows or brow sculpt', group: 'Brows and lashes', match: /hd brow|brow (sculpt|shape|design|tidy)|eyebrow (shape|tidy|wax|thread)/i, not: /lamination|lam\b|tint only|microblad|tattoo|combo|package/i },
  { id: 'brow-lamination', label: 'Brow lamination', group: 'Brows and lashes', match: /brow lam/i },
  { id: 'brow-tint', label: 'Brow tint', group: 'Brows and lashes', match: /brow tint|eyebrow tint/i, not: /lash|lam|shape|wax/i },
  { id: 'microblading', label: 'Microblading or brow tattoo', group: 'Brows and lashes', match: /microblad|ombr[eé] brow|powder brow|brow tattoo|semi.?permanent (brow|eyebrow)|nano brow/i, not: /top.?up|colour boost|annual/i },
  { id: 'lash-lift', label: 'Lash lift (and tint)', group: 'Brows and lashes', match: /lash lift|lvl|lash perm|yumi/i },
  { id: 'lash-classic', label: 'Lash extensions, classic full set', group: 'Brows and lashes', match: /classic/i, unit: /lash|full set/i, not: /infill|in-fill|refill|hybrid|volume|russian/i },
  { id: 'lash-hybrid', label: 'Lash extensions, hybrid full set', group: 'Brows and lashes', match: /hybrid/i, unit: /lash|set|full|extension/i, not: /infill|in-fill|refill|brow/i },
  { id: 'lash-volume', label: 'Lash extensions, volume or Russian full set', group: 'Brows and lashes', match: /russian|volume lash|volume set|mega volume/i, not: /infill|in-fill|refill/i },
  { id: 'lash-infill', label: 'Lash infill', group: 'Brows and lashes', match: /infill|in-fill|refill/i, unit: /lash|classic|hybrid|volume|russian/i, not: /nail|gel|biab|acrylic/i },
  { id: 'lash-tint', label: 'Lash tint', group: 'Brows and lashes', match: /lash tint|eyelash tint/i, not: /lift|lvl|brow/i },
  // Nails
  { id: 'gel-hands', label: 'Gel polish, hands', group: 'Nails', match: /gel (polish|manicure|nails|hands)|shellac|gelish|gel mani|manicure with gel/i, not: /toes|feet|pedi|biab|builder|removal|extension|acrylic|infill/i },
  { id: 'gel-toes', label: 'Gel polish, toes', group: 'Nails', match: /gel (polish|pedicure|toes|feet)|shellac|gel pedi|pedicure with gel/i, unit: /toes|feet|pedi/i, not: /biab|builder|acrylic/i },
  { id: 'biab', label: 'BIAB or builder gel, full set', group: 'Nails', match: /biab|builder gel|builder in a bottle|hard gel/i, not: /infill|in-fill|removal|extension|toes/i },
  { id: 'biab-infill', label: 'BIAB infill', group: 'Nails', match: /biab|builder gel/i, unit: /infill|in-fill|rebalance/i },
  { id: 'acrylic-full', label: 'Acrylic nails, full set', group: 'Nails', match: /acrylic|nail extension|sculpted nails/i, not: /infill|in-fill|removal|repair/i },
  { id: 'acrylic-infill', label: 'Acrylic infill', group: 'Nails', match: /acrylic/i, unit: /infill|in-fill|rebalance/i },
  { id: 'manicure', label: 'Manicure (standard)', group: 'Nails', match: /\bmanicure\b|\bmani\b/i, not: /gel|shellac|biab|acrylic|luxury|deluxe|spa|express|mini|file and polish/i },
  { id: 'pedicure', label: 'Pedicure (standard)', group: 'Nails', match: /\bpedicure\b|\bpedi\b/i, not: /gel|shellac|biab|acrylic|luxury|deluxe|spa|express|mini|medical/i },
  { id: 'nail-removal', label: 'Gel or acrylic removal', group: 'Nails', match: /removal|soak off|soak-off/i, unit: /gel|acrylic|biab|nail|shellac/i, not: /laser|hair|tattoo|skin tag|mole|wax/i },
  // Hair (salon)
  { id: 'cut-blowdry', label: 'Cut and blow dry', group: 'Hair', match: /cut (and|&|\+) (blow|finish|style)|haircut|ladies cut|wash,? cut/i, not: /gents|men|child|kids|colour|balayage|highlight|restyle/i },
  { id: 'blowdry', label: 'Blow dry', group: 'Hair', match: /blow ?dry/i, not: /cut|colour|balayage|highlight|brazilian/i },
  { id: 'gents-cut', label: 'Gents cut', group: 'Hair', match: /gents|men'?s (cut|hair)|barber/i, not: /beard only|child|kids/i },
  { id: 'root-colour', label: 'Root colour', group: 'Hair', match: /root (colour|color|touch|tint|retouch)|regrowth/i },
  { id: 'full-colour', label: 'Full head colour', group: 'Hair', match: /full (head )?(colour|color|tint)|all over colour|permanent colour/i, not: /root|highlight|balayage|bleach/i },
  { id: 'highlights-half', label: 'Half head highlights', group: 'Hair', match: /highlight|foils/i, unit: /half head|t.?section|partial/i },
  { id: 'highlights-full', label: 'Full head highlights', group: 'Hair', match: /highlight|foils/i, unit: /full head/i },
  { id: 'balayage', label: 'Balayage', group: 'Hair', match: /balayage|ombr[eé]|colour melt|babylights/i },
  { id: 'keratin', label: 'Keratin or Brazilian blow dry', group: 'Hair', match: /keratin|brazilian blow|smoothing treatment|nanoplastia/i },
  { id: 'olaplex', label: 'Olaplex or bond treatment', group: 'Hair', match: /olaplex|k18|bond (builder|treatment)/i },
  { id: 'extensions', label: 'Hair extensions', group: 'Hair', match: /hair extension|tape.?in|micro ?ring|nano ring|weft/i },
  // Massage and spa
  { id: 'massage-30', label: 'Massage, 30 minutes', group: 'Massage and spa', match: /massage/i, unit: /\b30\s?min|half hour|back,? neck (and|&) shoulder|back and shoulder/i, not: /hot stone|lymph|60|90|hour\b(?!\s*half)/i },
  { id: 'massage-60', label: 'Massage, 60 minutes', group: 'Massage and spa', match: /massage/i, unit: /\b60\s?min|\b1 hour|one hour|full body/i, not: /hot stone|lymph|90|30/i },
  { id: 'massage-90', label: 'Massage, 90 minutes', group: 'Massage and spa', match: /massage/i, unit: /\b90\s?min|hour and a half|1\.5 hour/i, not: /hot stone|lymph/i },
  { id: 'hot-stone', label: 'Hot stone massage', group: 'Massage and spa', match: /hot stone/i },
  { id: 'lymphatic', label: 'Lymphatic drainage massage', group: 'Massage and spa', match: /lymph/i },
  { id: 'spray-tan', label: 'Spray tan', group: 'Body', match: /spray tan|fake tan|sunless tan/i },
  { id: 'body-sculpt', label: 'Body sculpting (cavitation, cryolipolysis, EMS)', group: 'Body', match: /cavitation|cryolipolysis|fat freez|coolsculpt|emsculpt|emslim|body sculpt|body contour|lipo laser/i, not: /course|package/i },
  { id: 'teeth-whitening', label: 'Teeth whitening', group: 'Other', match: /teeth whiten|tooth whiten/i },
  { id: 'semi-permanent-lips', label: 'Semi-permanent lip blush', group: 'Other', match: /lip blush|semi.?permanent lip|lip tattoo/i },
  { id: 'piercing', label: 'Ear piercing', group: 'Other', match: /piercing/i },
];

const byId = new Map(CATALOGUE.map((t) => [t.id, t]));
export const treatmentById = (id: string): Treatment | undefined => byId.get(id);

/** Lines that are never a treatment to compare: deposits, consultations, reviews, tests, top-ups, vouchers. */
export const SKIP_LINE = /\bdeposit|consult|patch test|skin test|review (appointment|visit)|follow.?up|top.?up|touch.?up|voucher|gift card|membership|cancellation|late fee|\btrial\b|model (price|day)|training|course for|masterclass|aftercare kit|home ?care|retail|product\b/i;

export const normName = (s: string) => String(s || '').toLowerCase().replace(/[’'`´]/g, '').replace(/[^a-z0-9.&+]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface Match { id: string; label: string; group: Group }

/**
 * The catalogue entry a service name means, or null. Deterministic: every candidate's `match`
 * must hit, its `not` must not, and when it has a `unit` the unit must appear; the most specific
 * candidate (unit beats no unit; longer match beats shorter) wins. Names that fit no entry return null.
 */
export function matchTreatment(name: string): Match | null {
  const n = normName(name);
  if (!n || SKIP_LINE.test(n)) return null;
  const hits: { t: Treatment; score: number }[] = [];
  for (const t of CATALOGUE) {
    if (!t.match.test(n)) continue;
    if (t.not && t.not.test(n)) continue;
    if (t.unit) { if (!t.unit.test(n)) continue; hits.push({ t, score: 2 }); }
    else hits.push({ t, score: 1 });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score || CATALOGUE.indexOf(a.t) - CATALOGUE.indexOf(b.t));
  const { t } = hits[0];
  return { id: t.id, label: t.label, group: t.group };
}

/* ---------- The comparison ---------- */
export interface PriceSource { price: string; value: number; from: boolean; name: string; url: string; seenAt: string; via?: ServiceLine['via'] }
export interface CompareRow {
  id: string; label: string; group: Group;
  yours: PriceSource | null;
  theirs: (PriceSource | null)[];         // one per competitor, in the order given
  localAvg: number | null;                // over competitors that list this treatment (from-prices count as their minimum)
  localMin: number | null; localMax: number | null; listedBy: number;
  position: string | null;                // "£30 above the local average", "cheapest of 6"...
}
export interface Comparison {
  checkedAt: string;
  competitors: { key: string; name: string }[];
  rows: CompareRow[];
  /** Treatments competitors price that the client does not list, most common first. */
  theyOfferYouDont: { id: string; label: string; group: Group; by: { name: string; key: string; price: string }[]; localAvg: number | null }[];
  /** Treatments the client lists that nobody nearby prices. */
  onlyYou: { id: string; label: string; price: string }[];
  /** How many lines on each side matched the catalogue, so the owner knows what was compared. */
  matched: { yours: number; yoursTotal: number; theirs: number; theirsTotal: number };
}

const money = (v: number) => `£${Number.isInteger(v) ? v : v.toFixed(2)}`;

function toSource(s: ServiceLine): PriceSource | null {
  const v = priceValue(s.price);
  if (v == null || v <= 0) return null;
  return { price: s.price, value: v, from: /^from\b/i.test(s.price.trim()), name: s.name, url: s.url, seenAt: s.seenAt, via: s.via };
}

/** For each catalogue id, the lowest-priced matching line (a business's cheapest listing for that exact treatment). */
export function bucket(services: ServiceLine[], extraMap: Record<string, string | null> = {}): Map<string, PriceSource> {
  const out = new Map<string, PriceSource>();
  for (const s of services) {
    const m = matchTreatment(s.name) ?? (extraMap[normName(s.name)] ? treatmentById(extraMap[normName(s.name)]!) : null);
    if (!m) continue;
    const src = toSource(s);
    if (!src) continue;
    const prev = out.get(m.id);
    if (!prev || src.value < prev.value) out.set(m.id, src);
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Plain words for where a price sits against the others. Only facts that are in the row. */
export function positionText(yours: PriceSource | null, theirs: (PriceSource | null)[]): string | null {
  if (!yours) return null;
  const listed = theirs.filter((t): t is PriceSource => !!t);
  if (!listed.length) return 'nobody nearby lists a price';
  const values = listed.map((t) => t.value);
  const avg = round(values.reduce((a, b) => a + b, 0) / values.length);
  const n = listed.length + 1;
  const cheaperThanAll = values.every((v) => yours.value < v);
  const dearerThanAll = values.every((v) => yours.value > v);
  if (n >= 3 && cheaperThanAll) return `cheapest of ${n}`;
  if (n >= 3 && dearerThanAll) return `dearest of ${n}`;
  const diff = round(yours.value - avg);
  const who = listed.length === 1 ? '1 other' : `${listed.length} others`;
  if (Math.abs(diff) < 0.5) return `same as the local average (${who})`;
  return `${money(Math.abs(diff))} ${diff > 0 ? 'above' : 'below'} the local average of ${money(avg)} (${who})`;
}

/**
 * The like-for-like table: one row per treatment that at least two businesses (the client counts
 * as one) list, plus the two gap lists. `extraMap` holds AI-resolved leftovers (normalised name → id).
 */
export function comparePrices(you: ServiceLine[], competitors: { key: string; name: string; services: ServiceLine[] }[], at: string, extraMap: Record<string, string | null> = {}): Comparison {
  const mine = bucket(you, extraMap);
  const theirsAll = competitors.map((c) => ({ c, b: bucket(c.services, extraMap) }));
  const ids = new Set<string>([...mine.keys(), ...theirsAll.flatMap((x) => [...x.b.keys()])]);
  const rows: CompareRow[] = []; const theyOffer: Comparison['theyOfferYouDont'] = []; const onlyYou: Comparison['onlyYou'] = [];
  for (const id of ids) {
    const t = treatmentById(id)!;
    const yours = mine.get(id) ?? null;
    const theirs = theirsAll.map((x) => x.b.get(id) ?? null);
    const listed = theirs.filter((x): x is PriceSource => !!x);
    const values = listed.map((x) => x.value);
    const localAvg = values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    if (!yours && listed.length) { theyOffer.push({ id, label: t.label, group: t.group, by: theirsAll.filter((x) => x.b.get(id)).map((x) => ({ name: x.c.name, key: x.c.key, price: x.b.get(id)!.price })), localAvg }); continue; }
    if (yours && !listed.length) { onlyYou.push({ id, label: t.label, price: yours.price }); }
    if (yours || listed.length >= 2) rows.push({ id, label: t.label, group: t.group, yours, theirs, localAvg, localMin: values.length ? Math.min(...values) : null, localMax: values.length ? Math.max(...values) : null, listedBy: listed.length, position: positionText(yours, theirs) });
  }
  const order = (r: CompareRow) => (r.yours && r.listedBy ? 0 : r.yours ? 1 : 2);
  rows.sort((a, b) => order(a) - order(b) || b.listedBy - a.listedBy || a.label.localeCompare(b.label));
  theyOffer.sort((a, b) => b.by.length - a.by.length || a.label.localeCompare(b.label));
  const matchedTheirs = theirsAll.reduce((n, x) => n + x.b.size, 0);
  return {
    checkedAt: at, competitors: competitors.map((c) => ({ key: c.key, name: c.name })), rows, theyOfferYouDont: theyOffer, onlyYou,
    matched: { yours: mine.size, yoursTotal: you.filter((s) => toSource(s) && !SKIP_LINE.test(normName(s.name))).length, theirs: matchedTheirs, theirsTotal: competitors.reduce((n, c) => n + c.services.filter((s) => toSource(s) && !SKIP_LINE.test(normName(s.name))).length, 0) },
  };
}

/** Service names that fit no catalogue entry (for the optional AI pass), de-duplicated and capped. */
export function unmatchedNames(lists: ServiceLine[][], known: Record<string, string | null> = {}, max = 40): string[] {
  const out: string[] = []; const seen = new Set<string>();
  for (const list of lists) for (const s of list) {
    const n = normName(s.name);
    if (!n || seen.has(n) || SKIP_LINE.test(n) || matchTreatment(s.name) || known[n] !== undefined) continue;
    if (!toSource(s)) continue;
    seen.add(n); out.push(s.name);
    if (out.length >= max) return out;
  }
  return out;
}

/** Plain summary lines for the AI adviser and Ask: only figures that are in the comparison. */
export function comparisonFacts(c: Comparison, max = 8): string[] {
  const out: string[] = [];
  for (const r of c.rows.filter((x) => x.yours && x.listedBy).slice(0, max)) {
    out.push(`${r.label}: you ${r.yours!.price}; ${c.competitors.map((cp, i) => (r.theirs[i] ? `${cp.name} ${r.theirs[i]!.price}` : null)).filter(Boolean).join(', ')}; local average ${money(r.localAvg!)} (${r.position}).`);
  }
  if (c.theyOfferYouDont.length) out.push(`Offered nearby but not on your list: ${c.theyOfferYouDont.slice(0, 6).map((t) => `${t.label} (${t.by.map((b) => `${b.name} ${b.price}`).join(', ')})`).join('; ')}.`);
  if (c.onlyYou.length) out.push(`Only you list a price for: ${c.onlyYou.slice(0, 6).map((t) => `${t.label} ${t.price}`).join('; ')}.`);
  return out;
}

export interface PriceMoveT { key: string; competitor: string; id: string; label: string; from: string; to: string; url: string }

/** Competitor prices that moved between two comparisons, by treatment (catches a renamed line the name diff misses). */
export function priceMoves(prev: Comparison | null | undefined, next: Comparison): PriceMoveT[] {
  if (!prev) return [];
  const out: PriceMoveT[] = [];
  for (const row of next.rows) {
    const old = prev.rows.find((r) => r.id === row.id);
    if (!old) continue;
    next.competitors.forEach((c, i) => {
      const j = prev.competitors.findIndex((p) => p.key === c.key);
      const a = j >= 0 ? old.theirs[j] : null; const b = row.theirs[i];
      if (a && b && a.value !== b.value && a.from === b.from) out.push({ key: c.key, competitor: c.name, id: row.id, label: row.label, from: a.price, to: b.price, url: b.url });
    });
  }
  return out;
}
