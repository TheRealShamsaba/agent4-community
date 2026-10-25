const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "have", "in", "into", "is", "it", "make", "my",
  "of", "on", "one", "our", "that", "the", "this", "three", "to", "two", "we", "week", "with"
]);

const CONCEPT_GROUPS = [
  ["sales", "book", "call", "client", "conversation", "customer", "deal", "lead", "meeting", "outreach", "proposal", "prospect", "revenue"],
  ["content", "instagram", "linkedin", "post", "publish", "social", "write", "writing"],
  ["product", "app", "bot", "build", "design", "develop", "feature", "launch", "product", "ship", "website"],
  ["money", "cash", "cost", "finance", "invoice", "money", "paid", "payment"],
  ["team", "assign", "culture", "hire", "partner", "people", "team"],
  ["growth", "acquire", "audience", "convert", "growth", "market", "traffic"]
];

function stem(value) {
  const token = String(value || "").toLowerCase();
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function concepts(value) {
  const tokens = String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map(stem)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  const result = new Set(tokens);
  for (const [group, ...members] of CONCEPT_GROUPS) {
    if (members.some((member) => result.has(stem(member)))) result.add(group);
  }
  return result;
}

function dateDistance(date, today) {
  if (!date) return null;
  const difference = Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`);
  return Number.isFinite(difference) ? Math.round(difference / 86400000) : null;
}

function taskReason(task, { aligned, distance }) {
  if (aligned) return "Moves the weekly target";
  if (distance != null && distance < 0) return "Protects an overdue commitment";
  if (distance === 0) return "Due today";
  if (task.status === "doing") return "Already in motion";
  if (task.priority === "high") return "High-priority commitment";
  if (distance != null && distance <= 7) return "Due this week";
  return "Best available move";
}

function rankTask(task, targetConcepts, today) {
  const taskConcepts = concepts([task.title, task.project, task.notes, task.kind, task.source].filter(Boolean).join(" "));
  const overlap = [...targetConcepts].filter((token) => taskConcepts.has(token)).length;
  const aligned = targetConcepts.size > 0 && overlap > 0;
  const distance = dateDistance(task.dueOn, today);
  let urgency = 0;
  if (task.status === "doing") urgency += 18;
  if (task.priority === "high") urgency += 14;
  if (distance != null && distance < 0) urgency += 28 + Math.min(10, Math.abs(distance));
  else if (distance === 0) urgency += 24;
  else if (distance != null && distance <= 2) urgency += 15;
  else if (distance != null && distance <= 7) urgency += 8;
  return {
    ...task,
    aligned,
    reason: taskReason(task, { aligned, distance }),
    alignmentScore: overlap * 40,
    urgencyScore: urgency
  };
}

function publicMove(task) {
  return {
    id: task.id,
    title: task.title,
    project: task.project || null,
    source: task.source || "hq",
    dueOn: task.dueOn || null,
    status: task.status || "open",
    priority: task.priority || "normal",
    aligned: task.aligned,
    reason: task.reason
  };
}

export function buildWeeklyGamePlan({ today, review = null, tasks = [], targetWeekStart = null } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ""))) throw new Error("Weekly game plan needs a valid day.");
  const target = String(review?.nextFocus || "").trim();
  const targetConcepts = concepts(target);
  const ranked = (tasks || [])
    .filter((task) => task?.id && task?.title && task.status !== "done")
    .map((task) => rankTask(task, targetConcepts, today));
  const aligned = ranked
    .filter((task) => task.aligned)
    .sort((left, right) => right.alignmentScore - left.alignmentScore || right.urgencyScore - left.urgencyScore || left.title.localeCompare(right.title));
  const obligations = ranked
    .filter((task) => !task.aligned)
    .sort((left, right) => right.urgencyScore - left.urgencyScore || String(left.dueOn || "9999-12-31").localeCompare(String(right.dueOn || "9999-12-31")) || left.title.localeCompare(right.title));
  const selected = [...aligned.slice(0, 3)];
  for (const task of obligations) {
    if (selected.length >= 3) break;
    selected.push(task);
  }
  const moves = selected.map(publicMove);
  const needsTarget = !target;
  const needsGoalTask = Boolean(target) && aligned.length === 0;
  const guidance = needsTarget
    ? "Urgent work is ranked for now. Lock one weekly outcome so Agent4 can judge what actually matters."
    : needsGoalTask
      ? "Nothing on the board clearly supports this target yet. Capture the first concrete move before doing more busywork."
      : `${Math.min(3, aligned.length)} ${aligned.length === 1 ? "move points" : "moves point"} directly at the weekly target.`;
  return {
    target,
    targetWeekStart: targetWeekStart || null,
    needsTarget,
    needsGoalTask,
    guidance,
    primaryMove: moves[0] || null,
    moves,
    alignedCount: aligned.length,
    obligationCount: obligations.filter((task) => task.urgencyScore > 0).length
  };
}
