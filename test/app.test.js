import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSeed } from '../src/data/seed.js';
import { createApi } from '../src/api.js';
import { verify } from '../src/engine/ledger.js';
import { classifyPurpose } from '../src/engine/classify.js';
import { MIN_ROWS } from '../src/engine/precedents.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncDossiers } from '../src/engine/dossier.js';
import { createResearcher, researchQuery } from '../src/research.js';

const fresh = ({ researcher = null } = {}) => {
  const store = generateSeed();
  const dossierDir = mkdtempSync(join(tmpdir(), 'dossiers-'));
  syncDossiers(store, dossierDir);
  const api = createApi(store, { dossierDir, researcher });
  const call = (method, path, body, as = 'm01') => api(method, new URL(`http://test${path}`), as ? { 'x-member-id': as } : {}, body);
  return { store, call, dossierDir };
};

const castellaneId = (store) => store.dealsOf('m01').find((d) => d.assetId === 'a_bio_1' && d.status === 'review').id;

test('seed data is deterministic and the ledger chain verifies', () => {
  const a = generateSeed();
  const b = generateSeed();
  assert.equal(a.data.ledger.at(-1).hash, b.data.ledger.at(-1).hash);
  assert.ok(a.data.deals.length > 300);
  assert.equal(verify(a.data.ledger).ok, true);
});

test('editing any past ledger entry is detected', () => {
  const { store } = fresh();
  const entry = store.data.ledger.find((e) => e.kind === 'advice');
  entry.payload.rec = entry.payload.rec === 'proceed' ? 'pass' : 'proceed';
  const result = verify(store.data.ledger);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, entry.seq);
});

test('"What is this for?" is classified from the purpose and payee', () => {
  assert.equal(classifyPurpose({ purpose: 'Series C allocation in an oncology biotech' }).topic, 'bio');
  assert.equal(classifyPurpose({ purpose: 'Buying a painting at auction' }).topic, 'art');
  assert.equal(classifyPurpose({ purpose: 'Minority stake in a hockey franchise' }).topic, 'sports');
  assert.equal(classifyPurpose({ purpose: 'Payroll for the house staff' }).personal, true);
  assert.equal(classifyPurpose({ purpose: 'misc' }).topic, null);
});

test('reviewing a payment returns the advice package and flags conflicted friends', async () => {
  const { call } = fresh();
  const review = await call('POST', '/api/pay/review', { accountId: 'm01-inv', assetId: 'a_bio_1', sizeM: 350, purpose: 'Series C' });
  assert.equal(review.classification.topic, 'bio');
  assert.ok(review.advisory.caseStudy.summary.n >= MIN_ROWS);
  const kenji = review.advisory.advisors.friends.find((f) => f.id === 'm16');
  assert.equal(kenji.conflicts.stake, true, 'Kenji holds a stake in Castellane');
  assert.ok(review.advisory.advisors.introductions.some((p) => p.id === 'm03' && p.viaId === 'm16'), 'Priya is one introduction away via Kenji');
});

test('personal payments skip the advice step and go straight through', async () => {
  const { call, store } = fresh();
  const before = store.account('m01-op').balanceM;
  const review = await call('POST', '/api/pay/review', { accountId: 'm01-op', payeeName: 'Household account', sizeM: 0.4, purpose: 'Payroll for staff' });
  assert.equal(review.advisory, null);
  assert.equal(review.classification.personal, true);
  await call('POST', '/api/pay', { accountId: 'm01-op', payeeName: 'Household account', sizeM: 0.4, purpose: 'Payroll', topic: 'personal', action: 'continue' });
  assert.equal(store.account('m01-op').balanceM, Math.round((before - 0.4) * 100) / 100);
});

test('advice from a friend with a stake is scored as more likely to work against you', async () => {
  const { call, store } = fresh();
  const tx = await call('GET', `/api/transactions/${castellaneId(store)}`);
  const kenji = tx.advice.find((a) => a.advisor.id === 'm16');
  const hana = tx.advice.find((a) => a.advisor.id === 'm07');
  assert.ok(kenji.bias.conflictLift > 0.05);
  assert.equal(kenji.bias.level, 'high');
  assert.equal(hana.bias.conflictLift, 0);
  assert.ok(kenji.bias.probability > hana.bias.probability);
  assert.ok(kenji.ledger.seq > 0, 'every piece of advice points at its ledger entry');
});

test('full flow: talk to a friend first, they answer on the record, continue, and blame follows the outcome', async () => {
  const { call, store } = fresh();
  const paid = await call('POST', '/api/pay', { accountId: 'm01-inv', assetId: 'a_infra_2', sizeM: 120, purpose: 'Data center campus', action: 'consult', advisorIds: ['m02'] });
  assert.equal(paid.threads.length, 1);
  const thread = await call('GET', `/api/threads/${paid.threads[0]}`, null, 'm02');
  assert.equal(thread.awaitingYou, true);
  assert.ok(thread.advisorBrief.disclosure, 'the advisor sees what will be recorded about their position');
  await call('POST', `/api/threads/${paid.threads[0]}/messages`, { body: 'Strong operator and a fair price.', verdict: { rec: 'proceed', confidence: 0.8 } }, 'm02');
  await call('POST', `/api/transactions/${paid.id}/continue`);
  await call('POST', `/api/transactions/${paid.id}/outcome`, { multiple: 0.6 });
  const tx = await call('GET', `/api/transactions/${paid.id}`);
  assert.equal(tx.blame.verdict, 'blame');
  assert.equal(tx.blame.parties[0].advisorId, 'm02');
  assert.equal(tx.blame.parties[0].share, 0.6);
  assert.equal(tx.blame.ownShare, 0.4);
  assert.equal(verify(store.data.ledger).ok, true);
});

test('the past Sable Quantum loss is blamed on the friends who pushed it', async () => {
  const { call, store } = fresh();
  const lost = store.dealsOf('m01').find((d) => d.assetId === 'a_vc_4' && d.outcome?.multiple === 0.38);
  const tx = await call('GET', `/api/transactions/${lost.id}`);
  assert.equal(tx.blame.verdict, 'blame');
  assert.deepEqual(tx.blame.parties.filter((p) => p.share > 0).map((p) => p.advisorId).sort(), ['m16', 'm18']);
  assert.deepEqual(tx.blame.toldYouSo, ['Hana Brandt']);
});

test('case studies never expose who made the underlying transactions', async () => {
  const { call } = fresh();
  const study = await call('GET', '/api/precedents?topic=vc&sizeM=200');
  assert.ok(study.rows.length >= MIN_ROWS);
  for (const row of study.rows) {
    assert.equal(row.memberId, undefined);
    assert.ok(!JSON.stringify(row).includes('m0') && !JSON.stringify(row).includes('m1'));
  }
  assert.ok(study.pool.external > 0, 'includes transactions from outside the platform');
});

test('network gaps rank every topic and offer a route to fill the top ones', async () => {
  const { call } = fresh();
  const { gaps } = await call('GET', '/api/network');
  assert.equal(gaps.topics.length, 12);
  for (let i = 1; i < gaps.topics.length; i++) assert.ok(gaps.topics[i - 1].gap >= gaps.topics[i].gap);
  assert.ok(gaps.topics.slice(0, 6).every((g) => Array.isArray(g.bridges)));
});

test('introductions go through a mutual friend and create the connection', async () => {
  const { call, store } = fresh();
  assert.equal(store.areFriends('m01', 'm03'), false);
  const { threadId } = await call('POST', '/api/intros', { targetId: 'm03', viaId: 'm16', topic: 'bio' });
  const thread = await call('GET', `/api/threads/${threadId}`, null, 'm16');
  const intro = thread.messages.find((m) => m.intro).intro;
  assert.equal(intro.canRespond, true);
  await call('POST', `/api/intros/${intro.id}/respond`, { accept: true }, 'm16');
  assert.equal(store.areFriends('m01', 'm03'), true);
});

test('members only see their own transactions, and must be signed in', async () => {
  const { call, store } = fresh();
  await assert.rejects(call('GET', '/api/home', null, null), { status: 401 });
  await assert.rejects(call('GET', `/api/transactions/${castellaneId(store)}`, null, 'm02'), { status: 404 });
  await assert.rejects(call('POST', '/api/pay', { accountId: 'm02-inv', assetId: 'a_bio_1', sizeM: 1, action: 'continue' }), { status: 400 });
});

test('dossiers: people in your network who have done this are found, with the relevant part of their file', async () => {
  const { call } = fresh();
  const review = await call('POST', '/api/pay/review', { accountId: 'm01-inv', assetId: 'a_bio_1', sizeM: 350, purpose: 'Series C' });
  const exp = review.advisory.experience;
  assert.ok(exp.length > 0);
  assert.ok(exp.every((e) => ['friend', 'one-intro'].includes(e.relation)));
  assert.ok(exp[0].excerpt.includes('## Biotech') || exp[0].excerpt.includes('## Venture'));
  assert.ok(!exp[0].excerpt.includes('{asset:'), 'internal tags are stripped');
});

test('dossiers keep the member\'s own words when the record refreshes, and are only shared within reach', async () => {
  const { call, store, dossierDir } = fresh();
  const path = join(dossierDir, 'm03.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/> .*/, '> Edited by Priya herself.'));
  syncDossiers(store, dossierDir);
  assert.ok(readFileSync(path, 'utf8').includes('Edited by Priya herself.'));
  const d = await call('GET', '/api/people/m03/dossier');
  assert.ok(d.markdown.includes('Edited by Priya herself.'));
  await assert.rejects(call('GET', '/api/people/m22/dossier'), { status: 403 }, 'Mireille is outside Margaux\'s reach');
});

test('public research only sends an anonymised description unless the member opts in', () => {
  const q = researchQuery({ topic: 'bio', purpose: 'Series C allocation in an oncology biotech', payeeName: 'Castellane Therapeutics Series C', sizeM: 350 });
  assert.ok(q.includes('series c') && q.includes('$250M–$500M'));
  assert.ok(!q.includes('Castellane') && !q.includes('350'));
  assert.ok(researchQuery({ topic: 'bio', payeeName: 'Castellane', sizeM: 350, includeName: true }).includes('Castellane'));
});

test('public research is off without a key, and keeps only sources the search returned', async () => {
  const off = fresh();
  await assert.rejects(off.call('POST', '/api/research', { topic: 'bio', sizeM: 350 }), { status: 503 });

  const calls = [];
  const client = {
    beta: { messages: { create: async (req) => { calls.push(req); return { stop_reason: 'end_turn', content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.com/real', title: 'Real source' }] },
      { type: 'text', text: 'A 2021 oncology Series C later fell 60% after a failed trial.' },
    ] }; } } },
    messages: { parse: async () => ({ stop_reason: 'end_turn', parsed_output: { summary: 'Mixed.', cases: [{ title: 'Oncology Series C', year: '2021', what: 'x', outcome: 'Fell 60%', lesson: 'Check trial data', sources: [{ title: 'Real', url: 'https://example.com/real' }, { title: 'Made up', url: 'https://example.com/fake' }] }] } }) },
  };
  const on = fresh({ researcher: createResearcher({ client, cachePath: null }) });
  const result = await on.call('POST', '/api/research', { topic: 'bio', purpose: 'Series C', payeeName: 'Castellane', sizeM: 350 });
  assert.deepEqual(result.cases[0].sources.map((s) => s.url), ['https://example.com/real']);
  assert.ok(!JSON.stringify(calls[0].messages).includes('Castellane'), 'payee name not sent without opt-in');
  assert.equal(calls[0].model, 'claude-opus-5-5');
  const again = await on.call('POST', '/api/research', { topic: 'bio', purpose: 'Series C', payeeName: 'Castellane', sizeM: 350 });
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1);
});
