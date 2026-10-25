import { calculateArea, generateParameters, rational, seededRandom } from "./math.js";
import { CONFIG, TECHNIQUE_IDS } from "./config.js";

export function getAvailableFieldTechniques(save, mapData) {
  return mapData.fieldTypes
    .filter((fieldType) => fieldType.requiresLearned.every((id) => save.seals[id]?.learned))
    .map((fieldType) => fieldType.techniqueId);
}

function originalProblems(problems, techniqueId) {
  return problems
    .filter((problem) => problem.techniqueId === techniqueId && problem.kind === "book")
    .sort((a, b) => a.number - b.number);
}

function generatedQuestion(techniqueId, day, index, problems, kind = "review") {
  const parameters = generateParameters(
    techniqueId,
    seededRandom(`${kind}:${day}:${index}:${techniqueId}`),
    originalProblems(problems, techniqueId),
  );
  if (!parameters) return null;
  return {
    id: `${kind}-${day}-${index}-${techniqueId}`,
    kind,
    techniqueId,
    parameters,
    expectedSquareBu: calculateArea(techniqueId, parameters),
  };
}

export function buildMorningQuestions(save, problems) {
  const day = save.day;
  const plan = save.dayPlans[String(day)] ??= { morningTechniqueId: "", fieldTechniqueIds: [], caseTemplateId: "", caseTechniqueId: "" };
  if (plan.morningTasks?.length) {
    const restored = plan.morningTasks.map((task) => {
      const problem = task.problemId ? problems.find((item) => item.id === task.problemId) : null;
      if (task.kind === "lesson-original" && (!problem || problem.kind !== "book" || problem.techniqueId !== task.techniqueId)) return null;
      if (problem && (problem.kind !== "book" || problem.techniqueId !== task.techniqueId)) return null;
      const parameters = problem?.parameters ?? task.parameters;
      const expectedSquareBu = calculateArea(task.techniqueId, parameters);
      if (!expectedSquareBu) return null;
      return {
        ...task,
        ...(problem ? { problem, parameters } : {}),
        expectedSquareBu,
      };
    });
    if (restored.length >= CONFIG.dailyLessonQuestionCount && restored.length <= CONFIG.dailyLessonQuestionMaximum && restored.every(Boolean)) return restored;
    plan.morningTasks = [];
  }
  const newTechnique = TECHNIQUE_IDS.find((id) => !save.seals[id].learned) ?? "";
  const dueTechniques = TECHNIQUE_IDS.filter((id) => save.seals[id].learned && save.review[id].dueDay > 0 && save.review[id].dueDay <= day);
  const questions = [];

  if (newTechnique) {
    const firstProblem = originalProblems(problems, newTechnique)[0];
    if (firstProblem) {
      questions.push({
        id: `morning-${day}-${firstProblem.id}`,
        kind: "lesson-original",
        techniqueId: newTechnique,
        problem: firstProblem,
        parameters: firstProblem.parameters,
        expectedSquareBu: calculateArea(newTechnique, firstProblem.parameters),
      });
    }
  }

  let variantIndex = 1;
  while (questions.length < CONFIG.dailyLessonQuestionCount) {
    const techniqueId = newTechnique || dueTechniques[(questions.length + variantIndex) % Math.max(1, dueTechniques.length)] ||
      TECHNIQUE_IDS.find((id) => save.seals[id].learned) || TECHNIQUE_IDS[0];
    const variant = generatedQuestion(techniqueId, day, variantIndex, problems, newTechnique ? "lesson-variant" : "review");
    if (variant) questions.push(variant);
    variantIndex += 1;
    if (variantIndex > 20) break;
  }

  for (const techniqueId of dueTechniques) {
    if (questions.length >= CONFIG.dailyLessonQuestionMaximum) break;
    if (questions.some((question) => question.techniqueId === techniqueId && question.kind === "review")) continue;
    const review = generatedQuestion(techniqueId, day, variantIndex, problems, "review");
    variantIndex += 1;
    if (review) questions.push(review);
  }

  const result = questions.slice(0, CONFIG.dailyLessonQuestionMaximum);
  plan.morningTechniqueId = newTechnique;
  plan.morningTasks = result.map((question) => ({
    id: question.id,
    kind: question.kind,
    techniqueId: question.techniqueId,
    problemId: question.problem?.id ?? "",
    slot: 0,
    parameters: question.parameters,
  }));
  return result;
}

export function buildFieldTasks(save, problems, mapData) {
  if (!save.unlockedPlaces.includes("field")) return [];
  const plan = save.dayPlans[String(save.day)] ??= { morningTechniqueId: "", fieldTechniqueIds: [], caseTemplateId: "", caseTechniqueId: "" };
  if (plan.fieldTasks?.length) {
    const restored = plan.fieldTasks.map((task) => ({
      ...task,
      expectedSquareBu: calculateArea(task.techniqueId, task.parameters),
    }));
    if (restored.length === CONFIG.dailyFieldCount && restored.every((task) => task.expectedSquareBu)) return restored;
    plan.fieldTasks = [];
  }
  const available = getAvailableFieldTechniques(save, mapData);
  if (!available.length) return [];
  const tasks = Array.from({ length: CONFIG.dailyFieldCount }, (_, index) => {
    const techniqueId = available[(save.day + index - 1) % available.length];
    const question = generatedQuestion(techniqueId, save.day, index + 1, problems, "field");
    return question ? { ...question, id: `field-${save.day}-${index + 1}`, slot: index + 1 } : null;
  }).filter(Boolean);
  plan.fieldTechniqueIds = tasks.map((task) => task.techniqueId);
  plan.fieldTasks = tasks.map((task) => ({
    id: task.id,
    kind: "field",
    techniqueId: task.techniqueId,
    problemId: "",
    slot: task.slot,
    parameters: task.parameters,
  }));
  return tasks;
}

function makeCaseArea(techniqueId, day, index, problems) {
  const question = generatedQuestion(techniqueId, day, index, problems, "case-area");
  return question ? { techniqueId, parameters: question.parameters, area: question.expectedSquareBu } : null;
}

function selectRangeValue(range, day, templateId) {
  const minimum = BigInt(range?.minimum ?? 1);
  const maximum = BigInt(range?.maximum ?? minimum);
  const width = maximum - minimum + 1n;
  const salt = BigInt([...templateId].reduce((sum, character) => sum + character.codePointAt(0), 0));
  return minimum + (BigInt(day) * 37n + salt) % width;
}

export function buildEveningCase(save, problems, templates) {
  const learned = TECHNIQUE_IDS.filter((id) => save.seals[id].learned);
  if (!learned.length) return null;
  const preferredIndex = (save.day - 1) % templates.length;
  const orderedTemplates = [...templates.slice(preferredIndex), ...templates.slice(0, preferredIndex)];
  const template = orderedTemplates.find((item) => item.techniqueIds.some((id) => learned.includes(id))) ?? orderedTemplates[0];
  const available = template.techniqueIds.filter((id) => learned.includes(id));
  const firstTechnique = available[0] ?? learned[0];
  const secondTechnique = available.find((id) => id !== firstTechnique) ?? firstTechnique;
  const first = makeCaseArea(firstTechnique, save.day, 1, problems);
  let second = makeCaseArea(secondTechnique, save.day, 2, problems);
  if (!first || !second) return null;
  if (template.type === "compare" && first.area.n * second.area.d === second.area.n * first.area.d) {
    for (let attempt = 3; attempt < 12; attempt += 1) {
      const candidate = makeCaseArea(secondTechnique, save.day, attempt, problems);
      if (candidate && first.area.n * candidate.area.d !== candidate.area.n * first.area.d) {
        second = candidate;
        break;
      }
    }
  }

  let expected;
  let choices = null;
  let unit = "平方步";
  let answerHint = "以頃、畝、步填寫";
  let detail;
  if (template.type === "compare") {
    expected = first.area.n * second.area.d >= second.area.n * first.area.d ? "甲田" : "乙田";
    choices = ["甲田", "乙田"];
    detail = { first, second };
  } else if (template.type === "rent") {
    const rate = selectRangeValue(template.parameterRanges?.rentPerMu, save.day, template.id);
    expected = first.area.n * rate * 1n;
    const expectedDenominator = first.area.d * 240n;
    expected = rational(expected, expectedDenominator);
    unit = "租額";
    answerHint = "填寫換算後的租額（本案以每畝固定租額計）";
    detail = { first, rate: String(rate) };
  } else if (template.type === "price") {
    const rate = selectRangeValue(template.parameterRanges?.pricePerMu, save.day, template.id);
    expected = rational(first.area.n * rate, first.area.d * 240n);
    unit = "價額";
    answerHint = "填寫按畝計算的價額（本案使用題內單價）";
    detail = { first, rate: String(rate) };
  } else if (template.type === "divide") {
    expected = rational(first.area.n, first.area.d * 2n);
    detail = { first };
  } else {
    let recordedValue = selectRangeValue(template.parameterRanges?.oldRecordSquareBu, save.day, template.id);
    if (first.area.n === recordedValue * first.area.d) {
      const range = template.parameterRanges?.oldRecordSquareBu;
      recordedValue = recordedValue === BigInt(range.maximum) ? BigInt(range.minimum) : recordedValue + 1n;
    }
    const recorded = rational(recordedValue, 1n);
    const delta = first.area.n * recorded.d - recorded.n * first.area.d;
    expected = rational(delta < 0n ? -delta : delta, first.area.d * recorded.d);
    detail = { first, recorded };
  }

  return {
    id: `case-day-${save.day}`,
    template,
    detail,
    expected,
    choices,
    unit,
    answerHint,
    techniqueIds: [...new Set([first.techniqueId, second.techniqueId])],
  };
}

export function formatParameters(techniqueId, parameters, presentation = "") {
  if (techniqueId === "fangtian") return `廣 ${parameters.width} 步，從 ${parameters.length} 步`;
  if (techniqueId === "litian") return `廣 ${parameters.width} 里，從 ${parameters.length} 里`;
  if (techniqueId === "guitian") return `廣 ${parameters.width} 步，正從 ${parameters.height} 步`;
  if (techniqueId === "xietian" && presentation === "height-first") return `正廣 ${parameters.height} 步，兩畔從 ${parameters.endA} 與 ${parameters.endB} 步`;
  if (techniqueId === "xietian") return `兩頭廣 ${parameters.endA}、${parameters.endB} 步，正從 ${parameters.height} 步`;
  if (techniqueId === "jitian") return `舌廣 ${parameters.tongue} 步，踵廣 ${parameters.heel} 步，正從 ${parameters.height} 步`;
  return "尺寸待核對";
}

export function questionLabel(question) {
  if (question.kind === "lesson-original") return `原題第 ${question.problem.number} 題`;
  return "變式題";
}
