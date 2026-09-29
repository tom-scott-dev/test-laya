# Laya Town

A tiny 2D town where every NPC's behavior is driven by **Laya** — the open-source,
Jev-compatible System 1 decision model (non-autoregressive: given a text state and
typed questions it returns `choice` / `score` / `noul` answers with calibrated
probabilities in a single forward pass). No hand-coded opponent AI: townspeople
decide what to do from a short description of their situation, and you can watch
those decisions (with probabilities and confidence) in the side panel.

## Goals

- **Showcase a local decision model as an NPC brain.** Every NPC "thinks" by
  feeding its persona, the time of day, where it is, whether the player is near,
  your relationship with it, and current town events into Laya. The answers to four
  typed questions (`next_action`, `bubble`, `mood_now`, `wants_to_talk`) become its
  next move — no plan tables, no FSM for opponents.
- **Keep it playable and inspectable.** A full game loop (items, quests, economy,
  reputation, night danger) plus a "River of thought" panel that exposes each NPC's
  probabilities, mood, P(talk), latency and token usage.
- **Run fully local.** Weights (about 1.7GB, fp32, ONNX) are downloaded once into
  `~/.cache/receptron-laya` and inference runs in the Node process on CPU. No GPU,
  no API keys, no external service.

## Running it

```bash
npm install
npm start          # http://localhost:4780
```

On first start the server downloads the Laya ONNX bundle with a resumable,
retrying `curl` downloader (progress is reported on the model pill in the game HUD
and in the server console). Until the model is ready, the town runs in **scripted
demo mode** so you can play immediately; the model takes over automatically once
loaded.

Environment variables:

| Variable            | Effect                                                    |
| ------------------- | --------------------------------------------------------- |
| `PORT`              | Web port (default `4780`)                                 |
| `LAYA_NO_PRELOAD`   | `1` to skip the startup model preload                     |
| `LAYA_MODEL_DIR`    | Use a bundle directory instead of downloading             |
| `LAYA_CACHE`        | Override the model cache directory                        |

## Game mechanics

- **NPC townspeople.** Mira (baker), Bram (fisherman), Lena (shepherd), Kofi
  (merchant) and Wells (guard) wander, follow daily routines, approach or watch the
  traveler, and say what they're thinking — all decided per-tick by Laya.
- **Items & inventory.** Herbs, bread, fish and berries respawn around town and are
  picked up as the player walks near them. The HUD tracks how many of each you hold.
- **Market shop.** Press `B` at the market stall to spend gold on supplies (keys
  `1`–`4` to buy, `Esc` to close).
- **Quests.** Talk to a townsperson (`E`); when they're willing, Laya picks the
  errand type and reward generosity. Two kinds:
  - *Fetch* — gather a few of a given supply and bring them back.
  - *Message* — carry a spoken message to another townsperson and report back.
- **Reputation.** Each NPC tracks favor with you (deliveries, quest completions and
  buying raise it). Favor is part of the state sent to Laya, so friends talk warmer,
  offer quests more readily, and react differently as you interact.
- **Night wolf.** After dusk a wolf sometimes prowls; it steals a cut of your gold
  if it catches you. Stay inside the lamppost glows at the market and the bench —
  the wolf won't enter the light. Day/night is also reflected in a slow ambient tint.
- **River of thought.** The side panel shows each NPC's chosen action, the top-3
  option probabilities, mood, probability of initiating conversation, decision
  latency, token usage and the model used (`laya`, or `scripted-demo` in fallback).

## Controls

| Key            | Action                                        |
| -------------- | --------------------------------------------- |
| `WASD` / arrows | Move                                          |
| `E`            | Greet / talk to the nearest townsperson       |
| `B`            | Open the market shop (near the stall)         |
| `1`–`4`, `Esc` | Buy item / close shop panel                   |
| `F`            | Toggle scripted demo brain vs the Laya model  |

## How the NPC brain works

Each decision builds a plain-text state and sends it to `POST /api/decide`:

```
Mira is a cheerful middle-aged baker who has run the corner bread stand for twenty
years Right now it is morning. You are at the market, arranging fresh loaves; The
wandering traveler is close by. Nearby companions: Kofi. Town happenings: The
market stalls are selling pumpkin pie today.
```

along with four typed `system_one` questions. The server's `runExclusive` queue
serializes inference (one `systemOne` call per NPC per ~1.4s on CPU), and the
browser applies the resulting action — walk to a spot, approach the player, greet,
rest — plus the mood face and speech bubble.

## Architecture

```
server/
  index.ts       Express app: static game + /api/health, /api/decide, /api/talk, /api/quest
  brain.ts       Laya singleton, exclusive-run queue, typed result parsing
  downloader.ts  Resumable curl download of the ONNX bundle + progress status
  prompts.ts     State builder + question schemas (Laya is schema-driven)
public/
  index.html     Page + HUD/panel scaffolding
  game.js        Canvas game: movement, items, shop, quests, wolf, rendering, inspection
  style.css      Dark theme
```

The request/response shape mirrors TypeSafe Jev's `system_one` API, so the server
is a drop-in local stand-in for hosted Jev.

## Useful links

- Laya model + Python SDK: <https://github.com/NandhaKishorM/laya>
- Node/TS ONNX runtime wrapper: <https://github.com/receptron/laya>
- Model weights (Apache 2.0): <https://huggingface.co/convaiinnovations/laya>