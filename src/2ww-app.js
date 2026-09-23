(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var symptomData = window.data || data;
    var engine = window.CancerReferralChecker;
    var modal = document.getElementById("float-container");
    var selectorForm = document.getElementById("float-form");
    var closeButton = document.getElementById("close-button-float");
    var openButton = document.getElementById("show-modal-button");
    var selectedList = document.getElementById("selected-symptoms-list");
    var resultElement = document.getElementById("referral-result");
    var referralForm = document.getElementById("referral-form");
    var categoryContainers = new Map();
    var lastFocusedElement = null;

    function categoryId(category) {
      return "category-" + category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }

    function createSymptomCheckbox(key, text, listed) {
      var label = document.createElement("label");
      label.className = "checkbox-container";
      label.appendChild(document.createTextNode(text));

      var input = document.createElement("input");
      input.type = "checkbox";
      input.className = listed ? "symptoms listed" : "symptoms";
      input.name = key;
      input.value = key;
      input.checked = Boolean(listed);
      label.appendChild(input);

      var mark = document.createElement("span");
      mark.className = "checkmark";
      mark.setAttribute("aria-hidden", "true");
      label.appendChild(mark);
      return label;
    }

    Object.keys(symptomData).forEach(function (key) {
      var item = symptomData[key];
      item.categories.forEach(function (category) {
        if (!categoryContainers.has(category)) {
          var section = document.createElement("section");
          section.className = "collapsible-section";

          var button = document.createElement("button");
          button.type = "button";
          button.className = "collapsible-section-button";
          button.textContent = category;
          button.setAttribute("aria-expanded", "false");
          button.setAttribute("aria-controls", categoryId(category));
          section.appendChild(button);

          var content = document.createElement("div");
          content.className = "collapsible-content";
          content.id = categoryId(category);
          section.appendChild(content);
          selectorForm.appendChild(section);
          categoryContainers.set(category, content);

          button.addEventListener("click", function () {
            var expanded = button.getAttribute("aria-expanded") === "true";
            button.setAttribute("aria-expanded", String(!expanded));
            content.style.display = expanded ? "none" : "flex";
            if (!expanded) { button.scrollIntoView({ block: "nearest" }); }
          });
        }
        categoryContainers.get(category).appendChild(createSymptomCheckbox(key, item.text, false));
      });
    });

    function selectedSymptoms() {
      var selected = [];
      document.querySelectorAll(".symptoms:not(.listed):checked").forEach(function (input) {
        if (selected.indexOf(input.name) === -1) { selected.push(input.name); }
      });
      return selected;
    }

    function setSymptomChecked(name, checked) {
      document.querySelectorAll(".symptoms").forEach(function (input) {
        if (input.name === name) { input.checked = checked; }
      });
    }

    function refreshSelectedList(symptoms) {
      selectedList.replaceChildren();
      if (!symptoms.length) {
        var empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No symptoms or findings selected.";
        selectedList.appendChild(empty);
        return;
      }
      symptoms.forEach(function (key) {
        selectedList.appendChild(createSymptomCheckbox(key, symptomData[key].text, true));
      });
    }

    function valueOf(id) {
      return document.getElementById(id).value;
    }

    function getContext(symptoms) {
      var smoking = document.querySelector('input[name="smoking"]:checked');
      var biologicalSex = document.querySelector('input[name="biological-sex"]:checked');
      var isMale = biologicalSex && biologicalSex.value === "male";
      var isFemale = biologicalSex && biologicalSex.value === "female";
      return {
        age: valueOf("age"),
        fitValue: valueOf("fit-value"),
        ca125Value: valueOf("ca125-value"),
        psaValue: valueOf("psa-value"),
        smokingStatus: smoking ? smoking.value : "never",
        anatomy: {
          prostate: Boolean(isMale),
          testes: Boolean(isMale),
          penis: Boolean(isMale),
          femaleReproductiveOrgans: Boolean(isFemale)
        },
        symptoms: symptoms
      };
    }

    function renderResult(result) {
      resultElement.replaceChildren();
      resultElement.classList.remove("refer", "input-error", "safety-result");

      if (!result.valid) {
        resultElement.textContent = result.errors.join(" ");
        resultElement.classList.add("input-error");
        return;
      }
      if (result.empty) {
        resultElement.textContent = "Select symptoms, signs or investigation findings.";
        return;
      }

      var list = document.createElement("ul");
      list.className = "result-list";
      result.outcomes.forEach(function (outcome) {
        var item = document.createElement("li");
        var heading = document.createElement("strong");
        heading.textContent = outcome.title + ": ";
        item.appendChild(heading);
        item.appendChild(document.createTextNode(outcome.detail + " "));
        var reference = document.createElement("small");
        reference.textContent = "(" + outcome.reference + ")";
        item.appendChild(reference);
        list.appendChild(item);
      });
      resultElement.appendChild(list);
      if (result.outcomes.some(function (outcome) { return outcome.level !== "safety-net" && outcome.level !== "assessment"; })) {
        resultElement.classList.add("refer");
      } else {
        resultElement.classList.add("safety-result");
      }
    }

    function update() {
      var symptoms = selectedSymptoms();
      refreshSelectedList(symptoms);
      renderResult(engine.evaluateReferral(getContext(symptoms)));
    }

    document.addEventListener("input", function (event) {
      var target = event.target;
      if (target.classList.contains("symptoms")) {
        if (!target.checked) {
          setSymptomChecked(target.name, false);
        } else {
          setSymptomChecked(target.name, true);
        }
      }
      update();
    });

    referralForm.addEventListener("submit", function (event) { event.preventDefault(); });
    selectorForm.addEventListener("submit", function (event) { event.preventDefault(); });

    function openModal() {
      lastFocusedElement = document.activeElement;
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";
      var firstCategory = selectorForm.querySelector(".collapsible-section-button");
      (firstCategory || closeButton).focus();
    }

    function closeModal() {
      modal.style.display = "none";
      document.body.style.overflow = "";
      if (lastFocusedElement) { lastFocusedElement.focus(); }
    }

    openButton.addEventListener("click", openModal);
    closeButton.addEventListener("click", closeModal);
    modal.addEventListener("click", function (event) {
      if (event.target === modal) { closeModal(); }
    });
    document.addEventListener("keydown", function (event) {
      if (modal.style.display !== "flex") { return; }
      if (event.key === "Escape") {
        closeModal();
        return;
      }
      if (event.key === "Tab") {
        var focusable = Array.from(selectorForm.querySelectorAll("button, input:not([disabled])"));
        if (!focusable.length) { return; }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    update();
  });
}());
