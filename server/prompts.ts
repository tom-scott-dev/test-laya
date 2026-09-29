import type { Question } from "@receptron/laya";

export interface Situation {
  name: string;
  persona: string;
  timeOfDay: string;
  location: string;
  activity: string;
  playerNear: boolean;
  previouslyTalked: boolean;
  companionsNearby: string;
  worldNotes: string;
}

export function buildState(s: Situation): string {
  const traveler =
    s.playerNear
      ? `The wandering traveler is close by${s.previouslyTalked ? ", and you just spoke with them" : ""}`
      : "The wandering traveler is somewhere in town";
  const companions = s.companionsNearby.trim() ? `Nearby companions: ${s.companionsNearby.trim()}.` : "";
  const notes = s.worldNotes.trim() ? `Town happenings: ${s.worldNotes.trim()}.` : "Nothing unusual is happening in town.";
  const activity = s.activity.trim() ? `${s.activity}; ` : "";
  return `${s.name} is ${s.persona} Right now it is ${s.timeOfDay}. You are at the ${s.location}, ${activity}${traveler}. ${companions} ${notes}`;
}

export const decideQuestions: Record<string, Question> = {
  next_action: {
    type: "choice",
    instructions:
      "Choose what this townsperson does right now, given their character, the time of day, and the traveler's presence.",
    criteria: {
      honor_time_of_day: "Follow their usual routine for this time of day",
      wander_explore: "Wander to an interesting or pleasant spot",
      approach_player: "Walk over to the traveler to talk with them",
      watch_player_from_afar: "Keep a comfortable distance and quietly observe the traveler",
      rest_or_depart: "Find somewhere quiet to rest or step away",
    },
  },
  bubble: {
    type: "choice",
    instructions: "If this townsperson interacts with the traveler, what is the tone of what they convey?",
    criteria: {
      greeting: "Friendly greeting",
      tip: "Practical advice about the town",
      gossip: "Local gossip or a curious observation",
      warning: "A caution about something in the area",
      silence: "Prefer to convey nothing",
    },
  },
  mood_now: {
    type: "score",
    instructions: "How does this townsperson feel right now?",
    criteria: ["grouchy", "neutral", "content", "cheerful"],
  },
  wants_to_talk: {
    type: "noul",
    instructions: "Does this townsperson want to initiate conversation with the traveler right now?",
  },
};

export interface TalkSituation {
  name: string;
  persona: string;
  timeOfDay: string;
  location: string;
  activity: string;
  worldNotes: string;
}

export function buildTalkState(s: TalkSituation): string {
  return `${s.name} is ${s.persona} It is ${s.timeOfDay}. You are at the ${s.location}, ${s.activity || "going about your day"}. ` +
    `The wandering traveler has just greeted you. ${s.worldNotes ? `Town happenings: ${s.worldNotes}.` : ""}`;
}

export const talkQuestions: Record<string, Question> = {
  reaction: {
    type: "choice",
    instructions: "How does this townsperson react to the traveler greeting them?",
    criteria: {
      friendly: "Warm and welcoming",
      guarded: "Cautious but polite",
      curious: "Interested and questioning",
      curt: "Short and closed-off",
    },
  },
  dialogue: {
    type: "choice",
    instructions: "What does this townsperson say in reply?",
    criteria: {
      greeting: "Return the greeting",
      weather: "Remark on the weather or time of day",
      town_tip: "Share a useful tip about the town",
      confession: "Share a small personal worry",
      warning: "Offer a warning about the area",
      farewell_hint: "Hint that they must be going",
    },
  },
  talk_mood: {
    type: "score",
    instructions: "How warmly does this townsperson engage?",
    criteria: ["cold", "flat", "warm", "bright"],
  },
  wants_more: {
    type: "noul",
    instructions: "Does this townsperson want to continue talking?",
  },
};

export interface QuestSituation {
  name: string;
  persona: string;
  relationship: string;
  timeOfDay: string;
  worldNotes: string;
}

export function buildQuestState(s: QuestSituation): string {
  return (
    `${s.name} is ${s.persona} The traveler is ${s.relationship} to you. ` +
    `It is ${s.timeOfDay}. ${s.worldNotes ? `Town happenings: ${s.worldNotes}.` : ""} ` +
    "Decide on a small errand the traveler could help with."
  );
}

export const questQuestions: Record<string, Question> = {
  errand: {
    type: "choice",
    instructions: "What errand should this townsperson ask the traveler to help with?",
    criteria: {
      fetch_item: "Ask the traveler to gather a few supplies and bring them back",
      deliver_message: "Send a short spoken message to another townsperson",
      rest_and_return: "Tell the traveler to rest and come back later",
    },
  },
  reward: {
    type: "score",
    instructions: "How generous should the reward for this errand be?",
    criteria: ["modest", "decent", "generous", "princely"],
  },
  willingness: {
    type: "noul",
    instructions: "Does this townsperson offer this errand to the traveler right now?",
  },
};