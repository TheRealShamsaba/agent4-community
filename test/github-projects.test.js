import assert from "node:assert/strict";
import test from "node:test";
import { createGitHubProjectReader, normalizeGitHubBranch, parseGitHubRepository } from "../src/github-projects.js";

test("GitHub repository links are canonical and bounded", () => {
  assert.deepEqual(parseGitHubRepository("https://github.com/example/project.git"), {
    slug: "example/project",
    url: "https://github.com/example/project"
  });
  assert.equal(parseGitHubRepository("example/project").slug, "example/project");
  assert.throws(() => parseGitHubRepository("https://example.com/private/repo"), /github\.com/);
  assert.equal(normalizeGitHubBranch("feature/company-overview"), "feature/company-overview");
  assert.throws(() => normalizeGitHubBranch("../secret"), /valid Git branch/);
});

test("project GitHub activity keeps commits and the latest changed files", async () => {
  const calls = [];
  const reader = createGitHubProjectReader({
    run: async (args) => {
      calls.push(args.at(1));
      if (calls.length === 1) return JSON.stringify({ default_branch: "main", private: true, description: "Agent4", updated_at: "2026-09-01T10:00:00Z" });
      if (calls.length === 2) return JSON.stringify([{
        sha: "abcdef1234567890",
        html_url: "https://github.com/acme/site/commit/abcdef1234567890",
        author: { login: "alex", avatar_url: "https://avatars.githubusercontent.com/u/1" },
        commit: { message: "Redesign company overview\n\nMake the workspace wider.", author: { date: "2026-09-01T09:00:00Z" } }
      }]);
      return JSON.stringify({ stats: { additions: 42, deletions: 8, total: 50 }, files: [{ filename: "src/company.jsx", status: "modified", additions: 42, deletions: 8, blob_url: "https://github.com/acme/site/blob/abcdef1/src/company.jsx" }] });
    }
  });
  const activity = await reader.read({ repositoryUrl: "acme/site", limit: 5 });
  assert.equal(activity.repository.branch, "main");
  assert.equal(activity.commits[0].title, "Redesign company overview");
  assert.equal(activity.latest.files[0].path, "src/company.jsx");
  assert.equal(activity.latest.additions, 42);
  assert.match(calls[1], /per_page=5/);
});

test("GitHub repository discovery returns owned repositories for the one-click picker", async () => {
  const calls = [];
  const reader = createGitHubProjectReader({
    run: async (args) => {
      calls.push(args.at(1));
      return JSON.stringify([
        { full_name: "acme/private-app", name: "private-app", html_url: "https://github.com/acme/private-app", private: true, default_branch: "trunk", description: "Internal app", updated_at: "2026-09-13T12:00:00Z" },
        { full_name: "acme/public-site", name: "public-site", html_url: "https://github.com/acme/public-site", private: false, default_branch: "main", description: null, updated_at: "2026-09-12T12:00:00Z" }
      ]);
    }
  });

  const repositories = await reader.list({ limit: 25 });
  assert.equal(repositories.length, 2);
  assert.deepEqual(repositories[0], {
    slug: "acme/private-app",
    name: "private-app",
    url: "https://github.com/acme/private-app",
    description: "Internal app",
    private: true,
    defaultBranch: "trunk",
    updatedAt: "2026-09-13T12:00:00Z"
  });
  assert.match(calls[0], /^user\/repos\?/);
  assert.match(calls[0], /affiliation=owner/);
  assert.match(calls[0], /per_page=25/);
});

test("project GitHub activity uses the HTTPS API and keeps its token server-side", async () => {
  const calls = [];
  const payloads = [
    { default_branch: "main", private: true },
    [],
  ];
  const reader = createGitHubProjectReader({
    token: "private-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, text: async () => JSON.stringify(payloads.shift()) };
    }
  });

  const activity = await reader.read({ repositoryUrl: "acme/private" });
  assert.equal(activity.available, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\/acme\/private$/);
  assert.equal(calls[0].options.headers.authorization, "Bearer private-token");
});

test("private GitHub repositories explain when server credentials are missing", async () => {
  const reader = createGitHubProjectReader({
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => "{}" })
  });
  await assert.rejects(
    reader.read({ repositoryUrl: "acme/private" }),
    (error) => error.code === "github_auth_required" && /read-only GitHub token/.test(error.message)
  );
});
