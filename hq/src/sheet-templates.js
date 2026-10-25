/**
 * Sheet templates: structured question sets and checklists the team fills in
 * for a company or a project. Every string carries both languages so the same
 * sheet can be read in the meeting (Persian) and at the desk (English).
 *
 * Item ids must be unique within a template — they are the keys the store
 * saves answers and checks under, so never rename one once a sheet exists.
 */

const t = (fa, en) => ({ fa, en });

export const SHEET_LANGUAGES = [
  { id: "fa", label: "فارسی", dir: "rtl" },
  { id: "en", label: "English", dir: "ltr" }
];

export const WEBSITE_DISCOVERY_TEMPLATE = {
  id: "website-discovery",
  version: 1,
  defaultLang: "fa",
  name: t("جلسهٔ کشف — سایت شرکتی", "Website discovery"),
  description: t(
    "همهٔ سؤال‌هایی که باید قبل از نوشتن پیشنهاد سایت جواب داشته باشند. برای جلسهٔ اول با مشتری.",
    "Every question that must be answered before a website proposal can be written. For the first client meeting."
  ),
  intro: [
    t("هدف جلسه: بیرون آمدن با جواب، نه با قیمت.", "The goal of the meeting: leave with answers, not with a price."),
    t("تنها قولی که می‌دهید: «پیشنهاد کامل تا دو روز دیگر دستتان است.»", "The only promise you make: “You will have the full proposal within two days.”"),
    t("سؤال‌های ★ برای قیمت‌گذاری ضروری‌اند؛ بدون آن‌ها پیشنهاد حدسی می‌شود.", "★ questions are required for pricing; without them the proposal is a guess.")
  ],
  sections: [
    {
      id: "prep",
      kind: "checklist",
      title: t("پیش از جلسه", "Before the meeting"),
      lead: t("یک ساعت آماده‌سازی. وارد اتاق شوید در حالی که از قبل چیزی دیده‌اید که آن‌ها ندیده‌اند.", "One hour of preparation. Walk in having already seen something they have not."),
      items: [
        { id: "p1", text: t("سایت‌های فعلی شرکت و گروهش را باز کردم و اسکرین‌شات گرفتم.", "Opened the company's and its group's current websites and took screenshots."), note: t("هم برای حرف زدن در جلسه، هم به‌عنوان «قبل» در کیس‌استادی.", "For the conversation, and as the “before” in the case study.") },
        { id: "p2", text: t("اینستاگرام و کانال‌های فعلی و محصولاتشان را دیدم.", "Looked at their Instagram, channels, and current products."), note: t("لحن و سلیقهٔ فعلی‌شان را می‌فهمید.", "You learn their current tone and taste.") },
        { id: "p3", text: t("یک ایده برای این سایت آماده کردم که خودشان به آن فکر نکرده‌اند.", "Prepared one idea for this site that they have not thought of."), note: t("الگویی که جواب می‌دهد: با یک ایده وارد اتاق شوید.", "The pattern that works: enter the room with one idea.") },
        { id: "p4", text: t("پیشنهادهای قبلی را همراه دارم، ولی خودم بحثشان را باز نمی‌کنم.", "Have earlier proposals with me, but will not open that discussion myself."), note: t("امروز جلسهٔ این پروژه است. اگر پرسیدند، کوتاه جواب می‌دهید.", "Today is about this project. If they ask, answer briefly.") },
        { id: "p5", text: t("جملهٔ قیمت را حفظ کرده‌ام (بخش «قبل از خروج»).", "Memorized the price sentence (see “Before leaving the room”)."), note: t("تا از قبل آماده نباشد، در لحظه عدد می‌گویید.", "Without it prepared, you will say a number on the spot.") },
        { id: "p6", text: t("شارژ گوشی، این برگه باز، یک دفترچه هم برای احتیاط.", "Phone charged, this sheet open, a notebook as backup."), note: t("", "") }
      ]
    },
    {
      id: "company",
      kind: "questions",
      title: t("شرکت و لانچ", "Company and launch"),
      lead: t("تا ندانید این شرکت چیست و لانچ یعنی چه، ساختار سایت را نمی‌شود چید.", "Until you know what this company is and what the launch means, the site cannot be structured."),
      items: [
        { id: "c1", must: true, text: t("نام نهایی شرکت چیست؟ ثبت شده؟ نام برند با نام حقوقی یکی است؟", "What is the company's final name? Registered? Is the brand name the same as the legal name?"), why: t("دامنه، عنوان سایت و متن حقوقی پایین صفحه از همین‌جا می‌آید.", "Domain, site title, and the legal footer all come from this.") },
        { id: "c2", must: true, text: t("این شرکت دقیقاً چه می‌کند؟ تولیدکننده است، واردکننده، توزیع‌کننده، یا فقط صاحب برند؟", "What exactly does this company do? Manufacturer, importer, distributor, or brand owner only?"), why: t("«درباره ما» و اعتبار کل سایت به این جواب بستگی دارد.", "The About page and the credibility of the whole site depend on this.") },
        { id: "c3", text: t("نسبت آن با گروه/هلدینگ چیست؟ باید در سایت نوشته شود «عضوی از …»؟", "How does it relate to the group/holding? Should the site say “a member of …”?"), why: t("اعتماد بیشتر برای شرکت تازه، و لینک بین سایت‌ها.", "More trust for a new company, and links between the sites.") },
        { id: "c4", must: true, text: t("لانچ دقیقاً یعنی چه؟ محصول در بازار؟ رویداد؟ کمپین؟ تاریخ دقیق دارد؟", "What exactly does the launch mean? Product in the market? An event? A campaign? Is there an exact date?"), why: t("تاریخ تحویل سایت از این تاریخ به عقب حساب می‌شود.", "The site's delivery date is counted backwards from this.") },
        { id: "c5", must: true, text: t("روز لانچ، سایت باید چه کاری انجام دهد؟ معرفی برند، اطلاعات محصول، «از کجا بخرم»، جذب نماینده، تماس؟", "On launch day, what must the site do? Present the brand, product information, “where to buy”, recruit distributors, contact?"), why: t("کار اصلی سایت = ساختار صفحهٔ اول. همه‌چیز از این تصمیم می‌آید.", "The site's main job = the structure of the homepage. Everything follows from this.") },
        { id: "c6", text: t("موفقیت سایت را با چه چیزی می‌سنجید؟ بازدید؟ تماس؟ درخواست نمایندگی؟ فقط «آبرومند باشد»؟", "How will they measure the site's success? Visits? Calls? Distributor requests? Just “look respectable”?"), why: t("این معیارِ «خوب کار کردنِ» شما در این پروژه است.", "This is the definition of you “doing well” on this project.") },
        { id: "c7", text: t("دو سه برند یا سایت که دوست دارند (ایرانی یا خارجی) و یکی که دوست ندارند؟", "Two or three brands or sites they like (local or foreign), and one they dislike?"), why: t("رفرنس سلیقه. بحث‌های طراحی را نصف می‌کند.", "A taste reference. Halves the design debates.") }
      ]
    },
    {
      id: "audience",
      kind: "questions",
      title: t("مخاطب و بازار", "Audience and market"),
      lead: t("سایت برای مصرف‌کننده و سایت برای خریدار تجاری دو چیز کاملاً متفاوت‌اند.", "A site for consumers and a site for trade buyers are two completely different things."),
      items: [
        { id: "a1", must: true, text: t("مشتری نهایی کیست؟ مصرف‌کنندهٔ عادی، فروشگاه/داروخانه، متخصص، توزیع‌کننده؟ کدام مهم‌تر است؟", "Who is the end customer? Consumers, retailers/pharmacies, professionals, distributors? Which matters most?"), why: t("B2C یا B2B، صفحه‌ها و لحن را عوض می‌کند.", "B2C or B2B changes the pages and the tone.") },
        { id: "a2", text: t("محصول کجا فروخته می‌شود؟ فروشگاه‌ها، فروشگاه آنلاین خودشان، مارکت‌پلیس‌ها، نمایندگی؟", "Where is the product sold? Stores, their own online shop, marketplaces, agents?"), why: t("بخش «از کجا بخرم» و تصمیم فروش آنلاین.", "The “where to buy” section and the online-sales decision.") },
        { id: "a3", text: t("سن و شهر مخاطب اصلی؟ به نظر خودشان چند درصد با موبایل می‌آیند؟", "Age and city of the main audience? What share do they think arrives on mobile?"), why: t("اندازهٔ فونت، سادگی، موبایل‌اول.", "Font size, simplicity, mobile first.") },
        { id: "a4", text: t("رقبای مستقیم چه کسانی‌اند؟ سایتشان چطور است؟ چه چیزی در آن‌ها اذیتشان می‌کند؟", "Who are the direct competitors? What are their sites like? What annoys them about those sites?"), why: t("نقطهٔ تمایز سایت را از همین‌جا پیدا می‌کنید.", "This is where you find the site's point of difference.") }
      ]
    },
    {
      id: "content",
      kind: "questions",
      title: t("محتوا و محصولات", "Content and products"),
      lead: t("بزرگ‌ترین ریسک زمان‌بندی هر سایت شرکتی: محتوایی که «هست» ولی نیست.", "The biggest schedule risk on any company site: content that “exists” but does not."),
      items: [
        { id: "m1", must: true, text: t("چند محصول در لانچ؟ در چند دسته؟ تا شش ماه بعد چند تا می‌شود؟", "How many products at launch? In how many categories? How many six months later?"), why: t("حجم ورود محتوا و ساختار کاتالوگ. کاتالوگ را طوری بسازید که سایت‌های بعدی و اپ هم از آن استفاده کنند.", "Content-loading volume and catalog structure. Build the catalog so later sites and the app reuse it.") },
        { id: "m2", must: true, text: t("اطلاعات هر محصول آماده است؟ نام، توضیح، مشخصات، نحوهٔ استفاده، هشدارها، بروشور. در چه فرمتی؟", "Is each product's information ready? Name, description, specs, usage, warnings, brochure. In what format?"), why: t("اگر «تقریباً آماده» است یعنی آماده نیست. تاریخ تحویلش را بگیرید.", "“Almost ready” means not ready. Get a delivery date for it.") },
        { id: "m3", must: true, text: t("عکس محصول و بسته‌بندی هست؟ رندر یا عکاسی؟ عکاسی لازم است؟ کِی؟ هزینه‌اش با کیست؟", "Do product and packaging photos exist? Renders or photography? Is a shoot needed? When? Who pays?"), why: t("بدون عکس، سایت لانچ نمی‌شود. این مسیر بحرانی است.", "Without photos the site does not launch. This is the critical path.") },
        { id: "m4", must: true, text: t("متن‌های سایت را چه کسی می‌نویسد؟ چه کسی ادعاهای تخصصی/سلامت را تأیید می‌کند؟", "Who writes the site copy? Who approves technical or health claims?"), why: t("مسئولیت حقوقی + گلوگاه تأیید. اسم آن شخص را بگیرید.", "Legal responsibility plus the approval bottleneck. Get that person's name.") },
        { id: "m5", must: true, text: t("مجوزها و گواهی‌ها: کدام‌ها را دارند؟ باید در سایت نمایش داده شوند؟", "Licenses and certificates: which do they hold? Must they be shown on the site?"), why: t("الزام قانونی و اعتماد. اگر ندارند، در پیشنهاد به‌عنوان مسئولیت آن‌ها ذکر می‌شود.", "Legal requirement and trust. If missing, the proposal lists it as their responsibility.") },
        { id: "m6", text: t("محتوای «درباره ما»: داستان شرکت، تیم، کارخانه/آزمایشگاه، گواهی‌ها؟ عکس دارند؟", "About content: company story, team, factory/lab, certificates? Do they have photos?"), why: t("برای برند تازه، اعتبار از همین صفحه می‌آید.", "For a new brand, credibility comes from this page.") },
        { id: "m7", text: t("بلاگ یا محتوای آموزشی می‌خواهند؟ چه کسی تولید می‌کند؟ چند وقت یک‌بار؟", "Do they want a blog or educational content? Who produces it? How often?"), why: t("تصمیم ساختار + هزینهٔ نگهداری. بلاگ خالی بدتر از نبودنش است.", "A structure decision plus maintenance cost. An empty blog is worse than none.") },
        { id: "m8", text: t("زبان: فقط فارسی؟ انگلیسی یا عربی در آینده؟ کِی؟", "Languages: Persian only? English or Arabic later? When?"), why: t("ساختار چندزبانه از روز اول ارزان است، بعداً گران.", "Multilingual structure is cheap on day one and expensive later.") },
        { id: "m9", text: t("اطلاعات تماس، آدرس، شبکه‌های اجتماعی (اینستاگرام فعال دارند؟)، سؤالات متداول؟", "Contact details, address, social channels (an active Instagram?), FAQ?"), why: t("چیزهای کوچکی که آخر کار پروژه را معطل می‌کنند.", "The small things that stall a project at the end.") }
      ]
    },
    {
      id: "brand",
      kind: "questions",
      title: t("برند و هویت بصری", "Brand and visual identity"),
      lead: t("امروز باید بفهمید منتظر چه کسی هستید و تا کِی.", "Today you must learn who you are waiting on, and until when."),
      items: [
        { id: "b1", must: true, text: t("وضعیت هویت بصری: لوگو نهایی؟ رنگ؟ فونت؟ سند راهنمای برند؟", "State of the visual identity: final logo? Colors? Typeface? Brand guidelines?"), why: t("بدون این‌ها طراحی نهایی نمی‌شود؛ ولی ساختار و محتوا می‌تواند شروع شود.", "Design cannot be finalized without these, but structure and content can start.") },
        { id: "b2", must: true, text: t("چه چیزی قطعی شده، چه چیزی مانده، چه کسی تصمیم نهایی را می‌گیرد، و تا کِی؟", "What is settled, what remains, who makes the final call, and by when?"), why: t("تاریخ نهایی شدن برند در پیشنهاد به‌عنوان پیش‌نیاز می‌آید.", "The brand sign-off date goes into the proposal as a prerequisite.") },
        { id: "b3", text: t("برند را تیم داخلی می‌سازد یا آژانس بیرونی؟ اگر آژانس: می‌توانید مستقیم با آن‌ها در تماس باشید؟", "Is the brand built in-house or by an outside agency? If an agency, can you contact them directly?"), why: t("فایل‌ها را از منبع بگیرید، نه از واسطه.", "Get files from the source, not through a middleman.") },
        { id: "b4", text: t("طراحی بسته‌بندی انجام شده؟ فایل‌هایش برای سایت قابل استفاده است؟", "Is packaging design done? Are its files usable for the site?"), why: t("زبان بصری بسته‌بندی، نقطهٔ شروع طبیعی سایت است.", "The packaging's visual language is the natural starting point for the site.") },
        { id: "b5", text: t("لحن برند: علمی و آرام؟ گرم و مردمی؟ یا چیز دیگری در ذهن دارند؟", "Brand tone: scientific and calm? Warm and popular? Something else?"), why: t("لحن متن‌ها و نوع تصاویر.", "The tone of the copy and the kind of imagery.") },
        { id: "b6", text: t("آیا سایت باید با سایت‌های دیگر گروه هم‌خانواده به نظر برسد؟ یا مستقل؟", "Should the site look related to the group's other sites, or independent?"), why: t("تصمیمی که بعداً بازگرداندنش گران است.", "A decision that is expensive to reverse later.") }
      ]
    },
    {
      id: "tech",
      kind: "questions",
      title: t("فنی و زیرساخت", "Technical and infrastructure"),
      lead: t("سؤال‌هایی که اگر امروز نپرسید، هفتهٔ سوم پروژه را متوقف می‌کند.", "The questions that, unasked today, stop the project in week three."),
      items: [
        { id: "t1", must: true, text: t("دامنه: دارند؟ .ir یا .com یا هر دو؟ به نام چه کسی؟ دسترسی به پنل دامنه با کیست؟", "Domain: do they have one? .ir, .com, or both? Registered to whom? Who has panel access?"), why: t("ثبت یا انتقال دامنه زمان‌بر است و دست شما نیست.", "Registering or transferring a domain takes time and is out of your hands.") },
        { id: "t2", must: true, text: t("هاست: داخل کشور یا خارج؟ سرور یا تیم IT دارند؟ ترجیحی دارند؟", "Hosting: inside the country or abroad? Do they have servers or an IT team? Any preference?"), why: t("سرعت برای کاربر، هزینهٔ ماهانه، و اینکه مسئولیت نگهداری با کیست.", "Speed for the user, monthly cost, and who owns maintenance.") },
        { id: "t3", text: t("سایت‌های دیگر گروه روی چه پلتفرمی است؟ چه کسی نگهداری‌شان می‌کند؟", "What platform do the group's other sites run on? Who maintains them?"), why: t("هم انتظار یکپارچگی، هم نقشهٔ پروژه‌های بعدی شما.", "Both the expectation of consistency and the map of your next projects.") },
        { id: "t4", must: true, text: t("فروش آنلاین: الان، بعداً، یا هرگز؟ اگر بعداً: درگاه پرداخت، نماد اعتماد و مجوزها را چه کسی پیگیری می‌کند؟", "Online sales: now, later, or never? If later: who handles the payment gateway, trust seal, and permits?"), why: t("بزرگ‌ترین تفاوت در قیمت و زمان. «بعداً» را هم با تاریخ بگیرید.", "The biggest swing in price and time. Get a date even for “later”.") },
        { id: "t5", text: t("ایمیل سازمانی دارند؟ روی چه سرویسی؟", "Do they have company email? On which service?"), why: t("فرم‌های سایت باید به جایی برسند که کسی می‌خواند.", "Site forms must land somewhere someone reads.") },
        { id: "t6", text: t("ابزارهای فعلی: پنل پیامک، CRM، اینستاگرام، تلگرام، آنالیتیکس؟ چیزی باید به سایت وصل شود؟", "Current tools: SMS panel, CRM, Instagram, Telegram, analytics? Must anything connect to the site?"), why: t("هر اتصال، یک آیتم در محدودهٔ پروژه است.", "Every integration is a scope item.") },
        { id: "t7", must: true, text: t("بعد از لانچ چه کسی سایت را به‌روز می‌کند؟ چقدر با ابزار فنی راحت است؟", "After launch, who updates the site? How comfortable are they with technical tools?"), why: t("پنل مدیریت، آموزش و ماه اولِ اجرا از این جواب طراحی می‌شود.", "The admin panel, training, and the first operating month are designed from this answer.") },
        { id: "t8", text: t("فرم‌ها: تماس، درخواست نمایندگی، پیدا کردن فروشگاه؟ پیام‌ها به کجا برود و چه کسی جواب می‌دهد؟", "Forms: contact, distributor request, store finder? Where do messages go and who answers?"), why: t("فرمی که کسی جوابش را نمی‌دهد، به برند ضربه می‌زند.", "A form nobody answers damages the brand.") },
        { id: "t9", text: t("صفحهٔ حریم خصوصی و قوانین لازم دارند؟ متن حقوقی را چه کسی می‌دهد؟", "Do they need privacy and terms pages? Who supplies the legal text?"), why: t("معمولاً آخر کار یادشان می‌افتد و پروژه معطل می‌ماند.", "Usually remembered at the end, and the project stalls.") },
        { id: "t10", text: t("چیزی از سایت یا کانال قبلی باید منتقل شود؟", "Must anything be migrated from an old site or channel?"), why: t("محتوای قدیمی، لینک‌ها، اکانت‌ها.", "Old content, links, accounts.") }
      ]
    },
    {
      id: "time",
      kind: "questions",
      title: t("زمان‌بندی و افراد", "Timeline and people"),
      lead: t("تأخیر آن‌ها نباید تأخیر شما حساب شود. برای این، تاریخ‌های آن‌ها را مکتوب داشته باشید.", "Their delays must not count as yours. For that, have their dates in writing."),
      items: [
        { id: "s1", must: true, text: t("تاریخ لانچ به تقویم خودشان دقیقاً کِی است؟ قطعی است یا جابه‌جا می‌شود؟ چه چیزی به سایت وابسته است؟", "What is the exact launch date in their calendar? Fixed or movable? What depends on the site?"), why: t("از این تاریخ به عقب برنامه می‌ریزید.", "You plan backwards from this date.") },
        { id: "s2", must: true, text: t("تاریخ‌های سمت آن‌ها: برند نهایی کِی؟ محتوای محصول کِی؟ عکس‌ها کِی؟", "Their side's dates: final brand when? Product content when? Photos when?"), why: t("این‌ها در پیشنهاد به‌عنوان پیش‌نیاز با تاریخ نوشته می‌شوند.", "These go into the proposal as dated prerequisites.") },
        { id: "s3", must: true, text: t("رابط روزانهٔ من کیست؟ تصمیم‌گیرندهٔ نهایی کیست؟ چه کسی طراحی را تأیید می‌کند؟", "Who is my day-to-day contact? Who is the final decision maker? Who approves design?"), why: t("سه نفر مختلف یعنی سه دور بازبینی. از الان بدانید.", "Three different people means three review rounds. Know it now.") },
        { id: "s4", text: t("روال بازبینی: چند دور؟ چه کسانی؟ جلسهٔ کوتاه هفتگی ممکن است؟", "Review process: how many rounds? Who? Is a short weekly call possible?"), why: t("تعداد دور بازبینی در پیشنهاد محدود می‌شود.", "The number of review rounds is capped in the proposal.") },
        { id: "s5", text: t("تعطیلات یا رویدادهای پیش‌رو در تقویم آن‌ها که کار را کند می‌کند؟", "Upcoming holidays or events in their calendar that slow the work?"), why: t("نمایشگاه، تعطیلات، سفر مدیر.", "Trade shows, holidays, the boss's travel.") },
        { id: "s6", text: t("پیمانکارهای دیگر (بسته‌بندی، چاپ، روابط عمومی، عکاس) که باید با آن‌ها هماهنگ شوید؟", "Other vendors (packaging, print, PR, photographer) you must coordinate with?"), why: t("اسم و شماره بگیرید.", "Get names and numbers.") }
      ]
    },
    {
      id: "money",
      kind: "questions",
      title: t("مالی و مسیر تصمیم", "Money and the decision path"),
      lead: t("قیمت نمی‌گویید، ولی همهٔ چیزهایی که برای قیمت دادن لازم است را می‌پرسید.", "You do not name a price, but you ask for everything needed to set one."),
      items: [
        { id: "f1", must: true, text: t("چه کسی پیشنهاد را تأیید می‌کند؟ چه کسی امضا می‌کند؟ پرداخت از طرف گروه است یا شرکت جدید؟", "Who approves the proposal? Who signs? Does the group pay or the new company?"), why: t("پیشنهاد را برای همان شخص می‌نویسید.", "You write the proposal for that person.") },
        { id: "f2", must: true, text: t("برای این سایت بودجه‌ای پیش‌بینی شده؟ حدودش؟ (ملایم: «برای اینکه پیشنهاد را درست اندازه کنم…»)", "Is a budget set aside for this site? Roughly? (Gently: “so I can size the proposal correctly…”)"), why: t("اگر گفتند، قیمت‌گذاری از حدس به واقعیت می‌رسد. اگر نگفتند، اشکالی ندارد.", "If they answer, pricing goes from guess to fact. If not, that is fine.") },
        { id: "f3", must: true, text: t("روال پرداخت به پیمانکاران: پیش‌پرداخت چند درصد؟ مرحله‌ای؟ قرارداد رسمی؟ فاکتور رسمی لازم است؟", "How do they pay vendors: what deposit percentage? Milestones? Formal contract? Official invoices required?"), why: t("ساختار مراحل پرداخت در پیشنهاد.", "The payment-milestone structure in the proposal.") },
        { id: "f4", must: true, text: t("پرداخت به من چطور انجام می‌شود؟ کدام ارز؟ از چه کانالی؟ نوسان قیمت در طول پروژه چطور مدیریت می‌شود؟", "How will I be paid? Which currency? Through which channel? How is exchange-rate movement handled during the project?"), why: t("باید قبل از عدد دادن بدانید.", "You must know this before naming a number.") },
        { id: "f5", text: t("هزینه‌های جاری (هاست، دامنه، پیامک) را چه کسی می‌پردازد؟ مستقیم یا از طریق شما؟", "Who pays running costs (hosting, domain, SMS)? Directly or through you?"), why: t("شفاف نباشد، بعداً بحث می‌شود.", "Left vague, it becomes an argument later.") },
        { id: "f6", text: t("به پشتیبانی و نگهداری ماهانه بعد از لانچ فکر کرده‌اند؟", "Have they thought about monthly support and maintenance after launch?"), why: t("درآمد تکرارشونده. ماه اول را در پیشنهاد می‌گنجانید، بعدش قرارداد ماهانه.", "Recurring revenue. Include the first month in the proposal, then a monthly contract.") },
        { id: "f7", text: t("چند پیشنهاد دیگر هم می‌گیرند؟ روال تصمیم چقدر طول می‌کشد؟", "Are they collecting other proposals? How long does the decision take?"), why: t("بدانید با چه کسی مقایسه می‌شوید و کِی جواب می‌گیرید.", "Know who you are compared against and when you will hear back.") }
      ]
    },
    {
      id: "big",
      kind: "questions",
      title: t("تصویر بزرگ‌تر", "The bigger picture"),
      lead: t("سبک بپرسید. این‌ها برای امروز نیست، برای شش ماه بعد است.", "Ask lightly. These are not for today; they are for six months from now."),
      items: [
        { id: "g1", text: t("اگر این پروژه خوب پیش برود، قدم بعدی چیست؟", "If this project goes well, what is the next step?"), why: t("تعریفِ «خوب» از زبان خودشان، معیار موفقیت شماست.", "Their own definition of “well” is your success criterion.") },
        { id: "g2", text: t("از پیمانکارهای قبلی چه چیزی اذیتشان کرده؟", "What has annoyed them about previous vendors?"), why: t("دقیقاً برعکسش را انجام می‌دهید و در پیشنهاد می‌نویسید.", "Do exactly the opposite, and say so in the proposal.") },
        { id: "g3", text: t("پروژه‌های بزرگ‌تر (اپ، سیستم داخلی) در برنامهٔ امسال یا سال بعدشان کجاست؟", "Where do bigger projects (an app, an internal system) sit in this year's or next year's plan?"), why: t("فقط برای اینکه بدانید. امروز اصرار نکنید.", "Just so you know. Do not push today.") }
      ]
    },
    {
      id: "exit",
      kind: "checklist",
      title: t("قبل از خروج از اتاق", "Before leaving the room"),
      lead: t("تا این‌ها تیک نخورده، جلسه تمام نشده.", "Until these are ticked, the meeting is not over."),
      items: [
        { id: "x1", text: t("گفتم: «پیشنهاد کامل تا دو روز دیگر دستتان است.»", "Said: “You will have the full proposal within two days.”"), note: t("", "") },
        { id: "x2", text: t("قیمت نگفتم.", "Did not name a price."), note: t("اگر پرسیدند، جملهٔ پایین.", "If asked, use the sentence below.") },
        { id: "x3", text: t("شماره و ایمیل رابط روزانه را گرفتم.", "Got the day-to-day contact's number and email."), note: t("", "") },
        { id: "x4", text: t("درخواست کردم، با تاریخ: فایل‌های برند، لیست محصولات، عکس‌ها، دسترسی دامنه.", "Requested, with dates: brand files, product list, photos, domain access."), note: t("«تا کِی می‌توانید بفرستید؟» را برای هر کدام بپرسید.", "Ask “by when can you send this?” for each one.") },
        { id: "x5", text: t("تاریخ لانچ را دقیق و به تقویم خودشان نوشتم.", "Wrote down the launch date exactly, in their calendar."), note: t("", "") },
        { id: "x6", text: t("تاریخ تماس یا جلسهٔ بعدی مشخص شد.", "The next call or meeting date is set."), note: t("", "") }
      ],
      scripts: [
        { label: t("اگر قیمت پرسیدند", "If they ask for a price"), text: t("«تا لیست محصولات و تاریخ لانچ را نبینم عدد واقعی نمی‌دهم، چون نمی‌خواهم عددی بگویم که بعداً عوض شود. تا دو روز دیگر عدد دقیق را با جزئیات می‌فرستم.»", "“I won't give a real number until I've seen the product list and the launch date, because I don't want to say a figure that changes later. You'll have the exact number, with details, within two days.”") },
        { label: t("اگر گفتند «فقط یک حدود بگو»", "If they say “just give us a rough idea”"), text: t("«حدود گفتن برای من راحت است، ولی برای شما بی‌فایده. سه گزینهٔ روشن می‌فرستم که بتوانید انتخاب کنید.»", "“A rough number is easy for me and useless for you. I'll send three clear options you can choose between.”") }
      ]
    },
    {
      id: "after",
      kind: "checklist",
      title: t("بعد از جلسه", "After the meeting"),
      lead: t("تا یک ساعت بعد، وقتی همه‌چیز هنوز در ذهنتان است.", "Within the hour, while it is all still in your head."),
      items: [
        { id: "w1", text: t("همهٔ پاسخ‌ها را همین‌جا کامل کردم، حدس‌های خودم را با علامت «؟» نوشتم.", "Completed every answer here; marked my own guesses with “?”."), note: t("", "") },
        { id: "w2", text: t("سؤال‌هایی که یادم رفت را نوشتم و همان روز پیام دادم.", "Wrote down the questions I forgot and messaged them the same day."), note: t("پیگیری سریع، خودش نشانهٔ حرفه‌ای بودن است.", "Fast follow-up is itself a sign of professionalism.") },
        { id: "w3", text: t("اسکرین‌شات و یادداشت «وضعیت قبل» را در پروژه ذخیره کردم.", "Saved the “before” screenshots and notes to the project."), note: t("", "") },
        { id: "w4", text: t("دو سه قیمت مرجع از بازار درآوردم.", "Pulled two or three reference prices from the market."), note: t("کف و سقف بازار، قبل از عدد دادن.", "The market floor and ceiling, before naming a number.") },
        { id: "w5", text: t("ساعت‌های کار را واقع‌بینانه تخمین زدم و کف قیمت خودم را نوشتم.", "Estimated the hours realistically and wrote down my own floor price."), note: t("", "") },
        { id: "w6", text: t("پیشنهاد را شروع کردم.", "Started the proposal."), note: t("", "") }
      ]
    }
  ]
};

/**
 * The second template, and the one Alex's own plan asks for: no work starts
 * without a written scope, so this is everything that must be settled before a
 * proposal can be written and sent. Discovery collects the facts; this decides
 * what you are actually selling, for how much, and what you are not doing.
 */
export const PROPOSAL_CHECKLIST_TEMPLATE = {
  id: "proposal-checklist",
  version: 1,
  defaultLang: "fa",
  name: t("چک‌لیست پیشنهاد", "Proposal checklist"),
  description: t(
    "هر چیزی که باید قبل از نوشتن و فرستادن پیشنهاد تعیین شده باشد: محدوده، مراحل، پیش‌نیازها با تاریخ، قیمت، مراحل پرداخت، و آنچه بیرون از کار است.",
    "Everything that must be settled before a proposal is written and sent: scope, phases, dated prerequisites, price, payment milestones, and what is explicitly out."
  ),
  intro: [
    t("پیشنهاد، قرارداد است با لباس مؤدب. هر چیزی که اینجا مبهم بماند، بعداً رایگان انجامش می‌دهید.", "A proposal is a contract in polite clothes. Anything left vague here you will end up doing for free."),
    t("قبل از این برگه، جلسهٔ کشف باید پر شده باشد. اگر نشده، اول برگردید.", "Discovery must be filled in before this sheet. If it is not, go back first."),
    t("سؤال‌های ★ ضروری‌اند؛ بدون آن‌ها پیشنهاد را نفرستید.", "★ questions are required; do not send the proposal without them.")
  ],
  sections: [
    {
      id: "ready",
      kind: "checklist",
      title: t("پیش از نوشتن", "Before writing"),
      lead: t("نیم ساعت. پیشنهادی که از روی حدس نوشته شود، در جلسهٔ بعد شکسته می‌شود.", "Half an hour. A proposal written from guesses breaks in the next meeting."),
      items: [
        { id: "r1", text: t("جلسهٔ کشف این مشتری را باز کردم و سؤال‌های ★ آن جواب دارند.", "Opened this client's discovery sheet and its ★ questions are answered."), note: t("اگر ★ها خالی‌اند، قیمت حدس است.", "If the ★ questions are blank, the price is a guess.") },
        { id: "r2", text: t("ساعت کار واقعی هر مرحله را تخمین زدم و نوشتم.", "Estimated and wrote down the real hours for each phase."), note: t("تخمین خوش‌بینانه را در دو ضرب کنید.", "Double the optimistic estimate.") },
        { id: "r3", text: t("کف قیمت خودم را برای این پروژه نوشتم.", "Wrote down my own floor price for this project."), note: t("عددی که زیرش کار نمی‌کنید، قبل از مذاکره.", "The number you will not work below, decided before the negotiation.") },
        { id: "r4", text: t("دو سه قیمت مرجع از بازار درآوردم.", "Pulled two or three reference prices from the market."), note: t("", "") },
        { id: "r5", text: t("تصمیم گرفتم این کار را می‌خواهم یا نه.", "Decided whether I actually want this work."), note: t("پیشنهاد فرستادن یعنی آماده‌اید انجامش دهید.", "Sending a proposal means you are ready to do it.") }
      ]
    },
    {
      id: "scope",
      kind: "questions",
      title: t("محدودهٔ کار", "The scope"),
      lead: t("یک جمله که هر دو طرف شش ماه بعد هم سرش توافق داشته باشند.", "One sentence both sides will still agree on in six months."),
      items: [
        { id: "s1", must: true, text: t("این کار در یک جمله چیست؟ وقتی تمام شد، چه چیزی برای آن‌ها عوض شده؟", "What is this work in one sentence? When it is finished, what has changed for them?"), why: t("سطر اول پیشنهاد. اگر نمی‌توانید در یک جمله بگویید، هنوز نفهمیده‌اید.", "The proposal's first line. If you cannot say it in one sentence, you do not understand it yet.") },
        { id: "s2", must: true, text: t("دقیقاً چه چیزهایی تحویل داده می‌شود؟ فهرست کنید: صفحه‌ها، فایل‌ها، آموزش، اسناد.", "Exactly what is delivered? List it: pages, files, training, documents."), why: t("فهرست تحویل‌ها = تعریف «تمام شد». هر چیزی که در فهرست نیست، نیست.", "The delivery list is the definition of done. Anything not on the list is not included.") },
        { id: "s3", must: true, text: t("چند صفحه / چند قالب / چند محصول؟ عدد دقیق.", "How many pages / templates / products? An exact number."), why: t("«چند صفحه» بزرگ‌ترین دلیل بالا رفتن کار بدون بالا رفتن پول است.", "“A few pages” is the biggest cause of work growing while money does not.") },
        { id: "s4", must: true, text: t("چه کسی محتوا را وارد می‌کند؟ من، آن‌ها، یا هر دو تا کجا؟", "Who loads the content? Me, them, or both up to what point?"), why: t("ورود محتوا ساعت می‌برد و معمولاً در قیمت فراموش می‌شود.", "Content loading takes hours and is usually forgotten in the price.") },
        { id: "s5", text: t("موفقیت این پروژه را با چه چیزی می‌سنجیم؟ یک عدد یا یک اتفاق.", "How do we measure this project's success? One number or one event."), why: t("در پیشنهاد می‌نویسید و در پایان به آن برمی‌گردید.", "You write it in the proposal and come back to it at the end.") }
      ]
    },
    {
      id: "phases",
      kind: "questions",
      title: t("مراحل و تاریخ‌ها", "Phases and dates"),
      lead: t("مرحله‌ای که تاریخ و تعریف پایان ندارد، مرحله نیست.", "A phase without a date and a definition of finished is not a phase."),
      items: [
        { id: "h1", must: true, text: t("کار به چند مرحله تقسیم می‌شود؟ نام و خروجی هر مرحله چیست؟", "How many phases does the work split into? What is each phase's name and output?"), why: t("مراحل، هم زمان‌بندی را می‌سازند هم مراحل پرداخت را.", "Phases build both the schedule and the payment milestones.") },
        { id: "h2", must: true, text: t("تاریخ تحویل نهایی چیست، و از کدام روز شروع می‌شود؟", "What is the final delivery date, and which day does the clock start on?"), why: t("«از روز شروع» یعنی بعد از پیش‌پرداخت و رسیدن فایل‌ها، نه از روز امضا.", "“From the start day” means after the deposit and the files arrive, not from the signature.") },
        { id: "h3", must: true, text: t("چند دور بازبینی در هر مرحله؟ دور اضافه چقدر هزینه دارد؟", "How many review rounds per phase? What does an extra round cost?"), why: t("بدون سقف، بازبینی بی‌پایان می‌شود.", "Without a cap, reviews never end.") },
        { id: "h4", text: t("تأیید هر مرحله با چه کسی و در چند روز؟", "Who signs off each phase, and within how many days?"), why: t("سکوت مشتری هم باید تاریخ داشته باشد، وگرنه تأخیر به نام شما نوشته می‌شود.", "Even client silence needs a deadline, or the delay is recorded as yours.") },
        { id: "h5", text: t("کدام مرحله را می‌شود موازی جلو برد و کدام به قبلی وابسته است؟", "Which phase can run in parallel and which depends on the previous one?"), why: t("مسیر بحرانی را قبل از قول دادن تاریخ بشناسید.", "Know the critical path before promising a date.") }
      ]
    },
    {
      id: "prereqs",
      kind: "questions",
      title: t("پیش‌نیازها، با تاریخ", "Prerequisites, with dates"),
      lead: t("هر چیزی که از سمت آن‌ها می‌آید، در پیشنهاد با تاریخ نوشته می‌شود. تأخیر آن‌ها تأخیر شما نیست.", "Everything coming from their side goes into the proposal with a date. Their delay is not your delay."),
      items: [
        { id: "q1", must: true, text: t("فایل‌های برند (لوگو، رنگ، فونت) تا چه تاریخی می‌رسد؟", "By what date do the brand files (logo, colors, typeface) arrive?"), why: t("طراحی نهایی بدون این‌ها شروع نمی‌شود.", "Final design does not start without them.") },
        { id: "q2", must: true, text: t("محتوا و متن‌ها تا چه تاریخی؟ از چه کسی؟", "By what date does the content and copy arrive? From whom?"), why: t("بزرگ‌ترین دلیل تأخیر هر پروژه.", "The single biggest cause of delay on any project.") },
        { id: "q3", must: true, text: t("عکس‌ها و ویدیوها تا چه تاریخی؟ اگر عکاسی لازم است، چه کسی هماهنگ می‌کند؟", "By what date do photos and video arrive? If a shoot is needed, who arranges it?"), why: t("عکس نبودن یعنی لانچ نشدن.", "No photos means no launch.") },
        { id: "q4", must: true, text: t("دسترسی‌ها (دامنه، هاست، ایمیل، اکانت‌ها) تا چه تاریخی و از چه کسی؟", "By what date, and from whom, do the accesses arrive (domain, hosting, email, accounts)?"), why: t("انتقال دامنه می‌تواند یک هفته طول بکشد و دست شما نیست.", "A domain transfer can take a week and is out of your hands.") },
        { id: "q5", must: true, text: t("تصمیم‌گیرندهٔ نهایی و رابط روزانه چه کسانی‌اند؟ اسم و شماره.", "Who is the final decision maker and who is the day-to-day contact? Name and number."), why: t("پیشنهاد را برای تصمیم‌گیرنده می‌نویسید و با رابط کار می‌کنید.", "You write the proposal for the decision maker and work with the contact.") },
        { id: "q6", must: true, text: t("اگر یک پیش‌نیاز دیر برسد چه می‌شود؟ تاریخ تحویل چطور جابه‌جا می‌شود؟", "What happens if a prerequisite is late? How does the delivery date move?"), why: t("این جمله در پیشنهاد، بعداً یک ماه دعوا را تمام می‌کند.", "This one sentence in the proposal ends a month of argument later.") }
      ]
    },
    {
      id: "price",
      kind: "questions",
      title: t("قیمت و پرداخت", "Price and payment"),
      lead: t("عدد، ارز، کانال، و مراحل. هر چهارتا، وگرنه عدد معنی ندارد.", "The number, the currency, the channel, and the milestones. All four, or the number means nothing."),
      items: [
        { id: "p1", must: true, text: t("قیمت کل چقدر است؟ یک عدد یا سه گزینه؟", "What is the total price? One number or three options?"), why: t("سه گزینه انتخاب می‌سازد؛ یک عدد بله-یا-نه می‌سازد.", "Three options create a choice; one number creates a yes-or-no.") },
        { id: "p2", must: true, text: t("ارز و کانال پرداخت چیست؟ نوسان نرخ در طول پروژه با کیست؟", "Which currency and payment channel? Who carries exchange-rate movement during the project?"), why: t("بین ترکیه و ایران این بند از خود قیمت مهم‌تر است.", "Between Turkey and Iran this clause matters more than the price itself.") },
        { id: "p3", must: true, text: t("پیش‌پرداخت چند درصد؟ کار قبل از رسیدنش شروع نمی‌شود.", "What deposit percentage? No work starts before it lands."), why: t("پیش‌پرداخت، هم تعهد است هم فیلتر.", "The deposit is both a commitment and a filter.") },
        { id: "p4", must: true, text: t("مراحل پرداخت به کدام تحویل‌ها گره می‌خورد؟", "Which deliverables are the payment milestones tied to?"), why: t("پرداخت به تاریخ گره نخورد؛ به تحویل گره بخورد.", "Tie payment to delivery, never to a date.") },
        { id: "p5", text: t("فاکتور رسمی لازم است؟ مالیات یا کسورات؟", "Is an official invoice required? Tax or deductions?"), why: t("عدد خالص شما را عوض می‌کند.", "It changes the number you actually keep.") },
        { id: "p6", text: t("هزینه‌های جاری (هاست، دامنه، سرویس‌ها) با کیست؟ مستقیم یا از طریق من؟", "Who pays running costs (hosting, domain, services)? Directly or through me?"), why: t("اگر از طریق شماست، در پیشنهاد جدا نوشته شود.", "If it runs through you, list it separately in the proposal.") },
        { id: "p7", text: t("پشتیبانی ماهانهٔ بعد از تحویل: قیمت و محدوده‌اش چیست؟", "Monthly support after delivery: what is its price and scope?"), why: t("درآمد تکرارشونده از همین بند شروع می‌شود.", "Recurring revenue starts with this clause.") },
        { id: "p8", text: t("پیشنهاد تا چه تاریخی معتبر است؟", "Until what date is the proposal valid?"), why: t("تاریخ انقضا تصمیم را جلو می‌اندازد.", "An expiry date pulls the decision forward.") }
      ]
    },
    {
      id: "out",
      kind: "questions",
      title: t("آنچه بیرون از کار است", "What is explicitly out"),
      lead: t("مهم‌ترین بخش پیشنهاد. آنچه ننوشته‌اید که انجام نمی‌دهید، انتظار می‌رود که انجام دهید.", "The most important part of the proposal. Whatever you do not write down as excluded is expected."),
      items: [
        { id: "o1", must: true, text: t("چه چیزهایی صراحتاً شامل این قیمت نیست؟ فهرست کنید.", "What is explicitly not included in this price? List it."), why: t("عکاسی، تولید محتوا، تبلیغات، ترجمه، اپ، نگهداری.", "Photography, content production, advertising, translation, an app, maintenance.") },
        { id: "o2", must: true, text: t("درخواست تغییر بعد از تأیید چطور رسیدگی می‌شود؟ نرخ ساعتی یا پیشنهاد جدا؟", "How is a change request after sign-off handled? An hourly rate or a separate quote?"), why: t("بدون این بند، هر تغییر رایگان فرض می‌شود.", "Without this clause every change is assumed free.") },
        { id: "o3", text: t("بعد از تحویل چند روز رفع اشکال رایگان است؟", "How many days of free bug fixing after delivery?"), why: t("یک عدد مشخص، نه «پشتیبانی می‌کنیم».", "A specific number, not “we'll support you”.") },
        { id: "o4", text: t("مالکیت فایل‌ها و کد بعد از پرداخت کامل با کیست؟ کد را تحویل می‌دهید؟", "Who owns the files and the code after full payment? Do you hand over the code?"), why: t("قبل از امضا روشن شود، نه وقت دعوا.", "Settle it before signing, not during an argument.") },
        { id: "o5", text: t("اجازهٔ استفاده از این کار در نمونه‌کارها را دارید؟", "Do you have permission to use this work in your portfolio?"), why: t("کیس‌استادی، مشتری بعدی را می‌آورد. الان بپرسید.", "The case study brings the next client. Ask now.") }
      ]
    },
    {
      id: "send",
      kind: "checklist",
      title: t("قبل از فرستادن", "Before sending"),
      lead: t("ده دقیقه آخر. پیشنهادی که بی‌دقت فرستاده شود، دربارهٔ کار شما هم حرف می‌زند.", "The last ten minutes. A carelessly sent proposal says something about your work too."),
      items: [
        { id: "z1", text: t("صفحهٔ اول فقط یک خلاصه است: کار، تاریخ، قیمت.", "The first page is only a summary: the work, the date, the price."), note: t("تصمیم‌گیرنده شاید فقط همین را بخواند.", "The decision maker may read only this.") },
        { id: "z2", text: t("پیش‌نیازهای سمت آن‌ها با تاریخ نوشته شده.", "Their side's prerequisites are written with dates."), note: t("", "") },
        { id: "z3", text: t("فهرست «شامل نمی‌شود» در پیشنهاد هست.", "The “not included” list is in the proposal."), note: t("", "") },
        { id: "z4", text: t("مراحل پرداخت به تحویل‌ها گره خورده، نه به تاریخ.", "Payment milestones are tied to deliverables, not dates."), note: t("", "") },
        { id: "z5", text: t("تاریخ اعتبار پیشنهاد نوشته شده.", "The proposal's validity date is written."), note: t("", "") },
        { id: "z6", text: t("یک بار بلند خواندمش و غلط‌های تایپی را گرفتم.", "Read it aloud once and caught the typos."), note: t("", "") },
        { id: "z7", text: t("تاریخ پیگیری را در تقویم خودم گذاشتم.", "Put the follow-up date in my own calendar."), note: t("سه روز کاری بعد، اگر جوابی نیامد.", "Three working days later, if no answer arrives.") }
      ],
      scripts: [
        { label: t("وقتی می‌فرستید", "When you send it"), text: t("«پیشنهاد کامل را فرستادم. صفحهٔ اول خلاصهٔ کار و قیمت است و بقیه جزئیات. اگر تا پنجشنبه سؤالی داشتید، یک تماس کوتاه بگذاریم.»", "“I've sent the full proposal. The first page is the summary of the work and the price; the rest is detail. If anything is unclear by Thursday, let's take a short call.”") },
        { label: t("اگر گفتند گران است", "If they say it is expensive"), text: t("«می‌فهمم. عدد را پایین نمی‌آورم ولی می‌توانم محدوده را کوچک‌تر کنم — بگویید کدام بخش برای لانچ ضروری نیست.»", "“I understand. I won't lower the number, but I can make the scope smaller — tell me which part is not essential for launch.”") }
      ]
    }
  ]
};

export const SHEET_TEMPLATES = [WEBSITE_DISCOVERY_TEMPLATE, PROPOSAL_CHECKLIST_TEMPLATE];

export function sheetTemplate(id) {
  return SHEET_TEMPLATES.find((template) => template.id === id) || null;
}

/** Pick one language out of a bilingual string, falling back to whichever exists. */
export function sheetText(value, lang = "fa") {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[lang] || value.fa || value.en || "";
}

export function sheetLanguage(id) {
  return SHEET_LANGUAGES.find((language) => language.id === id) || SHEET_LANGUAGES[0];
}

function answered(value) {
  return String(value ?? "").trim().length > 0;
}

/** Progress a sheet's answers and checks against its template. */
export function sheetProgress(template, sheet = {}) {
  const answers = sheet.answers || {};
  const checks = sheet.checks || {};
  const progress = { questions: 0, answered: 0, must: 0, mustAnswered: 0, checks: 0, checked: 0, sections: {} };
  if (!template) return progress;
  for (const section of template.sections || []) {
    const part = { total: 0, done: 0 };
    for (const item of section.items || []) {
      part.total += 1;
      if (section.kind === "checklist") {
        progress.checks += 1;
        if (checks[item.id] === true) { progress.checked += 1; part.done += 1; }
      } else {
        progress.questions += 1;
        if (item.must) progress.must += 1;
        if (answered(answers[item.id])) {
          progress.answered += 1;
          part.done += 1;
          if (item.must) progress.mustAnswered += 1;
        }
      }
    }
    progress.sections[section.id] = part;
  }
  return progress;
}
