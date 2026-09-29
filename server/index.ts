import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decide, talk, quest, modelStatus, ensureLaya } from "./brain.js";
import type { QuestSituation, Situation, TalkSituation } from "./prompts.js";

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: modelStatus(), env: { node: process.version } });
});

app.post("/api/decide", async (req, res) => {
  const situations = (req.body as { situations?: Situation[] }).situations;
  if (!Array.isArray(situations) || situations.length === 0) {
    res.status(400).json({ error: "body.situations must be a non-empty array" });
    return;
  }
  if (situations.length > 12) {
    res.status(422).json({ error: "too many situations (max 12)" });
    return;
  }
  try {
    const results = [];
    for (const situation of situations) {
      results.push(await decide(situation));
    }
    res.json({ results });
  } catch (err) {
    res.status(503).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/api/talk", async (req, res) => {
  const situation = (req.body as { situation?: TalkSituation }).situation;
  if (!situation) {
    res.status(400).json({ error: "body.situation is required" });
    return;
  }
  try {
    res.json({ result: await talk(situation) });
  } catch (err) {
    res.status(503).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/api/quest", async (req, res) => {
  const situation = (req.body as { situation?: QuestSituation }).situation;
  if (!situation) {
    res.status(400).json({ error: "body.situation is required" });
    return;
  }
  try {
    res.json({ result: await quest(situation) });
  } catch (err) {
    res.status(503).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

const port = Number(process.env.PORT ?? 4780);
app.listen(port, () => {
  console.log(`\n  laya-town running at http://localhost:${port}\n`);
  if (process.env.LAYA_MODEL_DIR) {
    console.log("  using local model dir:", process.env.LAYA_MODEL_DIR);
  }
  if (process.env.LAYA_NO_PRELOAD !== "1") {
    ensureLaya()
      .then(() => console.log("  [laya] model ready (preloaded)"))
      .catch((err: unknown) => {
        console.warn(`  [laya] preload failed: ${err}`);
        console.warn("  decisions will retry via /api/decide; the game falls back to scripted NPC behavior until the model is ready.");
      });
  }
});