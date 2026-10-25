import { URLSearchParams } from "node:url";

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
const GITHUB_API_ROOT = "https://api.github.com";

function boundedText(value, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}

function projectError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseGitHubResponse(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw projectError("github_response_invalid", "GitHub returned an unreadable response. Try again.");
  }
}

export function parseGitHubRepository(value) {
  const raw = boundedText(value, 500).replace(/\.git$/i, "");
  if (!raw) throw projectError("github_repository_required", "Paste a GitHub repository URL first.");
  let slug = raw;
  if (/^https?:\/\//i.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw projectError("github_repository_invalid", "Use a valid GitHub repository URL.");
    }
    if (parsed.hostname.toLowerCase() !== "github.com") throw projectError("github_repository_invalid", "Use a github.com repository URL.");
    slug = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  }
  if (!REPOSITORY_PATTERN.test(slug)) throw projectError("github_repository_invalid", "Use a repository like owner/project or https://github.com/owner/project.");
  return { slug, url: `https://github.com/${slug}` };
}

export function normalizeGitHubBranch(value) {
  const branch = boundedText(value, 200);
  if (!branch) return "";
  if (!BRANCH_PATTERN.test(branch) || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    throw projectError("github_branch_invalid", "Use a valid Git branch name.");
  }
  return branch;
}

function normalizeCommit(item) {
  const message = boundedText(item?.commit?.message, 4000);
  const [title = "Untitled commit", ...body] = message.split(/\r?\n/);
  return {
    sha: boundedText(item?.sha, 64),
    shortSha: boundedText(item?.sha, 64).slice(0, 7),
    title: boundedText(title, 300) || "Untitled commit",
    body: boundedText(body.join("\n").trim(), 1200),
    author: boundedText(item?.author?.login || item?.commit?.author?.name || "Unknown", 180),
    avatarUrl: boundedText(item?.author?.avatar_url, 1000),
    committedAt: boundedText(item?.commit?.author?.date || item?.commit?.committer?.date, 80),
    url: boundedText(item?.html_url, 1000)
  };
}

function normalizeLatest(detail, fallback) {
  if (!detail || typeof detail !== "object") return null;
  return {
    ...fallback,
    additions: Number.isFinite(detail.stats?.additions) ? detail.stats.additions : 0,
    deletions: Number.isFinite(detail.stats?.deletions) ? detail.stats.deletions : 0,
    filesChanged: Number.isFinite(detail.stats?.total) ? (detail.files || []).length : 0,
    files: (Array.isArray(detail.files) ? detail.files : []).slice(0, 8).map((file) => ({
      path: boundedText(file?.filename, 500),
      status: boundedText(file?.status, 40),
      additions: Number.isFinite(file?.additions) ? file.additions : 0,
      deletions: Number.isFinite(file?.deletions) ? file.deletions : 0,
      url: boundedText(file?.blob_url, 1000)
    })).filter((file) => file.path)
  };
}

function normalizeRepository(item) {
  const slug = boundedText(item?.full_name, 300);
  if (!REPOSITORY_PATTERN.test(slug)) return null;
  return {
    slug,
    name: boundedText(item?.name, 180) || slug.split("/").at(-1),
    url: boundedText(item?.html_url, 1000) || `https://github.com/${slug}`,
    description: boundedText(item?.description, 500),
    private: Boolean(item?.private),
    defaultBranch: boundedText(item?.default_branch, 200) || "main",
    updatedAt: boundedText(item?.updated_at, 80)
  };
}

function githubApiError(response, hasToken) {
  if (response.status === 401) return projectError("github_auth_invalid", "Agent4's GitHub access needs to be renewed.");
  if (response.status === 403) return projectError("github_forbidden", "Agent4 does not have permission to read this repository.");
  if (response.status === 404) {
    return projectError(
      hasToken ? "github_repository_missing" : "github_auth_required",
      hasToken
        ? "GitHub could not find this repository. Check its URL and Agent4's access."
        : "This repository is private. Add a read-only GitHub token to the Agent4 server."
    );
  }
  if (response.status === 429) return projectError("github_rate_limited", "GitHub is rate limiting Agent4. Try again in a few minutes.");
  return projectError("github_unavailable", "Agent4 could not read GitHub right now. Try again.");
}

function createDefaultRunner({ fetchImpl = globalThis.fetch, token = "" } = {}) {
  const accessToken = boundedText(token, 500);
  return async (args) => {
    if (typeof fetchImpl !== "function") throw projectError("github_unavailable", "GitHub access is unavailable on the Agent4 server.");
    const resource = String(args?.[1] || "").replace(/^\/+/, "");
    if (args?.[0] !== "api" || !resource) throw projectError("github_request_invalid", "Agent4 could not prepare that GitHub request.");
    let response;
    try {
      response = await fetchImpl(`${GITHUB_API_ROOT}/${resource}`, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "Agent4-HQ",
          "x-github-api-version": "2022-11-28",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
        },
        signal: AbortSignal.timeout(10_000)
      });
    } catch (error) {
      if (error?.name === "TimeoutError") throw projectError("github_timeout", "GitHub took too long to answer. Try again.");
      throw projectError("github_unavailable", "Agent4 could not reach GitHub right now. Try again.");
    }
    if (!response.ok) throw githubApiError(response, Boolean(accessToken));
    return response.text();
  };
}

export function createGitHubProjectReader({ run, fetchImpl = globalThis.fetch, token = "" } = {}) {
  const runner = run || createDefaultRunner({ fetchImpl, token });
  return {
    async list({ limit = 100 } = {}) {
      const count = Math.max(1, Math.min(100, Number(limit) || 100));
      const query = new URLSearchParams({ affiliation: "owner", sort: "updated", per_page: String(count) });
      const repositoriesRaw = await runner(["api", `user/repos?${query}`]);
      const repositoriesPayload = parseGitHubResponse(repositoriesRaw);
      if (!Array.isArray(repositoriesPayload)) throw projectError("github_response_invalid", "GitHub returned an unreadable repository list.");
      return repositoriesPayload.map(normalizeRepository).filter(Boolean).slice(0, count);
    },
    async read({ repositoryUrl, branch, limit = 8 } = {}) {
      const repository = parseGitHubRepository(repositoryUrl);
      const selectedBranch = normalizeGitHubBranch(branch);
      const count = Math.max(1, Math.min(12, Number(limit) || 8));
      const repositoryRaw = await runner(["api", `repos/${repository.slug}`]);
      const repositoryInfo = parseGitHubResponse(repositoryRaw);
      const activeBranch = selectedBranch || boundedText(repositoryInfo.default_branch, 200) || "main";
      const query = new URLSearchParams({ per_page: String(count), sha: activeBranch });
      const commitsRaw = await runner(["api", `repos/${repository.slug}/commits?${query}`]);
      const commitsPayload = parseGitHubResponse(commitsRaw);
      if (!Array.isArray(commitsPayload)) throw projectError("github_response_invalid", "GitHub returned an unreadable commit list.");
      const commits = commitsPayload.map(normalizeCommit).filter((commit) => commit.sha && commit.url);
      let latest = null;
      if (commits[0]) {
        const detailRaw = await runner(["api", `repos/${repository.slug}/commits/${commits[0].sha}`]);
        latest = normalizeLatest(parseGitHubResponse(detailRaw), commits[0]);
      }
      return {
        connected: true,
        available: true,
        repository: {
          slug: repository.slug,
          url: repository.url,
          branch: activeBranch,
          private: Boolean(repositoryInfo.private),
          description: boundedText(repositoryInfo.description, 500),
          updatedAt: boundedText(repositoryInfo.updated_at, 80)
        },
        commits,
        latest
      };
    }
  };
}
