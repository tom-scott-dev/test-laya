"use strict";

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

const W = 960;
const H = 640;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const $ = (id) => document.getElementById(id);
const clockEl = $("clock");
const modelEl = $("modelPill");
const brainEl = $("brainPill");
const latencyEl = $("latencyPill");
const inspectList = $("inspectList");

const SPOTS = [
  { id: "the pond", x: 780, y: 150, r: 70, kind: "pond" },
  { id: "the market", x: 210, y: 185, kind: "market" },
  { id: "the garden", x: 230, y: 465, kind: "garden" },
  { id: "the bench", x: 525, y: 520, kind: "bench" },
  { id: "the big tree", x: 60, y: 300, kind: "tree" },
];
const spotById = Object.fromEntries(SPOTS.map((s) => [s.id, s]));

const EVENTS = [
  "A merchant caravan is camped by the east gate.",
  "Strange fog rolled in over the western fields.",
  "The pond koi are jumping more than usual today.",
  "Someone reported a wolf near the outer fence.",
  "The church bells rang early for the harvest feast.",
  "A child's kite got stuck in the big tree.",
  "The market stalls are selling pumpkin pie today.",
  "Rumor has it a treasure map is being traded near the plaza.",
];

const NPCS = [
  {
    id: "mira",
    name: "Mira",
    role: "Baker",
    persona: "a cheerful middle-aged baker who has run the corner bread stand for twenty years",
    color: "#c0392b",
    favorite: "the market",
    x: 300, y: 220,
  },
  {
    id: "bram",
    name: "Bram",
    role: "Fisherman",
    persona: "an old reclusive fisherman who spends most days by the koi pond",
    color: "#2c6e8f",
    favorite: "the pond",
    x: 700, y: 260,
  },
  {
    id: "lena",
    name: "Lena",
    role: "Shepherd",
    persona: "a shy young shepherd who misses her flock and watches the town from the edges",
    color: "#7d8c3f",
    favorite: "the garden",
    x: 200, y: 420,
  },
  {
    id: "kofi",
    name: "Kofi",
    role: "Merchant",
    persona: "a fast-talking traveling merchant always gauging who to trade with",
    color: "#8e44ad",
    favorite: "the market",
    x: 120, y: 160,
  },
  {
    id: "wells",
    name: "Wells",
    role: "Guard",
    persona: "the town guard on rounds, cautious, observant, and quietly kind",
    color: "#575d66",
    favorite: "the bench",
    x: 500, y: 480,
  },
];

const LINES = {
  greeting: ["Hello there, traveler!", "Good day to you!", "Well met!", "Ah, a new face in town."],
  tip: ["Try the bakery before noon, they sell out.", "The pond path is muddy after rain.", "The market folk haggle best after the bells.", "If you see a wolf, head for the lamppost."],
  gossip: ["They say the old mill is haunted again.", "There is strange fog in the west fields.", "Someone has been walking the fence line at night.", "The koi have been restless all week."],
  warning: ["Careful along the west fence at dusk.", "The manor dogs do not like strangers.", "Avoid the pond side, the ice is thin.", "The road is slick with leaves out east."],
  silence: ["*nods and keeps to themselves*"],
};

const TALK_LINES = {
  greeting: ["Well met, traveler.", "Good day to you!", "Hello there."],
  weather: ["Glorious morning, is it not?", "This fog will burn off by noon.", "Bitter evening for this time of year.", "A fine day for idle folk."],
  town_tip: ["If you need supplies, the market has it all.", "The inn beds are clean and cheap.", "Ask for Bram by the pond, he knows the fish."],
  confession: ["I have not slept well lately, if I am honest.", "Sometimes I miss people I have not seen in years.", "I worry about the wolves more than I let on."],
  warning: ["Keep an eye on your sack at the market.", "The west road has been unsafe after dark."],
  farewell_hint: ["I should be getting back to my work.", "Duty calls, I am afraid.", "We will talk more another time."],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const player = {
  x: 480, y: 320, dir: 0, speed: 110,
  lastTalkAt: -1e9,
};

const npcs = NPCS.map((n) => ({
  ...n,
  tx: n.x, ty: n.y,
  mood: 1,
  activity: "arriving in town",
  bubble: "silence",
  wantsToTalk: 0,
  actionProbs: {},
  actionConfidence: 0,
  latencyMs: null,
  inputTokens: null,
  model: null,
  nextDecisionAt: 0,
  thinking: false,
  thought: "",
  thoughtUntil: 0,
  speech: "",
  speechUntil: 0,
  speechReaction: "friendly",
  lastDecision: null,
}));

npcs.forEach((n, i) => {
  n.nextDecisionAt = performance.now() + 600 + i * 500;
});

let worldNotes = "";
let eventAt = performance.now() + 4000;
let cycleStart = performance.now();
const CYCLE_MS = 240000;

let brainOnline = false;
let forcedScripted = false;
let modelStatus = { state: "idle" };
let latencySamples = [];

const keys = {};
window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === "e" || e.key === "E") tryTalk();
  if (e.key === "f" || e.key === "F") {
    forcedScripted = !forcedScripted;
    brainEl.textContent = `brain: ${forcedScripted ? "scripted (F)" : brainOnline ? "laya" : "waiting"}`;
  }
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

function timeOfDay() {
  const t = ((performance.now() - cycleStart) % CYCLE_MS) / CYCLE_MS;
  if (t < 0.25) return { label: "morning", clock: 7 + Math.floor(t / 0.25 * 5) };
  if (t < 0.5) return { label: "noon", clock: 12 + Math.floor((t - 0.25) / 0.25 * 4) };
  if (t < 0.75) return { label: "dusk", clock: 16 + Math.floor((t - 0.5) / 0.25 * 5) };
  return { label: "night", clock: 21 + Math.floor((t - 0.75) / 0.25 * 6) };
}

function nearbyCompanions(npc) {
  return npcs
    .filter((o) => o.id !== npc.id)
    .filter((o) => Math.hypot(o.x - npc.x, o.y - npc.y) < 120)
    .map((o) => o.name)
    .join(", ");
}

function makeSituation(npc) {
  const tod = timeOfDay();
  const near = Math.hypot(npc.x - player.x, npc.y - player.y) < 150;
  const talked = performance.now() - player.lastTalkAt < 25000;
  return {
    name: npc.name,
    persona: npc.persona,
    timeOfDay: tod.label,
    location: npc.locationHint || npc.favorite,
    activity: npc.activity,
    playerNear: near,
    previouslyTalked: talked,
    companionsNearby: nearbyCompanions(npc),
    worldNotes,
  };
}

function applyDecision(npc, d) {
  npc.lastDecision = d;
  npc.actionProbs = d.actionProbs;
  npc.actionConfidence = d.actionConfidence;
  npc.latencyMs = d.latencyMs;
  npc.inputTokens = d.inputTokens;
  npc.model = d.model;
  npc.mood = d.mood;
  npc.wantsToTalk = d.wantsToTalk;
  npc.bubble = d.bubble;
  npc.thinking = false;

  const near = Math.hypot(npc.x - player.x, npc.y - player.y) < 150;
  switch (d.nextAction) {
    case "honor_time_of_day": {
      const tod = timeOfDay().label;
      const target = tod === "morning" || tod === "noon"
        ? spotById[npc.favorite]
        : spotById[tod === "dusk" ? (npc.favorite === "the bench" ? "the garden" : "the bench") : "the bench"];
      setTarget(npc, target.x + (Math.random() - 0.5) * 40, target.y + (Math.random() - 0.5) * 40);
      npc.activity = `going about the ${tod}`;
      break;
    }
    case "wander_explore": {
      const spot = pick(SPOTS);
      setTarget(npc, spot.x + (Math.random() - 0.5) * 120, spot.y + (Math.random() - 0.5) * 120);
      npc.activity = "wandering";
      break;
    }
    case "approach_player": {
      const a = Math.atan2(player.y - npc.y, player.x - npc.x);
      setTarget(npc, player.x - Math.cos(a) * 70, player.y - Math.sin(a) * 70);
      npc.activity = "heading toward the traveler";
      break;
    }
    case "watch_player_from_afar": {
      const a = Math.random() * Math.PI * 2;
      const r = 150 + Math.random() * 80;
      setTarget(npc, player.x + Math.cos(a) * r, player.y + Math.sin(a) * r);
      npc.activity = "watching from a distance";
      break;
    }
    case "rest_or_depart": {
      const bench = spotById["the bench"];
      const far = Math.random() < 0.5;
      if (far) {
        setTarget(npc, 60 + Math.random() * (W - 120), 60 + Math.random() * (H - 120));
        npc.activity = "stepping away";
      } else {
        setTarget(npc, bench.x + (Math.random() - 0.5) * 60, bench.y + 20);
        npc.activity = "resting";
      }
      break;
    }
    default:
      npc.tx = npc.x; npc.ty = npc.y;
      npc.activity = "pausing";
  }

  if (d.wantsToTalk > 0.35 && d.bubble !== "silence" && near) {
    npc.thought = pick(LINES[d.bubble] || LINES.greeting);
    npc.thoughtUntil = performance.now() + 2400;
  } else if (d.bubble !== "silence") {
    npc.thought = `(${d.bubble.replace(/_/g, " ")})`;
    npc.thoughtUntil = performance.now() + 1400;
  } else {
    npc.thought = "";
    npc.thoughtUntil = 0;
  }
  npc.locationHint = nearestSpot(npc).id;
  npc.nextDecisionAt = performance.now() + 2400 + Math.random() * 1800;
}

function nearestSpot(npc) {
  let best = SPOTS[0];
  let bestD = Infinity;
  for (const s of SPOTS) {
    const d = Math.hypot(s.x - npc.x, s.y - npc.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function setTarget(npc, x, y) {
  const pond = spotById["the pond"];
  const dx = x - pond.x, dy = y - pond.y;
  const d = Math.hypot(dx, dy);
  if (d < pond.r + 26) {
    const ux = dx / d, uy = dy / d;
    x = pond.x + ux * (pond.r + 26);
    y = pond.y + uy * (pond.r + 26);
  }
  npc.tx = Math.max(18, Math.min(W - 18, x));
  npc.ty = Math.max(18, Math.min(H - 18, y));
}

function scriptedDecision(npc) {
  const roll = Math.random();
  const nextAction = roll < 0.32 ? "honor_time_of_day"
    : roll < 0.62 ? "wander_explore"
    : roll < 0.8 ? "watch_player_from_afar"
    : roll < 0.92 ? "approach_player"
    : "rest_or_depart";
  const bubble = pick(["greeting", "tip", "gossip", "warning", "silence"]);
  const probs = { honor_time_of_day: 0.2, wander_explore: 0.2, approach_player: 0.2, watch_player_from_afar: 0.2, rest_or_depart: 0.2 };
  probs[nextAction] = 0.6;
  return {
    nextAction,
    actionProbs: probs,
    actionConfidence: 0.5 + Math.random() * 0.4,
    bubble,
    mood: Math.floor(Math.random() * 4),
    wantsToTalk: Math.random(),
    latencyMs: null,
    inputTokens: null,
    model: "scripted-demo",
  };
}

async function requestDecision(npc) {
  if (npc.thinking) return;
  npc.thinking = true;
  let d;
  if (brainOnline && !forcedScripted) {
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ situations: [makeSituation(npc)] }),
      });
      if (!res.ok) throw new Error("decide failed");
      const body = await res.json();
      d = body.results[0];
      latencySamples.push(d.latencyMs);
      if (latencySamples.length > 30) latencySamples.shift();
      const avg = Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length);
      latencyEl.textContent = `latency: ${avg}ms`;
    } catch (err) {
      d = scriptedDecision(npc);
      brainEl.textContent = "brain: scripted (model error)";
    }
  } else {
    d = scriptedDecision(npc);
  }
  applyDecision(npc, d);
}

async function tryTalk() {
  const target = npcs
    .filter((n) => Math.hypot(n.x - player.x, n.y - player.y) < 100)
    .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
  if (!target) return;
  player.lastTalkAt = performance.now();
  target.nextDecisionAt = performance.now() + 400;
  const tod = timeOfDay();
  let result = null;
  if (brainOnline && !forcedScripted) {
    try {
      const res = await fetch("/api/talk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          situation: {
            name: target.name,
            persona: target.persona,
            timeOfDay: tod.label,
            location: target.locationHint || target.favorite,
            activity: target.activity,
            worldNotes,
          },
        }),
      });
      if (res.ok) result = (await res.json()).result;
    } catch (err) { /* fall through to scripted */ }
  }
  if (!result) {
    result = {
      reaction: pick(["friendly", "guarded", "curious", "curt"]),
      dialogue: pick(["greeting", "weather", "town_tip", "confession", "warning", "farewell_hint"]),
      talkMood: Math.floor(Math.random() * 4),
      wantsMore: Math.random(),
      latencyMs: null,
    };
  }
  target.speech = pick(TALK_LINES[result.dialogue] || TALK_LINES.greeting);
  target.speechUntil = performance.now() + 4200;
  target.speechReaction = result.reaction;
  target.mood = result.talkMood;
  target.thought = "";
  target.thoughtUntil = 0;
  target.activity = `talking to the traveler (${result.reaction})`;
  target.facing = Math.atan2(player.y - target.y, player.x - target.x);
}

function pollHealth() {
  fetch("/api/health")
    .then((r) => r.json())
    .then((body) => {
      modelStatus = body.status;
      const s = body.status;
      if (s.state === "ready") {
        brainOnline = true;
        modelEl.textContent = "model: local laya";
        modelEl.classList.remove("dim");
      } else if (s.state === "loading" || s.state === "downloading") {
        const pct = s.total ? ` ${Math.round((s.received / s.total) * 100)}%` : "";
        modelEl.textContent = `model: downloading ${s.file}${pct}`;
      } else if (s.state === "idle") {
        modelEl.textContent = "model: warming up";
      } else if (s.state === "error") {
        modelEl.textContent = "model: error - demo mode";
        modelEl.classList.add("err");
      }
      if (!forcedScripted) {
        brainEl.textContent = `brain: ${brainOnline ? "laya" : "waiting for model"}`;
      }
    })
    .catch(() => {});
}

setInterval(pollHealth, 3000);
pollHealth();

function step(dt) {
  const now = performance.now();

  const tod = timeOfDay();
  clockEl.textContent = `${tod.label} · ${String(tod.clock).padStart(2, "0")}:00`;

  if (now > eventAt) {
    worldNotes = pick(EVENTS);
    eventAt = now + 20000 + Math.random() * 15000;
  }

  const dirX = (keys["d"] || keys["arrowright"] ? 1 : 0) - (keys["a"] || keys["arrowleft"] ? 1 : 0);
  const dirY = (keys["s"] || keys["arrowdown"] ? 1 : 0) - (keys["w"] || keys["arrowup"] ? 1 : 0);
  if (dirX !== 0 || dirY !== 0) {
    const len = Math.hypot(dirX, dirY);
    player.x += (dirX / len) * player.speed * dt;
    player.y += (dirY / len) * player.speed * dt;
    player.dir = Math.atan2(dirY, dirX);
  }
  player.x = Math.max(20, Math.min(W - 20, player.x));
  player.y = Math.max(20, Math.min(H - 20, player.y));
  keepOutOfPond(player);

  for (const npc of npcs) {
    if (npc.thinking) continue;
    if (now >= npc.nextDecisionAt) {
      requestDecision(npc);
      continue;
    }
    const dx = npc.tx - npc.x, dy = npc.ty - npc.y;
    const d = Math.hypot(dx, dy);
    if (d > 6) {
      const spd = 62 + npc.mood * 6;
      npc.x += (dx / d) * spd * dt;
      npc.y += (dy / d) * spd * dt;
      npc.facing = Math.atan2(dy, dx);
      if (d < 40 && npc.activity === "heading toward the traveler") {
        npc.activity = "greeting the traveler";
      }
    } else if (d <= 6 && npc.tx !== npc.x && npc.ty !== npc.y) {
      npc.x = npc.tx; npc.y = npc.ty;
      if (npc.activity === "resting") npc.activity = "resting on the bench";
      if (npc.activity === "watching from a distance") npc.activity = "watching the traveler";
    }
    keepOutOfPond(npc);
  }

  separate();
}

function keepOutOfPond(e) {
  const pond = spotById["the pond"];
  const dx = e.x - pond.x, dy = e.y - pond.y;
  const d = Math.hypot(dx, dy);
  if (d < pond.r + 16) {
    const ux = dx / d || 1, uy = dy / d || 0;
    e.x = pond.x + ux * (pond.r + 16);
    e.y = pond.y + uy * (pond.r + 16);
  }
}

function separate() {
  const all = [player, ...npcs];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 34 && d > 0.0001) {
        const push = (34 - d) / 2;
        const ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
      }
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "#7da45c";
  ctx.fillRect(0, 0, W, H);

  drawPath();
  drawPond();
  drawMarket();
  drawGarden();
  drawBench();
  drawTrees();
  drawFence();

  const ordered = [...npcs].sort((a, b) => a.y - b.y);
  for (const npc of ordered) drawPerson(npc, true);
  drawPerson(player, false);

  drawBubbles(ordered);
  drawEventTicker();
}

function drawPath() {
  ctx.strokeStyle = "#b9a06a";
  ctx.lineWidth = 26;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 330);
  ctx.lineTo(300, 300);
  ctx.lineTo(480, 420);
  ctx.lineTo(720, 380);
  ctx.lineTo(W, 420);
  ctx.stroke();
  ctx.lineWidth = 18;
  ctx.strokeStyle = "#c9b078";
  ctx.stroke();
}

function drawPond() {
  const p = spotById["the pond"];
  ctx.fillStyle = "#4a7fb5";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, p.r, p.r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#6a9fd0";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#7fb7e0";
  for (let i = 0; i < 3; i++) {
    const a = performance.now() / 900 + i * 2.1;
    const rx = p.x + Math.cos(a) * p.r * 0.4;
    const ry = p.y + Math.sin(a) * p.r * 0.3;
    ctx.beginPath();
    ctx.ellipse(rx, ry, 10, 4, a, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMarket() {
  const m = spotById["the market"];
  ctx.fillStyle = "#8a5a33";
  ctx.fillRect(m.x - 60, m.y - 45, 120, 90);
  ctx.fillStyle = "#6e4426";
  ctx.fillRect(m.x - 60, m.y - 25, 120, 14);
  ctx.fillStyle = "#b5651d";
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(m.x - 52 + i * 24, m.y - 45, 20, 90);
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? "#e8d9c0" : "#d43d2a";
    ctx.fillRect(m.x - 60 + i * 20, m.y - 70, 20, 26);
  }
  ctx.fillStyle = "#3c2a18";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.fillText("MARKET", m.x, m.y - 78);
}

function drawGarden() {
  const g = spotById["the garden"];
  ctx.fillStyle = "#5f7a3a";
  ctx.fillRect(g.x - 80, g.y - 35, 160, 70);
  const colors = ["#e05a5a", "#e8c44a", "#c97fd0", "#f0f0f0"];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 6; col++) {
      const fx = g.x - 68 + col * 26;
      const fy = g.y - 20 + row * 40;
      ctx.fillStyle = "#3f5a26";
      ctx.fillRect(fx - 2, fy, 4, 12);
      ctx.fillStyle = colors[(col + row) % colors.length];
      ctx.beginPath();
      ctx.arc(fx, fy - 4, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBench() {
  const b = spotById["the bench"];
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(b.x - 45, b.y - 8, 90, 16);
  ctx.fillRect(b.x - 40, b.y - 8, 8, -22);
  ctx.fillRect(b.x + 32, b.y - 8, 8, -22);
  ctx.fillStyle = "#8f6a3e";
  ctx.fillRect(b.x - 45, b.y - 26, 90, 8);
}

function drawTrees() {
  const trees = [{ x: 60, y: 300 }, { x: 900, y: 520 }];
  for (const t of trees) {
    ctx.fillStyle = "#5a3a22";
    ctx.fillRect(t.x - 6, t.y - 4, 12, 26);
    ctx.fillStyle = "#3f6b2e";
    ctx.beginPath();
    ctx.arc(t.x, t.y - 26, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4c7d38";
    ctx.beginPath();
    ctx.arc(t.x - 10, t.y - 34, 18, 0, Math.PI * 2);
    ctx.arc(t.x + 12, t.y - 32, 16, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFence() {
  ctx.strokeStyle = "#8a6a3c";
  ctx.lineWidth = 4;
  const posts = [];
  for (let x = 20; x < W; x += 60) posts.push([x, 22]);
  for (let x = 20; x < W; x += 60) posts.push([x, H - 22]);
  for (let y = 20; y < H; y += 60) posts.push([22, y]);
  for (let y = 20; y < H; y += 60) posts.push([W - 22, y]);
  for (const [px, py] of posts) {
    ctx.fillStyle = "#8a6a3c";
    ctx.fillRect(px - 3, py - 3, 6, 6);
  }
}

function drawPerson(e, isNpc) {
  const body = isNpc ? e.color : "#3d6bb5";
  const x = e.x, y = e.y;
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 16, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 2, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e8c39a";
  ctx.beginPath();
  ctx.arc(0, -10, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = isNpc ? "#5a4632" : "#2c2c2c";
  ctx.beginPath();
  ctx.arc(0, -17, 9, Math.PI, Math.PI * 2);
  ctx.fill();

  const faceDir = e.facing ?? player.dir;
  const look = isNpc ? Math.cos(faceDir) * 3 : Math.cos(player.dir) * 3;
  ctx.fillStyle = "#241a12";
  ctx.beginPath();
  ctx.arc(-3 + look, -10, 1.6, 0, Math.PI * 2);
  ctx.arc(3 + look, -10, 1.6, 0, Math.PI * 2);
  ctx.fill();

  const mood = isNpc ? e.mood : 1;
  ctx.strokeStyle = "#241a12";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (mood <= 0) {
    ctx.arc(0, -4, 3, Math.PI * 1.15, Math.PI * 1.85);
  } else if (mood === 1) {
    ctx.moveTo(-3, -4); ctx.lineTo(3, -4);
  } else if (mood === 2) {
    ctx.arc(0, -3.5, 3, 0.15 * Math.PI, 0.85 * Math.PI);
  } else {
    ctx.arc(0, -4, 3, 0.1 * Math.PI, 0.9 * Math.PI);
  }
  ctx.stroke();

  ctx.restore();

  if (isNpc) {
    ctx.fillStyle = "#24301f";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(e.name, x, y - 30);
  }
}

function drawBubbles(ordered) {
  const now = performance.now();
  for (const npc of ordered) {
    if (now < npc.speechUntil && npc.speech) {
      drawBubble(npc.x, npc.y - 52, npc.speech, npc.speechReaction === "curt" ? "#c98a6a" : "#f4ecd8", 200);
    } else if (now < npc.thoughtUntil && npc.thought) {
      drawBubble(npc.x, npc.y - 52, npc.thought, "#dce8d8", 150);
    }
  }
}

function drawBubble(x, y, text, color, maxW) {
  ctx.font = "12px monospace";
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16);
  const h = lines.length * 15 + 10;
  const bx = Math.max(20, Math.min(W - w - 20, x - w / 2));
  const by = y - h - 8;

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 6);
  ctx.lineTo(x + 5, y - 6);
  ctx.lineTo(x, y + 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#241a12";
  ctx.textAlign = "center";
  lines.forEach((l, i) => ctx.fillText(l, bx + w / 2, by + 16 + i * 15));
}

function drawEventTicker() {
  if (!worldNotes) return;
  ctx.fillStyle = "rgba(20,26,18,0.72)";
  ctx.fillRect(0, 0, W, 26);
  ctx.fillStyle = "#e8e0c8";
  ctx.font = "12px monospace";
  ctx.textAlign = "center";
  ctx.fillText(worldNotes, W / 2, 17);
}

function renderInspector() {
  const now = performance.now();
  for (const npc of npcs) {
    const card = npc._card;
    if (!card) continue;
    card.act.textContent = npc.activity;
    const d = npc.lastDecision;
    if (d) {
      const ranked = Object.entries(d.actionProbs).sort((a, b) => b[1] - a[1]);
      const top = ranked[0];
      const topPct = Math.round((top?.[1] ?? 0) * 100);
      card.decision.textContent = `${top?.[0].replace(/_/g, " ") ?? d.nextAction}  ·  ${topPct}%`;
      card.bar.style.width = `${topPct}%`;
      card.probs.textContent = ranked.slice(0, 3).map(([k, v]) => `${k.replace(/_/g, " ")} ${(v * 100).toFixed(0)}%`).join(" · ");
      card.stats.textContent = [
        `mood ${npc.mood}/3`,
        `talk P=${npc.wantsToTalk.toFixed(2)}`,
        d.latencyMs != null ? `${d.latencyMs}ms` : "-",
        d.inputTokens != null ? `${d.inputTokens} tok` : "",
        d.model ? d.model : "",
      ].filter(Boolean).join(" · ");
    }
    if (now < npc.thoughtUntil && npc.thought) {
      card.thought.textContent = npc.thought;
    } else if (now < npc.speechUntil && npc.speech) {
      card.thought.textContent = `"${npc.speech}"`;
    } else {
      card.thought.textContent = "";
    }
  }
}

function buildInspector() {
  for (const npc of npcs) {
    const card = document.createElement("div");
    card.className = "npc-card";
    card.style.borderLeftColor = npc.color;
    card.innerHTML = `
      <div class="top">
        <span class="name">${npc.name} <span style="color:var(--muted)">· ${npc.role}</span></span>
        <span class="act"></span>
      </div>
      <div class="decision"></div>
      <div class="bar"><i></i></div>
      <div class="probs"></div>
      <div class="stats"></div>
      <div class="thought"></div>`;
    inspectList.appendChild(card);
    npc._card = {
      act: card.querySelector(".act"),
      decision: card.querySelector(".decision"),
      bar: card.querySelector(".bar i"),
      probs: card.querySelector(".probs"),
      stats: card.querySelector(".stats"),
      thought: card.querySelector(".thought"),
    };
  }
}

buildInspector();

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  draw();
  renderInspector();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);