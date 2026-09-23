"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const checker = require("../src/2ww-logic.js");

function evaluate(overrides = {}) {
  return checker.evaluateReferral({
    age: 50,
    symptoms: [],
    smokingStatus: "never",
    anatomy: {},
    fitValue: "",
    ca125Value: "",
    psaValue: "",
    ...overrides
  });
}

function includes(result, text) {
  return result.outcomes.some((outcome) => `${outcome.title} ${outcome.detail}`.includes(text));
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("rejects whitespace, decimal and negative ages", () => {
  assert.equal(evaluate({ age: " " }).valid, false);
  assert.equal(evaluate({ age: "54.9" }).valid, false);
  assert.equal(evaluate({ age: "-1" }).valid, false);
});

test("offers FIT rather than direct referral for qualifying colorectal symptoms", () => {
  const result = evaluate({ age: 40, symptoms: ["weight_loss", "abdominal_pain"] });
  assert.equal(includes(result, "Offer quantitative FIT"), true);
  assert.equal(includes(result, "Refer using a suspected cancer pathway"), false);
});

test("refers at FIT 10 and safety-nets below 10", () => {
  assert.equal(includes(evaluate({ fitValue: "10" }), "Colorectal cancer Refer"), true);
  const low = evaluate({ age: 60, fitValue: "9.9", symptoms: ["change_in_bowel_habit"] });
  assert.equal(includes(low, "FIT is below 10"), true);
});

test("keeps mass exceptions outside mandatory FIT", () => {
  assert.equal(includes(evaluate({ symptoms: ["rectal_mass"] }), "FIT is not required"), true);
  assert.equal(includes(evaluate({ symptoms: ["anal_mass"] }), "FIT is not required"), true);
});

test("implements previously unreachable breast, haematemesis and mesothelioma findings", () => {
  assert.equal(includes(evaluate({ age: 50, symptoms: ["concerning_breast_changes"] }), "Breast cancer Refer"), true);
  assert.equal(includes(evaluate({ symptoms: ["haematemesis"] }), "non-urgent direct-access"), true);
  assert.equal(includes(evaluate({ symptoms: ["chest_xray_suggesting_mesothelioma"] }), "Mesothelioma Refer"), true);
});

test("counts unexplained shortness of breath in the lung symptom pair", () => {
  const result = evaluate({ age: 40, symptoms: ["shortness_of_breath", "cough"] });
  assert.equal(includes(result, "urgent direct-access chest X-ray"), true);
});

test("implements the 2026 ovarian age and CA125 pathways", () => {
  const symptoms = ["ovarian_persistent_distension"];
  assert.equal(includes(evaluate({ age: 39, symptoms, anatomy: { femaleReproductiveOrgans: true } }), "Do not use CA125 alone"), true);
  assert.equal(includes(evaluate({ age: 40, symptoms, anatomy: { femaleReproductiveOrgans: true } }), "Measure serum CA125"), true);
  assert.equal(includes(evaluate({ age: 60, symptoms, ca125Value: "24", anatomy: { femaleReproductiveOrgans: true } }), "Arrange an urgent direct-access ultrasound"), true);
  assert.equal(includes(evaluate({ age: 60, symptoms, ca125Value: "23", anatomy: { femaleReproductiveOrgans: true } }), "below the age-specific threshold"), true);
});

test("does not trigger endometrial ultrasound for unqualified discharge", () => {
  const anatomy = { femaleReproductiveOrgans: true };
  assert.equal(includes(evaluate({ age: 55, anatomy, symptoms: ["unexplained_vaginal_discharge"] }), "Endometrial cancer"), false);
  assert.equal(includes(evaluate({ age: 55, anatomy, symptoms: ["unexplained_vaginal_discharge_first_presentation"] }), "Endometrial cancer"), true);
});

test("uses relevant anatomy rather than gender", () => {
  const symptom = ["malignant_feeling_prostate"];
  assert.equal(includes(evaluate({ symptoms: symptom, anatomy: {} }), "Prostate cancer"), false);
  assert.equal(includes(evaluate({ symptoms: symptom, anatomy: { prostate: true } }), "Prostate cancer"), true);
});

test("uses age-specific PSA thresholds only with possible prostate symptoms", () => {
  const input = { age: 50, psaValue: "3.6", anatomy: { prostate: true }, symptoms: ["lower_urinary_tract_symptoms"] };
  assert.equal(includes(evaluate(input), "Consider a suspected cancer pathway referral"), true);
  assert.equal(includes(evaluate({ ...input, psaValue: "3.5" }), "Consider a suspected cancer pathway referral"), false);
});

test("includes the amended 2025 myeloma work-up", () => {
  const result = evaluate({ age: 60, symptoms: ["persistent_back_pain"] });
  assert.equal(includes(result, "serum protein electrophoresis and serum free light chains"), true);
});

test("covers skin, CNS, sarcoma and childhood cancer recommendations", () => {
  assert.equal(includes(evaluate({ symptoms: ["dermoscopy_suggesting_melanoma"] }), "Melanoma Refer"), true);
  assert.equal(includes(evaluate({ age: 30, symptoms: ["progressive_subacute_loss_central_neurological_function"] }), "brain MRI"), true);
  assert.equal(includes(evaluate({ age: 30, symptoms: ["unexplained_lump_increasing_in_size"] }), "Soft tissue sarcoma"), true);
  assert.equal(includes(evaluate({ age: 5, symptoms: ["absent_fundal_red_reflex"] }), "Retinoblastoma"), true);
});

test("uses a safety-net message instead of a definitive negative", () => {
  const result = evaluate({ symptoms: ["back_pain"] });
  assert.equal(includes(result, "does not exclude cancer"), true);
  assert.equal(includes(evaluate({ age: 17, fitValue: "12" }), "does not exclude cancer"), true);
});

test("selector data and rule-engine symptom keys stay in sync", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve("../src/2ww.js"), "utf8"), context);
  const source = fs.readFileSync(require.resolve("../src/2ww-logic.js"), "utf8");
  const referenced = [...source.matchAll(/"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"/g)].map((match) => match[1]);
  const missingData = [...new Set(referenced)].filter((key) => !(key in context.data));
  const missingRules = Object.keys(context.data).filter((key) => !source.includes(`"${key}"`));
  assert.deepEqual(missingData, []);
  assert.deepEqual(missingRules, []);
});

console.log("All cancer referral checker tests passed.");
