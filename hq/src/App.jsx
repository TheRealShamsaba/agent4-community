import React, { useEffect, useMemo, useRef, useState } from "react";
import { SetupScreen } from "./components/SetupScreen.jsx";
import { Canvas, canvasHasUnsavedChanges } from "./components/Canvas.jsx";
import { ActionDrawer } from "./components/ActionDrawer.jsx";
import { CommandPalette } from "./components/CommandPalette.jsx";
import { CompanyProjects } from "./components/CompanyProjects.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { FilmRoom, filmRoomInterruption } from "./components/FilmRoom.jsx";
import { HomeCourt } from "./components/HomeCourt.jsx";
import { MoneyPage } from "./components/MoneyPage.jsx";
import { PaperworkPage } from "./components/PaperworkPage.jsx";
import { Tasks } from "./components/Tasks.jsx";
import { AuthLoading, LoginScreen, TeamPanel } from "./components/AuthScreens.jsx";
import { Header, ShellNotices } from "./components/AppHeader.jsx";
import { AgentPanel } from "./components/AgentPanel.jsx";
import { MonitorPage } from "./components/MonitorPage.jsx";
import { ShortcutPanel } from "./components/ShortcutPanel.jsx";
import { ROOM_ID, authRequest, fetchJson, setSessionExpiredHandler, watchUnauthorizedResponses } from "./api.js";
import { dueLabel, relativeTime } from "./format.js";
import { PLACES, PLACE_IDS, PLACE_ALIASES, actorCanAccessPlace, placesForActor } from "./places.js";
import { setActiveActor } from "./room-actor.js";

const PLACE_KEY = "agent4-place";

/* How long /api/auth/session gets to answer before the app stops waiting. A
   request that hangs rather than rejects used to leave the avatar spinning with
   nothing on screen to click, forever. */
const AUTH_TIMEOUT_MS = 12_000;
/* Past this the embedded snapshot is old enough that the numbers next to the
   live task and money data are probably from a different day. */
const SNAPSHOT_STALE_MS = 12 * 60 * 60 * 1000;

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The room still works when browser persistence is unavailable.
  }
}

/* ------------------------------------------------------------------ the URL ---
   Nothing in this app used to have one: `place` lived in localStorage, the
   address bar never moved, Back left the app, and a link to an open company
   landed the reader wherever they happened to have been last. The HQ is one
   self-contained file that gets served from "/" on the laptop and from a
   subpath behind the tunnel, so the path is never ours to spend — every bit of
   navigable state rides in the query string and the pathname is left alone. */

function readLocation(search = window.location.search) {
  const params = new URLSearchParams(search);
  const requested = PLACE_ALIASES[params.get("place")] || params.get("place");
  return {
    place: PLACE_IDS.includes(requested) ? requested : "",
    company: params.get("company") || "",
    project: params.get("project") || "",
    sheet: params.get("sheet") || "",
    tab: ["work", "brain", "docs", "money"].includes(params.get("tab")) ? params.get("tab") : "",
    doc: params.get("doc") || "",
    task: params.get("task") || "",
    meeting: params.get("meeting") || "",
    site: /^[0-9a-f-]{8,64}$/i.test(params.get("site") || "") ? params.get("site") : "",
    scope: params.get("scope") === "mine" ? "mine" : "all"
  };
}

function locationUrl(state) {
  const params = new URLSearchParams();
  params.set("place", state.place);
  if (state.place === "workspaces") {
    if (state.company) params.set("company", state.company);
    if (state.project) params.set("project", state.project);
    if (state.sheet) params.set("sheet", state.sheet);
    if (state.company && state.tab) params.set("tab", state.tab);
  }
  /* Paperwork borrows `company` from the workspaces spelling on purpose: one
     company id in the query string means one thing wherever it appears, so a
     link from a company page is the same link the section writes back. */
  if (state.place === "paperwork") {
    if (state.company) params.set("company", state.company);
    if (state.doc) params.set("doc", state.doc);
  }
  if (state.place === "tasks") {
    if (state.scope === "mine") params.set("scope", "mine");
    if (state.task) params.set("task", state.task);
  }
  if (state.place === "film" && state.meeting) params.set("meeting", state.meeting);
  if (state.place === "monitor" && state.site) params.set("site", state.site);
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

function currentUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/* Saved rooms predate attribution and predate the day the "agent" object became
   an "insight", so every read runs them forward. It is also what makes the
   hydration diff honest: the server copy goes through the same migration before
   it is compared with the browser copy, or every reload would report a conflict
   against its own past self. */
export function App({ snapshot, isLive = true }) {
  const [authState, setAuthState] = useState({ status: "loading", authRequired: false, actor: null });
  const [settings, setSettings] = useState({ name: "Your workspace", modules: { room: false, monitor: false } });
  const [authNotice, setAuthNotice] = useState("");
  const [presence, setPresence] = useState([]);
  const [members, setMembers] = useState([]);
  const [teamOpen, setTeamOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [paletteData, setPaletteData] = useState({ status: "idle", tasks: [], meetings: [] });
  const [taskTick, setTaskTick] = useState(0);
  const [workspaceTick, setWorkspaceTick] = useState(0);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
  const entryLocationRef = useRef(null);
  if (!entryLocationRef.current) entryLocationRef.current = readLocation();
  const entryLocation = entryLocationRef.current;
  const [taskEntry, setTaskEntry] = useState({ scope: entryLocation.scope, create: false, context: null, taskId: entryLocation.task, key: 0 });
  const [filmEntry, setFilmEntry] = useState({ create: false, meetingId: entryLocation.meeting, key: 0 });
  const [workspaceEntry, setWorkspaceEntry] = useState({
    companyId: entryLocation.company,
    projectId: entryLocation.project,
    sheetId: entryLocation.sheet,
    tab: entryLocation.tab,
    key: 0
  });
  const [monitorEntry, setMonitorEntry] = useState({ siteId: entryLocation.site });
  const [paperworkEntry, setPaperworkEntry] = useState({ companyId: entryLocation.company, docId: entryLocation.doc, key: 0 });
  const [workspaceCatalog, setWorkspaceCatalog] = useState({ companies: [], projects: [] });
  /* The URL is the truth. localStorage only answers the first visit of a browser
     that arrived with no query string at all — a bookmark, a shared link or the
     Back button always wins over what this browser last looked at. */
  const [place, setPlace] = useState(() => {
    if (entryLocation.place) return entryLocation.place;
    const stored = readStorage(PLACE_KEY, "home");
    const saved = PLACE_ALIASES[stored] || stored;
    return PLACE_IDS.includes(saved) ? saved : "home";
  });
  const dossierById = useMemo(() => new Map((snapshot.dossiers || []).map((dossier) => [dossier.id, dossier])), [snapshot.dossiers]);
  const workspaceCompanies = useMemo(() => {
    const byId = new Map();
    for (const company of [...(snapshot.dossiers || []), ...(workspaceCatalog.companies || [])]) {
      if (company?.id && company?.name) byId.set(company.id, { id: company.id, name: company.name });
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [snapshot.dossiers, workspaceCatalog.companies]);
  const [openDossierId, setOpenDossierId] = useState(null);
  const [result, setResult] = useState("");
  /* Two channels, because they are two different things. `result` is a
     confirmation that auto-dismisses; `warning` is something the user has to
     read and put away themselves. They used to share one six-second string, so
     "This room changed in another session" disappeared on its own if the user
     happened to be looking somewhere else. */
  const [warning, setWarning] = useState(null);
  const clientIdRef = useRef(`client-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`);
  const urlRef = useRef(currentUrl());
  const urlPlaceRef = useRef(place);

  setActiveActor(authState.actor);

  /* The real trail to the open document: the board, the section it physically
     sits in, and the workspace it was pinned from. An empty trail is the honest
     answer for a document floating outside every section. */
  /* Everything the palette can reach, as data. The handlers are resolved at
     select time in runPaletteItem so this memo never holds a stale closure. */
  const paletteItems = useMemo(() => {
    const companyNames = new Map(workspaceCompanies.map((company) => [company.id, company.name]));
    const items = [{ id: "agent:open", group: "Go to", kind: "agent", target: "agent", label: "Ask Agent4", hint: "Talk to your assistant (⌘J)", keywords: "ai assistant jarvis chat" }];
    items.push(...placesForActor(authState.actor, settings.modules).map((entry) => ({
      id: `place:${entry.id}`, group: "Go to", kind: "place", target: entry.id,
      label: entry.label, hint: entry.hint, keywords: entry.short
    })));
    for (const company of workspaceCompanies) {
      items.push({ id: `company:${company.id}`, group: "Companies", kind: "company", target: company.id, label: company.name, hint: "Company workspace" });
    }
    for (const project of workspaceCatalog.projects || []) {
      items.push({
        id: `project:${project.id}`, group: "Projects", kind: "project", target: project.id, companyId: project.companyId,
        label: project.name, hint: project.companyName || companyNames.get(project.companyId) || "Project"
      });
    }
    for (const task of paletteData.tasks) {
      items.push({
        id: `task:${task.id}`, group: "Tasks", kind: "task", target: task.id, label: task.title,
        hint: [task.companyName, task.dueOn ? dueLabel(task.dueOn) : ""].filter(Boolean).join(" · ") || "Task"
      });
    }
    for (const meeting of paletteData.meetings) {
      items.push({
        id: `meeting:${meeting.id}`, group: "Meetings", kind: "meeting", target: meeting.id,
        label: meeting.title || "Untitled meeting",
        hint: [meeting.clientName, meeting.createdAt ? relativeTime(meeting.createdAt) : ""].filter(Boolean).join(" · ") || "Meeting"
      });
    }
    return items;
  }, [workspaceCompanies, workspaceCatalog.projects, paletteData, authState.actor, settings]);

  useEffect(() => {
    let cancelled = false;
    /* A hung request is not a rejected one: nothing ever calls back and the
       loading screen has no exit. Give it AUTH_TIMEOUT_MS, then fall through to
       the sign-in screen with the reason on it. */
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setAuthNotice("Agent4's server did not answer. It may be starting up — try signing in again, or reload the page.");
      setAuthState({ status: "unauthenticated", authRequired: true, actor: null });
    }, AUTH_TIMEOUT_MS);
    authRequest("/session")
      .then((response) => {
        if (cancelled) return;
        window.clearTimeout(timer);
        setAuthState({ status: response.authenticated ? "authenticated" : "unauthenticated", authRequired: response.authRequired, setupRequired: response.setupRequired, actor: response.actor || null });
        setPresence(response.actor ? [response.actor] : []);
        if (response.settings) setSettings(response.settings);
      })
      .catch((error) => {
        if (cancelled) return;
        window.clearTimeout(timer);
        setAuthNotice(error.message || "Agent4's sign-in service is offline.");
        setAuthState({ status: "unauthenticated", authRequired: true, actor: null });
      });
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  /* Any 401 anywhere in the shell means the session is gone. Put the user back
     on the sign-in screen rather than letting the room keep taking edits it can
     never save. */
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAuthNotice("Your Agent4 session expired. Sign in again — anything after that point was only held in this browser.");
      setTeamOpen(false);
      setPaletteOpen(false);
      setShortcutsOpen(false);
      setPresence([]);
      setAuthState((current) => (current.status === "unauthenticated" ? current : { status: "unauthenticated", authRequired: true, actor: null }));
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  /* Installed only once signed in, so a wrong password on the way in is never
     mistaken for an expired session. */
  useEffect(() => {
    if (authState.status !== "authenticated") return undefined;
    return watchUnauthorizedResponses();
  }, [authState.status]);

  useEffect(() => {
    if (authState.status !== "authenticated") return undefined;
    let cancelled = false;
    authRequest("/members")
      .then((response) => {
        if (!cancelled) setMembers(response.members?.length ? response.members : [authState.actor]);
      })
      .catch(() => {
        if (!cancelled) setMembers(authState.actor ? [authState.actor] : []);
      });
    return () => { cancelled = true; };
  }, [authState.status, authState.actor]);

  useEffect(() => {
    if (authState.status !== "authenticated") return undefined;
    let cancelled = false;
    Promise.all([
      fetchJson("/api/workspaces"),
      fetchJson("/api/client-memory").catch(() => ({ memories: [] }))
    ])
      .then(([body, memoryBody]) => {
        if (cancelled) return;
        const companies = [...(body.companies || [])];
        const projects = [...(body.projects || [])];
        for (const memory of memoryBody.memories || []) {
          if (!memory.clientName) continue;
          const companyId = memory.clientId || `name:${memory.clientName.trim().toLocaleLowerCase()}`;
          if (!companies.some((company) => company.id === companyId || company.name.toLocaleLowerCase() === memory.clientName.toLocaleLowerCase())) companies.push({ id: companyId, name: memory.clientName });
          for (const name of memory.projects || []) {
            if (!projects.some((project) => project.companyId === companyId && project.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
              const projectSlug = name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
              projects.push({ id: `derived:${companyId}:${projectSlug}`, companyId, companyName: memory.clientName, name, status: "active", derived: true });
            }
          }
        }
        setWorkspaceCatalog({ companies, projects });
      })
      .catch(() => { if (!cancelled) setWorkspaceCatalog({ companies: [], projects: [] }); });
    return () => { cancelled = true; };
  }, [authState.status, taskTick, workspaceTick]);

  /* The palette reads the two things the shell does not already hold. It reads
     them when it opens rather than on every page load, so nothing pays for a
     search box nobody uses. */
  useEffect(() => {
    if (!paletteOpen || authState.status !== "authenticated") return undefined;
    let cancelled = false;
    setPaletteData((current) => ({ ...current, status: "loading" }));
    Promise.all([
      fetchJson("/api/tasks?includeDone=true").catch(() => ({ tasks: [] })),
      fetchJson("/api/meetings?limit=60").catch(() => ({ meetings: [] }))
    ]).then(([taskBody, meetingBody]) => {
      if (cancelled) return;
      setPaletteData({ status: "ready", tasks: taskBody.tasks || [], meetings: meetingBody.meetings || [] });
    });
    return () => { cancelled = true; };
  }, [paletteOpen, authState.status, taskTick]);


  useEffect(() => {
    const query = window.matchMedia("(max-width: 759px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => { writeStorage(PLACE_KEY, place); }, [place]);

  useEffect(() => {
    if (authState.status !== "authenticated" || actorCanAccessPlace(authState.actor, place, settings.modules)) return;
    setPlace("home");
  }, [authState.status, authState.actor, place, settings]);

  /* --------------------------------------------------------- the address bar ---
     Writing state back to the URL is what makes every section linkable and Back
     behave. A place change pushes a history entry so Back walks the app instead
     of leaving it; picking a different company, sheet or task inside a place
     replaces the entry, or Back would turn into an undo stack for clicks. */
  useEffect(() => {
    /* The sign-in screen is not a place, and rewriting the query string while it
       is up would strip the ?invite= token out from under it. */
    if (authState.status !== "authenticated") return;
    const next = locationUrl({
      place,
      company: place === "paperwork" ? paperworkEntry.companyId : workspaceEntry.companyId,
      doc: paperworkEntry.docId,
      project: workspaceEntry.projectId,
      sheet: workspaceEntry.sheetId,
      tab: workspaceEntry.tab,
      task: taskEntry.taskId,
      scope: taskEntry.scope,
      meeting: filmEntry.meetingId,
      site: monitorEntry.siteId
    });
    urlRef.current = next;
    if (next === currentUrl()) {
      urlPlaceRef.current = place;
      return;
    }
    window.history[place === urlPlaceRef.current ? "replaceState" : "pushState"]({ agent4Place: place }, "", next);
    urlPlaceRef.current = place;
  }, [authState.status, place, workspaceEntry.companyId, workspaceEntry.projectId, workspaceEntry.sheetId, workspaceEntry.tab, paperworkEntry.companyId, paperworkEntry.docId, taskEntry.taskId, taskEntry.scope, filmEntry.meetingId, monitorEntry.siteId]);

  useEffect(() => {
    if (authState.status !== "authenticated") return undefined;
    function popped() {
      const next = readLocation();
      const target = next.place || "home";
      if (!leaveFilmRoom(target)) {
        // Refusing the move means putting the entry we just left back on top.
        window.history.pushState({ agent4Place: place }, "", urlRef.current);
        return;
      }
      applyLocation(next);
    }
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, [authState.status, place]);

  useEffect(() => {
    if (!quickAddOpen) return undefined;
    function closeQuickAdd(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && event.target instanceof Element && event.target.closest(".header-add-wrap")) return;
      setQuickAddOpen(false);
    }
    document.addEventListener("pointerdown", closeQuickAdd);
    document.addEventListener("keydown", closeQuickAdd);
    return () => {
      document.removeEventListener("pointerdown", closeQuickAdd);
      document.removeEventListener("keydown", closeQuickAdd);
    };
  }, [quickAddOpen]);

  useEffect(() => {
    if (authState.status !== "authenticated") return undefined;
    const stream = new EventSource(`/api/rooms/${ROOM_ID}/events?clientId=${encodeURIComponent(clientIdRef.current)}`);
    function presenceEvent(event) {
      try {
        const payload = JSON.parse(event.data);
        setPresence(payload.members?.length ? payload.members : [authState.actor]);
      } catch {
        // A later event will refresh presence.
      }
    }
    const tasksEvent = () => setTaskTick((count) => count + 1);
    const workspacesEvent = () => setWorkspaceTick((count) => count + 1);
    stream.addEventListener("tasks", tasksEvent);
    stream.addEventListener("workspaces", workspacesEvent);
    stream.addEventListener("presence", presenceEvent);
    return () => stream.close();
  }, [authState.status, authState.actor]);

  useEffect(() => {
    if (authState.status !== "authenticated") return undefined;
    sendPresence();
    const heartbeat = window.setInterval(() => sendPresence(), 8_000);
    return () => window.clearInterval(heartbeat);
  }, [authState.status]);

  useEffect(() => {
    if (!result) return undefined;
    const timer = window.setTimeout(() => { setResult(""); }, 6000);
    return () => window.clearTimeout(timer);
  }, [result]);

  /* The only keys that work everywhere, and none of them can destroy anything.
     H and R used to fire on every page outside an input, so pressing R while
     reading a meeting transcript threw you into the Locker Room; they now only
     work on the two places they flip between, and ⌘K is how you reach anything
     else from anywhere. */
  useEffect(() => {
    if (authState.status !== "authenticated") return undefined;
    function keydown(event) {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setShortcutsOpen(false);
        setPaletteOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "j") {
        event.preventDefault();
        setPaletteOpen(false);
        setAssistantOpen((open) => !open);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      if (key !== "h") return;
      event.preventDefault();
      changePlace("home");
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [authState.status, place]);


  function sendPresence() {
    if (authState.status !== "authenticated") return;
    fetch(`/api/rooms/${ROOM_ID}/presence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: clientIdRef.current, cursor: null, selectedIds: [], editingId: null, mode: "select" })
    }).catch(() => {});
  }

  function openDossier(id) {
    if (!id || !dossierById.has(id)) return;
    setOpenDossierId(id);
  }

  /* Two id spaces arrive here. Home court hands over a workspace company id from
     its client rows and a meeting's clientId — a dossier id — from its memory
     rows, and it has no way to tell them apart. */
  function openCompanyById(id) {
    if (!id) return;
    if (dossierById.has(id)) openDossier(id);
    else openWorkspacePlace(id);
  }

  function openMoneyPlace(company = null) {
    if (settings.modules.money === false) { setWarning({ title: "This tool is turned off. ", body: "The owner can enable it in workspace settings." }); return; }
    if (!leaveFilmRoom("money")) return;
    setQuickAddOpen(false);
    setPaletteOpen(false);
    /* Money is not per-company yet: it opens on the whole ledger, and the
       company is carried only so the reader lands with it in mind. */
    if (company?.name) setResult(`Money, with ${company.name} in mind.`);
    setPlace("money");
  }

  function runPaletteItem(item) {
    setPaletteOpen(false);
    if (item.kind === "agent") { setAssistantOpen(true); return; }
    if (item.kind === "place") { changePlace(item.target); return; }
    /* Companies and projects both live on the Companies page, which builds its
       list from the stored workspaces and the snapshot dossiers together, so one
       id space reaches both. */
    if (item.kind === "company") { openWorkspacePlace(item.target); return; }
    if (item.kind === "project") { openWorkspacePlace(item.companyId, item.target); return; }
    if (item.kind === "task") { openTasksPlace({ scope: "all", taskId: item.target }); return; }
    if (item.kind === "meeting") openFilmPlace({ meetingId: item.target });
  }

  useEffect(() => {
    const update = event => setSettings(event.detail);
    window.addEventListener('agent4-settings', update);
    return () => window.removeEventListener('agent4-settings', update);
  }, []);

  function authenticated(actor) {
    authRequest('/session').then(body => { if (body.settings) setSettings(body.settings); }).catch(() => {});
    setAuthState({ status: "authenticated", authRequired: true, actor });
    setPresence([actor]);
    setMembers([actor]);
  }

  async function createTeamInvite(input) {
    const response = await authRequest("/invites", { method: "POST", body: JSON.stringify(input) });
    return response.invite.url;
  }

  async function revokeTeamMember(userId) {
    const response = await authRequest(`/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
    setMembers(response.members || []);
    setPresence((current) => current.filter((member) => member.id !== userId));
  }

  async function changeAccountPassword(input) {
    await authRequest("/password", { method: "POST", body: JSON.stringify(input) });
  }

  async function logout() {
    try { await authRequest("/logout", { method: "POST" }); } catch { /* Clear the local session view even if the server is unavailable. */ }
    setTeamOpen(false);
    setPresence([]);
    setMembers([]);
    setAuthState({ status: "unauthenticated", authRequired: true, actor: null });
  }

  /* Film Room is the only place that can be holding something the app cannot
     rebuild — a recording still running, an upload still climbing. It says so
     itself; nothing navigates past that sentence without being told to. */
  function leaveFilmRoom(nextPlace) {
    if (place === "room" && nextPlace !== "room" && canvasHasUnsavedChanges() && !window.confirm("You have unsaved canvas edits. Save or download them before leaving. Leave anyway?")) return false;
    if (place !== "film" || nextPlace === "film") return true;
    const reason = filmRoomInterruption();
    if (!reason) return true;
    return window.confirm(`${reason}\n\nLeave the Film Room anyway?`);
  }

  function applyLocation(next) {
    setQuickAddOpen(false);
    setPaletteOpen(false);
    const target = next.place || "home";
    setPlace(actorCanAccessPlace(authState.actor, target, settings.modules) ? target : "home");
    setWorkspaceEntry((current) => {
      if (current.companyId === next.company && current.projectId === next.project && current.sheetId === next.sheet) {
        return current.tab === next.tab ? current : { ...current, tab: next.tab };
      }
      return { companyId: next.company, projectId: next.project, sheetId: next.sheet, tab: next.tab, key: current.key + 1 };
    });
    setPaperworkEntry((current) => (
      current.companyId === next.company && current.docId === next.doc
        ? current
        /* Back out of an open document has to re-mount the section, or the
           editor it is holding would stay on screen with the URL saying
           otherwise. */
        : { companyId: next.company, docId: next.doc, key: current.key + 1 }
    ));
    setTaskEntry((current) => (
      current.scope === next.scope && current.taskId === next.task && !current.create
        ? current
        /* Only a different scope needs a fresh board. Which task is open is a
           prop the board reacts to, so changing it must not throw the page away. */
        : { scope: next.scope, create: false, context: null, taskId: next.task, key: current.scope === next.scope ? current.key : current.key + 1 }
    ));
    setFilmEntry((current) => (
      current.meetingId === next.meeting && !current.create ? current : { ...current, create: false, meetingId: next.meeting }
    ));
    setMonitorEntry((current) => (current.siteId === next.site ? current : { siteId: next.site }));

  }

  function changePlace(nextPlace) {
    if (!actorCanAccessPlace(authState.actor, nextPlace, settings.modules)) return;
    if (!leaveFilmRoom(nextPlace)) return;
    setQuickAddOpen(false);
    setPaletteOpen(false);
    /* Film Room used to be remounted on every plain nav change, which is why it
       always came back on the welcome screen and why a recording in progress did
       not survive a trip to Home. It reacts to its own props; leave it alone. */
    setPlace(nextPlace);
  }

  function openTasksPlace({ scope = "mine", create = false, context = null, taskId = "" } = {}) {
    if (settings.modules.tasks === false) { setWarning({ title: "This tool is turned off. ", body: "The owner can enable it in workspace settings." }); return; }
    if (!leaveFilmRoom("tasks")) return;
    setQuickAddOpen(false);
    setPaletteOpen(false);
    setTaskEntry((current) => ({ scope, create, context, taskId, key: current.key + 1 }));
    setPlace("tasks");
  }

  function openFilmPlace({ create = false, meetingId = "" } = {}) {
    if (settings.modules.film === false) { setWarning({ title: "This tool is turned off. ", body: "The owner can enable it in workspace settings." }); return; }
    setQuickAddOpen(false);
    setPaletteOpen(false);
    /* The key is the only thing that restarts Film Room from scratch, and
       "new meeting" is the only reason to want that — never while it is holding
       a recording or an upload it cannot rebuild. */
    const remount = create && !filmRoomInterruption();
    setFilmEntry((current) => ({ create, meetingId, key: remount ? current.key + 1 : current.key }));
    setPlace("film");
  }

  /* One company's paperwork, reached from that company. CompanyDesk is not
     this agent's file, so the handoff stops here: the prop below is the whole
     App-side wiring, and a company page only has to call it with its own id. */
  function openPaperworkPlace(companyId = "", docId = "") {
    if (settings.modules.paperwork === false) { setWarning({ title: "This tool is turned off. ", body: "The owner can enable it in workspace settings." }); return; }
    if (!leaveFilmRoom("paperwork")) return;
    setQuickAddOpen(false);
    setPaletteOpen(false);
    setPaperworkEntry((current) => ({ companyId, docId, key: current.key + 1 }));
    setPlace("paperwork");
  }

  function openWorkspacePlace(companyId = "", projectId = "", sheetId = "") {
    if (settings.modules.workspaces === false) { setWarning({ title: "This tool is turned off. ", body: "The owner can enable it in workspace settings." }); return; }
    if (!leaveFilmRoom("workspaces")) return;
    setQuickAddOpen(false);
    setPaletteOpen(false);
    setWorkspaceEntry((current) => ({ companyId, projectId, sheetId, tab: "", key: current.key + 1 }));
    setPlace("workspaces");
  }

  function runQuickAdd(kind) {
    setQuickAddOpen(false);
    if (kind === "task") openTasksPlace({ scope: "mine", create: true });
    else if (kind === "meeting") openFilmPlace({ create: true });
  }

  if (authState.status === "loading") return <AuthLoading />;
  if (authState.setupRequired && authState.status !== "authenticated") return <SetupScreen onAuthenticated={authenticated} />;
  if (authState.status !== "authenticated") return <LoginScreen notice={authNotice} onAuthenticated={authenticated} />;

  const snapshotAt = snapshot.generatedAt || "";
  const snapshotAge = Date.parse(snapshotAt);
  const header = (
    <Header
      actor={authState.actor}
      settings={settings}
      authRequired={authState.authRequired}
      presence={presence}
      place={place}
      quickAddOpen={quickAddOpen}
      snapshotAt={snapshotAt}
      snapshotStale={Number.isFinite(snapshotAge) && Date.now() - snapshotAge > SNAPSHOT_STALE_MS}
      onPlace={changePlace}
      onToggleQuickAdd={() => setQuickAddOpen((open) => !open)}
      onQuickAdd={runQuickAdd}
      onOpenPalette={() => setPaletteOpen(true)}
      onOpenAgent={() => { setPaletteOpen(false); setAssistantOpen((open) => !open); }}
      onOpenTeam={() => setTeamOpen(true)}
      onLogout={logout}
      onRefreshSnapshot={() => window.location.reload()}
    />
  );

  /* Everything that rides above every place: the banners, the shortcut sheet
     and the palette. The sheet used to open only in the Locker Room even though
     the keys it lists are pressed everywhere. */
  const overlays = (
    <>
      <ShellNotices isLive={isLive} warning={warning} onDismissWarning={() => setWarning(null)} />
      <TeamPanel open={teamOpen} actor={authState.actor} members={members} onInvite={createTeamInvite} onRevoke={revokeTeamMember} onChangePassword={changeAccountPassword} onClose={() => setTeamOpen(false)} />
      <ShortcutPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <AgentPanel open={assistantOpen} actor={authState.actor} place={place} onClose={() => setAssistantOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        items={paletteItems}
        loading={paletteData.status === "loading"}
        onSelect={runPaletteItem}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );

  /* One boundary per place. A crash inside the Film Room takes the Film Room
     down and leaves the header, the nav and every other section usable; moving
     to another place clears it. */
  function placeShell(children, className = "room room--home") {
    return (
      <div className={className}>
        {header}
        {overlays}
        <ErrorBoundary label={PLACES.find((entry) => entry.id === place)?.label || "This section"} resetKey={place}>
          {children}
        </ErrorBoundary>
      </div>
    );
  }

  if (place === "room") return placeShell(<Canvas actor={authState.actor} />);

  if (place === "tasks") {
    return placeShell(
      <Tasks
        key={taskEntry.key}
        onBack={() => changePlace("home")}
        actor={authState.actor}
        liveTick={`${taskTick}:${workspaceTick}`}
        initialFilter={taskEntry.scope === "mine" ? authState.actor.id : "all"}
        startCreating={taskEntry.create}
        initialContext={taskEntry.context}
        initialTaskId={taskEntry.taskId}
        dossierCompanies={snapshot.dossiers || []}
        onOpenCompany={(companyId) => openWorkspacePlace(companyId)}
        onTaskOpened={(taskId) => setTaskEntry((current) => (current.taskId === taskId ? current : { ...current, taskId }))}
      />
    );
  }

  if (place === "workspaces") {
    return placeShell(
      <CompanyProjects
        key={workspaceEntry.key}
        snapshot={snapshot}
        members={members}
        canDelete={authState.actor.role === "owner"}
        liveTick={`${taskTick}:${workspaceTick}`}
        initialCompanyId={workspaceEntry.companyId}
        initialProjectId={workspaceEntry.projectId}
        initialSheetId={workspaceEntry.sheetId}
        initialTab={workspaceEntry.tab}
        onTabChange={(tab) => setWorkspaceEntry((current) => (current.tab === tab ? current : { ...current, tab }))}
        onAddTask={(company, project) => openTasksPlace({ scope: "mine", create: true, context: { company, project } })}
        onOpenTasks={(context) => openTasksPlace({ scope: "all", context: context || null })}
        onOpenMoney={(company) => openMoneyPlace(company)}
        onOpenPaperwork={(company, docId) => openPaperworkPlace(company?.id || company || "", docId || "")}
        onOpenAgent={() => setAssistantOpen(true)}
        onOpenSite={(siteId) => { setMonitorEntry({ siteId }); changePlace("monitor"); }}
        onOpenMeeting={(meetingId) => openFilmPlace({ meetingId })}
      />
    );
  }

  if (place === "film") {
    /* No key here on purpose. Bumping it on a plain nav change is what threw
       away a recording in progress and sent you back to the welcome screen every
       time you came back; the component reacts to startCreating and
       initialMeetingId on its own. */
    return placeShell(
      <FilmRoom
        key={filmEntry.key}
        clients={workspaceCompanies}
        compact={compact}
        onOpenClient={(companyId) => openWorkspacePlace(companyId)}
        startCreating={filmEntry.create}
        initialMeetingId={filmEntry.meetingId}
        onChanged={() => setWorkspaceTick((current) => current + 1)}
      />
    );
  }

  if (place === "monitor") {
    return placeShell(
      <MonitorPage
        initialSiteId={monitorEntry.siteId}
        onSelectSite={(siteId) => setMonitorEntry({ siteId })}
        onOpenCompany={(companyId) => openWorkspacePlace(companyId)}
      />
    );
  }

  if (place === "money") {
    return placeShell(<MoneyPage onBack={() => changePlace("home")} onOpenCompany={(companyId) => openWorkspacePlace(companyId)} />);
  }

  if (place === "paperwork") {
    return placeShell(
      <PaperworkPage
        key={paperworkEntry.key}
        initialCompanyId={paperworkEntry.companyId}
        initialDocId={paperworkEntry.docId}
        onBack={() => changePlace("home")}
        onDocument={(docId) => setPaperworkEntry((current) => (current.docId === docId ? current : { ...current, docId }))}
        onCompany={(companyId) => setPaperworkEntry((current) => (current.companyId === companyId ? current : { ...current, companyId }))}
      />
    );
  }

  if (place === "home") {
    return placeShell(
      <>
        <HomeCourt
          snapshot={snapshot}
          actor={authState.actor}
          onOpenCompany={openCompanyById}
          onOpenMoney={() => changePlace("money")}
          onOpenTasks={(options = {}) => openTasksPlace({ scope: options.scope || "mine", taskId: options.taskId || "" })}
          onOpenAllTasks={(options = {}) => openTasksPlace({ scope: "all", taskId: options.taskId || "" })}
          onAddTask={() => openTasksPlace({ scope: "mine", create: true })}
          onOpenPipeline={() => changePlace("pipeline")}
          onOpenCompanies={() => openWorkspacePlace()}
          onOpenFilm={(options) => openFilmPlace(options)}
          onOpenAgent={() => setAssistantOpen(true)}
          onOpenMonitor={() => { setMonitorEntry({ siteId: "" }); changePlace("monitor"); }}
          taskTick={taskTick}
        />
        <ActionDrawer dossier={openDossierId ? dossierById.get(openDossierId) : null} onClose={() => setOpenDossierId(null)} onOpenWorkspace={(id) => { setOpenDossierId(null); openWorkspacePlace(id); }} />
      </>
    );
  }

  return null;
}
