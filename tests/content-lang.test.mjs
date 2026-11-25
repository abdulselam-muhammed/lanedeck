import test from "node:test";
import assert from "node:assert/strict";
import { contentLanguages, frontMatter, localizeText, missingTranslations } from "../server/i18n/content.mjs";

const MAP = `\`\`\`flow
> now: Billing webhooks
> now@xx: Billing-XX
== Auth | done | Login and reset
==@xx Auth-XX | later | Login-XX
- Login form | done | PR #8 | merged
-@xx Form-XX | next | PR-XX | merged-XX
  - Reset mail | next | | provider not chosen
== Billing | next
\`\`\``;

test("a translation line replaces the text fields for its language; the state stays", () => {
  const out = localizeText(MAP, "xx", ["en", "xx"]);
  assert.match(out, /^> now: Billing-XX$/m);
  assert.match(out, /^== Auth-XX \| done \| Login-XX$/m);
  assert.match(out, /^- Form-XX \| done \| PR-XX \| merged-XX$/m);
  assert.match(out, /^ {2}- Reset mail \| next \| \| provider not chosen$/m); // untranslated: as written
  assert.doesNotMatch(out, /@xx/);
});

test("the original is kept for its own language, and for a language without a translation", () => {
  for (const lang of ["en", "yy"]) {
    const out = localizeText(MAP, lang, ["en", "xx"]);
    assert.match(out, /^> now: Billing webhooks$/m);
    assert.match(out, /^== Auth \| done \| Login and reset$/m);
    assert.doesNotMatch(out, /XX/);
  }
});

test("headings, questions, checklists and glossary lines", () => {
  const md = "# Add reset\n#@xx Reset-XX\n## Steps\n- [x] Read the module\n-@xx Read-XX\n## Q1 — Which provider?\n##@xx Provider-XX?\n## Billing\n- **invoice run** — nightly job\n-@xx **run-XX** — job-XX";
  const out = localizeText(md, "xx", ["en", "xx"]);
  assert.match(out, /^# Reset-XX$/m);
  assert.match(out, /^- \[x\] Read-XX$/m);
  assert.match(out, /^## Q1 — Provider-XX\?$/m); // the question keeps its id
  assert.match(out, /^- \*\*run-XX\*\* — job-XX$/m);
});

test("fenced language blocks: the chosen one, else the project's first language, else the first block", () => {
  const md = "Intro\n```lang-en\nDone in English.\n```\n\n```lang-xx\nDone-XX.\n```\nAfter";
  assert.equal(localizeText(md, "xx", ["en", "xx"]), "Intro\nDone-XX.\nAfter");
  assert.equal(localizeText(md, "en", ["en", "xx"]), "Intro\nDone in English.\nAfter");
  assert.equal(localizeText(md, "zz", ["en", "xx"]), "Intro\nDone in English.\nAfter");
});

test("single-language content is unchanged", () => {
  const md = "# Title\n## Steps\n- [ ] one\n```flow\n== A | now\n```";
  assert.equal(localizeText(md, "xx", ["en"]), md);
});

test("project.md front matter names the languages; the config and English are the fallbacks", () => {
  const fm = frontMatter("<!-- lanedeck protocol: 1 -->\n---\nlanguages: [en, ar]\n---\nA project.\n");
  assert.deepEqual(fm.languages, ["en", "ar"]);
  assert.equal(fm.body.includes("languages"), false);
  assert.equal(fm.body.includes("A project."), true);
  assert.equal(frontMatter("No front matter").languages, null);
  assert.deepEqual(contentLanguages(null, ["ar", "en"]), ["ar", "en"]);
  assert.deepEqual(contentLanguages(null, undefined), ["en"]);
});

test("the doctor's check lists text lines without every language", () => {
  const miss = missingTranslations(MAP, ["en", "xx"]);
  assert.deepEqual(miss.map((m) => m.text), ["- Reset mail | next | | provider not chosen", "== Billing | next"]);
  assert.deepEqual(missingTranslations(MAP, ["en"]), []);
});
