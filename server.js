import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const defaultDelayMs = Math.min(900_000, Math.max(0, Number(process.env.PULL_DELAY_MS ?? 8_000)));
const trades = seedTrades(2_400);
const clients = new Set();
let activePull = null;
let lastPull = null;

function seedTrades(count) {
  const symbols = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'ITC', 'LT', 'SBIN'];
  const start = Date.now() - count * 1_000;
  return Array.from({ length: count }, (_, i) => ({
    tradeId: `BSE${String(870000 + i).padStart(8, '0')}`,
    client: `CLIENT${String((i % 173) + 1).padStart(4, '0')}`,
    symbol: symbols[i % symbols.length],
    quantity: ((i * 37) % 900) + 1,
    price: Number((80 + ((i * 193) % 42000) / 100).toFixed(2)),
    timestamp: new Date(start + i * 1_000).toISOString()
  }));
}

function sendEvent(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of clients) response.write(message);
}

function mockBseGetTrades() {
  return seedTrades(2_400);
}

function startPull(delayMs) {
  if (activePull) return activePull;
  const job = { id: randomUUID(), startedAt: new Date().toISOString(), delayMs };
  activePull = job;
  sendEvent('pull-started', { ...job, status: 'running' });
  // The simulated exchange work continues independently of the HTTP request that started it.
  setTimeout(async () => {
    try {
      const exchangeResponse = await fetch(`http://127.0.0.1:${port}/getTrades`);
      if (!exchangeResponse.ok) throw new Error(`Mock BSE returned ${exchangeResponse.status}`);
      const { trades: pulledTrades } = await exchangeResponse.json();
      const batch = pulledTrades.map((trade, i) => ({
      ...trade,
      tradeId: `NEW${job.id.slice(0, 12).toUpperCase()}${String(i + 1).padStart(4, '0')}`,
      timestamp: new Date(Date.now() - (pulledTrades.length - i) * 1_000).toISOString()
      }));
      trades.unshift(...batch);
      lastPull = { id: job.id, completedAt: new Date().toISOString(), added: batch.length };
      activePull = null;
      sendEvent('pull-completed', { ...lastPull, trades: batch, total: trades.length });
    } catch (error) {
      activePull = null;
      sendEvent('pull-failed', { id: job.id, message: error.message });
    }
  }, delayMs);
  return job;
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === 'GET' && url.pathname === '/getTrades') {
    // Mock BSE API returns promptly; the orchestrated background pull owns the long delay.
    const batch = mockBseGetTrades();
    return json(response, 200, { trades: batch, total: batch.length, pulledAt: new Date().toISOString() });
  }
  if (request.method === 'GET' && url.pathname === '/api/trades') {
    return json(response, 200, { trades, total: trades.length, activePull, lastPull });
  }
  if (request.method === 'POST' && url.pathname === '/api/pull') {
    const body = await new Promise(resolve => {
      let raw = ''; request.on('data', chunk => raw += chunk);
      request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    });
    const delayMs = Math.min(900_000, Math.max(0, Number(body.delayMs ?? defaultDelayMs)));
    const job = startPull(delayMs);
    return json(response, activePull?.id === job.id ? 202 : 200, { ...job, status: activePull ? 'running' : 'complete' });
  }
  if (request.method === 'GET' && url.pathname === '/api/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    response.write(`event: snapshot\ndata: ${JSON.stringify({ activePull, lastPull, total: trades.length })}\n\n`);
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }
  if (request.method === 'GET') {
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    try {
      const content = await readFile(join(root, 'public', path));
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
      response.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
      return response.end(content);
    } catch { return json(response, 404, { error: 'Not found' }); }
  }
  return json(response, 405, { error: 'Method not allowed' });
});

server.listen(port, () => console.log(`Trades dashboard ready at http://localhost:${port} (default pull delay: ${defaultDelayMs}ms)`));
