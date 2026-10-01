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

// docs/runtime/deploymentMaskDecoder.ts
var requiredElement = requiredElementFinder("deployment decoder");
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateManifest(manifest) {
  if (!isRecord(manifest) || !Array.isArray(manifest["deploymentSteps"]))
    throw new TypeError("Deployment manifest has no deploymentSteps array");
  const steps = [];
  for (const candidate of manifest["deploymentSteps"]) {
    if (!isRecord(candidate) || typeof candidate["id"] !== "string" || candidate["id"].length === 0 || typeof candidate["label"] !== "string" || candidate["label"].length === 0) {
      throw new TypeError("Deployment manifest step has an invalid id or label");
    }
    steps.push({ id: candidate["id"], label: candidate["label"] });
  }
  const stepIds = steps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length)
    throw new TypeError("Deployment manifest has duplicate step ids");
  if (stepIds.filter((id) => id === "deploymentStatusOracle").length !== 1)
    throw new TypeError("Deployment manifest must contain exactly one deploymentStatusOracle step");
  const tracked = steps.filter((step) => step.id !== "deploymentStatusOracle");
  if (tracked.length === 0 || tracked.length > 256)
    throw new TypeError("Deployment manifest must contain between 1 and 256 tracked steps");
  return tracked;
}
var decoder = requiredElement(document, "#deployment-mask-decoder", HTMLDetailsElement);
var networkSelect = requiredElement(decoder, "[data-deployment-mask-network]", HTMLSelectElement);
var maskInput = requiredElement(decoder, '[data-tool-input="deploymentMask"]', HTMLInputElement);
var maskSummary = requiredElement(decoder, "[data-deployment-mask-summary]", HTMLOutputElement);
var maskGuidance = requiredElement(decoder, "[data-deployment-mask-guidance]", HTMLElement);
var retryButton = requiredElement(decoder, "[data-deployment-mask-retry]", HTMLButtonElement);
var bitGrid = requiredElement(decoder, "[data-deployment-bit-grid]", HTMLElement);
var networks = {
  mainnet: { body: requiredElement(document, "#deployment-status-bit-mapping", HTMLTableSectionElement), label: "Ethereum mainnet", manifestUrl: "../mainnet-deployment-addresses.json", steps: undefined },
  sepolia: { body: requiredElement(document, "#sepolia-deployment-status-bit-mapping", HTMLTableSectionElement), label: "Sepolia", manifestUrl: "../sepolia-deployment-addresses.json", steps: undefined }
};
var networkIds = ["mainnet", "sepolia"];
var loading = false;
function selectedNetworkId() {
  return networkSelect.value === "sepolia" ? "sepolia" : "mainnet";
}
function setToolUnavailable(unavailable) {
  if (unavailable)
    decoder.dataset["toolUnavailable"] = "true";
  else
    delete decoder.dataset["toolUnavailable"];
  maskInput.disabled = unavailable;
  for (const button of bitGrid.querySelectorAll("button"))
    button.disabled = unavailable;
  decoder.dispatchEvent(new CustomEvent("docs:tool-availability"));
}
function renderMessageRow(body, message, linkUrl) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.append(message);
  if (linkUrl !== undefined) {
    cell.append(document.createElement("br"));
    const link = document.createElement("a");
    link.href = linkUrl;
    link.textContent = "Open the canonical manifest.";
    cell.append(link);
  }
  row.append(cell);
  body.replaceChildren(row);
}
function createStepRow(step, bit) {
  const row = document.createElement("tr");
  row.dataset["deploymentBit"] = String(bit);
  for (const [value, useCode] of [
    [String(bit), true],
    [step.id, true],
    [step.label, false]
  ]) {
    const cell = document.createElement("td");
    if (useCode) {
      const code = document.createElement("code");
      code.textContent = value;
      cell.append(code);
    } else
      cell.textContent = value;
    row.append(cell);
  }
  const statusCell = document.createElement("td");
  statusCell.dataset["deploymentBitStatus"] = String(bit);
  row.append(statusCell);
  return row;
}
function statusCells(body) {
  return Array.from(body.querySelectorAll("[data-deployment-bit-status]")).filter((cell) => cell instanceof HTMLTableCellElement);
}
function markOtherNetworksNotDecoded() {
  for (const networkId of networkIds) {
    if (networkId === selectedNetworkId())
      continue;
    for (const statusCell of statusCells(networks[networkId].body)) {
      statusCell.textContent = "Not decoded · other network selected";
      delete statusCell.dataset["maskState"];
    }
  }
}
function renderBitGrid(steps) {
  const buttons = steps.map((step, bit) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset["deploymentBitToggle"] = String(bit);
    button.textContent = String(bit);
    button.title = `${bit}: ${step.label}`;
    button.setAttribute("aria-label", `Toggle bit ${bit}, ${step.label}`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      const parsed = parseMask(maskInput.value);
      if (parsed === undefined)
        return;
      maskInput.value = `0x${(parsed ^ 1n << BigInt(bit)).toString(16)}`;
      updateDecoder();
      decoder.dispatchEvent(new CustomEvent("docs:tool-input-change"));
    });
    return button;
  });
  bitGrid.replaceChildren(...buttons);
}
async function loadNetwork(networkId) {
  const network = networks[networkId];
  network.body.setAttribute("aria-busy", "true");
  renderMessageRow(network.body, "Loading the canonical manifest…");
  try {
    const response = await fetch(network.manifestUrl);
    if (!response.ok)
      throw new TypeError(`Could not load deployment manifest: ${response.status}`);
    network.steps = validateManifest(await response.json());
    network.body.replaceChildren(...network.steps.map((step, bit) => createStepRow(step, bit)));
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof SyntaxError))
      throw error;
    network.steps = undefined;
    renderMessageRow(network.body, "Unable to load the deployment mapping. ", network.manifestUrl);
  } finally {
    network.body.setAttribute("aria-busy", "false");
  }
}
function parseMask(source) {
  const normalized = source.trim();
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(normalized))
    return;
  const mask = BigInt(normalized);
  return mask < 1n << 256n ? mask : undefined;
}
function markStatusesUnavailable(body) {
  for (const statusCell of statusCells(body)) {
    statusCell.textContent = "Unavailable · invalid mask";
    delete statusCell.dataset["maskState"];
  }
  for (const button of bitGrid.querySelectorAll("button"))
    button.removeAttribute("data-mask-state");
}
function updateDecoder() {
  const network = networks[selectedNetworkId()];
  const steps = network.steps;
  if (steps === undefined || maskInput.disabled)
    return;
  markOtherNetworksNotDecoded();
  const source = maskInput.value.trim();
  const mask = parseMask(source);
  if (mask === undefined) {
    maskInput.setAttribute("aria-invalid", "true");
    markStatusesUnavailable(network.body);
    const numeric = /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(source);
    maskSummary.value = numeric ? "The value is larger than a uint256." : "Enter a non-negative decimal or hexadecimal integer.";
    maskGuidance.textContent = numeric ? "Use a value between 0 and 2²⁵⁶ − 1." : "Examples: 5, 0x5, or 0xff.";
    decoder.dataset["widgetState"] = "unsafe";
    return;
  }
  maskInput.removeAttribute("aria-invalid");
  const deployedSteps = [];
  for (const [bit, step] of steps.entries()) {
    const isSet = (mask & 1n << BigInt(bit)) !== 0n;
    const statusCell = network.body.querySelector(`[data-deployment-bit-status="${bit}"]`);
    if (statusCell instanceof HTMLTableCellElement) {
      statusCell.textContent = isSet ? "Set · code present" : "Clear · no code";
      statusCell.dataset["maskState"] = isSet ? "set" : "clear";
    }
    const button = bitGrid.querySelector(`[data-deployment-bit-toggle="${bit}"]`);
    if (button !== null) {
      button.setAttribute("aria-pressed", String(isSet));
      button.dataset["maskState"] = isSet ? "set" : "clear";
    }
    if (isSet)
      deployedSteps.push(step.label);
  }
  const unknownBits = mask >> BigInt(steps.length);
  const scope = `${network.label}: `;
  maskSummary.value = deployedSteps.length === 0 ? `${scope}0 of ${steps.length} tracked steps have set bits.` : `${scope}${deployedSteps.length} of ${steps.length} tracked steps have set bits: ${deployedSteps.join(", ")}.`;
  maskGuidance.textContent = unknownBits === 0n ? "No bits are set above the tracked manifest range." : `Additional untracked high bits are set (shifted value ${unknownBits.toString(16).toUpperCase()} hex). Verify the constructor event before interpreting them.`;
  decoder.dataset["widgetState"] = unknownBits === 0n ? "safe" : "warning";
}
function applySelectedNetwork() {
  if (loading)
    return;
  const network = networks[selectedNetworkId()];
  maskInput.removeAttribute("aria-invalid");
  if (network.steps === undefined) {
    bitGrid.replaceChildren();
    setToolUnavailable(true);
    retryButton.hidden = false;
    retryButton.disabled = false;
    maskSummary.value = `The ${network.label} mapping is unavailable, so this mask cannot be decoded safely.`;
    maskGuidance.textContent = "Retry to restore bit decoding and high-bit reporting.";
    decoder.dataset["widgetState"] = "unsafe";
    return;
  }
  renderBitGrid(network.steps);
  retryButton.hidden = networkIds.every((networkId) => networks[networkId].steps !== undefined);
  retryButton.disabled = false;
  setToolUnavailable(false);
  updateDecoder();
}
async function loadMappings() {
  setToolUnavailable(true);
  retryButton.hidden = true;
  retryButton.disabled = true;
  maskInput.removeAttribute("aria-invalid");
  maskSummary.value = "Loading the canonical mapping…";
  maskGuidance.textContent = "Decoder controls will be available when the mapping loads.";
  loading = true;
  try {
    await Promise.all(networkIds.map((networkId) => loadNetwork(networkId)));
  } finally {
    loading = false;
  }
  applySelectedNetwork();
}
networkSelect.addEventListener("change", applySelectedNetwork);
maskInput.addEventListener("input", updateDecoder);
retryButton.addEventListener("click", () => {
  if (!loading)
    loadMappings();
});
var deploymentMaskDecoderReady = loadMappings();
