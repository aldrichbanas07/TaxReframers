import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './src/store.js';
import { generateSeed } from './src/data/seed.js';
import Anthropic from '@anthropic-ai/sdk';
import { createApi, HttpError } from './src/api.js';
import { syncDossiers } from './src/engine/dossier.js';
import { createResearcher } from './src/research.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const DATA = process.env.DATA_DIR ?? join(ROOT, 'data');
const DB_PATH = join(DATA, 'db.json');
const DOSSIERS = join(DATA, 'dossiers');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_BODY = 64 * 1024;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

if (process.argv.includes('--reset')) {
  rmSync(DB_PATH, { force: true });
  rmSync(DOSSIERS, { recursive: true, force: true });
}

let store = Store.load(DB_PATH);
if (!store) {
  store = generateSeed();
  store.save(DB_PATH);
  console.log(`Seeded demo data → ${DB_PATH}`);
}

syncDossiers(store, DOSSIERS);

// Research beyond the network is off unless the server has an Anthropic API key in its environment.
// RESEARCH=on also enables it with other Anthropic credentials (e.g. an `ant auth login` profile).
const researcher = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.RESEARCH === 'on'
  ? createResearcher({ client: new Anthropic(), cachePath: join(DATA, 'research-cache.json') })
  : null;
console.log(researcher ? 'Public case-study research: on' : 'Public case-study research: off (set ANTHROPIC_API_KEY to enable)');

const api = createApi(store, { persist: () => store.save(DB_PATH), dossierDir: DOSSIERS, researcher });

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolveBody(null);
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};

async function serveStatic(res, pathname) {
  const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^([/\\])+/, '');
  const file = resolve(PUBLIC, rel);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) return send(res, 403, { error: 'Forbidden' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 200, await readFile(join(PUBLIC, 'index.html')), TYPES['.html']);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'POST' ? await readBody(req) : null;
      send(res, 200, await api(req.method, url, req.headers, body));
    } else if (req.method === 'GET') {
      await serveStatic(res, url.pathname);
    } else {
      send(res, 405, { error: 'Method not allowed' });
    }
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, { error: err.message });
    else { console.error(err); send(res, 500, { error: 'Something went wrong' }); }
  }
});

server.listen(PORT, HOST, () => console.log(`Inner Circle running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
