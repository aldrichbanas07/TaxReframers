# Inner Circle

A private banking app for ultra-high-net-worth members. Before any significant payment leaves an account, it asks what the payment is for. It then shows how similar transactions have gone, which of your friends actually know this area, and anything they stand to gain from your decision. You choose between two options: **talk to them first** (the payment is held and the bank's members-only messaging, Private Line, opens a thread with each person you pick) or **continue anyway**.

Every question, piece of advice, decision and outcome is written to a tamper-evident ledger, so when a transaction goes wrong, you can see exactly who told you to do it.

## Run it

Requires Node 20 or later. There are no dependencies to install.

```bash
npm install        # once: the Anthropic SDK, used only for public research
npm start          # http://127.0.0.1:3000
npm run reset      # wipe data/db.json and regenerate the demo data
npm test           # 16 tests: engine, API flow, dossiers, research, privacy, ledger tamper detection
```

## Demo walkthrough

You start as **Margaux Ellery**. Use the "Demo: view as" menu to switch members.

1. **Home → Castellane Therapeutics (on hold).** Three friends have answered. Kenji says "send it" at 92% confidence, but he holds a stake in Castellane and 7 of his 12 past calls made with money on the line went wrong. The app rates his advice **high risk** (45% chance it works against her, against 23% if he had nothing riding on it).
2. **Pay.** Type "Castellane", enter 350, then for "What is this for?" type "Series C in an oncology biotech". The "Before you send" screen then shows:
   - comparable deals, from members and from public records
   - each friend's record in biotech, with any conflicts flagged
   - Priya Castell, one introduction away through Kenji
   - the fact that biotech is a gap in Margaux's network

   It ends with the two options.
3. **Private Line.** Teodor has asked Margaux about a $600M port. Open the thread to give a call. Before you send it, the app shows what will go on the record about your own position and how your call will be scored.
4. **Network.** The advice map plots each area by how much it matters to you against how well your friends cover it. Gaps come with "Ask Kenji to introduce you" buttons.
5. **Record.** Shows that the chain is intact and has a "who to blame" table across completed payments. Open the past **Sable Quantum Series B** loss (sent in March 2022, returned 0.38x) to see the blame split: Margaux 40%, then Kenji and Omar, with Hana listed under "Told you so".

## Dossiers: people who have done this

Each member has a markdown file in `data/dossiers/` (for example `m03.md` for Priya Castell). It has two parts:

- **In their words**: written by the member or their relationship manager. Edit it freely; it is never overwritten.
- **The record**: generated from the bank's own data. It lists their transactions by area, what each returned, and their advice record. It is rebuilt whenever anything changes.

When you're about to pay, the app looks through your friends and people one introduction away. It finds anyone who has invested in the same payee, in the same area, or in an adjacent area (for example venture for a biotech round). It shows the relevant part of their dossier, and their stake if they still hold one. Dossiers are only shared within that reach.

## Public case studies (optional, uses Claude)

When nobody in your network has done this, the "Beyond your network" section can search the public web for comparable transactions. It uses Claude (`claude-opus-5-5`) with web search, then a second call to structure the results. Every case carries source links, and links the search didn't actually return are dropped.

It is off until the server has a key. Set it in the server's environment; never put it in the browser or a chat:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start      # macOS / Linux
$env:ANTHROPIC_API_KEY="sk-ant-..."; npm start   # Windows PowerShell
```

What leaves the bank is shown on screen before anything is sent. By default it is only an anonymised description, for example `biotech & health · series c, oncology · ticket size $250M–$500M`. The payee's name is added only if the member ticks the box. The member's name, the account and the exact amount are never sent. Results are cached in `data/research-cache.json`, so a repeated search costs nothing.

## How each feature works

| Feature | Where | Method |
|---|---|---|
| "What is this for?" | [classify.js](src/engine/classify.js) | Keyword rules over the purpose text and the payee name, plus matching against known payees. The member can correct the result. Personal payments (payroll, household and so on) skip the advice step. |
| Friends who know | [advisors.js](src/engine/advisors.js), [credibility.js](src/engine/credibility.js) | A 0–100 credibility score per member per area, learned from the platform's records rather than self-description: their own returns compared with other buyers of the same asset, plus their advice hit rate. Both are shrunk toward 50 until there is enough evidence. |
| Conflict detection | `conflictState` in [credibility.js](src/engine/credibility.js) | From the advisor's own transactions: holds a stake in this asset, sold out of it in the past year, or is competing for the same deals. |
| Network gap detector | [gaps.js](src/engine/gaps.js) | For each area: importance (your recent money in it, plus where members are moving) against coverage (credible, close, non-competing friends). Also flags single points of failure and finds routes in through mutual friends. |
| Case studies | [precedents.js](src/engine/precedents.js) | Nearest neighbours by size, asset and recency, drawn from members' completed transactions and from off-platform public records. Also compares deals made with and without advice, and shows which members have called these right and how members are moving now. |
| Bias estimate | [bias.js](src/engine/bias.js) | Logistic regression trained on every resolved piece of advice. The headline figure is the chance a call works against you. "Conflicts add N points" is the same prediction with the conflict features switched off. |
| Who to blame | [blame.js](src/engine/blame.js), [ledger.js](src/engine/ledger.js) | A SHA-256 hash-chained, append-only ledger. You carry 40% of any call you made on someone's advice. Advisors you followed share the rest according to how hard they pushed and how close you are. |

## What is real and what is simulated

- **All people and assets are fictional.** [seed.js](src/data/seed.js) generates six years of history deterministically. Each member has hidden skill and self-interest traits that drive the simulation and are then discarded, so the engine has to rediscover them from the record, as it would with real data.
- **The bias model's accuracy is modest.** On held-out advice it scores an AUC of about 0.57 (0.5 is a coin flip). The UI says so and presents the estimate as a warning light, not a verdict.
- **No AI service is used.** Everything runs locally, so no API key is needed.
- **Network onboarding is not built.** The app assumes your network and your friends' accounts are already connected. Onboarding would need explicit consent from every member whose transactions feed the case studies and credibility scores.
- **Privacy rules already in place.** Members only see aggregates and anonymised rows from other people's transactions. Individual rows are withheld when fewer than 5 comparable transactions exist. Direct Private Line conversations stay off the ledger; anything said in a transaction thread goes on it.

## Before this could be a real product

- **Sign-in.** It is a demo header (`x-member-id`). Replace it with real authentication and sessions.
- **Payments and outcomes.** Money movement and outcomes are simulated. "Record outcome" on a sent payment is a demo control. In live use, outcomes would come from distributions landing in the account or from asset marks.
- **Storage.** The single JSON file in `data/` should become a database. The ledger should also be anchored externally (for example by periodically publishing the head hash) so the operator can't rewrite it.
- **Legal and compliance.** Sharing members' transactions across a network, and scoring each other's advice, needs legal review: data protection, banking secrecy, and whether "advice" from members falls under investment-advice rules.

## Layout

```
server.js               HTTP server: static files plus JSON API, no dependencies
src/api.js              every endpoint; computes views per signed-in member
src/store.js            in-memory store, indexes, JSON persistence
src/engine/             classify, credibility, advisors, gaps, precedents, bias, blame, ledger
src/data/               fictional catalog and the deterministic seed generator
public/                 the app (vanilla JS modules, no build step)
test/app.test.js        node:test suite
```
