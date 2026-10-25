import { CONFIG, SEGMENT_IDS, TECHNIQUE_IDS } from "./config.js";
import { hasValidParameters } from "./math.js";

export function createDefaultSave() {
  const seals = {};
  const review = {};
  for (const techniqueId of TECHNIQUE_IDS) {
    seals[techniqueId] = { seen: false, learned: false, understood: false };
    review[techniqueId] = { box: 0, dueDay: 0 };
  }
  return {
    schemaVersion: CONFIG.schemaVersion,
    day: 1,
    rank: CONFIG.initialRank,
    landLedger: [],
    reputation: 0,
    seals,
    stars: {},
    hintDepth: {},
    review,
    reviewAdjustedIds: [],
    segments: { "1": { morning: false, noon: false, evening: false } },
    dayPlans: {},
    completedWorkIds: [],
    resolvedCaseIds: [],
    unlockedPlaces: ["county-office"],
  };
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeString(value, maximum = 180) {
  return typeof value === "string" && value.length <= maximum ? value : "";
}

function safePositiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function safeIdList(value, maximum = 10000) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, maximum).map((item) => safeString(item, 240)).filter(Boolean))];
}

function safeTaskList(value, allowedKinds) {
  if (!Array.isArray(value) || value.length > 5) return [];
  const parameterKeys = ["width", "length", "height", "endA", "endB", "tongue", "heel"];
  const tasks = value.map((task) => {
    const item = asPlainObject(task);
    const parameters = asPlainObject(item.parameters);
    const techniqueId = TECHNIQUE_IDS.includes(item.techniqueId) ? item.techniqueId : "";
    return {
      id: safeString(item.id, 240),
      kind: allowedKinds.includes(item.kind) ? item.kind : "",
      techniqueId,
      problemId: safeString(item.problemId, 100),
      slot: Math.min(5, safePositiveInteger(item.slot)),
      parameters: Object.fromEntries(parameterKeys.filter((key) => typeof parameters[key] === "string" && parameters[key].length <= 32).map((key) => [key, parameters[key]])),
    };
  });
  if (tasks.some((task) => !task.id || !task.kind || !task.techniqueId || !hasValidParameters(task.techniqueId, task.parameters))) return [];
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) return [];
  return tasks;
}

export function normalizeSave(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.schemaVersion !== CONFIG.schemaVersion) return null;
  const save = createDefaultSave();
  save.day = Math.max(1, safePositiveInteger(raw.day, 1));
  save.landLedger = Array.isArray(raw.landLedger)
    ? raw.landLedger.slice(0, 10000).map((entry) => ({
      id: safeString(entry?.id),
      techniqueId: TECHNIQUE_IDS.includes(entry?.techniqueId) ? entry.techniqueId : "",
      day: Math.max(1, safePositiveInteger(entry?.day, 1)),
      area: safeString(entry?.area, 80),
    })).filter((entry) => entry.id && entry.techniqueId && entry.area)
    : [];
  save.reputation = safePositiveInteger(raw.reputation);
  for (const techniqueId of TECHNIQUE_IDS) {
    const seal = asPlainObject(raw.seals?.[techniqueId]);
    save.seals[techniqueId] = {
      seen: seal.seen === true,
      learned: seal.learned === true,
      understood: seal.understood === true,
    };
    const review = asPlainObject(raw.review?.[techniqueId]);
    save.review[techniqueId] = {
      box: Math.min(3, safePositiveInteger(review.box)),
      dueDay: safePositiveInteger(review.dueDay),
    };
  }
  const stars = asPlainObject(raw.stars);
  for (const [id, value] of Object.entries(stars).slice(0, 10000)) {
    const score = safePositiveInteger(value);
    if (id.length <= 240 && score >= 1 && score <= 3) save.stars[id] = score;
  }
  const hintDepth = asPlainObject(raw.hintDepth);
  for (const [id, value] of Object.entries(hintDepth).slice(0, 10000)) {
    const level = safePositiveInteger(value, -1);
    if (id.length <= 240 && level >= 1 && level <= 3) save.hintDepth[id] = level;
  }
  const segments = asPlainObject(raw.segments);
  for (const [dayText, dayState] of Object.entries(segments).slice(0, 10000)) {
    if (!/^\d{1,8}$/.test(dayText)) continue;
    const day = asPlainObject(dayState);
    save.segments[dayText] = Object.fromEntries(SEGMENT_IDS.map((id) => [id, day[id] === true]));
  }
  const plans = asPlainObject(raw.dayPlans);
  for (const [dayText, value] of Object.entries(plans).slice(0, 10000)) {
    if (!/^\d{1,8}$/.test(dayText)) continue;
    const plan = asPlainObject(value);
    save.dayPlans[dayText] = {
      morningTechniqueId: TECHNIQUE_IDS.includes(plan.morningTechniqueId) ? plan.morningTechniqueId : "",
      fieldTechniqueIds: safeIdList(plan.fieldTechniqueIds, TECHNIQUE_IDS.length).filter((id) => TECHNIQUE_IDS.includes(id)),
      caseTemplateId: safeString(plan.caseTemplateId, 100),
      caseTechniqueId: TECHNIQUE_IDS.includes(plan.caseTechniqueId) ? plan.caseTechniqueId : "",
      morningTasks: safeTaskList(plan.morningTasks, ["lesson-original", "lesson-variant", "review"]),
      fieldTasks: safeTaskList(plan.fieldTasks, ["field"]),
    };
  }
  save.completedWorkIds = safeIdList(raw.completedWorkIds);
  save.reviewAdjustedIds = safeIdList(raw.reviewAdjustedIds);
  save.resolvedCaseIds = safeIdList(raw.resolvedCaseIds);
  save.unlockedPlaces = safeIdList(raw.unlockedPlaces, 100).filter((id) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(id));
  if (!save.unlockedPlaces.includes("county-office")) save.unlockedPlaces.push("county-office");
  save.rank = getRank(save);
  return save;
}

export function getRank(save) {
  const learnedCount = TECHNIQUE_IDS.filter((id) => save.seals?.[id]?.learned).length;
  const plotCount = save.landLedger?.length ?? 0;
  const registrar = CONFIG.rankThresholds.registrar;
  if (plotCount >= registrar.plots && learnedCount >= registrar.learnedEntries) return registrar.title;
  if (plotCount >= CONFIG.rankThresholds.clerk.plots) return CONFIG.rankThresholds.clerk.title;
  return CONFIG.initialRank;
}

export function markSeal(save, techniqueId, tier) {
  if (!TECHNIQUE_IDS.includes(techniqueId) || !["seen", "learned", "understood"].includes(tier)) return save;
  save.seals[techniqueId][tier] = true;
  save.rank = getRank(save);
  return save;
}

export function recordStars(save, questionId, stars) {
  const score = Math.max(CONFIG.starRules.minimumStars, Math.min(CONFIG.starRules.startingStars, safePositiveInteger(stars, 1)));
  save.stars[questionId] = Math.max(save.stars[questionId] ?? 0, score);
  return save;
}

export function completeWork(save, workId) {
  const id = safeString(workId, 240);
  if (id && !save.completedWorkIds.includes(id)) save.completedWorkIds.push(id);
  return save;
}

export function isWorkComplete(save, workId) {
  return save.completedWorkIds.includes(workId);
}

export function scheduleReview(save, techniqueId, wasCorrect, day = save.day) {
  if (!TECHNIQUE_IDS.includes(techniqueId)) return save;
  const current = save.review[techniqueId] ?? { box: 0, dueDay: 0 };
  const box = wasCorrect ? Math.min(3, current.box + 1) : current.box;
  const interval = box > 0 ? CONFIG.reviewIntervals[box] : 1;
  save.review[techniqueId] = { box, dueDay: Math.max(1, day) + interval };
  return save;
}

export function markReviewAdjustment(save, workId) {
  const id = safeString(workId, 240);
  if (id && !save.reviewAdjustedIds.includes(id)) save.reviewAdjustedIds.push(id);
  return save;
}

export function hadReviewAdjustment(save, workId) {
  return save.reviewAdjustedIds.includes(workId);
}

export function clearReviewAdjustment(save, workId) {
  save.reviewAdjustedIds = save.reviewAdjustedIds.filter((id) => id !== workId);
  return save;
}

export function recordPlot(save, entry) {
  if (!entry?.id || save.landLedger.some((existing) => existing.id === entry.id)) return save;
  if (!TECHNIQUE_IDS.includes(entry.techniqueId) || !entry.area) return save;
  save.landLedger.push({
    id: safeString(entry.id),
    techniqueId: entry.techniqueId,
    day: Math.max(1, safePositiveInteger(entry.day, 1)),
    area: safeString(entry.area, 80),
  });
  save.rank = getRank(save);
  return save;
}

export function recordCaseResolution(save, caseId) {
  const id = safeString(caseId);
  if (!id || save.resolvedCaseIds.includes(id)) return save;
  save.resolvedCaseIds.push(id);
  save.reputation += CONFIG.reputationPerCase;
  return save;
}

export function completeSegment(save, day, segmentId, newlyUnlockedPlaces = []) {
  if (!SEGMENT_IDS.includes(segmentId)) return save;
  const key = String(Math.max(1, safePositiveInteger(day, 1)));
  if (!save.segments[key]) save.segments[key] = { morning: false, noon: false, evening: false };
  save.segments[key][segmentId] = true;
  if (segmentId === "morning" && Number(key) === 1) {
    for (const placeId of newlyUnlockedPlaces) {
      if (/^[a-z0-9][a-z0-9-]{0,79}$/.test(placeId) && !save.unlockedPlaces.includes(placeId)) save.unlockedPlaces.push(placeId);
    }
  }
  return save;
}

export function isDayComplete(save, day = save.day) {
  return SEGMENT_IDS.every((id) => save.segments[String(day)]?.[id] === true);
}

export function advanceDay(save, day = save.day) {
  if (day !== save.day || !isDayComplete(save, day) || save.day >= Number.MAX_SAFE_INTEGER) return false;
  save.day += 1;
  const nextKey = String(save.day);
  if (!save.segments[nextKey]) save.segments[nextKey] = { morning: false, noon: false, evening: false };
  return true;
}

export function encodeSave(save) {
  const normalized = normalizeSave(save);
  if (!normalized) return "";
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function decodeSave(jsonText) {
  try {
    return normalizeSave(JSON.parse(String(jsonText ?? "")));
  } catch {
    return null;
  }
}

export function mergeSaves(currentInput, incomingInput) {
  const current = normalizeSave(currentInput) ?? createDefaultSave();
  const incoming = normalizeSave(incomingInput);
  if (!incoming) return current;
  const merged = createDefaultSave();
  merged.day = Math.max(current.day, incoming.day);
  const ledger = new Map();
  for (const entry of [...current.landLedger, ...incoming.landLedger]) ledger.set(entry.id, entry);
  merged.landLedger = [...ledger.values()];
  merged.reputation = Math.max(current.reputation, incoming.reputation);
  merged.resolvedCaseIds = [...new Set([...current.resolvedCaseIds, ...incoming.resolvedCaseIds])];
  merged.reputation = Math.max(merged.reputation, merged.resolvedCaseIds.length * CONFIG.reputationPerCase);
  merged.completedWorkIds = [...new Set([...current.completedWorkIds, ...incoming.completedWorkIds])];
  merged.reviewAdjustedIds = [...new Set([...current.reviewAdjustedIds, ...incoming.reviewAdjustedIds])];
  merged.unlockedPlaces = [...new Set([...current.unlockedPlaces, ...incoming.unlockedPlaces])];
  for (const techniqueId of TECHNIQUE_IDS) {
    merged.seals[techniqueId] = {
      seen: current.seals[techniqueId].seen || incoming.seals[techniqueId].seen,
      learned: current.seals[techniqueId].learned || incoming.seals[techniqueId].learned,
      understood: current.seals[techniqueId].understood || incoming.seals[techniqueId].understood,
    };
    merged.review[techniqueId] = {
      box: Math.max(current.review[techniqueId].box, incoming.review[techniqueId].box),
      dueDay: Math.min(current.review[techniqueId].dueDay || Number.MAX_SAFE_INTEGER, incoming.review[techniqueId].dueDay || Number.MAX_SAFE_INTEGER),
    };
    if (merged.review[techniqueId].dueDay === Number.MAX_SAFE_INTEGER) merged.review[techniqueId].dueDay = 0;
  }
  merged.stars = { ...current.stars };
  for (const [id, score] of Object.entries(incoming.stars)) merged.stars[id] = Math.max(merged.stars[id] ?? 0, score);
  merged.hintDepth = { ...current.hintDepth };
  for (const [id, level] of Object.entries(incoming.hintDepth)) merged.hintDepth[id] = Math.max(merged.hintDepth[id] ?? 0, level);
  for (const source of [current, incoming]) {
    for (const [day, status] of Object.entries(source.segments)) {
      if (!merged.segments[day]) merged.segments[day] = { morning: false, noon: false, evening: false };
      for (const segmentId of SEGMENT_IDS) merged.segments[day][segmentId] ||= status[segmentId];
    }
    for (const [day, plan] of Object.entries(source.dayPlans)) {
      if (!merged.dayPlans[day] || source === current) merged.dayPlans[day] = plan;
    }
  }
  merged.rank = getRank(merged);
  return merged;
}

export function loadSave(storageOverride) {
  try {
    const storage = storageOverride ?? globalThis.localStorage;
    const text = storage.getItem(CONFIG.storageKey);
    if (!text) return { save: createDefaultSave(), persistent: true, recovered: false };
    const save = decodeSave(text);
    return save
      ? { save, persistent: true, recovered: false }
      : { save: createDefaultSave(), persistent: true, recovered: true };
  } catch {
    return { save: createDefaultSave(), persistent: false, recovered: false };
  }
}

export function storeSave(save, storageOverride) {
  try {
    const storage = storageOverride ?? globalThis.localStorage;
    storage.setItem(CONFIG.storageKey, encodeSave(save));
    return true;
  } catch {
    return false;
  }
}
