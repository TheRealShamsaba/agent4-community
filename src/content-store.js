import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const PLATFORMS = new Set(["instagram", "linkedin"]);
const STATUSES = new Set(["idea", "draft", "ready", "scheduled", "published"]);
const FORMATS = new Set(["post", "carousel", "reel", "story", "article", "video"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, limit = 300) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeDate(value, label = "Date") {
  const date = text(value, 10);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), `${label} must be a YYYY-MM-DD date.`);
  assert(!Number.isNaN(Date.parse(`${date}T12:00:00Z`)), `${label} is not a real date.`);
  return date;
}

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekBounds(today) {
  const value = new Date(`${today}T12:00:00Z`);
  const sinceMonday = value.getUTCDay() === 0 ? 6 : value.getUTCDay() - 1;
  const start = shiftDate(today, -sinceMonday);
  return { start, end: shiftDate(start, 6) };
}

function postFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    format: row.format,
    status: row.status,
    plannedOn: row.planned_on || null,
    caption: row.caption || "",
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at || null,
    publishedAt: row.published_at || null,
    publishedOn: row.published_on || null
  };
}

export function createContentStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_social_posts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL,
      planned_on TEXT,
      caption TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT,
      published_at TEXT,
      published_on TEXT
    );
    CREATE INDEX IF NOT EXISTS social_posts_owner ON agent4_social_posts(created_by, status, planned_on);
    CREATE INDEX IF NOT EXISTS social_posts_published ON agent4_social_posts(created_by, published_on);
    CREATE TABLE IF NOT EXISTS agent4_content_goals (
      actor_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      weekly_target INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (actor_id, platform)
    );
    CREATE TABLE IF NOT EXISTS agent4_daily_checkins (
      actor_id TEXT NOT NULL,
      day TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (actor_id, day)
    );
    CREATE TABLE IF NOT EXISTS agent4_content_cadence (
      actor_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      started_on TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (actor_id, platform)
    );
  `);

  const selectPost = database.prepare("SELECT * FROM agent4_social_posts WHERE id = ?");

  function createPost(input = {}) {
    const title = text(input.title, 240);
    const platform = text(input.platform).toLowerCase();
    const format = text(input.format || "post").toLowerCase();
    const status = text(input.status || "idea").toLowerCase();
    assert(title, "A post needs a working title.");
    assert(PLATFORMS.has(platform), "Platform must be Instagram or LinkedIn.");
    assert(FORMATS.has(format), "Choose a supported content format.");
    assert(STATUSES.has(status), "Choose a valid publishing status.");
    const now = new Date().toISOString();
    const publishedOn = status === "published"
      ? normalizeDate(input.publishedOn || now.slice(0, 10), "Published date")
      : null;
    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_social_posts
        (id,title,platform,format,status,planned_on,caption,created_at,created_by,published_at,published_on)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      title,
      platform,
      format,
      status,
      input.plannedOn ? normalizeDate(input.plannedOn, "Planned date") : null,
      text(input.caption, 5000),
      now,
      text(input.actorId, 140) || "unknown",
      publishedOn ? now : null,
      publishedOn
    );
    return postFrom(selectPost.get(id));
  }

  function updatePost(id, updates = {}, actorId) {
    const existing = selectPost.get(String(id || ""));
    assert(existing, "That post no longer exists.");
    assert(!actorId || existing.created_by === String(actorId), "That post belongs to someone else.");
    const next = {
      title: updates.title === undefined ? existing.title : text(updates.title, 240),
      platform: updates.platform === undefined ? existing.platform : text(updates.platform).toLowerCase(),
      format: updates.format === undefined ? existing.format : text(updates.format).toLowerCase(),
      status: updates.status === undefined ? existing.status : text(updates.status).toLowerCase(),
      plannedOn: updates.plannedOn === undefined
        ? existing.planned_on
        : updates.plannedOn ? normalizeDate(updates.plannedOn, "Planned date") : null,
      caption: updates.caption === undefined ? existing.caption : text(updates.caption, 5000)
    };
    assert(next.title, "A post needs a working title.");
    assert(PLATFORMS.has(next.platform), "Platform must be Instagram or LinkedIn.");
    assert(FORMATS.has(next.format), "Choose a supported content format.");
    assert(STATUSES.has(next.status), "Choose a valid publishing status.");
    const publishingNow = next.status === "published" && existing.status !== "published";
    const publishedOn = next.status === "published"
      ? updates.publishedOn
        ? normalizeDate(updates.publishedOn, "Published date")
        : existing.published_on || new Date().toISOString().slice(0, 10)
      : null;
    const publishedAt = next.status === "published"
      ? existing.published_at || new Date().toISOString()
      : null;
    database.prepare(`
      UPDATE agent4_social_posts
      SET title=?,platform=?,format=?,status=?,planned_on=?,caption=?,updated_at=?,published_at=?,published_on=?
      WHERE id=?
    `).run(
      next.title,
      next.platform,
      next.format,
      next.status,
      next.plannedOn,
      next.caption,
      new Date().toISOString(),
      publishingNow ? new Date().toISOString() : publishedAt,
      publishedOn,
      existing.id
    );
    return postFrom(selectPost.get(existing.id));
  }

  function removePost(id, actorId) {
    const existing = selectPost.get(String(id || ""));
    if (!existing) return false;
    assert(!actorId || existing.created_by === String(actorId), "That post belongs to someone else.");
    const result = database.prepare("DELETE FROM agent4_social_posts WHERE id = ?").run(existing.id);
    return result.changes > 0;
  }

  function listPosts({ actorId, platform, status, from, to, limit = 500 } = {}) {
    const clauses = [];
    const values = [];
    if (actorId) {
      clauses.push("created_by = ?");
      values.push(String(actorId));
    }
    if (platform) {
      const normalized = text(platform).toLowerCase();
      assert(PLATFORMS.has(normalized), "Platform must be Instagram or LinkedIn.");
      clauses.push("platform = ?");
      values.push(normalized);
    }
    if (status) {
      const normalized = text(status).toLowerCase();
      assert(STATUSES.has(normalized), "Choose a valid publishing status.");
      clauses.push("status = ?");
      values.push(normalized);
    }
    if (from) {
      clauses.push("COALESCE(planned_on, published_on, substr(created_at,1,10)) >= ?");
      values.push(normalizeDate(from, "From date"));
    }
    if (to) {
      clauses.push("COALESCE(planned_on, published_on, substr(created_at,1,10)) <= ?");
      values.push(normalizeDate(to, "To date"));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const capped = Math.max(1, Math.min(1000, Number(limit) || 500));
    return database.prepare(`
      SELECT * FROM agent4_social_posts ${where}
      ORDER BY CASE status WHEN 'scheduled' THEN 0 WHEN 'ready' THEN 1 WHEN 'draft' THEN 2 WHEN 'idea' THEN 3 ELSE 4 END,
        COALESCE(planned_on, published_on, substr(created_at,1,10)) ASC,
        created_at DESC
      LIMIT ?
    `).all(...values, capped).map(postFrom);
  }

  function goals(actorId) {
    const id = String(actorId || "unknown");
    const saved = new Map(database.prepare("SELECT platform, weekly_target FROM agent4_content_goals WHERE actor_id = ?").all(id)
      .map((row) => [row.platform, Number(row.weekly_target)]));
    return {
      instagram: saved.get("instagram") ?? 7,
      linkedin: saved.get("linkedin") ?? 7
    };
  }

  function setGoal(actorId, platform, weeklyTarget) {
    const id = String(actorId || "unknown");
    const normalized = text(platform).toLowerCase();
    const target = Number(weeklyTarget);
    assert(PLATFORMS.has(normalized), "Platform must be Instagram or LinkedIn.");
    assert(Number.isInteger(target) && target >= 0 && target <= 30, "Weekly target must be between 0 and 30.");
    database.prepare(`
      INSERT INTO agent4_content_goals (actor_id,platform,weekly_target,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(actor_id,platform) DO UPDATE SET weekly_target=excluded.weekly_target, updated_at=excluded.updated_at
    `).run(id, normalized, target, new Date().toISOString());
    return goals(id);
  }

  function dailyCadence(actorId, platform, today, days = 28) {
    const id = String(actorId || "unknown");
    const length = Math.max(7, Math.min(84, Number(days) || 28));
    let tracking = database.prepare("SELECT started_on FROM agent4_content_cadence WHERE actor_id = ? AND platform = ?").get(id, platform);
    if (!tracking) {
      const firstPublished = database.prepare(`
        SELECT MIN(published_on) AS day FROM agent4_social_posts
        WHERE created_by = ? AND platform = ? AND status = 'published' AND published_on IS NOT NULL
      `).get(id, platform)?.day;
      const startedOn = firstPublished && firstPublished <= today ? firstPublished : today;
      database.prepare(`
        INSERT OR IGNORE INTO agent4_content_cadence (actor_id,platform,started_on,created_at) VALUES (?,?,?,?)
      `).run(id, platform, startedOn, new Date().toISOString());
      tracking = { started_on: startedOn };
    }
    const rows = database.prepare(`
      SELECT published_on AS day, COUNT(*) AS count FROM agent4_social_posts
      WHERE created_by = ? AND platform = ? AND status = 'published' AND published_on IS NOT NULL
      GROUP BY published_on
    `).all(id, platform);
    const published = new Map(rows.map((row) => [row.day, Number(row.count)]));
    const start = shiftDate(today, -(length - 1));
    const daily = [];
    for (let index = 0; index < length; index += 1) {
      const day = shiftDate(start, index);
      const count = published.get(day) || 0;
      const status = day < tracking.started_on
        ? "off"
        : count
          ? "posted"
          : day === today
            ? "pending"
            : day < today ? "missed" : "future";
      daily.push({ day, count, status });
    }
    let streak = 0;
    let cursor = published.has(today) ? today : shiftDate(today, -1);
    while (cursor >= tracking.started_on && published.has(cursor)) {
      streak += 1;
      cursor = shiftDate(cursor, -1);
    }
    let longestStreak = 0;
    let running = 0;
    for (let cursorDay = tracking.started_on, guard = 0; cursorDay <= today && guard < 3650; cursorDay = shiftDate(cursorDay, 1), guard += 1) {
      running = published.has(cursorDay) ? running + 1 : 0;
      longestStreak = Math.max(longestStreak, running);
    }
    return {
      startedOn: tracking.started_on,
      streak,
      longestStreak,
      missed: daily.filter((item) => item.status === "missed").length,
      daily
    };
  }

  function contentSummary({ actorId, today = new Date().toISOString().slice(0, 10), cadenceDays = 28 } = {}) {
    const day = normalizeDate(today, "Today");
    const { start, end } = weekBounds(day);
    const targets = goals(actorId);
    const posts = listPosts({ actorId, limit: 1000 });
    const platforms = {};
    for (const platform of PLATFORMS) {
      const relevant = posts.filter((post) => post.platform === platform);
      const published = relevant.filter((post) => post.status === "published" && post.publishedOn >= start && post.publishedOn <= end).length;
      const planned = relevant.filter((post) => post.status !== "published" && post.plannedOn >= start && post.plannedOn <= end).length;
      platforms[platform] = { target: targets[platform], published, planned, ...dailyCadence(actorId, platform, day, cadenceDays) };
    }
    const next = posts
      .filter((post) => post.status !== "published" && post.plannedOn && post.plannedOn >= day)
      .sort((left, right) => left.plannedOn.localeCompare(right.plannedOn))[0] || null;
    return { week: { start, end }, platforms, next, total: posts.length };
  }

  function checkIn(actorId, today = new Date().toISOString().slice(0, 10)) {
    const id = String(actorId || "unknown");
    const day = normalizeDate(today, "Today");
    const result = database.prepare(`
      INSERT OR IGNORE INTO agent4_daily_checkins (actor_id,day,created_at) VALUES (?,?,?)
    `).run(id, day, new Date().toISOString());
    return { day, checkedIn: true, firstToday: result.changes > 0 };
  }

  function momentum({ actorId, tasks = [], today = new Date().toISOString().slice(0, 10), days = 35 } = {}) {
    const id = String(actorId || "unknown");
    const day = normalizeDate(today, "Today");
    const length = Math.max(7, Math.min(70, Number(days) || 35));
    const start = shiftDate(day, -(length - 1));
    const activity = new Map();
    const ensure = (date) => {
      if (!activity.has(date)) activity.set(date, { day: date, checkIns: 0, tasks: 0, posts: 0, points: 0 });
      return activity.get(date);
    };
    const checkIns = database.prepare("SELECT day FROM agent4_daily_checkins WHERE actor_id = ?").all(id);
    checkIns.forEach((row) => {
      const item = ensure(row.day);
      item.checkIns = 1;
      item.points += 1;
    });
    const published = database.prepare("SELECT published_on FROM agent4_social_posts WHERE created_by = ? AND status = 'published' AND published_on IS NOT NULL").all(id);
    published.forEach((row) => {
      const item = ensure(row.published_on);
      item.posts += 1;
      item.points += 5;
    });
    tasks.filter((task) => task.assigneeId === id && task.completedAt).forEach((task) => {
      const completedOn = String(task.completedAt).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(completedOn)) return;
      const item = ensure(completedOn);
      item.tasks += 1;
      item.points += 3;
    });

    const contributions = [];
    for (let index = 0; index < length; index += 1) contributions.push(ensure(shiftDate(start, index)));
    let streak = 0;
    for (let cursor = day; activity.get(cursor)?.points > 0; cursor = shiftDate(cursor, -1)) streak += 1;
    const { start: weekStart, end: weekEnd } = weekBounds(day);
    const weeklyPoints = [...activity.values()]
      .filter((item) => item.day >= weekStart && item.day <= weekEnd)
      .reduce((sum, item) => sum + item.points, 0);
    const allTimePoints = [...activity.values()].reduce((sum, item) => sum + item.points, 0);
    const level = Math.floor(allTimePoints / 50) + 1;
    const levelNames = ["Starting line", "In motion", "Locked in", "Heavy hitter", "Unstoppable"];
    const weeklyGoal = 35;
    return {
      today: day,
      checkedIn: Boolean(activity.get(day)?.checkIns),
      streak,
      weeklyPoints,
      weeklyGoal,
      weeklyUnlocked: weeklyPoints >= weeklyGoal,
      level,
      levelName: levelNames[Math.min(levelNames.length - 1, level - 1)],
      levelPoints: allTimePoints % 50,
      nextLevelAt: 50,
      allTimePoints,
      contributions
    };
  }

  function close() {
    database.close();
  }

  return {
    createPost,
    updatePost,
    removePost,
    listPosts,
    goals,
    setGoal,
    contentSummary,
    checkIn,
    momentum,
    close
  };
}
