export const CONFIG = {
  schemaVersion: 1,
  version: "0.1.0",
  storageKey: "chang-an-granary-apprentice-progress-v1",
  initialRank: "見習倉曹",
  dailyLessonQuestionCount: 3,
  dailyLessonQuestionMaximum: 5,
  dailyFieldCount: 2,
  dailyCaseCount: 1,
  reputationPerCase: 1,
  rankThresholds: {
    clerk: { plots: 5, learnedEntries: 0, title: "書佐" },
    registrar: { plots: 12, learnedEntries: 3, title: "倉曹史" },
  },
  reviewIntervals: { 1: 1, 2: 2, 3: 4 },
  starRules: { startingStars: 3, hintCost: 1, minimumStars: 1 },
};

export const TECHNIQUE_IDS = ["fangtian", "litian", "guitian", "xietian", "jitian"];
export const SEGMENT_IDS = ["morning", "noon", "evening"];
export const SEGMENT_LABELS = { morning: "晨・日課進修", noon: "午・丈田任務", evening: "晚・民訟" };
