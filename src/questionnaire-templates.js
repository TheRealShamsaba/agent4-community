/*
 * The questions a client answers in their own page. Four sets, each short
 * enough to finish in one sitting: a first one every client gets, and one for
 * each kind of work.
 *
 * Every question exists in English and in Persian, and the Persian is written,
 * not translated. A questionnaire is made in one language and keeps it: what a
 * client sees is a copy of the questions as they were when it was sent, so a
 * better wording tomorrow never changes a form somebody is halfway through.
 *
 * `must` marks what is needed to start. It is shown to the client as a plain
 * "needed to start" label and never blocks sending: a client who cannot answer
 * yet should be able to say so and move on.
 */

const t = (en, fa) => ({ en, fa });

export const QUESTIONNAIRE_TEMPLATES = [
  {
    id: "getting-started",
    name: t("Getting started", "شروع کار"),
    blurb: t("The twelve questions that tell us where to begin. About twenty minutes.", "دوازده سؤال که نشان می‌دهد از کجا شروع کنیم. حدود بیست دقیقه."),
    intro: t(
      "You do not need to answer everything today. Write \"not sure\" where you are not sure and we will help.",
      "لازم نیست همهٔ سؤال‌ها را همین امروز جواب بدهید. هر جا مطمئن نیستید بنویسید «نمی‌دانم» تا کمک‌تان کنیم."
    ),
    sections: [
      {
        id: "people",
        title: t("People and decisions", "آدم‌ها و تصمیم‌ها"),
        questions: [
          { id: "company", must: true, text: t("What is your company called, and what does it do, in one sentence?", "نام شرکت شما چیست و دقیقاً چه می‌کند؟ در یک جمله بنویسید.") },
          { id: "contact", must: true, text: t("Who is our main contact, and how is best to reach them?", "با چه کسی در تماس هستیم و بهترین راه تماس با او چیست؟"), hint: t("WhatsApp, email or phone, the hours they are free, and their time zone.", "واتساپ، ایمیل یا تلفن؛ ساعت‌هایی که در دسترس‌اند؛ و منطقهٔ زمانی.") },
          { id: "approver", must: true, text: t("Who has the final say on approvals? Who else needs to see the work first?", "تصمیم نهایی و تأیید کارها با کیست؟ چه کسان دیگری باید پیش از تأیید کار را ببینند؟"), hint: t("One name is best. Work moves faster with one person who can say yes.", "یک نام بهتر از چند نام است. وقتی یک نفر می‌تواند بگوید «بله»، کار سریع‌تر جلو می‌رود.") },
          { id: "owner-after", text: t("Who will use or look after this once it is live?", "بعد از راه‌اندازی، چه کسی از آن استفاده می‌کند یا آن را نگه می‌دارد؟") }
        ]
      },
      {
        id: "why-now",
        title: t("Why now", "چرا همین حالا"),
        questions: [
          { id: "trigger", must: true, text: t("What made this a priority now? What is not working today?", "چه شد که این پروژه الان اولویت شد؟ الان چه چیزی درست کار نمی‌کند؟") },
          { id: "success", must: true, text: t("Three months after launch, what would make you say it worked?", "سه ماه بعد از راه‌اندازی، چه چیزی باعث می‌شود بگویید جواب داده؟"), hint: t("One number is ideal: enquiries a month, sales, hours saved.", "یک عدد از همه بهتر است: تعداد درخواست در ماه، فروش، یا ساعت صرفه‌جویی‌شده.") },
          { id: "today", text: t("Where are you today?", "الان وضعیت از چه قرار است؟"), hint: t("Rough numbers are fine, and \"I do not know\" is a good answer: visitors a month, enquiries or sales a month, where they come from, hours spent on what we are fixing.", "اعداد تقریبی هم کافی است و «نمی‌دانم» هم جواب درستی است: بازدید ماهانه، درخواست یا فروش در ماه، مشتری‌ها از کجا می‌آیند، و ساعتی که صرف کاری می‌شود که می‌خواهیم درستش کنیم.") },
          { id: "deadline", text: t("Is there a fixed date? What is it tied to?", "تاریخ قطعی دارید؟ به چه چیزی گره خورده است؟"), hint: t("An event, a season, a launch, a contract.", "رویداد، فصل، عرضهٔ محصول یا قرارداد.") }
        ]
      },
      {
        id: "market",
        title: t("Customers and market", "مشتری‌ها و بازار"),
        questions: [
          { id: "customers", text: t("Who are your customers? Who do you want more of, and who do you not?", "مشتری‌های شما چه کسانی‌اند؟ از چه نوعشان بیشتر می‌خواهید و از چه نوعی نه؟") },
          { id: "why-you", text: t("Why do people choose you? Name two or three competitors, and two or three sites or products you admire.", "مردم چرا شما را انتخاب می‌کنند؟ دو سه رقیب و دو سه سایت یا محصول که دوست دارید را بنویسید."), hint: t("And what you like about them.", "و اینکه از آن‌ها چه چیزی را دوست دارید.") }
        ]
      },
      {
        id: "know",
        title: t("What we should know", "آنچه باید بدانیم"),
        questions: [
          { id: "tried", text: t("What have you already tried, and what happened?", "تا حالا چه کارهایی کرده‌اید و چه شد؟") },
          { id: "constraints", text: t("Is there anything we must not do, or must work around?", "چیزی هست که نباید انجامش بدهیم یا باید دورش بزنیم؟"), hint: t("Legal rules, brand rules, languages, tools you already pay for, people who must not be surprised.", "قوانین، قواعد برند، زبان‌ها، ابزارهایی که از قبل پولش را می‌دهید، و کسانی که نباید غافلگیر شوند.") }
        ]
      }
    ]
  },
  {
    id: "website",
    name: t("Your website", "وب‌سایت شما"),
    blurb: t("Nine questions for a website project.", "نه سؤال برای پروژهٔ وب‌سایت."),
    intro: t("These help us plan the pages and the content. Rough answers are fine.", "این سؤال‌ها به ما کمک می‌کند صفحه‌ها و محتوا را برنامه‌ریزی کنیم. جواب‌های تقریبی هم کافی است."),
    sections: [
      {
        id: "site",
        title: t("The site", "سایت"),
        questions: [
          { id: "current", must: true, text: t("Do you have a site now? Link it, and tell us what must be kept and what can go.", "سایت فعلی دارید؟ لینکش را بنویسید و بگویید چه چیزی را باید نگه داریم و چه چیزی را کنار بگذاریم."), hint: t("Pages, and anything that ranks on Google.", "صفحه‌ها، و هر چیزی که در گوگل جایی دارد.") },
          { id: "languages", text: t("Which languages does it need? Should it read right to left in any of them?", "سایت به چه زبان‌هایی لازم است؟ بخشی از آن باید راست‌به‌چپ باشد؟") },
          { id: "action", must: true, text: t("What should a visitor do on it? Pick one main action.", "بازدیدکننده در سایت چه کاری باید بکند؟ یک کار اصلی انتخاب کنید."), hint: t("Call, WhatsApp, book, buy, ask for a quote.", "تماس، واتساپ، رزرو، خرید یا درخواست قیمت.") },
          { id: "pages", text: t("Which pages do you think you need?", "فکر می‌کنید چه صفحه‌هایی لازم است؟"), hint: t("Do not worry about being exact.", "دقیق نبودن اشکالی ندارد.") }
        ]
      },
      {
        id: "content",
        title: t("Content", "محتوا"),
        questions: [
          { id: "words", text: t("Who writes the words: you, us, or together? Who supplies the services, products and prices?", "متن‌ها را چه کسی می‌نویسد: شما، ما، یا با هم؟ فهرست خدمات یا محصولات و قیمت‌ها را چه کسی می‌دهد؟") },
          { id: "media", text: t("Do you have photos or video, or do we need to plan for them?", "عکس یا ویدیو دارید، یا باید برایش برنامه‌ریزی کنیم؟") },
          { id: "proof", text: t("Do you have testimonials, past projects, certificates or press we may use?", "نظر مشتری‌ها، نمونه‌کار، گواهی یا خبری دارید که بتوانیم از آن استفاده کنیم؟") },
          { id: "tools", text: t("What must it connect to?", "سایت باید به چه ابزارهایی وصل شود؟"), hint: t("Booking, payments, CRM, WhatsApp, newsletter, analytics.", "رزرو، پرداخت، CRM، واتساپ، خبرنامه، آمار.") },
          { id: "publish", text: t("What contact details should be published, and do privacy and terms pages exist?", "چه اطلاعات تماسی منتشر شود و آیا صفحهٔ قوانین و حریم خصوصی دارید؟"), hint: t("Phone, email, address, opening hours.", "تلفن، ایمیل، نشانی، ساعت کاری.") }
        ]
      }
    ]
  },
  {
    id: "product",
    name: t("Your product or app", "محصول یا اپ شما"),
    blurb: t("Seven questions for a product or an app.", "هفت سؤال برای محصول یا اپ."),
    intro: t("These tell us what to build first and what to leave for later.", "این سؤال‌ها نشان می‌دهد اول چه بسازیم و چه چیزی را بگذاریم برای بعد."),
    sections: [
      {
        id: "product",
        title: t("The product", "محصول"),
        questions: [
          { id: "users", must: true, text: t("Who are the users? For each kind, name the three things they must be able to do.", "کاربران چه کسانی‌اند؟ برای هر نوع کاربر سه کاری که باید بتواند انجام دهد را بنویسید.") },
          { id: "platforms", text: t("Which platforms: web, iPhone, Android?", "روی چه پلتفرم‌هایی: وب، آیفون، اندروید؟") },
          { id: "systems", text: t("What data or systems already exist that we must connect to or move over? Where does the data live today?", "چه داده یا سیستمی از قبل هست که باید به آن وصل شویم یا داده‌اش را منتقل کنیم؟ داده‌ها الان کجا نگهداری می‌شوند؟") },
          { id: "accounts", text: t("Which accounts must exist in your company's name, not ours?", "چه حساب‌هایی باید به نام شرکت شما باشد، نه ما؟"), hint: t("App Store and Google Play developer accounts, payments, notifications, maps, sending email.", "حساب توسعه‌دهندهٔ اپ‌استور و گوگل‌پلی، پرداخت، اعلان‌ها، نقشه، ارسال ایمیل.") },
          { id: "data", text: t("Does it handle personal data or payments? In which countries do the users live?", "با اطلاعات شخصی یا پرداخت سروکار دارد؟ کاربران در چه کشورهایی هستند؟") },
          { id: "first", must: true, text: t("What is the smallest version you would be happy to launch first? What can wait?", "کوچک‌ترین نسخه‌ای که با آن راضی‌اید و می‌توانید اول منتشر کنید چیست؟ چه چیزی می‌تواند بماند برای بعد؟") },
          { id: "support", text: t("Who supports the users after launch?", "بعد از راه‌اندازی، پشتیبانی کاربران با کیست؟") }
        ]
      }
    ]
  },
  {
    id: "tool",
    name: t("Your internal tool or automation", "ابزار داخلی یا اتوماسیون شما"),
    blurb: t("Six questions for something that runs inside your business.", "شش سؤال برای چیزی که داخل کسب‌وکار شما کار می‌کند."),
    intro: t("The best answer is the process as it really happens today, even if it is messy.", "بهترین جواب همان روندی است که الان واقعاً انجام می‌شود، حتی اگر به‌هم‌ریخته باشد."),
    sections: [
      {
        id: "process",
        title: t("How it works today", "الان چطور کار می‌کند"),
        questions: [
          { id: "walkthrough", must: true, text: t("Walk us through the process as it happens today, step by step.", "روند کار را همان‌طور که الان انجام می‌شود، قدم‌به‌قدم بنویسید."), hint: t("Who does what, with which tool, how often, and how long it takes.", "چه کسی چه کاری می‌کند، با چه ابزاری، هر چند وقت یک بار و چقدر طول می‌کشد.") },
          { id: "pain", must: true, text: t("Where does it hurt: delays, mistakes, cost? Roughly how many hours a week?", "کجایش اذیت می‌کند: تأخیر، اشتباه یا هزینه؟ تقریباً هفته‌ای چند ساعت وقت می‌گیرد؟") },
          { id: "tools", text: t("Which tools and files are involved? Who has admin access to each?", "چه ابزارها و فایل‌هایی درگیرند؟ دسترسی مدیر هر کدام با کیست؟"), hint: t("Spreadsheets, WhatsApp, accounting or ERP software, email.", "اکسل، واتساپ، نرم‌افزار حسابداری یا ERP، ایمیل.") },
          { id: "examples", text: t("Can you send examples?", "می‌توانید نمونه بفرستید؟"), hint: t("A few screenshots or sample files with private details removed are enough. Send them on WhatsApp and tell us here that you did.", "چند اسکرین‌شات یا فایل نمونه که اطلاعات خصوصی‌اش پاک شده باشد کافی است. می‌توانید در واتساپ بفرستید و اینجا بنویسید که فرستاده‌اید.") },
          { id: "breaks", text: t("What happens when it goes wrong, and who is affected?", "وقتی کار خراب می‌شود چه می‌شود و چه کسانی آسیب می‌بینند؟") },
          { id: "worked", text: t("How will we know it worked?", "از کجا بفهمیم کار جواب داده؟"), hint: t("Hours saved, mistakes avoided, speed.", "ساعت صرفه‌جویی‌شده، اشتباه‌های کمتر، سرعت.") }
        ]
      }
    ]
  }
];

const BY_ID = new Map(QUESTIONNAIRE_TEMPLATES.map((template) => [template.id, template]));

export function questionCount(template) {
  return template.sections.reduce((total, section) => total + section.questions.length, 0);
}

export function mustCount(template) {
  return template.sections.reduce((total, section) => total + section.questions.filter((question) => question.must).length, 0);
}

/** What the owner chooses from: names and sizes, in both languages. */
export function templateSummaries() {
  return QUESTIONNAIRE_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    blurb: template.blurb,
    questions: questionCount(template),
    needed: mustCount(template)
  }));
}

/**
 * The questions as they will be shown, in one language, frozen. This copy is
 * what the client's page keeps, so a template improved later changes nothing
 * for a form already sent.
 */
export function snapshotTemplate(templateId, language) {
  const template = BY_ID.get(templateId);
  if (!template) return null;
  const lang = language === "fa" ? "fa" : "en";
  return {
    title: template.name[lang],
    intro: template.intro[lang],
    sections: template.sections.map((section) => ({
      id: section.id,
      title: section.title[lang],
      questions: section.questions.map((question) => ({
        id: question.id,
        text: question.text[lang],
        hint: question.hint ? question.hint[lang] : "",
        must: Boolean(question.must)
      }))
    }))
  };
}
