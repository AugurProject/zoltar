// Generated from docs/runtime TypeScript by bun run docs:build-runtime. Do not edit.
// docs/runtime/domHelpers.ts
function requiredElementFinder(owner) {
  return (root, selector, expected) => {
    const found = root.querySelector(selector);
    if (!(found instanceof expected))
      throw new Error(`Required ${owner} element ${selector} is missing or has the wrong type`);
    return found;
  };
}
async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {
    if (!(error instanceof DOMException) && !(error instanceof TypeError))
      throw error;
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

// docs/runtime/invariantExplorer.ts
var explorer = document.querySelector("#invariant-explorer");
if (!(explorer instanceof HTMLElement)) {
  throw new Error("Invariant explorer controls are missing");
}
var requiredElement = requiredElementFinder("invariant explorer");
var keywordInput = requiredElement(explorer, "[data-invariant-filter]", HTMLInputElement);
var typeSelect = requiredElement(explorer, "[data-invariant-type]", HTMLSelectElement);
var statusSelect = requiredElement(explorer, "[data-invariant-status]", HTMLSelectElement);
var subsystemSelect = requiredElement(explorer, "[data-invariant-subsystem]", HTMLSelectElement);
var count = requiredElement(explorer, "[data-invariant-count]", HTMLElement);
var empty = requiredElement(explorer, "[data-invariant-empty]", HTMLElement);
var expand = requiredElement(explorer, "[data-invariant-expand]", HTMLButtonElement);
var collapse = requiredElement(explorer, "[data-invariant-collapse]", HTMLButtonElement);
var reset = requiredElement(explorer, "[data-invariant-reset]", HTMLButtonElement);
var entries = Array.from(document.querySelectorAll("details.invariant-entry"));
var entrySections = new Set;
var catalogContextSections = Array.from(document.querySelectorAll("#standing, #invariant-index, section.callout"));
function normalizedText(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}
function metadataValue(entry, label) {
  for (const item of entry.querySelectorAll(".invariant-metadata > div")) {
    if (normalizedText(item.querySelector("dt")?.textContent ?? "") !== normalizedText(label))
      continue;
    return item.querySelector("dd")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }
  return "";
}
function incrementCount(counts, value) {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}
function permalink(entry) {
  const url = new URL(document.baseURI);
  url.search = "";
  url.hash = entry.id;
  return url.href;
}
function addEntryActions(entry) {
  const details = entry.querySelector(".invariant-details");
  if (!(details instanceof HTMLElement))
    return;
  const actions = document.createElement("div");
  actions.className = "invariant-entry-actions";
  const link = document.createElement("a");
  link.href = `#${entry.id}`;
  link.textContent = "Permalink";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy link";
  const status = document.createElement("span");
  status.className = "invariant-copy-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  copy.addEventListener("click", async () => {
    const copied = await copyText(permalink(entry));
    status.textContent = copied ? "Link copied." : "Copy failed.";
  });
  actions.append(link, copy, status);
  details.prepend(actions);
}
var typeCounts = new Map;
var statusCounts = new Map;
var subsystemCounts = new Map;
var subsystemLabels = new Map;
for (const entry of entries) {
  const identifier = entry.querySelector("summary code")?.textContent?.trim().toLowerCase();
  if (identifier === undefined || identifier.length === 0 || entry.id !== identifier) {
    throw new Error(`Invariant ${identifier ?? "without identifier"} needs a matching stable fragment id`);
  }
  const type = metadataValue(entry, "Type");
  const status = metadataValue(entry, "Enforcement status");
  const section = entry.closest("section");
  const subsystem = section?.id ?? "";
  const subsystemLabel = section?.querySelector(":scope > h2")?.textContent?.trim() ?? subsystem;
  entry.dataset["invariantType"] = type;
  entry.dataset["invariantStatus"] = status;
  entry.dataset["invariantSubsystem"] = subsystem;
  entry.dataset["invariantText"] = normalizedText(entry.textContent ?? "");
  if (section instanceof HTMLElement)
    entrySections.add(section);
  incrementCount(typeCounts, type);
  incrementCount(statusCounts, status);
  incrementCount(subsystemCounts, subsystem);
  subsystemLabels.set(subsystem, subsystemLabel);
  addEntryActions(entry);
}
function populateFacet(select, counts, labels = new Map) {
  for (const [value, facetCount] of Array.from(counts.entries()).sort(([left], [right]) => (labels.get(left) ?? left).localeCompare(labels.get(right) ?? right))) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${labels.get(value) ?? value} (${facetCount})`;
    select.append(option);
  }
}
populateFacet(typeSelect, typeCounts);
populateFacet(statusSelect, statusCounts);
populateFacet(subsystemSelect, subsystemCounts, subsystemLabels);
function keywordTokens() {
  return normalizedText(keywordInput.value).split(/[^a-z0-9_/-]+/).filter((token) => token.length > 0);
}
function matchesEntry(entry, tokens) {
  const matchesText = tokens.every((token) => (entry.dataset["invariantText"] ?? "").includes(token));
  const matchesType = typeSelect.value.length === 0 || entry.dataset["invariantType"] === typeSelect.value;
  const matchesStatus = statusSelect.value.length === 0 || entry.dataset["invariantStatus"] === statusSelect.value;
  const matchesSubsystem = subsystemSelect.value.length === 0 || entry.dataset["invariantSubsystem"] === subsystemSelect.value;
  return matchesText && matchesType && matchesStatus && matchesSubsystem;
}
function applyFilters() {
  const tokens = keywordTokens();
  const hasActiveFilter = tokens.length > 0 || typeSelect.value.length > 0 || statusSelect.value.length > 0 || subsystemSelect.value.length > 0;
  let visibleCount = 0;
  for (const entry of entries) {
    const isVisible = matchesEntry(entry, tokens);
    entry.hidden = !isVisible;
    if (isVisible)
      visibleCount += 1;
  }
  for (const section of entrySections) {
    section.hidden = !entries.some((entry) => entry.closest("section") === section && !entry.hidden);
  }
  for (const section of catalogContextSections)
    section.hidden = hasActiveFilter;
  count.textContent = `${visibleCount} of ${entries.length} invariants`;
  empty.hidden = visibleCount > 0;
}
keywordInput.addEventListener("input", applyFilters);
typeSelect.addEventListener("change", applyFilters);
statusSelect.addEventListener("change", applyFilters);
subsystemSelect.addEventListener("change", applyFilters);
expand.addEventListener("click", () => {
  for (const entry of entries) {
    if (!entry.hidden)
      entry.open = true;
  }
});
collapse.addEventListener("click", () => {
  for (const entry of entries)
    entry.open = false;
});
reset.addEventListener("click", () => {
  keywordInput.value = "";
  typeSelect.value = "";
  statusSelect.value = "";
  subsystemSelect.value = "";
  applyFilters();
  keywordInput.focus();
});
var targetId = window.location.hash.slice(1);
try {
  targetId = decodeURIComponent(targetId);
} catch (error) {
  if (!(error instanceof URIError))
    throw error;
}
var target = document.getElementById(targetId);
if (target instanceof HTMLDetailsElement && target.classList.contains("invariant-entry")) {
  const syncTargetScrollMargin = () => {
    if (getComputedStyle(explorer).position === "sticky") {
      target.style.scrollMarginTop = `${explorer.getBoundingClientRect().height + 16}px`;
      return;
    }
    target.style.removeProperty("scroll-margin-top");
  };
  syncTargetScrollMargin();
  window.addEventListener("resize", syncTargetScrollMargin);
  target.open = true;
  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "instant", block: "start" });
    requestAnimationFrame(() => {
      if (getComputedStyle(explorer).position !== "sticky")
        return;
      const overlap = explorer.getBoundingClientRect().bottom + 16 - target.getBoundingClientRect().top;
      if (overlap > 0)
        window.scrollBy({ behavior: "instant", top: -overlap });
    });
  });
}
window.addEventListener("hashchange", () => {
  const linked = entries.find((entry) => entry.id === window.location.hash.slice(1));
  if (linked === undefined)
    return;
  if (linked.hidden)
    reset.click();
  linked.open = true;
  linked.scrollIntoView({ behavior: "instant", block: "start" });
});
applyFilters();
