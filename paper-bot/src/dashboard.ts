import { createServer, type Server } from "node:http";
import type { Candle, CompletedTrade, Position, Signal } from "./types.ts";

export interface DashboardState {
  symbol: string;
  interval: string;
  startedAt: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
  failures: number;
  candles: Candle[];
  signal: Signal;
  lastAction: string | null;
  sma9: number | null;
  sma21: number | null;
  initialBalance: number;
  cash: number;
  equity: number;
  position: Position | null;
  unrealizedPnl: number;
  trades: CompletedTrade[];
}

const html = String.raw`<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#10111a" />
  <title>BTC paper bot</title>
  <style>
    :root{color-scheme:dark;--bg:#10111a;--panel:#1a1b28;--panel2:#222331;--line:#303140;--text:#f5f5fa;--muted:#999aaa;--green:#56d99a;--red:#ff777d;--amber:#ffc66d;--blue:#9c9cff}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 75% -15%,#233044 0,transparent 42%),var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}
    .wrap{max-width:900px;margin:auto;padding:28px 18px 48px}.top{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:26px}.brand{display:flex;align-items:center;gap:12px}.logo{display:grid;place-items:center;width:44px;height:44px;border-radius:15px;background:#273c38;color:var(--green);font-size:21px;font-weight:900}.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}h1{font-size:21px;margin:1px 0 0}.pill{display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--line);background:#181a24;border-radius:999px;font-size:12px;color:var(--muted)}.dot{height:8px;width:8px;border-radius:99px;background:var(--amber);box-shadow:0 0 14px currentColor}.pill.ok{color:var(--green)}.pill.ok .dot{background:var(--green)}.pill.bad{color:var(--red)}.pill.bad .dot{background:var(--red)}
    .hero{padding:22px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(140deg,#242638,#1a1b28 72%);margin-bottom:14px}.herohead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.pair{font-size:13px;color:var(--muted)}.price{font-size:clamp(32px,8vw,50px);font-weight:750;letter-spacing:-.04em;margin:8px 0 2px}.change{color:var(--muted);font-size:13px}.signal{padding:8px 13px;border:1px solid #3b3c51;border-radius:12px;background:#2b2c3d;font-weight:750;letter-spacing:.06em}.signal.BUY{color:var(--green);border-color:#286449;background:#16352c}.signal.SELL{color:var(--red);border-color:#66383f;background:#382127}.chart{height:130px;margin-top:14px;width:100%;display:block}.chartline{fill:none;stroke:var(--blue);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}.chartarea{fill:url(#fill)}.chartgrid{stroke:#363747;stroke-width:1;stroke-dasharray:3 6}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0}.card{padding:16px;border:1px solid var(--line);border-radius:17px;background:var(--panel)}.label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}.value{font-size:21px;font-weight:720;margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sub{font-size:12px;color:var(--muted);margin-top:4px}.section{padding:18px;border:1px solid var(--line);border-radius:18px;background:var(--panel);margin-top:14px}.sectionhead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:12px}.section h2{font-size:15px;margin:0}.small{font-size:12px;color:var(--muted)}.row{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid #2b2c39}.row:first-of-type{border-top:0}.row span:first-child{color:var(--muted)}.green{color:var(--green)}.red{color:var(--red)}.error{display:none;padding:13px 15px;border:1px solid #70444a;background:#321e25;color:#ffc0c4;border-radius:14px;margin:12px 0}.empty{padding:18px 0;color:var(--muted);text-align:center}.footer{padding:20px 4px 0;color:var(--muted);font-size:11px;text-align:center}
    @media(max-width:650px){.wrap{padding:20px 14px 36px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.card{padding:14px}.hero{padding:18px}.chart{height:112px}.pill{font-size:11px;padding:7px 9px}.value{font-size:19px}}
  </style>
</head>
<body><main class="wrap">
  <header class="top"><div class="brand"><div class="logo">₿</div><div><div class="eyebrow">Paper trading</div><h1>BTC Bot</h1></div></div><div id="health" class="pill"><i class="dot"></i><span>Verbinden…</span></div></header>
  <div id="error" class="error"></div>
  <section class="hero"><div class="herohead"><div><div id="pair" class="pair">BTC-USD · 5 min · Coinbase</div><div id="price" class="price">—</div><div id="time" class="change">Wacht op de eerste candle</div></div><div id="signal" class="signal">HOLD</div></div><svg id="chart" class="chart" viewBox="0 0 800 130" preserveAspectRatio="none" aria-label="BTC koersgrafiek"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#9c9cff" stop-opacity=".27"/><stop offset="1" stop-color="#9c9cff" stop-opacity="0"/></linearGradient></defs><path class="chartgrid" d="M0 30H800M0 65H800M0 100H800"/><path id="area" class="chartarea"/><path id="line" class="chartline"/></svg></section>
  <section class="grid">
    <article class="card"><div class="label">Paper equity</div><div id="equity" class="value">—</div><div id="cash" class="sub">Start $10.000</div></article>
    <article class="card"><div class="label">Open positie</div><div id="position" class="value">Geen</div><div id="pnl" class="sub">—</div></article>
    <article class="card"><div class="label">SMA 9</div><div id="sma9" class="value">—</div><div class="sub">Snelle lijn</div></article>
    <article class="card"><div class="label">SMA 21</div><div id="sma21" class="value">—</div><div class="sub">Langzame lijn</div></article>
  </section>
  <section class="section"><div class="sectionhead"><h2>Botstatus</h2><span id="updated" class="small">—</span></div><div class="row"><span>Databron</span><strong>Coinbase Exchange</strong></div><div class="row"><span>Interval</span><strong id="interval">5m</strong></div><div class="row"><span>Laatste actie</span><strong id="action">—</strong></div><div class="row"><span>Afgeronde paper trades</span><strong id="trades">0</strong></div></section>
  <section class="section"><div class="sectionhead"><h2>Recente trades</h2><span class="small">Paper only</span></div><div id="tradeList" class="empty">Nog geen afgeronde trades.</div></section>
  <footer class="footer">Alleen simulatie · Geen live orders · Paper saldo en positie resetten als het proces herstart.</footer>
</main>
<script>
const $=id=>document.getElementById(id),money=n=>Number(n).toLocaleString('nl-NL',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}),fmt=t=>t?new Date(t).toLocaleString('nl-NL',{dateStyle:'short',timeStyle:'short'}):'—';
function draw(candles){const vals=candles.map(x=>x.close);if(vals.length<2)return;const min=Math.min(...vals),max=Math.max(...vals),span=max-min||1,pts=vals.map((v,i)=>(i/(vals.length-1)*800)+','+(115-(v-min)/span*100));$('line').setAttribute('d','M'+pts.join(' L'));$('area').setAttribute('d','M'+pts[0]+' L'+pts.join(' L')+' L800 130 L0 130 Z')}
async function refresh(){try{const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error('Status ophalen mislukt ('+r.status+')');const s=await r.json();const age=s.lastSuccessAt?Date.now()-new Date(s.lastSuccessAt).getTime():Infinity;const live=age<90000;const h=$('health');h.className='pill '+(live?'ok':'bad');h.innerHTML='<i class="dot"></i><span>'+(live?'MARKTDATA LIVE':'GEEN VERBINDING')+'</span>';$('pair').textContent=s.symbol+' · '+s.interval+' · Coinbase';$('interval').textContent=s.interval;$('updated').textContent='Verversd '+new Date().toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit',second:'2-digit'});const c=s.candles?.at(-1);if(c){$('price').textContent=money(c.close);$('time').textContent='Gesloten candle '+fmt(c.closeTime);$('sma9').textContent=s.sma9==null?'—':money(s.sma9);$('sma21').textContent=s.sma21==null?'—':money(s.sma21);draw(s.candles)}$('signal').textContent=s.signal||'HOLD';$('signal').className='signal '+(s.signal||'HOLD');$('equity').textContent=money(s.equity);$('cash').textContent='Cash '+money(s.cash)+' · start '+money(s.initialBalance);$('position').textContent=s.position?s.position.quantity.toFixed(6)+' BTC':'Geen';$('pnl').textContent=s.position?'Onverwerkt '+money(s.unrealizedPnl)+' · stop '+money(s.position.stopPrice)+' · TP '+money(s.position.takeProfitPrice):'Geen open paperpositie';$('pnl').className='sub '+(s.unrealizedPnl>=0?'green':'red');$('action').textContent=s.lastAction||'Geen nieuwe actie';$('trades').textContent=String(s.trades.length);const err=$('error');err.style.display=s.error?'block':'none';err.textContent=s.error?'Databronfout: '+s.error:'';const list=$('tradeList');if(s.trades.length){list.className='';list.innerHTML=s.trades.slice(-8).reverse().map(t=>'<div class="row"><span>'+fmt(t.exitTime)+' · '+(t.reason==='STOP_LOSS'?'Stop-loss':t.reason==='TAKE_PROFIT'?'Take-profit':'SMA verkoop')+'</span><strong class="'+(t.netPnl>=0?'green':'red')+'">'+money(t.netPnl)+'</strong></div>').join('')}else{list.className='empty';list.textContent='Nog geen afgeronde trades.'}}catch(e){const h=$('health');h.className='pill bad';h.innerHTML='<i class="dot"></i><span>GEEN VERBINDING</span>';$('error').style.display='block';$('error').textContent=e.message}}
refresh();setInterval(refresh,10000);
</script></body></html>`;

export function startDashboard(readState: () => DashboardState, port = Number(process.env.PORT ?? 3000)): Server {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET" }).end("Method not allowed");
      return;
    }
    if (pathname === "/api/status") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
      }).end(JSON.stringify(readState()));
      return;
    }
    if (pathname === "/" || pathname === "/index.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
      }).end(html);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  });
  server.listen(port, "0.0.0.0", () => console.log(`Paper dashboard listening on port ${port}.`));
  return server;
}
