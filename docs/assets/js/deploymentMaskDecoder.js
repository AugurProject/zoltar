// Generated from docs/runtime TypeScript by bun run docs:build-runtime. Do not edit.
function requiredElement(root, selector, expected) {
    const found = root.querySelector(selector);
    if (!(found instanceof expected))
        throw new Error(`Required deployment decoder element ${selector} is missing or has the wrong type`);
    return found;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validateManifest(manifest) {
    if (!isRecord(manifest) || !Array.isArray(manifest['deploymentSteps']))
        throw new TypeError('Deployment manifest has no deploymentSteps array');
    const steps = [];
    for (const candidate of manifest['deploymentSteps']) {
        if (!isRecord(candidate) || typeof candidate['id'] !== 'string' || candidate['id'].length === 0 || typeof candidate['label'] !== 'string' || candidate['label'].length === 0) {
            throw new TypeError('Deployment manifest step has an invalid id or label');
        }
        steps.push({ id: candidate['id'], label: candidate['label'] });
    }
    const stepIds = steps.map(step => step.id);
    if (new Set(stepIds).size !== stepIds.length)
        throw new TypeError('Deployment manifest has duplicate step ids');
    if (stepIds.filter(id => id === 'deploymentStatusOracle').length !== 1)
        throw new TypeError('Deployment manifest must contain exactly one deploymentStatusOracle step');
    const tracked = steps.filter(step => step.id !== 'deploymentStatusOracle');
    if (tracked.length === 0 || tracked.length > 256)
        throw new TypeError('Deployment manifest must contain between 1 and 256 tracked steps');
    return tracked;
}
const mappingBody = requiredElement(document, '#deployment-status-bit-mapping', HTMLTableSectionElement);
const sepoliaMappingBody = requiredElement(document, '#sepolia-deployment-status-bit-mapping', HTMLTableSectionElement);
const decoder = requiredElement(document, '#deployment-mask-decoder', HTMLDetailsElement);
const maskInput = requiredElement(decoder, '[data-tool-input="deploymentMask"]', HTMLInputElement);
const maskSummary = requiredElement(decoder, '[data-deployment-mask-summary]', HTMLOutputElement);
const maskGuidance = requiredElement(decoder, '[data-deployment-mask-guidance]', HTMLElement);
const retryButton = requiredElement(decoder, '[data-deployment-mask-retry]', HTMLButtonElement);
const bitGrid = requiredElement(decoder, '[data-deployment-bit-grid]', HTMLElement);
const manifestUrl = '../mainnet-deployment-addresses.json';
const sepoliaManifestUrl = '../sepolia-deployment-addresses.json';
let trackedSteps = [];
function setToolUnavailable(unavailable) {
    if (unavailable)
        decoder.dataset['toolUnavailable'] = 'true';
    else
        delete decoder.dataset['toolUnavailable'];
    maskInput.disabled = unavailable;
    for (const button of bitGrid.querySelectorAll('button'))
        button.disabled = unavailable;
    decoder.dispatchEvent(new CustomEvent('docs:tool-availability'));
}
function renderMessageRow(body, message, linkUrl) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = body === mappingBody ? 4 : 3;
    cell.append(message);
    if (linkUrl !== undefined) {
        cell.append(document.createElement('br'));
        const link = document.createElement('a');
        link.href = linkUrl;
        link.textContent = 'Open the canonical manifest.';
        cell.append(link);
    }
    row.append(cell);
    body.replaceChildren(row);
}
function renderMappingRows() {
    const rows = trackedSteps.map((step, bit) => {
        const row = document.createElement('tr');
        row.dataset['deploymentBit'] = String(bit);
        for (const [value, useCode] of [
            [String(bit), true],
            [step.id, true],
            [step.label, false],
        ]) {
            const cell = document.createElement('td');
            if (useCode) {
                const code = document.createElement('code');
                code.textContent = value;
                cell.append(code);
            }
            else
                cell.textContent = value;
            row.append(cell);
        }
        const statusCell = document.createElement('td');
        statusCell.dataset['deploymentBitStatus'] = String(bit);
        statusCell.textContent = 'Clear';
        row.append(statusCell);
        return row;
    });
    mappingBody.replaceChildren(...rows);
}
function renderBitGrid() {
    const buttons = trackedSteps.map((step, bit) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset['deploymentBitToggle'] = String(bit);
        button.textContent = String(bit);
        button.title = `${bit}: ${step.label}`;
        button.setAttribute('aria-label', `Toggle bit ${bit}, ${step.label}`);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
            const parsed = parseMask(maskInput.value);
            if (parsed === undefined)
                return;
            maskInput.value = `0x${(parsed ^ (1n << BigInt(bit))).toString(16)}`;
            updateDecoder();
            decoder.dispatchEvent(new CustomEvent('docs:tool-input-change'));
        });
        return button;
    });
    bitGrid.replaceChildren(...buttons);
}
async function loadSepoliaMapping() {
    sepoliaMappingBody.setAttribute('aria-busy', 'true');
    renderMessageRow(sepoliaMappingBody, 'Loading the canonical manifest…');
    try {
        const response = await fetch(sepoliaManifestUrl);
        if (!response.ok)
            throw new TypeError(`Could not load deployment manifest: ${response.status}`);
        const steps = validateManifest(await response.json());
        const rows = steps.map((step, bit) => {
            const row = document.createElement('tr');
            for (const [value, useCode] of [
                [String(bit), true],
                [step.id, true],
                [step.label, false],
            ]) {
                const cell = document.createElement('td');
                if (useCode) {
                    const code = document.createElement('code');
                    code.textContent = value;
                    cell.append(code);
                }
                else
                    cell.textContent = value;
                row.append(cell);
            }
            return row;
        });
        sepoliaMappingBody.replaceChildren(...rows);
    }
    catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof SyntaxError))
            throw error;
        renderMessageRow(sepoliaMappingBody, 'Unable to load the deployment mapping. ', sepoliaManifestUrl);
    }
    finally {
        sepoliaMappingBody.setAttribute('aria-busy', 'false');
    }
}
function parseMask(source) {
    const normalized = source.trim();
    if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(normalized))
        return undefined;
    const mask = BigInt(normalized);
    return mask < 1n << 256n ? mask : undefined;
}
function markStatusesUnavailable() {
    for (const statusCell of mappingBody.querySelectorAll('[data-deployment-bit-status]')) {
        if (!(statusCell instanceof HTMLTableCellElement))
            continue;
        statusCell.textContent = 'Unavailable · invalid mask';
        delete statusCell.dataset['maskState'];
    }
    for (const button of bitGrid.querySelectorAll('button'))
        button.removeAttribute('data-mask-state');
}
function updateDecoder() {
    if (trackedSteps.length === 0 || maskInput.disabled)
        return;
    const source = maskInput.value.trim();
    const mask = parseMask(source);
    if (mask === undefined) {
        maskInput.setAttribute('aria-invalid', 'true');
        markStatusesUnavailable();
        const numeric = /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(source);
        maskSummary.value = numeric ? 'The value is larger than a uint256.' : 'Enter a non-negative decimal or hexadecimal integer.';
        maskGuidance.textContent = numeric ? 'Use a value between 0 and 2²⁵⁶ − 1.' : 'Examples: 5, 0x5, or 0xff.';
        decoder.dataset['widgetState'] = 'unsafe';
        return;
    }
    maskInput.removeAttribute('aria-invalid');
    const deployedSteps = [];
    for (const [bit, step] of trackedSteps.entries()) {
        const isSet = (mask & (1n << BigInt(bit))) !== 0n;
        const statusCell = mappingBody.querySelector(`[data-deployment-bit-status="${bit}"]`);
        if (statusCell instanceof HTMLTableCellElement) {
            statusCell.textContent = isSet ? 'Set · code present' : 'Clear · no code';
            statusCell.dataset['maskState'] = isSet ? 'set' : 'clear';
        }
        const button = bitGrid.querySelector(`[data-deployment-bit-toggle="${bit}"]`);
        if (button !== null) {
            button.setAttribute('aria-pressed', String(isSet));
            button.dataset['maskState'] = isSet ? 'set' : 'clear';
        }
        if (isSet)
            deployedSteps.push(step.label);
    }
    const unknownBits = mask >> BigInt(trackedSteps.length);
    maskSummary.value = deployedSteps.length === 0 ? `0 of ${trackedSteps.length} tracked steps have set bits.` : `${deployedSteps.length} of ${trackedSteps.length} tracked steps have set bits: ${deployedSteps.join(', ')}.`;
    maskGuidance.textContent = unknownBits === 0n ? 'No bits are set above the tracked manifest range.' : `Additional untracked high bits are set (shifted value ${unknownBits.toString(16).toUpperCase()} hex). Verify the constructor event before interpreting them.`;
    decoder.dataset['widgetState'] = unknownBits === 0n ? 'safe' : 'warning';
}
async function loadMapping() {
    mappingBody.setAttribute('aria-busy', 'true');
    renderMessageRow(mappingBody, 'Loading the canonical manifest…');
    setToolUnavailable(true);
    retryButton.hidden = true;
    retryButton.disabled = true;
    maskInput.removeAttribute('aria-invalid');
    maskSummary.value = 'Loading the canonical mapping…';
    maskGuidance.textContent = 'Decoder controls will be available when the mapping loads.';
    try {
        const response = await fetch(manifestUrl);
        if (!response.ok)
            throw new TypeError(`Could not load deployment manifest: ${response.status}`);
        trackedSteps = validateManifest(await response.json());
        renderMappingRows();
        renderBitGrid();
        setToolUnavailable(false);
        retryButton.disabled = false;
        updateDecoder();
    }
    catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof SyntaxError))
            throw error;
        trackedSteps = [];
        bitGrid.replaceChildren();
        renderMessageRow(mappingBody, 'Unable to load the deployment mapping. ', manifestUrl);
        setToolUnavailable(true);
        retryButton.hidden = false;
        retryButton.disabled = false;
        maskSummary.value = 'The canonical mapping is unavailable, so this mask cannot be decoded safely.';
        maskGuidance.textContent = 'Retry to restore bit decoding and high-bit reporting.';
        decoder.dataset['widgetState'] = 'unsafe';
    }
    finally {
        mappingBody.setAttribute('aria-busy', 'false');
    }
}
maskInput.addEventListener('input', updateDecoder);
retryButton.addEventListener('click', () => void loadMapping());
const deploymentMaskDecoderReady = Promise.all([loadMapping(), loadSepoliaMapping()]);
void deploymentMaskDecoderReady;
