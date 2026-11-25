import test from "node:test";
import assert from "node:assert/strict";
import { checkSettings, localize } from "../server/config.mjs";
import { t } from "../server/i18n/index.mjs";

test("a fresh install (empty config) is in English, left to right", () => {
  const r = checkSettings({});
  assert.equal(r.ok, true);
  assert.equal(r.settings.ui.lang, "en");
  assert.equal(r.settings.ui.dir, "ltr");
});

test("an unknown language falls back to the English text", () => {
  assert.equal(t("xx", "mine.title"), t("en", "mine.title"));
});

test("a profile value may be a string or an { en, ar } pair, picked by the interface language", () => {
  const profile = {
    text: { "nav.flow": { en: "Progress map", ar: "AR" }, plain: "same in both" },
    flowLabels: { done: { ar: "AR only" } },
    glossary: [{ title: { en: "Reviews", ar: "AR" }, entries: [{ terms: [{ term: "PASS", meaning: { en: "the plan is approved", ar: "AR" }, scope: "private" }] }] }],
  };
  const en = localize(profile, "en");
  assert.equal(en.text["nav.flow"], "Progress map");
  assert.equal(en.text.plain, "same in both");
  assert.equal(en.flowLabels.done, "AR only"); // falls back to the other language
  assert.equal(en.glossary[0].title, "Reviews");
  assert.equal(en.glossary[0].entries[0].terms[0].meaning, "the plan is approved");
  assert.equal(localize(profile, "ar").text["nav.flow"], "AR");
  assert.equal(localize(null, "en"), null);
});
