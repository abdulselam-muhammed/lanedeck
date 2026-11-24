// The built-in glossary shipped with selam-deck: general working terms (git, GitHub, CI, review, agents), English and Arabic.
// Nothing project-specific lives here. A project's own terms and its rules on these words go in <config folder>/profiles/<name>/profile.json.
type L = { en: string; ar: string };
type Term = { term: string; en: string; ar: string };
type G = { title: L; desc: L; terms: Term[] };

export const GENERAL_GLOSSARY: G[] = [
  {
    title: { en: "Git and GitHub", ar: "Git و GitHub" },
    desc: { en: "The basics of working on code", ar: "أساسيات الشغل على الكود" },
    terms: [
      { term: "commit", en: "One saved set of changes, with its own id such as c2e0fa5", ar: "حفظة وحدة للتعديلات، إلها رقم متل c2e0fa5" },
      { term: "branch", en: "A line of work separate from the main one", ar: "خط شغل منفصل عن الأساسي" },
      { term: "PR (Pull Request)", en: "A request to merge a branch into the main one; the review happens on it", ar: "طلب دمج branch بالأساسي، وعليه بتصير المراجعة" },
      { term: "merge", en: "Combining one branch into another", ar: "دمج branch بـ branch تاني" },
      { term: "squash merge", en: "Merging the whole PR as a single commit", ar: "دمج الـ PR كله كـ commit واحد" },
      { term: "rebase", en: "Rebuilding a branch's commits on top of a new base", ar: "إعادة بناء الـ commits فوق أساس جديد" },
      { term: "force-push", en: "A push that overwrites the history already on GitHub", ar: "رفع يمسح التاريخ الموجود على GitHub" },
      { term: "push", en: "Sending your commits to GitHub", ar: "رفع التعديلات على GitHub" },
      { term: "fetch", en: "Downloading the latest from GitHub without changing your files", ar: "جلب آخر شي من GitHub بدون ما يتغيّر شي محلياً" },
      { term: "head", en: "The latest commit of a PR; the review is of exactly that commit", ar: "آخر commit بالـ PR — المراجعة بتصير عليه بالضبط" },
      { term: "conflict", en: "Two changes to the same line; someone has to decide what stays", ar: "تعديلين على نفس السطر، لازم حدا يقرر شو بيضل" },
      { term: "BEHIND", en: "The PR lacks new commits from the base branch", ar: "الـ PR ناقصو commits جديدة من الـ branch الأساسي" },
      { term: "DIRTY", en: "The PR has a conflict with the base branch", ar: "الـ PR فيه conflict مع الـ branch الأساسي" },
      { term: "worktree", en: "Another checkout of the repo in its own folder, so several jobs can work side by side", ar: "نسخة تانية من الـ repo بفولدر لحالها — بتخلّي أكتر من شغلة تشتغل مع بعض" },
      { term: "Issue", en: "A ticket on GitHub, often used for plans and follow-ups", ar: "تذكرة على GitHub — بتنحط فيها الخطط والمتابعات" },
      { term: "code owner", en: "The person who must approve before a change in their area can merge", ar: "الشخص اللي لازم يوافق قبل دمج تغيير بمجاله" },
    ],
  },
  {
    title: { en: "CI and checks", ar: "CI والفحوصات" },
    desc: { en: "The automatic checks that run with every push", ar: "الفحوصات الأوتوماتيكية اللي بتشتغل مع كل push" },
    terms: [
      { term: "CI", en: "Automatic checks on every push: tests, build, lint", ar: "فحوصات أوتوماتيكية مع كل push: tests و build و lint" },
      { term: "runner", en: "The machine that runs CI jobs", ar: "الجهاز اللي بيشغّل الـ CI" },
      { term: "job", en: "One part of the CI, for example the e2e tests or the build", ar: "جزء من الـ CI، مثلاً e2e أو build" },
      { term: "cancelled", en: "The check was stopped before it finished (not a failure in the code)", ar: "الفحص انلغى قبل ما يخلص (مش فشل بالكود)" },
      { term: "rerun", en: "Running a check again", ar: "إعادة تشغيل فحص" },
      { term: "flaky", en: "A test that sometimes fails for no reason in the code", ar: "test بيفشل أحياناً بلا سبب بالكود" },
      { term: "unit test", en: "A check of one small piece of code on its own", ar: "فحص لجزء صغير من الكود لحالو" },
      { term: "e2e", en: "A check of the whole system from start to end", ar: "فحص للنظام كامل من أولو لآخرو" },
    ],
  },
  {
    title: { en: "Review", ar: "المراجعة" },
    desc: { en: "How review comments are graded and how a review ends", ar: "كيف بتتصنّف ملاحظات المراجعة وكيف بتنتهي" },
    terms: [
      { term: "Blocker", en: "A serious defect: lost money, a security hole, corrupted data. Stops the merge.", ar: "خطأ خطير: خسارة مصاري، ثغرة أمنية، بيانات بتخرب — بيوقف الدمج" },
      { term: "Major", en: "A real problem to fix before merging, but not a disaster", ar: "مشكلة حقيقية لازم تتصلّح قبل الدمج، بس مش كارثة" },
      { term: "Minor", en: "A small note worth fixing; does not stop the merge", ar: "ملاحظة صغيرة منيح تتصلّح — ما بتوقف الدمج" },
      { term: "Nit", en: "A cosmetic detail (short for nitpick); does not stop the merge", ar: "تفصيل شكلي (اختصار nitpick) — ما بيوقف الدمج" },
      { term: "PASS", en: "Approved; can merge once CI is green", ar: "مقبول — بينضم لما يكون الـ CI أخضر" },
      { term: "NOT PASS", en: "At least one Major or worse; must be fixed before merging", ar: "في Major أو أعلى — لازم يتصلّح قبل الدمج" },
      { term: "CHANGES", en: "Changes are requested before it can continue", ar: "مطلوب تعديلات قبل ما يكمل" },
      { term: "follow-up", en: "A note postponed to a separate Issue instead of blocking the merge", ar: "ملاحظة بتتأجّل لـ Issue منفصل بدل ما توقف الدمج" },
      { term: "batch", en: "A group of PRs merged together in order", ar: "دفعة PRs بتنضم سوا بالترتيب" },
      { term: "pipeline", en: "Pushing the next batch while the previous one is still waiting", ar: "رفع الدفعة الجاية والسابقة لسا ناطرة" },
      { term: "rev (revision)", en: "A new version of a plan, for example rev 8", ar: "نسخة جديدة من خطة، مثلاً rev 8" },
    ],
  },
  {
    title: { en: "Working with agents", ar: "الشغل مع الـ agents" },
    desc: { en: "Terms for AI agents working in the background", ar: "كلمات للـ agents اللي بتشتغل بالخلفية" },
    terms: [
      { term: "agent", en: "A copy of the assistant working on one task in the background", ar: "نسخة من المساعد بتشتغل على مهمة بالخلفية" },
      { term: "subagent", en: "An agent started by another agent for part of its task", ar: "agent بيشغّله agent تاني لجزء من مهمتو" },
      { term: "brief", en: "The instructions given to an agent before it starts", ar: "التعليمات اللي بتنعطى للـ agent قبل ما يبلّش" },
    ],
  },
];
