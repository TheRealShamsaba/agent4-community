import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, ArrowRight, Check, CircleAlert, Copy, ExternalLink, Gauge, LoaderCircle, Lock, PauseCircle, Pencil, PlayCircle, Plus, RefreshCw, Search, Trash2, TriangleAlert, Users, X } from "lucide-react";
import { relativeTime } from "../format.js";

/* Every site you have built, and whether it needs you. A site is up or it is
   not; its certificate is fine or it is about to lapse; the page does the
   search basics or it does not; people are visiting or nobody has been; and
   things are breaking in browsers or they are not. The list answers "is
   anything on fire" in one look, and each site answers the rest. */

async function monitorRequest(pathname, options = {}) {
  const response = await fetch(`/api/monitor${pathname}`, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : undefined
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "That did not go through.");
  return body;
}

function statusOf(site) {
  if (site.paused) return { id: "paused", label: "Paused" };
  if (site.status === "down") return { id: "down", label: "Down" };
  if (site.status === "up") return { id: "up", label: "Up" };
  return { id: "unknown", label: "Checking" };
}

function needsAttention(site) {
  return site.status === "down" || (site.sslDays != null && site.sslDays <= 14) || site.errors7 > 0 || (site.seoScore != null && site.seoScore < 60);
}

function Spark({ values, label }) {
  const max = Math.max(1, ...values);
  const width = 120;
  const height = 32;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - 3 - (value / max) * (height - 6)).toFixed(1)}`).join(" ");
  return (
    <svg className="mn-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SiteCard({ site, onOpen }) {
  const status = statusOf(site);
  return (
    <button type="button" className={`mn-card is-${status.id}${needsAttention(site) ? " has-flag" : ""}`} onClick={() => onOpen(site.id)}>
      <span className="mn-card__head">
        <i className={`mn-dot is-${status.id}`} aria-hidden="true" />
        <span><strong dir="auto">{site.name}</strong><small>{site.host}</small></span>
        <em className={`mn-badge is-${status.id}`}>{status.label}</em>
      </span>
      <span className="mn-card__stats">
        <span><small>Uptime</small><b>{site.uptime.percent != null ? `${site.uptime.percent}%` : "–"}</b></span>
        <span><small>Response</small><b>{site.lastMs != null ? `${site.lastMs} ms` : "–"}</b></span>
        <span><small>Visitors 7d</small><b>{site.tracking ? site.visitors7 : "–"}</b></span>
        <span><small>Search</small><b className={site.seoScore != null ? (site.seoScore >= 80 ? "is-good" : site.seoScore >= 60 ? "is-fair" : "is-poor") : ""}>{site.seoScore != null ? site.seoScore : "–"}</b></span>
      </span>
      <span className="mn-card__foot">
        {site.tracking ? <Spark values={site.trend} label={`Visitors over the last 7 days: ${site.trend.join(", ")}`} /> : <span className="mn-card__untracked">Not counting visitors yet</span>}
        <span className="mn-card__flags">
          {site.status === "down" ? <span className="is-bad"><CircleAlert size={12} /> since {relativeTime(site.downSince).replace(" ago", "")}</span> : null}
          {site.sslDays != null && site.sslDays <= 14 ? <span className="is-warn"><Lock size={12} /> {site.sslDays <= 0 ? "Expired" : `${site.sslDays}d`}</span> : null}
          {site.errors7 > 0 ? <span className="is-warn"><TriangleAlert size={12} /> {site.errorKinds7} {site.errorKinds7 === 1 ? "error" : "errors"}</span> : null}
        </span>
      </span>
    </button>
  );
}

function Bars({ series }) {
  const max = Math.max(1, ...series.map((day) => day.views));
  const width = 600;
  const height = 120;
  const slot = width / series.length;
  return (
    <svg className="mn-bars" viewBox={`0 0 ${width} ${height + 18}`} role="img" aria-label="Page views and visitors for the last 30 days">
      {series.map((day, index) => {
        const viewsHeight = (day.views / max) * height;
        const visitorsHeight = (day.visitors / max) * height;
        const x = index * slot + slot * 0.18;
        const barWidth = slot * 0.64;
        return (
          <g key={day.day}>
            <title>{`${day.day}: ${day.visitors} visitors, ${day.views} views`}</title>
            <rect className="mn-bars__views" x={x} y={height - viewsHeight} width={barWidth} height={Math.max(viewsHeight, day.views ? 2 : 0)} rx="2" />
            <rect className="mn-bars__visitors" x={x} y={height - visitorsHeight} width={barWidth} height={Math.max(visitorsHeight, day.visitors ? 2 : 0)} rx="2" />
          </g>
        );
      })}
      <text x="0" y={height + 14} className="mn-bars__axis">{series[0]?.day.slice(5)}</text>
      <text x={width} y={height + 14} textAnchor="end" className="mn-bars__axis">{series.at(-1)?.day.slice(5)}</text>
    </svg>
  );
}

function UptimeStrip({ checks }) {
  if (!checks.length) return <p className="mn-quiet">The first check is on its way.</p>;
  return (
    <div className="mn-strip" role="img" aria-label={`The last ${checks.length} checks: ${checks.filter((check) => !check.ok).length} failed`}>
      {checks.slice(-90).map((check) => <i key={check.at} className={check.ok ? "is-ok" : "is-bad"} title={`${new Date(check.at).toLocaleString()} · ${check.ok ? `${check.ms} ms` : check.error}`} />)}
    </div>
  );
}

function SeoCard({ seo }) {
  if (!seo) return <p className="mn-quiet">The first search check runs within a few minutes.</p>;
  const tone = seo.score >= 80 ? "good" : seo.score >= 60 ? "fair" : "poor";
  return (
    <div className="mn-seo">
      <div className={`mn-seo__score is-${tone}`}><strong>{seo.score}</strong><small>out of 100</small></div>
      <div className="mn-seo__body">
        {seo.issues.length ? (
          <ul>
            {seo.issues.map((issue) => (
              <li key={issue.id} className={`is-${issue.severity}`}>
                <b>{issue.title}</b>
                <small>{issue.detail}</small>
              </li>
            ))}
          </ul>
        ) : <p className="mn-quiet"><Check size={14} /> Every basic is in place.</p>}
        <p className="mn-quiet">Checked {relativeTime(seo.at)}. This reads the page itself, not how it ranks.</p>
      </div>
    </div>
  );
}

/* Reports that reached HQ and were turned away, and why. The one thing worse
   than a counter that stays at zero is not knowing whether the page ever
   spoke. */
function Ignored({ site, rows }) {
  const wrongHost = rows.filter((row) => row.reason === "domain");
  const bots = rows.filter((row) => row.reason === "bot");
  if (!wrongHost.length && !bots.length) return null;
  return (
    <div className="mn-ignored" role="note">
      <strong><CircleAlert size={14} /> HQ heard from your page, but ignored it</strong>
      <ul>
        {wrongHost.map((row) => (
          <li key={`${row.reason}-${row.host}`}>
            {row.host === "no address"
              ? <>A report arrived with no website address attached, so HQ could not tell which site sent it. This happens when the page hides where it is from (a strict referrer policy).</>
              : <>{row.count} {row.count === 1 ? "report" : "reports"} came from <b>{row.host}</b>, but this site is registered as <b>{site.host}</b>. HQ only counts reports from the address it was given. If <b>{row.host}</b> is the real address, press the pencil and change this site's address to it.</>}
          </li>
        ))}
        {bots.map((row) => <li key={`${row.reason}-${row.host}`}>{row.count} {row.count === 1 ? "visit" : "visits"} from robots were ignored. That is normal.</li>)}
      </ul>
    </div>
  );
}

function Snippet({ site }) {
  const [copied, setCopied] = useState(false);
  const code = `<script defer src="${window.location.origin}/m.js" data-site="${site.token}"></script>`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* the code is on screen to select by hand */ }
  }
  return (
    <div className="mn-snippet">
      <p>Paste this once, just before <code>&lt;/head&gt;</code> on every page of {site.name}. This site is registered as <b>{site.host}</b>, and only visits to that address are counted. It counts visitors and catches browser errors. No cookies, nothing personal, and nothing for people who have asked not to be tracked.</p>
      <pre><code>{code}</code></pre>
      <button type="button" className="btn" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy snippet"}</button>
    </div>
  );
}

function SiteDialog({ site, companies, onClose, onSaved }) {
  const [name, setName] = useState(site?.name || "");
  const [url, setUrl] = useState(site?.url || "");
  const [companyId, setCompanyId] = useState(site?.companyId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const company = companies.find((item) => item.id === companyId);
      const body = { name, url, companyId: company?.id || "", companyName: company?.name || "" };
      const saved = site
        ? await monitorRequest(`/sites/${site.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await monitorRequest("/sites", { method: "POST", body: JSON.stringify(body) });
      onSaved(saved.site);
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  }

  return (
    <div className="mn-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="mn-dialog" role="dialog" aria-modal="true" aria-label={site ? "Edit site" : "Add a site"} onSubmit={submit}>
        <header><h2>{site ? "Edit site" : "Add a site"}</h2><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <label>Address<input autoFocus required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="studio.example.com" inputMode="url" /></label>
        <label>Name <small>Optional</small><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Sample Studio" dir="auto" /></label>
        <label>Client <small>Optional</small>
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">No client</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </label>
        {error ? <p className="mn-error" role="alert">{error}</p> : null}
        <footer>
          <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--gold" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />} {site ? "Save" : "Start watching"}</button>
        </footer>
      </form>
    </div>
  );
}

function Detail({ siteId, companies, onBack, onOpenCompany, onChanged }) {
  const [state, setState] = useState({ status: "loading", data: null, message: "" });
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setState({ status: "ready", data: await monitorRequest(`/sites/${siteId}`), message: "" });
    } catch (caught) {
      setState((current) => ({ ...current, status: "error", message: caught.message }));
    }
  }, [siteId]);
  useEffect(() => { setState({ status: "loading", data: null, message: "" }); void load(); }, [load]);

  async function run(label, work) {
    setBusy(label);
    setNote("");
    try {
      await work();
      await load();
      onChanged();
    } catch (caught) {
      setNote(caught.message);
    } finally {
      setBusy("");
    }
  }

  if (state.status === "loading") return <p className="mn-quiet"><LoaderCircle className="is-spinning" size={14} /> Opening…</p>;
  if (state.status === "error" && !state.data) return <div className="errorstate" role="alert"><strong>This site could not be read.</strong><p>{state.message}</p><button type="button" className="btn" onClick={() => void load()}>Try again</button></div>;

  const { site, uptime, series, checks, pages, errors, seo, sslDays, rejected = [] } = state.data;
  const status = statusOf(site);
  const visitors = series.reduce((sum, day) => sum + day.visitors, 0);
  const views = series.reduce((sum, day) => sum + day.views, 0);
  const tracking = series.some((day) => day.views > 0);
  const failures = checks.filter((check) => !check.ok).slice(-5).reverse();
  const company = companies.find((item) => item.id === site.companyId);

  return (
    <div className="mn-detail">
      <button type="button" className="mn-back" onClick={onBack}><ArrowLeft size={15} /> Sites</button>
      <header className="mn-detail__head">
        <i className={`mn-dot is-${status.id} is-large`} aria-hidden="true" />
        <div>
          <h1 dir="auto">{site.name}</h1>
          <p>
            <a href={site.url} target="_blank" rel="noreferrer noopener">{site.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} <ExternalLink size={12} /></a>
            <em className={`mn-badge is-${status.id}`}>{status.id === "down" ? `Down since ${relativeTime(site.downSince).replace(" ago", "")}` : status.label}</em>
            {company ? <button type="button" className="mn-company" onClick={() => onOpenCompany(company.id)}>{company.name} <ArrowRight size={12} /></button> : null}
          </p>
        </div>
        <div className="mn-detail__actions">
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void run("check", () => monitorRequest(`/sites/${site.id}/check`, { method: "POST" }))}>{busy === "check" ? <LoaderCircle className="is-spinning" size={14} /> : <RefreshCw size={14} />} Check now</button>
          <button type="button" className="btn btn--icon" aria-label={site.paused ? "Resume checking" : "Pause checking"} title={site.paused ? "Resume checking" : "Pause checking"} disabled={Boolean(busy)} onClick={() => void run("pause", () => monitorRequest(`/sites/${site.id}`, { method: "PATCH", body: JSON.stringify({ paused: !site.paused }) }))}>{site.paused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}</button>
          <button type="button" className="btn btn--icon" aria-label="Edit site" onClick={() => setEditing(true)}><Pencil size={15} /></button>
          <button type="button" className="btn btn--icon btn--danger" aria-label="Stop watching this site" onClick={() => { if (window.confirm(`Stop watching ${site.name}? Its history and visitor counts are deleted.`)) void run("remove", async () => { await monitorRequest(`/sites/${site.id}`, { method: "DELETE" }); onBack(); }); }}><Trash2 size={15} /></button>
        </div>
      </header>
      {note ? <p className="mn-error" role="alert">{note}</p> : null}

      <div className="mn-tiles">
        <div><small>Uptime · 30 days</small><strong className={uptime.percent != null && uptime.percent < 99 ? "is-warn" : ""}>{uptime.percent != null ? `${uptime.percent}%` : "–"}</strong><span>{uptime.checks} {uptime.checks === 1 ? "check" : "checks"}</span></div>
        <div><small>Response</small><strong>{uptime.avgMs != null ? `${uptime.avgMs} ms` : "–"}</strong><span>average</span></div>
        <div><small>Visitors · 30 days</small><strong>{tracking ? visitors : "–"}</strong><span>{tracking ? `${views} page views` : "not counting yet"}</span></div>
        <div><small>Search basics</small><strong className={seo ? (seo.score >= 80 ? "is-good" : seo.score >= 60 ? "is-fair" : "is-poor") : ""}>{seo ? `${seo.score}` : "–"}</strong><span>{seo ? `${seo.issues.length} to fix` : "checking"}</span></div>
        <div><small>Certificate</small><strong className={sslDays != null && sslDays <= 14 ? "is-warn" : ""}>{sslDays != null ? `${sslDays} days` : "–"}</strong><span>{sslDays != null ? "until it expires" : "n/a"}</span></div>
        <div><small>Errors · 7 days</small><strong className={errors.length ? "is-warn" : ""}>{errors.length}</strong><span>{errors.length ? (errors.length === 1 ? "kind" : "kinds") : "none seen"}</span></div>
      </div>

      <section className="mn-section">
        <header><h2><Users size={16} /> Visitors</h2><span className="mn-legend"><i className="is-visitors" /> Visitors <i className="is-views" /> Page views</span></header>
        <Ignored site={site} rows={rejected} />
        {tracking ? <Bars series={series} /> : <Snippet site={site} />}
        {tracking && pages.length ? (
          <ul className="mn-pages">{pages.map((page) => <li key={page.path}><code>{page.path}</code><b>{page.views}</b></li>)}</ul>
        ) : null}
      </section>

      <section className="mn-section">
        <header><h2><Activity size={16} /> Uptime</h2><small>Checked every 5 minutes{site.paused ? " · paused" : ""}</small></header>
        <UptimeStrip checks={checks} />
        {failures.length ? (
          <ul className="mn-failures">{failures.map((check) => <li key={check.at}><CircleAlert size={14} /><span>{check.error}</span><time>{relativeTime(check.at)}</time></li>)}</ul>
        ) : null}
      </section>

      <section className="mn-section">
        <header><h2><Gauge size={16} /> Search basics</h2></header>
        <SeoCard seo={seo} />
      </section>

      <section className="mn-section">
        <header><h2><TriangleAlert size={16} /> Browser errors</h2><small>{tracking ? "Reported by your visitors' browsers" : "Needs the snippet below"}</small></header>
        {errors.length ? (
          <ul className="mn-errors">
            {errors.map((error) => (
              <li key={error.id}>
                <span><b dir="auto">{error.message}</b><small>{[error.page, error.source ? `${error.source.split("/").pop()}${error.line ? `:${error.line}` : ""}` : "", `last ${relativeTime(error.lastAt)}`].filter(Boolean).join(" · ")}</small></span>
                <em>{error.count}×</em>
                <button type="button" className="btn btn--quiet" aria-label="Dismiss this error" onClick={() => void run("dismiss", () => monitorRequest(`/errors/${error.id}`, { method: "DELETE" }))}><Check size={14} /></button>
              </li>
            ))}
          </ul>
        ) : <p className="mn-quiet">{tracking ? "No errors reported. Nothing is breaking in anyone's browser." : "Once the snippet is on the site, anything that breaks for a visitor shows up here."}</p>}
      </section>

      {tracking ? <section className="mn-section"><header><h2>Tracking snippet</h2></header><Snippet site={site} /></section> : null}

      {editing ? <SiteDialog site={site} companies={companies} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); onChanged(); }} /> : null}
    </div>
  );
}

export function MonitorPage({ initialSiteId = "", onSelectSite, onOpenCompany }) {
  const [state, setState] = useState({ status: "loading", sites: [], message: "" });
  const [companies, setCompanies] = useState([]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const selected = initialSiteId;

  const load = useCallback(async () => {
    try {
      setState({ status: "ready", sites: (await monitorRequest("/sites")).sites, message: "" });
    } catch (caught) {
      setState((current) => ({ ...current, status: "error", message: caught.message }));
    }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(load, 60_000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => {
    fetch("/api/workspaces").then((response) => (response.ok ? response.json() : { companies: [] })).then((body) => setCompanies((body.companies || []).filter((company) => !company.hidden && company.kind !== "internal"))).catch(() => {});
  }, []);

  const shown = useMemo(() => {
    const wanted = query.trim().toLocaleLowerCase();
    const list = wanted ? state.sites.filter((site) => `${site.name} ${site.host} ${site.companyName}`.toLocaleLowerCase().includes(wanted)) : state.sites;
    return [...list].sort((left, right) => Number(needsAttention(right)) - Number(needsAttention(left)) || left.name.localeCompare(right.name));
  }, [query, state.sites]);

  const down = state.sites.filter((site) => site.status === "down").length;
  const flagged = state.sites.filter(needsAttention).length;
  const summary = !state.sites.length ? "Add the sites you have built and I will watch them." : down ? `${down} ${down === 1 ? "site is" : "sites are"} down.` : flagged ? `${state.sites.length - flagged} of ${state.sites.length} healthy. ${flagged} ${flagged === 1 ? "needs" : "need"} a look.` : `All ${state.sites.length} ${state.sites.length === 1 ? "site is" : "sites are"} healthy.`;

  return (
    <main className="court mn">
      <div className="mn-wrap">
        {selected ? (
          <Detail siteId={selected} companies={companies} onBack={() => onSelectSite("")} onOpenCompany={onOpenCompany} onChanged={load} />
        ) : (
          <>
            <header className="mn-head">
              <div>
                <h1>Sites</h1>
                <p className={down ? "is-bad" : flagged ? "is-warn" : ""}>{state.status === "loading" ? "Reading your sites…" : summary}</p>
              </div>
              {state.sites.length > 5 ? <label className="mn-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a site" aria-label="Find a site" /></label> : null}
              <button type="button" className="btn btn--gold btn--lg" onClick={() => setAdding(true)}><Plus size={16} /> Add site</button>
            </header>
            {state.status === "error" && !state.sites.length ? <div className="errorstate" role="alert"><strong>The sites could not be read.</strong><p>{state.message}</p><button type="button" className="btn" onClick={() => void load()}>Try again</button></div> : null}
            {state.status === "ready" && !state.sites.length ? (
              <div className="mn-empty">
                <Activity size={28} aria-hidden="true" />
                <h2>Watch the sites you have built</h2>
                <p>Add a site and Agent4 checks it every five minutes, tells you on Telegram the moment it goes down, reads its search basics, and with one line of code counts visitors and catches errors.</p>
                <button type="button" className="btn btn--gold btn--lg" onClick={() => setAdding(true)}><Plus size={16} /> Add your first site</button>
              </div>
            ) : null}
            {shown.length ? <div className="mn-grid">{shown.map((site) => <SiteCard key={site.id} site={site} onOpen={onSelectSite} />)}</div> : null}
          </>
        )}
      </div>
      {adding ? <SiteDialog companies={companies} onClose={() => setAdding(false)} onSaved={(site) => { setAdding(false); void load(); onSelectSite(site.id); }} /> : null}
    </main>
  );
}
