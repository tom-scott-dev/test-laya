import { Laya } from "@receptron/laya";
import type { ChoiceAnswer, NoulAnswer, ScoreAnswer, SystemOneResult } from "@receptron/laya";
import { bundleStatus, ensureLocalBundle, type BundleStatus } from "./downloader.js";
import {
  buildState,
  buildTalkState,
  decideQuestions,
  questQuestions,
  talkQuestions,
  type QuestSituation,
  type Situation,
  type TalkSituation,
} from "./prompts.js";

export interface Decision {
  nextAction: string;
  actionProbs: Record<string, number>;
  actionConfidence: number;
  bubble: string;
  mood: number;
  wantsToTalk: number;
  latencyMs: number;
  inputTokens: number;
  model: string;
}

export interface TalkResult {
  reaction: string;
  dialogue: string;
  talkMood: number;
  wantsMore: number;
  reactionProbs: Record<string, number>;
  dialogueProbs: Record<string, number>;
  latencyMs: number;
  inputTokens: number;
  model: string;
}

let instance: Laya | null = null;
let loading: Promise<Laya> | null = null;

export type ModelStatus = BundleStatus & { loaded: boolean };

export function modelStatus(): ModelStatus {
  return { ...bundleStatus(), loaded: instance !== null };
}

export async function ensureLaya(): Promise<Laya> {
  if (instance) return instance;
  if (loading) return loading;
  loading = (async () => {
    const modelDir = process.env.LAYA_MODEL_DIR ?? (await ensureLocalBundle());
    instance = await Laya.load({ modelDir });
    return instance;
  })();
  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}

let queue: Promise<unknown> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export async function decide(situation: Situation): Promise<Decision> {
  const laya = await ensureLaya();
  return runExclusive(async () => {
    const started = performance.now();
    const result = (await laya.systemOne(buildState(situation), decideQuestions)) as SystemOneResult<
      typeof decideQuestions
    >;
    const latencyMs = performance.now() - started;
    const nextAction = result.answers.next_action as ChoiceAnswer;
    const bubble = result.answers.bubble as ChoiceAnswer;
    const mood = result.answers.mood_now as ScoreAnswer;
    const wantsToTalk = result.answers.wants_to_talk as NoulAnswer;
    return {
      nextAction: nextAction.choice,
      actionProbs: nextAction.probabilities,
      actionConfidence: nextAction.confidence,
      bubble: bubble.choice,
      mood: mood.score,
      wantsToTalk: wantsToTalk.noul,
      latencyMs: Math.round(latencyMs),
      inputTokens: result.usage.input_tokens + result.usage.output_tokens,
      model: result.model,
    };
  });
}

export async function talk(situation: TalkSituation): Promise<TalkResult> {
  const laya = await ensureLaya();
  return runExclusive(async () => {
    const started = performance.now();
    const result = (await laya.systemOne(buildTalkState(situation), talkQuestions)) as SystemOneResult<
      typeof talkQuestions
    >;
    const latencyMs = performance.now() - started;
    const reaction = result.answers.reaction as ChoiceAnswer;
    const dialogue = result.answers.dialogue as ChoiceAnswer;
    const talkMood = result.answers.talk_mood as ScoreAnswer;
    const wantsMore = result.answers.wants_more as NoulAnswer;
    return {
      reaction: reaction.choice,
      dialogue: dialogue.choice,
      talkMood: talkMood.score,
      wantsMore: wantsMore.noul,
      reactionProbs: reaction.probabilities,
      dialogueProbs: dialogue.probabilities,
      latencyMs: Math.round(latencyMs),
      inputTokens: result.usage.input_tokens + result.usage.output_tokens,
      model: result.model,
    };
  });
}

export interface QuestResult {
  errand: string;
  reward: number;
  willingness: number;
  errandProbs: Record<string, number>;
  latencyMs: number;
  inputTokens: number;
  model: string;
}

export async function quest(situation: QuestSituation): Promise<QuestResult> {
  const laya = await ensureLaya();
  return runExclusive(async () => {
    const started = performance.now();
    const result = (await laya.systemOne(buildQuestState(situation), questQuestions)) as SystemOneResult<
      typeof questQuestions
    >;
    const latencyMs = performance.now() - started;
    const errand = result.answers.errand as ChoiceAnswer;
    const reward = result.answers.reward as ScoreAnswer;
    const willingness = result.answers.willingness as NoulAnswer;
    return {
      errand: errand.choice,
      reward: reward.score,
      willingness: willingness.noul,
      errandProbs: errand.probabilities,
      latencyMs: Math.round(latencyMs),
      inputTokens: result.usage.input_tokens + result.usage.output_tokens,
      model: result.model,
    };
  });
}