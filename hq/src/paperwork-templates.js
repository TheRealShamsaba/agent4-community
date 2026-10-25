/* Your company paperwork.
   Every document a client ever receives from Your company is defined here: the
   questions it asks, and how those answers become a page. Nothing that reaches
   a client should be typed into a fresh file again — the point is that the
   paper is always ready and always the same.

   A template has two halves. `fields` is the form; `render(values, lang, ctx)`
   turns the answers into blocks, which PaperworkDoc lays out on Your company
   paper. Keeping layout out of the templates is what stops eight documents
   becoming eight designs.

   Field kinds: text · long · date · money · choice · list (repeating rows)
   Block kinds:
     { kind: "eyebrow", text }                     mono label above a section
     { kind: "heading", text, level }              1 = page title, 2 = section
     { kind: "para", text }                        one paragraph
     { kind: "lede", text }                        the one sentence that carries the page
     { kind: "kv", rows: [{ label, value }] }      a definition block
     { kind: "table", columns: [], rows: [[]], total? }
     { kind: "bullets", items: [] }
     { kind: "steps", items: [{ title, detail, meta }] }  numbered, for phases
     { kind: "note", tone, text }                  a marked aside — the human voice
     { kind: "signature", parties: [{ role, name }] }
     { kind: "rule" }
   Every block's text is already in the right language: render() picks. */

export const PAPER_ACCENTS = ["cobalt", "clay", "moss", "yellow", "ink"];

/* Persian digits, because a document in Persian with Latin numerals reads like
   a translation rather than a document. */
const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
export function digits(value, lang) {
  const text = String(value ?? "");
  return lang === "fa" ? text.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]) : text;
}

export function pick(value, lang) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return value[lang] || value.en || "";
}

export function money(amount, currency, lang) {
  if (!Number.isFinite(Number(amount))) return "";
  const grouped = new Intl.NumberFormat(lang === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 0 }).format(Math.round(Number(amount)));
  return currency ? `${grouped} ${currency}` : grouped;
}

/* A date on a client document is written out, never left as an ISO string. */
export function paperDate(iso, lang) {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (lang === "fa") return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long", year: "numeric" }).format(date);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

const T = (en, fa) => ({ en, fa });

/* ------------------------------------------------------------- proposal --- */
/* The reference template. A proposal is the document that decides whether work
   happens, so it carries everything the 90-day plan says a proposal must have:
   scope, phases, prerequisites WITH DATES, price, payment milestones, and a
   line to sign. Nothing here is optional decoration. */

/* An answer placed mid-sentence, before the template's own full stop: its own closing punctuation goes, so it never reads "unanswered.." */
function clause(value) {
  return String(value ?? "").trim().replace(/[.!?؟؛;。…]+$/u, "") || "—";
}

const proposal = {
  id: "proposal",
  name: T("Proposal", "پیشنهاد کار"),
  blurb: T(
    "The brief in their words, what you will do and why, the plan, and the price. A pitch, not a form.",
    "شرح کار به زبان خودشان، اینکه چه می‌کنی و چرا، برنامه، و قیمت. یک پیشنهاد قانع‌کننده، نه یک فرم."
  ),
  accent: "cobalt",
  prefix: "PR",
  fields: [
    { id: "outcome", kind: "text", required: true, label: T("The headline: what changes when this is done", "تیتر: وقتی این کار تمام شود چه چیزی عوض می‌شود"), hint: T("It goes on the cover, large. Say it the way they would: \"Patients book themselves, and the phone goes quiet.\"", "روی جلد، بزرگ می‌آید. همان‌طور بگو که خودشان می‌گویند: «بیمارها خودشان نوبت می‌گیرند و تلفن آرام می‌شود.»") },
    { id: "summary", kind: "long", required: true, label: T("The brief: where they are today", "شرح کار: امروز کجا هستند"), hint: T("Their situation, what is not working, and why it matters now, in your words. If they read only this, they should recognise their own problem.", "وضعیتشان، چه چیزی درست کار نمی‌کند و چرا الان مهم است، به زبان خودت. اگر فقط همین را بخوانند، باید مسئلهٔ خودشان را بشناسند.") },
    { id: "facts", kind: "list", label: T("Their numbers", "عددهای خودشان"), columns: [T("Number", "عدد"), T("What it means", "یعنی چه")], hint: T("Up to three, from them: \"~40\" bookings a week, \"18:00\" when calls stop. Their numbers, not yours.", "حداکثر سه عدد، از خودشان: «~۴۰» نوبت در هفته، «۱۸:۰۰» که دیگر کسی جواب نمی‌دهد. عددهای آن‌ها، نه تو.") },
    { id: "shift", kind: "list", label: T("Today, and after this project", "امروز، و بعد از این پروژه"), columns: [T("Today", "امروز"), T("After this project", "بعد از این پروژه")], hint: T("Three or four pairs. The left is what they told you; the right is what changes.", "سه یا چهار جفت. سمت اول همان چیزی است که گفتند؛ سمت دوم چیزی است که عوض می‌شود.") },
    { id: "goalFigure", kind: "text", label: T("The success number", "عدد موفقیت"), hint: T("One figure that says it worked, like \"50%\".", "یک عدد که نشان بدهد جواب داده، مثل «۵۰٪».") },
    { id: "goal", kind: "text", label: T("How you will both know it worked", "از کجا هر دو می‌فهمیم جواب داده"), hint: T("\"Half of all bookings made online, three months after launch.\"", "«نصف نوبت‌ها آنلاین گرفته شود، سه ماه بعد از راه‌اندازی.»") },
    { id: "solutions", kind: "list", required: true, label: T("What you will do, and why", "چه می‌کنی، و چرا"), columns: [T("Solution", "راه‌حل"), T("What you will do", "چه می‌کنی"), T("Why", "چرا"), T("Lands in", "کِی می‌رسد")], hint: T("Three or four. Every one answers something in the brief. If you cannot write the why, it does not belong here.", "سه یا چهار مورد. هر کدام جواب چیزی در شرح کار است. اگر نمی‌توانی «چرا» را بنویسی، جایش اینجا نیست.") },
    { id: "phases", kind: "list", required: true, label: T("Phases", "مراحل"), columns: [T("Phase", "مرحله"), T("What lands", "چه چیزی تحویل می‌شود"), T("By", "تا")], hint: T("Three or four. Each one ends with something they can see.", "سه یا چهار مرحله. هر کدام با چیزی که قابل دیدن است تمام می‌شود.") },
    { id: "prerequisites", kind: "list", required: true, label: T("What you need from them, and by when", "چه چیزی از آن‌ها لازم است، و تا کی"), columns: [T("What", "چه چیزی"), T("Who", "از چه کسی"), T("By", "تا")], hint: T("Every date here is a date the project slips if it is missed. Say so.", "هر تاریخ اینجا تاریخی است که اگر از دست برود پروژه عقب می‌افتد. همین را بنویس.") },
    { id: "excluded", kind: "long", label: T("What is not in this", "آنچه در این کار نیست"), hint: T("The most useful paragraph in the document.", "مفیدترین پاراگراف این سند.") },
    { id: "price", kind: "money", required: true, label: T("Price", "قیمت") },
    { id: "currency", kind: "choice", required: true, label: T("Currency", "واحد"), options: ["IRR", "TRY", "USD", "EUR"] },
    { id: "milestones", kind: "list", required: true, label: T("Payment milestones", "مراحل پرداخت"), columns: [T("When", "چه زمانی"), T("Share", "سهم"), T("Amount", "مبلغ")], hint: T("Write the share as a percentage, like 40%: the document draws the payments as a bar from it.", "سهم را درصدی بنویس، مثل ۴۰٪: سند از روی آن پرداخت‌ها را به شکل یک نوار می‌کشد.") },
    { id: "operating", kind: "text", label: T("What happens after launch", "بعد از راه‌اندازی چه می‌شود"), hint: T("An unoperated system is a failed project. Say what the first month includes and what the monthly fee is.", "سیستمی که کسی نمی‌گرداند پروژهٔ شکست‌خورده است. بنویس ماه اول شامل چیست و هزینهٔ ماهانه چقدر است.") },
    { id: "validUntil", kind: "date", required: true, label: T("This offer holds until", "این پیشنهاد تا این تاریخ معتبر است") }
  ],
  render(values, lang, ctx) {
    const L = (en, fa) => (lang === "fa" ? fa : en);
    const company = String(ctx?.companyName || "").trim();
    const rows = (value, width) => (Array.isArray(value) ? value : []).filter((row) => Array.isArray(row) && row.slice(0, width).some((cell) => String(cell ?? "").trim()));
    const blocks = [];

    /* The cover: the headline is what changes for them, not the word "Proposal". */
    blocks.push({
      kind: "cover",
      kicker: company ? L(`For ${company}`, `برای ${company}`) : "",
      title: values.outcome || ctx?.document?.title || "",
      toc: [L("The brief", "شرح کار"), L("What we'll do, and why", "چه می‌کنیم، و چرا"), L("The plan", "برنامه"), L("Investment", "هزینه")],
      holds: values.validUntil ? `${L("Holds until", "معتبر تا")} ${paperDate(values.validUntil, lang)}` : ""
    });

    /* 01 — the brief: where they are, in their own numbers, and what changes. */
    blocks.push({ kind: "eyebrow", text: L("THE BRIEF", "شرح کار") });
    blocks.push({ kind: "heading", level: 2, text: company ? L(`Where ${company} is today, and why it matters.`, `${company} امروز کجاست، و چرا مهم است.`) : L("Where you are today, and why it matters.", "امروز کجا هستید، و چرا مهم است.") });
    blocks.push({ kind: "lede", text: values.summary });
    blocks.push({ kind: "facts", items: rows(values.facts, 2).filter((row) => String(row[0] ?? "").trim()).slice(0, 3).map((row) => ({ figure: digits(row[0], lang), text: row[1] })) });
    blocks.push({ kind: "shift", columns: [L("Today", "امروز"), L("After this project", "بعد از این پروژه")], rows: rows(values.shift, 2).map((row) => [row[0], row[1]]) });
    if (values.goal || values.goalFigure) {
      blocks.push({ kind: "goal", label: L("How we'll know it worked", "از کجا می‌فهمیم جواب داده"), figure: digits(values.goalFigure, lang), text: values.goal });
    }

    /* 02 — what we will do, each with its reason. */
    const solutions = rows(values.solutions, 4);
    const count = L(["", "One thing", "Two things", "Three things", "Four things", "Five things", "Six things"], ["", "یک کار", "دو کار", "سه کار", "چهار کار", "پنج کار", "شش کار"])[solutions.length];
    blocks.push({ kind: "eyebrow", text: L("WHAT WE'LL DO, AND WHY", "چه می‌کنیم، و چرا") });
    if (count) blocks.push({ kind: "heading", level: 2, text: L(`${count}, each for a reason.`, `${count}، هر کدام به یک دلیل.`) });
    blocks.push({
      kind: "solutions",
      labels: { what: L("What we'll do", "چه می‌کنیم"), why: L("Why", "چرا") },
      items: solutions.map((row) => ({ title: row[0], what: row[1], why: row[2], lands: row[3] }))
    });

    /* 03 — the plan, what it needs from them, and what it is not. */
    blocks.push({ kind: "eyebrow", text: L("THE PLAN", "برنامه") });
    blocks.push({
      kind: "steps",
      items: (values.phases || []).map((row) => ({ title: row[0], detail: row[1], meta: paperDate(row[2], lang) || row[2] }))
    });
    blocks.push({ kind: "heading", level: 2, text: L("What we need from you", "آنچه از شما لازم داریم") });
    blocks.push({
      kind: "table",
      columns: [L("What", "چه چیزی"), L("Who", "از چه کسی"), L("By", "تا")],
      rows: (values.prerequisites || []).map((row) => [row[0], row[1], paperDate(row[2], lang) || row[2]])
    });
    blocks.push({
      kind: "note",
      tone: "yellow",
      text: L(
        "Each date above moves the whole plan if it is missed. That is not a penalty — it is how a date stays true.",
        "هر تاریخ بالا اگر از دست برود کل برنامه جابه‌جا می‌شود. این جریمه نیست؛ این تنها راهی است که یک تاریخ واقعی بماند."
      )
    });
    if (values.excluded) {
      blocks.push({ kind: "heading", level: 2, text: L("Not in this", "بیرون از این کار") });
      blocks.push({ kind: "para", text: values.excluded });
    }

    /* 04 — the price, how it is paid, and how to accept. */
    blocks.push({ kind: "eyebrow", text: L("INVESTMENT", "هزینه") });
    blocks.push({ kind: "heading", level: 1, text: money(values.price, values.currency, lang) });
    const milestones = rows(values.milestones, 3);
    blocks.push({
      kind: "paybar",
      items: milestones.map((row) => ({ label: row[0], share: shareOf(row[1]), shareText: digits(row[1], lang), amount: money(row[2], values.currency, lang) || row[2] }))
    });
    blocks.push({
      kind: "table",
      columns: [L("When", "چه زمانی"), L("Share", "سهم"), L("Amount", "مبلغ")],
      rows: milestones.map((row) => [row[0], digits(row[1], lang), money(row[2], values.currency, lang) || row[2]]),
      total: { label: L("Total", "جمع"), value: money(values.price, values.currency, lang) }
    });
    if (values.operating) {
      blocks.push({ kind: "heading", level: 2, text: L("After launch", "بعد از راه‌اندازی") });
      blocks.push({ kind: "para", text: values.operating });
    }
    blocks.push({
      kind: "kv",
      rows: [{ label: L("This offer holds until", "اعتبار این پیشنهاد تا"), value: paperDate(values.validUntil, lang) }]
    });
    blocks.push({
      kind: "note",
      tone: "cobalt",
      text: L(
        "To accept, sign below and send it back. A photo of this page is fine. The plan starts the week the first payment arrives.",
        "برای پذیرفتن، پایین را امضا کنید و برگردانید؛ عکس همین صفحه هم کافی است. برنامه از هفته‌ای شروع می‌شود که اولین پرداخت برسد."
      )
    });
    blocks.push({
      kind: "signature",
      parties: [
        { role: L("For the client", "برای کارفرما"), name: company },
        { role: L("For Your company", "برای شرکت شما"), name: ctx?.profile?.name || "Your company" }
      ]
    });
    return blocks;
  }
};

/* "40%", "40", "۴۰٪" → 40. A share that is not a number draws no bar. */
function shareOf(value) {
  const latin = String(value ?? "").replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٫,]/g, ".");
  const match = /(\d+(?:\.\d+)?)/.exec(latin);
  const number = match ? Number(match[1]) : NaN;
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/* Where a document has to name a country, it names it in the reader's own
   language. Storing the choice as a code keeps the two versions of the page
   saying the same thing. */
const LAW_NAMES = { TR: T("Türkiye", "ترکیه"), IR: T("Iran", "ایران") };
const lawName = (code, lang) => pick(LAW_NAMES[code], lang) || code || "";

/* ---------------------------------------------------------------- scope --- */
/* A proposal is an offer. This is the document that turns an accepted offer
   into an agreement, and its real work is the change clause: a change is
   written down and priced before anyone starts it. Every "just a quick thing"
   that ever ate a week was one nobody wrote down. The deliverables table asks
   for "done means" next to every line for the same reason — an argument about
   whether something is finished is really an argument that was never had. */

const scope = {
  id: "scope",
  name: T("Scope agreement", "توافق دامنهٔ کار"),
  blurb: T(
    "What is in, what is out, who decides, what a change costs, and how this ends.",
    "چه چیزی داخل کار است، چه چیزی بیرون، چه کسی تصمیم می‌گیرد، تغییر چقدر هزینه دارد، و این همکاری چطور تمام می‌شود."
  ),
  accent: "ink",
  prefix: "SC",
  fields: [
    { id: "project", kind: "text", required: true, label: T("The work", "نام کار"), hint: T("The name both sides already use in messages, not a new invented title.", "همان اسمی که هر دو طرف در پیام‌ها به کار می‌برند، نه یک عنوان تازه.") },
    { id: "proposalRef", kind: "text", required: true, label: T("Which proposal this follows", "بر پایهٔ کدام پیشنهاد"), hint: T("Number and price. An agreement with no priced proposal behind it is a conversation.", "شماره و قیمت. توافقی که پشتش پیشنهاد قیمت‌خورده نباشد، فقط یک گفت‌وگوست.") },
    { id: "acceptedOn", kind: "date", required: true, label: T("Accepted on", "تاریخ پذیرش") },
    { id: "startDate", kind: "date", required: true, label: T("Work starts", "شروع کار") },
    { id: "endDate", kind: "date", required: true, label: T("Work ends", "پایان کار"), hint: T("The date the last deliverable lands, not the date you hope to be free.", "تاریخی که آخرین تحویل انجام می‌شود، نه تاریخی که امیدواری کارت تمام شده باشد.") },
    { id: "included", kind: "list", required: true, label: T("What is in", "چه چیزی داخل کار است"), columns: [T("Deliverable", "تحویل‌شدنی"), T("Done means", "«تمام شد» یعنی")], hint: T("Done has to be something they can look at and agree is finished. If it cannot be seen, it is not a deliverable.", "«تمام شد» باید چیزی باشد که بشود نگاهش کرد و سرش توافق کرد. چیزی که دیده نمی‌شود، تحویل‌شدنی نیست.") },
    { id: "excluded", kind: "long", required: true, label: T("What is out", "چه چیزی بیرون از کار است"), hint: T("Write the three things they are most likely to assume are included. Cheap to write here, expensive in month two.", "سه چیزی را بنویس که به احتمال زیاد فرض می‌کنند شامل کار است. نوشتنش اینجا ارزان است و ماه دوم گران.") },
    { id: "decisions", kind: "list", required: true, label: T("Who decides what", "چه کسی چه چیزی را تصمیم می‌گیرد"), columns: [T("Decision", "تصمیم"), T("Who decides", "تصمیم‌گیرنده"), T("Answers within", "مهلت پاسخ")], hint: T("One name per decision. Two deciders is the same as none.", "برای هر تصمیم یک نفر. دو تصمیم‌گیرنده یعنی هیچ تصمیم‌گیرنده‌ای.") },
    { id: "reviewRounds", kind: "text", label: T("Review rounds included in the price", "دورهای بازبینی که در قیمت هست"), hint: T("Say the number. Unlimited rounds are a price you pay quietly, every time.", "عدد را بنویس. بازبینی بی‌پایان هزینه‌ای است که هر بار بی‌صدا می‌پردازی.") },
    { id: "changeRate", kind: "money", label: T("Rate for work outside this scope", "نرخ کار بیرون از این دامنه"), hint: T("Per hour or per day, decided now while nobody is annoyed.", "ساعتی یا روزانه، همین حالا که هیچ‌کس دلخور نیست تعیینش کن.") },
    { id: "currency", kind: "choice", required: true, label: T("Currency", "واحد"), options: ["IRR", "TRY", "USD", "EUR"] },
    { id: "noticeDays", kind: "choice", required: true, label: T("Notice to end, in days", "مهلت اعلام پایان، به روز"), options: ["7", "14", "30"] },
    { id: "handoverDays", kind: "choice", required: true, label: T("Handover completed within, days", "تحویل کامل ظرف چند روز"), options: ["7", "14", "30"] },
    { id: "law", kind: "choice", required: true, label: T("Governed by the law of", "قانون حاکم"), options: ["TR", "IR"] }
  ],
  render(values, lang, ctx) {
    const L = (en, fa) => (lang === "fa" ? fa : en);
    const blocks = [];
    blocks.push({
      kind: "lede",
      text: L(
        `${values.project || "This project"} — everything that is inside this piece of work, and everything that is not.`,
        `${values.project || "این پروژه"} — هرچه داخل این کار است، و هرچه نیست.`
      )
    });
    blocks.push({
      kind: "kv",
      rows: [
        { label: L("Follows proposal", "بر پایهٔ پیشنهاد"), value: values.proposalRef },
        { label: L("Accepted on", "پذیرفته‌شده در"), value: paperDate(values.acceptedOn, lang) },
        { label: L("Work starts", "شروع کار"), value: paperDate(values.startDate, lang) },
        { label: L("Work ends", "پایان کار"), value: paperDate(values.endDate, lang) }
      ]
    });

    blocks.push({ kind: "rule" });
    blocks.push({ kind: "eyebrow", text: L("IN SCOPE", "داخل دامنه") });
    blocks.push({ kind: "heading", level: 2, text: L("What is being delivered", "چه چیزی تحویل می‌شود") });
    blocks.push({
      kind: "table",
      columns: [L("Deliverable", "تحویل‌شدنی"), L("Done means", "«تمام شد» یعنی")],
      rows: (values.included || []).map((row) => [row[0], row[1]])
    });

    blocks.push({ kind: "eyebrow", text: L("OUT OF SCOPE", "بیرون از دامنه") });
    blocks.push({ kind: "para", text: values.excluded });
    blocks.push({
      kind: "note",
      tone: "clay",
      text: L(
        "If something is not written above, it is not in the price. That is not distance — it is the only thing that keeps the date honest and the invoice the size we agreed.",
        "اگر چیزی بالا نوشته نشده، در قیمت نیست. این سردی نیست؛ تنها چیزی است که تاریخ را درست و صورت‌حساب را هم‌اندازهٔ توافق نگه می‌دارد."
      )
    });

    blocks.push({ kind: "eyebrow", text: L("DECISIONS", "تصمیم‌ها") });
    blocks.push({
      kind: "table",
      columns: [L("Decision", "تصمیم"), L("Who decides", "تصمیم‌گیرنده"), L("Answers within", "مهلت پاسخ")],
      rows: (values.decisions || []).map((row) => [row[0], row[1], row[2]])
    });

    blocks.push({ kind: "eyebrow", text: L("CHANGES", "تغییرها") });
    blocks.push({
      kind: "para",
      text: L(
        "Anything not listed above is a change of scope. A change is written down before it starts: what it is, how much time it takes, what it costs, and which date it moves. Work on it begins once both sides have agreed to that note in writing.",
        "هر چیزی که بالا نیامده، تغییر دامنه است. تغییر پیش از شروع نوشته می‌شود: چه چیزی است، چقدر وقت می‌برد، چقدر هزینه دارد و چه تاریخی را جابه‌جا می‌کند. کار روی آن وقتی شروع می‌شود که هر دو طرف همان نوشته را تأیید کرده باشند."
      )
    });
    const changeRows = [];
    if (values.reviewRounds) changeRows.push({ label: L("Review rounds included", "بازبینی‌های داخل قیمت"), value: digits(values.reviewRounds, lang) });
    if (values.changeRate) changeRows.push({ label: L("Outside this scope", "بیرون از این دامنه"), value: money(values.changeRate, values.currency, lang) });
    if (changeRows.length) blocks.push({ kind: "kv", rows: changeRows });
    blocks.push({
      kind: "note",
      tone: "yellow",
      text: L(
        "A change agreed in a call and never written down does not exist. Ask me for the note — it takes me ten minutes and it is what stops the argument later.",
        "تغییری که در یک تماس توافق شود و نوشته نشود، وجود ندارد. همان نوشته را از من بخواهید؛ ده دقیقه وقت من است و جلوی بحث بعدی را می‌گیرد."
      )
    });

    blocks.push({ kind: "eyebrow", text: L("HOW IT ENDS", "چطور تمام می‌شود") });
    blocks.push({
      kind: "para",
      text: L(
        `Either side can end this agreement with ${digits(values.noticeDays, lang)} days of written notice. Work already finished is invoiced and paid for; work not yet started is not. Within ${digits(values.handoverDays, lang)} days of the final payment, everything built is handed over: files, accounts, passwords and the current state of the work, in a form that can be used without me.`,
        `هر یک از دو طرف می‌تواند با ${digits(values.noticeDays, lang)} روز اعلام کتبی به این توافق پایان دهد. کاری که انجام شده صورت‌حساب و پرداخت می‌شود و کاری که شروع نشده، نه. حداکثر ${digits(values.handoverDays, lang)} روز پس از آخرین پرداخت، هرچه ساخته شده تحویل داده می‌شود: فایل‌ها، حساب‌ها، رمزها و وضعیت فعلی کار، به شکلی که بدون من هم قابل استفاده باشد.`
      )
    });

    blocks.push({ kind: "rule" });
    blocks.push({
      kind: "para",
      text: L(
        `This is a plain-language agreement between two working parties. It was not drafted by a lawyer and does not try to sound like one. It is governed by the law of ${lawName(values.law, lang)}, and anything it does not cover is settled there.`,
        `این یک توافق به زبان ساده میان دو طرف کاری است. وکیل آن را ننوشته و قرار هم نیست شبیه متن وکیل باشد. قانون حاکم بر آن قانون ${lawName(values.law, lang)} است و هر چیزی که در این متن نیامده بر همان مبنا حل می‌شود.`
      )
    });
    blocks.push({
      kind: "signature",
      parties: [
        { role: L("For Your company", "برای شرکت شما"), name: ctx?.profile?.name || "Your company" },
        { role: L("For the client", "برای کارفرما"), name: ctx?.companyName || "" }
      ]
    });
    return blocks;
  }
};

/* -------------------------------------------------------------- kickoff --- */
/* Filled on the first call, while everyone is still in the room. Every field
   here is a question that costs a week if it is asked in week three instead:
   who can say yes, where the content is coming from, and what the current
   state looked like before anything was touched. One page, no signature — it
   is a working sheet, not an agreement. */

const kickoff = {
  id: "kickoff",
  name: T("Kickoff sheet", "برگهٔ شروع کار"),
  blurb: T(
    "Day one, on one page: who decides, who sends what, where things live, and what phase one being finished looks like.",
    "روز اول، در یک صفحه: چه کسی تصمیم می‌گیرد، چه کسی چه چیزی می‌فرستد، همه‌چیز کجاست، و تمام‌شدن فاز یک یعنی چه."
  ),
  accent: "moss",
  prefix: "KO",
  fields: [
    { id: "decider", kind: "text", required: true, label: T("Who signs off", "تصمیم‌گیرندهٔ نهایی"), hint: T("One name and a phone number. The person who can say yes without asking anyone else.", "یک نام و یک شماره. کسی که می‌تواند بدون پرسیدن از کسی بگوید بله.") },
    { id: "contentOwner", kind: "text", required: true, label: T("Who supplies content", "محتوا از چه کسی") },
    { id: "contentBy", kind: "date", required: true, label: T("Content lands by", "محتوا تا این تاریخ"), hint: T("Content is what makes launches late, every time. Give it a date on day one and a name next to it.", "چیزی که راه‌اندازی‌ها را عقب می‌اندازد تقریباً همیشه محتواست. همان روز اول برایش تاریخ بگذار و یک اسم کنارش بنویس.") },
    { id: "filesAt", kind: "text", required: true, label: T("Where files live", "فایل‌ها کجا هستند"), hint: T("One link. Two places to look is the same as none.", "یک لینک. دو جا برای گشتن یعنی هیچ جا.") },
    { id: "channel", kind: "text", required: true, label: T("Where we talk", "کجا حرف می‌زنیم"), hint: T("One channel, and say what does not count — a decision left in a voice note is not a decision.", "یک کانال؛ و بنویس چه چیزی حساب نمی‌شود — تصمیمی که در یک ویس می‌ماند تصمیم نیست.") },
    { id: "replyWindow", kind: "text", required: true, label: T("We both answer within", "هر دو طرف ظرف چه مدت جواب می‌دهیم"), hint: T("Both directions. A promise that only binds them is not a working agreement.", "دوطرفه. قولی که فقط آن‌ها را ببندد، توافق کاری نیست.") },
    { id: "weeklySlot", kind: "text", required: true, label: T("Standing weekly call", "جلسهٔ ثابت هفتگی"), hint: T("Day and time, the same every week. A call you rebook every week is a call that stops happening.", "روز و ساعت، هر هفته ثابت. جلسه‌ای که هر هفته باید دوباره وقتش را هماهنگ کنی، بالاخره برگزار نمی‌شود.") },
    { id: "updateDay", kind: "text", required: true, label: T("Written update arrives every", "گزارش کتبی هر هفته، چه روزی") , hint: T("Name the day. This one is yours to keep, not theirs to chase.", "روزش را بنویس. این تعهد توست، نه چیزی که آن‌ها باید دنبالش بدوند.") },
    { id: "access", kind: "list", required: true, label: T("Access needed", "دسترسی‌های لازم"), columns: [T("What", "چه چیزی"), T("From whom", "از چه کسی"), T("By", "تا")], hint: T("Hosting, domain, analytics, social accounts, the old site admin. Ask for all of it today — asking again in week three costs a week.", "هاست، دامنه، آنالیتیکس، حساب‌های شبکه‌های اجتماعی، پنل سایت قبلی. همه را همین امروز بخواه؛ هفتهٔ سوم دوباره خواستن یک هفته هزینه دارد.") },
    { id: "beforeState", kind: "text", required: true, label: T("Where the before is saved", "وضعیت «قبل» کجا ثبت شده"), hint: T("Screenshots and today's numbers, taken before anything is touched. Without them there is no case study later and no argument at renewal.", "اسکرین‌شات‌ها و عددهای امروز، پیش از دست‌زدن به هر چیزی. بدون این‌ها نه بعداً مطالعهٔ موردی داری، نه موقع تمدید حرفی برای گفتن.") },
    { id: "phaseOneDone", kind: "long", required: true, label: T("Phase one is finished when", "فاز یک وقتی تمام است که"), hint: T("Write it so that on the day it is true, nobody has to be persuaded.", "جوری بنویس که روزی که محقق شد، لازم نباشد کسی را قانع کنی.") },
    { id: "phaseOneDate", kind: "date", required: true, label: T("Phase one date", "تاریخ فاز یک") }
  ],
  render(values, lang, ctx) {
    const L = (en, fa) => (lang === "fa" ? fa : en);
    const blocks = [];
    blocks.push({
      kind: "lede",
      text: L(
        `Day one for ${ctx?.companyName || "this project"}. Everything below was agreed on the first call; anything that changes from here changes in writing.`,
        `روز اول کار ${ctx?.companyName || "این پروژه"}. هرچه پایین آمده در همان جلسهٔ اول توافق شده؛ از این به بعد هر تغییری کتبی است.`
      )
    });

    blocks.push({ kind: "eyebrow", text: L("PEOPLE", "آدم‌ها") });
    blocks.push({
      kind: "kv",
      rows: [
        { label: L("Signs off", "تصمیم‌گیرندهٔ نهایی"), value: values.decider },
        { label: L("Supplies content", "تأمین محتوا"), value: values.contentOwner },
        { label: L("Content lands by", "محتوا تا"), value: paperDate(values.contentBy, lang) }
      ]
    });

    blocks.push({ kind: "eyebrow", text: L("PLACES AND PACE", "جاها و ریتم") });
    blocks.push({
      kind: "kv",
      rows: [
        { label: L("Files", "فایل‌ها"), value: values.filesAt },
        { label: L("We talk here", "گفت‌وگو اینجا"), value: values.channel },
        { label: L("We both answer within", "مهلت پاسخ دو طرف"), value: values.replyWindow },
        { label: L("Weekly call", "جلسهٔ هفتگی"), value: values.weeklySlot },
        { label: L("Written update every", "گزارش کتبی هر"), value: values.updateDay }
      ]
    });

    blocks.push({ kind: "eyebrow", text: L("ACCESS", "دسترسی‌ها") });
    blocks.push({
      kind: "table",
      columns: [L("What", "چه چیزی"), L("From whom", "از چه کسی"), L("By", "تا")],
      rows: (values.access || []).map((row) => [row[0], row[1], paperDate(row[2], lang) || row[2]])
    });

    /* The before-state gets a note rather than a table row because it is the
       one line on this page a client usually asks about. */
    blocks.push({
      kind: "note",
      tone: "moss",
      text: L(
        `Before anything is changed, I record what exists today — screenshots and current numbers. Saved at: ${clause(values.beforeState)}. It is how we will both know later what this work actually did.`,
        `پیش از تغییر هر چیزی، وضعیت امروز را ثبت می‌کنم: اسکرین‌شات‌ها و عددهای فعلی. محل نگهداری: ${clause(values.beforeState)}. بعداً همین است که به هر دوی ما می‌گوید این کار واقعاً چه تغییری داد.`
      )
    });

    blocks.push({ kind: "rule" });
    blocks.push({ kind: "eyebrow", text: L("PHASE ONE", "فاز یک") });
    blocks.push({ kind: "heading", level: 2, text: L("Done means", "«تمام شد» یعنی") });
    blocks.push({ kind: "para", text: values.phaseOneDone });
    blocks.push({
      kind: "kv",
      rows: [{ label: L("On", "در تاریخ"), value: paperDate(values.phaseOneDate, lang) }]
    });
    return blocks;
  }
};


/* --------------------------------------------------------------- update --- */
/* The rule is a written update to every active client every week, even when
   the week was thin. So this template is built for speed, not completeness:
   three questions and a next step. Anything that turns it into a report gets
   skipped on a bad week, and a bad week is exactly when it has to be sent. */

/* The states a piece of the work can be in, in the order the work goes. The
   client page draws each one as a tile of its own colour, so the list is short
   on purpose: a fifth state would be a fifth colour to learn. */
export const PIECE_STATES = [
  { value: "done", label: T("Done", "تمام شد") },
  { value: "half", label: T("Half way", "نیمه‌کاره") },
  { value: "todo", label: T("Not started", "شروع نشده") },
  { value: "waiting", label: T("Waiting on you", "منتظر شما") }
];

const update = {
  id: "update",
  name: T("Weekly update", "گزارش هفتگی"),
  blurb: T(
    "What moved, what is stuck, what I need from you — and the next step with its date.",
    "چه چیزی پیش رفت، کجا گیر کرده، از شما چه لازم دارم — و قدم بعدی با تاریخش."
  ),
  accent: "cobalt",
  prefix: "WU",
  fields: [
    { id: "weekOf", kind: "date", required: true, label: T("Week ending", "هفتهٔ منتهی به") },
    { id: "moved", kind: "long", required: true, label: T("What moved", "چه چیزی پیش رفت"), hint: T("Finished things, not busy things. If it can be looked at, link it.", "کارهای تمام‌شده، نه کارهای مشغول‌کننده. اگر چیزی دیدنی است، لینکش را بگذار.") },
    { id: "stuck", kind: "long", label: T("What is stuck", "کجا گیر کرده"), hint: T("Write it even when the reason is you. A week of silence costs more than one awkward sentence.", "حتی وقتی دلیلش خودت هستی بنویس. یک هفته سکوت گران‌تر از یک جملهٔ معذب است.") },
    { id: "need", kind: "list", label: T("What I need from you", "از شما چه لازم دارم"), columns: [T("What", "چه چیزی"), T("From whom", "از چه کسی"), T("By", "تا")], hint: T("Three at most. A list of ten gets none of them done.", "حداکثر سه مورد. فهرست ده‌تایی یعنی هیچ‌کدام انجام نمی‌شود.") },
    {
      id: "pieces",
      kind: "list",
      label: T("Piece by piece", "تکه به تکه"),
      columns: [T("Piece", "تکه"), { ...T("State", "وضعیت"), options: PIECE_STATES }, T("Due or finished (YYYY-MM-DD)", "تاریخ (YYYY-MM-DD)"), T("Link to look at", "لینک برای دیدن")],
      hint: T(
        "The pages or features they will recognise, five to ten of them. Carried over from last week: change only what moved.",
        "صفحه‌ها یا قابلیت‌هایی که مشتری می‌شناسد، پنج تا ده مورد. از هفتهٔ قبل می‌آید: فقط چیزی را که جلو رفته عوض کن."
      )
    },
    { id: "nextStep", kind: "text", label: T("The next step", "قدم بعدی"), hint: T("One thing, the one I am doing next — not the whole remaining plan.", "یک چیز؛ همان کاری که بعدی است، نه کل برنامهٔ باقی‌مانده.") },
    { id: "nextDate", kind: "date", label: T("On", "در تاریخ"), hint: T("Every client has a written next step with a date on it. This is that date.", "هر مشتری باید یک قدم بعدی نوشته‌شده با تاریخ داشته باشد. این همان تاریخ است.") },
    { id: "moneyNote", kind: "text", label: T("Anything about money", "نکتهٔ مالی"), hint: T("An invoice sent, a payment due, an extra agreed. Money surprises are what end good projects.", "صورت‌حسابی که فرستاده شده، پرداختی که سررسید دارد، کار اضافه‌ای که توافق شده. غافلگیری مالی همان چیزی است که پروژه‌های خوب را تمام می‌کند.") }
  ],
  render(values, lang) {
    const L = (en, fa) => (lang === "fa" ? fa : en);
    const blocks = [];
    blocks.push({ kind: "eyebrow", text: L("WEEKLY UPDATE", "گزارش هفتگی") });
    blocks.push({ kind: "heading", level: 1, text: L(`Week ending ${paperDate(values.weekOf, lang)}`, `هفتهٔ منتهی به ${paperDate(values.weekOf, lang)}`) });

    // A thin week leaves sections empty; an empty heading says nothing, so it is left out.
    if (values.moved) {
      blocks.push({ kind: "heading", level: 2, text: L("What moved", "چه چیزی پیش رفت") });
      blocks.push({ kind: "para", text: values.moved });
    }

    if (values.stuck) {
      blocks.push({ kind: "heading", level: 2, text: L("What is stuck", "کجا گیر کرده") });
      blocks.push({ kind: "para", text: values.stuck });
    }

    const needs = (values.need || []).filter((row) => Array.isArray(row) && String(row[0] || "").trim());
    if (needs.length) {
      blocks.push({ kind: "heading", level: 2, text: L("What I need from you", "از شما چه لازم دارم") });
      blocks.push({
        kind: "table",
        columns: [L("What", "چه چیزی"), L("From whom", "از چه کسی"), L("By", "تا")],
        rows: needs.map((row) => [row[0], row[1], paperDate(row[2], lang) || row[2]])
      });
    }

    const pieces = (values.pieces || []).filter((row) => Array.isArray(row) && String(row[0] || "").trim());
    if (pieces.length) {
      const stateLabel = (value) => {
        const state = PIECE_STATES.find((item) => item.value === value);
        return state ? L(state.label.en, state.label.fa) : "";
      };
      blocks.push({ kind: "heading", level: 2, text: L("Piece by piece", "تکه به تکه") });
      blocks.push({ kind: "table", columns: [L("Piece", "تکه"), L("State", "وضعیت")], rows: pieces.map((row) => [row[0], stateLabel(row[1])]) });
    }

    if (values.moneyNote) {
      blocks.push({ kind: "eyebrow", text: L("MONEY", "مالی") });
      blocks.push({ kind: "para", text: values.moneyNote });
    }

    blocks.push({ kind: "rule" });
    if (values.nextStep || values.nextDate) {
      blocks.push({
        kind: "kv",
        rows: [
          { label: L("Next step", "قدم بعدی"), value: values.nextStep },
          { label: L("On", "در تاریخ"), value: paperDate(values.nextDate, lang) }
        ]
      });
    }
    /* One note, and it is always the same one: it turns the update from news
       into a decision the client can leave alone. */
    blocks.push({
      kind: "note",
      tone: "cobalt",
      text: L(
        "Unless you tell me otherwise, I carry on with the step above and you hear from me again next week.",
        "اگر چیز دیگری نگویید، همان قدم بالا را پیش می‌برم و هفتهٔ بعد دوباره خبرتان می‌کنم."
      )
    });
    return blocks;
  }
};

/* -------------------------------------------------------------- receipt --- */
/* This one may be read by someone who has never met either of us — an
   accountant, a tax office, a partner checking the books. So it is the least
   designed document in the set: the amount, the date it actually arrived, what
   it was against, and what is still owed. No voice, no persuasion. The
   transaction reference is deliberately left in Latin digits even in Persian,
   because it exists to be matched character by character against a bank record. */

const receipt = {
  id: "receipt",
  name: T("Receipt", "رسید پرداخت"),
  blurb: T(
    "Proof that money arrived: what for, how much, when, how, and what is left.",
    "سندی که نشان می‌دهد پول رسیده: بابت چه، چقدر، کِی، به چه روشی، و چه مقدار باقی مانده."
  ),
  accent: "moss",
  prefix: "RC",
  fields: [
    { id: "payer", kind: "text", required: true, label: T("Received from", "دریافت از"), hint: T("The name on the bank record, not the one you use in chat. This page has to match their books.", "همان نامی که در سند بانکی آمده، نه اسمی که در گفت‌وگو به کار می‌بری. این برگه باید با دفترهای آن‌ها بخواند.") },
    { id: "forWhat", kind: "text", required: true, label: T("For", "بابت"), hint: T("One line an accountant can file without calling anyone.", "یک خط که حسابدار بتواند بدون تماس با کسی بایگانی‌اش کند.") },
    { id: "invoiceRef", kind: "text", required: true, label: T("Against invoice", "در برابر صورت‌حساب") },
    { id: "amount", kind: "money", required: true, label: T("Amount received", "مبلغ دریافتی") },
    { id: "currency", kind: "choice", required: true, label: T("Currency", "واحد"), options: ["IRR", "TRY", "USD", "EUR"] },
    { id: "paidOn", kind: "date", required: true, label: T("Received on", "تاریخ دریافت"), hint: T("The day the money arrived, not the day it was sent. Those are different days and only one of them is true.", "روزی که پول رسیده، نه روزی که فرستاده شده. این دو یکی نیستند و فقط یکی‌شان درست است.") },
    { id: "method", kind: "text", required: true, label: T("Method", "روش پرداخت"), hint: T("Bank transfer, card, cash, exchange office. Say which one plainly.", "انتقال بانکی، کارت‌به‌کارت، نقدی، صرافی. ساده بنویس کدام.") },
    { id: "reference", kind: "text", label: T("Transaction reference", "شمارهٔ پیگیری"), hint: T("The number that lets either side find this in a statement a year from now.", "همان شماره‌ای که یک سال بعد به هر دو طرف اجازه می‌دهد این تراکنش را در صورت‌حساب پیدا کنند.") },
    { id: "outstanding", kind: "money", label: T("Still outstanding", "باقی‌ماندهٔ بدهی"), hint: T("Write zero when it is zero. A blank line is not an answer, and it is the line they will read twice.", "وقتی صفر است، صفر بنویس. جای خالی جواب نیست و همین خط را دو بار می‌خوانند.") },
    { id: "outstandingDue", kind: "date", label: T("Balance due on", "سررسید باقی‌مانده") }
  ],
  render(values, lang, ctx) {
    const L = (en, fa) => (lang === "fa" ? fa : en);
    const blocks = [];
    const remaining = Number(values.outstanding || 0);

    blocks.push({ kind: "eyebrow", text: L("RECEIPT", "رسید پرداخت") });
    blocks.push({ kind: "heading", level: 1, text: money(values.amount, values.currency, lang) });
    blocks.push({
      kind: "kv",
      rows: [
        { label: L("Received from", "دریافت از"), value: values.payer },
        { label: L("For", "بابت"), value: values.forWhat },
        { label: L("Against invoice", "در برابر صورت‌حساب"), value: values.invoiceRef },
        { label: L("Received on", "تاریخ دریافت"), value: paperDate(values.paidOn, lang) },
        { label: L("Method", "روش پرداخت"), value: values.method },
        { label: L("Reference", "شمارهٔ پیگیری"), value: values.reference || L("—", "—") }
      ]
    });

    blocks.push({ kind: "rule" });
    if (remaining > 0) {
      blocks.push({ kind: "eyebrow", text: L("STILL OUTSTANDING", "باقی‌مانده") });
      blocks.push({
        kind: "kv",
        rows: [
          { label: L("Balance", "مانده"), value: money(remaining, values.currency, lang) },
          { label: L("Due on", "سررسید"), value: paperDate(values.outstandingDue, lang) || L("Not yet set", "هنوز تعیین نشده") }
        ]
      });
    } else {
      blocks.push({
        kind: "para",
        text: L(
          "This invoice is settled in full. Nothing further is owed against it.",
          "این صورت‌حساب به‌طور کامل تسویه شد و بابت آن مبلغی باقی نمانده است."
        )
      });
    }
    blocks.push({
      kind: "para",
      text: L(
        "Issued by Your company as confirmation that the payment above was received.",
        "این رسید از سوی شرکت شما صادر شده و تأیید می‌کند که مبلغ بالا دریافت شده است."
      )
    });
    blocks.push({
      kind: "signature",
      parties: [{ role: L("Received by", "دریافت‌کننده"), name: ctx?.profile?.name || "Your company" }]
    });
    return blocks;
  }
};

/* ------------------------------------------------------------- referral --- */
/* The only document here that is not for a client. It goes to someone who has
   offered to introduce him, and the plan is specific about the ask: one named
   introduction, not a request to keep him in mind. So the page is built
   backwards from that — the fit table exists to make a specific person come to
   mind, and the wording field exists so saying yes is a copy and a send. */

const referral = {
  id: "referral",
  name: T("Referral one-pager", "برگهٔ معرفی"),
  blurb: T(
    "For someone who offered to introduce you: what you do, who it suits, one real proof, and the exact introduction you are asking for.",
    "برای کسی که پیشنهاد معرفی داده: چه کار می‌کنی، به درد چه کسی می‌خورد، یک نمونهٔ واقعی، و دقیقاً چه معرفی‌ای می‌خواهی."
  ),
  accent: "yellow",
  prefix: "RF",
  fields: [
    { id: "oneLine", kind: "text", required: true, label: T("What Your company does, in one line", "شرکت شما چه می‌کند، در یک خط"), hint: T("Say it the way you would to a doctor at a dinner, not the way a website says it.", "جوری بنویس که سر شام به یک پزشک می‌گویی، نه جوری که یک وب‌سایت می‌نویسد.") },
    { id: "fit", kind: "list", required: true, label: T("Who it is for", "برای چه کسانی"), columns: [T("Kind of business", "نوع کسب‌وکار"), T("What is usually broken", "معمولاً چه چیزی خراب است")], hint: T("Three rows. Someone should read one of them and immediately think of a specific person.", "سه ردیف. کسی باید یکی‌شان را بخواند و بی‌درنگ یاد یک آدم مشخص بیفتد.") },
    { id: "notFor", kind: "text", label: T("Who it is not for", "برای چه کسی نیست"), hint: T("Saying no to something makes the yes believable, and saves your introducer an awkward call.", "نه گفتن به یک چیز، بله را باورپذیر می‌کند و معرف را از یک تماس معذب نجات می‌دهد.") },
    { id: "proof", kind: "long", required: true, label: T("The one piece of proof", "یک نمونهٔ واقعی"), hint: T("A named client, a number, and what changed. One is enough — three starts to sound like a brochure.", "نام مشتری، یک عدد، و اینکه چه چیزی عوض شد. یکی کافی است؛ سه‌تا بوی بروشور می‌دهد.") },
    { id: "proofLink", kind: "text", label: T("Where to see it", "کجا می‌شود دید") },
    { id: "ask", kind: "text", required: true, label: T("The one introduction I am asking for", "یک معرفی مشخص که می‌خواهم"), hint: T("One name, or one very specific kind of person. 'Anyone in health' gets you nobody.", "یک اسم، یا یک نوع آدم کاملاً مشخص. «هر کسی در حوزهٔ سلامت» یعنی هیچ‌کس.") },
    { id: "introWords", kind: "long", required: true, label: T("What to say when you introduce me", "وقتی معرفی می‌کنی چه بگویی"), hint: T("Two lines they can paste into a message without editing. Make saying yes a thirty-second job.", "دو خط که بشود بدون ویرایش در یک پیام کپی کرد. بله گفتن باید سی‌ثانیه‌ای باشد.") },
    { id: "contact", kind: "text", required: true, label: T("How to reach me", "راه تماس") }
  ],
  render(values, lang, ctx) {
    const L = (en, fa) => (lang === "fa" ? fa : en);
    const blocks = [];
    blocks.push({ kind: "lede", text: values.oneLine });

    blocks.push({ kind: "eyebrow", text: L("WHO IT IS FOR", "برای چه کسانی") });
    blocks.push({
      kind: "table",
      columns: [L("Kind of business", "نوع کسب‌وکار"), L("What is usually broken", "معمولاً چه چیزی خراب است")],
      rows: (values.fit || []).map((row) => [row[0], row[1]])
    });
    if (values.notFor) {
      blocks.push({ kind: "eyebrow", text: L("NOT FOR", "برای چه کسی نیست") });
      blocks.push({ kind: "para", text: values.notFor });
    }

    blocks.push({ kind: "eyebrow", text: L("PROOF", "نمونهٔ کار") });
    blocks.push({ kind: "para", text: values.proof });
    if (values.proofLink) blocks.push({ kind: "kv", rows: [{ label: L("See it", "دیدنش"), value: values.proofLink }] });
    blocks.push({
      kind: "note",
      tone: "clay",
      text: L(
        "I would rather do one job well for someone you would vouch for than five for people who found me by accident.",
        "ترجیح می‌دهم یک کار را برای کسی که شما ضمانتش می‌کنید درست انجام دهم تا پنج کار برای کسانی که اتفاقی پیدایم کرده‌اند."
      )
    });

    blocks.push({ kind: "rule" });
    blocks.push({ kind: "eyebrow", text: L("THE ASK", "درخواست") });
    blocks.push({ kind: "heading", level: 2, text: L("One introduction", "یک معرفی") });
    blocks.push({ kind: "para", text: values.ask });
    blocks.push({ kind: "eyebrow", text: L("WORD FOR WORD", "عین جمله") });
    blocks.push({ kind: "para", text: values.introWords });
    blocks.push({
      kind: "note",
      tone: "yellow",
      text: L(
        "One introduction is the whole ask — I am not asking you to keep me in mind. If now is not the right time, saying so costs us nothing.",
        "کل درخواست همین یک معرفی است؛ نمی‌خواهم مرا «در نظر داشته باشید». اگر الان وقتش نیست، همین را بگویید؛ هیچ چیزی از دست نمی‌رود."
      )
    });
    blocks.push({
      kind: "kv",
      rows: [
        { label: L("Reach me", "تماس با من"), value: values.contact },
        { label: L("Who I am", "من کی هستم"), value: ctx?.profile?.name || "Your company" }
      ]
    });
    return blocks;
  }
};


/* ----------------------------------------------------------- case-study --- */
/* Broken, decided, shipped, changed, and then their own sentence. The shape is
   fixed because it is the shape of an argument, not a gallery: a reader who
   recognises the first section will believe the fourth. The client is named
   and the numbers are real, which is only possible if the before was recorded
   on day one — which is why the kickoff sheet asks for it. */

const caseStudy = {
  id: "case-study",
  name: T("Case study", "مطالعهٔ موردی"),
  blurb: T(
    "One client, by name: what was broken, what was decided, what shipped, what changed — and their own sentence about it.",
    "یک مشتری، با نام: چه چیزی خراب بود، چه تصمیمی گرفته شد، چه چیزی تحویل شد، چه چیزی تغییر کرد — و جملهٔ خودشان دربارهٔ آن."
  ),
  accent: "clay",
  prefix: "CS",
  fields: [
    { id: "client", kind: "text", required: true, label: T("Client, by name", "نام مشتری"), hint: T("With their written permission. An anonymous case study is a portfolio piece, which is the one thing this is not.", "با اجازهٔ کتبی خودشان. مطالعهٔ موردی بی‌نام می‌شود نمونه‌کار تزئینی، و این دقیقاً همان چیزی است که نباید باشد.") },
    { id: "sector", kind: "text", required: true, label: T("What they do", "کارشان چیست") },
    { id: "headline", kind: "text", required: true, label: T("The result, in one line", "نتیجه، در یک خط"), hint: T("A number belongs in this line. 'A better website' is not a result.", "در این خط باید عدد باشد. «سایت بهتر» نتیجه نیست.") },
    { id: "broken", kind: "long", required: true, label: T("What was broken", "چه چیزی خراب بود"), hint: T("Their situation before you, in their words where you have them. No villains — the reader has to recognise themselves here.", "وضعیت‌شان پیش از تو، تا جای ممکن با جملهٔ خودشان. کسی را بدجنس نشان نده؛ خواننده باید خودش را اینجا بشناسد.") },
    { id: "decided", kind: "long", required: true, label: T("What was decided", "چه تصمیمی گرفته شد"), hint: T("The one or two choices that shaped everything after them. This is the part the reader is actually buying.", "یکی دو انتخابی که بقیهٔ کار را شکل داد. خواننده در واقع دارد همین را می‌خرد.") },
    { id: "shipped", kind: "long", required: true, label: T("What shipped", "چه چیزی تحویل شد"), hint: T("What exists now that did not exist before, and the date it went live.", "چه چیزی الان هست که قبلاً نبود، و چه تاریخی راه افتاد.") },
    { id: "numbers", kind: "list", required: true, label: T("What changed", "چه چیزی تغییر کرد"), columns: [T("Measure", "سنجه"), T("Before", "قبل"), T("After", "بعد")], hint: T("You can only fill this in if you recorded the before. That is the whole reason we record it.", "این جدول را فقط وقتی می‌توانی پر کنی که «قبل» را ثبت کرده باشی. دلیل ثبت‌کردنش هم دقیقاً همین است.") },
    { id: "window", kind: "text", required: true, label: T("Measured over", "بازهٔ اندازه‌گیری"), hint: T("The period and the source. A number with no window behind it is a claim.", "بازه و منبع عدد. عددی که بازه‌اش معلوم نباشد ادعاست.") },
    { id: "quote", kind: "long", required: true, label: T("Their sentence", "جملهٔ خودشان"), hint: T("Their words, not yours tidied up. Ask on the day something works — that is the day people are generous.", "کلمات خودشان، نه جملهٔ تو که مرتب شده. همان روزی بپرس که چیزی درست کار کرده؛ آدم‌ها همان روز سخاوتمندند.") },
    { id: "quoteBy", kind: "text", required: true, label: T("Said by", "گویندهٔ جمله"), hint: T("Name and role. An unattributed quote is worth less than no quote.", "نام و سمت. نقل‌قول بی‌نام از نبودنش هم کم‌ارزش‌تر است.") },
    { id: "approvedOn", kind: "date", required: true, label: T("They approved this page on", "تاریخ تأیید این صفحه"), hint: T("Publish rights, in writing, with a date. When work is done cheap or free, this is what it is paid for in.", "حق انتشار، کتبی و تاریخ‌دار. وقتی کاری ارزان یا رایگان انجام می‌شود، مزدش همین است.") }
  ],
  render(values, lang) {
    const L = (en, fa) => (lang === "fa" ? fa : en);
    const blocks = [];
    blocks.push({ kind: "eyebrow", text: L("CASE STUDY", "مطالعهٔ موردی") });
    blocks.push({ kind: "heading", level: 1, text: values.headline });
    blocks.push({
      kind: "kv",
      rows: [
        { label: L("Client", "مشتری"), value: values.client },
        { label: L("What they do", "کارشان"), value: values.sector }
      ]
    });

    blocks.push({ kind: "rule" });
    blocks.push({ kind: "eyebrow", text: L("BROKEN", "چه چیزی خراب بود") });
    blocks.push({ kind: "para", text: values.broken });

    blocks.push({ kind: "eyebrow", text: L("DECIDED", "چه تصمیمی گرفته شد") });
    blocks.push({ kind: "para", text: values.decided });

    blocks.push({ kind: "eyebrow", text: L("SHIPPED", "چه چیزی تحویل شد") });
    blocks.push({ kind: "para", text: values.shipped });

    blocks.push({ kind: "eyebrow", text: L("CHANGED", "چه چیزی تغییر کرد") });
    blocks.push({
      kind: "table",
      columns: [L("Measure", "سنجه"), L("Before", "قبل"), L("After", "بعد")],
      rows: (values.numbers || []).map((row) => [row[0], digits(row[1], lang), digits(row[2], lang)])
    });
    blocks.push({ kind: "kv", rows: [{ label: L("Measured over", "بازهٔ اندازه‌گیری"), value: values.window }] });

    /* The quote is the human voice of this document, so it is the note rather
       than another paragraph — it should read as a different person talking. */
    blocks.push({
      kind: "note",
      tone: "clay",
      text: L(`“${values.quote || ""}” — ${values.quoteBy || ""}`, `«${values.quote || ""}» — ${values.quoteBy || ""}`)
    });

    blocks.push({ kind: "rule" });
    blocks.push({
      kind: "para",
      text: L(
        `Published with ${values.client || L("the client", "مشتری")}'s permission. Figures come from their own systems.`,
        `با اجازهٔ ${values.client || L("the client", "مشتری")} منتشر شده است. عددها از سامانه‌های خودشان گرفته شده.`
      )
    });
    blocks.push({ kind: "kv", rows: [{ label: L("Approved on", "تاریخ تأیید"), value: paperDate(values.approvedOn, lang) }] });
    return blocks;
  }
};

/* ------------------------------------------------------------------ nda --- */
/* Mutual, and short enough that someone actually reads it before signing. The
   clauses live in render() rather than in fields because they are the same
   every time and should improve in one place; the fields are only the things
   that genuinely differ — who, why, for how long, and under whose law. It says
   in the document that no lawyer wrote it, because pretending otherwise is the
   one thing that would make it worse than useless. */

const nda = {
  id: "nda",
  name: T("Mutual NDA", "توافق‌نامهٔ محرمانگی دوطرفه"),
  blurb: T(
    "Both directions, in plain language: what is confidential, what is not, for how long, and what happens to it at the end.",
    "دوطرفه و به زبان ساده: چه چیزی محرمانه است، چه چیزی نیست، تا چه مدت، و در پایان با آن چه می‌شود."
  ),
  accent: "ink",
  prefix: "ND",
  fields: [
    { id: "partyA", kind: "text", required: true, label: T("Your company, full legal name", "نام کامل حقوقی شرکت شما"), hint: T("Whatever appears on the invoices. A trading name that matches no document is the first thing anyone picks at.", "همان چیزی که روی صورت‌حساب‌ها می‌آید. نام تجاری‌ای که با هیچ سندی نمی‌خواند، اولین چیزی است که به آن گیر می‌دهند.") },
    { id: "partyAWhere", kind: "text", required: true, label: T("Address", "نشانی") },
    { id: "partyB", kind: "text", required: true, label: T("The other party, full legal name", "نام کامل حقوقی طرف دیگر") },
    { id: "partyBWhere", kind: "text", required: true, label: T("Address", "نشانی") },
    { id: "purpose", kind: "text", required: true, label: T("Why information is being shared", "اطلاعات برای چه چیزی رد و بدل می‌شود"), hint: T("Name the actual conversation: one project, one evaluation. A purpose written wide enough to cover everything protects nobody.", "همان گفت‌وگوی واقعی را بنویس: یک پروژهٔ مشخص، یک بررسی مشخص. هدفی که آن‌قدر کلی باشد که همه‌چیز را بپوشاند، از هیچ‌کس محافظت نمی‌کند.") },
    { id: "startDate", kind: "date", required: true, label: T("In force from", "از تاریخ") },
    { id: "years", kind: "choice", required: true, label: T("Stays in force for, years", "مدت اعتبار، به سال"), options: ["1", "2", "3", "5"] },
    { id: "returnDays", kind: "choice", required: true, label: T("Material returned or destroyed within, days", "بازگرداندن یا حذف مواد ظرف چند روز"), options: ["7", "14", "30"] },
    { id: "law", kind: "choice", required: true, label: T("Governed by the law of", "قانون حاکم"), options: ["TR", "IR"] }
  ],
  render(values, lang) {
    const L = (en, fa) => (lang === "fa" ? fa : en);
    /* A half-filled draft still gets printed and read across a desk, so an
       empty address must leave a gap, not the word undefined. */
    const party = (name, where) => [name, where].filter(Boolean).join(" — ");
    const blocks = [];
    blocks.push({
      kind: "lede",
      text: L(
        "Both sides are about to see things the other would not publish. This page says what happens to them, and it binds us both the same way.",
        "قرار است هر دو طرف چیزهایی ببینند که طرف مقابل آن‌ها را منتشر نمی‌کند. این برگه می‌گوید با آن چیزها چه می‌شود، و هر دو طرف را یک‌جور متعهد می‌کند."
      )
    });
    blocks.push({
      kind: "kv",
      rows: [
        { label: L("Party one", "طرف اول"), value: party(values.partyA, values.partyAWhere) },
        { label: L("Party two", "طرف دوم"), value: party(values.partyB, values.partyBWhere) },
        { label: L("Purpose", "هدف"), value: values.purpose },
        { label: L("In force from", "از تاریخ"), value: paperDate(values.startDate, lang) }
      ]
    });

    blocks.push({ kind: "rule" });
    blocks.push({ kind: "eyebrow", text: L("THE TERMS", "شرط‌ها") });
    blocks.push({
      kind: "steps",
      items: [
        {
          title: L("What is confidential", "چه چیزی محرمانه است"),
          detail: L(
            "Anything one side gives the other for the purpose above that is not already public: files, drafts, prices, patient-facing material, lists, logins, plans, and the fact that this conversation is happening at all.",
            "هر چیزی که یک طرف برای هدف بالا در اختیار طرف دیگر می‌گذارد و پیش‌تر عمومی نشده: فایل‌ها، پیش‌نویس‌ها، قیمت‌ها، مطالب مربوط به بیماران، فهرست‌ها، رمزها و دسترسی‌ها، برنامه‌ها، و حتی خود این که چنین گفت‌وگویی در جریان است."
          )
        },
        {
          title: L("How each side treats it", "هر طرف چطور با آن رفتار می‌کند"),
          detail: L(
            "Used only for the purpose above. Shown only to people who need it to do that work and who are under the same duty. Kept at least as carefully as each side keeps its own material.",
            "فقط برای همان هدف بالا استفاده می‌شود. فقط به کسانی نشان داده می‌شود که برای انجام همان کار به آن نیاز دارند و خودشان هم به همین تعهد پایبندند. دست‌کم به همان دقتی نگهداری می‌شود که هر طرف از اطلاعات خودش نگهداری می‌کند."
          )
        },
        {
          title: L("No copies, no passing on", "بدون کپی اضافه، بدون انتقال"),
          detail: L(
            "No copies beyond what the work needs, and nothing is passed to a third party without written permission from the side it came from.",
            "بیشتر از آنچه کار لازم دارد کپی گرفته نمی‌شود، و هیچ چیزی بدون اجازهٔ کتبی طرفی که آن را داده به شخص ثالث منتقل نمی‌شود."
          )
        },
        {
          title: L("If something leaks", "اگر چیزی درز کرد"),
          detail: L(
            "The other side is told in writing as soon as it is known, with what is known, and both sides help limit the damage.",
            "به‌محض اطلاع، کتباً به طرف دیگر گفته می‌شود که چه چیزی و چقدر درز کرده، و هر دو طرف برای محدودکردن آسیب همکاری می‌کنند."
          )
        },
        {
          title: L("This is not a deal", "این یک قرارداد کاری نیست"),
          detail: L(
            "Nothing here obliges either side to work with the other, to buy anything, or to keep talking. Nothing here transfers ownership of anything either.",
            "هیچ چیزی در این متن دو طرف را به همکاری، خرید یا ادامهٔ گفت‌وگو ملزم نمی‌کند و مالکیت هیچ چیزی را هم منتقل نمی‌کند."
          )
        }
      ]
    });

    blocks.push({ kind: "eyebrow", text: L("WHAT IS NOT CONFIDENTIAL", "چه چیزی محرمانه نیست") });
    blocks.push({
      kind: "bullets",
      items: [
        L("Anything already public, or that becomes public without either side breaking this page.", "هر چیزی که از قبل عمومی بوده، یا بدون نقض این توافق از سوی دو طرف عمومی شود."),
        L("Anything a side can show it already had before it was shared.", "هر چیزی که یک طرف بتواند نشان دهد پیش از اشتراک‌گذاری آن را داشته است."),
        L("Anything received from someone else who was free to share it.", "هر چیزی که از شخص دیگری گرفته شده که اجازهٔ در اختیار گذاشتنش را داشته است."),
        L("Anything worked out independently, without using the other side's material.", "هر چیزی که مستقل و بدون استفاده از مطالب طرف مقابل به دست آمده باشد."),
        L("Anything a law or a court requires to be disclosed — in which case the other side is told first, if that is allowed.", "هر چیزی که قانون یا دادگاه افشای آن را الزامی کند؛ در این صورت، اگر منعی نباشد، پیش از افشا به طرف مقابل خبر داده می‌شود.")
      ]
    });

    blocks.push({ kind: "rule" });
    blocks.push({
      kind: "kv",
      rows: [
        { label: L("In force for", "مدت اعتبار"), value: L(`${digits(values.years, lang)} years from the date above`, `${digits(values.years, lang)} سال از تاریخ بالا`) },
        { label: L("Material returned or destroyed within", "بازگرداندن یا حذف مواد ظرف"), value: L(`${digits(values.returnDays, lang)} days of a written request or of the work ending`, `${digits(values.returnDays, lang)} روز از درخواست کتبی یا پایان کار`) },
        { label: L("Governed by the law of", "قانون حاکم"), value: lawName(values.law, lang) }
      ]
    });
    blocks.push({
      kind: "note",
      tone: "clay",
      text: L(
        "Signing this commits neither of us to anything except discretion. If we end up not working together, this is the only page that outlives the conversation.",
        "امضای این برگه هیچ‌کدام از ما را به چیزی جز رازداری متعهد نمی‌کند. اگر کارمان به همکاری نرسید، این تنها برگه‌ای است که از این گفت‌وگو باقی می‌ماند."
      )
    });
    blocks.push({
      kind: "para",
      text: L(
        `This is a plain-language agreement between two working parties. It was not drafted by a lawyer and does not try to sound like one. It is governed by the law of ${lawName(values.law, lang)}, and anything it does not cover is settled there.`,
        `این یک توافق به زبان ساده میان دو طرف کاری است. وکیل آن را ننوشته و قرار هم نیست شبیه متن وکیل باشد. قانون حاکم بر آن قانون ${lawName(values.law, lang)} است و هر چیزی که در این متن نیامده بر همان مبنا حل می‌شود.`
      )
    });
    blocks.push({
      kind: "signature",
      parties: [
        { role: L("For", "برای"), name: values.partyA || "Your company" },
        { role: L("For", "برای"), name: values.partyB || "" }
      ]
    });
    return blocks;
  }
};

export const PAPERWORK_TEMPLATES = [proposal, scope, kickoff, update, receipt, referral, caseStudy, nda];

export function templateById(id) {
  return PAPERWORK_TEMPLATES.find((entry) => entry.id === id) || null;
}
