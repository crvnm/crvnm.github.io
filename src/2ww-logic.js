(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.CancerReferralChecker = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var GUIDANCE_VERSION = "NICE NG12, updated 15 April 2026";

  function optionalNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return null;
    }
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function ca125Threshold(age) {
    if (age < 40) { return null; }
    if (age <= 49) { return 35; }
    if (age <= 59) { return 31; }
    if (age <= 69) { return 24; }
    if (age <= 79) { return 25; }
    return 31;
  }

  function psaThreshold(age) {
    if (age < 40 || age > 79) { return null; }
    if (age <= 49) { return 2.5; }
    if (age <= 59) { return 3.5; }
    if (age <= 69) { return 4.5; }
    return 6.5;
  }

  function evaluateReferral(input) {
    input = input || {};
    var age = optionalNumber(input.age);
    var fit = optionalNumber(input.fitValue);
    var ca125 = optionalNumber(input.ca125Value);
    var psa = optionalNumber(input.psaValue);
    var symptoms = new Set(Array.isArray(input.symptoms) ? input.symptoms : []);
    var anatomy = input.anatomy || {};
    var smokingStatus = input.smokingStatus || "never";
    var outcomes = [];
    var errors = [];
    var seen = new Set();

    if (age === null) {
      errors.push("Enter the patient's age.");
    } else if (!Number.isInteger(age) || age < 0 || age > 120) {
      errors.push("Age must be a whole number from 0 to 120 years.");
    }
    [[fit, "FIT"], [ca125, "CA125"], [psa, "PSA"]].forEach(function (entry) {
      if (Number.isNaN(entry[0]) || (entry[0] !== null && entry[0] < 0)) {
        errors.push(entry[1] + " must be a valid non-negative number or left blank.");
      }
    });
    if (errors.length) {
      return { valid: false, errors: errors, outcomes: [], guidanceVersion: GUIDANCE_VERSION };
    }

    function has(name) { return symptoms.has(name); }
    function hasAny(names) { return names.some(has); }
    function count(names) { return names.reduce(function (total, name) { return total + (has(name) ? 1 : 0); }, 0); }
    function add(level, title, detail, reference) {
      var key = [level, title, detail].join("|");
      if (!seen.has(key)) {
        seen.add(key);
        outcomes.push({ level: level, title: title, detail: detail, reference: reference });
      }
    }

    var adult = age >= 18;
    var child = age < 16;
    var childOrYoungPerson = age <= 24;
    var everSmoked = smokingStatus === "current" || smokingStatus === "former";
    var weightLoss = hasAny(["weight_loss", "weight_loss_over_5_percent_6_months"]);
    var visibleHaematuria = hasAny(["visible_haematuria", "visible_haematuria_no_uti", "visible_haematuria_recurring_after_uti_treatment"]);

    // 1.1 Lung and pleural cancers
    var lungSymptoms = ["cough", "persistent_fatigue", "shortness_of_breath", "chest_pain", "weight_loss", "appetite_loss"];
    var lungSymptomCount = count(lungSymptoms) + (has("weight_loss_over_5_percent_6_months") && !has("weight_loss") ? 1 : 0);
    if (has("chest_xray_suggesting_lung_cancer") || (age >= 40 && has("unexplained_haemoptysis"))) {
      add("refer", "Lung cancer", "Refer using a suspected cancer pathway.", "NG12 1.1.1");
    }
    if (has("chest_xray_suggesting_mesothelioma")) {
      add("refer", "Mesothelioma", "Refer using a suspected cancer pathway.", "NG12 1.1.4");
    }
    if (age >= 40 && (lungSymptomCount >= 2 || (everSmoked && lungSymptomCount >= 1))) {
      add("urgent-test", "Lung and pleural cancer", "Offer an urgent direct-access chest X-ray.", "NG12 1.1.2 and 1.1.5");
    } else if (age >= 40 && has("asbestos_exposure") && lungSymptomCount >= 1) {
      add("urgent-test", "Mesothelioma", "Offer an urgent direct-access chest X-ray.", "NG12 1.1.5");
    }
    if (age >= 40 && hasAny(["persistent_or_recurrent_chest_infection", "finger_clubbing", "supraclavicular_lymphadenopathy", "persistent_cervical_lymphadenopathy", "chest_signs_consistent_with_lung_cancer", "thrombocytosis"])) {
      add("consider-test", "Lung cancer", "Consider an urgent direct-access chest X-ray.", "NG12 1.1.3");
    }
    if (age >= 40 && hasAny(["finger_clubbing", "chest_signs_pleural_disease"])) {
      add("consider-test", "Mesothelioma", "Consider an urgent direct-access chest X-ray.", "NG12 1.1.6");
    }

    // 1.2 Upper gastrointestinal tract cancers
    if (has("dysphagia") || (age >= 55 && weightLoss && hasAny(["upper_abdominal_pain", "reflux", "dyspepsia", "treatment_resistant_dyspepsia"]))) {
      add("refer", "Oesophageal or stomach cancer", "Refer using a suspected cancer pathway.", "NG12 1.2.1 and 1.2.7");
    }
    if (has("upper_abdominal_mass_consistent_with_stomach_cancer")) {
      add("consider-referral", "Stomach cancer", "Consider a suspected cancer pathway referral.", "NG12 1.2.6");
    }
    if (has("haematemesis")) {
      add("non-urgent-test", "Oesophageal or stomach cancer", "Consider non-urgent direct-access upper gastrointestinal endoscopy.", "NG12 1.2.2 and 1.2.8");
    }
    if (age >= 55 && (
      has("treatment_resistant_dyspepsia") ||
      (has("upper_abdominal_pain") && has("low_haemoglobin")) ||
      (has("thrombocytosis") && hasAny(["nausea_or_vomiting", "weight_loss", "weight_loss_over_5_percent_6_months", "reflux", "dyspepsia", "upper_abdominal_pain"])) ||
      (has("nausea_or_vomiting") && hasAny(["weight_loss", "weight_loss_over_5_percent_6_months", "reflux", "dyspepsia", "upper_abdominal_pain"]))
    )) {
      add("non-urgent-test", "Oesophageal or stomach cancer", "Consider non-urgent direct-access upper gastrointestinal endoscopy.", "NG12 1.2.3 and 1.2.9");
    }
    if (age >= 40 && has("jaundice")) {
      add("refer", "Pancreatic cancer", "Refer using a suspected cancer pathway.", "NG12 1.2.4");
    }
    if (age >= 60 && weightLoss && hasAny(["diarrhoea", "back_pain", "abdominal_pain", "upper_abdominal_pain", "nausea_or_vomiting", "constipation", "new_onset_diabetes"])) {
      add("consider-test", "Pancreatic cancer", "Consider an urgent direct-access CT scan, or urgent ultrasound if CT is unavailable.", "NG12 1.2.5");
    }
    if (has("upper_abdominal_mass_enlarged_gallbladder")) {
      add("consider-test", "Gall bladder cancer", "Consider an urgent direct-access ultrasound scan.", "NG12 1.2.10");
    }
    if (has("upper_abdominal_mass_enlarged_liver")) {
      add("consider-test", "Liver cancer", "Consider an urgent direct-access ultrasound scan.", "NG12 1.2.11");
    }

    // 1.3 Lower gastrointestinal tract cancers
    var fitIndicated = adult && (
      has("abdominal_mass") || has("change_in_bowel_habit") || has("iron_deficiency_anaemia") ||
      (age >= 40 && weightLoss && has("abdominal_pain")) ||
      (age < 50 && has("rectal_bleeding") && hasAny(["abdominal_pain", "weight_loss", "weight_loss_over_5_percent_6_months"])) ||
      (age >= 50 && hasAny(["rectal_bleeding", "abdominal_pain", "weight_loss", "weight_loss_over_5_percent_6_months"])) ||
      (age >= 60 && has("non_iron_deficiency_anaemia"))
    );
    if (adult && fit !== null && fit >= 10) {
      add("refer", "Colorectal cancer", "Refer using a suspected cancer pathway (FIT at least 10 micrograms Hb/g faeces).", "NG12 1.3.2");
    } else if (fitIndicated && fit === null) {
      add("test", "Colorectal cancer", "Offer quantitative FIT using HM-JACKarc or OC-Sensor to guide referral.", "NG12 1.3.1");
    } else if (fitIndicated && fit < 10) {
      add("safety-net", "Colorectal cancer", "FIT is below 10: safety net. Do not delay an appropriate secondary-care referral if strong clinical concern persists.", "NG12 1.3.3");
    }
    if (has("rectal_mass")) {
      add("consider-referral", "Colorectal cancer", "Consider a suspected cancer pathway referral; FIT is not required before referral is considered.", "NG12 1.3.5");
    }
    if (hasAny(["anal_mass", "anal_ulceration"])) {
      add("consider-referral", "Anal cancer", "Consider a suspected cancer pathway referral; FIT is not required before referral is considered.", "NG12 1.3.6");
    }

    // 1.4 Breast cancer
    if ((age >= 30 && has("unexplained_breast_lump")) || (age >= 50 && hasAny(["unilateral_nipple_discharge", "unilateral_nipple_retraction", "concerning_breast_changes"]))) {
      add("refer", "Breast cancer", "Refer using a suspected cancer pathway.", "NG12 1.4.1");
    }
    if (has("skin_changes_suggesting_breast_cancer") || (age >= 30 && has("unexplained_lump_axilla"))) {
      add("consider-referral", "Breast cancer", "Consider a suspected cancer pathway referral.", "NG12 1.4.2");
    }
    if (age < 30 && has("unexplained_breast_lump")) {
      add("non-urgent-referral", "Breast symptoms", "Consider non-urgent breast referral.", "NG12 1.4.3");
    }

    // 1.5 Gynaecological cancers — apply according to relevant organs, not recorded sex or gender.
    var ovarianSymptoms = hasAny(["ovarian_persistent_distension", "ovarian_persistent_early_satiety", "ovarian_persistent_pelvic_or_abdominal_pain", "ovarian_persistent_urinary_urgency_or_frequency"]);
    if (anatomy.femaleReproductiveOrgans) {
      if (hasAny(["ascites", "abdominal_or_pelvic_mass_not_fibroids"])) {
        add("refer", "Ovarian cancer", "Refer to a gynaecological cancer service using a suspected cancer pathway.", "NG12 1.5.1");
      }
      if (ovarianSymptoms || (age >= 50 && has("IBS_symptoms"))) {
        if (age <= 39) {
          add("consider-test", "Ovarian cancer", "Do not use CA125 alone; consider an urgent direct-access ultrasound scan of the abdomen and pelvis.", "NG12 1.5.6");
        } else if (ca125 === null) {
          add("test", "Ovarian cancer", "Measure serum CA125 in primary care.", "NG12 1.5.8");
        } else if (ca125 >= ca125Threshold(age)) {
          add("urgent-test", "Ovarian cancer", "Arrange an urgent direct-access ultrasound scan of the abdomen and pelvis (age-specific CA125 threshold met).", "NG12 1.5.9");
        } else {
          add("safety-net", "Ovarian cancer", "CA125 is below the age-specific threshold: investigate other causes and advise review if symptoms become more frequent or persistent.", "NG12 1.5.11");
        }
      }
      if (has("ultrasound_suggesting_ovarian_cancer")) {
        add("refer", "Ovarian cancer", "Refer to a gynaecological cancer service using a suspected cancer pathway.", "NG12 1.5.10");
      }
      if (age >= 55 && has("post_menopausal_bleeding_not_attributable_to_hrt")) {
        add("refer", "Endometrial cancer", "Refer using a suspected cancer pathway.", "NG12 1.5.12");
      } else if (age < 55 && has("post_menopausal_bleeding_not_attributable_to_hrt")) {
        add("consider-referral", "Endometrial cancer", "Consider a suspected cancer pathway referral.", "NG12 1.5.14");
      }
      if (age >= 55 && (
        has("unexplained_vaginal_discharge_first_presentation") ||
        (has("unexplained_vaginal_discharge") && (has("thrombocytosis") || visibleHaematuria)) ||
        (visibleHaematuria && hasAny(["low_haemoglobin", "thrombocytosis", "high_blood_glucose"]))
      )) {
        add("consider-test", "Endometrial cancer", "Consider an urgent direct-access ultrasound scan.", "NG12 1.5.13");
      }
      if (has("cervix_consistent_with_cancer")) {
        add("consider-referral", "Cervical cancer", "Consider a suspected cancer pathway referral.", "NG12 1.5.16");
      }
      if (hasAny(["unexplained_vulval_lump", "unexplained_vulval_ulceration", "unexplained_vulval_bleeding"])) {
        add("consider-referral", "Vulval cancer", "Consider a suspected cancer pathway referral.", "NG12 1.5.17");
      }
      if (has("unexplained_vaginal_mass")) {
        add("consider-referral", "Vaginal cancer", "Consider a suspected cancer pathway referral.", "NG12 1.5.18");
      }
    }

    // 1.6 Urological cancers
    if (anatomy.prostate) {
      if (has("malignant_feeling_prostate")) {
        add("refer", "Prostate cancer", "Refer using a suspected cancer pathway.", "NG12 1.6.1");
      }
      var prostateSymptoms = hasAny(["lower_urinary_tract_symptoms", "erectile_dysfunction"]) || visibleHaematuria;
      if (prostateSymptoms) {
        add("consider-test", "Prostate cancer", "Consider a PSA test and digital rectal examination.", "NG12 1.6.2");
        if (psa !== null) {
          var threshold = psaThreshold(age);
          if (threshold === null) {
            add("assessment", "Prostate cancer", "Use clinical judgement for PSA referral thresholds below age 40 or above age 79.", "NG12 1.6.3 table 2");
          } else if (psa > threshold) {
            add("consider-referral", "Prostate cancer", "Consider a suspected cancer pathway referral, taking preferences and comorbidities into account.", "NG12 1.6.3");
          }
        }
      }
    }
    if ((age >= 45 && hasAny(["visible_haematuria_no_uti", "visible_haematuria_recurring_after_uti_treatment"])) || (age >= 60 && has("unexplained_non_visible_haematuria") && hasAny(["dysuria", "raised_white_cell_count"]))) {
      add("refer", "Bladder and renal cancer", "Refer using a suspected cancer pathway.", "NG12 1.6.4 and 1.6.6");
    }
    if (age >= 60 && has("recurrent_or_persistent_unexplained_uti")) {
      add("non-urgent-referral", "Bladder cancer", "Consider non-urgent referral.", "NG12 1.6.5");
    }
    if (anatomy.testes) {
      if (hasAny(["non_painful_enlargement_testis", "change_shape_or_texture_testis"])) {
        add("consider-referral", "Testicular cancer", "Consider a suspected cancer pathway referral.", "NG12 1.6.7");
      }
      if (has("unexplained_or_persistent_testicular_symptoms")) {
        add("consider-test", "Testicular cancer", "Consider an urgent direct-access ultrasound scan.", "NG12 1.6.8");
      }
    }
    if (anatomy.penis) {
      if (hasAny(["penile_mass_or_ulcerated_lesion", "persistent_penile_lesion_after_sti_treatment", "unexplained_or_persistent_symptoms_of_foreskin_or_glans"])) {
        add("consider-referral", "Penile cancer", "Consider a suspected cancer pathway referral.", "NG12 1.6.9 and 1.6.10");
      }
    }

    // 1.7 Skin cancers
    if (hasAny(["pigmented_lesion_7_point_score_3_or_more", "dermoscopy_suggesting_melanoma"])) {
      add("refer", "Melanoma", "Refer using a suspected cancer pathway.", "NG12 1.7.1 and 1.7.2");
    }
    if (has("lesion_suggesting_nodular_melanoma")) {
      add("consider-referral", "Nodular melanoma", "Consider a suspected cancer pathway referral.", "NG12 1.7.3");
    }
    if (has("lesion_suspicious_for_squamous_cell_carcinoma")) {
      add("consider-referral", "Squamous cell carcinoma", "Consider a suspected cancer pathway referral.", "NG12 1.7.4");
    }
    if (has("lesion_suspicious_for_basal_cell_carcinoma")) {
      add("non-urgent-referral", "Basal cell carcinoma", "Consider non-urgent referral; use a suspected cancer pathway only if delay may have a significant impact.", "NG12 1.7.5 and 1.7.6");
    }

    // 1.8 Head and neck cancers
    if (age >= 45 && hasAny(["persistent_unexplained_hoarseness", "unexplained_neck_lump"])) {
      add("consider-referral", "Laryngeal cancer", "Consider a suspected cancer pathway referral.", "NG12 1.8.1");
    }
    if (hasAny(["unexplained_oral_ulcer", "persistent_unexplained_neck_lump"])) {
      add("consider-referral", "Oral cancer", "Consider a suspected cancer pathway referral.", "NG12 1.8.2");
    }
    if (hasAny(["lump_lip_oral_cavity", "red_or_red_white_oral_patch"])) {
      add("urgent-referral", "Oral cancer", "Consider urgent dental assessment; if the finding is consistent with oral cancer, the dentist should consider a suspected cancer pathway referral.", "NG12 1.8.3 and 1.8.4");
    }
    if (has("unexplained_thyroid_lump")) {
      add("consider-referral", "Thyroid cancer", "Consider a suspected cancer pathway referral.", "NG12 1.8.5");
    }

    // 1.9 Brain and central nervous system cancers
    if (adult && has("progressive_subacute_loss_central_neurological_function")) {
      add("consider-test", "Brain or central nervous system cancer", "Consider an urgent direct-access brain MRI, or CT if MRI is contraindicated.", "NG12 1.9.1");
    }
    if (childOrYoungPerson && has("new_abnormal_cerebellar_or_central_neurological_function")) {
      add("very-urgent", "Brain or central nervous system cancer", "Consider very urgent specialist referral for an appointment within 48 hours.", "NG12 1.9.2");
    }

    // 1.10 Haematological cancers
    var leukaemiaSymptoms = ["pallor", "persistent_fatigue", "unexplained_fever", "unexplained_persistent_or_recurrent_infection", "generalised_lymphadenopathy", "unexplained_bruising", "unexplained_bleeding"];
    if (childOrYoungPerson && hasAny(["unexplained_petechiae", "hepatosplenomegaly"])) {
      add("immediate", "Leukaemia", "Refer for immediate specialist assessment.", "NG12 1.10.2");
    } else if (childOrYoungPerson && (hasAny(leukaemiaSymptoms) || has("persistent_unexplained_bone_pain"))) {
      add("very-urgent", "Leukaemia", "Offer a very urgent full blood count within 48 hours.", "NG12 1.10.3");
    }
    if (!childOrYoungPerson && (hasAny(leukaemiaSymptoms) || hasAny(["unexplained_petechiae", "hepatosplenomegaly"]))) {
      add("very-urgent", "Leukaemia", "Consider a very urgent full blood count within 48 hours.", "NG12 1.10.1");
    }
    var myelomaPresentation = age >= 60 && hasAny(["persistent_unexplained_bone_pain", "persistent_back_pain", "unexplained_fracture"]);
    if (myelomaPresentation) {
      add("test", "Myeloma", "Offer FBC, calcium, plasma viscosity or ESR, serum protein electrophoresis and serum free light chains; use urine Bence-Jones only if serum free-light-chain testing is unavailable.", "NG12 1.10.4");
      if (has("myeloma_blood_tests_suggestive")) {
        add("refer", "Myeloma", "Refer using a suspected cancer pathway.", "NG12 1.10.5");
      }
    }
    if (hasAny(["unexplained_lymphadenopathy", "splenomegaly"])) {
      if (childOrYoungPerson) {
        add("very-urgent", "Lymphoma", "Consider very urgent specialist referral for an appointment within 48 hours; take associated symptoms into account.", "NG12 1.10.7 and 1.10.9");
      } else {
        add("consider-referral", "Lymphoma", "Consider a suspected cancer pathway referral; take associated symptoms into account.", "NG12 1.10.6 and 1.10.8");
      }
    }

    // 1.11 Sarcomas
    if (has("xray_suggesting_bone_sarcoma")) {
      if (childOrYoungPerson) {
        add("very-urgent", "Bone sarcoma", "Consider very urgent specialist referral for an appointment within 48 hours.", "NG12 1.11.2");
      } else {
        add("consider-referral", "Bone sarcoma", "Consider a suspected cancer pathway referral.", "NG12 1.11.1");
      }
    }
    if (childOrYoungPerson && has("unexplained_bone_swelling_or_pain")) {
      add("very-urgent", "Bone sarcoma", "Consider a very urgent direct-access X-ray.", "NG12 1.11.3");
    }
    if (has("unexplained_lump_increasing_in_size")) {
      if (childOrYoungPerson) {
        add("very-urgent", "Soft tissue sarcoma", "Consider a very urgent direct-access ultrasound scan.", "NG12 1.11.6");
      } else {
        add("consider-test", "Soft tissue sarcoma", "Consider an urgent direct-access ultrasound scan.", "NG12 1.11.4");
      }
    }
    if (has("ultrasound_suggesting_or_uncertain_soft_tissue_sarcoma")) {
      if (childOrYoungPerson) {
        add("very-urgent", "Soft tissue sarcoma", "Consider very urgent specialist referral for an appointment within 48 hours.", "NG12 1.11.7");
      } else {
        add("consider-referral", "Soft tissue sarcoma", "Consider a suspected cancer pathway referral.", "NG12 1.11.5");
      }
    }

    // 1.12 Childhood cancers
    if (child && has("child_palpable_abdominal_mass_or_enlarged_organ")) {
      add("very-urgent", "Neuroblastoma or Wilms' tumour", "Consider very urgent specialist referral for an appointment within 48 hours.", "NG12 1.12.1 and 1.12.3");
    }
    if (child && has("absent_fundal_red_reflex")) {
      add("consider-referral", "Retinoblastoma", "Consider ophthalmological assessment using a suspected cancer pathway referral.", "NG12 1.12.2");
    }
    if (child && has("child_unexplained_visible_haematuria")) {
      add("very-urgent", "Wilms' tumour", "Consider very urgent specialist referral for an appointment within 48 hours.", "NG12 1.12.3");
    }
    if (child && has("persistent_parent_or_carer_concern")) {
      add("assessment", "Childhood cancer", "Consider referral, taking the parent or carer's persistent concern and knowledge into account.", "NG12 1.13.1");
    }

    // 1.13 Non-site-specific symptoms
    if (age >= 60 && has("weight_loss_over_5_percent_6_months")) {
      add("urgent-assessment", "Non-site-specific cancer symptoms", "Assess for additional features and offer urgent investigation, a suspected cancer pathway referral or a non-specific symptoms pathway.", "NG12 1.13.2");
    }
    if (adult && has("appetite_loss")) {
      add("urgent-assessment", "Non-site-specific cancer symptoms", "Assess for additional features and offer urgent investigation, a suspected cancer pathway referral or a non-specific symptoms pathway.", "NG12 1.13.3");
    }
    if (adult && has("deep_vein_thrombosis")) {
      add("consider-assessment", "Non-site-specific cancer symptoms", "Assess for additional features and consider urgent investigation, a suspected cancer pathway referral or a non-specific symptoms pathway.", "NG12 1.13.4");
    }

    if (!outcomes.length && (symptoms.size || fit !== null || ca125 !== null || psa !== null)) {
      add("safety-net", "No coded NG12 action identified", "This does not exclude cancer. Use clinical judgement, consider specialist advice and arrange review if symptoms persist, recur or worsen.", "NG12 1.15.2 and 1.16.2");
    }

    return {
      valid: true,
      errors: [],
      outcomes: outcomes,
      guidanceVersion: GUIDANCE_VERSION,
      empty: symptoms.size === 0 && fit === null && ca125 === null && psa === null
    };
  }

  return {
    GUIDANCE_VERSION: GUIDANCE_VERSION,
    ca125Threshold: ca125Threshold,
    psaThreshold: psaThreshold,
    evaluateReferral: evaluateReferral
  };
}));
