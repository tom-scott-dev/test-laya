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
const goldEl = $("goldEl");
const invEl = $("invEl");
const modelEl = $("modelPill");
const brainEl = $("brainPill");
const latencyEl = $("latencyPill");
const inspectList = $("inspectList");
const questEl = $("questTracker");
const toastsEl = $("toasts");
const marketPanel = $("marketPanel");
const marketList = $("marketList");
const marketGold = $("marketGold");

const SPOTS = [
  { id: "the pond", x: 780, y: 150, r: 70, kind: "pond" },
  { id: "the market", x: 210, y: 185, kind: "market" },
  { id: "the garden", x: 230, y: 465, kind: "garden" },
  { id: "the bench", x: 525, y: 520, kind: "bench" },
  { id: "the big tree", x: 60, y: 300, kind: "tree" },
];
const spotById = Object.fromEntries(SPOTS.map((s) => [s.id, s]));

const LAMPS = [
  { x: 210, y: 130, r: 95 },
  { x: 525, y: 470, r: 95 },
];

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

const ITEMS = [
  { id: "herb", label: "herbs", short: "herb", spot: "the garden", color: "#6fae3c", price: 5 },
  { id: "bread", label: "bread", short: "bread", spot: "the market", color: "#c98a4b", price: 8 },
  { id: "fish", label: "fish", short: "fish", spot: "the pond", color: "#5b8fd4", price: 10 },
  { id: "berry", label: "berries", short: "berry", spot: "the big tree", color: "#d45b5b", price: 4 },
];
const itemById = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

const NPCS = [
  {
    id: "mira", name: "Mira", role: "Baker",
    persona: "a cheerful middle-aged baker who has run the corner bread stand for twenty years",
    color: "#c0392b", favorite: "the market", x: 300, y: 220,
  },
  {
    id: "bram", name: "Bram", role: "Fisherman",
    persona: "an old reclusive fisherman who spends most days by the koi pond",
    color: "#2c6e8f", favorite: "the pond", x: 700, y: 260,
  },
  {
    id: "lena", name: "Lena", role: "Shepherd",
    persona: "a shy young shepherd who misses her flock and watches the town from the edges",
    color: "#7d8c3f", favorite: "the garden", x: 200, y: 420,
  },
  {
    id: "kofi", name: "Kofi", role: "Merchant",
    persona: "a fast-talking traveling merchant always gauging who to trade with",
    color: "#8e44ad", favorite: "the market", x: 120, y: 160,
  },
  {
    id: "wells", name: "Wells", role: "Guard",
    persona: "the town guard on rounds, cautious, observant, and quietly kind",
    color: "#575d66", favorite: "the bench", x: 500, y: 480,
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
  favor: 25 + Math.floor(Math.random() * 20),
  questCooldown: 0,
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

const game = {
  gold: 0,
  inventory: { herb: 0, bread: 0, fish: 0, berry: 0 },
  quest: null,
  marketOpen: false,
  wolf: null,
  wolfNextAt: performance.now() + 20000,
  flashUntil: 0,
};

let pickups = [];
spawnPickups();

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
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
  keys[e.key.toLowerCase()] = true;
  if (e.key === "e" || e.key === "E") tryTalk();
  if (e.key === "b" || e.key === "B") toggleMarket();
  if (e.key === "Escape") closeMarket();
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 4 && game.marketOpen) buyItem(ITEMS[n - 1].id);
  if (e.key === "f" || e.key === "F") {
    forcedScripted = !forcedScripted;
    brainEl.textContent = `brain: ${forcedScripted ? "scripted (F)" : brainOnline ? "laya" : "waiting"}`;
  }
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

function timeOfDay() {
  const t = ((performance.now() - cycleStart) % CYCLE_MS) / CYCLE_MS;
  if (t < 0.25) return { label: "morning", clock: 7 + Math.floor((t / 0.25) * 5) };
  if (t < 0.5) return { label: "noon", clock: 12 + Math.floor(((t - 0.25) / 0.25) * 4) };
  if (t < 0.75) return { label: "dusk", clock: 16 + Math.floor(((t - 0.5) / 0.25) * 5) };
  return { label: "night", clock: 21 + Math.floor(((t - 0.75) / 0.25) * 6) };
}

function relationship(npc) {
  if (npc.favor < 30) return "a stranger";
  if (npc.favor < 60) return "an acquaintance";
  if (npc.favor < 85) return "a friend";
  return "a close friend";
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
  const questLine = game.quest && game.quest.giverId === npc.id
    ? " The traveler is currently helping you with an errand."
    : "";
  return {
    name: npc.name,
    persona: npc.persona,
    timeOfDay: tod.label,
    location: npc.locationHint || npc.favorite,
    activity: npc.activity,
    playerNear: near,
    previouslyTalked: talked,
    companionsNearby: nearbyCompanions(npc),
    worldNotes: `${worldNotes} The traveler is ${relationship(npc)} to you.${questLine}`,
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
      if (Math.random() < 0.5) {
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

async function greet(npc) {
  const tod = timeOfDay();
  let result = null;
  if (brainOnline && !forcedScripted) {
    try {
      const res = await fetch("/api/talk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          situation: {
            name: npc.name,
            persona: npc.persona,
            timeOfDay: tod.label,
            location: npc.locationHint || npc.favorite,
            activity: npc.activity,
            worldNotes: `${worldNotes} The traveler is ${relationship(npc)} to you.`,
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
  npc.speech = pick(TALK_LINES[result.dialogue] || TALK_LINES.greeting);
  npc.speechUntil = performance.now() + 4200;
  npc.speechReaction = result.reaction;
  npc.mood = result.talkMood;
  npc.thought = "";
  npc.thoughtUntil = 0;
  npc.activity = `talking to the traveler (${result.reaction})`;
  npc.facing = Math.atan2(player.y - npc.y, player.x - npc.x);
  return result;
}

async function maybeOfferQuest(npc) {
  if (game.quest || performance.now() < npc.questCooldown) return;
  const tod = timeOfDay();
  let r = null;
  if (brainOnline && !forcedScripted) {
    try {
      const res = await fetch("/api/quest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          situation: {
            name: npc.name,
            persona: npc.persona,
            relationship: relationship(npc),
            timeOfDay: tod.label,
            worldNotes,
          },
        }),
      });
      if (res.ok) r = (await res.json()).result;
    } catch (err) { /* fall through to scripted */ }
  }
  if (!r) {
    r = {
      errand: Math.random() < 0.5 ? "fetch_item" : "deliver_message",
      reward: Math.floor(Math.random() * 4),
      willingness: Math.random(),
    };
  }
  npc.questCooldown = performance.now() + 45000;
  if (r.errand === "rest_and_return" || r.willingness < 0.4) {
    toast(`${npc.name} has nothing to ask right now.`);
    return;
  }
  let q;
  const rewardGold = 8 + Math.round(r.reward) * 6;
  const rewardFavor = 10 + Math.round(r.reward) * 3;
  if (r.errand === "fetch_item") {
    const item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
    const need = 3;
    q = {
      giverId: npc.id, giverName: npc.name, type: "fetch",
      item: item.id, need,
      rewardGold, rewardFavor,
    };
    spawnQuestPickups(item.id, need, item.spot);
    toast(`${npc.name} needs ${need} ${item.label}. Gather them nearby.`);
  } else {
    const others = npcs.filter((o) => o.id !== npc.id);
    const t = pick(others);
    q = {
      giverId: npc.id, giverName: npc.name, type: "message",
      targetId: t.id, targetName: t.name, delivered: false,
      rewardGold, rewardFavor,
    };
    toast(`${npc.name} sends a message to ${t.name}. Deliver it.`);
  }
  game.quest = q;
  questEl.classList.remove("hidden");
  updateQuestTracker();
}

function questDone(q) {
  return q.type === "fetch" ? game.inventory[q.item] >= q.need : q.delivered;
}

function turnIn(npc, q) {
  if (q.type === "fetch") {
    game.inventory[q.item] = Math.max(0, game.inventory[q.item] - q.need);
  }
  game.gold += q.rewardGold;
  npc.favor = Math.min(100, npc.favor + q.rewardFavor);
  toast(`quest complete! +${q.rewardGold} gold, +${q.rewardFavor} favor with ${npc.name}`);
  game.quest = null;
  questEl.classList.add("hidden");
  npc.questCooldown = performance.now() + 60000;
  npc.mood = 3;
  updateHUD();
  if (game.marketOpen) updateMarketPanel();
}

function remindQuest(q) {
  if (q.type === "fetch") {
    const need = Math.max(0, q.need - game.inventory[q.item]);
    toast(`${q.giverName} still needs ${need} ${itemById[q.item].label}.`);
  } else {
    toast(`still delivering ${q.giverName}'s message to ${q.targetName}.`);
  }
}

async function deliverMessage(npc, q) {
  await greet(npc);
  q.delivered = true;
  npc.favor = Math.min(100, npc.favor + 4);
  toast(`message delivered to ${npc.name}. Return to ${q.giverName}.`);
  updateQuestTracker();
}

async function tryTalk() {
  const near = npcs
    .filter((n) => Math.hypot(n.x - player.x, n.y - player.y) < 110)
    .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
  if (!near) return;
  player.lastTalkAt = performance.now();
  const q = game.quest;
  if (q && q.type === "message" && q.targetId === near.id && !q.delivered) {
    await deliverMessage(near, q);
    return;
  }
  if (q && q.giverId === near.id) {
    if (questDone(q)) {
      turnIn(near, q);
    } else {
      remindQuest(q);
    }
    return;
  }
  await greet(near);
  maybeOfferQuest(near);
}

function toggleMarket() {
  const m = spotById["the market"];
  if (Math.hypot(player.x - m.x, player.y - m.y) > 120) {
    toast("too far from the market stall", true);
    return;
  }
  game.marketOpen = !game.marketOpen;
  marketPanel.classList.toggle("hidden", !game.marketOpen);
  if (game.marketOpen) updateMarketPanel();
}

function closeMarket() {
  game.marketOpen = false;
  marketPanel.classList.add("hidden");
}

function updateMarketPanel() {
  marketGold.textContent = game.gold;
  marketList.innerHTML = ITEMS.map(
    (i, idx) => `<li data-id="${i.id}"><span>${idx + 1}. ${i.label} <span style="color:var(--muted)">(${game.inventory[i.id]})</span></span><span class="price">${i.price}g</span></li>`
  ).join("");
  marketList.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => buyItem(li.dataset.id));
  });
}

function buyItem(id) {
  const it = itemById[id];
  if (game.gold < it.price) {
    toast("not enough gold", true);
    return;
  }
  game.gold -= it.price;
  game.inventory[id]++;
  toast(`bought ${it.label}`);
  updateHUD();
  updateMarketPanel();
}

function spawnPickups() {
  pickups = [];
  const defs = {
    herb: { spot: "the garden", count: 6 },
    bread: { spot: "the market", count: 6 },
    fish: { spot: "the pond", count: 4, ring: true },
    berry: { spot: "the big tree", count: 5 },
  };
  for (const [id, d] of Object.entries(defs)) {
    const spot = spotById[d.spot];
    for (let i = 0; i < d.count; i++) {
      let x, y;
      if (d.ring) {
        const a = Math.random() * Math.PI * 2;
        const r = spot.r + 34 + Math.random() * 36;
        x = spot.x + Math.cos(a) * r;
        y = spot.y + Math.sin(a) * r;
      } else {
        x = spot.x + (Math.random() - 0.5) * 110;
        y = spot.y + (Math.random() - 0.5) * 76;
      }
      const pond = spotById["the pond"];
      if (Math.hypot(x - pond.x, y - pond.y) < pond.r + 24) {
        const a = Math.atan2(y - pond.y, x - pond.x);
        x = pond.x + Math.cos(a) * (pond.r + 24);
        y = pond.y + Math.sin(a) * (pond.r + 24);
      }
      pickups.push({
        id, x: Math.max(28, Math.min(W - 28, x)), y: Math.max(28, Math.min(H - 28, y)),
        taken: false, respawnAt: 0, quest: false,
      });
    }
  }
}

function spawnQuestPickups(itemId, count, spotId) {
  const spot = spotById[spotId];
  for (let i = 0; i < count; i++) {
    let x = spot.x + (Math.random() - 0.5) * 180;
    let y = spot.y + (Math.random() - 0.5) * 90;
    const pond = spotById["the pond"];
    if (Math.hypot(x - pond.x, y - pond.y) < pond.r + 24) {
      const a = Math.atan2(y - pond.y, x - pond.x);
      x = pond.x + Math.cos(a) * (pond.r + 24);
      y = pond.y + Math.sin(a) * (pond.r + 24);
    }
    pickups.push({
      id: itemId, x: Math.max(28, Math.min(W - 28, x)), y: Math.max(28, Math.min(H - 28, y)),
      taken: false, respawnAt: 0, quest: true,
    });
  }
}

function updatePickups(now) {
  for (const p of pickups) {
    if (p.taken) {
      if (!p.quest && now > p.respawnAt) p.taken = false;
      continue;
    }
    if (Math.hypot(p.x - player.x, p.y - player.y) < 30) {
      p.taken = true;
      game.inventory[p.id]++;
      const q = game.quest;
      if (p.quest && q && q.type === "fetch" && q.item === p.id) {
        toast(`+1 ${itemById[p.id].label} for quest (${Math.min(game.inventory[p.id], q.need)}/${q.need})`);
        updateQuestTracker();
      } else if (p.quest) {
        toast(`+1 ${itemById[p.id].label}`);
      }
      if (!p.quest) p.respawnAt = now + 30000;
      updateHUD();
    }
  }
}

function updateWolf(dt, now) {
  const tod = timeOfDay().label;
  if (tod !== "night") {
    game.wolf = null;
    return;
  }
  if (!game.wolf) {
    if (now < game.wolfNextAt) return;
    const edge = Math.floor(Math.random() * 4);
    const m = 30;
    const w = {
      x: edge === 0 ? m : edge === 1 ? W - m : Math.random() * W,
      y: edge === 2 ? m : edge === 3 ? H - m : Math.random() * H,
      spawnUntil: now + 30000,
    };
    game.wolf = w;
    toast("a wolf is prowling the night! stay near the lampposts", true);
  }
  const w = game.wolf;
  const dx = player.x - w.x, dy = player.y - w.y;
  const d = Math.hypot(dx, dy);
  let vx = dx / (d || 1), vy = dy / (d || 1);
  for (const lamp of LAMPS) {
    const ld = Math.hypot(lamp.x - w.x, lamp.y - w.y);
    if (ld < lamp.r) {
      vx -= (lamp.x - w.x) / (ld || 1) * 2.2;
      vy -= (lamp.y - w.y) / (ld || 1) * 2.2;
    }
  }
  const vl = Math.hypot(vx, vy) || 1;
  w.x += (vx / vl) * 92 * dt;
  w.y += (vy / vl) * 92 * dt;
  w.angle = Math.atan2(dy, dx);
  if (d < 28) {
    const stolen = Math.max(1, Math.round(game.gold * 0.15));
    game.gold = Math.max(0, game.gold - stolen);
    game.flashUntil = now + 350;
    toast(`the wolf caught you! it stole ${stolen} gold`, true);
    game.wolf = null;
    game.wolfNextAt = now + 20000;
    updateHUD();
  } else if (now > w.spawnUntil) {
    game.wolf = null;
    game.wolfNextAt = now + 15000 + Math.random() * 20000;
  }
}

function updateQuestTracker() {
  const q = game.quest;
  if (!q) { questEl.classList.add("hidden"); return; }
  let body;
  if (q.type === "fetch") {
    body = `Bring ${q.need} ${itemById[q.item].label} to ${q.giverName} — you have ${Math.min(game.inventory[q.item], q.need)} of ${q.need}.`;
  } else {
    body = q.delivered
      ? `Message delivered to ${q.targetName}. Return to ${q.giverName}.`
      : `Deliver a message to ${q.targetName} — press E near them.`;
  }
  questEl.innerHTML = `<div class="qt-title">${q.giverName}'s request</div>
    <div class="qt-body">${body}</div>
    <div class="qt-meta">Reward: ${q.rewardGold} gold · +${q.rewardFavor} favor</div>`;
}

function updateHUD() {
  goldEl.textContent = `gold: ${game.gold}`;
  invEl.textContent = "inventory: " + ITEMS.map((i) => `${i.short} x${game.inventory[i.id]}`).join("  ");
}

function toast(text, warn = false) {
  const el = document.createElement("div");
  el.className = "toast" + (warn ? " warn" : "");
  el.textContent = text;
  toastsEl.appendChild(el);
  setTimeout(() => el.remove(), 3800);
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
    } else if (d <= 6 && (npc.tx !== npc.x || npc.ty !== npc.y)) {
      npc.x = npc.tx; npc.y = npc.ty;
      if (npc.activity === "resting") npc.activity = "resting on the bench";
      if (npc.activity === "watching from a distance") npc.activity = "watching the traveler";
    }
    keepOutOfPond(npc);
  }

  separate();
  updatePickups(now);
  updateWolf(dt, now);

  if (game.marketOpen) {
    const m = spotById["the market"];
    if (Math.hypot(player.x - m.x, player.y - m.y) > 160) closeMarket();
  }
  updateQuestTracker();
  updateHUD();
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
  drawPickupSprites();

  const tod = timeOfDay().label;
  if (tod === "dusk" || tod === "night") {
    ctx.fillStyle = tod === "dusk" ? "rgba(255,150,60,0.10)" : "rgba(16,22,40,0.30)";
    ctx.fillRect(0, 0, W, H);
  }
  if (tod === "night") drawLamps();

  const ordered = [...npcs].sort((a, b) => a.y - b.y);
  for (const npc of ordered) drawPerson(npc, true);
  drawPerson(player, false);
  if (game.wolf) drawWolf(game.wolf);

  drawBubbles(ordered);
  drawQuestArrow();
  drawEventTicker();
  drawHints();

  if (performance.now() < game.flashUntil) {
    ctx.fillStyle = "rgba(220,50,40,0.35)";
    ctx.fillRect(0, 0, W, H);
  }
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

function drawPickupSprites() {
  const now = performance.now();
  for (const p of pickups) {
    if (p.taken) continue;
    drawItemSprite(p.id, p.x, p.y, p.quest, now);
  }
}

function drawItemSprite(id, x, y, quest, now) {
  if (quest) {
    const pulse = 1 + Math.sin(now / 200) * 0.12;
    ctx.strokeStyle = "rgba(255,224,120,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 13 * pulse, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(x, y);
  switch (id) {
    case "herb":
      ctx.fillStyle = "#3f7a2a";
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 6, 0, 5, 3, i * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "bread":
      ctx.fillStyle = "#c98a4b";
      ctx.beginPath();
      ctx.roundRect(-7, -5, 14, 10, 4);
      ctx.fill();
      ctx.fillStyle = "#a96f38";
      ctx.fillRect(-4, -2, 8, 1);
      break;
    case "fish":
      ctx.fillStyle = "#5b8fd4";
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(12, -4);
      ctx.lineTo(12, 4);
      ctx.closePath();
      ctx.fill();
      break;
    case "berry":
      ctx.fillStyle = "#d45b5b";
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 4, Math.sin(a) * 4 - 1, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
  }
  ctx.restore();
}

function drawLamps() {
  for (const lamp of LAMPS) {
    const g = ctx.createRadialGradient(lamp.x, lamp.y, 4, lamp.x, lamp.y, lamp.r);
    g.addColorStop(0, "rgba(255,224,140,0.32)");
    g.addColorStop(1, "rgba(255,224,140,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, lamp.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe08c";
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWolf(w) {
  ctx.save();
  ctx.translate(w.x, w.y);
  ctx.rotate(w.angle);
  ctx.fillStyle = "#5a5f66";
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6d737c";
  ctx.beginPath();
  ctx.arc(12, -3, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(16, -6);
  ctx.lineTo(24, -10);
  ctx.lineTo(18, -1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffd27a";
  ctx.beginPath();
  ctx.arc(13, -4, 1.6, 0, Math.PI * 2);
  ctx.arc(10, -4, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawQuestArrow() {
  const q = game.quest;
  if (!q) return;
  const giver = npcs.find((n) => n.id === q.giverId);
  let tx, ty;
  if (q.type === "fetch") {
    const target = pickups.find((p) => p.quest && !p.taken && p.id === q.item) ||
      (game.inventory[q.item] >= q.need ? giver : null);
    if (target) { tx = target.x; ty = target.y; }
    else if (giver) { tx = giver.x; ty = giver.y; }
    else return;
  } else {
    const target = q.delivered ? giver : npcs.find((n) => n.id === q.targetId);
    if (!target) return;
    tx = target.x; ty = target.y;
  }
  const a = Math.atan2(ty - player.y, tx - player.x);
  const ax = player.x + Math.cos(a) * 34;
  const ay = player.y + Math.sin(a) * 34;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(a);
  ctx.fillStyle = "#ffe08c";
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-6, -7);
  ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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
  const look = Math.cos(faceDir) * 3;
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

function drawHints() {
  ctx.font = "12px monospace";
  ctx.textAlign = "center";
  const m = spotById["the market"];
  if (!game.marketOpen && Math.hypot(player.x - m.x, player.y - m.y) < 120) {
    ctx.fillStyle = "#24301f";
    ctx.fillText("B — shop", m.x, m.y + 60);
  }
  const nearNpc = npcs.some((n) => Math.hypot(n.x - player.x, n.y - player.y) < 110);
  if (nearNpc) {
    ctx.fillStyle = "#24301f";
    ctx.fillText("E — talk", player.x, player.y - 34);
  }
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
        `fav ${npc.favor}`,
        `mood ${Math.round(npc.mood)}/3`,
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
updateHUD();

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