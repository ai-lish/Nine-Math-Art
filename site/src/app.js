import { CONFIG, SEGMENT_IDS, SEGMENT_LABELS, TECHNIQUE_IDS } from "./config.js";
import {
  calculateArea,
  compare,
  parseAreaAnswer,
  parseRational,
  rationalString,
  sameValue,
} from "./math.js";
import {
  buildEveningCase,
  buildFieldTasks,
  buildMorningQuestions,
  formatParameters,
  getAvailableFieldTechniques,
  questionLabel,
} from "./game.js";
import {
  advanceDay,
  clearReviewAdjustment,
  completeSegment,
  completeWork,
  decodeSave,
  encodeSave,
  hadReviewAdjustment,
  isDayComplete,
  isWorkComplete,
  loadSave,
  markReviewAdjustment,
  markSeal,
  mergeSaves,
  recordCaseResolution,
  recordPlot,
  recordStars,
  scheduleReview,
  storeSave,
} from "./state.js";

const [problems, techniques, caseTemplates, mapData] = await Promise.all([
  fetch(new URL("../content/problems.json", import.meta.url)).then((response) => response.json()),
  fetch(new URL("../content/techniques.json", import.meta.url)).then((response) => response.json()),
  fetch(new URL("../content/case-templates.json", import.meta.url)).then((response) => response.json()),
  fetch(new URL("../content/map.json", import.meta.url)).then((response) => response.json()),
]);

const main = document.querySelector("#main");
const notice = document.querySelector("#notice");
const navButtons = [...document.querySelectorAll("[data-view]")];
const storageStatus = document.querySelector("#storage-status");
const loaded = loadSave();
let save = loaded.save;
let persistent = loaded.persistent && storeSave(save);
let activeView = "home";
let noticeTimer = 0;
const redoIds = new Set();
const feedbackPhrases = ["有些偏差，請再核對尺寸。", "再量一次試試。", "請核對所用的單位與尺寸。"];

function el(tag, options = {}, children = []) {
  const item = document.createElement(tag);
  if (options.className) item.className = options.className;
  if (options.text !== undefined) item.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value !== undefined && value !== null) item.setAttribute(name, String(value));
  }
  for (const [name, value] of Object.entries(options.dataset ?? {})) item.dataset[name] = value;
  if (options.onClick) item.addEventListener("click", options.onClick);
  if (options.onSubmit) item.addEventListener("submit", options.onSubmit);
  if (options.onChange) item.addEventListener("change", options.onChange);
  for (const child of (Array.isArray(children) ? children : [children])) {
    if (child instanceof Node) item.append(child);
    else if (child !== null && child !== undefined && child !== false) item.append(document.createTextNode(String(child)));
  }
  return item;
}

function button(label, onClick, className = "secondary-button", attrs = {}) {
  return el("button", { className, text: label, attrs: { type: "button", ...attrs }, onClick });
}

function titleBlock(title, description = "") {
  return el("div", { className: "section-heading" }, [
    el("div", {}, [el("h2", { text: title }), description ? el("p", { text: description }) : null]),
  ]);
}

function techniqueFor(id) {
  return techniques.find((technique) => technique.id === id) ?? techniques[0];
}

function problemFor(id) {
  return problems.find((problem) => problem.id === id);
}

function updateStorageStatus() {
  storageStatus.textContent = persistent ? "本機存檔已啟用" : "目前只保留在這次開啟期間，請匯出備份。";
}

function persist() {
  persistent = storeSave(save);
  updateStorageStatus();
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 5200);
}

function selectView(view) {
  activeView = view;
  render();
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function segmentIsDone(segmentId, day = save.day) {
  return Boolean(save.segments[String(day)]?.[segmentId]);
}

function segmentButton(segmentId) {
  return button(segmentId === "morning" ? "進入晨課" : segmentId === "noon" ? "前往丈田" : "進入民訟", () => selectView(segmentId === "morning" ? "morning" : segmentId === "noon" ? "field" : "evening"), "primary-button");
}

function renderDayCompleteCard() {
  if (!isDayComplete(save)) return null;
  return el("section", { className: "notice day-transition" }, [
    el("h3", { text: `第 ${save.day} 官日三段已完成` }),
    el("p", { text: "可先重溫本日任何一段；準備好後再進入下一官日。" }),
    button(`開始第 ${save.day + 1} 官日`, () => {
      if (!advanceDay(save, save.day)) return;
      persist();
      showNotice(`已進入第 ${save.day} 官日。`);
      render();
    }, "primary-button"),
  ]);
}

function renderHome() {
  const wrapper = el("section");
  const completed = SEGMENT_IDS.filter((id) => segmentIsDone(id)).length;
  const hero = el("section", { className: "hero" }, [
    el("p", { className: "eyebrow", text: `第 ${save.day} 官日・見習記錄` }),
    el("h2", { text: "晨習一術，午量田畝，晚聽民訟。" }),
    el("p", { text: "你是縣衙見習倉曹。沿着每日公務認識五種田形，記錄丈量結果，逐層收集圖鑑印信。" }),
    segmentButton("morning"),
  ]);
  wrapper.append(hero);

  const metrics = el("div", { className: "metric-grid" }, [
    metric("官階", save.rank),
    metric("地籍冊", `${save.landLedger.length} 塊田`),
    metric("民望", String(save.reputation)),
    metric("印信", `${TECHNIQUE_IDS.reduce((count, id) => count + Object.values(save.seals[id]).filter(Boolean).length, 0)} 枚`),
  ]);
  wrapper.append(metrics);

  wrapper.append(titleBlock("本日官務", "三段完成後可重溫本日，再由按鈕進入下一官日。"));
  const progress = el("div", { className: "daily-progress" });
  for (const id of SEGMENT_IDS) {
    const done = segmentIsDone(id);
    progress.append(el("article", { className: `progress-item${done ? " done" : ""}` }, [
      el("strong", { text: SEGMENT_LABELS[id] }),
      el("span", { text: done ? "本日已完成・可重溫" : "尚待完成" }),
      button(done ? "再看一次" : "前往", () => selectView(id === "morning" ? "morning" : id === "noon" ? "field" : "evening")),
    ]));
  }
  wrapper.append(progress);
  wrapper.append(el("p", { className: "eyebrow", text: `今日進度 ${completed}／3 段` }));
  const dayCard = renderDayCompleteCard();
  if (dayCard) wrapper.append(dayCard);

  wrapper.append(titleBlock("縣境小圖", "目前開放兩處地點；新地點預留資料欄位，尚未加入。"));
  const map = el("div", { className: "map-grid", attrs: { "aria-label": "縣境小地圖" } });
  for (const location of mapData.locations) map.append(renderPlace(location));
  wrapper.append(map);

  wrapper.append(titleBlock("地籍冊・田畝格線"));
  wrapper.append(renderLedger());
  main.replaceChildren(wrapper);
}

function renderPlace(location) {
  const unlock = location.unlock ?? {};
  const available = unlock.type === "always" || save.unlockedPlaces.includes(location.id);
  const glyph = location.id === "county-office" ? "衙" : location.id === "field" ? "田" : location.name.slice(0, 1);
  const activityNames = { morning: "日課進修", noon: "丈田任務", evening: "民訟" };
  const activityViews = { morning: "morning", noon: "field", evening: "evening" };
  const card = el("article", { className: `place-card${available ? "" : " locked"}` }, [
    el("span", { className: "place-glyph", text: available ? glyph : "封", attrs: { "aria-hidden": "true" } }),
    el("h3", { text: location.name }),
    el("p", { text: available ? (location.activityIds ?? []).map((id) => activityNames[id] ?? id).join("・") : "完成首日晨課後開啟" }),
  ]);
  const destinations = available ? (location.activityIds ?? []).filter((id) => activityViews[id]) : [];
  if (destinations.length) {
    for (const activityId of destinations) card.append(button(`前往${activityNames[activityId]}`, () => selectView(activityViews[activityId]), activityId === "morning" ? "primary-button" : "secondary-button"));
  } else if (!available) {
    card.append(button("尚未開啟", () => selectView("morning"), "secondary-button", { "aria-label": `${location.name}尚未開啟，前往晨課` }));
  }
  return card;
}

function metric(label, value) {
  return el("article", { className: "metric-card" }, [el("span", { className: "label", text: label }), el("strong", { text: value })]);
}

function renderLedger() {
  if (!save.landLedger.length) return el("p", { className: "empty-state", text: "已登記的田塊會逐格蓋上朱砂印。" });
  const grid = el("div", { className: "ledger-grid", attrs: { "aria-label": `地籍冊共 ${save.landLedger.length} 塊田` } });
  save.landLedger.forEach((entry, index) => {
    grid.append(el("div", { className: "ledger-cell", text: "准", attrs: { title: `第 ${index + 1} 塊・第 ${entry.day} 官日` } }));
  });
  return grid;
}

function renderMorning() {
  const wrapper = el("section");
  wrapper.append(titleBlock(`第 ${save.day} 官日・晨課`, "每日晨課至少三題；變式數字由固定種子產生，可重現。"));
  const questions = buildMorningQuestions(save, problems);
  const lesson = questions.find((question) => question.kind === "lesson-original");
  if (lesson) wrapper.append(renderLessonScroll(lesson.techniqueId, lesson.problem));
  const cards = el("div", { className: "question-list" });
  questions.forEach((question, index) => cards.append(renderAreaQuestion(question, "morning", index + 1)));
  wrapper.append(cards);
  const allDone = questions.length > 0 && questions.every((question) => isWorkComplete(save, question.id));
  if (allDone) {
    const newPlaces = mapData.locations.filter((location) => location.unlock?.type === "completed-first-morning").map((location) => location.id);
    completeSegment(save, save.day, "morning", newPlaces);
    persist();
    wrapper.append(el("p", { className: "notice", text: "晨課已記錄；田野已開放，可以重溫或繼續午間丈田。", attrs: { role: "status" } }));
  } else {
    wrapper.append(el("p", { className: "eyebrow", text: `已完成 ${questions.filter((question) => isWorkComplete(save, question.id)).length}／${questions.length} 題` }));
  }
  const dayCard = renderDayCompleteCard();
  if (dayCard) wrapper.append(dayCard);
  main.replaceChildren(wrapper);
}

function renderLessonScroll(techniqueId, problem) {
  const technique = techniqueFor(techniqueId);
  const params = formatParameters(techniqueId, problem.parameters, problem.presentation);
  return el("article", { className: "lesson-card" }, [
    el("p", { className: "eyebrow", text: "新術教學・讀簡" }),
    el("h3", { text: technique.name }),
    el("p", { text: `原題第 ${problem.number} 題・${params}` }),
    placeholder(technique.originalText || "原文待教師核對"),
    placeholder(technique.algorithmText || "術曰待教師核對"),
    placeholder(technique.plainExplanation || "白話解說待教師核對"),
    el("p", { className: "eyebrow", text: "先讀尺寸，再試答第一題。解出後記為習得。" }),
  ]);
}

function placeholder(text) {
  return el("p", { className: "lesson-placeholder", text });
}

function renderAreaQuestion(question, mode, number) {
  const solved = isWorkComplete(save, question.id) && !redoIds.has(question.id);
  const card = el("article", { className: `question-card${solved ? " solved" : ""}` });
  const label = mode === "field" ? `田塊 ${question.slot}` : `第 ${number} 題`;
  const tag = questionLabel(question);
  const title = mode === "field" ? `${label}・${techniqueFor(question.techniqueId).name}` : `${label}・${techniqueFor(question.techniqueId).name}`;
  card.append(el("div", { className: "question-head" }, [
    el("div", {}, [el("h3", { text: title }), el("p", { className: "eyebrow", text: `${tag}${question.problem ? `・原題 ${question.problem.number}` : ""}` })]),
    el("span", { className: "question-tag", text: mode === "field" ? "丈田" : question.kind === "review" ? "到期複習" : question.kind === "lesson-variant" ? "新術變式" : "新術試題" }),
  ]));
  card.append(el("p", { className: "problem-params", text: formatParameters(question.techniqueId, question.parameters, question.problem?.presentation) }));

  const svg = drawPlot(question.techniqueId, question.parameters, `第 ${number} 題田形圖`, question.problem?.presentation);
  card.append(svg);
  if (solved) {
    card.append(el("p", { className: "feedback good", text: mode === "field" ? "朱砂印已蓋，已登記入地籍冊。" : "已記錄，可隨時重溫本題。" }));
    card.append(button("再做一次", () => { redoIds.add(question.id); render(); }, "secondary-button"));
    return card;
  }

  const answerFields = areaInputs(`answer-${question.id}`);
  const hint = renderHint(question);
  const form = el("form", { onSubmit: (event) => {
    event.preventDefault();
    const answer = parseAreaAnswer({
      qing: answerFields.qing.value,
      mu: answerFields.mu.value,
      bu: answerFields.bu.value,
    });
    if (!answer) {
      showNotice("請在頃、畝、步其中一欄輸入整數、分數或小數。");
      return;
    }
    const correct = sameValue(answer, question.expectedSquareBu);
    if (!correct) {
      if (mode === "morning" && question.kind === "review" && !isWorkComplete(save, question.id)) {
        markReviewAdjustment(save, question.id);
        persist();
      }
      showNotice(feedbackPhrases[Math.floor(Math.random() * feedbackPhrases.length)]);
      return;
    }
    const firstCompletion = !isWorkComplete(save, question.id);
    const hintCount = save.hintDepth[question.id] ?? 0;
    const starQuestionId = question.problem?.id ?? question.id;
    recordStars(save, starQuestionId, Math.max(CONFIG.starRules.minimumStars, CONFIG.starRules.startingStars - hintCount));
    completeWork(save, question.id);
    redoIds.delete(question.id);
    if (mode === "morning" && question.kind === "lesson-original" && firstCompletion) {
      markSeal(save, question.techniqueId, "learned");
      scheduleReview(save, question.techniqueId, true, save.day);
    } else if (mode === "morning" && question.kind === "review" && firstCompletion && save.review[question.techniqueId].dueDay <= save.day) {
      scheduleReview(save, question.techniqueId, !hadReviewAdjustment(save, question.id), save.day);
      clearReviewAdjustment(save, question.id);
    }
    if (mode === "field" && firstCompletion) {
      recordPlot(save, {
        id: question.id,
        techniqueId: question.techniqueId,
        day: save.day,
        area: `${rationalString(question.expectedSquareBu)} 平方步`,
      });
    }
    persist();
    showNotice(mode === "field" ? "准印已蓋，這塊田已登記。" : "准印已蓋，答案已記錄。");
    render();
  } }, [
    answerFields.wrapper,
    answerFields.tools,
    hint,
    el("div", { className: "form-actions" }, [
      el("button", { className: "primary-button", text: "核算答案", attrs: { type: "submit" } }),
      mode === "field" ? el("span", { className: "eyebrow", text: "答案可用頃、畝、平方步組合" }) : null,
    ]),
  ]);
  card.append(form);
  return card;
}

function areaInputs(prefix) {
  const wrapper = el("div", { className: "answer-grid", attrs: { "aria-label": "面積答案，可用多種單位組合" } });
  const result = {};
  const fields = [["qing", "頃"], ["mu", "畝"], ["bu", "平方步"]];
  for (const [key, label] of fields) {
    const input = el("input", { attrs: { id: `${prefix}-${key}`, name: key, type: "text", inputmode: "text", autocomplete: "off", "aria-label": label, placeholder: "可留空" } });
    result[key] = input;
    wrapper.append(el("div", { className: "answer-field" }, [el("label", { text: label, attrs: { for: input.id } }), input]));
  }
  result.wrapper = wrapper;
  result.tools = fractionInputTools(fields.map(([key]) => result[key]));
  return result;
}

function fractionInputTools(inputs) {
  let activeInput = inputs[0] ?? null;
  for (const input of inputs) input.addEventListener("focus", () => { activeInput = input; });
  const insert = (value) => {
    if (!activeInput) return;
    const start = activeInput.selectionStart ?? activeInput.value.length;
    const end = activeInput.selectionEnd ?? start;
    activeInput.setRangeText(value, start, end, "end");
    activeInput.focus({ preventScroll: true });
  };
  return el("div", { className: "fraction-tools", attrs: { "aria-label": "分數輸入工具" } }, [
    button("插入分數線 /", () => insert("/")),
    button("插入空格", () => insert(" ")),
  ]);
}

function renderHint(question) {
  const key = question.id;
  const currentDepth = save.hintDepth[key] ?? 0;
  const box = el("div", { className: "hint-box", attrs: { "aria-live": "polite", tabindex: "-1" } });
  const technique = techniqueFor(question.techniqueId);
  const example = technique.hintExample;
  if (currentDepth > 0) {
    const steps = [];
    if (currentDepth >= 1) steps.push(`第一層：辨認${technique.name}的田形，再按題目標示的尺寸核算。`);
    if (currentDepth >= 2) steps.push(`第二層：本術提示式為「${technique.formula}」。`);
    if (currentDepth >= 3 && example) {
      steps.push(`第三層示範：${formatParameters(technique.id, example.parameters)}，得 ${example.answer} ${example.unit}。`);
    }
    steps.forEach((step) => box.append(el("p", { text: step })));
  }
  const nextDepth = currentDepth + 1;
  if (nextDepth <= 3) {
    box.append(button(`提示 ${nextDepth}／3`, () => {
      save.hintDepth[key] = nextDepth;
      persist();
      const updated = renderHint(question);
      box.replaceWith(updated);
      (updated.querySelector("button") ?? updated).focus();
    }));
  } else {
    box.append(el("span", { className: "eyebrow", text: "提示已全部展開" }));
  }
  return box;
}

function drawPlot(techniqueId, parameters, label, presentation = "") {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 300 190");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${label}・${formatParameters(techniqueId, parameters, presentation)}`);
  svg.classList.add("plot-svg");
  const addSvg = (name, attrs, text = "") => {
    const item = document.createElementNS(namespace, name);
    for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, String(value));
    if (text) item.textContent = text;
    svg.append(item);
    return item;
  };
  const textLabel = (x, y, value, anchor = "middle") => addSvg("text", { x, y, "text-anchor": anchor, class: "plot-label" }, value);
  const drawNumber = (value) => {
    const parsed = parseRational(value);
    return parsed ? Number(parsed.n) / Number(parsed.d) : 1;
  };
  const dims = techniqueId === "fangtian" || techniqueId === "litian"
    ? [drawNumber(parameters.width), drawNumber(parameters.length)]
    : techniqueId === "guitian" ? [drawNumber(parameters.width), drawNumber(parameters.height)]
      : techniqueId === "xietian" ? [Math.max(drawNumber(parameters.endA), drawNumber(parameters.endB)), drawNumber(parameters.height)]
        : [Math.max(drawNumber(parameters.tongue), drawNumber(parameters.heel)), drawNumber(parameters.height)];
  const scale = Math.min(205 / Math.max(1, dims[0]), 112 / Math.max(1, dims[1]));
  const width = Math.max(28, dims[0] * scale);
  const height = Math.max(24, dims[1] * scale);
  const left = (300 - width) / 2;
  const top = Math.max(22, (150 - height) / 2);
  if (techniqueId === "fangtian" || techniqueId === "litian") {
    addSvg("rect", { x: left, y: top, width, height, class: "plot-shape" });
    if (techniqueId === "litian") {
      const cols = Math.min(5, drawNumber(parameters.width));
      const rows = Math.min(5, drawNumber(parameters.length));
      for (let col = 1; col < cols; col += 1) addSvg("line", { x1: left + width * col / cols, x2: left + width * col / cols, y1: top, y2: top + height, class: "plot-gridline" });
      for (let row = 1; row < rows; row += 1) addSvg("line", { x1: left, x2: left + width, y1: top + height * row / rows, y2: top + height * row / rows, class: "plot-gridline" });
    }
    textLabel(150, top - 6, techniqueId === "litian" ? `廣 ${parameters.width} 里` : `廣 ${parameters.width} 步`);
    textLabel(150, top + height + 22, techniqueId === "litian" ? `從 ${parameters.length} 里` : `從 ${parameters.length} 步`);
  } else if (techniqueId === "guitian") {
    const points = `${left},${top + height} ${left + width},${top + height} ${left + width * 0.36},${top}`;
    addSvg("polygon", { points, class: "plot-shape" });
    textLabel(150, top + height + 22, `廣 ${parameters.width} 步`);
    textLabel(left - 8, top + height / 2, `正從 ${parameters.height}`, "end");
  } else {
    const wide = techniqueId === "xietian" ? [drawNumber(parameters.endA), drawNumber(parameters.endB)] : [drawNumber(parameters.tongue), drawNumber(parameters.heel)];
    const maxBase = Math.max(...wide);
    const topWidth = width * wide[0] / maxBase;
    const bottomWidth = width * wide[1] / maxBase;
    const topLeft = techniqueId === "xietian" ? left : left + (width - topWidth) / 2;
    const bottomLeft = techniqueId === "xietian" ? left : left + (width - bottomWidth) / 2;
    addSvg("polygon", { points: `${topLeft},${top} ${topLeft + topWidth},${top} ${bottomLeft + bottomWidth},${top + height} ${bottomLeft},${top + height}`, class: "plot-shape" });
    const firstName = techniqueId === "xietian" ? (presentation === "height-first" ? "第一畔從" : "頭廣") : "舌廣";
    const secondName = techniqueId === "xietian" ? (presentation === "height-first" ? "第二畔從" : "另一頭") : "踵廣";
    const perpendicular = presentation === "height-first" ? "正廣" : "正從";
    textLabel(150, top - 6, `${firstName} ${wide[0]} 步`);
    textLabel(150, top + height + 22, `${secondName} ${wide[1]} 步・${perpendicular} ${parameters.height} 步`);
  }
  return svg;
}

function renderField() {
  const wrapper = el("section");
  wrapper.append(titleBlock(`第 ${save.day} 官日・午間丈田`, "每日本日兩塊田；各題使用種子生成的尺寸。"));
  if (!segmentIsDone("morning")) {
    wrapper.append(el("p", { className: "empty-state", text: "先完成晨課，再開始本日丈田。" }));
    wrapper.append(button("前往晨課", () => selectView("morning"), "primary-button"));
    main.replaceChildren(wrapper);
    return;
  }
  if (!save.unlockedPlaces.includes("field")) {
    wrapper.append(el("p", { className: "empty-state", text: "完成首日晨課後，田野地點便會開啟。" }));
    wrapper.append(button("前往晨課", () => selectView("morning"), "primary-button"));
    main.replaceChildren(wrapper);
    return;
  }
  const tasks = buildFieldTasks(save, problems, mapData);
  for (const task of tasks) markSeal(save, task.techniqueId, "seen");
  persist();
  const available = getAvailableFieldTechniques(save, mapData).map((id) => techniqueFor(id).name);
  wrapper.append(el("p", { className: "eyebrow", text: `已開啟田形：${available.join("、") || "待習得"}` }));
  const cards = el("div", { className: "question-list" });
  tasks.forEach((task) => cards.append(renderAreaQuestion(task, "field", task.slot)));
  wrapper.append(cards);
  const allDone = tasks.length > 0 && tasks.every((task) => isWorkComplete(save, task.id));
  if (allDone) {
    completeSegment(save, save.day, "noon");
    persist();
    wrapper.append(el("p", { className: "notice", text: "本日丈田已登記入冊，可重溫田塊或前往民訟。", attrs: { role: "status" } }));
  } else {
    wrapper.append(el("p", { className: "eyebrow", text: `已登記 ${tasks.filter((task) => isWorkComplete(save, task.id)).length}／${tasks.length} 塊田` }));
  }
  const dayCard = renderDayCompleteCard();
  if (dayCard) wrapper.append(dayCard);
  main.replaceChildren(wrapper);
}

function renderEvening() {
  const wrapper = el("section");
  wrapper.append(titleBlock(`第 ${save.day} 官日・晚間民訟`, "每日本日一案；陳述與數字均為待教師核對的試玩草稿。"));
  if (!segmentIsDone("noon")) {
    wrapper.append(el("p", { className: "empty-state", text: "先完成午間丈田，再進入晚間民訟。" }));
    wrapper.append(button(segmentIsDone("morning") ? "前往丈田" : "先完成晨課", () => selectView(segmentIsDone("morning") ? "field" : "morning"), "primary-button"));
    main.replaceChildren(wrapper);
    return;
  }
  const caseItem = buildEveningCase(save, problems, caseTemplates);
  if (!caseItem) {
    wrapper.append(el("p", { className: "empty-state", text: "先完成一題新術，民訟便可使用已習得的術。" }));
    wrapper.append(button("前往晨課", () => selectView("morning"), "primary-button"));
    main.replaceChildren(wrapper);
    return;
  }
  for (const techniqueId of caseItem.techniqueIds) markSeal(save, techniqueId, "seen");
  persist();
  wrapper.append(renderCaseCard(caseItem));
  if (isWorkComplete(save, caseItem.id)) {
    completeSegment(save, save.day, "evening");
    persist();
    wrapper.append(el("p", { className: "notice", text: "本案已記錄，民望只增不減；你可重溫此案。", attrs: { role: "status" } }));
  }
  const dayCard = renderDayCompleteCard();
  if (dayCard) wrapper.append(dayCard);
  main.replaceChildren(wrapper);
}

function renderCaseCard(caseItem) {
  const { template, detail } = caseItem;
  const card = el("article", { className: "case-card question-card" });
  card.append(el("div", { className: "question-head" }, [
    el("div", {}, [el("p", { className: "eyebrow", text: `民訟・第 ${save.day} 官日` }), el("h3", { text: template.speaker })]),
    el("span", { className: "draft-tag", text: "情境草稿・待教師核對" }),
  ]));
  card.append(el("p", { text: template.statement }));

  if (template.type === "compare") {
    card.append(el("div", { className: "case-detail" }, [caseMeasurement("甲田", detail.first), caseMeasurement("乙田", detail.second)]));
  } else {
    card.append(caseMeasurement(template.type === "audit" ? "新丈田" : "本案田塊", detail.first));
  }
  if (template.type === "rent") {
    card.append(el("p", { className: "lesson-placeholder", text: `本案租額：每畝 ${detail.rate} 個價額單位。請先換算畝數，再核算租額。` }));
  } else if (template.type === "price") {
    card.append(el("p", { className: "lesson-placeholder", text: `本案單價：每畝 ${detail.rate} 個價額單位。請核算買田價額。` }));
  } else if (template.type === "divide") {
    card.append(el("p", { className: "lesson-placeholder", text: "兩人平均分田，請算每人所得面積。" }));
  } else if (template.type === "audit") {
    card.append(el("p", { className: "lesson-placeholder", text: `舊冊記作 ${rationalString(detail.recorded)} 平方步。請核算新丈田與舊冊數值相差多少。` }));
  }

  if (isWorkComplete(save, caseItem.id) && !redoIds.has(caseItem.id)) {
    card.append(el("p", { className: "feedback good", text: "本案已記錄，可隨時重溫。" }));
    card.append(button("重溫本案", () => { redoIds.add(caseItem.id); render(); }));
    return card;
  }
  if (caseItem.choices) {
    card.append(el("p", { text: "請判斷哪一塊田面積較大：" }));
    const choices = el("div", { className: "choice-row" });
    caseItem.choices.forEach((choice) => choices.append(button(`${choice}面積較大`, () => finishCase(caseItem, choice), "choice-button")));
    card.append(choices);
  } else {
    const field = el("input", { attrs: { id: `case-answer-${caseItem.id}`, type: "text", inputmode: "text", autocomplete: "off", "aria-label": `輸入${caseItem.unit}` } });
    const single = el("div", { className: "answer-grid single" }, [el("div", { className: "answer-field" }, [el("label", { text: caseItem.unit, attrs: { for: field.id } }), field])]);
    const fractionTools = fractionInputTools([field]);
    card.append(el("p", { className: "eyebrow", text: caseItem.answerHint }));
    card.append(el("form", { onSubmit: (event) => {
      event.preventDefault();
      const answer = parseRational(field.value);
      if (!answer) {
        showNotice("請輸入整數、分數或小數，再核算一次。");
        return;
      }
      finishCase(caseItem, answer);
    } }, [single, fractionTools, el("button", { className: "primary-button", text: "呈交核算", attrs: { type: "submit" } })]));
  }
  return card;
}

function caseMeasurement(label, item) {
  const panel = el("article", { className: "paper-card" }, [
    el("h4", { text: label }),
    el("p", { className: "problem-params", text: formatParameters(item.techniqueId, item.parameters, item.presentation) }),
    drawPlot(item.techniqueId, item.parameters, `${label}田形圖`, item.presentation),
  ]);
  return panel;
}

function finishCase(caseItem, answer) {
  const correct = caseItem.choices
    ? answer === caseItem.expected
    : answer && typeof answer === "object" && "n" in answer && compare(answer, caseItem.expected) === 0;
  if (!correct) {
    showNotice(feedbackPhrases[Math.floor(Math.random() * feedbackPhrases.length)]);
    return;
  }
  const firstCompletion = !isWorkComplete(save, caseItem.id);
  completeWork(save, caseItem.id);
  if (firstCompletion) recordCaseResolution(save, caseItem.id);
  redoIds.delete(caseItem.id);
  persist();
  showNotice("准印已蓋，本案已記錄。");
  render();
}

function renderCatalog() {
  const wrapper = el("section");
  wrapper.append(titleBlock("圖鑑・三層印信", "見聞由丈田或民訟初遇；習得與通曉以原題解答開啟。星數只在圖鑑顯示。"));
  const catalog = el("div", { className: "entry-list" });
  for (const technique of techniques) catalog.append(renderCatalogEntry(technique));
  wrapper.append(catalog);
  wrapper.append(titleBlock("成就記錄", "只展示各題最佳星數，不影響官階、地籍冊或民望。"));
  wrapper.append(renderAchievementSummary());
  main.replaceChildren(wrapper);
}

function renderCatalogEntry(technique) {
  const seal = save.seals[technique.id];
  const card = el("article", { className: "entry-card catalog-entry" });
  card.append(el("div", { className: "question-head" }, [
    el("div", {}, [el("h3", { text: technique.name }), el("p", { className: "eyebrow", text: technique.chapter })]),
    starSummary(technique),
  ]));
  const seals = el("div", { className: "seal-row", attrs: { "aria-label": "圖鑑層級狀態" } });
  for (const [key, name] of [["seen", "見聞"], ["learned", "習得"], ["understood", "通曉"]]) {
    seals.append(el("span", { className: `seal-tag${seal[key] ? " open" : ""}`, text: `${name}：${seal[key] ? "已開" : "未開"}` }));
  }
  card.append(seals);
  card.append(el("p", { text: `課程對應：${technique.courseAlignment || "待確認"}` }));
  card.append(el("p", { text: `出處與版本：${technique.source}` }));
  card.append(el("p", { className: "draft-tag", text: technique.reviewed ? "教師已核對" : "待教師核對" }));

  const fields = el("div", { className: "entry-fields" });
  if (seal.seen) {
    const first = problemFor(technique.problemIds[0]);
    fields.append(entryField("見聞・第一題原題", first ? `第 ${first.number} 題：${formatParameters(technique.id, first.parameters, first.presentation)}` : "原題待教師核對"));
    fields.append(entryField("原文", technique.originalText || "原文待教師核對"));
    fields.append(entryField("題旨", technique.topic || "題旨待教師核對"));
  } else {
    fields.append(entryField("見聞", "首次在丈田或民訟遇見此田形後開放。"));
  }
  if (seal.learned) {
    fields.append(entryField("習得・術曰", technique.algorithmText || "術曰待教師核對"));
    fields.append(entryField("白話解說", technique.plainExplanation || "白話解說待教師核對"));
    fields.append(entryField("現實用途", technique.everydayUse || "現實用途待教師核對"));
  } else {
    fields.append(entryField("習得", "解出晨課第一題後開放。"));
  }
  if (seal.understood) {
    fields.append(entryField("劉徽注", technique.liHuiNote || "劉徽注待教師核對"));
    fields.append(entryField("李淳風按語", technique.liChunfengNote || "李淳風按語待教師核對"));
  } else {
    fields.append(entryField("通曉", "不使用提示解出該術第二題後開放。"));
  }
  card.append(fields);

  if (seal.learned) {
    const second = problemFor(technique.problemIds[1]);
    if (second) {
      const challengeId = `mastery-${second.id}`;
      const solved = seal.understood && !redoIds.has(challengeId);
      card.append(button(solved ? "重溫通曉原題" : "嘗試通曉原題", () => {
        if (solved) redoIds.add(challengeId);
        render();
        document.getElementById(`mastery-card-${technique.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      }));
      if (!solved || redoIds.has(challengeId)) card.append(renderMasteryChallenge(technique, second));
    }
  }
  return card;
}

function entryField(title, body) {
  return el("section", { className: "entry-field" }, [el("h4", { text: title }), el("p", { text: body })]);
}

function starSummary(technique) {
  const scores = technique.problemIds.map((id) => save.stars[id] ?? 0);
  const total = scores.reduce((sum, score) => sum + score, 0);
  const maximum = technique.problemIds.length * CONFIG.starRules.startingStars;
  const stars = el("span", { className: "star-summary", attrs: { "aria-label": `最佳星數 ${total}／${maximum}` } });
  stars.append(document.createTextNode(`${"★".repeat(Math.min(total, 12))}${"☆".repeat(Math.max(0, Math.min(maximum - total, 12)))} `));
  stars.append(el("span", { className: "eyebrow", text: `${total}/${maximum}` }));
  return stars;
}

function renderAchievementSummary() {
  const scores = Object.values(save.stars);
  const total = scores.reduce((sum, score) => sum + score, 0);
  return el("article", { className: "paper-card catalog-entry" }, [
    el("p", { text: `累積最佳星數：${total}` }),
    el("p", { text: `已見聞 ${TECHNIQUE_IDS.filter((id) => save.seals[id].seen).length} 術・已習得 ${TECHNIQUE_IDS.filter((id) => save.seals[id].learned).length} 術・已通曉 ${TECHNIQUE_IDS.filter((id) => save.seals[id].understood).length} 術` }),
  ]);
}

function renderMasteryChallenge(technique, problem) {
  const challengeId = `mastery-${problem.id}`;
  const card = el("article", { className: "question-card", attrs: { id: `mastery-card-${technique.id}` } }, [
    el("p", { className: "eyebrow", text: "通曉・不用提示" }),
    el("h4", { text: `${technique.name}・原題第 ${problem.number} 題` }),
    el("p", { className: "problem-params", text: formatParameters(technique.id, problem.parameters, problem.presentation) }),
    drawPlot(technique.id, problem.parameters, `${technique.name}通曉題田形圖`, problem.presentation),
  ]);
  if (save.seals[technique.id].understood && !redoIds.has(challengeId)) {
    card.append(el("p", { className: "feedback good", text: "通曉印信已記錄，可隨時再做。" }));
    card.append(button("再做一次", () => { redoIds.add(challengeId); render(); document.getElementById(`mastery-card-${technique.id}`)?.scrollIntoView({ block: "center" }); }));
    return card;
  }
  const fields = areaInputs(challengeId);
  card.append(el("form", { onSubmit: (event) => {
    event.preventDefault();
    const answer = parseAreaAnswer({ qing: fields.qing.value, mu: fields.mu.value, bu: fields.bu.value });
    if (!answer) {
      showNotice("請在頃、畝、步其中一欄輸入數值。");
      return;
    }
    const expected = calculateArea(technique.id, problem.parameters);
    if (!sameValue(answer, expected)) {
      showNotice(feedbackPhrases[Math.floor(Math.random() * feedbackPhrases.length)]);
      return;
    }
    markSeal(save, technique.id, "understood");
    completeWork(save, challengeId);
    recordStars(save, problem.id, CONFIG.starRules.startingStars);
    redoIds.delete(challengeId);
    persist();
    showNotice("通曉印信已記錄。");
    render();
  } }, [fields.wrapper, fields.tools, el("button", { className: "primary-button", text: "呈交原題", attrs: { type: "submit" } })]));
  return card;
}

function render() {
  navButtons.forEach((item) => {
    if (item.dataset.view === activeView) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  if (activeView === "morning") renderMorning();
  else if (activeView === "field") renderField();
  else if (activeView === "evening") renderEvening();
  else if (activeView === "catalog") renderCatalog();
  else renderHome();
  updateStorageStatus();
}

navButtons.forEach((item) => item.addEventListener("click", () => selectView(item.dataset.view)));
document.querySelector("#export-save").addEventListener("click", () => {
  const data = encodeSave(save);
  if (!data) {
    showNotice("目前進度未能匯出，請再試一次。");
    return;
  }
  const file = new Blob([data], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = el("a", { attrs: { href: url, download: `長安倉曹進度-第${save.day}官日.json` } });
  link.click();
  URL.revokeObjectURL(url);
  showNotice("進度檔已匯出。");
});
document.querySelector("#import-save").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const incoming = decodeSave(await file.text());
    if (!incoming) {
      showNotice("此檔案內容未能讀取，現有進度已保留。");
    } else {
      save = mergeSaves(save, incoming);
      persist();
      showNotice("進度檔已合併，較高的累積記錄已保留。");
      render();
    }
  } catch {
    showNotice("此檔案內容未能讀取，現有進度已保留。");
  } finally {
    event.target.value = "";
  }
});

const themeToggle = document.querySelector("#theme-toggle");
try {
  const storedTheme = localStorage.getItem("chang-an-theme");
  if (storedTheme === "dark" || storedTheme === "light") document.documentElement.dataset.theme = storedTheme;
} catch { /* 主題設定留在本次開啟期間 */ }
themeToggle.addEventListener("click", () => {
  const currentTheme = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("chang-an-theme", next); } catch { /* 主題設定留在本次開啟期間 */ }
});

if (!loaded.persistent) showNotice("瀏覽器本機存檔目前未啟用，記得匯出進度備份。");
if (loaded.recovered) showNotice("原進度資料未能讀取，已建立新進度。");
render();
