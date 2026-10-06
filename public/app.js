const $ = id => document.getElementById(id);
const rows = $('tradeRows');
const button = $('pullButton');
let currentJob = null;
let timer = null;
let trades = [];
const formatter = new Intl.NumberFormat('en-IN');

function renderTrades(items, append = false) {
  trades = append ? [...items, ...trades] : items;
  if (!trades.length) {
    rows.innerHTML = '<tr><td colspan="6" class="loading">No trades available.</td></tr>';
  } else {
    rows.innerHTML = trades.slice(0, 80).map(t => `<tr><td class="trade-id">${t.tradeId}</td><td>${t.client}</td><td class="symbol">${t.symbol}</td><td class="number">${formatter.format(t.quantity)}</td><td class="number price">${Number(t.price).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td class="timestamp">${new Date(t.timestamp).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'medium'})}</td></tr>`).join('');
  }
  $('tradeCount').textContent = formatter.format(trades.length);
  $('showing').textContent = `Showing ${Math.min(80, trades.length)} of ${formatter.format(trades.length)} trades`;
}

function showJob(job) {
  currentJob = job;
  $('pullState').textContent = job ? 'In progress' : 'Ready';
  $('statusText').textContent = job ? 'Pull in progress · your existing trades remain available' : 'Dashboard is up to date';
  button.disabled = Boolean(job);
  button.innerHTML = job ? '<span class="refresh">↻</span> Pull in progress' : '<span class="refresh">↻</span> Pull latest trades';
  clearInterval(timer);
  if (job) timer = setInterval(() => {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000));
    $('elapsed').textContent = `Running · ${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  }, 1000);
  else $('elapsed').textContent = '';
}

async function loadInitial() {
  const result = await fetch('/api/trades').then(r => r.json());
  renderTrades(result.trades);
  showJob(result.activePull);
  if (result.lastPull) {
    $('lastPulled').textContent = new Date(result.lastPull.completedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    $('lastPulledNote').textContent = `${result.lastPull.added} new trades added`;
  }
}

const events = new EventSource('/api/events');
events.addEventListener('snapshot', event => {
  const state = JSON.parse(event.data);
  if (state.activePull) showJob(state.activePull);
});
events.addEventListener('pull-started', event => showJob(JSON.parse(event.data)));
events.addEventListener('pull-completed', event => {
  const result = JSON.parse(event.data);
  renderTrades(result.trades, true);
  showJob(null);
  $('lastPulled').textContent = new Date(result.completedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  $('lastPulledNote').textContent = `${result.added} new trades added`;
  $('statusText').textContent = `Pull complete · ${result.added} new trades are now available`;
});
events.addEventListener('pull-failed', event => {
  const result = JSON.parse(event.data);
  showJob(null);
  $('statusText').textContent = `Pull failed · ${result.message}`;
});
events.onerror = () => { $('statusText').textContent = 'Reconnecting to live updates…'; };

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const response = await fetch('/api/pull', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({}) });
    if (!response.ok) throw new Error('Could not start pull');
    showJob(await response.json());
  } catch (error) {
    $('statusText').textContent = error.message;
    button.disabled = false;
  }
});
loadInitial().catch(() => { rows.innerHTML = '<tr><td colspan="6" class="loading">Could not load trades. Check that the server is running.</td></tr>'; });
