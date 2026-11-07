import { topicName } from '../data/catalog.js';

/**
 * Reads what the member typed into "What is this for?" plus the payee, and decides what kind of
 * transaction it is. Deliberately simple keyword rules: predictable, explainable, no outside service.
 * The member can always correct the result.
 */
const RULES = [
  ['bio', /\b(biotech|therapeutic|pharma|drug|clinical|oncology|genom|gene[- ]edit|longevity|medtech|diagnostic|radiopharma|peptide)/i],
  ['vc', /\b(series [a-f]\b|seed round|start-?up|venture|growth round|founders?\b|pre-ipo|saas|robotics|quantum)/i],
  ['pe', /\b(buy-?out|take[- ]private|carve[- ]out|lbo|roll[- ]up|majority stake|private equity|acquisition of|acquire)/i],
  ['re', /\b(property|real estate|tower|apartment|penthouse|villa|hotel|resort|office (building|block|campus)|townhouse|ranch estate|island|mansion)/i],
  ['art', /\b(art\b|artwork|painting|canvas|sculpture|auction|gallery|collectible|chronograph|watch(es)?\b|photograph|triptych|old master)/i],
  ['sports', /\b(team|club|franchise|league|stadium|football|soccer|hockey|basketball|cycling|e-?sports)/i],
  ['energy', /\b(oil|gas field|natural gas|wind|solar|lithium|mining|battery|energy|royalt|drilling|refiner)/i],
  ['digital', /\b(crypto|token|bitcoin|btc|ethereum|stablecoin|blockchain|defi|web3|custody exchange)/i],
  ['media', /\b(studio|film|movie|music|catalog(ue)?|streaming|podcast|broadcast|media rights|publishing)/i],
  ['credit', /\b(loan|lending|debt|credit|bonds?\b|notes?\b|abs\b|financing|bridge facility)/i],
  ['infra', /\b(port|airport|toll|fiber|data cent(er|re)|pipeline|rail|infrastructure|logistics|concession)/i],
  ['ag', /\b(vineyard|winery|farm|cattle|orchard|almond|grain|agricultur|crop|livestock)/i],
];

const PERSONAL = /\b(payroll|salar(y|ies)|staff|household|school|tuition|tax (payment|bill)|taxes|rent|groceries|gift|birthday|wedding|donation|charity|personal|bills?\b|utilities|insurance premium|allowance|mortgage)/i;

export function classifyPurpose({ purpose = '', payeeName = '', asset = null }) {
  const text = `${purpose} ${payeeName}`;
  if (asset) return { topic: asset.topic, topicName: topicName(asset.topic), basis: 'payee', personal: false, matches: [] };
  const scored = RULES.map(([topic, re]) => ({ topic, hits: (text.match(new RegExp(re.source, 'gi')) ?? []).length }))
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (!scored.length) {
    return PERSONAL.test(text)
      ? { topic: null, topicName: 'Personal payment', basis: 'purpose', personal: true, matches: [] }
      : { topic: null, topicName: null, basis: 'none', personal: false, matches: [] };
  }
  return { topic: scored[0].topic, topicName: topicName(scored[0].topic), basis: 'purpose', personal: false, matches: scored.slice(1, 3).map((s) => s.topic) };
}

/** Does a typed payee name look like a counterparty the bank already knows? */
export function matchPayee(assets, name) {
  const q = String(name).trim().toLowerCase();
  if (q.length < 4) return null;
  const words = new Set(q.split(/[^a-z0-9]+/).filter((w) => w.length >= 5));
  return assets.find((a) => {
    const lower = a.name.toLowerCase();
    if (lower.includes(q)) return true;
    const lead = lower.split(/[^a-z0-9]+/)[0];
    return lead.length >= 5 && words.has(lead);
  }) ?? null;
}
