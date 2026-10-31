// Keep the complete WhatsApp recommendation list below 30, across all sections.
export const PRODUCT_SEARCH_MAX_ITEMS = 28;

const STOP_WORDS = new Set(('i a an the to for of and or in on me my want need book buy order please show some get give ' +
  'looking would like have search find recommend recommendations related product products item items with can you do is are').split(' '));

// Catalog vocabulary, not generated products. Extend these groups as new product
// families are added; GSM itself remains a specification rather than a synonym.
const RELATED_TERMS = [
  ['tarpaulin', 'tarpaulins', 'tarp', 'tarps', 'tirpal', 'tripal', 'तिरपाल', 'తార్పాలిన్'],
  ['fertilizer', 'fertilizers', 'fertiliser', 'fertilisers', 'khad', 'खाद', 'उर्वरक', 'ఎరువులు'],
  ['seed', 'seeds', 'beej', 'बीज', 'విత్తనాలు'],
  ['hose', 'hoses', 'pipe', 'pipes', 'नली', 'పైపు'],
  ['sprayer', 'sprayers', 'spraying', 'स्प्रेयर', 'స్ప్రేయర్'],
  ['tractor', 'tractors', 'ट्रैक्टर', 'ట్రాక్టర్'],
];

export interface ProductSearchMatch {
  product: any;
  matchType: 'matching' | 'recommended';
  score: number;
}

export function normalizeProductSearch(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/\bg\s*\.\s*s\s*\.\s*m\b\.?/g, 'gsm')
    .replace(/([0-9])([a-z])/g, '$1 $2').replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

function words(value: unknown): string[] {
  return normalizeProductSearch(value).split(/\s+/).filter(Boolean);
}

function singular(word: string) {
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

function literalMatch(candidate: string, term: string) {
  if (/^\d+$/.test(term)) return candidate === term;
  return candidate === term || singular(candidate) === singular(term) ||
    (term.length >= 4 && candidate.startsWith(term));
}

/** Small edit distance for spelling mistakes; never apply it to numeric specs. */
function typoMatch(candidate: string, term: string) {
  if (!/^[a-z]+$/.test(candidate) || !/^[a-z]+$/.test(term) || Math.min(candidate.length, term.length) < 5) return false;
  const max = Math.min(candidate.length, term.length) >= 8 ? 2 : 1;
  if (Math.abs(candidate.length - term.length) > max) return false;
  let previous = Array.from({ length: term.length + 1 }, (_, i) => i);
  for (let i = 1; i <= candidate.length; i++) {
    const row = [i];
    for (let j = 1; j <= term.length; j++) row[j] = Math.min(
      row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (candidate[i - 1] === term[j - 1] ? 0 : 1)
    );
    if (Math.min(...row) > max) return false;
    previous = row;
  }
  return previous[term.length] <= max;
}

function concepts(tokens: string[], fuzzy = false): Set<number> {
  return new Set(RELATED_TERMS.flatMap((group, index) => group.some(alias =>
    tokens.some(token => literalMatch(token, alias) || (fuzzy && typoMatch(token, alias)))
  ) ? [index] : []));
}

function isAvailable(product: any) {
  const availability = normalizeProductSearch(product.availability).replace(/ /g, '');
  return product.retailer_id && !product.deleted_at &&
    !['outofstock', 'discontinued', 'unavailable'].includes(availability) &&
    !['rejected', 'failed'].includes(normalizeProductSearch(product.meta_status)) &&
    normalizeProductSearch(product.review_status) !== 'rejected';
}

/** Rank literal matches first, then synonyms, spelling corrections and related variants. */
export function rankProductMatches(products: any[], searchTerm: string, limit = PRODUCT_SEARCH_MAX_ITEMS): ProductSearchMatch[] {
  const query = [...new Set(words(String(searchTerm ?? '').slice(0, 256))
    .filter(word => !STOP_WORDS.has(word) && (word.length >= 2 || /^\d+$/.test(word))))].slice(0, 20);
  if (!query.length) return [];
  const queryConcepts = concepts(query, true);
  const numeric = query.filter(token => /^\d+$/.test(token));
  const text = query.filter(token => !/^\d+$/.test(token));
  const candidates = products.filter(isAvailable).map((product, index) => {
    const name = words(product.name);
    const other = words([product.brand, product.category, product.sub_category, product.description, product.size, product.color].join(' '));
    const all = [...name, ...other];
    const literal = query.filter(term => all.some(word => literalMatch(word, term)));
    const fuzzy = text.filter(term => name.some(word => typoMatch(word, term)));
    const families = concepts(all);
    const hasConcept = [...queryConcepts].some(family => families.has(family));
    const specificationsMatch = numeric.every(term => all.includes(term));
    const matchesText = text.some(term => all.some(word => literalMatch(word, term))) || fuzzy.length > 0 || hasConcept;
    const matching = literal.length === query.length;
    const eligible = text.length ? matchesText : specificationsMatch;
    const phraseBonus = name.join(' ').includes(query.join(' ')) ? 20 : 0;
    const score = phraseBonus + query.reduce((total, term) => total + (name.some(word => literalMatch(word, term)) ? 15 :
      other.some(word => literalMatch(word, term)) ? 5 : 0), 0) + fuzzy.length * 2 +
      (hasConcept ? 4 : 0) + (specificationsMatch ? numeric.length * 8 : 0);
    return { product, index, families, matching, eligible, score };
  });

  // One-hop expansion from actual matched catalog products. For example a GSM
  // variant described as a tarpaulin also recommends tarps without GSM in the name.
  const relatedFamilies = new Set(queryConcepts);
  const relatedProductIds = new Set<string>();
  for (const candidate of candidates.filter(candidate => candidate.matching)) {
    candidate.families.forEach(family => relatedFamilies.add(family));
    if (candidate.product.product_id) relatedProductIds.add(candidate.product.product_id);
  }
  const seen = new Set<string>();
  return candidates.filter(candidate => candidate.eligible ||
    (text.length > 0 && ([...candidate.families].some(family => relatedFamilies.has(family)) ||
      (candidate.product.product_id && relatedProductIds.has(candidate.product.product_id)))))
    .sort((a, b) => Number(b.matching) - Number(a.matching) || b.score - a.score || a.index - b.index)
    .filter(({ product }) => {
      const id = String(product.retailer_id).trim();
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    })
    .slice(0, Math.max(0, Math.min(limit, PRODUCT_SEARCH_MAX_ITEMS)))
    .map(({ product, matching, score }) => ({ product, matchType: matching ? 'matching' : 'recommended', score }));
}
