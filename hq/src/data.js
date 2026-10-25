import { localIsoDate } from "./format.js";

/**
 * The page's data arrives embedded by src/hq.js. If the raw template is opened
 * directly, send the user to the generated HQ file instead of showing fake data.
 */
export function readSnapshot() {
  const element = document.getElementById("hq-data");
  const raw = element?.textContent?.trim() ?? "";
  if (raw && !raw.startsWith("__")) {
    try {
      return { snapshot: { ...emptySnapshot(), ...JSON.parse(raw) }, isLive: true };
    } catch {
      // fall through to the empty production shell
    }
  }
  redirectTemplateToGeneratedHq();
  return { snapshot: emptySnapshot(), isLive: false };
}

function redirectTemplateToGeneratedHq() {
  if (typeof window === "undefined") return;
  const path = window.location.pathname || "";
  if (!path.endsWith("/src/hq-template.html")) return;
  if (new URLSearchParams(window.location.search).has("templatePreview")) return;
  window.location.replace(new URL("../data/hq.html", window.location.href).href);
}

function emptySnapshot() {
  const now = Date.now();
  return {
    generatedAt: new Date(now).toISOString(),
    focus: [],
    agenda: null,
    dossiers: [],
    counts: { companies: 0, pursue: 0, watch: 0, skip: 0, contacted: 0, replied: 0, meetings: 0, won: 0, openTasks: 0 },
    learning: {
      measured: 0,
      target: 10,
      ready: false,
      replyRate: null,
      meetingRate: null,
      winRate: null,
      wonValues: []
    },
    runs: {
      lastDaily: null,
      lastWeekly: null,
      lastResult: null
    },
    agent4: {
      name: "agent4",
      date: localIsoDate(new Date(now)),
      brief: "Start with one task, one client, or a plan for your week.",
      pulse: { openTasks: 0, dueNow: 0, waitingOnThem: 0, stalePursues: 0 },
      topMoves: [],
      waitingOnUs: [],
      waitingOnThem: [],
      notes: [],
      doneToday: []
    },
    tasks: [],
    board: [],
    topLeads: [],
    sources: [],
    activity: []
  };
}
