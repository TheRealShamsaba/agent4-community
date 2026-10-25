/*
 * The page a client opens from a link: where their project stands, what is
 * waiting on them, and the latest update, in Your company's own paper and ink.
 *
 * It is the first thing of ours a client sees that is not a message, so it is
 * built to be hard to get wrong:
 *   - One self-contained document. No script, no web fonts from elsewhere, no
 *     image that loads from another site, so it opens fast on a phone, cannot
 *     be broken by an outage somewhere else, and tells nobody else that the
 *     client was here.
 *   - Every word that came from a person (an update, a project name) is escaped
 *     and shown as plain text, in its own writing direction.
 *   - It only ever receives what was chosen to be shown. It cannot show more,
 *     because it is never handed more.
 */

/* Exact brand lockups from the Your company identity files. */
const WORDMARK = `<span class="wordmark" role="img" aria-label="Your company"><img class="wordmark-on-dark" src="/assets/company-wordmark-light.svg" width="630" height="184" alt=""><img class="wordmark-on-light" src="/assets/company-wordmark.svg" width="630" height="184" alt=""></span>`;

/** Counts in Persian digits on the Persian page. */
const n = (value) => Number(value).toLocaleString("fa-IR");

const WORDS = {
  en: {
    dir: "ltr",
    title: "Your company — your project page",
    description: "A private page from Your company with where your project stands.",
    brand: "Client page",
    kicker: "Project page",
    lede: "This page is private to you. We keep it up to date as the work moves.",
    updatedOn: "Last update",
    soon: (d) => (d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : d > 1 ? `in ${d} days` : `${-d} days ago`),
    none: "Nothing",
    stands: "Where it stands",
    milestone: "Next milestone",
    by: "by",
    health: { on_track: "On track", at_risk: "Needs attention", blocked: "Blocked" },
    status: { paused: "Paused", done: "Completed" },
    waiting: "Waiting on you",
    waitingNone: "Nothing is waiting on you right now.",
    what: "What",
    from: "From",
    latest: "Latest update",
    weekEnding: "Week ending",
    moved: "What moved",
    stuck: "What is stuck",
    next: "Next step",
    on: "on",
    money: "Money",
    published: "Published",
    earlier: "Earlier updates",
    empty: "Your first update will appear here.",
    emptyDetail: "We write one every week, and it lands on this page the same day.",
    ask: "Questions? Just ask.",
    questionsBody: "Message us on WhatsApp or send an email. We'll reply.",
    whatsapp: "Message on WhatsApp",
    private: "This page is private. Anyone who has this address can read it, so please keep it to yourself. If it gets out, tell us and we will close it and send you a new one.",
    gone: "This link is no longer active.",
    goneBody: "Ask Your company for a new link and we will send it right away.",
    other: "فارسی",
    otherCode: "fa",
    creed: "PROOF, NOT PERFORMANCE.",
    questions: "Questions for you",
    qOpen: "To fill in",
    qSent: "Sent. Thank you",
    qClosed: "Closed",
    qAnswered: (a, t) => `${a} of ${t} answered`,
    qNeeded: (a, t) => `${a} of ${t} needed to start`,
    qStart: "Answer the questions",
    qContinue: "Continue",
    qReview: "Review your answers",
    back: "Back to your page",
    need: "Needed to start",
    placeholder: "Your answer",
    save: "Save and come back later",
    send: "Send to Your company",
    sendAgain: "Send again",
    savedNote: "Saved just now. You can close this page and come back to the same link whenever you like.",
    sentNote: "Sent. Thank you. We will read it and come back to you. You can still change an answer and send again.",
    closedNote: "This questionnaire is closed. Message us if something needs to change.",
    noAnswer: "Not answered",
    failedNote: "We could not save that just now. Nothing you typed is lost: try again in a moment, or send the answers on WhatsApp.",
    slowNote: "You are saving very quickly. Please wait a minute and try again.",
    noSecrets: "Please do not write passwords or card numbers here. When we need access to something, we will ask you to invite us, so you stay in control.",
    privacyForm: "Your answers are saved in our private system and used only for your project. We never sell them. Ask us to delete them any time; backup copies expire within 30 days.",
    heroNext: "Next",
    heroLate: "Waiting on you",
    today: "Today",
    dayUnit: (d) => (d === 1 ? "day" : "days"),
    lateUnit: (d) => (d === 1 ? "day late" : "days late"),
    lateNote: "The dates after it can move until it arrives.",
    doneLabel: "Project",
    doneBig: "Done",
    doneLine: "Finished. Thank you for working with us.",
    weekOf: (a, t) => `Week ${a} of ${t}`,
    launch: "Launch",
    needsYou: "Needs you",
    sendOnWhatsapp: "Send on WhatsApp",
    wasDue: (day, d) => `Was due ${day} · ${d} ${d === 1 ? "day" : "days"} late`,
    waitingCount: (c) => `Waiting on you · ${c}`,
    sep: " · ",
    dueToday: "Due today",
    welcome: "Welcome",
    welcomeTitle: "This page is yours.",
    welcomeBody: "Everything about the project lives here: what's next, what we need from you, and every update. Keep the link. It opens without an account or a password.",
    qCall: "Call asked for",
    qCount: (q) => `${q} ${q === 1 ? "question" : "questions"}`,
    qParts: (p) => `${p} short ${p === 1 ? "part" : "parts"}`,
    qMinutes: (m) => `~${m} minutes`,
    twoWays: "Two ways to answer. Pick one.",
    typeIt: "A · Type it here",
    typeTitle: (p) => `${p} short ${p === 1 ? "part" : "parts"}.`,
    partLine: (q, needed) => `${q} ${q === 1 ? "question" : "questions"}${needed ? ` · ${needed} needed to start` : ""}`,
    partMinutes: (m) => `${m} min`,
    startPart: (p) => `Start part ${p}`,
    continuePart: (p) => `Continue part ${p}`,
    toCheckLink: "Check and send",
    savesNote: "Each part saves when you move on. Stop any time and come back to the same link.",
    talk: "B · Talk instead",
    talkTitle: "A 20-minute call. We ask, and write your answers in.",
    talkBody: "Nothing to type. Afterwards the answers are here for you to check.",
    timesLabel: "Good times for you",
    optional: "(optional)",
    timesPlaceholder: "e.g. weekday mornings, or Tue after 2",
    askCall: "Ask for a call",
    askNote: "We'll message you on WhatsApp to set the time.",
    partOf: (p, t) => `Part ${p} of ${t}`,
    allParts: "All parts",
    nextPart: (p) => `Save and go to part ${p}`,
    toCheck: "Save and check your answers",
    backPart: (p) => `Back to part ${p}`,
    later: "Save and finish later",
    leaveIt: "Not sure about one? Leave it, or write \"not sure\". You can come back to any part.",
    partSaved: (p, a, t) => `Part ${p} saved. ${a === t ? (t === 1 ? "It is answered." : `All ${t} answered.`) : `${a} of ${t} answered.`} You can close this and come back to the same link.`,
    lastStep: "Last step",
    checkTitle: "Check and send",
    missing: (c) => (c === 1 ? "One we need to start" : `${c} we need to start`),
    where: (p, q) => `Part ${p} · question ${q}`,
    answerIt: "Answer it",
    byPart: "Your answers, by part",
    lookAgain: "Look again",
    withGaps: "You can send it with gaps. \"Not sure\" is a fine answer, and you can still change anything after sending.",
    sentTitle: "Sent.",
    whatNext: "What happens next",
    anyTime: "Any time",
    changeLater: "Change an answer: open the questions again and send. We see what changed.",
    lookAnswers: "Look at my answers",
    callTitle: "Call asked for.",
    callBody: "We'll message you on WhatsApp to set a time. Nothing else to do until then.",
    youSaid: "You said",
    howCall: "How the call goes",
    callSteps: (t) => ["Twenty minutes, on WhatsApp or video, whichever you like.", `We ask the ${t} questions and type your answers in as you talk.`, "The answers appear here afterwards, so you can check them."],
    typeInstead: "Changed your mind? Type them instead",
    sentAlready: "Sent. You can still change an answer and send again.",
    pieceByPiece: "Piece by piece",
    piecesDone: (d, t) => `/${t} done`,
    pieceStates: { done: "Done", new: "Done this week", half: "In progress", todo: "Coming up", waiting: "Waiting on you" },
    newTag: "New",
    legendNew: "New this week",
    lineSteps: (d, t) => `${d} of ${t} steps done.`,
    lineAllSteps: "Every step done.",
    lineMoving: "Work in progress.",
    lineWelcome: "Your project page.",
    lineDone: "Done. Thank you.",
    lineLate: "Waiting on you.",
    things: (c) => (c === 1 ? "1 thing" : `${c} things`),
    needTitle: (c) => (c === 1 ? "We need one thing from you." : `We need ${c} things from you.`),
    stepsHead: (d, t) => (d === t ? "Every step is done." : `${d} of ${t} done.`),
    signed: "Your team",
    projectsLabel: "Projects",
    stepsOnly: "Steps updated",
    bandKicker: "Talk to us",
    hi: (name) => (name ? `Hi ${name}.` : "Hello."),
    sumSteps: (d, t) => `Your project is ${d} of ${t} steps along.`,
    sumAllSteps: "Every step is done.",
    sumMoving: "Your project is moving.",
    sumWelcome: "This is your project page.",
    sumDone: "Your project is finished. Thank you.",
    nextLabel: "Next:",
    todoKicker: "Your to-do",
    todoTitle: (c) => (c === 1 ? "One thing for you to do." : `${c} things for you to do.`),
    todoNone: "Nothing for you to do right now.",
    todoNoneBody: "We'll message you when we need something from you. You can ask us anything, any time.",
    sendIt: "Send it on WhatsApp",
    sendMsg: (what, company) => `Hi Alex, for ${company}: ${what}`,
    qTask: (title) => `Answer the “${title}” questions`,
    qTaskMeta: (a, t, m) => (a ? `${a} of ${t} answered · about ${m} min left` : `${t} short questions · about ${m} minutes`),
    qStartBtn: "Start",
    qContinueBtn: "Continue",
    qTalk: "Rather talk? Ask for a call",
    qCallAsked: "You asked for a call. We'll message you to set a time.",
    qTypeInstead: "Type the answers instead",
    qDoneItem: (title) => `“${title}” answers sent`,
    whereKicker: "Where we are",
    latestKicker: "Latest from Alex",
    reactOk: "Looks good",
    reactOkMsg: (day, company) => `Hi Alex, I read the update from ${day} for ${company}. Looks good!`,
    reactAsk: "I have a question",
    reactAskMsg: (day, company) => `Hi Alex, a question about the update from ${day} for ${company}: `,
    call: "Call us",
    sumNow: (step) => `We're working on ${step}.`,
    sumWaiting: (step) => `${step} is waiting on you.`,
    sumUpNext: (step) => `Up next: ${step}.`,
    nowLabel: "Now",
    upNextLabel: "Up next",
    statusLabel: "Status",
    trackerDone: "Finished",
    launchIn: (d) => `Launch in ${d} ${d === 1 ? "day" : "days"}`,
    launchToday: "Launch is today",
    launchWas: (day) => `Launch was set for ${day}`,
    launched: "Launched",
    percentLabel: (p) => `${p}% done`,
    doneOn: (day) => `Done ${day}`,
    dueBy: (day) => `By ${day}`,
    stepNow: "Now",
    lookAt: "Look at it",
    holdingUp: (step) => `This is holding up: ${step}`,
    rightNow: "Right now",
    fromAlex: (day) => `From Alex · ${day}`,
    seeKicker: "See it",
    seeTitle: "Things you can look at.",
    historyKicker: "So far",
    historyDone: (step) => `${step} done ✓`,
    comma: ",",
    goesLive: "your project goes live",
    isLive: "Your project is live.",
    daysToGo: (d) => (d === 1 ? "day to go" : "days to go"),
    behind: "Running a little late",
    onSchedule: "On schedule",
    lateCount: (c) => (c === 1 ? "1 thing late" : `${c} things late`),
    planKicker: "The plan",
    tapStep: "Tap a step",
    swipePlan: "Swipe sideways to see the full plan",
    planScrollLabel: "Scrollable project timeline",
    youAreHere: "You are here",
    todayTag: "Today",
    comingTag: "Coming",
    alex: "Alex",
    thisWeek: (day) => `This week · ${day}`,
    lateLabel: "Late",
    wasDueOn: (day) => `Was due ${day}`,
    todayTitle: (day) => `Today, ${day}`,
    quietDay: (step) => `Nothing planned. We're working on ${step}.`,
    quietDayPlain: "Nothing planned for this day.",
    next7: "Next 7 days",
    addCalendar: "Add all dates to my calendar",
    laterKicker: "Later",
    who: { you: "You", us: "Us", both: "You + us" },
    evSend: (what) => `Send: ${what}`,
    evStepDone: (step) => `${step} done`,
    evFinal: (step) => `${step}: it goes live`,
    evLaunch: "Launch: it goes live",
    formTitle: "Your company — questions for you",
    formDescription: "A private page from Your company with a few questions for you."
  },
  fa: {
    dir: "rtl",
    title: "Your company — صفحهٔ پروژهٔ شما",
    description: "صفحه‌ای خصوصی از Your company دربارهٔ اینکه پروژهٔ شما به کجا رسیده است.",
    brand: "صفحهٔ پروژه",
    kicker: "صفحهٔ پروژه",
    lede: "این صفحه فقط برای شماست. هر چه کار جلو می‌رود، به‌روزش می‌کنیم.",
    updatedOn: "آخرین گزارش",
    soon: (d) => (d === 0 ? "امروز" : d === 1 ? "فردا" : d === -1 ? "دیروز" : d > 1 ? `${n(d)} روز دیگر` : `${n(-d)} روز پیش`),
    none: "هیچ",
    stands: "کار به کجا رسیده",
    milestone: "مرحلهٔ بعدی",
    by: "تا",
    health: { on_track: "طبق برنامه", at_risk: "نیاز به توجه", blocked: "متوقف" },
    status: { paused: "موقتاً متوقف", done: "تمام‌شده" },
    waiting: "منتظر شما",
    waitingNone: "فعلاً چیزی منتظر شما نیست.",
    what: "چه چیزی",
    from: "از چه کسی",
    latest: "آخرین گزارش",
    weekEnding: "هفتهٔ منتهی به",
    moved: "چه چیزی پیش رفت",
    stuck: "کجا گیر کرده",
    next: "قدم بعدی",
    on: "در تاریخ",
    money: "مالی",
    published: "منتشر شد",
    earlier: "گزارش‌های قبلی",
    empty: "اولین گزارش شما اینجا می‌آید.",
    emptyDetail: "هر هفته یک گزارش می‌نویسیم و همان روز در همین صفحه می‌گذاریم.",
    ask: "سؤالی دارید؟ بپرسید.",
    questionsBody: "در واتساپ پیام بدهید یا ایمیل بزنید؛ پاسخ می‌دهیم.",
    whatsapp: "پیام در واتساپ",
    private: "این صفحه خصوصی است. هر کسی این آدرس را داشته باشد می‌تواند آن را بخواند، پس لطفاً آن را برای خودتان نگه دارید. اگر جایی فاش شد، خبر بدهید تا آن را ببندیم و آدرس تازه‌ای برایتان بفرستیم.",
    gone: "این لینک دیگر فعال نیست.",
    goneBody: "از Your company لینک تازه‌ای بخواهید؛ بی‌درنگ می‌فرستیم.",
    other: "English",
    otherCode: "en",
    creed: "",
    questions: "سؤال‌هایی برای شما",
    qOpen: "برای پر کردن",
    qSent: "ارسال شد؛ ممنون",
    qClosed: "بسته شد",
    qAnswered: (a, t) => `${n(a)} از ${n(t)} جواب داده شده`,
    qNeeded: (a, t) => `${n(a)} از ${n(t)} مورد لازم برای شروع`,
    qStart: "جواب دادن به سؤال‌ها",
    qContinue: "ادامه",
    qReview: "مرور جواب‌ها",
    back: "بازگشت به صفحهٔ شما",
    need: "لازم برای شروع",
    placeholder: "جواب شما",
    save: "ذخیره و بازگشت بعداً",
    send: "ارسال برای ما",
    sendAgain: "ارسال دوباره",
    savedNote: "همین الان ذخیره شد. می‌توانید این صفحه را ببندید و هر وقت خواستید با همین لینک برگردید.",
    sentNote: "ارسال شد؛ ممنون. می‌خوانیم و به شما برمی‌گردیم. اگر خواستید چیزی را تغییر دهید، می‌توانید جواب را عوض کنید و دوباره بفرستید.",
    closedNote: "این پرسش‌نامه بسته شده است. اگر چیزی باید عوض شود، به ما پیام بدهید.",
    noAnswer: "جواب داده نشده",
    failedNote: "ذخیره الان انجام نشد، اما چیزی از نوشته‌های شما پاک نشده است. چند لحظهٔ دیگر دوباره امتحان کنید یا جواب‌ها را در واتساپ بفرستید.",
    slowNote: "خیلی سریع ذخیره می‌کنید. لطفاً یک دقیقه صبر کنید و دوباره امتحان کنید.",
    noSecrets: "لطفاً اینجا رمز عبور یا شمارهٔ کارت ننویسید. وقتی به چیزی دسترسی لازم داشته باشیم، از شما می‌خواهیم ما را دعوت کنید تا کنترل دست خودتان بماند.",
    privacyForm: "پاسخ‌های شما در سامانهٔ خصوصی ما ذخیره می‌شود و فقط برای پروژهٔ شما از آن‌ها استفاده می‌کنیم. هرگز آن‌ها را نمی‌فروشیم. هر وقت بخواهید حذفشان می‌کنیم؛ نسخه‌های پشتیبان ظرف ۳۰ روز از بین می‌روند.",
    heroNext: "قدم بعدی",
    heroLate: "منتظر شما",
    today: "امروز",
    dayUnit: () => "روز",
    lateUnit: () => "روز تأخیر",
    lateNote: "تا وقتی برسد، تاریخ‌های بعد از آن ممکن است جابه‌جا شوند.",
    doneLabel: "پروژه",
    doneBig: "تمام شد",
    doneLine: "کار تمام شد. ممنون که با ما کار کردید.",
    weekOf: (a, t) => `هفتهٔ ${n(a)} از ${n(t)}`,
    launch: "راه‌اندازی",
    needsYou: "منتظر شما",
    sendOnWhatsapp: "ارسال در واتساپ",
    wasDue: (day, d) => `موعدش ${day} بود؛ ${n(d)} روز تأخیر`,
    waitingCount: (c) => `منتظر شما: ${n(c)}`,
    sep: "، ",
    dueToday: "موعدش امروز است",
    welcome: "خوش آمدید",
    welcomeTitle: "این صفحه مال شماست.",
    welcomeBody: "همه‌چیز دربارهٔ پروژه اینجاست: قدم بعدی، چیزهایی که از شما لازم داریم و همهٔ گزارش‌ها. لینک را نگه دارید؛ بدون حساب کاربری و رمز عبور باز می‌شود.",
    qCall: "تماس خواسته شد",
    qCount: (q) => `${n(q)} سؤال`,
    qParts: (p) => `${n(p)} بخش کوتاه`,
    qMinutes: (m) => `حدود ${n(m)} دقیقه`,
    twoWays: "دو راه برای جواب دادن. یکی را انتخاب کنید.",
    typeIt: "الف: همین‌جا بنویسید",
    typeTitle: (p) => `${n(p)} بخش کوتاه.`,
    partLine: (q, needed) => `${n(q)} سؤال${needed ? `، ${n(needed)} تا لازم برای شروع` : ""}`,
    partMinutes: (m) => `${n(m)} دقیقه`,
    startPart: (p) => `شروع بخش ${n(p)}`,
    continuePart: (p) => `ادامهٔ بخش ${n(p)}`,
    toCheckLink: "مرور و ارسال",
    savesNote: "هر بخش وقتی به بخش بعد بروید ذخیره می‌شود. هر وقت خواستید دست نگه دارید و با همین لینک برگردید.",
    talk: "ب: به‌جایش حرف بزنیم",
    talkTitle: "یک تماس ۲۰ دقیقه‌ای. ما می‌پرسیم و جواب‌هایتان را می‌نویسیم.",
    talkBody: "لازم نیست چیزی بنویسید. بعد جواب‌ها همین‌جاست تا مرورشان کنید.",
    timesLabel: "چه وقت‌هایی برایتان مناسب است",
    optional: "(اختیاری)",
    timesPlaceholder: "مثلاً صبح‌های روزهای کاری، یا سه‌شنبه بعد از ساعت ۲",
    askCall: "درخواست تماس",
    askNote: "در واتساپ پیام می‌دهیم تا وقتش را هماهنگ کنیم.",
    partOf: (p, t) => `بخش ${n(p)} از ${n(t)}`,
    allParts: "همهٔ بخش‌ها",
    nextPart: (p) => `ذخیره و رفتن به بخش ${n(p)}`,
    toCheck: "ذخیره و مرور جواب‌ها",
    backPart: (p) => `بازگشت به بخش ${n(p)}`,
    later: "ذخیره و ادامه در وقتی دیگر",
    leaveIt: "مطمئن نیستید؟ خالی بگذارید یا بنویسید «نمی‌دانم». هر وقت خواستید به هر بخش برمی‌گردید.",
    partSaved: (p, a, t) => `بخش ${n(p)} ذخیره شد؛ ${a === t ? "همهٔ سؤال‌هایش جواب دارد" : `${n(a)} از ${n(t)} جواب داده شده`}. می‌توانید این صفحه را ببندید و با همین لینک برگردید.`,
    lastStep: "قدم آخر",
    checkTitle: "مرور و ارسال",
    missing: (c) => (c === 1 ? "یک سؤال که برای شروع لازم داریم" : `${n(c)} سؤال که برای شروع لازم داریم`),
    where: (p, q) => `بخش ${n(p)}، سؤال ${n(q)}`,
    answerIt: "جواب دادن",
    byPart: "جواب‌های شما، بخش به بخش",
    lookAgain: "دوباره ببینید",
    withGaps: "می‌توانید با جای خالی هم بفرستید. «نمی‌دانم» جواب خوبی است و بعد از ارسال هم می‌توانید هر چیزی را تغییر دهید.",
    sentTitle: "ارسال شد.",
    whatNext: "قدم بعدی",
    anyTime: "هر وقت",
    changeLater: "برای تغییر یک جواب، سؤال‌ها را دوباره باز کنید و بفرستید. تغییرها را می‌بینیم.",
    lookAnswers: "دیدن جواب‌هایم",
    callTitle: "تماس خواسته شد.",
    callBody: "در واتساپ پیام می‌دهیم تا وقتش را هماهنگ کنیم. تا آن موقع کار دیگری لازم نیست.",
    youSaid: "نوشته بودید",
    howCall: "تماس چطور پیش می‌رود",
    callSteps: (t) => ["بیست دقیقه، در واتساپ یا تماس تصویری، هر کدام که راحت‌ترید.", `${n(t)} سؤال را می‌پرسیم و همان‌طور که حرف می‌زنید جواب‌ها را می‌نویسیم.`, "بعد جواب‌ها همین‌جا می‌آید تا مرورشان کنید."],
    typeInstead: "نظرتان عوض شد؟ خودتان بنویسید",
    sentAlready: "ارسال شد. هنوز می‌توانید جوابی را تغییر دهید و دوباره بفرستید.",
    pieceByPiece: "تکه به تکه",
    piecesDone: (d, t) => ` از ${n(t)} تمام شده`,
    pieceStates: { done: "تمام شد", new: "این هفته تمام شد", half: "در حال انجام", todo: "بعدی", waiting: "منتظر شما" },
    newTag: "تازه",
    legendNew: "تازهٔ این هفته",
    lineSteps: (d, t) => `${n(d)} از ${n(t)} مرحله انجام شده.`,
    lineAllSteps: "همهٔ مرحله‌ها انجام شده.",
    lineMoving: "کار در جریان است.",
    lineWelcome: "صفحهٔ پروژهٔ شما.",
    lineDone: "تمام شد. ممنونیم.",
    lineLate: "منتظر شما هستیم.",
    things: (c) => `${n(c)} مورد`,
    needTitle: (c) => (c === 1 ? "یک چیز از شما لازم داریم." : `${n(c)} چیز از شما لازم داریم.`),
    stepsHead: (d, t) => (d === t ? "همهٔ مرحله‌ها انجام شده." : `${n(d)} از ${n(t)} انجام شده.`),
    signed: "تیم شما",
    projectsLabel: "پروژه‌ها",
    stepsOnly: "مرحله‌ها به‌روز شد",
    bandKicker: "با ما حرف بزنید",
    hi: (name) => (name ? `سلام ${name}.` : "سلام."),
    sumSteps: (d, t) => `${n(d)} از ${n(t)} مرحلهٔ پروژه انجام شده.`,
    sumAllSteps: "همهٔ مرحله‌ها انجام شده.",
    sumMoving: "کار پروژه در جریان است.",
    sumWelcome: "این صفحهٔ پروژهٔ شماست.",
    sumDone: "پروژهٔ شما تمام شد. ممنونیم.",
    nextLabel: "قدم بعدی:",
    todoKicker: "کارهای شما",
    todoTitle: (c) => (c === 1 ? "یک کار برای شما." : `${n(c)} کار برای شما.`),
    todoNone: "فعلاً کاری برای شما نیست.",
    todoNoneBody: "هر وقت چیزی لازم داشتیم پیام می‌دهیم. هر سؤالی داشتید، هر وقت بپرسید.",
    sendIt: "ارسال در واتساپ",
    sendMsg: (what, company) => `سلام عضو تیم، برای ${company}: ${what}`,
    qTask: (title) => `جواب دادن به سؤال‌های «${title}»`,
    qTaskMeta: (a, t, m) => (a ? `${n(a)} از ${n(t)} جواب داده شده؛ حدود ${n(m)} دقیقه مانده` : `${n(t)} سؤال کوتاه؛ حدود ${n(m)} دقیقه`),
    qStartBtn: "شروع",
    qContinueBtn: "ادامه",
    qTalk: "ترجیح می‌دهید حرف بزنیم؟ درخواست تماس",
    qCallAsked: "درخواست تماس دادید. برای تعیین وقت پیام می‌دهیم.",
    qTypeInstead: "به‌جایش جواب‌ها را بنویسید",
    qDoneItem: (title) => `جواب‌های «${title}» ارسال شد`,
    whereKicker: "کار به کجا رسیده",
    latestKicker: "آخرین پیام عضو تیم",
    reactOk: "خوب است",
    reactOkMsg: (day, company) => `سلام عضو تیم، گزارش ${day} برای ${company} را خواندم. خوب است!`,
    reactAsk: "سؤال دارم",
    reactAskMsg: (day, company) => `سلام عضو تیم، سؤالی دربارهٔ گزارش ${day} برای ${company}: `,
    call: "تماس تلفنی",
    sumNow: (step) => `الان روی «${step}» کار می‌کنیم.`,
    sumWaiting: (step) => `«${step}» منتظر شماست.`,
    sumUpNext: (step) => `قدم بعدی: «${step}».`,
    nowLabel: "الان",
    upNextLabel: "بعدی",
    statusLabel: "وضعیت",
    trackerDone: "تمام شد",
    launchIn: (d) => `راه‌اندازی ${n(d)} روز دیگر`,
    launchToday: "راه‌اندازی امروز است",
    launchWas: (day) => `راه‌اندازی برای ${day} بود`,
    launched: "راه‌اندازی شد",
    percentLabel: (p) => `${n(p)}٪ انجام شده`,
    doneOn: (day) => `تمام شد ${day}`,
    dueBy: (day) => `تا ${day}`,
    stepNow: "الان",
    lookAt: "دیدن",
    holdingUp: (step) => `«${step}» منتظر همین است`,
    rightNow: "همین حالا",
    fromAlex: (day) => `از عضو تیم، ${day}`,
    seeKicker: "ببینید",
    seeTitle: "چیزهایی که می‌توانید ببینید.",
    historyKicker: "تا اینجا",
    historyDone: (step) => `«${step}» تمام شد`,
    comma: "،",
    goesLive: "روز راه‌اندازی پروژهٔ شما",
    isLive: "پروژهٔ شما راه‌اندازی شد.",
    daysToGo: () => "روز مانده",
    behind: "کمی عقب هستیم",
    onSchedule: "طبق برنامه",
    lateCount: (c) => `${n(c)} کار عقب افتاده`,
    planKicker: "برنامه",
    tapStep: "روی هر مرحله بزنید",
    swipePlan: "برای دیدن کل برنامه به چپ و راست بکشید",
    planScrollLabel: "برنامهٔ زمانی پروژه",
    youAreHere: "الان اینجاییم",
    todayTag: "امروز",
    comingTag: "بعداً",
    alex: "عضو تیم",
    thisWeek: (day) => `این هفته، ${day}`,
    lateLabel: "عقب‌افتاده",
    wasDueOn: (day) => `موعدش ${day} بود`,
    todayTitle: (day) => `امروز، ${day}`,
    quietDay: (step) => `برنامه‌ای نیست. روی «${step}» کار می‌کنیم.`,
    quietDayPlain: "برای این روز برنامه‌ای نیست.",
    next7: "۷ روز آینده",
    addCalendar: "افزودن همهٔ تاریخ‌ها به تقویم من",
    laterKicker: "بعدتر",
    who: { you: "شما", us: "ما", both: "شما و ما" },
    evSend: (what) => `ارسال: ${what}`,
    evStepDone: (step) => `پایان «${step}»`,
    evFinal: (step) => `«${step}»: راه‌اندازی`,
    evLaunch: "راه‌اندازی",
    formTitle: "Your company — سؤال‌هایی برای شما",
    formDescription: "صفحه‌ای خصوصی از Your company با چند سؤال برای شما."
  }
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Web addresses in an update ("here is the preview: https://...") are links,
 * because the weekly update asks for exactly that. It runs on text that is
 * already escaped, only ever matches http(s), and the address cannot contain a
 * quote, so it cannot break out of the attribute it is placed in.
 */
const URL_ENTITIES = ["&quot;", "&#39;", "&gt;", "&lt;", "&amp;"];
const URL_TAIL_CHARACTERS = new Set([".", ",", ";", ":", "!", "?", "}", "]", "؟", "،", "؛", "…"]);
const MAX_LINK_LENGTH = 2000;

/**
 * Where the address ends and the sentence resumes. Closing punctuation, in
 * either script, belongs to the sentence, and so does a closing bracket the
 * address did not open. The text is already escaped, so "&quot;" is one
 * character here, not six, and is never cut in half.
 *
 * It walks back from the end once and never rescans, so its cost grows with the
 * length of the text and not with how awkwardly the text ends.
 */
function addressEnd(raw) {
  let end = raw.length;
  let opens = 0;
  let closes = 0;
  for (const character of raw) {
    if (character === "(") opens += 1;
    else if (character === ")") closes += 1;
  }
  while (end > 0) {
    const entity = URL_ENTITIES.find((tail) => raw.endsWith(tail, end));
    if (entity) {
      end -= entity.length;
      continue;
    }
    const last = raw[end - 1];
    if (URL_TAIL_CHARACTERS.has(last)) {
      end -= 1;
    } else if (last === ")" && closes > opens) {
      closes -= 1;
      end -= 1;
    } else {
      break;
    }
  }
  return end;
}

function linkify(escaped) {
  return escaped.replace(/https?:\/\/[^\s]+/g, (raw) => {
    // Nothing a person types is a web address two thousand characters long.
    if (raw.length > MAX_LINK_LENGTH) return raw;
    const end = addressEnd(raw);
    const url = raw.slice(0, end);
    if (!/^https?:\/\/[^/\s&]+\.[^/\s&]{2,}/.test(url)) return raw;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${raw.slice(end)}`;
  });
}

/** A person's own words: paragraphs on blank lines, line breaks kept, nothing else interpreted. */
function prose(value, { lang = "", pageLang = "" } = {}) {
  const body = String(value ?? "").trim();
  if (!body) return "";
  const mark = lang && lang !== pageLang ? ` lang="${lang === "fa" ? "fa" : "en"}"` : "";
  return body
    .split(/\n{2,}/)
    .map((paragraph) => `<p dir="auto"${mark}>${linkify(escapeHtml(paragraph)).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function dateFormatter(lang, options, timeZone) {
  return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { ...options, timeZone });
}

/** "YYYY-MM-DD" is a calendar day, not an instant, so it is read at noon UTC and never shifts. */
function realDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  // 2026-02-31 is accepted by Date and silently becomes 3 March; it is not a date.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function calendarDay(value, lang, withWeekday = true) {
  const date = realDay(value);
  if (!date) return "";
  return dateFormatter(lang, { ...(withWeekday ? { weekday: "short" } : {}), day: "numeric", month: "short" }, "UTC").format(date);
}

function moment(iso, lang, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter(lang, { day: "numeric", month: "short", year: "numeric" }, timeZone).format(date);
}

/*
 * The look is the website's own (example.com): a dark opening with the
 * client's name and one cobalt line under it, the mascot at work, then ruled
 * bone paper with numbered sections, a cobalt band to talk to a person, and a
 * dark foot. Geist and Geist Mono for English, Vazirmatn for Persian, all served
 * from this site, so the page loads nothing from anywhere else.
 */
const CSS = `




:root{color-scheme:light;--night:#111214;--graphite:#171717;--bone:#f3efe6;--bone-deep:#e8e2d6;--paper-line:rgba(23,23,23,.055);--card:#fbf9f4;--cobalt:#2457ff;--cobalt-2:#3d6bff;--cobalt-soft:#7d97ff;--clay:#c96d4b;--clay-soft:#e9a184;--moss:#58b36b;--ink:#171717;--ink-2:rgba(23,23,23,.78);--ink-muted:rgba(23,23,23,.6);--line:rgba(23,23,23,.12);--bone-2:rgba(243,239,230,.74);--bone-muted:rgba(243,239,230,.6);--bone-line:rgba(243,239,230,.13);--sans:"Geist","Vazirmatn",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;--mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;--page-x:clamp(1rem,4vw,4.25rem);--rail:76rem;--ease:cubic-bezier(.22,1,.36,1)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;background:var(--night)}
body{display:flex;flex-direction:column;min-height:100vh;min-height:100svh;margin:0;background:var(--bone);color:var(--ink);font:16px/1.55 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
:lang(fa){font-family:"Vazirmatn","Geist",Tahoma,sans-serif;line-height:1.85}
[dir=rtl] :not([dir=ltr],[dir=ltr] *,[lang=en],[lang=en] *){letter-spacing:0!important}
h1,h2,h3,h4,p,ol,ul,dl,dd{margin:0}
a{color:var(--cobalt);text-underline-offset:.2em}
.wrap{width:min(var(--rail),100% - 2 * var(--page-x));margin-inline:auto}
:focus-visible{outline:3px solid var(--cobalt-soft);outline-offset:3px}
.kicker,.label,.panel h2,.facts dt{display:flex;align-items:center;gap:.7rem;margin:0;color:var(--cobalt);font:500 .72rem/1.35 var(--mono);letter-spacing:.07em;text-transform:uppercase}
.kicker::before{content:"";flex:none;width:1.8rem;height:2px;background:currentColor}
:lang(fa) :is(.kicker,.label,.panel h2,.facts dt){font:600 .84rem/1.6 "Vazirmatn",var(--sans);text-transform:none}
/* The top bar sits on the dark opening. */
.top{background:var(--night);color:var(--bone)}
.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:4.75rem}
.crumb{display:flex;align-items:center;gap:1rem;min-width:0;color:var(--bone);font-size:1.02rem;font-weight:650;letter-spacing:-.02em}
.crumb .wordmark{display:block;flex:none;width:6.9rem;aspect-ratio:630/184;direction:ltr}
.wordmark img{display:block;width:100%;height:auto}
.wordmark-on-light{display:none!important}
.light .top .wordmark-on-dark{display:none}
.light .top .wordmark-on-light{display:block!important}
.crumb>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crumb>span{padding-inline-start:1rem;border-inline-start:1px solid var(--bone-line);color:var(--bone-muted);font-weight:500}
.tools{display:flex;flex:none;align-items:center;gap:.6rem}
.lang{display:inline-flex;align-items:center;min-height:2.5rem;padding:0 1rem;border-radius:999px;box-shadow:inset 0 0 0 1.5px var(--bone-line);color:var(--bone);font-size:.92rem;font-weight:600;text-decoration:none;transition:box-shadow .2s}
.lang:hover{box-shadow:inset 0 0 0 1.5px var(--bone)}
/* Pills: the website's buttons. A label and an arrow in a circle. */
.pill{display:inline-flex;align-items:center;gap:.8rem;min-height:3.3rem;padding:0 .45rem 0 1.45rem;border:0;border-radius:999px;background:var(--cobalt);color:#fff;font:600 1rem/1.2 var(--sans);letter-spacing:-.01em;text-decoration:none;cursor:pointer;transition:transform .35s cubic-bezier(.2,.9,.25,1.15),background-color .2s}
[dir=rtl] .pill{padding:0 1.45rem 0 .45rem}
.pill:hover{transform:translateY(-2px);background:var(--cobalt-2);color:#fff}
.pill i{flex:none;display:grid;place-items:center;width:2.4rem;height:2.4rem;border-radius:50%;background:#fff;color:var(--cobalt);font-style:normal;font-weight:500}
.pill.white{background:#fff;color:var(--cobalt)}
.pill.white i{background:var(--cobalt);color:#fff}
.pill.white:hover{background:var(--bone);color:var(--cobalt)}
.pill.ghost{padding-inline:1.45rem 1.1rem;background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px rgba(23,23,23,.28)}
.pill.ghost:hover{box-shadow:inset 0 0 0 1.5px var(--ink);background:transparent;color:var(--ink)}
.pill.ghost i{width:auto;height:auto;background:none;color:inherit}
/* The opening. */
.hero{position:relative;overflow:hidden;background:var(--night);color:var(--bone)}
.hero::after{content:"";position:absolute;inset:auto -20% -40% 30%;height:70%;background:radial-gradient(closest-side,rgba(36,87,255,.28),transparent);pointer-events:none}
.hero .wrap{position:relative;z-index:1;display:grid;gap:2rem clamp(2rem,6vw,6rem);padding-block:clamp(1.6rem,6vw,4.5rem) clamp(1.6rem,4vw,2.6rem)}
.hero .kicker{color:var(--cobalt-soft)}
.title{margin-top:1.1rem;font-size:clamp(2.7rem,11vw,6rem);font-weight:600;letter-spacing:-.055em;line-height:.96;overflow-wrap:anywhere;text-wrap:balance}
.title.m{font-size:clamp(2.3rem,8.5vw,4.6rem)}
.title.l{font-size:clamp(2rem,7vw,3.6rem);line-height:1.02}
.title em{display:block;margin-top:.12em;color:var(--cobalt-soft);font-style:normal;font-size:.62em;letter-spacing:-.045em;line-height:1.02}
.title em.late{color:var(--clay-soft)}
:lang(fa) .title{font-weight:700;line-height:1.18}
:lang(fa) .title em{line-height:1.5}
.lede{max-width:36rem;margin-top:1.1rem;color:var(--bone-2);font-size:clamp(1.02rem,1.4vw,1.2rem);line-height:1.5}
:lang(fa) .lede{line-height:1.9}
.mascot{background:no-repeat center/contain;filter:drop-shadow(0 1.5rem 3rem rgba(36,87,255,.3))}
.mascot.build{background-image:url("/assets/falcon.svg")}
.mascot.plan{background-image:url("/assets/falcon.svg")}
.mascot.carry{background-image:url("/assets/falcon.svg")}
.mascot.wave{background-image:url("/assets/falcon.svg")}
.hero .mascot.small{float:inline-end;width:7.5rem;height:7.5rem;margin:0 0 .5rem 1rem;shape-outside:margin-box}
[dir=rtl] .hero .mascot.small{margin:0 1rem .5rem 0}
.hero .mascot.large{display:none}
.track{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:4px;clear:both;max-width:36rem;margin-top:1.6rem}
.track i{height:8px;border-radius:999px;background:rgba(243,239,230,.14);transform-origin:left center}
[dir=rtl] .track i{transform-origin:right center}
.track i.done,.track i.new{background:var(--cobalt)}
.track i.half{background:linear-gradient(90deg,var(--cobalt) 50%,rgba(243,239,230,.14) 50%)}
[dir=rtl] .track i.half{background:linear-gradient(270deg,var(--cobalt) 50%,rgba(243,239,230,.14) 50%)}
.track i.waiting{background:var(--clay)}
.facts{display:grid;grid-template-columns:minmax(0,1fr);gap:0;margin:0;border-top:1px solid var(--bone-line)}
.facts div{min-width:0;padding:.95rem 0;border-bottom:1px solid var(--bone-line)}
.facts div:last-child{border-bottom:0}
.facts dt{color:var(--bone-muted)}
.facts dd{margin-top:.35rem;color:var(--bone);font-size:1.08rem;font-weight:550;line-height:1.35;overflow-wrap:anywhere}
.facts dd small{display:block;margin-top:.2rem;color:var(--cobalt-soft);font:500 .78rem/1.4 var(--mono);letter-spacing:.02em}
:lang(fa) .facts dd small{font:600 .84rem/1.6 "Vazirmatn",var(--sans)}
.facts dd.calm{color:#9fdcae}
.facts dd.late{color:var(--clay-soft)}
/* The paper. */
main{flex:1 0 auto;background:var(--bone);background-image:repeating-linear-gradient(transparent 0 calc(2.75rem - 1px),var(--paper-line) calc(2.75rem - 1px) 2.75rem);padding-block:clamp(1.5rem,5vw,4rem) clamp(2.5rem,6vw,5rem)}
.ask{display:grid;gap:1rem;margin-bottom:clamp(1.5rem,4vw,3rem);padding:clamp(1.2rem,3vw,2rem);border-radius:1.2rem;background:var(--graphite);color:var(--bone)}
.ask .kicker{color:var(--clay-soft)}
.ask h2{font-size:clamp(1.6rem,4.4vw,2.4rem);font-weight:600;letter-spacing:-.04em;line-height:1.05}
:lang(fa) .ask h2{font-weight:700;line-height:1.5}
.ask ul{display:grid;gap:0;padding:0;list-style:none}
.ask li{display:grid;gap:.2rem;padding:.85rem 0;border-top:1px solid var(--bone-line)}
.ask li strong{font-size:1.08rem;font-weight:600;overflow-wrap:anywhere}
.ask .who{color:var(--bone-muted);font-size:.92rem}
.ask .by{color:var(--clay-soft);font:500 .8rem/1.4 var(--mono)}
.ask .by.late{color:#ffb79c;font-weight:700}
:lang(fa) .ask .by{font:600 .85rem/1.6 "Vazirmatn",var(--sans)}
.ask .pill{justify-self:start}
.block{display:grid;grid-template-columns:minmax(0,1fr);gap:1.1rem;padding-block:clamp(1.8rem,5vw,3.6rem);border-top:1px solid var(--line)}
.ask+.block,.block:first-child{border-top:0;padding-top:0}
.index{display:flex;align-items:baseline;gap:.8rem}
.index b{color:var(--cobalt);font:500 clamp(1.7rem,3vw,2.8rem)/1 var(--mono)}
.index span{color:var(--ink-muted);font:500 .72rem/1.4 var(--mono);letter-spacing:.07em;text-transform:uppercase}
:lang(fa) .index b{font-family:"Vazirmatn",var(--sans);font-weight:600}
:lang(fa) .index span{font:600 .9rem/1.6 "Vazirmatn",var(--sans);text-transform:none}
.body{display:grid;gap:1.1rem;min-width:0;max-width:48rem}
.body>h2{font-size:clamp(1.8rem,4vw,3rem);font-weight:600;letter-spacing:-.045em;line-height:1.04;text-wrap:balance}
:lang(fa) .body>h2{font-weight:700;line-height:1.45}
.body>p{color:var(--ink-2);font-size:clamp(1.02rem,1.2vw,1.12rem);line-height:1.65}
/* The steps, as a line you walk down. */
.steps{display:grid;padding:0;list-style:none}
.walk{position:relative;display:grid;grid-template-columns:2rem minmax(0,1fr) auto;gap:.9rem;align-items:center;min-height:3.4rem;padding:.55rem 0}
.walk::before{content:"";position:absolute;top:0;bottom:0;inset-inline-start:calc(1rem - 1px);width:2px;background:var(--line)}
.walk:first-child::before{top:50%}
.walk:last-child::before{bottom:50%}
.walk:only-child::before{display:none}
.walk.done::before,.walk.new::before{background:var(--cobalt)}
.dot{position:relative;z-index:1;display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;border:2px solid rgba(23,23,23,.22);background:var(--bone)}
.walk.done .dot,.walk.new .dot{border-color:var(--cobalt);background:var(--cobalt)}
.walk.done .dot::after,.walk.new .dot::after{content:"";width:.62rem;height:.32rem;border:solid #fff;border-width:0 0 2.5px 2.5px;transform:translateY(-1px) rotate(-45deg)}
.walk.half .dot{border-color:var(--cobalt);background:#fff;box-shadow:0 0 0 .3rem rgba(36,87,255,.14)}
.walk.half .dot::after{content:"";width:.7rem;height:.7rem;border-radius:50%;background:var(--cobalt)}
.walk.waiting .dot{border-color:var(--clay);background:var(--clay)}
.walk.waiting .dot::after{content:"!";color:#fff;font:800 .9rem/1 var(--sans)}
.walk strong{font-size:1.08rem;font-weight:550;line-height:1.35;overflow-wrap:anywhere}
.walk.todo strong{color:var(--ink-muted);font-weight:500}
.walk.half strong{font-size:1.2rem;font-weight:650}
.state{color:var(--ink-muted);font:500 .7rem/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
:lang(fa) .state{font:600 .82rem/1.5 "Vazirmatn",var(--sans);text-transform:none}
.walk.done .state{color:var(--cobalt)}
.walk.new .state,.walk.half .state{padding:.32rem .6rem;border-radius:999px;background:var(--cobalt);color:#fff}
.walk.waiting .state{padding:.32rem .6rem;border-radius:999px;background:var(--clay);color:#fff}
.legend{color:var(--ink-muted);font-size:.9rem}
/* The note. */
.note{display:grid;gap:1rem;padding:clamp(1.2rem,3vw,2rem);border-radius:1.2rem;background:var(--card);box-shadow:0 1px 0 rgba(23,23,23,.04),0 18px 40px -28px rgba(23,23,23,.35)}
.note time{color:var(--ink-muted);font:500 .74rem/1.4 var(--mono);letter-spacing:.05em;text-transform:uppercase}
:lang(fa) .note time{font:600 .86rem/1.6 "Vazirmatn",var(--sans);text-transform:none}
.note .words p{margin:.5rem 0 0;color:var(--ink);font-size:clamp(1.08rem,1.5vw,1.26rem);line-height:1.6;overflow-wrap:anywhere}
.note .words p:first-child{margin-top:0}
:lang(fa) .note .words p{line-height:1.95}
.note h4{margin-top:.4rem;color:var(--clay);font:500 .72rem/1.35 var(--mono);letter-spacing:.07em;text-transform:uppercase}
.note h4.money{color:#4f7a58}
:lang(fa) .note h4{font:700 .86rem/1.6 "Vazirmatn",var(--sans);text-transform:none}
.note h4+p,.note h4+p+p{margin:.3rem 0 0;color:var(--ink-2);font-size:1rem;overflow-wrap:anywhere}
.sign{display:flex;align-items:center;gap:.6rem;color:var(--ink-muted);font-size:.92rem}
.sign::before{content:"";width:1.4rem;height:2px;background:var(--cobalt)}
.next{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.4rem 1.1rem;align-items:center;padding:1.1rem 1.2rem;border-radius:1rem;background:var(--graphite);color:var(--bone)}
.next .label{grid-column:1/-1;color:var(--cobalt-soft)}
.next strong{font-size:1.15rem;font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.stamp{display:grid;place-items:center;align-content:center;min-width:3.6rem;padding:.45rem .55rem;border-radius:.7rem;background:var(--cobalt);color:#fff;line-height:1}
.stamp b{font-size:1.5rem;font-weight:650;letter-spacing:-.03em}
.stamp span{margin-top:.2rem;font:500 .62rem/1 var(--mono);letter-spacing:.08em;text-transform:uppercase}
:lang(fa) .stamp span{font:600 .74rem/1.2 "Vazirmatn",var(--sans)}
.next small{display:block;margin-top:.15rem;color:var(--bone-muted);font-size:.88rem}
.update p{overflow-wrap:anywhere}
/* Cards on the paper: questions, projects. */
.cards{display:grid;gap:.9rem}
.panel{display:grid;gap:.75rem;min-width:0;padding:clamp(1.1rem,2.6vw,1.6rem);border-radius:1.1rem;background:var(--card);box-shadow:0 1px 0 rgba(23,23,23,.04),0 18px 40px -28px rgba(23,23,23,.35)}
.panel h3{font-size:1.35rem;font-weight:600;letter-spacing:-.025em;line-height:1.2;overflow-wrap:anywhere}
:lang(fa) .panel h3{font-weight:700;line-height:1.6}
.panel>p{color:var(--ink-2);font-size:1rem;line-height:1.6}
.count{font:500 2.2rem/1 var(--mono);letter-spacing:-.04em;font-valext-numeric:tabular-nums}
.count span{color:var(--ink-muted);font-size:1.1rem}
:lang(fa) .count{font:700 2rem/1.2 "Vazirmatn",var(--sans)}
.ticks{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:3px}
.ticks i{height:10px;border-radius:999px;background:rgba(23,23,23,.1)}
.ticks i.on{background:var(--cobalt)}
.bar{height:10px;border-radius:999px;background:rgba(23,23,23,.1);overflow:hidden}
.bar i{display:block;height:100%;background:var(--cobalt)}
.qmeta{display:flex;flex-wrap:wrap;gap:.2rem 1rem;color:var(--ink-muted);font-size:.9rem}
.qstate{font-weight:650}
.qstate.open{color:var(--clay)}
.qstate.sent{color:#3f8f52}
.panel .pill{justify-self:start;margin-top:.3rem}
.project{display:grid;gap:.5rem}
.project+.project{margin-top:.6rem;padding-top:1rem;border-top:1px solid var(--line)}
.health{display:inline-flex;align-items:center;gap:.45rem;justify-self:start;color:var(--ink-2);font:500 .7rem/1 var(--mono);letter-spacing:.06em;text-transform:uppercase}
.health::before{content:"";width:.55rem;height:.55rem;border-radius:50%;background:var(--moss);box-shadow:0 0 0 .25rem rgba(88,179,107,.2)}
.health.at_risk::before,.health.blocked::before{background:var(--clay);box-shadow:0 0 0 .25rem rgba(201,109,75,.2)}
.health.done::before,.health.paused::before{background:rgba(23,23,23,.35);box-shadow:none}
:lang(fa) .health{font:600 .84rem/1.4 "Vazirmatn",var(--sans);text-transform:none}
.rows{display:grid}
.rows>div{display:grid;grid-template-columns:5.6rem minmax(0,1fr);gap:.8rem;padding:.7rem 0;border-top:1px solid var(--line);color:var(--ink-2);font-size:.98rem;line-height:1.45}
.rows .d{padding-top:.15rem;color:var(--ink-muted);font:500 .72rem/1.5 var(--mono);letter-spacing:.04em;text-transform:uppercase}
:lang(fa) .rows .d{font:600 .84rem/1.7 "Vazirmatn",var(--sans);text-transform:none}
.rows small{display:block;color:var(--cobalt);font-size:.84rem}
details.old{border-top:1px solid var(--line)}
details.old summary{display:grid;grid-template-columns:5.6rem minmax(0,1fr) auto;gap:.8rem;align-items:center;min-height:3.2rem;padding:.6rem 0;color:var(--ink);cursor:pointer;list-style:none}
details.old summary::-webkit-details-marker{display:none}
details.old summary::after{content:"+";display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(23,23,23,.25);font-size:1.1rem;line-height:1;transition:transform .3s var(--ease),background .2s}
details.old[open] summary::after{background:var(--ink);color:var(--bone);transform:rotate(45deg)}
details.old summary .d{color:var(--ink-muted);font:500 .72rem/1.5 var(--mono);letter-spacing:.04em;text-transform:uppercase}
:lang(fa) details.old summary .d{font:600 .84rem/1.7 "Vazirmatn",var(--sans)}
details.old .note{margin-bottom:1rem}
/* A person on the other side. */
.band{position:relative;overflow:hidden;background:var(--cobalt);color:#fff}
.band .wrap{position:relative;z-index:1;display:grid;gap:1.2rem;padding-block:clamp(2.6rem,7vw,5rem)}
.band .kicker{color:rgba(255,255,255,.78)}
.band h2{max-width:14ch;font-size:clamp(2.3rem,7vw,4.4rem);font-weight:600;letter-spacing:-.05em;line-height:1}
:lang(fa) .band h2{font-weight:700;line-height:1.4}
.band p{max-width:40ch;color:rgba(255,255,255,.86);font-size:clamp(1.02rem,1.3vw,1.18rem)}
.band .acts{display:flex;flex-wrap:wrap;align-items:center;gap:.8rem 1.4rem}
.mail{color:#fff;font-weight:600;text-decoration:none;border-bottom:2px solid rgba(255,255,255,.5)}
.mail:hover{color:#fff;border-color:#fff}
/* The mascot is a cell of the band's grid, so it can never cover the buttons or be cut off by the band's edge:
   on a phone it waves beside the heading, on wider screens it stands at the end of the whole block. */
.band .wrap{grid-template-columns:minmax(0,1fr) auto;column-gap:1rem}
.band .kicker,.band h2{grid-column:1}
.band .wrap>p:not(.kicker),.band .acts{grid-column:1/-1}
.band .mascot{grid-column:2;grid-row:1/span 2;align-self:center;height:7rem;aspect-ratio:117/160;filter:none;opacity:.95}
@media (min-width:40rem){
.band .wrap{column-gap:clamp(1.5rem,4vw,4rem)}
.band .wrap>p:not(.kicker),.band .acts{grid-column:1}
.band .mascot{grid-row:1/span 4;align-self:end;height:clamp(10rem,22vw,15rem)}
}
footer{background:var(--night);color:var(--bone-muted)}
footer .wrap{display:grid;gap:1.1rem;padding-block:2rem 2.8rem;font-size:.86rem;line-height:1.7}
footer .crumb{font-size:1.1rem}
footer p{max-width:44rem}
.creed{color:var(--bone-muted);font:500 .68rem/1 var(--mono);letter-spacing:.14em}
/* The action-first page: one column, the to-do first. */
.narrow{width:min(46rem,100% - 2 * var(--page-x));margin-inline:auto}
.sec{display:grid;gap:1rem;padding-block:clamp(2rem,5vw,3.2rem);border-top:1px solid var(--line)}
.sec:first-child{border-top:0;padding-top:0}
.sec>h2{font-size:clamp(1.7rem,4.6vw,2.5rem);font-weight:600;letter-spacing:-.04em;line-height:1.08;text-wrap:balance}
:lang(fa) .sec>h2{font-weight:700;line-height:1.5}
.body-text{color:var(--ink-2);font-size:1.05rem;line-height:1.65}
.nextline{display:grid;gap:.2rem;clear:both;max-width:36rem;margin-top:1.4rem;padding:1rem 1.15rem;border-radius:1rem;background:rgba(243,239,230,.07);box-shadow:inset 0 0 0 1px var(--bone-line);color:var(--bone);font-size:1.08rem;line-height:1.45}
.nextline b{color:var(--cobalt-soft);font-weight:600}
.nextline .when{color:var(--bone-muted);font-size:.94rem}
.hero .track{margin-top:1.4rem}
.tasks{display:grid;gap:.8rem;padding:0;list-style:none}
.task{display:grid;grid-template-columns:2.2rem minmax(0,1fr);gap:.9rem;padding:1.15rem 1.2rem;border-inline-start:4px solid var(--cobalt);border-radius:1.1rem;background:var(--card);box-shadow:0 1px 0 rgba(23,23,23,.04),0 18px 40px -28px rgba(23,23,23,.35)}
.task.late{border-inline-start-color:var(--clay)}
.tick{display:grid;place-items:center;width:2.2rem;height:2.2rem;border-radius:50%;background:rgba(36,87,255,.1);color:var(--cobalt);font:600 .95rem/1 var(--mono)}
.task.late .tick{background:rgba(201,109,75,.14);color:#a4502f}
:lang(fa) .tick{font-family:"Vazirmatn",var(--sans)}
.task strong{display:block;font-size:1.15rem;font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.task .meta{display:block;margin-top:.25rem;color:var(--ink-muted);font-size:.95rem}
.task.late .meta{color:#a4502f;font-weight:600}
.task .acts{display:flex;flex-wrap:wrap;align-items:center;gap:.7rem 1.2rem;margin-top:.95rem}
.textlink{color:var(--ink);font-size:.95rem;font-weight:600;text-decoration:underline;text-decoration-color:rgba(23,23,23,.3);text-underline-offset:.25em}
.textlink:hover{text-decoration-color:var(--ink)}
.calm-card{display:flex;align-items:center;gap:1rem;padding:1.1rem 1.2rem;border-radius:1.1rem;background:#e3efe2}
.calm-card p{color:var(--ink-2);font-size:1.02rem}
.calm-card .check.big{width:2.6rem;height:2.6rem}
.donelist{display:grid;gap:.5rem;padding:0;list-style:none}
.donelist li{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1rem;color:var(--ink-2)}
.donelist a{font-weight:600}
.react{display:flex;flex-wrap:wrap;gap:.7rem}
.pill.ghost.light{color:#fff;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.5)}
.pill.ghost.light:hover{box-shadow:inset 0 0 0 1.5px #fff;color:#fff}
.band .acts{display:flex;flex-wrap:wrap;align-items:center;gap:.8rem 1.2rem}
/* The tracker: stages on one line, the mascot on the one we are at. */
.hero.has-tracker .wrap{grid-template-columns:minmax(0,1fr);min-height:0}
.hero.has-tracker .title{font-size:clamp(2.4rem,8vw,4.8rem)}
.hero.has-tracker .nextline{max-width:none;margin-top:0}
.tracker{display:grid;gap:1.4rem;padding:clamp(1.1rem,3vw,2rem);border-radius:1.4rem;background:#1b1c1f;box-shadow:inset 0 0 0 1px var(--bone-line)}
.tracker-head{display:flex;align-items:center;gap:clamp(1rem,3vw,1.6rem)}
.ring{position:relative;flex:none;display:grid;place-items:center;width:clamp(4.6rem,14vw,6.2rem);aspect-ratio:1;border-radius:50%;background:conic-gradient(var(--cobalt) calc(var(--p) * 1%),rgba(243,239,230,.12) 0)}
.ring::after{content:"";position:absolute;inset:9px;border-radius:50%;background:#1b1c1f}
.ring b{position:relative;z-index:1;color:var(--bone);font:600 clamp(1.05rem,3.4vw,1.4rem)/1 var(--sans);letter-spacing:-.03em}
.tracker-now{display:grid;gap:.2rem;min-width:0}
.tracker-now .label{color:var(--cobalt-soft)}
.tracker-now strong{font-size:clamp(1.7rem,5.4vw,2.8rem);font-weight:600;letter-spacing:-.045em;line-height:1.05;overflow-wrap:anywhere}
:lang(fa) .tracker-now strong{font-weight:700;line-height:1.45}
.launch{color:var(--bone);font-weight:550}
.launch small{display:inline;margin-inline-start:.5rem;color:var(--bone-muted);font-size:.88rem;font-weight:400}
.route{position:relative;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));margin:0;padding:4.4rem 0 0;list-style:none}
.stage{position:relative;display:grid;justify-items:center;align-content:start;gap:.35rem;min-width:0;padding-inline:.2rem;text-align:center}
.stage::before{content:"";position:absolute;top:.75rem;inset-inline:0;height:4px;background:rgba(243,239,230,.13);transform:translateY(-50%)}
.stage:first-child::before{inset-inline-start:50%}
.stage:last-child::before{inset-inline-end:50%}
.stage.done::before,.stage.new::before{background:var(--cobalt)}
.stage.here::before{background:linear-gradient(90deg,var(--cobalt) 50%,rgba(243,239,230,.13) 50%)}
[dir=rtl] .stage.here::before{background:linear-gradient(270deg,var(--cobalt) 50%,rgba(243,239,230,.13) 50%)}
.stage:first-child.here::before{background:rgba(243,239,230,.13)}
.node{position:relative;z-index:1;display:grid;place-items:center;width:1.5rem;height:1.5rem;border-radius:50%;background:#2c2d31;box-shadow:0 0 0 5px #1b1c1f}
.stage.done .node,.stage.new .node{background:var(--cobalt)}
.stage.done .node::after,.stage.new .node::after{content:"";width:.55rem;height:.28rem;border:solid #fff;border-width:0 0 2px 2px;transform:translateY(-1px) rotate(-45deg)}
.stage.here .node{background:#fff;box-shadow:0 0 0 5px #1b1c1f,0 0 0 9px rgba(36,87,255,.55)}
.stage.here .node::after{content:"";width:.6rem;height:.6rem;border-radius:50%;background:var(--cobalt)}
.stage.waiting .node{background:var(--clay)}
.stage.waiting.here .node{background:#fff;box-shadow:0 0 0 5px #1b1c1f,0 0 0 9px rgba(201,109,75,.6)}
.stage.waiting.here .node::after{background:var(--clay)}
.stage strong{color:var(--bone);font-size:.92rem;font-weight:600;line-height:1.25;overflow-wrap:anywhere}
.stage.todo strong{color:var(--bone-muted);font-weight:500}
.stage.here strong{font-size:1rem}
.stage .when{color:var(--bone-muted);font:500 .7rem/1.35 var(--mono)}
:lang(fa) .stage .when{font:600 .78rem/1.5 "Vazirmatn",var(--sans)}
.stage.here .when{color:var(--cobalt-soft)}
.stage.waiting .when{color:var(--clay-soft)}
.look{color:var(--cobalt-soft);font-size:.78rem;font-weight:600;text-decoration:none}
.look:hover{color:#fff}
.mascot.rider{position:absolute;top:-4.3rem;left:50%;width:4.2rem;height:4.2rem;filter:drop-shadow(0 .6rem 1.2rem rgba(36,87,255,.35));transform:translateX(-50%)}
.pulse{flex:none;width:.6rem;height:.6rem;border-radius:50%;background:#3fb85c}
.kicker .pulse+*{margin:0}
.holds{display:block;margin-top:.3rem;color:#a4502f;font-size:.92rem;font-weight:600}
.sees{display:grid;grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:.8rem}
.see{display:grid;gap:.45rem;padding:1.15rem 1.25rem;border-radius:1.1rem;background:var(--graphite);color:var(--bone);text-decoration:none;transition:transform .35s cubic-bezier(.2,.9,.25,1.15)}
.see:hover{transform:translateY(-3px);color:var(--bone)}
.see-kind{color:var(--cobalt-soft);font:500 .7rem/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase}
:lang(fa) .see-kind{font:600 .8rem/1.5 "Vazirmatn",var(--sans);text-transform:none}
.see strong{font-size:1.2rem;font-weight:600;letter-spacing:-.02em}
.see-go{color:var(--cobalt-soft);font-weight:600}
.walk-text{display:grid;min-width:0}
.walk-text small{color:var(--ink-muted);font-size:.84rem}
.history{display:grid;margin:0;padding:0;list-style:none}
.history li{position:relative;display:grid;grid-template-columns:4.4rem .8rem minmax(0,1fr);gap:.9rem;padding-bottom:1.3rem}
.history li::before{content:"";position:absolute;top:1.1rem;bottom:0;inset-inline-start:calc(4.4rem + .9rem + .4rem - 1px);width:2px;background:var(--line)}
.history li:last-child::before{display:none}
.h-day{padding-top:.1rem;color:var(--ink-muted);font:500 .74rem/1.5 var(--mono);text-transform:uppercase}
:lang(fa) .h-day{font:600 .84rem/1.6 "Vazirmatn",var(--sans)}
.h-dot{width:.8rem;height:.8rem;margin-top:.3rem;border-radius:50%;background:var(--cobalt);box-shadow:0 0 0 4px var(--bone)}
.history p{color:var(--ink-2);line-height:1.55}
.chips{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.35rem}
.chip{padding:.25rem .7rem;border-radius:999px;background:rgba(36,87,255,.1);color:var(--cobalt);font-size:.86rem;font-weight:600}
@media (max-width:39.99rem){
.route{padding-top:3.6rem}
.stage strong{font-size:.72rem;font-weight:500}
.stage .when,.stage .look{display:none}
.stage.here strong{font-size:.8rem;font-weight:650}
.stage.here .when{display:block}
.node{width:1.15rem;height:1.15rem}
.stage::before{top:.58rem}
.mascot.rider{top:-3.5rem;width:3.4rem;height:3.4rem}
}
@media (min-width:40rem){.phone-only{display:none}}
@media (prefers-reduced-motion:no-preference){
.pulse{animation:pulse 1.8s ease-out infinite}
.stage.here .node{animation:beat 2.2s ease-in-out infinite}
.mascot.rider{animation:hop 2.6s ease-in-out infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(63,184,92,.55)}80%,100%{box-shadow:0 0 0 .55rem rgba(63,184,92,0)}}
@keyframes beat{50%{box-shadow:0 0 0 5px #1b1c1f,0 0 0 13px rgba(36,87,255,.2)}}
@keyframes hop{50%{transform:translateX(-50%) translateY(-5px)}}
}
/* The calendar page (E2): light, the date it goes live first. */
.light .top{border-bottom:1px solid var(--line);background:var(--bone);color:var(--ink)}
.light .top .crumb{color:var(--ink)}
.light .top .crumb>span{border-color:var(--line);color:var(--ink-muted)}
.mono{font-family:var(--mono);letter-spacing:.05em;text-transform:uppercase}
:lang(fa) .mono{font-family:"Vazirmatn",var(--sans);text-transform:none}
.status{border-bottom:1px solid var(--line);background:var(--bone)}
.status .wrap{padding-block:1rem 1.35rem}
.hello{margin-top:.55rem;color:var(--ink-muted);font-size:1.02rem}
.date-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:.15rem}
.big-date{font-size:clamp(2.65rem,6vw,4.5rem);font-weight:600;letter-spacing:-.055em;line-height:.95}
.big-date span{color:var(--cobalt)}
:lang(fa) .big-date{font-weight:700;line-height:1.3}
.big-line{margin-top:.3rem;font-size:clamp(2rem,8vw,3.6rem);font-weight:600;letter-spacing:-.045em;line-height:1.02}
:lang(fa) .big-line{font-weight:700;line-height:1.45}
.countdown{flex:none;text-align:end}
.countdown b{display:block;font-size:clamp(2.3rem,5vw,3.65rem);font-weight:600;letter-spacing:-.05em;line-height:.9}
.countdown .mono{display:block;margin-top:.3rem;color:var(--ink-muted);font-size:.62rem}
.badges{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.75rem}
.badge{display:inline-flex;align-items:center;gap:.4rem;min-height:1.7rem;padding:0 .75rem;border-radius:999px;background:rgba(23,23,23,.07);font-size:.8rem;font-weight:650}
.badge.ok{background:rgba(88,179,107,.16);color:#2f7a42}
.badge.ok i{width:.45rem;height:.45rem;border-radius:50%;background:#58b36b}
.badge.warn{background:rgba(232,102,47,.16);color:#a4502f}
main.calendar{padding-block:1rem clamp(2.5rem,6vw,4rem)}
.calendar-layout,.calendar-support{display:grid;gap:1rem}
.col{display:grid;gap:1rem;align-content:start;min-width:0}
.col>.sec{padding:.8rem .2rem 0;border-top:0}
.card{position:relative;padding:1.15rem 1rem 1rem;border-radius:1.5rem;background:var(--card);box-shadow:0 1px 0 rgba(23,23,23,.04),0 18px 40px -28px rgba(23,23,23,.45)}
.card-head{display:flex;justify-content:space-between;align-items:baseline;gap:1rem}
.hint{color:var(--ink-muted);font-size:.8rem}
.chart{position:relative;margin-top:.6rem;padding-top:4.7rem}
.chart.undated{padding-top:3.4rem}
.wk{position:absolute;top:3.7rem;bottom:0;width:1px;background:rgba(23,23,23,.07)}
.wk-label{position:absolute;top:2.75rem;padding-inline-start:.25rem;color:rgba(23,23,23,.5);font-size:.58rem;white-space:nowrap}
.today{position:absolute;top:2.3rem;bottom:-.2rem;width:2px;margin-inline-start:-1px;background:var(--cobalt);z-index:2}
.plan .mascot.rider{position:absolute;top:0;left:auto;width:2.4rem;height:2.4rem;transform:translateX(-50%);animation:none;z-index:3}
[dir=rtl] .plan .mascot.rider{transform:translateX(50%)}
.today-tag{position:absolute;top:.6rem;margin-inline-start:1.35rem;padding:.18rem .42rem;border-radius:.35rem;background:var(--cobalt);color:#fff;font-size:.56rem;white-space:nowrap;z-index:3}
.rows{position:relative}
.row{position:absolute;inset-inline:0;display:block;height:2.4rem;cursor:pointer}
.row-in{position:absolute;top:0;display:block;min-width:.6rem}
.row-name{position:absolute;top:0;inset-inline-start:0;max-width:min(24rem,70vw);overflow:hidden;font-size:.78rem;font-weight:600;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}
.row.end .row-name{inset-inline-start:auto;inset-inline-end:0}
.bar{display:block;width:100%;height:.9rem;margin-top:1.2rem;border-radius:.35rem;background:rgba(23,23,23,.1);transition:box-shadow .2s}
.row.done .bar,.row.new .bar{background:var(--cobalt)}
.row.half .bar{background:linear-gradient(90deg,var(--cobalt) 50%,rgba(36,87,255,.2) 50%)}
[dir=rtl] .row.half .bar{background:linear-gradient(270deg,var(--cobalt) 50%,rgba(36,87,255,.2) 50%)}
.row.waiting .bar{background:repeating-linear-gradient(45deg,#e8662f 0 6px,#f08a5d 6px 12px)}
.row.waiting .row-name{color:#a4502f}
.row.todo .row-name{color:var(--ink-muted)}
.details{margin-top:1rem}
.detail{display:none;gap:.35rem;padding:.9rem 1rem;border-radius:1rem;background:#f1ede4}
.detail-head{display:flex;justify-content:space-between;align-items:center;gap:.6rem}
.detail-head strong{font-size:1.08rem;font-weight:650}
.tag{display:inline-flex;flex:none;align-items:center;min-height:1.45rem;padding:0 .6rem;border-radius:999px;background:rgba(23,23,23,.07);font-size:.74rem;font-weight:700}
.tag.done{background:var(--cobalt);color:#fff}
.tag.half{background:rgba(36,87,255,.14);color:var(--cobalt)}
.tag.waiting{background:#e8662f;color:#fff}
.detail-dates{color:var(--ink-muted);font-size:.88rem}
.detail .look{color:var(--cobalt);font-size:.92rem;font-weight:600;text-decoration:none}
.note-dark{display:grid;gap:.7rem;padding:1.2rem;border-radius:1.5rem;background:var(--night);color:var(--bone)}
.from{display:flex;align-items:center;gap:.7rem}
.avatar{display:grid;flex:none;place-items:center;width:2.5rem;height:2.5rem;border-radius:50%;background:var(--cobalt);color:#fff;font-size:.82rem;font-weight:700}
.from strong{display:block;font-size:1rem}
.from .mono{display:block;color:var(--bone-muted);font-size:.64rem}
.note-dark .words p{margin:.45rem 0 0;font-size:1.08rem;line-height:1.55;overflow-wrap:anywhere}
.note-dark .words p:first-child{margin-top:0}
.note-dark h4{color:var(--clay-soft);font:500 .7rem/1.35 var(--mono);letter-spacing:.07em;text-transform:uppercase}
.note-dark h4+p{color:var(--bone-2)}
.next-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:.2rem .5rem;padding:.75rem .9rem;border-radius:1rem;background:rgba(36,87,255,.2);font-size:.95rem}
.next-line b{color:var(--cobalt-soft)}
.next-line .mono{color:var(--bone-muted);font-size:.66rem}
.ev.done .ev-head{gap:.6rem}
.ev.done .check{width:1.3rem;height:1.3rem;flex:none}
.btn-light,.btn-line{display:flex;flex:1;align-items:center;justify-content:center;min-height:2.8rem;padding:0 1rem;border-radius:999px;font-size:.94rem;font-weight:600;text-decoration:none}
.btn-light{background:var(--bone);color:var(--night)}
.btn-line{box-shadow:inset 0 0 0 1.5px rgba(243,239,230,.3);color:var(--bone)}
.btn-light:hover{color:var(--night)}.btn-line:hover{color:#fff}
.late-list{display:grid;gap:.6rem}
.late-card{display:grid;gap:.6rem;padding:1rem 1.05rem;border-radius:1.3rem;background:#fff1ea;box-shadow:inset 0 0 0 1.5px rgba(232,102,47,.5)}
.late-head{display:flex;justify-content:space-between;align-items:center;gap:.6rem}
.late-head .mono{color:#a4502f;font-size:.66rem}
.late-card strong{font-size:1.12rem;font-weight:650}
.late-card .pill{justify-self:start}
.who{display:inline-flex;flex:none;align-items:center;min-height:1.4rem;padding:0 .55rem;border-radius:999px;font-size:.72rem;font-weight:750}
.who.you{background:#e8662f;color:#fff}
.who.us{background:rgba(23,23,23,.08);color:var(--ink)}
.who.both{background:rgba(232,102,47,.16);color:#a4502f}
.strip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.25rem;margin-top:.7rem}
.daybtn{display:grid;justify-items:center;gap:.2rem;padding:.5rem 0 .6rem;border-radius:1rem;cursor:pointer;transition:background .2s}
.daybtn .mono{font-size:.56rem;opacity:.75}
.daybtn b{font-size:1.15rem;font-weight:600}
.daybtn.is-today{background:rgba(23,23,23,.06)}
.dots{display:flex;gap:.18rem;height:.38rem}
.dots i{width:.38rem;height:.38rem;border-radius:50%;background:var(--cobalt)}
.dots i.you{background:#e8662f}
.daypanel{display:none;gap:.5rem;margin-top:.9rem}
.day-title{font-size:.96rem;font-weight:650}
.ev{display:grid;gap:.35rem;padding:.9rem 1rem;border-radius:1.1rem;background:var(--card);box-shadow:0 1px 0 rgba(23,23,23,.04),0 14px 34px -26px rgba(23,23,23,.45)}
.ev-head{display:flex;align-items:center;gap:.5rem}
.ev-head strong{font-size:1rem;font-weight:650;overflow-wrap:anywhere}
.ev p{color:var(--ink-muted);font-size:.88rem}
.ev .acts{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1rem;margin-top:.35rem}
.quiet{padding:.9rem 1rem;border-radius:1rem;background:var(--card);color:var(--ink-muted);font-size:.92rem}
.kicker.sub{margin-top:1.3rem}
.evs{display:grid;gap:.5rem;margin-top:.6rem}
.btn-outline{display:flex;align-items:center;justify-content:center;min-height:2.9rem;margin-top:1rem;border-radius:999px;box-shadow:inset 0 0 0 1.5px rgba(23,23,23,.2);color:var(--ink);font-size:.94rem;font-weight:600;text-decoration:none}
.btn-outline:hover{box-shadow:inset 0 0 0 1.5px var(--ink);color:var(--ink)}
.later{display:grid;margin-top:.5rem}
.later-row{display:grid;grid-template-columns:5.8rem minmax(0,1fr) auto;gap:.6rem;align-items:center;padding:.75rem 0;border-top:1px solid var(--line)}
.later-row .mono{color:var(--ink-muted);font-size:.66rem}
.later-row strong{font-size:.94rem;font-weight:600}
.old-body p{margin:.2rem 0 .9rem;color:var(--ink-2)}
.plan-scroll{min-width:0;overflow-x:auto;overflow-y:hidden;padding-bottom:.65rem;overscroll-behavior-inline:contain;scrollbar-color:rgba(36,87,255,.55) rgba(23,23,23,.08);scrollbar-width:thin;touch-action:pan-x pan-y}
.plan-scroll::-webkit-scrollbar{height:.55rem}
.plan-scroll::-webkit-scrollbar-track{border-radius:999px;background:rgba(23,23,23,.08)}
.plan-scroll::-webkit-scrollbar-thumb{border:2px solid var(--card);border-radius:999px;background:rgba(36,87,255,.55)}
.plan-scroll:focus-visible{outline-offset:-2px}
.mobile-hint{display:none}
@media (max-width:63.99rem){
.status .wrap{padding-block:1rem 1.35rem}
.hello{margin-top:.7rem;font-size:1rem}
.date-row{align-items:center;margin-top:.65rem}
.big-date{font-size:clamp(2.25rem,9vw,3.8rem);line-height:1.08}
:lang(fa) .big-date{line-height:1.35}
.countdown{display:flex;align-items:baseline;gap:.35rem}
.countdown b{font-size:clamp(2rem,7.5vw,3rem)}
.countdown .mono{margin-top:0}
.card.plan{overflow:hidden;padding:1.1rem}
.desktop-hint{display:none}
.mobile-hint{display:block}
.plan-scroll{margin:.55rem -1.1rem 0;padding-inline:1.1rem}
.plan-scroll .chart{width:58rem;min-width:58rem;margin-top:0}
.plan>.details{display:block}
}
@media (min-width:64rem){
.calendar-layout{gap:1.5rem}
.calendar-support{grid-template-columns:minmax(0,1.15fr) minmax(20rem,.85fr);gap:1.5rem;align-items:start}
.card{padding:1.5rem 1.4rem 1.3rem}
.card.plan{padding:1.65rem 1.75rem 1.45rem}
.row-name{font-size:.86rem}
.wk-label{font-size:.66rem}
}
/* The questionnaire, in the same clothes. */
.qhero{background:var(--night);color:var(--bone)}
.qhero .wrap{padding-block:clamp(1.2rem,5vw,3.4rem) clamp(1.6rem,4vw,2.8rem)}
.qhero .label{color:var(--cobalt-soft)}
.qhero .label.step{margin-top:.9rem}
.back{display:inline-flex;align-items:center;gap:.5rem;min-height:2.75rem;color:var(--bone-muted);font-size:.94rem;font-weight:550;text-decoration:none}
.back:hover{color:var(--bone)}
.qhero h1{margin-top:.5rem;font-size:clamp(2.3rem,9vw,4.6rem);font-weight:600;letter-spacing:-.05em;line-height:.98;overflow-wrap:anywhere;text-wrap:balance}
:lang(fa) .qhero h1{font-weight:700;line-height:1.4}
.qhero .lede{margin-top:1rem}
.qhero .count{margin-top:1rem;color:var(--bone)}
.qhero .count span{color:var(--bone-muted)}
.qmeta-line{display:flex;flex-wrap:wrap;gap:.3rem 1.2rem;margin-top:1.1rem;color:var(--bone-2);font:500 .76rem/1.4 var(--mono);letter-spacing:.04em;text-transform:uppercase}
:lang(fa) .qmeta-line{font:600 .86rem/1.6 "Vazirmatn",var(--sans);text-transform:none}
.progress{max-width:38rem;margin-top:1.4rem}
.grps{display:flex;gap:8px;margin-top:1rem}
.grp{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:3px}
.grp i{height:8px;border-radius:999px;background:rgba(243,239,230,.16)}
.grp i.on{background:var(--cobalt)}
.grp.now{outline:1.5px solid var(--bone);outline-offset:4px;border-radius:999px}
.split{display:flex;justify-content:space-between;gap:1rem;margin-top:.7rem}
.split .label{color:var(--bone-muted)}
.notice{margin:0 0 14px;padding:1rem 1.15rem;border-radius:1rem;background:#e3efe2;color:var(--ink);font-weight:500;line-height:1.55}
.qform{display:grid;gap:14px}
.label.choose{margin:0 0 .4rem}
.qsec{gap:0}
.q{display:grid;gap:.6rem;padding:1.2rem 0;border-top:1px solid var(--line)}
.q:first-of-type{padding-top:.2rem;border-top:0}
.q label,.qlabel{display:grid;gap:.4rem;font-size:1.08rem;font-weight:600;line-height:1.45;overflow-wrap:anywhere}
.qn{color:var(--cobalt);font:500 .74rem/1.3 var(--mono);letter-spacing:.06em}
:lang(fa) :is(.q label,.qlabel){line-height:1.85}
:lang(fa) .qn{font:700 .86rem/1.3 "Vazirmatn",var(--sans)}
.q small{color:var(--ink-muted);font-size:.92rem;font-weight:400;line-height:1.55}
.need{justify-self:start;padding:.25rem .6rem;border-radius:999px;background:rgba(201,109,75,.14);color:#a4502f;font:500 .68rem/1.3 var(--mono);font-style:normal;letter-spacing:.06em;text-transform:uppercase}
:lang(fa) .need{font:600 .8rem/1.5 "Vazirmatn",var(--sans);text-transform:none}
.q textarea,.times textarea{width:100%;min-height:6rem;padding:.9rem 1rem;border:1.5px solid rgba(23,23,23,.16);border-radius:.9rem;background:#fff;color:var(--ink);font:inherit;line-height:1.6;resize:vertical;field-sizing:content;transition:border-color .2s,box-shadow .2s}
.q textarea::placeholder,.times textarea::placeholder{color:rgba(23,23,23,.4)}
.q textarea:focus-visible,.times textarea:focus-visible{outline:none;border-color:var(--cobalt);box-shadow:0 0 0 3px rgba(36,87,255,.18)}
.answer{padding:.9rem 1rem;border-radius:.9rem;background:#fff}
.answer p{margin:.25rem 0;color:var(--ink-2)}
.answer .none{color:var(--ink-muted);font-style:italic}
.qactions{display:grid;gap:10px}
.qactions button{min-height:3.3rem;padding:0 1.5rem;border-radius:999px;font:inherit;font-size:1rem;font-weight:600;cursor:pointer;transition:background .2s,box-shadow .2s,transform .35s cubic-bezier(.2,.9,.25,1.15)}
.qactions button:hover{transform:translateY(-2px)}
.qactions .primary{border:0;background:var(--cobalt);color:#fff}
.qactions .primary:hover{background:var(--cobalt-2)}
.qactions .secondary{border:0;background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px rgba(23,23,23,.28)}
.qactions .secondary:hover{box-shadow:inset 0 0 0 1.5px var(--ink)}
.qactions .plain{border:0;background:transparent;color:var(--ink-2);text-decoration:underline;text-underline-offset:.25em}
.qactions .plain:hover{transform:none}
.qnote{color:var(--ink-muted);font-size:.92rem;line-height:1.55}
.qhelp{color:var(--ink-muted);font-size:.9rem}
.qhelp p{max-width:40rem;margin:.45rem 0}
.prows{display:grid}
.prow{display:grid;grid-template-columns:2.2rem minmax(0,1fr) auto;gap:.6rem;align-items:baseline;padding:.85rem 0;border-top:1px solid var(--line);color:var(--ink);text-decoration:none}
a.prow:hover strong{color:var(--cobalt)}
.prow small{display:block;margin-top:.1rem;color:var(--ink-muted);font-size:.86rem}
.prow>a{grid-column:2;font-size:.92rem;font-weight:600;text-decoration:none}
.pn{color:var(--cobalt);font:500 .74rem/1.4 var(--mono)}
.pc{color:var(--ink-2);font:500 .76rem/1.4 var(--mono);white-space:nowrap}
.pc.full{color:#3f8f52}
:lang(fa) :is(.pn,.pc){font:600 .84rem/1.6 "Vazirmatn",var(--sans)}
.panel.waiting{box-shadow:inset 0 0 0 1.5px rgba(201,109,75,.45)}
.panel.waiting h2{color:var(--clay)}
.panel.welcome h2{color:var(--cobalt)}
.gap{display:grid;gap:.35rem;padding:.85rem 0;border-top:1px solid var(--line)}
.gap strong{font-size:1.04rem;font-weight:600;line-height:1.4}
.gap .label{color:var(--clay)}
.donehead{display:flex;align-items:center;gap:1rem;margin-top:1.2rem}
.donehead h1{margin:0}
.check{display:grid;place-items:center;width:1.6rem;height:1.6rem;border-radius:50%;background:var(--moss)}
.check::after{content:"";width:.6rem;height:.3rem;border:solid #fff;border-width:0 0 2.5px 2.5px;transform:rotate(-45deg) translate(1px,-1px)}
.check.big{flex:none;width:3.6rem;height:3.6rem}
.check.big::after{width:1.4rem;height:.65rem;border-width:0 0 4px 4px}
.quote{padding:.6rem .9rem;border-inline-start:3px solid var(--cobalt);color:var(--ink-2)}
.times{display:grid;gap:.5rem;margin-top:.4rem}
.times label{font-size:.94rem;font-weight:600}
.times label span{color:var(--ink-muted);font-weight:400}
.times textarea{min-height:4rem}
.times button{justify-self:start;min-height:3.1rem;padding:0 1.4rem;border:0;border-radius:999px;background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px rgba(23,23,23,.28);font:inherit;font-weight:600;cursor:pointer}
.times button:hover{box-shadow:inset 0 0 0 1.5px var(--ink)}
.btn{display:inline-flex;align-items:center;justify-content:space-between;gap:1rem;justify-self:start;min-height:3.3rem;padding:0 1.45rem;border-radius:999px;background:var(--cobalt);color:#fff;font-weight:600;text-decoration:none;transition:background .2s,transform .35s cubic-bezier(.2,.9,.25,1.15)}
.btn:hover{transform:translateY(-2px);background:var(--cobalt-2);color:#fff}
.btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px rgba(23,23,23,.28)}
.btn.ghost:hover{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink)}
.btn.lead{justify-content:flex-start;gap:.7rem}
/* A link that no longer works. */
.gone{flex:1 0 auto}
.gone h1{max-width:16ch;margin-top:1rem;font-size:clamp(2.4rem,9vw,4.6rem);font-weight:600;letter-spacing:-.05em;line-height:1}
:lang(fa) .gone h1{font-weight:700;line-height:1.4}
.gone .lede{margin-bottom:1.4rem}
.sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (min-width:40rem){
.facts{grid-template-columns:repeat(var(--cols,3),minmax(0,1fr));gap:1.5rem}
.facts div{padding:1rem 0 0;border-bottom:0}
.qactions{display:flex;flex-wrap:wrap}
.cards.two{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (min-width:60rem){
.hero .wrap{grid-template-columns:minmax(0,1.25fr) minmax(0,.75fr);align-items:center;min-height:min(78svh,44rem)}
.hero .mascot.small{display:none}
.hero .mascot.large{display:block;justify-self:center;width:min(100%,24rem);aspect-ratio:1}
.facts{grid-column:1/-1}
.block{grid-template-columns:minmax(10rem,.3fr) minmax(0,1fr);gap:clamp(1.5rem,4vw,5rem)}
.index{display:grid;align-content:start;gap:.5rem}
.qform{grid-template-columns:minmax(0,46rem)}
}
@media (prefers-reduced-motion:no-preference){
.hero .kicker,.title,.lede,.track,.facts,.hero .mascot.large{animation:rise .9s var(--ease) both}
.title{animation-delay:.06s}.lede{animation-delay:.14s}.track{animation-delay:.2s}.facts{animation-delay:.28s}.hero .mascot.large{animation-delay:.12s}
.track i{animation:draw .6s var(--ease) both}
.track i:nth-child(2){animation-delay:.05s}.track i:nth-child(3){animation-delay:.1s}.track i:nth-child(4){animation-delay:.15s}.track i:nth-child(5){animation-delay:.2s}.track i:nth-child(6){animation-delay:.25s}.track i:nth-child(n+7){animation-delay:.3s}
@keyframes rise{from{opacity:0;transform:translateY(.9rem)}to{opacity:1;transform:none}}
@keyframes draw{from{transform:scaleX(0)}to{transform:scaleX(1)}}
}
@media print{html,body,main{background:#fff}.top,.band,.lang,.pill,.qactions,.mascot{display:none}.hero,.qhero{background:#fff;color:#000}.hero::after{display:none}.title em,.facts dd,.facts dt,.lede{color:#000}.note,.panel{box-shadow:none;border:1px solid #bbb}.next{background:#fff;color:#000;border:1px solid #bbb}footer{background:#fff;color:#000}}
`;

function shell({ lang, title, description, body, baseUrl, otherHref, note = true, crumb = "", light = false }) {
  const w = WORDS[lang];
  const image = baseUrl ? `${baseUrl}/assets/falcon.svg` : "/assets/falcon.svg";
  const name = String(crumb || "").trim();
  return `<!doctype html>
<html lang="${lang}" dir="${w.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#111214">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:site_name" content="Your company">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<link rel="icon" href="/assets/falcon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body${light ? ' class="light"' : ""}>
<header class="top"><div class="wrap">
<span class="crumb">${WORDMARK}${name ? `<span dir="auto">${escapeHtml(name)}</span>` : ""}</span>
<span class="tools">${otherHref ? `<a class="lang" href="${escapeHtml(otherHref)}" hreflang="${w.otherCode}" lang="${w.otherCode}">${escapeHtml(w.other)}</a>` : ""}</span>
</div></header>
${body}
<footer><div class="wrap"><span class="crumb">${WORDMARK}</span>${note ? `<p>${escapeHtml(w.private)}</p>` : ""}${w.creed ? `<span class="creed" dir="ltr">${escapeHtml(w.creed)}</span>` : ""}</div></footer>
</body>
</html>`;
}

/** A very long name gets a smaller headline, so it still sits on a phone in a few lines. */
function nameSize(name) {
  const length = [...String(name || "")].length;
  return length > 34 ? "l" : length > 18 ? "m" : "";
}

/** Today's date where the owner works, as "YYYY-MM-DD". */
function todayIn(timeZone, now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from today to a calendar day; null when it is not a real day. */
function daysUntil(value, timeZone, now) {
  const day = realDay(value);
  const today = realDay(todayIn(timeZone, now));
  if (!day || !today) return null;
  return Math.round((day.getTime() - today.getTime()) / 86400000);
}

function relative(value, w, ctx) {
  const days = daysUntil(value, ctx.timeZone, ctx.now);
  return days === null ? "" : w.soon(days);
}

/** "Thursday 22 October": a day said in full. */
function longDay(value, lang) {
  const date = realDay(value);
  if (!date) return "";
  return dateFormatter(lang, { weekday: "long", day: "numeric", month: "long" }, "UTC").format(date);
}

const count = (value, lang) => (lang === "fa" ? n(value) : String(value));

/** Section numbers: "01" in English; in Persian a plain "۱", because the Persian zero is a dot. */
const pad = (value, lang) => (lang === "fa" ? n(value) : String(value).padStart(2, "0"));

function needRows(need) {
  return (Array.isArray(need) ? need : []).filter((row) => Array.isArray(row) && String(row[0] ?? "").trim());
}

function arrow(lang) {
  return `<i aria-hidden="true">${lang === "fa" ? "←" : "→"}</i>`;
}


/**
 * What the client should know first, in the order it matters: something of
 * theirs that is late; the nearest date ahead (the latest update's next step or
 * a project milestone); or that the work is finished.
 */
function focusOf({ projects, latest, showUpdates, ctx }) {
  const needs = showUpdates && latest ? needRows(latest.payload?.need) : [];
  const late = needs
    .map(([what, , by]) => ({ what: String(what), by, days: daysUntil(by, ctx.timeZone, ctx.now) }))
    .filter((row) => row.days !== null && row.days < 0)
    .sort((a, b) => a.days - b.days)[0];
  const dates = [];
  const p = latest?.payload || {};
  if (showUpdates && latest && realDay(p.nextDate)) dates.push({ day: p.nextDate, what: String(p.nextStep || "").trim() });
  for (const project of projects) {
    if (project.status === "done" || !realDay(project.milestoneDueOn)) continue;
    dates.push({ day: project.milestoneDueOn, what: String(project.milestone || "").trim() || String(project.name || "") });
  }
  const upcoming = dates
    .map((item) => ({ ...item, days: daysUntil(item.day, ctx.timeZone, ctx.now) }))
    .filter((item) => item.days !== null && item.days >= 0)
    .sort((a, b) => a.days - b.days)[0] || null;
  const finished = projects.length > 0 && projects.every((project) => project.status === "done");
  const undated = showUpdates && latest && !upcoming && String(p.nextStep || "").trim() ? { what: String(p.nextStep).trim() } : null;
  return { late, upcoming, undated, finished };
}

/* "Dr. Ahmadi" is greeted as "Dr. Ahmadi", "Lena Vogt" as "Lena". */
const TITLES = new Set(["dr", "mr", "mrs", "ms", "prof", "eng", "دکتر", "مهندس", "استاد", "آقای", "خانم"]);
function firstName(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const isTitle = TITLES.has(words[0].replace(/\.$/, "").toLowerCase());
  return isTitle && words[1] ? `${words[0]} ${words[1]}` : words[0];
}

/** A WhatsApp link to us with the client's message already written. */
function waText(number, text) {
  const base = whatsappLink(number);
  return base ? `${base}?text=${encodeURIComponent(text)}` : "";
}

function pill(href, label, lang, kind = "") {
  const external = href.startsWith("http");
  return `<a class="pill${kind ? ` ${kind}` : ""}" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(label)}${arrow(lang)}</a>`;
}

/**
 * The steps of the latest update, each with the state the client reads, its
 * due date and link, and the day it was first seen done. "Done this week" is a
 * step that is done now and was not done in the update before.
 */
function stepsOf(latest, previous, w, history = []) {
  const pieces = (latest?.payload?.pieces || []).filter((row) => Array.isArray(row) && String(row[0] || "").trim() && w.pieceStates[row[1]]);
  const key = (name) => String(name).trim().toLowerCase();
  const before = previous ? new Map((previous.payload?.pieces || []).filter(Array.isArray).map((row) => [key(row[0]), row[1]])) : null;
  // The first update (oldest first) that shows a step done is when it was done.
  const doneOn = new Map();
  for (const update of [...history].reverse()) {
    for (const row of (update.payload?.pieces || []).filter(Array.isArray)) {
      if (row[1] === "done" && !doneOn.has(key(row[0]))) doneOn.set(key(row[0]), update.publishedAt);
    }
  }
  return pieces.map(([name, state, due, link, start]) => ({
    name,
    state: state === "done" && before && before.get(key(name)) !== "done" ? "new" : state,
    due: realDay(due) ? due : "",
    start: realDay(start) ? start : "",
    link: typeof link === "string" && /^https?:\/\//.test(link) ? link : "",
    doneAt: doneOn.get(key(name)) || ""
  }));
}

const isDone = (step) => step.state === "done" || step.state === "new";

/** The step the work is on: the first in progress, else the first waiting on them, else the next not started. */
function currentStep(steps) {
  return steps.find((step) => step.state === "half") || steps.find((step) => step.state === "waiting") || steps.find((step) => step.state === "todo") || null;
}

/** Launch: the last step's date, else the deadline of a project on the page. */
function launchDay(steps, projects) {
  const last = steps[steps.length - 1];
  if (last && last.due) return last.due;
  const project = projects.find((item) => item.status !== "done" && realDay(item.dueOn));
  return project ? project.dueOn : "";
}

/** The sentence under the greeting, when there is no launch date to lead with. */
function summary({ steps, focus, latest, showUpdates, w }) {
  if (focus.finished || (steps.length && steps.every(isDone))) return w.sumDone;
  const now = currentStep(steps);
  if (now) return now.state === "waiting" ? w.sumWaiting(now.name) : now.state === "todo" ? w.sumUpNext(now.name) : w.sumNow(now.name);
  if (showUpdates && latest) return w.sumMoving;
  return w.sumWelcome;
}

/* Days as whole numbers, so the plan can be laid out as plain arithmetic. */
const DAY_MS = 86400000;
function dayNum(value) {
  const date = realDay(value);
  return date ? Math.floor(date.getTime() / DAY_MS) : null;
}
function dayStr(number) {
  return new Date(number * DAY_MS + 12 * 3600000).toISOString().slice(0, 10);
}
function localDayNum(iso, ctx) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dayNum(todayIn(ctx.timeZone, date));
}

/**
 * The plan as bars on a line of weeks. Explicit start dates preserve parallel
 * workstreams; older updates still fall back to consecutive inferred starts.
 * Steps without an end date are spread between the ones that have one.
 */
function planOf(steps, updates, projects, ctx) {
  const today = dayNum(todayIn(ctx.timeZone, ctx.now));
  const firstUpdate = updates.length ? localDayNum(updates[updates.length - 1].publishedAt, ctx) ?? today : today;
  const ends = steps.map((step) => dayNum(step.due) ?? (step.doneAt ? localDayNum(step.doneAt, ctx) : null));
  const starts = steps.map((step) => dayNum(step.start));
  const dated = ends.some((end) => end !== null) || starts.some((day) => day !== null);
  const launch = dayNum(launchDay(steps, projects));
  const known = ends.filter((end) => end !== null);
  const knownStarts = starts.filter((day) => day !== null);
  let start = knownStarts.length ? Math.min(...knownStarts) : Math.min(firstUpdate, today, known.length ? known[0] - 5 : firstUpdate);
  if (!dated) {
    const each = 7;
    return {
      dated: false,
      today,
      launch,
      bars: steps.map((step, index) => ({ from: index * each, to: (index + 1) * each, left: (index / steps.length) * 100, width: 100 / steps.length })),
      weeks: [],
      todayAt: null,
      start: null,
      span: null
    };
  }
  // Fill the gaps: between two known ends, evenly; after the last, a week each.
  const filled = [...ends];
  for (let index = 0; index < filled.length; index += 1) {
    if (filled[index] !== null) continue;
    const before = index ? filled[index - 1] : start;
    let next = index + 1;
    while (next < filled.length && ends[next] === null) next += 1;
    filled[index] = next < filled.length ? Math.round(before + (ends[next] - before) / (next - index + 1)) : before + 7;
  }
  for (let index = 1; index < filled.length; index += 1) filled[index] = Math.max(filled[index], filled[index - 1]);
  const end = Math.max(filled[filled.length - 1], launch ?? -Infinity, today + 1);
  if (!knownStarts.length) start = Math.min(start, filled[0] - 2);
  const span = Math.max(end - start, 7);
  const at = (day) => ((day - start) / span) * 100;
  const bars = filled.map((to, index) => {
    let from = starts[index] ?? (index ? filled[index - 1] : start);
    if (to < from) to = from;
    if (to - from < 2) from = to - 2;
    return { from, to, left: Math.max(0, at(from)), width: Math.max(at(to) - at(from), 3) };
  });
  const weeks = [];
  for (let day = start; day < start + span; day += 7) weeks.push({ day, at: at(day) });
  return { dated: true, today, launch, bars, weeks, todayAt: Math.min(100, Math.max(0, at(today))), start, span };
}

/** Everything with a day (or a "do it any time") for the client and for us, from the latest update. */
function eventsOf({ steps, latest, questionnaires, base, w, lang, ctx, contact, companyName }) {
  const today = dayNum(todayIn(ctx.timeZone, ctx.now));
  const events = [];
  for (const [what, , by] of needRows(latest?.payload?.need)) {
    const day = dayNum(by);
    const send = waText(contact.whatsapp, w.sendMsg(String(what).trim(), companyName));
    events.push({ day, who: "you", title: w.evSend(String(what).trim()), note: day === null && String(by ?? "").trim() ? `${w.by} ${String(by).trim()}` : "", action: send ? { href: send, label: w.sendIt } : null, late: day !== null && day < today });
  }
  const p = latest?.payload || {};
  if (String(p.nextStep || "").trim() && dayNum(p.nextDate) !== null) {
    events.push({ day: dayNum(p.nextDate), who: "us", title: String(p.nextStep).trim(), note: "", action: null });
  }
  steps.forEach((step, index) => {
    if (isDone(step) || !step.due) return;
    const last = index === steps.length - 1;
    events.push({ day: dayNum(step.due), who: step.state === "waiting" ? "both" : "us", title: last ? w.evFinal(step.name) : w.evStepDone(step.name), note: "", action: null, step: true });
  });
  const byAge = (a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  for (const q of questionnaires.filter((item) => item.status === "open").sort(byAge)) {
    const pr = q.progress || { total: 0, answered: 0 };
    const left = Math.max(1, Math.ceil(((pr.total - pr.answered) * 5) / 3));
    events.push({
      day: null,
      who: "you",
      title: w.qTask(q.title),
      note: q.callRequestedAt && !pr.answered ? w.qCallAsked : w.qTaskMeta(pr.answered, pr.total, pr.answered ? left : minutesFor(pr.total)),
      action: { href: `${base}/q/${q.id}`, label: pr.answered ? w.qContinueBtn : w.qStartBtn },
      talk: pr.answered ? "" : `${base}/q/${q.id}`
    });
  }
  // Answered sets stay findable, after everything still to do.
  for (const q of questionnaires.filter((item) => item.status !== "open").sort(byAge)) {
    events.push({ day: null, who: "you", title: w.qDoneItem(q.title), note: "", action: null, done: true, href: `${base}/q/${q.id}` });
  }
  return events.sort((a, b) => (a.day ?? Infinity) - (b.day ?? Infinity));
}

function whoTag(who, w) {
  return `<span class="who ${who}">${escapeHtml(w.who[who])}</span>`;
}

function eventCard(event, w, lang) {
  if (event.done) return `<div class="ev done"><div class="ev-head"><span class="check" aria-hidden="true"></span><strong dir="auto">${escapeHtml(event.title)}</strong></div><a class="textlink" href="${escapeHtml(event.href)}">${escapeHtml(w.lookAnswers)}</a></div>`;
  const action = event.action ? pill(event.action.href, event.action.label, lang) : "";
  const talk = event.talk ? `<a class="textlink" href="${escapeHtml(event.talk)}">${escapeHtml(w.qTalk)}</a>` : "";
  return `<div class="ev${event.late ? " late" : ""}"><div class="ev-head">${whoTag(event.who, w)}<strong dir="auto">${escapeHtml(event.title)}</strong></div>${event.note ? `<p dir="auto">${escapeHtml(event.note)}</p>` : ""}${action || talk ? `<div class="acts">${action}${talk}</div>` : ""}</div>`;
}

/** The opening: when it goes live and how long until then, and three plain badges. */
function statusSection({ company, person, steps, plan, focus, latest, showUpdates, events, w, lang }) {
  const name = String(company?.name || "").trim();
  const hi = w.hi(firstName(person)).replace(/\.$/, "");
  const finished = focus.finished || (steps.length > 0 && steps.every(isDone));
  const launch = plan.launch;
  const daysLeft = launch !== null ? launch - plan.today : null;
  let head;
  if (finished) {
    head = `<p class="hello">${escapeHtml(hi)}${escapeHtml(w.comma)}</p><h1 class="big-date">${escapeHtml(w.isLive)}</h1>`;
  } else if (launch !== null && daysLeft >= 0) {
    const day = realDay(dayStr(launch));
    const weekday = dateFormatter(lang, { weekday: "short" }, "UTC").format(day);
    const date = dateFormatter(lang, { day: "numeric", month: "short" }, "UTC").format(day);
    head = `<p class="hello">${escapeHtml(`${hi}${w.comma} ${w.goesLive}`)}</p><div class="date-row"><h1 class="big-date">${escapeHtml(weekday)} <span>${escapeHtml(date)}</span></h1><p class="countdown"><b>${escapeHtml(count(daysLeft, lang))}</b><span class="mono">${escapeHtml(w.daysToGo(daysLeft))}</span></p></div>`;
  } else {
    head = `<p class="hello">${escapeHtml(hi)}${escapeHtml(w.comma)}</p><h1 class="big-line">${escapeHtml(summary({ steps, focus, latest, showUpdates, w }))}</h1>`;
  }
  const badges = [];
  if (steps.length && !finished) {
    const behind = steps.some((step) => !isDone(step) && step.due && dayNum(step.due) < plan.today);
    badges.push(behind ? `<span class="badge warn">${escapeHtml(w.behind)}</span>` : `<span class="badge ok"><i aria-hidden="true"></i>${escapeHtml(w.onSchedule)}</span>`);
  }
  if (plan.dated && !finished && launch !== null) {
    const week = Math.floor((plan.today - plan.start) / 7) + 1;
    const weeksAll = Math.max(week, Math.ceil(plan.span / 7));
    badges.push(`<span class="badge">${escapeHtml(w.weekOf(Math.max(1, week), weeksAll))}</span>`);
  }
  const late = events.filter((event) => event.late).length;
  if (late) badges.push(`<span class="badge warn">${escapeHtml(w.lateCount(late))}</span>`);
  return `<section class="status"><div class="wrap"><p class="kicker"><span dir="auto">${escapeHtml(name)}</span>${escapeHtml(w.sep)}${escapeHtml(w.kicker)}</p>${head}${badges.length ? `<div class="badges">${badges.join("")}</div>` : ""}</div></section>`;
}

/**
 * The plan. Each step is a bar on the weeks; the mascot stands on today.
 * Tapping a step opens its details, with radio buttons and CSS alone: the
 * client page runs no script.
 */
function planSection({ steps, plan, w, lang, ctx }) {
  if (!steps.length) return "";
  const current = currentStep(steps);
  const pick = Math.max(0, current ? steps.indexOf(current) : steps.length - 1);
  const radios = steps.map((_, index) => `<input class="sr" type="radio" name="step" id="st${index}"${index === pick ? " checked" : ""}>`).join("");
  const weekLabel = (day, index) => {
    const date = realDay(dayStr(day));
    const month = (value) => dateFormatter(lang, { month: "short" }, "UTC").format(value);
    // A new month in the page's own calendar (Persian months turn over on other days).
    const withMonth = !index || month(realDay(dayStr(day - 7))) !== month(date);
    return dateFormatter(lang, withMonth ? { day: "numeric", month: "short" } : { day: "numeric" }, "UTC").format(date);
  };
  const grid = plan.weeks.map((week, index) => `<i class="wk" style="inset-inline-start:${week.at.toFixed(2)}%"></i><span class="wk-label mono" style="inset-inline-start:${week.at.toFixed(2)}%">${escapeHtml(weekLabel(week.day, index))}</span>`).join("");
  const mascotAt = plan.todayAt ?? (plan.bars[pick].left + plan.bars[pick].width / 2);
  // Keep the marker inside the chart at either edge; the dates and bars retain
  // their exact positions while the mascot and label remain fully readable.
  const markerAt = Math.min(97.5, Math.max(2.5, mascotAt));
  const now = `<i class="today" style="inset-inline-start:${markerAt.toFixed(2)}%"${plan.todayAt === null ? ' hidden' : ""}></i><span class="mascot rider build" aria-hidden="true" style="inset-inline-start:${markerAt.toFixed(2)}%"></span>${plan.todayAt !== null ? `<span class="today-tag mono" style="inset-inline-start:${markerAt.toFixed(2)}%">${escapeHtml(w.todayTag)}</span>` : ""}`;
  const rows = steps.map((step, index) => {
    const bar = plan.bars[index];
    const end = bar.left + bar.width > 62;
    const position = end ? `inset-inline-end:${Math.max(0, 100 - bar.left - bar.width).toFixed(2)}%` : `inset-inline-start:${bar.left.toFixed(2)}%`;
    return `<label for="st${index}" class="row ${step.state}${end ? " end" : ""}" style="top:${index * 2.6}rem"><span class="row-in" style="${position};width:${bar.width.toFixed(2)}%"><span class="row-name" dir="auto">${escapeHtml(step.name)}</span><span class="bar"></span></span></label>`;
  }).join("");
  const presentations = steps.map((step, index) => {
    const bar = plan.bars[index];
    const status = isDone(step) ? w.pieceStates.done : step.state === "waiting" ? w.pieceStates.waiting : step === current ? w.pieceStates.half : w.comingTag;
    const from = plan.dated ? calendarDay(dayStr(bar.from), lang) : "";
    const to = plan.dated ? calendarDay(dayStr(bar.to), lang) : "";
    const doneOn = step.doneAt ? calendarDay(todayIn(ctx.timeZone, new Date(step.doneAt)), lang, false) : "";
    const dates = plan.dated ? `${from} – ${to}${isDone(step) && doneOn ? `${w.sep}${w.doneOn(doneOn)}` : ""}` : "";
    const look = step.link ? `<a class="look" href="${escapeHtml(step.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(w.lookAt)} <span aria-hidden="true">↗</span></a>` : "";
    return { step, index, status, dates, look };
  });
  const details = presentations.map(({ step, index, status, dates, look }) => `<div class="detail" id="d${index}"><div class="detail-head"><strong dir="auto">${escapeHtml(step.name)}</strong><span class="tag ${step.state === "new" ? "done" : step.state}">${escapeHtml(status)}</span></div>${dates ? `<p class="detail-dates">${escapeHtml(dates)}</p>` : ""}${look}</div>`).join("");
  const rules = steps.map((_, index) => `#st${index}:checked~.plan-scroll label[for=st${index}] .row-name{font-weight:750}#st${index}:checked~.plan-scroll label[for=st${index}] .bar{box-shadow:0 0 0 2px var(--card),0 0 0 4px var(--cobalt)}#st${index}:checked~.details #d${index}{display:grid}#st${index}:focus-visible~.plan-scroll label[for=st${index}]{outline:3px solid var(--cobalt-soft);outline-offset:2px}`).join("");
  return `<section class="card plan" aria-labelledby="plan-h"><style>${rules}</style><div class="card-head"><p class="kicker" id="plan-h">${escapeHtml(w.planKicker)}</p><span class="hint desktop-hint">${escapeHtml(w.tapStep)}</span><span class="hint mobile-hint">${escapeHtml(w.swipePlan)}</span></div>${radios}<div class="plan-scroll" dir="${lang === "fa" ? "rtl" : "ltr"}" tabindex="0" role="region" aria-label="${escapeHtml(w.planScrollLabel)}"><div class="chart${plan.dated ? "" : " undated"}" style="height:${steps.length * 2.6 + 4.2}rem">${grid}${now}<div class="rows">${rows}</div></div></div><div class="details">${details}</div></section>`;
}

/** Alex's note, dark, with the two replies a client most often wants to send. */
function noteSection(latest, w, lang, ctx, contact, companyName) {
  if (!latest) return "";
  const p = latest.payload || {};
  const writing = { lang: latest.language, pageLang: lang };
  const published = calendarDay(todayIn(ctx.timeZone, new Date(latest.publishedAt)), lang, false);
  const ok = waText(contact.whatsapp, w.reactOkMsg(published, companyName));
  const ask = waText(contact.whatsapp, w.reactAskMsg(published, companyName));
  return `<section class="note-dark" aria-labelledby="latest"><div class="from"><span class="avatar" aria-hidden="true">AR</span><span><strong id="latest">${escapeHtml(w.alex)}</strong><span class="mono">${escapeHtml(w.thisWeek(calendarDay(todayIn(ctx.timeZone, new Date(latest.publishedAt)), lang)))}</span></span></div>
${p.moved ? `<div class="words">${prose(p.moved, writing)}</div>` : ""}
${p.stuck ? `<h4 class="stuck">${escapeHtml(w.stuck)}</h4>${prose(p.stuck, writing)}` : ""}
${p.moneyNote ? `<h4 class="money">${escapeHtml(w.money)}</h4>${prose(p.moneyNote, writing)}` : ""}
${p.nextStep ? `<p class="next-line"><b>${escapeHtml(w.nextLabel)}</b> <span dir="auto">${escapeHtml(p.nextStep)}</span>${realDay(p.nextDate) ? `<span class="mono">${escapeHtml(calendarDay(p.nextDate, lang))}</span>` : ""}</p>` : ""}
${ok ? `<div class="react"><a class="btn-light" href="${escapeHtml(ok)}" target="_blank" rel="noopener noreferrer">${escapeHtml(w.reactOk)}</a><a class="btn-line" href="${escapeHtml(ask)}" target="_blank" rel="noopener noreferrer">${escapeHtml(w.reactAsk)}</a></div>` : ""}</section>`;
}

/** What is late, in clay, at the top of the client's side. */
function lateSection(events, w, lang) {
  const late = events.filter((event) => event.late);
  if (!late.length) return "";
  return `<section class="late-list" aria-label="${escapeHtml(w.lateLabel)}">${late.map((event) => `<div class="late-card"><div class="late-head">${whoTag("you", w)}<span class="mono">${escapeHtml(w.wasDueOn(calendarDay(dayStr(event.day), lang)))}</span></div><strong dir="auto">${escapeHtml(event.title)}</strong>${event.action ? pill(event.action.href, event.action.label, lang) : ""}</div>`).join("")}</section>`;
}

/** The next seven days as a strip; tap a day to see what happens on it. */
function weekSection({ events, steps, plan, w, lang, base }) {
  const days = Array.from({ length: 7 }, (_, index) => plan.today + index);
  const current = currentStep(steps);
  const panels = days.map((day, index) => {
    const todays = events.filter((event) => event.day === day && !event.late);
    const date = realDay(dayStr(day));
    const title = index === 0 ? w.todayTitle(calendarDay(dayStr(day), lang)) : longDay(dayStr(day), lang);
    const body = todays.length ? todays.map((event) => eventCard(event, w, lang)).join("") : `<p class="quiet">${escapeHtml(current ? w.quietDay(current.name) : w.quietDayPlain)}</p>`;
    return { day, index, date, title, body, dots: todays.map((event) => (event.who === "us" ? "us" : "you")) };
  });
  const radios = panels.map((panel) => `<input class="sr" type="radio" name="day" id="dy${panel.index}"${panel.index === 0 ? " checked" : ""}>`).join("");
  const strip = panels.map((panel) => `<label for="dy${panel.index}" class="daybtn${panel.index === 0 ? " is-today" : ""}"><span class="mono">${escapeHtml(dateFormatter(lang, { weekday: "short" }, "UTC").format(panel.date))}</span><b>${escapeHtml(dateFormatter(lang, { day: "numeric" }, "UTC").format(panel.date))}</b><span class="dots">${panel.dots.map((dot) => `<i class="${dot}"></i>`).join("")}</span></label>`).join("");
  const bodies = panels.map((panel) => `<div class="daypanel" id="dp${panel.index}"><p class="day-title">${escapeHtml(panel.title)}</p>${panel.body}</div>`).join("");
  const rules = panels.map((panel) => `#dy${panel.index}:checked~.strip label[for=dy${panel.index}]{background:var(--cobalt);color:#fff}#dy${panel.index}:checked~.strip label[for=dy${panel.index}] .dots i.us{background:#fff}#dy${panel.index}:checked~.daypanels #dp${panel.index}{display:grid}#dy${panel.index}:focus-visible~.strip label[for=dy${panel.index}]{outline:3px solid var(--cobalt-soft);outline-offset:2px}`).join("");
  const anytime = events.filter((event) => event.day === null);
  const calendar = events.some((event) => event.day !== null) ? `<a class="btn-outline" href="${escapeHtml(base)}/calendar.ics">${escapeHtml(w.addCalendar)}</a>` : "";
  return `<section class="sec week" aria-labelledby="week-h"><style>${rules}</style><p class="kicker" id="week-h">${escapeHtml(w.next7)}</p>${radios}<div class="strip">${strip}</div><div class="daypanels">${bodies}</div>${anytime.length ? `<p class="kicker sub">${escapeHtml(w.anyTime)}</p><div class="evs">${anytime.map((event) => eventCard(event, w, lang)).join("")}</div>` : ""}${calendar}</section>`;
}

/** After the next seven days: the big dates, and whose they are. */
function laterSection(events, plan, w, lang) {
  const later = events.filter((event) => event.day !== null && event.day > plan.today + 6);
  if (!later.length) return "";
  return `<section class="sec" aria-labelledby="later-h"><p class="kicker" id="later-h">${escapeHtml(w.laterKicker)}</p><div class="later">${later.map((event) => `<div class="later-row"><span class="mono">${escapeHtml(calendarDay(dayStr(event.day), lang))}</span><strong dir="auto">${escapeHtml(event.title)}</strong>${whoTag(event.who, w)}</div>`).join("")}</div></section>`;
}

function earlierSection(earlier, w, lang, ctx) {
  if (!earlier.length) return "";
  const rows = earlier.map((update) => {
    const day = calendarDay(todayIn(ctx.timeZone, new Date(update.publishedAt)), lang, false);
    const writing = { lang: update.language, pageLang: lang };
    const first = String(update.payload?.moved || "").trim().split("\n")[0] || w.stepsOnly;
    return `<details class="old"><summary><span class="d">${escapeHtml(day)}</span><span dir="auto">${escapeHtml(first.length > 90 ? `${first.slice(0, 88)}…` : first)}</span></summary><div class="old-body">${prose(update.payload?.moved, writing)}</div></details>`;
  }).join("");
  return `<section class="sec" aria-labelledby="earlier-h"><p class="kicker" id="earlier-h">${escapeHtml(w.earlier)}</p><div>${rows}</div></section>`;
}

/** A calendar file of every dated thing on the page, for the client's own calendar. */
export function renderClientCalendar({ lang = "en", company, projects = [], updates = [], showUpdates = true, questionnaires = [], timeZone = "UTC", now = new Date(), host = "clients.example.com" }) {
  const language = lang === "fa" ? "fa" : "en";
  const w = WORDS[language];
  const [latest, ...earlier] = showUpdates ? updates : [];
  const ctx = { timeZone, now, latest };
  const steps = stepsOf(latest, earlier[0], w, showUpdates ? updates : []);
  const events = eventsOf({ steps, latest, questionnaires, base: "", w, lang: language, ctx, contact: {}, companyName: String(company?.name || "") }).filter((event) => event.day !== null);
  const launch = dayNum(launchDay(steps, projects));
  const escape = (value) => String(value).replace(/[\\;,]/g, (match) => `\\${match}`).replace(/\r?\n/g, "\\n");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Your company//Client page//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escape(`${company?.name || ""} · Your company`)}`];
  const add = (day, title, id) => {
    const date = dayStr(day).replace(/-/g, "");
    const next = dayStr(day + 1).replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${id}-${date}@${host}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${next}`, `SUMMARY:${escape(title)}`, "END:VEVENT");
  };
  events.forEach((event, index) => add(event.day, `${w.who[event.who]}: ${event.title}`, `ev${index}`));
  if (launch !== null && !events.some((event) => event.day === launch && event.step)) add(launch, w.evLaunch, "launch");
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function welcomeSection(w) {
  return `<section class="sec" aria-labelledby="welcome"><p class="kicker">${escapeHtml(w.welcome)}</p><h2 id="welcome">${escapeHtml(w.welcomeTitle)}</h2><p class="body-text">${escapeHtml(w.welcomeBody)}</p><p class="body-text">${escapeHtml(w.empty)} ${escapeHtml(w.emptyDetail)}</p></section>`;
}

/** Only when there are no steps to show: the projects and their next milestone. */
function projectsSection(projects, w, lang, ctx) {
  const rows = projects.map((project) => {
    const key = project.status === "done" ? "done" : project.status === "paused" ? "paused" : project.health;
    const cls = ["done", "paused", "on_track", "at_risk", "blocked"].includes(key) ? key : "on_track";
    const milestone = String(project.milestone || "").trim();
    const day = calendarDay(project.milestoneDueOn, lang);
    const when = day && project.status !== "done" ? relative(project.milestoneDueOn, w, ctx) : "";
    const row = milestone
      ? `<div class="rows"><div>${day ? `<time class="d" datetime="${escapeHtml(project.milestoneDueOn)}">${escapeHtml(day)}</time>` : `<span class="d">${escapeHtml(w.milestone)}</span>`}<span dir="auto">${escapeHtml(milestone)}${when ? `<small>${escapeHtml(when)}</small>` : ""}</span></div></div>`
      : "";
    return `<div class="project"><h3 dir="auto">${escapeHtml(project.name)}</h3><span class="health ${cls}">${escapeHtml(w.status[cls] || w.health[cls])}</span>${row}</div>`;
  }).join("");
  return `<section class="sec" aria-labelledby="projects"><p class="kicker">${escapeHtml(w.whereKicker)}</p><h2 id="projects" class="sr">${escapeHtml(w.projectsLabel)}</h2><div class="panel">${rows}</div></section>`;
}

function whatsappLink(number) {
  const digits = String(number || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

/** About a minute and a half a question, which is what twelve questions in twenty minutes comes to. */
const minutesFor = (questions) => Math.max(1, Math.ceil((questions * 5) / 3));

const answeredIn = (questions, answers) => questions.filter((question) => String(answers[question.id] ?? "").trim()).length;

/**
 * The questions in groups of bars, one group a part: filled where answered,
 * the part they are on outlined.
 */
function partBars(sections, answers, current = 0) {
  const groups = sections.map((section, index) => {
    const questions = section.questions || [];
    const bars = questions.map((question) => `<i${String(answers[question.id] ?? "").trim() ? ' class="on"' : ""}></i>`).join("");
    return `<span class="grp${index + 1 === current ? " now" : ""}" style="flex:${Math.max(1, questions.length)};--n:${Math.max(1, questions.length)}">${bars}</span>`;
  }).join("");
  return `<div class="grps" aria-hidden="true">${groups}</div>`;
}

function questionField(question, number, value, w, lang, closed) {
  const pad = lang === "fa" ? n(number) : String(number).padStart(2, "0");
  const need = question.must && !closed ? `<em class="need">${escapeHtml(w.need)}</em>` : "";
  const hint = question.hint ? `<small>${escapeHtml(question.hint)}</small>` : "";
  if (closed) {
    return `<div class="q"><div class="qlabel"><b class="qn">${escapeHtml(pad)}</b><span>${escapeHtml(question.text)}</span>${hint}</div><div class="answer">${value ? prose(value, { lang, pageLang: lang }) : `<p class="none">${escapeHtml(w.noAnswer)}</p>`}</div></div>`;
  }
  return `<div class="q"><label for="a_${escapeHtml(question.id)}"><b class="qn">${escapeHtml(pad)}</b><span>${escapeHtml(question.text)}</span>${need}${hint}</label><textarea id="a_${escapeHtml(question.id)}" name="a_${escapeHtml(question.id)}" rows="3" maxlength="4000" dir="auto" placeholder="${escapeHtml(w.placeholder)}">${escapeHtml(value)}</textarea></div>`;
}

/**
 * The questions a client answers, one part at a time. Plain HTML: every screen
 * works without a script, every button posts the same form to the same
 * address, and the server answers each post with a redirect to the next screen.
 * Answers go back into the page escaped, as text, so what a client types can
 * never become part of the page.
 *
 * `step` is 0 for the start, 1..n for a part, "check" for the last look.
 */
export function renderQuestionnairePage({ questionnaire, company, base, notice = "", contact = {}, baseUrl = "", step = 0, savedPart = 0 }) {
  const lang = questionnaire.language === "fa" ? "fa" : "en";
  const w = WORDS[lang];
  const closed = questionnaire.status === "closed";
  const submitted = questionnaire.status === "submitted";
  const p = questionnaire.progress;
  const answers = questionnaire.answers || {};
  const sections = questionnaire.content.sections || [];
  const action = `${base}/q/${questionnaire.id}`;
  const here = (query) => `${action}${query ? `?${query}` : ""}`;
  const arrow = lang === "fa" ? "←" : "→";
  const backArrow = lang === "fa" ? "→" : "←";
  const pad = (value) => (lang === "fa" ? n(value) : String(value).padStart(2, "0"));
  const total = (count) => (lang === "fa" ? n(count) : String(count));
  const firstOpen = sections.findIndex((section) => answeredIn(section.questions || [], answers) < (section.questions || []).length) + 1;

  const banner = closed ? w.closedNote
    : notice === "failed" ? w.failedNote
      : notice === "slow" ? w.slowNote
        : notice === "saved" ? w.savedNote
          : notice === "part" && savedPart ? w.partSaved(savedPart, answeredIn(sections[savedPart - 1]?.questions || [], answers), (sections[savedPart - 1]?.questions || []).length)
            : "";
  const bannerHtml = banner ? `<p class="notice" role="status">${escapeHtml(banner)}</p>` : "";
  const help = `<div class="qhelp"><p>${escapeHtml(w.noSecrets)}</p><p>${escapeHtml(w.privacyForm)}</p></div>`;
  const page = (body) => shell({ lang, title: w.formTitle, description: w.formDescription, baseUrl, otherHref: "", note: true, crumb: company?.name || "", body });
  const back = (href, label) => `<a class="back" href="${escapeHtml(href)}"><span aria-hidden="true">${backArrow}</span> ${escapeHtml(label)}</a>`;
  const counter = `<p class="count" aria-hidden="true">${escapeHtml(pad(p.answered))}<span>/${escapeHtml(pad(p.total))}</span></p>`;

  // Closed: everything they wrote, to read, and nothing to change.
  if (closed) {
    let number = 0;
    const parts = sections.map((section, index) => `<section class="panel qsec"><h2>${escapeHtml(`${pad(index + 1)} / ${section.title}`)}</h2>${(section.questions || []).map((question) => questionField(question, ++number, answers[question.id] || "", w, lang, true)).join("")}</section>`).join("");
    return page(`<section class="qhero"><div class="wrap">${back(base, w.back)}<h1 dir="auto">${escapeHtml(questionnaire.title)}</h1>${counter}${partBars(sections, answers)}<p class="label">${escapeHtml(w.qAnswered(p.answered, p.total))}</p></div></section>
<main><div class="wrap">${bannerHtml}<div class="qform">${parts}${help}</div></div></main>`);
  }

  // One part: its questions, and buttons that save it and move on.
  if (typeof step === "number" && step > 0) {
    const section = sections[step - 1];
    const before = sections.slice(0, step - 1).reduce((sum, item) => sum + (item.questions || []).length, 0);
    const questions = section.questions || [];
    const fields = questions.map((question, index) => questionField(question, before + index + 1, answers[question.id] || "", w, lang, false)).join("");
    const last = step === sections.length;
    const buttons = [
      `<button class="primary" type="submit" name="action" value="next">${escapeHtml(last ? w.toCheck : w.nextPart(step + 1))} <span aria-hidden="true">${arrow}</span></button>`,
      step > 1 ? `<button class="secondary" type="submit" name="action" value="back"><span aria-hidden="true">${backArrow}</span> ${escapeHtml(w.backPart(step - 1))}</button>` : "",
      `<button class="plain" type="submit" name="action" value="save">${escapeHtml(w.later)}</button>`
    ].join("");
    return page(`<section class="qhero"><div class="wrap">${back(here(""), w.allParts)}<p class="label step">${escapeHtml(w.partOf(step, sections.length))}</p><h1 dir="auto">${escapeHtml(section.title)}</h1><div class="progress">${partBars(sections, answers, step)}<p class="split"><span class="label">${escapeHtml(w.qAnswered(p.answered, p.total))}</span><span class="label">${escapeHtml(w.qMinutes(minutesFor(questions.length)))}</span></p></div></div></section>
<main><div class="wrap">${bannerHtml}<form class="qform" method="post" action="${escapeHtml(action)}"><input type="hidden" name="step" value="${step}"><section class="panel qsec">${fields}</section><div class="qactions">${buttons}</div><p class="qnote">${escapeHtml(w.leaveIt)}</p><div class="qhelp"><p>${escapeHtml(w.noSecrets)}</p></div></form></div></main>`);
  }

  // The last look: what is still needed to start, every part's count, and Send.
  if (step === "check") {
    let number = 0;
    const gaps = [];
    const rows = sections.map((section, index) => {
      const questions = section.questions || [];
      for (const question of questions) {
        number += 1;
        if (question.must && !String(answers[question.id] ?? "").trim()) gaps.push({ question, part: index + 1, number });
      }
      const done = answeredIn(questions, answers);
      return `<div class="prow"><span class="pn">${escapeHtml(pad(index + 1))}</span><strong dir="auto">${escapeHtml(section.title)}</strong><span class="pc${done === questions.length ? " full" : ""}">${escapeHtml(`${total(done)}/${total(questions.length)}`)}</span><a href="${escapeHtml(here(`step=${index + 1}`))}">${escapeHtml(w.lookAgain)}</a></div>`;
    }).join("");
    const missing = gaps.length
      ? `<section class="panel waiting"><h2>${escapeHtml(w.missing(gaps.length))}</h2>${gaps.map((gap) => `<div class="gap"><strong dir="auto">${escapeHtml(gap.question.text)}</strong><span class="label">${escapeHtml(w.where(gap.part, gap.number))}</span><a class="btn ghost" href="${escapeHtml(here(`step=${gap.part}`))}"><span>${escapeHtml(w.answerIt)}</span><span aria-hidden="true">${arrow}</span></a></div>`).join("")}</section>`
      : "";
    return page(`<section class="qhero"><div class="wrap">${back(here(`step=${sections.length}`), w.backPart(sections.length))}<p class="label step">${escapeHtml(w.lastStep)}</p><h1>${escapeHtml(w.checkTitle)}</h1><div class="progress">${counter}${partBars(sections, answers)}</div></div></section>
<main><div class="wrap">${bannerHtml}<form class="qform" method="post" action="${escapeHtml(action)}"><input type="hidden" name="step" value="check">${missing}<section class="panel"><h2>${escapeHtml(w.byPart)}</h2><div class="prows">${rows}</div></section><div class="qactions"><button class="primary" type="submit" name="action" value="submit">${escapeHtml(submitted ? w.sendAgain : w.send)} <span aria-hidden="true">${arrow}</span></button></div><p class="qnote">${escapeHtml(w.withGaps)}</p>${help}</form></div></main>`);
  }

  // Just sent: a plain thank-you and what happens now.
  if (notice === "sent") {
    return page(`<section class="qhero"><div class="wrap"><div class="donehead"><span class="check big" aria-hidden="true"></span><h1>${escapeHtml(w.sentTitle)}</h1></div><p class="lede" role="status">${escapeHtml(w.sentNote)}</p></div></section>
<main><div class="wrap"><section class="panel"><h2>${escapeHtml(w.whatNext)}</h2><div class="rows"><div><span class="d">${escapeHtml(w.anyTime)}</span><span>${escapeHtml(w.changeLater)}</span></div></div></section><div class="qactions"><a class="btn lead" href="${escapeHtml(base)}"><span aria-hidden="true">${backArrow}</span><span>${escapeHtml(w.back)}</span></a><a class="btn ghost" href="${escapeHtml(here("step=1"))}"><span>${escapeHtml(w.lookAnswers)}</span></a></div></div></main>`);
  }

  // They asked to talk instead: say what happens, and keep typing open.
  if (questionnaire.callRequestedAt && !submitted && p.answered === 0) {
    const said = questionnaire.callTimes ? `<section class="panel"><h2>${escapeHtml(w.youSaid)}</h2><p class="quote" dir="auto">${escapeHtml(questionnaire.callTimes)}</p></section>` : "";
    const steps = w.callSteps(p.total).map((line, index) => `<div><span class="d">${escapeHtml(pad(index + 1))}</span><span>${escapeHtml(line)}</span></div>`).join("");
    return page(`<section class="qhero"><div class="wrap">${back(base, w.back)}<div class="donehead"><span class="check big" aria-hidden="true"></span><h1>${escapeHtml(w.callTitle)}</h1></div><p class="lede" role="status">${escapeHtml(w.callBody)}</p></div></section>
<main><div class="wrap">${said}<section class="panel"><h2>${escapeHtml(w.howCall)}</h2><div class="rows">${steps}</div></section><div class="qactions"><a class="btn lead" href="${escapeHtml(base)}"><span aria-hidden="true">${backArrow}</span><span>${escapeHtml(w.back)}</span></a><a class="btn ghost" href="${escapeHtml(here("step=1"))}"><span>${escapeHtml(w.typeInstead)}</span></a></div></div></main>`);
  }

  // The start: what it is, how long, and the one choice: type it, or talk.
  const partRows = sections.map((section, index) => {
    const questions = section.questions || [];
    const needed = questions.filter((question) => question.must).length;
    const done = answeredIn(questions, answers);
    const state = done ? `${total(done)}/${total(questions.length)}` : w.partMinutes(minutesFor(questions.length));
    return `<a class="prow" href="${escapeHtml(here(`step=${index + 1}`))}"><span class="pn">${escapeHtml(pad(index + 1))}</span><span><strong dir="auto">${escapeHtml(section.title)}</strong><small>${escapeHtml(w.partLine(questions.length, needed))}</small></span><span class="pc${done && done === questions.length ? " full" : ""}">${escapeHtml(state)}</span></a>`;
  }).join("");
  const go = submitted || !firstOpen
    ? `<a class="btn" href="${escapeHtml(here("step=check"))}"><span>${escapeHtml(w.toCheckLink)}</span><span aria-hidden="true">${arrow}</span></a>`
    : `<a class="btn" href="${escapeHtml(here(`step=${firstOpen}`))}"><span>${escapeHtml(p.answered ? w.continuePart(firstOpen) : w.startPart(firstOpen))}</span><span aria-hidden="true">${arrow}</span></a>`;
  const typeIt = `<section class="panel welcome"><h2>${escapeHtml(w.typeIt)}</h2><h3>${escapeHtml(w.typeTitle(sections.length))}</h3><div class="prows">${partRows}</div>${go}<p>${escapeHtml(w.savesNote)}</p></section>`;
  const talk = submitted || p.answered
    ? ""
    : `<section class="panel"><h2>${escapeHtml(w.talk)}</h2><h3>${escapeHtml(w.talkTitle)}</h3><p>${escapeHtml(w.talkBody)}</p><form class="times" method="post" action="${escapeHtml(action)}"><input type="hidden" name="action" value="call"><label for="times">${escapeHtml(w.timesLabel)} <span>${escapeHtml(w.optional)}</span></label><textarea id="times" name="times" rows="2" maxlength="300" dir="auto" placeholder="${escapeHtml(w.timesPlaceholder)}"></textarea><button class="secondary" type="submit"><span>${escapeHtml(w.askCall)}</span> <span aria-hidden="true">${arrow}</span></button></form><p>${escapeHtml(w.askNote)}</p></section>`;
  const meta = `<p class="qmeta-line"><span>${escapeHtml(w.qCount(p.total))}</span><span>${escapeHtml(w.qParts(sections.length))}</span><span>${escapeHtml(w.qMinutes(minutesFor(p.total)))}</span></p>`;
  const sentLine = submitted ? `<p class="notice">${escapeHtml(w.sentAlready)}</p>` : "";
  return page(`<section class="qhero"><div class="wrap">${back(base, w.back)}<p class="label step">${escapeHtml(w.questions)}</p><h1 dir="auto">${escapeHtml(questionnaire.title)}</h1><p class="lede" dir="auto">${escapeHtml(questionnaire.content.intro || "")}</p>${meta}</div></section>
<main><div class="wrap">${bannerHtml}${sentLine}${talk ? `<p class="label choose">${escapeHtml(w.twoWays)}</p>` : ""}<div class="qform">${typeIt}${talk}${help}</div></div></main>`);
}

/**
 * `projects` are only the projects the owner chose to show on this link, and
 * only their client-facing fields. `updates` are published snapshots, newest
 * first. `person` is who the link is for, as the owner wrote it. Nothing else
 * about the company is ever passed in.
 *
 * The page is a calendar of the project: when it goes live, the plan on the
 * weeks with today marked, Alex's note, what is late, the next seven days
 * (whose turn each thing is), and the big dates after that.
 */
export function renderClientPage({ lang = "en", company, person = "", projects = [], updates = [], showUpdates = true, questionnaires = [], base = "", contact = {}, baseUrl = "", timeZone = "UTC", otherHref = "", now = new Date() }) {
  const language = lang === "fa" ? "fa" : "en";
  const w = WORDS[language];
  const shown = showUpdates ? updates : [];
  const [latest, ...earlier] = shown;
  const ctx = { timeZone, now, latest };
  const whatsapp = whatsappLink(contact.whatsapp);
  const companyName = String(company?.name || "").trim();
  const steps = stepsOf(latest, earlier[0], w, shown);
  const focus = focusOf({ projects, latest, showUpdates, ctx });
  const plan = planOf(steps, shown, projects, ctx);
  const events = eventsOf({ steps, latest, questionnaires, base, w, lang: language, ctx, contact, companyName });

  const planView = planSection({ steps, plan, w, lang: language, ctx });
  const context = [noteSection(latest, w, language, ctx, contact, companyName)];
  if (!steps.length && projects.length) context.push(projectsSection(projects, w, language, ctx));
  if (showUpdates && !latest) context.push(welcomeSection(w));
  const schedule = [lateSection(events, w, language), weekSection({ events, steps, plan, w, lang: language, base }), laterSection(events, plan, w, language)];

  const phone = String(contact.whatsapp || "").replace(/[^\d+]/g, "");
  const band = whatsapp || contact.email
    ? `<section class="band" aria-labelledby="talk"><div class="wrap"><p class="kicker">${escapeHtml(w.bandKicker)}</p><h2 id="talk">${escapeHtml(w.ask)}</h2><p>${escapeHtml(w.questionsBody)}</p><div class="acts">${whatsapp ? pill(whatsapp, w.whatsapp, language, "white") : ""}${phone ? `<a class="pill ghost light" href="tel:${escapeHtml(phone)}">${escapeHtml(w.call)}</a>` : ""}${contact.email ? `<a class="mail" dir="ltr" href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a>` : ""}</div><span class="mascot wave" aria-hidden="true"></span></div></section>`
    : "";

  return shell({
    lang: language,
    title: w.title,
    description: w.description,
    baseUrl,
    otherHref: otherHref ? `${otherHref}${w.otherCode}` : "",
    crumb: "",
    light: true,
    body: `${statusSection({ company, person, steps, plan, focus, latest, showUpdates, events, w, lang: language })}
<main class="calendar"><div class="wrap calendar-layout">${planView}<div class="calendar-support"><div class="col">${context.filter(Boolean).join("\n")}</div><div class="col">${schedule.filter(Boolean).join("\n")}</div></div>${earlierSection(earlier, w, language, ctx)}</div></main>
${band}`
  });
}

/** What every unknown, ended, or mistyped link sees. It says nothing about which of those it was. */
export function renderUnavailablePage({ lang = "en", contact = {}, baseUrl = "" } = {}) {
  const language = lang === "fa" ? "fa" : "en";
  const w = WORDS[language];
  const whatsapp = whatsappLink(contact.whatsapp);
  return shell({
    lang: language,
    title: w.title,
    description: w.description,
    baseUrl,
    otherHref: `?lang=${w.otherCode}`,
    note: false,
    body: `<section class="hero gone"><div class="wrap"><div class="copy"><p class="kicker">${escapeHtml(w.brand)}</p><h1>${escapeHtml(w.gone)}</h1><p class="lede">${escapeHtml(w.goneBody)}</p>${whatsapp ? `<a class="pill" href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener noreferrer">${escapeHtml(w.whatsapp)}${arrow(language)}</a>` : ""}</div><span class="mascot large plan" aria-hidden="true"></span></div></section>`
  });
}
