import { localIsoDate } from "./local-date.js";
import { templateSummaries } from "./questionnaire-templates.js";

/*
 * The owner's side of client pages: make and end links, and publish or
 * withdraw a weekly update. Only the owner reaches this; the server checks
 * that before it calls anything here.
 *
 * What a client reads is decided here, on the server, from the stored
 * document. The browser never sends the text that gets published, so what
 * went out is exactly what was saved and nothing a page could add to it.
 */

/* An update is a short note, the steps, or both. Everything else (what is
   stuck, the next step and its date, what we need) is there when there is
   something to say, so a thin week still gets its update out. */
const SNAPSHOT_REQUIRED = [["weekOf", "the week it covers"]];

function clip(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

function day(value) {
  const candidate = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const date = new Date(`${candidate}T12:00:00Z`);
  // 2026-02-31 parses as 3 March; only a day that exists is a day.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === candidate ? candidate : "";
}

/** Only an http(s) address with nothing in it that could leave an attribute. */
function webLink(value) {
  const candidate = clip(value, 500);
  return /^https?:\/\/[^\s"'<>`]+\.[^\s"'<>`]+$/i.test(candidate) ? candidate : "";
}

/**
 * The client-facing copy of a weekly update. Only these fields exist in it, so
 * nothing else a document might carry can reach a client page.
 */
const PIECE_STATE_VALUES = new Set(["done", "half", "todo", "waiting"]);

export function buildUpdateSnapshot(values = {}) {
  const need = (Array.isArray(values.need) ? values.need : [])
    .filter(Array.isArray)
    .slice(0, 20)
    .map((row) => [clip(row[0], 200), clip(row[1], 120), clip(row[2], 60)])
    .filter((row) => row[0]);
  // Each piece is a name and one of four states, a row without both is not
  // drawn; then optional due/link/start fields. Start lets real schedules show
  // parallel work instead of pretending every phase is consecutive.
  const pieces = (Array.isArray(values.pieces) ? values.pieces : [])
    .filter(Array.isArray)
    .slice(0, 24)
    .map((row) => [clip(row[0], 80), PIECE_STATE_VALUES.has(row[1]) ? row[1] : "", day(row[2]), webLink(row[3]), day(row[4])])
    .filter((row) => row[0] && row[1]);
  const payload = {
    weekOf: day(values.weekOf),
    moved: clip(values.moved, 4000),
    stuck: clip(values.stuck, 4000),
    need,
    nextStep: clip(values.nextStep, 300),
    nextDate: day(values.nextDate),
    moneyNote: clip(values.moneyNote, 1000),
    pieces
  };
  const missing = SNAPSHOT_REQUIRED.filter(([key]) => !payload[key]).map(([, label]) => label);
  if (!payload.moved && !payload.pieces.length) missing.push("a short note or the steps");
  return { payload, missing };
}

/** What the owner types on the Clients screen, turned into a weekly update's answers. */
function postedValues(input, weekOf) {
  const rows = (value, limit) => (Array.isArray(value) ? value : []).filter(Array.isArray).slice(0, limit);
  return {
    weekOf,
    moved: clip(input.note, 4000),
    stuck: clip(input.stuck, 4000),
    need: rows(input.need, 20).map((row) => [clip(row[0], 200), "", day(row[1]) || clip(row[1], 60)]).filter((row) => row[0]),
    pieces: rows(input.steps, 24).map((row) => [clip(row[0], 80), PIECE_STATE_VALUES.has(row[1]) ? row[1] : "todo", day(row[2]), webLink(row[3]), day(row[4])]).filter((row) => row[0]),
    nextStep: clip(input.nextStep, 300),
    nextDate: day(input.nextDate),
    moneyNote: clip(input.moneyNote, 1000)
  };
}

function serialize(link, baseUrl) {
  return { ...link, url: baseUrl ? `${baseUrl}/c/${link.token}` : "" };
}

export function createClientApi({ config, linkStore, paperworkStore, workspaceStore, questionnaireStore = null, now = () => new Date() }) {
  const baseUrl = String(config.runtime.clientPagesUrl || "").replace(/\/$/, "");
  const enabled = () => Boolean(config.runtime.clientPagesEnabled);

  const ok = (body, status = 200) => ({ status, body });
  const fail = (status, code, message) => ({ status, body: { error: { code, message } } });
  const off = () => fail(409, "client_pages_off", "Client pages are switched off on this server, so a link would not open. Set AGENT4_CLIENT_PAGES=true and restart HQ.");

  function companyProjects(companyId) {
    return workspaceStore.projectsFor(companyId);
  }

  /** A link can only show projects that belong to its own company. */
  function ownProjectIds(companyId, ids) {
    if (ids === undefined) return undefined;
    const own = new Set(companyProjects(companyId).map((project) => project.id));
    const foreign = (Array.isArray(ids) ? ids : []).filter((id) => !own.has(id));
    if (foreign.length) throw new Error("A link can only show projects of its own company.");
    return ids;
  }

  const api = {
    listLinks(companyId) {
      const company = workspaceStore.getCompany(companyId);
      if (!company) return fail(404, "not_found", "That company no longer exists.");
      return ok({
        enabled: enabled(),
        baseUrl,
        // Owner-only, and only what the screens need to write to this person.
        company: { name: company.name, contactName: company.contactName || "", contactPhone: company.contactPhone || "" },
        links: linkStore.listLinks(company.id).map((link) => ({
          ...serialize(link, baseUrl),
          views: linkStore.viewsFor ? linkStore.viewsFor(link.id) : null,
          questionnaires: questionnaireStore ? questionnaireStore.listForLink(link.id).map((item) => questionnaireStore.summary(item)) : []
        })),
        templates: templateSummaries(),
        projects: companyProjects(company.id).map((project) => ({ id: project.id, name: project.name, status: project.status }))
      });
    },

    createLink(input, actor) {
      if (!enabled()) return off();
      try {
        const companyId = String(input.companyId || "");
        const projectIds = ownProjectIds(companyId, input.projectIds);
        const link = linkStore.createLink({ ...input, projectIds, actorId: actor.id });
        return ok({ link: serialize(link, baseUrl) });
      } catch (error) {
        return fail(400, "client_link_rejected", error.message);
      }
    },

    updateLink(id, input) {
      try {
        const existing = linkStore.getLink(id);
        if (!existing) return fail(404, "not_found", "That link no longer exists.");
        const projectIds = ownProjectIds(existing.companyId, input.projectIds);
        return ok({ link: serialize(linkStore.updateLink(id, { ...input, projectIds }), baseUrl) });
      } catch (error) {
        return fail(400, "client_link_rejected", error.message);
      }
    },

    revokeLink(id) {
      try {
        return ok({ link: serialize(linkStore.revokeLink(id), baseUrl) });
      } catch (error) {
        return fail(404, "not_found", error.message);
      }
    },

    /** Send one of the question sets to one person's link. */
    sendQuestionnaire(linkId, input, actor) {
      if (!questionnaireStore) return fail(501, "not_available", "Questionnaires are not available on this server.");
      if (!enabled()) return off();
      const link = linkStore.getLink(linkId);
      if (!link) return fail(404, "not_found", "That link no longer exists.");
      if (link.state !== "active") return fail(400, "link_ended", "That link has ended, so they could not open a questionnaire on it.");
      try {
        const questionnaire = questionnaireStore.create({
          linkId: link.id,
          companyId: link.companyId,
          templateId: String(input?.templateId || ""),
          language: input?.language || link.language,
          actorId: actor.id
        });
        try {
          workspaceStore.addCompanyEvent({
            companyId: link.companyId,
            type: "questionnaire",
            detail: `Sent "${questionnaire.title}" to ${link.label || "the client"}'s page`,
            actorId: actor.id
          });
        } catch {
          // The history line is a courtesy; the questionnaire is sent either way.
        }
        return ok({ questionnaire: questionnaireStore.summary(questionnaire) });
      } catch (error) {
        return fail(400, "questionnaire_rejected", error.message);
      }
    },

    /** The questions and every answer, for the owner to read. */
    getQuestionnaire(id) {
      const questionnaire = questionnaireStore?.get(id);
      return questionnaire ? ok({ questionnaire }) : fail(404, "not_found", "That questionnaire no longer exists.");
    },

    /**
     * The owner types in what a client said on a call. Same rules as the
     * client's own answers: only questions that exist, cleaned and capped.
     * `submit` marks it sent, the way the client's Send button would.
     */
    fillQuestionnaire(id, input = {}) {
      if (!questionnaireStore?.get(id)) return fail(404, "not_found", "That questionnaire no longer exists.");
      const answers = input && typeof input.answers === "object" && input.answers ? input.answers : {};
      try {
        const saved = questionnaireStore.saveAnswers(id, { answers, submit: input.submit === true });
        return ok({ questionnaire: saved.questionnaire });
      } catch (error) {
        return fail(400, "questionnaire_rejected", error.message);
      }
    },

    setQuestionnaire(id, action) {
      if (!questionnaireStore?.get(id)) return fail(404, "not_found", "That questionnaire no longer exists.");
      if (action === "remove") {
        questionnaireStore.remove(id);
        return ok({ removed: true });
      }
      const updated = questionnaireStore.setStatus(id, action === "close" ? "closed" : "open");
      return ok({ questionnaire: questionnaireStore.summary(updated) });
    },

    publication(documentId) {
      const document = paperworkStore.getDocument(documentId);
      if (!document) return fail(404, "not_found", "That document no longer exists.");
      const update = linkStore.publicationFor(document.id);
      const activeLinks = document.companyId ? linkStore.listLinks(document.companyId).filter((link) => link.state === "active").length : 0;
      // Published means published for the company the document is for now. One
      // that was moved to another company since is not on the new company's page.
      const live = Boolean(update && !update.withdrawnAt && update.companyId === document.companyId);
      return ok({
        enabled: enabled(),
        baseUrl,
        published: live,
        publishedAt: live ? update.publishedAt : null,
        withdrawnAt: update?.withdrawnAt || null,
        activeLinks
      });
    },

    publish(documentId, actor) {
      if (!enabled()) return off();
      const document = paperworkStore.getDocument(documentId);
      if (!document) return fail(404, "not_found", "That document no longer exists.");
      if (document.type !== "update") return fail(400, "not_an_update", "Only a weekly update can go on a client page.");
      if (document.status === "void") return fail(400, "void_document", "A voided update cannot be published.");
      if (!document.companyId || !workspaceStore.getCompany(document.companyId)) {
        return fail(400, "no_company", "Choose which company this update is for before publishing it.");
      }
      const { payload, missing } = buildUpdateSnapshot(document.values);
      if (missing.length) {
        return fail(400, "update_incomplete", `Before this goes to the client, fill in ${missing.join(", ")}.`);
      }
      const update = linkStore.publishUpdate({
        paperworkId: document.id,
        companyId: document.companyId,
        projectId: document.projectId,
        language: document.language,
        number: document.number,
        payload,
        actorId: actor.id
      });
      // Putting it on the client's page is sending it. The document says so too,
      // unless it already says something stronger.
      let current = document;
      if (document.status === "draft") current = paperworkStore.setStatus(document.id, "sent", { on: localIsoDate(now()) });
      const activeLinks = linkStore.listLinks(document.companyId).filter((link) => link.state === "active").length;
      return ok({ update: { publishedAt: update.publishedAt }, document: current, activeLinks });
    },

    withdraw(documentId) {
      const document = paperworkStore.getDocument(documentId);
      if (!document) return fail(404, "not_found", "That document no longer exists.");
      const update = linkStore.withdrawUpdate(document.id);
      if (!update) return fail(404, "not_published", "That update was never on a client page.");
      return ok({ update: { withdrawnAt: update.withdrawnAt } });
    },

    /* ------------------------------------------- the Clients screen --- */

    /** Every company, whether it has a page, and when we last posted to it. */
    overview() {
      const { companies } = workspaceStore.list();
      const rows = companies.filter((company) => !company.hidden).map((company) => {
        const links = linkStore.listLinks(company.id);
        const active = links.filter((link) => link.state === "active");
        const [latest] = linkStore.publishedUpdates(company.id, { limit: 1 });
        const viewed = active.map((link) => link.lastViewedAt).filter(Boolean).sort().pop() || null;
        return {
          id: company.id,
          name: company.name,
          kind: company.kind,
          stage: company.stage,
          hasPage: active.length > 0,
          ended: !active.length && links.length > 0,
          views: active.reduce((sum, link) => sum + (link.viewCount || 0), 0),
          lastViewedAt: viewed,
          lastPostedAt: latest?.publishedAt || null
        };
      });
      return ok({ enabled: enabled(), baseUrl, companies: rows });
    },

    /** One company's page: its links, what is on it, and where the next update starts from. */
    page(companyId) {
      const listed = api.listLinks(companyId);
      if (listed.status !== 200) return listed;
      const updates = linkStore.publishedUpdates(String(companyId), { limit: 20 }).map((update) => ({
        paperworkId: update.paperworkId,
        number: update.number,
        language: update.language,
        publishedAt: update.publishedAt,
        ...update.payload
      }));
      const [latest] = updates;
      // The next update starts where the last one left off: same steps, same
      // next date, same open asks. Only what moved needs touching.
      const draft = {
        steps: latest?.pieces || [],
        nextStep: latest?.nextStep || "",
        nextDate: latest?.nextDate || "",
        need: (latest?.need || []).map((row) => [row[0], row[2] || ""])
      };
      return ok({ ...listed.body, updates, draft });
    },

    /**
     * Post progress from the Clients screen: steps, a short note, the next
     * date. Behind it is an ordinary weekly update in Paperwork, published the
     * same way, so it prints, lists and withdraws like any other. Passing
     * `paperworkId` corrects an update already posted instead of adding one.
     */
    post(companyId, input = {}, actor) {
      if (!enabled()) return off();
      const company = workspaceStore.getCompany(companyId);
      if (!company) return fail(404, "not_found", "That company no longer exists.");
      const active = linkStore.listLinks(company.id).filter((link) => link.state === "active");
      const language = input.language === "fa" || input.language === "en" ? input.language : active[0]?.language || "en";
      let document = null;
      if (input.paperworkId) {
        document = paperworkStore.getDocument(String(input.paperworkId));
        if (!document || document.type !== "update" || document.companyId !== company.id) {
          return fail(404, "not_found", "That update no longer exists.");
        }
      }
      const values = postedValues(input, document?.values?.weekOf || localIsoDate(now()));
      const { missing } = buildUpdateSnapshot(values);
      if (missing.length) return fail(400, "update_incomplete", `Before this goes to the client, add ${missing.join(", ")}.`);
      try {
        document = document
          ? paperworkStore.updateDocument(document.id, { language, values })
          : paperworkStore.createDocument({
            type: "update",
            companyId: company.id,
            language,
            title: language === "fa" ? "گزارش هفتگی" : "Weekly update",
            values,
            actorId: actor.id
          });
      } catch (error) {
        return fail(400, "update_rejected", error.message);
      }
      const published = api.publish(document.id, actor);
      if (published.status >= 400) return published;
      try {
        workspaceStore.addCompanyEvent({ companyId: company.id, type: "update", detail: input.paperworkId ? "Corrected the update on their client page" : "Posted an update to their client page", actorId: actor.id });
      } catch {
        // The history line is a courtesy; the update is posted either way.
      }
      return ok({ ...published.body, values });
    }
  };
  return api;
}
