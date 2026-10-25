import React, { useEffect } from "react";
import { WORDMARK_INK, WORDMARK_RATIO, WORDMARK_WHITE } from "../brand-wordmark.js";
import { digits, paperDate, pick } from "../paperwork-templates.js";

/* The page a client receives.
   A template answers with blocks — eyebrow, heading, lede, para, kv, table,
   bullets, steps, note, signature, rule. The blocks are the grammar; the
   typography is written here, once, so eight documents stay one company rather
   than becoming eight designs.

   The identity's own rules are the brief: layer evidence over structure, let
   some parts breathe and others feel dense, never chaos without a grid under
   it, and never make an asset look like a system screen. So the page is built
   on the same two-track grid the identity sheets use — a narrow mono label rail
   beside a wide column, hairline between sections — and the marks that carry
   meaning are the ones the identity already owns: a mono filing line, an
   evidence card with a kicker and an accent rule, and one number allowed to be
   enormous. The wordmark sits small at the foot, where it does on every sheet
   in the identity, rather than as a letterhead block at the top.

   Latin is the same neo-grotesk the website sets (Helvetica, falling back to
   Arial) rather than a webfont, because that is the company's voice and it is
   already on every machine that will open this. Persian is Vazirmatn, set
   heavy, because the identity sets Persian bold and large rather than timid. */

const WORDS = {
  en: {
    date: "Date",
    client: "Prepared for",
    sent: "Sent",
    signed: "Signed",
    draft: "DRAFT",
    voided: "VOID",
    sign: "Signature",
    signDate: "Date",
    blank: "Not filled in yet",
    tax: "Tax number",
    creed: "PROOF, NOT PERFORMANCE."
  },
  fa: {
    date: "تاریخ",
    client: "برای",
    sent: "ارسال",
    signed: "امضا شده",
    draft: "پیش‌نویس",
    voided: "باطل",
    sign: "امضا",
    signDate: "تاریخ",
    blank: "هنوز پر نشده",
    tax: "شناسهٔ مالیاتی",
    creed: "PROOF, NOT PERFORMANCE."
  }
};

/* The mark and the wordmark, from the brand files themselves. Inlined rather
   than fetched, because the HQ ships as one self-contained file and a logo
   that arrives over the network is a logo that is missing from the PDF
   somebody made on a plane. The mark is the brand's own vector, in the colours
   of its app icon: a cobalt slash and white letters on graphite. The wordmark
   exists only as an image, so it travels as data. */
export function CompanyMark({ size = 28, className = "" }) {
  return <img className={className} src={WORDMARK_INK} width={size} height={size} alt="Agent4" />;
}

/* "/Your company" It stays Latin in a Persian document, the way a company name
   does. `light` is for the graphite band, the default for paper. */
export function CompanyWordmark({ height = 30, light = false, className = "" }) {
  return (
    <img
      className={className ? `pw-wordmark ${className}` : "pw-wordmark"}
      src={light ? WORDMARK_WHITE : WORDMARK_INK}
      width={Math.round(height * WORDMARK_RATIO)}
      height={height}
      alt="Your company"
    />
  );
}

/* A block that was never answered. On screen it says so, because a draft on a
   desk should show its own holes; in print it disappears, because a gap is
   better than the words "not filled in yet" reaching a client. */
function Gap({ lang }) {
  return <p className="pdoc-gap no-print">{WORDS[lang].blank}</p>;
}

/* The identity labels its cards by what they are — DECISION, OBSERVATION,
   RESULT, NOTE. The tone a template chose already says which. */
const NOTE_KICKER = {
  cobalt: { en: "DECISION", fa: "تصمیم" },
  clay: { en: "OBSERVATION", fa: "مشاهده" },
  moss: { en: "NOTE", fa: "یادداشت" },
  yellow: { en: "MIND THIS", fa: "حواستان باشد" },
  ink: { en: "NOTE", fa: "یادداشت" },
  default: { en: "NOTE", fa: "یادداشت" }
};

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

function Block({ block, lang, accent }) {
  switch (block.kind) {
    case "eyebrow":
      return hasText(block.text) ? <p className="pdoc-eyebrow">{block.text}</p> : null;

    case "heading":
      /* Level one is the template naming the page — a receipt puts the amount
         here. The record's own title is already the h1 above, so these are h2
         and h3 and the document keeps one outline. */
      return block.level === 1
        ? <h2 className="pdoc-h1" dir="auto">{hasText(block.text) ? block.text : "—"}</h2>
        : <h3 className="pdoc-h2" dir="auto">{block.text}</h3>;

    case "lede":
      return hasText(block.text) ? <p className="pdoc-lede" dir="auto">{block.text}</p> : <Gap lang={lang} />;

    case "para":
      return hasText(block.text) ? <p className="pdoc-para" dir="auto">{block.text}</p> : <Gap lang={lang} />;

    case "kv": {
      const rows = (block.rows || []).filter((row) => hasText(row?.label));
      if (!rows.length) return <Gap lang={lang} />;
      return (
        <dl className="pdoc-kv">
          {rows.map((row, index) => (
            <div key={index} className="pdoc-kv-row">
              <dt>{row.label}</dt>
              <dd dir="auto">{hasText(row.value) ? row.value : "—"}</dd>
            </div>
          ))}
        </dl>
      );
    }

    case "table": {
      const rows = (block.rows || []).filter((row) => (row || []).some(hasText));
      if (!rows.length && !block.total) return <Gap lang={lang} />;
      return (
        <div className="pdoc-tablewrap">
          <table className="pdoc-table">
            <thead>
              <tr>{(block.columns || []).map((column, index) => <th key={index} scope="col">{column}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {(block.columns || []).map((column, cell) => (
                    <td key={cell} dir="auto">{hasText(row[cell]) ? row[cell] : "—"}</td>
                  ))}
                </tr>
              ))}
              {/* The total lives in the body. In a tfoot the paged engine treats
                  it as a repeating block and will leave it alone on the next
                  sheet under a header it has repeated for the occasion. */}
              {block.total ? (
                <tr className="pdoc-total-row">
                  <th scope="row" colSpan={Math.max(1, (block.columns || []).length - 1)}>{block.total.label}</th>
                  <td dir="auto">{block.total.value || "—"}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      );
    }

    case "bullets": {
      const items = (block.items || []).filter(hasText);
      if (!items.length) return <Gap lang={lang} />;
      return <ul className="pdoc-bullets">{items.map((item, index) => <li key={index} dir="auto">{item}</li>)}</ul>;
    }

    case "steps": {
      const items = (block.items || []).filter((item) => hasText(item?.title) || hasText(item?.detail));
      if (!items.length) return <Gap lang={lang} />;
      return (
        <ol className="pdoc-steps">
          {items.map((item, index) => (
            <li key={index}>
              <span className="pdoc-step-n" aria-hidden="true">{digits(String(index + 1).padStart(2, "0"), lang)}</span>
              <span className="pdoc-step-body">
                <strong dir="auto">{item.title}</strong>
                {hasText(item.detail) ? <span dir="auto">{item.detail}</span> : null}
              </span>
              {hasText(item.meta) ? <span className="pdoc-step-meta" dir="auto">{item.meta}</span> : null}
            </li>
          ))}
        </ol>
      );
    }

    case "note":
      /* Evidence, laid over the structure. This is the identity's card — a mono
         kicker, the statement, and an accent rule under it — not a tinted
         callout with a rounded corner. It is the one place a document is
         allowed to raise its voice. */
      return hasText(block.text) ? (
        <aside className={`pdoc-card pdoc-card--${block.tone || accent}`}>
          <p className="pdoc-card-kicker" dir="auto">{(NOTE_KICKER[block.tone] || NOTE_KICKER.default)[lang]}</p>
          <p className="pdoc-card-text" dir="auto">{block.text}</p>
          <span className="pdoc-card-rule" aria-hidden="true" />
        </aside>
      ) : null;

    case "signature": {
      const parties = (block.parties || []).filter((party) => hasText(party?.role) || hasText(party?.name));
      if (!parties.length) return null;
      return (
        <div className="pdoc-sign">
          {parties.map((party, index) => (
            <div key={index} className="pdoc-party">
              <span className="pdoc-party-rule" aria-hidden="true" />
              <span className="pdoc-party-meta">{WORDS[lang].sign} · {WORDS[lang].signDate}</span>
              <span className="pdoc-party-role">{party.role}</span>
              <strong className="pdoc-party-name" dir="auto">{hasText(party.name) ? party.name : " "}</strong>
            </div>
          ))}
        </div>
      );
    }

    case "rule":
      return <hr className="pdoc-rule" />;

    case "facts": {
      /* Their own numbers, large. Optional: a brief can stand without them. */
      const items = (block.items || []).filter((item) => hasText(item?.figure));
      if (!items.length) return null;
      return (
        <div className="pdoc-facts">
          {items.map((item, index) => (
            <div key={index} className="pdoc-fact">
              <b dir="auto">{item.figure}</b>
              {hasText(item.text) ? <span dir="auto">{item.text}</span> : null}
            </div>
          ))}
        </div>
      );
    }

    case "shift": {
      /* Today on one side, after on the other: the change the project is for. */
      const rows = (block.rows || []).filter((row) => hasText(row?.[0]) || hasText(row?.[1]));
      if (!rows.length) return null;
      const arrow = lang === "fa" ? "←" : "→";
      return (
        <div className="pdoc-shift">
          <div className="pdoc-shift-head"><span>{block.columns?.[0]}</span><span aria-hidden="true" /><span>{block.columns?.[1]}</span></div>
          {rows.map((row, index) => (
            <div key={index} className="pdoc-shift-row">
              <span className="pdoc-shift-was" dir="auto">{row[0]}</span>
              <i aria-hidden="true">{arrow}</i>
              <span className="pdoc-shift-now" dir="auto">{row[1]}</span>
            </div>
          ))}
        </div>
      );
    }

    case "goal":
      return hasText(block.text) || hasText(block.figure) ? (
        <div className="pdoc-goal">
          {hasText(block.figure) ? <b dir="auto">{block.figure}</b> : null}
          <div>
            <p className="pdoc-goal-label">{block.label}</p>
            {hasText(block.text) ? <p className="pdoc-goal-text" dir="auto">{block.text}</p> : null}
          </div>
        </div>
      ) : null;

    case "solutions": {
      /* Each thing we will do, with the reason beside it. The reason is the
         point: a solution that cannot say why it is there is not one. */
      const items = (block.items || []).filter((item) => hasText(item?.title) || hasText(item?.what));
      if (!items.length) return <Gap lang={lang} />;
      return (
        <ol className="pdoc-sols">
          {items.map((item, index) => (
            <li key={index} className="pdoc-sol">
              <div className="pdoc-sol-head">
                <span className="pdoc-sol-n" aria-hidden="true">{digits(String(index + 1).padStart(2, "0"), lang)}</span>
                <strong dir="auto">{item.title}</strong>
                {hasText(item.lands) ? <span className="pdoc-sol-lands" dir="auto">{item.lands}</span> : null}
              </div>
              <div className="pdoc-sol-cols">
                <div><p className="pdoc-sol-label">{block.labels?.what}</p><p dir="auto">{hasText(item.what) ? item.what : "—"}</p></div>
                <div className="pdoc-sol-why"><p className="pdoc-sol-label">{block.labels?.why}</p><p dir="auto">{hasText(item.why) ? item.why : "—"}</p></div>
              </div>
            </li>
          ))}
        </ol>
      );
    }

    case "paybar": {
      /* The payments drawn to scale, so "40, 30, 30" is something you see. */
      const items = (block.items || []).filter((item) => item?.share > 0);
      if (items.length < 2) return null;
      return (
        <div className="pdoc-paybar">
          {items.map((item, index) => (
            <div key={index} className={`pdoc-pay pdoc-pay--${Math.min(index, 2)}`} style={{ flexGrow: item.share }}>
              <span className="pdoc-pay-when" dir="auto">{item.shareText} · {item.label}</span>
              <b dir="auto">{item.amount}</b>
            </div>
          ))}
        </div>
      );
    }

    default:
      return null;
  }
}

/* An eyebrow opens a section; everything after it belongs to that section until
   the next one. That is what puts the label in the rail and the content in the
   wide column instead of leaving the page as one stack of full-width blocks —
   the grid the identity insists on, rather than a screen printed out. */
function toSections(blocks) {
  const sections = [];
  let current = { label: "", blocks: [] };
  for (const block of blocks) {
    if (block.kind === "eyebrow") {
      if (current.label || current.blocks.length) sections.push(current);
      current = { label: block.text || "", blocks: [] };
      continue;
    }
    if (block.kind === "rule") continue; /* Sections already carry the rule. */
    current.blocks.push(block);
  }
  if (current.label || current.blocks.length) sections.push(current);
  return sections.filter((section) => section.label || section.blocks.length);
}

/* The cover a proposal opens with: graphite, the wordmark, what changes for
   them as the headline, and what is inside. It is its own sheet on paper. */
function Cover({ cover, record, kind, lang, words }) {
  const rtl = lang === "fa";
  const toc = (cover.toc || []).filter(hasText);
  return (
    <header className="pdoc-cover">
      <div className="pdoc-cover-top">
        <CompanyWordmark height={30} light />
        <p className="pdoc-filing-left">
          <span className="pdoc-filing-kind" dir="auto">{kind}</span>
          <i aria-hidden="true">/</i>
          <span dir="ltr">{record.number}</span>
          {record.status === "draft" || record.status === "void" ? <span className={`pdoc-stamp pdoc-stamp--${record.status}`}>{record.status === "draft" ? words.draft : words.voided}</span> : null}
        </p>
      </div>
      <div className="pdoc-cover-mid">
        {hasText(cover.kicker) ? <p className="pdoc-cover-for" dir="auto">{cover.kicker}</p> : null}
        <h1 className="pdoc-cover-title" dir="auto">{hasText(cover.title) ? cover.title : record.title}{endsInPunctuation(cover.title || record.title) ? null : <span className="pdoc-dot" aria-hidden="true">.</span>}</h1>
      </div>
      {toc.length ? (
        <ol className="pdoc-cover-toc">
          {toc.map((item, index) => (
            <li key={index}><b>{digits(String(index + 1).padStart(2, "0"), lang)}</b><span dir="auto">{item}</span></li>
          ))}
        </ol>
      ) : null}
      <div className="pdoc-cover-foot">
        <span dir="auto">{rtl ? paperDate(paperOn(record), "fa") : paperDate(paperOn(record), "en")}</span>
        {hasText(cover.holds) ? <span dir="auto">{cover.holds}</span> : null}
      </div>
    </header>
  );
}

/* The title takes the site's cobalt full stop, unless it already ends in its own. */
function endsInPunctuation(text) {
  return /[.!?…؟:]\s*$/.test(String(text || "").trim()) || !String(text || "").trim();
}

/* The date the page carries is the date the thing actually happened: signed
   beats sent beats written. A proposal drafted in June and signed in September
   was signed in September. */
function paperOn(record) {
  return record.signedOn || record.sentOn || String(record.createdAt || "").slice(0, 10);
}

/**
 * The paper.
 *
 * `document` is renamed on the way in so that the global stays reachable — the
 * print class below is set on the real document root, and a prop called
 * `document` would have quietly shadowed it.
 */
export function PaperworkDoc({ document: record, template, profile, lang }) {
  const language = lang === "fa" ? "fa" : "en";
  const words = WORDS[language];
  const rtl = language === "fa";
  const accent = template?.accent || "ink";
  const detail = rtl ? (profile?.detailFa || profile?.detail) : (profile?.detail || profile?.detailFa);
  const payTo = rtl ? (profile?.payToFa || profile?.payTo) : (profile?.payTo || profile?.payToFa);
  const issuer = profile?.name || "Your company";

  /* Printing is scoped to this class, exactly the way InvoiceDoc scopes its
     own. Two documents that both hid `body *` on every print is how printing a
     third surface came out blank; each one only bites while it is on screen. */
  useEffect(() => {
    window.document.documentElement.classList.add("is-printing-paperwork");
    return () => window.document.documentElement.classList.remove("is-printing-paperwork");
  }, []);

  let blocks = [];
  let failed = "";
  try {
    blocks = template?.render?.(record.values || {}, language, { profile, companyName: record.companyName, document: record }) || [];
  } catch (error) {
    /* A half-filled draft must never take the editor down with it — the answers
       are still safe on the server and the form beside this is still usable. */
    failed = error.message || "This document could not be laid out.";
  }

  const cover = blocks[0]?.kind === "cover" ? blocks[0] : null;
  const sections = toSections(cover ? blocks.slice(1) : blocks);
  const kind = pick(template?.name, language) || record.type;

  return (
    <article className={`pdoc pdoc--${accent}${cover ? " pdoc--has-cover" : ""}`} dir={rtl ? "rtl" : "ltr"} lang={language}>
      {/* Every sheet carries its number at the foot, so page four of a scope
          agreement is still identifiable once it has left the stapler. */}
      <div className="pdoc-runner" aria-hidden="true" dir="ltr">{issuer} · {record.number}</div>

      {/* The band. The first thing on the page is the company, the way the
          website opens: graphite, the mark, and the filing line on the other
          side, with the cobalt line under it. */}
      {cover ? <Cover cover={cover} record={record} kind={kind} lang={language} words={words} /> : null}

      {cover ? null : <header className="pdoc-band">
        <span className="pdoc-band-brand"><CompanyWordmark height={24} light /></span>
        <span className="pdoc-band-meta">
          <p className="pdoc-filing-left">
            <span className="pdoc-filing-kind" dir="auto">{kind}</span>
            <i aria-hidden="true">/</i>
            <span dir="ltr">{record.number}</span>
            <i aria-hidden="true">/</i>
            <span dir="auto">{rtl ? paperDate(paperOn(record), "fa") : paperDate(paperOn(record), "en").toUpperCase()}</span>
          </p>
          {record.status === "draft" || record.status === "void" ? (
            <p className={`pdoc-stamp pdoc-stamp--${record.status}`}>{record.status === "draft" ? words.draft : words.voided}</p>
          ) : null}
        </span>
      </header>}

      {/* The opening breathes: the client, then the title at full size, then
          the one paragraph. Density comes later, in the tables. */}
      {cover ? null : <div className="pdoc-open">
        {record.companyName ? (
          <p className="pdoc-for"><span>{words.client}</span><strong dir="auto">{record.companyName}</strong></p>
        ) : null}
        <h1 className="pdoc-title" dir="auto">{record.title}{endsInPunctuation(record.title) ? null : <span className="pdoc-dot" aria-hidden="true">.</span>}</h1>
      </div>}

      <div className="pdoc-body">
        {failed ? (
          <p className="pdoc-para" role="alert">{failed}</p>
        ) : sections.map((section, index) => (
          <section className={section.label ? "pdoc-sec" : "pdoc-sec pdoc-sec--open"} key={index}>
            {/* A section with no label has nothing to put in the rail, and an
                empty rail reads as a mistake rather than as space. It runs the
                full measure instead. */}
            {section.label ? <p className="pdoc-sec-label" dir="ltr">{section.label}</p> : null}
            <div className="pdoc-sec-body">
              {section.blocks.map((block, at) => <Block key={at} block={block} lang={language} accent={accent} />)}
            </div>
          </section>
        ))}
      </div>

      <footer className="pdoc-foot">
        <div className="pdoc-foot-co">
          <CompanyWordmark height={30} />
          <div>
            {detail ? <p dir="auto">{detail}</p> : null}
            {payTo ? <p dir="auto">{payTo}</p> : null}
            {profile?.taxId ? <p dir="auto">{words.tax} {digits(profile.taxId, language)}</p> : null}
            {profile?.footer ? <p dir="auto">{profile.footer}</p> : null}
          </div>
        </div>
        <p className="pdoc-creed" dir="ltr">{words.creed}</p>
      </footer>
    </article>
  );
}
