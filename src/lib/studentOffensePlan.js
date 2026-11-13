export const INTERVENTION_PLAN_FIELDS = [
  { key: "objective", label: "Objective", placeholder: "What should this plan achieve?" },
  { key: "strategy", label: "Intervention strategy", placeholder: "What action or support will be provided?" },
  { key: "timeFrame", label: "Time frame", placeholder: "When or for how long?" },
  { key: "personsInvolved", label: "Persons involved", placeholder: "Who will carry out or participate?" },
  { key: "resourcesNeeded", label: "Resources needed", placeholder: "What materials or support are needed?" },
  { key: "expectedOutcome", label: "Expected outcome", placeholder: "What change or result is expected?" },
];

export function createEmptyPlanItem() {
  return INTERVENTION_PLAN_FIELDS.reduce((item, field) => ({ ...item, [field.key]: "" }), {});
}

export function parseInterventionPlan(value) {
  const fieldByLabel = new Map(INTERVENTION_PLAN_FIELDS.map((field) => [field.label.toLowerCase(), field.key]));
  const items = [];
  let currentItem = null;
  let activeField = "";
  let hasStructuredFields = false;

  String(value || "").split(/\r?\n/).forEach((line) => {
    const text = line.trim();
    if (!text || text === "Learner Rights and Protection Intervention Plan") return;

    if (/^Plan item(?:\s+\d+)?$/i.test(text)) {
      currentItem = createEmptyPlanItem();
      items.push(currentItem);
      activeField = "";
      return;
    }

    const separator = text.indexOf(":");
    const label = separator === -1 ? "" : text.slice(0, separator).trim().toLowerCase();
    const fieldKey = fieldByLabel.get(label);
    if (fieldKey) {
      if (!currentItem) {
        currentItem = createEmptyPlanItem();
        items.push(currentItem);
      }
      currentItem[fieldKey] = text.slice(separator + 1).trim();
      activeField = fieldKey;
      hasStructuredFields = true;
      return;
    }

    if (currentItem && activeField) {
      currentItem[activeField] = [currentItem[activeField], text].filter(Boolean).join("\n");
    }
  });

  return hasStructuredFields ? items : [];
}
