import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localIsoDate } from "./local-date.js";

/**
 * The team's work. Unlike the books, tasks are shared: everyone sees the whole
 * board, because the point of writing a task down in a company of friends is
 * that somebody else can pick it up.
 *
 * A task always belongs to someone or to nobody — never to "the team", which is
 * how work quietly stops being anyone's problem.
 */

const STATUSES = new Set(["open", "doing", "done"]);
const PRIORITIES = new Set(["low", "normal", "high"]);
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, limit = 300) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeDate(value, label) {
  const date = String(value || "").trim();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), `${label} must be a YYYY-MM-DD date.`);
  return date;
}

function taskFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    notes: row.notes || "",
    assigneeId: row.assignee_id || null,
    status: row.status,
    priority: row.priority,
    dueOn: row.due_on || null,
    project: row.project || "",
    projectId: row.project_id || null,
    companyId: row.company_id || null,
    companyName: row.company_name || "",
    sourceKey: row.source_key || null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at || null,
    completedAt: row.completed_at || null
  };
}

function commentFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    body: row.body,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

export function createTaskStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      assignee_id TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_on TEXT,
      project TEXT,
      project_id TEXT,
      company_id TEXT,
      company_name TEXT,
      source_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS tasks_assignee ON agent4_tasks(assignee_id, status);
    CREATE INDEX IF NOT EXISTS tasks_due ON agent4_tasks(status, due_on);
    CREATE TABLE IF NOT EXISTS agent4_task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS task_comments_task ON agent4_task_comments(task_id, created_at);
  `);
  const taskColumns = new Set(database.prepare("PRAGMA table_info(agent4_tasks)").all().map((row) => row.name));
  if (!taskColumns.has("project_id")) database.exec("ALTER TABLE agent4_tasks ADD COLUMN project_id TEXT");
  if (!taskColumns.has("company_id")) database.exec("ALTER TABLE agent4_tasks ADD COLUMN company_id TEXT");
  if (!taskColumns.has("company_name")) database.exec("ALTER TABLE agent4_tasks ADD COLUMN company_name TEXT");

  const selectTask = database.prepare("SELECT * FROM agent4_tasks WHERE id = ?");

  function createTask(input = {}) {
    const title = text(input.title, 240);
    assert(title, "A task needs a title.");
    const status = text(input.status) || "open";
    const priority = text(input.priority) || "normal";
    assert(STATUSES.has(status), "Status must be open, doing or done.");
    assert(PRIORITIES.has(priority), "Priority must be low, normal or high.");

    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_tasks
        (id,title,notes,assignee_id,status,priority,due_on,project,project_id,company_id,company_name,source_key,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, title, text(input.notes, 2000), text(input.assigneeId, 140) || null, status, priority,
      input.dueOn ? normalizeDate(input.dueOn, "Due date") : null,
      text(input.project, 140), text(input.projectId, 140) || null,
      text(input.companyId, 140) || null, text(input.companyName, 180),
      text(input.sourceKey, 200) || null,
      new Date().toISOString(), text(input.actorId, 140) || "unknown"
    );
    return taskFrom(selectTask.get(id));
  }

  function updateTask(id, updates = {}) {
    const existing = selectTask.get(String(id || ""));
    assert(existing, "That task no longer exists.");
    const next = {
      title: updates.title === undefined ? existing.title : text(updates.title, 240),
      notes: updates.notes === undefined ? existing.notes : text(updates.notes, 2000),
      assigneeId: updates.assigneeId === undefined
        ? existing.assignee_id
        : (text(updates.assigneeId, 140) || null),
      status: updates.status === undefined ? existing.status : text(updates.status),
      priority: updates.priority === undefined ? existing.priority : text(updates.priority),
      dueOn: updates.dueOn === undefined
        ? existing.due_on
        : (updates.dueOn ? normalizeDate(updates.dueOn, "Due date") : null),
      project: updates.project === undefined ? existing.project : text(updates.project, 140),
      projectId: updates.projectId === undefined ? existing.project_id : (text(updates.projectId, 140) || null),
      companyId: updates.companyId === undefined ? existing.company_id : (text(updates.companyId, 140) || null),
      companyName: updates.companyName === undefined ? existing.company_name : text(updates.companyName, 180)
    };
    assert(next.title, "A task needs a title.");
    assert(STATUSES.has(next.status), "Status must be open, doing or done.");
    assert(PRIORITIES.has(next.priority), "Priority must be low, normal or high.");

    // Finishing stamps the time; reopening clears it, so "done today" stays true.
    const completedAt = next.status === "done"
      ? existing.completed_at || new Date().toISOString()
      : null;

    database.prepare(`
      UPDATE agent4_tasks
      SET title=?,notes=?,assignee_id=?,status=?,priority=?,due_on=?,project=?,project_id=?,company_id=?,company_name=?,updated_at=?,completed_at=?
      WHERE id=?
    `).run(
      next.title, next.notes, next.assigneeId, next.status, next.priority, next.dueOn,
      next.project, next.projectId, next.companyId, next.companyName,
      new Date().toISOString(), completedAt, existing.id
    );
    return taskFrom(selectTask.get(existing.id));
  }

  function removeTask(id) {
    const existing = selectTask.get(String(id || ""));
    if (!existing) return false;
    database.prepare("DELETE FROM agent4_task_comments WHERE task_id = ?").run(existing.id);
    database.prepare("DELETE FROM agent4_tasks WHERE id = ?").run(existing.id);
    return true;
  }

  function listComments(taskId) {
    const id = String(taskId || "");
    assert(selectTask.get(id), "That task no longer exists.");
    return database.prepare(`
      SELECT * FROM agent4_task_comments
      WHERE task_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(id).map(commentFrom);
  }

  function addComment(taskId, input = {}) {
    const id = String(taskId || "");
    assert(selectTask.get(id), "That task no longer exists.");
    const body = text(input.body, 2000);
    assert(body, "A comment cannot be empty.");
    const commentId = randomUUID();
    database.prepare(`
      INSERT INTO agent4_task_comments (id,task_id,body,created_at,created_by)
      VALUES (?,?,?,?,?)
    `).run(
      commentId,
      id,
      body,
      new Date().toISOString(),
      text(input.actorId, 140) || "unknown"
    );
    return commentFrom(database.prepare("SELECT * FROM agent4_task_comments WHERE id = ?").get(commentId));
  }

  /**
   * Finished work last, then late first, then soonest due, then priority. What
   * is late is what matters, but only while it is still somebody's to do.
   */
  function order(tasks, todayIso) {
    return [...tasks].sort((left, right) => {
      const leftDone = left.status === "done" ? 1 : 0;
      const rightDone = right.status === "done" ? 1 : 0;
      if (leftDone !== rightDone) return leftDone - rightDone;
      const leftLate = left.dueOn && left.dueOn < todayIso ? 0 : 1;
      const rightLate = right.dueOn && right.dueOn < todayIso ? 0 : 1;
      if (leftLate !== rightLate) return leftLate - rightLate;
      const leftDue = left.dueOn || "9999-12-31";
      const rightDue = right.dueOn || "9999-12-31";
      if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
      const byPriority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
      if (byPriority !== 0) return byPriority;
      return String(left.createdAt).localeCompare(String(right.createdAt));
    });
  }

  /**
   * The board, and an honest account of what it left out. Without an ORDER BY
   * the cap took whatever rows SQLite happened to reach first, so a board that
   * asked for finished work too could spend its whole budget on tasks nobody
   * needs to look at and quietly drop the open ones.
   *
   * Finished work is therefore kept to a recent window by default: a task done
   * last spring is history, not board space. Ask for more with doneWithinDays,
   * or for all of it with doneWithinDays: null.
   */
  function queryTasks({
    assigneeId,
    status,
    includeDone = false,
    doneWithinDays = 14,
    today = new Date(),
    limit = 300
  } = {}) {
    const todayIso = localIsoDate(today);
    const clauses = [];
    const values = [];
    if (assigneeId === null) clauses.push("assignee_id IS NULL");
    else if (assigneeId !== undefined) {
      clauses.push("assignee_id = ?");
      values.push(String(assigneeId));
    }
    if (status) {
      assert(STATUSES.has(status), "Status must be open, doing or done.");
      clauses.push("status = ?");
      values.push(status);
    } else if (!includeDone) {
      clauses.push("status != 'done'");
    }
    if (!status && includeDone && doneWithinDays !== null) {
      const days = Math.max(0, Number(doneWithinDays) || 0);
      const since = new Date(`${todayIso}T00:00:00Z`);
      since.setUTCDate(since.getUTCDate() - days);
      clauses.push("(status != 'done' OR COALESCE(substr(completed_at, 1, 10), '') >= ?)");
      values.push(since.toISOString().slice(0, 10));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const capped = Math.max(1, Math.min(1000, Number(limit) || 300));
    // Open work first, then what is due soonest, then the oldest — so the rows
    // the cap keeps are always the rows the board most needs.
    const rows = database.prepare(`
      SELECT * FROM agent4_tasks ${where}
      ORDER BY
        CASE status WHEN 'doing' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
        CASE WHEN due_on IS NULL OR due_on = '' THEN 1 ELSE 0 END,
        due_on ASC,
        created_at ASC,
        id ASC
      LIMIT ?
    `).all(...values, capped);
    const total = database.prepare(`SELECT COUNT(*) AS total FROM agent4_tasks ${where}`).get(...values).total;
    return { tasks: order(rows.map(taskFrom), todayIso), total, truncated: total > rows.length };
  }

  /**
   * The plain list every other part of the system reads. It keeps the whole
   * history by default, because a Telegram button pressed on a task finished a
   * month ago must still find it; the board asks for the recent window instead.
   */
  function listTasks(options = {}) {
    return queryTasks({ doneWithinDays: null, ...options }).tasks;
  }

  /**
   * What each person is carrying. Unassigned work is reported under its own
   * heading rather than hidden, because nobody picking it up is the problem
   * worth seeing.
   */
  function workload({ today = new Date() } = {}) {
    const todayIso = localIsoDate(today);
    const buckets = new Map();
    const ensure = (key) => {
      if (!buckets.has(key)) {
        buckets.set(key, { assigneeId: key, open: 0, doing: 0, dueToday: 0, overdue: 0, done7: 0 });
      }
      return buckets.get(key);
    };

    for (const row of database.prepare("SELECT * FROM agent4_tasks").all()) {
      const task = taskFrom(row);
      const bucket = ensure(task.assigneeId);
      if (task.status === "done") {
        const days = (Date.parse(todayIso) - Date.parse(String(task.completedAt || "").slice(0, 10) || todayIso)) / 86400000;
        if (days >= 0 && days <= 7) bucket.done7 += 1;
        continue;
      }
      if (task.status === "doing") bucket.doing += 1;
      else bucket.open += 1;
      if (task.dueOn && task.dueOn < todayIso) bucket.overdue += 1;
      else if (task.dueOn === todayIso) bucket.dueToday += 1;
    }

    return [...buckets.values()].sort((left, right) =>
      (right.overdue - left.overdue) || (right.open + right.doing - left.open - left.doing));
  }

  /**
   * Brings a follow-up that AGENT4 generated into the team's board, once. The
   * agent keeps producing its own list; this is the moment a person takes one
   * on, so it must not create a second copy each time the pipeline runs.
   */
  function adopt(input = {}) {
    const sourceKey = text(input.sourceKey, 200);
    assert(sourceKey, "An adopted task needs the key of what it came from.");
    const existing = database.prepare("SELECT * FROM agent4_tasks WHERE source_key = ?").get(sourceKey);
    if (existing) return { task: taskFrom(existing), adopted: false };
    return { task: createTask({ ...input, sourceKey }), adopted: true };
  }

  function close() {
    database.close();
  }

  return { createTask, updateTask, removeTask, listTasks, queryTasks, workload, listComments, addComment, adopt, close };
}
