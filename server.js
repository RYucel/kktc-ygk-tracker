// Local development server – mimics Vercel: serves static files and /api/scrape.
// Usage: npm start   (PORT env var optional, default 3000)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './api/scrape.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' };

// In-memory cache so local reloads don't hammer the source (30 min)
const cache = new Map();
const TTL = 30 * 60 * 1000;

function vercelRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.end(body); return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return res; };
  return res;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/scrape') {
      const key = url.searchParams.get('year') || 'current';
      const hit = cache.get(key);
      if (hit && Date.now() - hit.t < TTL) {
        res.writeHead(200, hit.headers);
        return res.end(hit.body);
      }
      req.query = Object.fromEntries(url.searchParams);
      // capture response for caching
      const chunks = [];
      const origEnd = res.end.bind(res);
      res.end = (body) => { if (body) chunks.push(body); return origEnd(body); };
      await handler(req, vercelRes(res));
      if (res.statusCode === 200) cache.set(key, { t: Date.now(), headers: res.getHeaders(), body: chunks.join('') });
      console.log(`[api] year=${key} -> ${res.statusCode} ${res.getHeader('X-Source') || ''}`);
      return;
    }

    const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^([/\\])+/, '');
    if (rel.startsWith('..') || rel.startsWith('api') || rel.startsWith('node_modules')) throw Object.assign(new Error(), { code: 'ENOENT' });
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('Not found'); }
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
  }
});

server.listen(PORT, () => console.log(`KKTC YGK Tracker -> http://localhost:${PORT}`));
