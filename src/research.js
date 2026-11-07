import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { topicName } from './data/catalog.js';
import { sizeBucket } from './util.js';

const MODEL = 'claude-opus-5-5';

const PURPOSE_WORDS = /\b(series [a-f]|seed|growth round|buy-?out|take[- ]private|carve[- ]out|minority stake|majority stake|acquisition|private sale|auction|concession|lease|royalt\w*|fund lp|debt|loan|expansion team|franchise|oncology|biotech|data cent(er|re)|vineyard|painting|sculpture|catalog(ue)?)\b/gi;

const CaseStudies = z.object({
  summary: z.string().describe('Two or three sentences on what public cases suggest about this kind of transaction'),
  cases: z.array(z.object({
    title: z.string().describe('Short name of the transaction, e.g. "2021 Series C of an oncology platform company"'),
    year: z.string(),
    what: z.string().describe('One or two sentences: who bought what, at what size'),
    outcome: z.string().describe('How it turned out, with numbers where the sources give them'),
    lesson: z.string().describe('One sentence on what a buyer today should take from it'),
    sources: z.array(z.object({ title: z.string(), url: z.string() })),
  })),
});

/**
 * What leaves the bank. By default only an anonymised description: the kind of transaction and
 * a size band, never the member, the account, the exact amount or (unless they opt in) the payee.
 */
export function researchQuery({ topic, purpose = '', payeeName = '', sizeM, includeName = false }) {
  const words = [...new Set((purpose.match(PURPOSE_WORDS) ?? []).map((w) => w.toLowerCase()))];
  const parts = [topicName(topic).toLowerCase()];
  if (words.length) parts.push(words.join(', '));
  parts.push(`ticket size ${sizeBucket(sizeM)}`);
  if (includeName && payeeName) parts.push(`counterparty: ${payeeName}`);
  return parts.join(' · ');
}

const SYSTEM = `You research precedent transactions for the private bank's advisory desk.
Use web search to find real, publicly reported transactions comparable to the one described, and how they turned out.
Prefer primary or reputable sources: regulatory filings, company announcements, established financial press, auction house results.
Report only what the sources support. If an outcome is not public, say so. Never invent figures, names or sources.
Find between three and six cases. Note anything a buyer should check before committing.`;

/**
 * Case studies from the public web, for when nobody in a member's network has done this.
 * Two calls: the first researches with web search (its answer carries citations), the second turns
 * that research into a fixed structure for the app. Results are cached by query.
 */
export function createResearcher({ client, cachePath }) {
  const cache = cachePath && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const save = () => {
    if (!cachePath) return;
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  };

  async function research(query) {
    if (cache[query]) return { ...cache[query], cached: true };

    const messages = [{ role: 'user', content: `Find public case studies comparable to this transaction: ${query}` }];
    let response;
    const sources = new Map();
    for (let turn = 0; turn < 4; turn++) {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: SYSTEM,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
        messages,
      });
      for (const block of response.content) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) if (r.url) sources.set(r.url, r.title ?? r.url);
        }
      }
      if (response.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: response.content });
    }
    if (response.stop_reason === 'refusal') throw new ResearchError('The research request was declined. Try describing the transaction differently.');
    const notes = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!notes) throw new ResearchError('The search came back empty. Try again in a moment.');

    const structured = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low', format: zodOutputFormat(CaseStudies) },
      messages: [{
        role: 'user',
        content: `Restructure these research notes into case studies. Use only facts in the notes. Each case's sources must be URLs from this list:\n${[...sources].map(([url, title]) => `- ${title}: ${url}`).join('\n')}\n\nNotes:\n${notes}`,
      }],
    });
    if (structured.stop_reason === 'refusal' || !structured.parsed_output) throw new ResearchError('Could not organise the research into case studies.');

    // Keep only sources the search actually returned.
    const result = structured.parsed_output;
    for (const c of result.cases) c.sources = c.sources.filter((s) => sources.has(s.url));
    const entry = { query, ...result, model: MODEL, generatedAt: Date.now() };
    cache[query] = entry;
    save();
    return { ...entry, cached: false };
  }

  return { research };
}

export class ResearchError extends Error {}

