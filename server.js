require('dotenv').config();
const express = require('express');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3005;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));

// ─── Data ───────────────────────────────────────────────────────────────────

const INTERVENTIONS = [
  { id: 1, text: "Install real-time temperature sensors in refrigerated trucks", domain: "food" },
  { id: 2, text: "Train warehouse workers on cold chain protocols", domain: "food" },
  { id: 3, text: "Require cold chain certification for all produce distributors", domain: "food" },
  { id: 4, text: "Penalize distributors financially for temperature exceedances", domain: "food" },
  { id: 5, text: "Redesign supply chains so produce travels less than 200 miles", domain: "food" },
  { id: 6, text: "Change the success metric from 'cost per unit delivered' to 'percent arriving at peak quality'", domain: "food" },
  { id: 7, text: "Install more energy-efficient cooling in data centers", domain: "data" },
  { id: 8, text: "Require data centers to disclose water and energy consumption publicly", domain: "data" },
  { id: 9, text: "Site new data centers only adjacent to verified renewable energy sources", domain: "data" },
  { id: 10, text: "Give host communities a formal vote on data center siting decisions", domain: "data" },
  { id: 11, text: "End local tax subsidies for data center construction", domain: "data" },
  { id: 12, text: "Establish a global standard for measuring and reporting data center embodied carbon", domain: "data" },
];

const CHAINS = [
  {
    id: "kennedy",
    title: "Kennedy Moon Landing",
    subtitle: "Deep → Shallow: A moonshot cascades through every realm",
    steps: [
      { text: "Kennedy declares 'man on the moon before the decade is out'", realm: "Intent", detail: "A goal-level intervention — redefining what the nation's space program is FOR" },
      { text: "NASA reorganizes entirely around the lunar mission", realm: "Design", detail: "Institutional restructuring — new divisions, new decision-making processes, new incentive structures" },
      { text: "Mission control, telemetry, and real-time feedback systems created", realm: "Feedbacks", detail: "Entirely new information flows — real-time monitoring of every system parameter" },
      { text: "Massive parameter innovation: rocket fuels, materials, computing", realm: "Parameters", detail: "The tangible stuff — thousands of engineering innovations driven by the deeper goal" },
    ],
  },
  {
    id: "strawberry",
    title: "Strawberry Cold Chain",
    subtitle: "Shallow → Deep: A measurement tool triggers a chain to system goals",
    steps: [
      { text: "Electronic thermometers inserted in strawberry pallets", realm: "Parameters", detail: "A simple measurement device — cheap, easy to deploy, no one objects" },
      { text: "Data reveals systemic temperature failures at every handoff", realm: "Feedbacks", detail: "The data makes the invisible visible — failures aren't random, they're structural" },
      { text: "Evidence base drives certification requirements for distributors", realm: "Design", detail: "New rules emerge because now there's proof — you can't argue with the thermometers" },
      { text: "Contracts reframed around quality preservation, not cost per delivery", realm: "Intent", detail: "The goal of the system shifts — from 'move it cheap' to 'move it well'" },
    ],
  },
  {
    id: "ozone",
    title: "Ozone / Montreal Protocol",
    subtitle: "Making a problem visible enabled a rule that changed a paradigm",
    steps: [
      { text: "Scientists monitor and document ozone layer depletion", realm: "Feedbacks", detail: "Satellite data and atmospheric measurements make an invisible crisis visible to the world" },
      { text: "Montreal Protocol bans CFC production and use", realm: "Design", detail: "International agreement — 197 countries agree to phase out ozone-depleting substances" },
      { text: "Entire chemical industry pivots away from ozone-depleting chemicals", realm: "Intent", detail: "Paradigm shift — the industry's fundamental approach to refrigerants and propellants changes permanently" },
    ],
  },
  {
    id: "smoking",
    title: "Smoking Public Health",
    subtitle: "Information → Regulation → Culture change",
    steps: [
      { text: "Surgeon General's report and warning labels on cigarettes", realm: "Feedbacks", detail: "Information flow — making health risks visible to consumers for the first time" },
      { text: "Advertising bans and indoor smoking laws enacted", realm: "Design", detail: "Rule changes — restricting where and how tobacco can be marketed and consumed" },
      { text: "Cultural paradigm shift: smoking goes from normal to stigmatized", realm: "Intent", detail: "Society's relationship with smoking fundamentally changes — what was once glamorous becomes unacceptable" },
    ],
  },
];

const REALMS = ["Parameters", "Feedbacks", "Design", "Intent"];
const VALID_PHASES = ['waiting', 'classify-food', 'classify-data', 'chains', 'discuss'];

// ─── Session state ──────────────────────────────────────────────────────────

let session = {
  phase: 'waiting',
  activeChain: null,
  classifications: {},
  chainRankings: {},    // { visitorId: { chainId: [stepIdx, stepIdx, ...] } } — index 0 = highest leverage
  chainSubmissions: [],
  displayHighlight: null,
  qrSvg: null,
  qrUrl: null,
};

// ─── Auth middleware ────────────────────────────────────────────────────────

function requirePin(req, res, next) {
  if (req.headers['x-admin-pin'] !== ADMIN_PIN) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  next();
}

// ─── Public API ─────────────────────────────────────────────────────────────

app.get('/api/interventions', (req, res) => {
  res.json(INTERVENTIONS);
});

app.get('/api/chains', (req, res) => {
  res.json(CHAINS);
});

app.get('/api/state', (req, res) => {
  const totals = {};
  for (const intervention of INTERVENTIONS) {
    totals[intervention.id] = { Parameters: 0, Feedbacks: 0, Design: 0, Intent: 0 };
  }
  for (const votes of Object.values(session.classifications)) {
    for (const [iId, realm] of Object.entries(votes)) {
      if (totals[iId] && REALMS.includes(realm)) {
        totals[iId][realm]++;
      }
    }
  }

  // Compute chain ranking averages for the active chain
  const chainRankAverages = {};
  let chainRankCount = 0;
  if (session.activeChain) {
    const chain = CHAINS.find(c => c.id === session.activeChain);
    if (chain) {
      const sums = {};
      chain.steps.forEach((_, i) => { sums[i] = 0; });
      for (const rankings of Object.values(session.chainRankings)) {
        const ranking = rankings[session.activeChain];
        if (!ranking || ranking.length !== chain.steps.length) continue;
        chainRankCount++;
        ranking.forEach((stepIdx, rank) => {
          sums[stepIdx] = (sums[stepIdx] || 0) + (rank + 1); // rank 1-based
        });
      }
      for (const [stepIdx, sum] of Object.entries(sums)) {
        chainRankAverages[stepIdx] = chainRankCount > 0 ? +(sum / chainRankCount).toFixed(1) : 0;
      }
    }
  }

  const response = {
    phase: session.phase,
    activeChain: session.activeChain,
    classificationTotals: totals,
    voterCount: Object.keys(session.classifications).length,
    chainRankAverages,
    chainRankCount,
    chainSubmissions: session.chainSubmissions,
    displayHighlight: session.displayHighlight,
  };

  if (session.phase === 'waiting' && session.qrSvg) {
    response.qrSvg = session.qrSvg;
    response.qrUrl = session.qrUrl;
  }

  res.json(response);
});

app.post('/api/classify', (req, res) => {
  const { visitorId, interventionId, realm } = req.body;
  if (!visitorId || !interventionId || !REALMS.includes(realm)) {
    return res.status(400).json({ error: 'Invalid classification' });
  }
  if (!session.classifications[visitorId]) {
    session.classifications[visitorId] = {};
  }
  session.classifications[visitorId][interventionId] = realm;
  res.json({ ok: true });
});

app.post('/api/chain-submit', (req, res) => {
  const { visitorId, teamName, text } = req.body;
  if (!visitorId || !text || text.length > 1000) {
    return res.status(400).json({ error: 'Invalid submission' });
  }
  const existing = session.chainSubmissions.findIndex(s => s.visitorId === visitorId);
  if (existing !== -1) {
    session.chainSubmissions[existing] = {
      visitorId,
      teamName: (teamName || 'Anonymous').slice(0, 50),
      text: text.slice(0, 1000),
      timestamp: new Date().toISOString(),
    };
    return res.json({ ok: true, index: existing, updated: true });
  }
  session.chainSubmissions.push({
    visitorId,
    teamName: (teamName || 'Anonymous').slice(0, 50),
    text: text.slice(0, 1000),
    timestamp: new Date().toISOString(),
  });
  res.json({ ok: true, index: session.chainSubmissions.length - 1 });
});

app.post('/api/chain-rank', (req, res) => {
  const { visitorId, chainId, ranking } = req.body;
  if (!visitorId || !chainId || !Array.isArray(ranking)) {
    return res.status(400).json({ error: 'Invalid ranking' });
  }
  const chain = CHAINS.find(c => c.id === chainId);
  if (!chain || ranking.length !== chain.steps.length) {
    return res.status(400).json({ error: 'Ranking must include all steps' });
  }
  // Validate: each step index appears exactly once
  const sorted = [...ranking].sort();
  const expected = chain.steps.map((_, i) => i);
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
    return res.status(400).json({ error: 'Invalid step indices in ranking' });
  }
  if (!session.chainRankings[visitorId]) session.chainRankings[visitorId] = {};
  session.chainRankings[visitorId][chainId] = ranking;
  res.json({ ok: true });
});

// ─── Admin API ──────────────────────────────────────────────────────────────

app.get('/api/admin/verify', requirePin, (req, res) => {
  res.json({ ok: true, phase: session.phase });
});

app.post('/api/admin/phase', requirePin, (req, res) => {
  const { phase } = req.body;
  if (!VALID_PHASES.includes(phase)) {
    return res.status(400).json({ error: 'Invalid phase' });
  }
  session.phase = phase;
  res.json({ ok: true, phase });
});

app.post('/api/admin/active-chain', requirePin, (req, res) => {
  const { chainId } = req.body;
  session.activeChain = chainId;
  res.json({ ok: true, activeChain: chainId });
});

app.post('/api/admin/highlight', requirePin, (req, res) => {
  const { index } = req.body;
  session.displayHighlight = index !== undefined ? index : null;
  res.json({ ok: true });
});

app.post('/api/admin/reset', requirePin, (req, res) => {
  const { confirm } = req.body;
  if (!confirm) return res.status(400).json({ error: 'Must confirm reset' });
  session = {
    phase: 'waiting',
    activeChain: null,
    classifications: {},
    chainRankings: {},
    chainSubmissions: [],
    displayHighlight: null,
    qrSvg: null,
    qrUrl: null,
  };
  res.json({ ok: true });
});

app.get('/api/admin/qr', requirePin, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 2 });
    session.qrSvg = svg;
    session.qrUrl = url;
    res.type('image/svg+xml').send(svg);
  } catch (e) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// ─── Dummy data ─────────────────────────────────────────────────────────────

app.post('/api/admin/load-dummy', requirePin, (req, res) => {
  const teams = ['Produce', 'Protein', 'TVs', 'EVs', 'AI', 'Streaming'];
  const realmWeights = {
    1:  { Parameters: 30, Feedbacks: 8, Design: 4, Intent: 2 },
    2:  { Parameters: 20, Feedbacks: 12, Design: 8, Intent: 4 },
    3:  { Parameters: 4, Feedbacks: 6, Design: 28, Intent: 6 },
    4:  { Parameters: 3, Feedbacks: 5, Design: 25, Intent: 11 },
    5:  { Parameters: 10, Feedbacks: 4, Design: 18, Intent: 12 },
    6:  { Parameters: 2, Feedbacks: 3, Design: 8, Intent: 31 },
    7:  { Parameters: 32, Feedbacks: 6, Design: 3, Intent: 3 },
    8:  { Parameters: 5, Feedbacks: 18, Design: 16, Intent: 5 },
    9:  { Parameters: 8, Feedbacks: 4, Design: 22, Intent: 10 },
    10: { Parameters: 2, Feedbacks: 3, Design: 20, Intent: 19 },
    11: { Parameters: 3, Feedbacks: 4, Design: 28, Intent: 9 },
    12: { Parameters: 6, Feedbacks: 14, Design: 18, Intent: 6 },
  };

  function weightedPick(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const [realm, w] of Object.entries(weights)) {
      r -= w;
      if (r <= 0) return realm;
    }
    return 'Parameters';
  }

  session.classifications = {};
  for (let i = 0; i < 44; i++) {
    const vid = `dummy_${i}`;
    session.classifications[vid] = {};
    for (const intervention of INTERVENTIONS) {
      session.classifications[vid][intervention.id] = weightedPick(realmWeights[intervention.id]);
    }
  }

  const chainTexts = [
    { team: 'Produce', text: 'Install GPS temperature trackers on produce trucks (Parameters) → data shows 40% of spoilage happens at warehouse loading docks (Feedbacks) → grocery chains require certified cold-dock procedures (Design) → industry shifts from "cheapest route" to "quality-guaranteed delivery" (Intent)' },
    { team: 'Produce', text: 'Smart packaging with freshness indicators (Parameters) → consumers see quality data at point of purchase (Feedbacks) → retailers compete on freshness transparency (Design) → food waste reduction becomes a brand differentiator (Intent)' },
    { team: 'Protein', text: 'Blockchain traceability for meat supply chain (Parameters) → contamination outbreaks traced in hours not weeks (Feedbacks) → FDA mandates real-time tracking for all protein distributors (Design) → consumer trust shifts from brand loyalty to verified safety records (Intent)' },
    { team: 'Protein', text: 'Automated cold storage monitoring in warehouses (Parameters) → data reveals energy waste from door-open events (Feedbacks) → warehouses adopt airlock entry systems (Design)' },
    { team: 'TVs', text: 'Require carbon labeling on TV packaging showing shipping emissions (Feedbacks) → consumers start choosing locally assembled models (Design) → manufacturers regionalize assembly to cut labeled emissions (Intent)' },
    { team: 'TVs', text: 'Standardize TV packaging dimensions to maximize container utilization (Parameters) → shipping costs drop 15% per unit (Feedbacks) → smaller retailers can compete on TV distribution (Design)' },
    { team: 'EVs', text: 'Battery thermal management sensors during shipping (Parameters) → data shows temperature damage occurs at port storage (Feedbacks) → port authorities build climate-controlled EV battery staging areas (Design) → battery longevity expectations shift from 8 to 12 years (Intent)' },
    { team: 'EVs', text: 'Standardize EV charging connector types globally (Design) → reduces adapter waste and manufacturing complexity (Parameters) → charging network interoperability increases consumer confidence (Intent)' },
    { team: 'AI', text: 'Publish real-time PUE and WUE metrics for all data centers (Feedbacks) → communities use data to negotiate water usage limits (Design) → data center industry redefines success as "computation per liter" not "computation per dollar" (Intent)' },
    { team: 'AI', text: 'Require renewable energy certificates for AI training runs (Design) → cloud providers build dedicated solar/wind capacity (Parameters) → AI development shifts to regions with abundant renewables (Intent)' },
    { team: 'Streaming', text: 'Edge caching reduces data travel distance by 60% (Parameters) → lower latency makes local CDN nodes viable for smaller providers (Feedbacks) → streaming market becomes less concentrated (Design) → content distribution shifts from centralized to distributed model (Intent)' },
    { team: 'Streaming', text: 'Adaptive bitrate streaming reduces bandwidth per viewer (Parameters) → total network energy consumption drops (Feedbacks) → ISPs rethink infrastructure investment from capacity to efficiency (Design)' },
  ];

  session.chainSubmissions = chainTexts.map((ct, i) => ({
    visitorId: `dummy_chain_${i}`,
    teamName: ct.team,
    text: ct.text,
    timestamp: new Date().toISOString(),
  }));

  // Generate dummy chain rankings — biased so certain steps tend to rank higher
  // preferredOrder: step indices in likely rank order (most students will roughly follow this)
  session.chainRankings = {};
  const preferredOrders = {
    kennedy:    [0, 1, 2, 3],  // Intent (Kennedy's declaration) tends to rank #1
    strawberry: [0, 1, 2, 3],  // Parameters (thermometers) tends to rank #1
    ozone:      [1, 0, 2],     // Design (Montreal Protocol) tends to rank #1
    smoking:    [1, 2, 0],     // Design (bans) tends to rank #1
  };
  for (let i = 0; i < 44; i++) {
    session.chainRankings[`dummy_${i}`] = {};
    for (const chain of CHAINS) {
      const preferred = preferredOrders[chain.id] || chain.steps.map((_, idx) => idx);
      // Start with preferred order, then randomly swap 0-2 pairs to create variance
      const ranking = [...preferred];
      const swaps = Math.floor(Math.random() * 3); // 0, 1, or 2 swaps
      for (let s = 0; s < swaps; s++) {
        const a = Math.floor(Math.random() * ranking.length);
        const b = Math.floor(Math.random() * ranking.length);
        [ranking[a], ranking[b]] = [ranking[b], ranking[a]];
      }
      session.chainRankings[`dummy_${i}`][chain.id] = ranking;
    }
  }

  res.json({ ok: true, voters: 44, submissions: session.chainSubmissions.length });
});

// ─── Error handling ─────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[Express error]', err.message);
  res.status(500).json({ error: 'Server error' });
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught exception]', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('[Unhandled rejection]', err);
});

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Leverage Explorer running on http://localhost:${PORT}`);
  console.log(`  Student:  http://localhost:${PORT}/`);
  console.log(`  Admin:    http://localhost:${PORT}/admin`);
  console.log(`  Display:  http://localhost:${PORT}/display`);
});
