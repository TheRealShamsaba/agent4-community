import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createContentStore } from "../src/content-store.js";

async function withStore(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-content-"));
  const store = createContentStore(path.join(directory, "rooms.sqlite"));
  try {
    await run(store);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("content posts move from idea to published and keep the publish day", async () => {
  await withStore((store) => {
    const idea = store.createPost({
      title: "Why good dashboards fail",
      platform: "linkedin",
      format: "post",
      plannedOn: "2026-08-31",
      actorId: "alex"
    });
    assert.equal(idea.status, "idea");
    assert.equal(idea.publishedOn, null);

    const published = store.updatePost(idea.id, { status: "published", publishedOn: "2026-08-30" });
    assert.equal(published.status, "published");
    assert.equal(published.publishedOn, "2026-08-30");
    assert.ok(published.publishedAt);

    const reopened = store.updatePost(idea.id, { status: "draft" });
    assert.equal(reopened.publishedOn, null);
    assert.equal(reopened.publishedAt, null);
  });
});

test("weekly publishing goals and summary stay personal", async () => {
  await withStore((store) => {
    store.setGoal("alex", "instagram", 4);
    store.createPost({ title: "Studio reel", platform: "instagram", format: "reel", status: "published", publishedOn: "2026-08-27", actorId: "alex" });
    store.createPost({ title: "Monday carousel", platform: "instagram", format: "carousel", status: "scheduled", plannedOn: "2026-08-31", actorId: "alex" });
    store.createPost({ title: "Someone else's post", platform: "instagram", status: "published", publishedOn: "2026-08-28", actorId: "sara" });

    const summary = store.contentSummary({ actorId: "alex", today: "2026-08-30" });
    assert.deepEqual(summary.week, { start: "2026-08-24", end: "2026-08-30" });
    assert.equal(summary.platforms.instagram.target, 4);
    assert.equal(summary.platforms.instagram.published, 1);
    assert.equal(summary.platforms.instagram.planned, 0);
    assert.equal(summary.platforms.linkedin.target, 7);
    assert.equal(summary.next.title, "Monday carousel");
    assert.equal(summary.platforms.instagram.startedOn, "2026-08-27");
    assert.equal(summary.platforms.instagram.daily.find((day) => day.day === "2026-08-27").status, "posted");
    assert.equal(summary.platforms.instagram.daily.find((day) => day.day === "2026-08-28").status, "missed");
    assert.equal(summary.platforms.instagram.daily.at(-1).status, "pending");
    assert.equal(summary.platforms.linkedin.daily.at(-1).status, "pending", "platform streaks are independent");
  });
});

test("daily momentum is idempotent and rewards finished work and published posts", async () => {
  await withStore((store) => {
    assert.equal(store.checkIn("alex", "2026-08-29").firstToday, true);
    assert.equal(store.checkIn("alex", "2026-08-29").firstToday, false);
    store.checkIn("alex", "2026-08-30");
    store.createPost({ title: "Launch note", platform: "linkedin", status: "published", publishedOn: "2026-08-30", actorId: "alex" });

    const momentum = store.momentum({
      actorId: "alex",
      today: "2026-08-30",
      tasks: [
        { assigneeId: "alex", completedAt: "2026-08-30T10:00:00.000Z" },
        { assigneeId: "sara", completedAt: "2026-08-30T11:00:00.000Z" }
      ]
    });
    assert.equal(momentum.streak, 2);
    assert.equal(momentum.weeklyPoints, 10, "two check-ins + one task + one post");
    assert.deepEqual(momentum.contributions.at(-1), {
      day: "2026-08-30",
      checkIns: 1,
      tasks: 1,
      posts: 1,
      points: 9
    });
  });
});
