// Generated from docs/runtime TypeScript by bun run docs:build-runtime. Do not edit.
const planner = document.querySelector('#mmr-proof-planner');
if (!(planner instanceof HTMLDetailsElement)) {
    throw new Error('MMR proof planner is missing');
}
const plannerElement = planner;
function requiredElement(root, selector, expected) {
    const found = root.querySelector(selector);
    if (!(found instanceof expected))
        throw new Error(`Required MMR planner element ${selector} is missing or has the wrong type`);
    return found;
}
const leafCountInput = requiredElement(planner, '[data-tool-input="leafCount"]', HTMLInputElement);
const peakHeightSelect = requiredElement(planner, '[data-tool-input="peakHeight"]', HTMLSelectElement);
const leafIndexInput = requiredElement(planner, '[data-tool-input="leafIndex"]', HTMLInputElement);
function createInputError(input, id) {
    const error = document.createElement('span');
    error.className = 'number-control-error';
    error.id = id;
    error.hidden = true;
    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
    input.insertAdjacentElement('afterend', error);
    return error;
}
function updateInputError(input, error, message) {
    if (message === undefined) {
        input.removeAttribute('aria-invalid');
        error.hidden = true;
        error.textContent = '';
        return;
    }
    input.setAttribute('aria-invalid', 'true');
    error.textContent = message;
    error.hidden = false;
}
const leafCountError = createInputError(leafCountInput, 'mmr-leaf-count-error');
const leafIndexError = createInputError(leafIndexInput, 'mmr-leaf-index-error');
const peakChoices = document.createElement('span');
peakChoices.className = 'peak-choice-control';
peakChoices.setAttribute('role', 'group');
peakChoices.setAttribute('aria-label', 'Occupied peak height');
peakHeightSelect.classList.add('visually-hidden-control');
peakHeightSelect.tabIndex = -1;
peakHeightSelect.setAttribute('aria-hidden', 'true');
peakHeightSelect.insertAdjacentElement('afterend', peakChoices);
function writeOutput(name, value) {
    const output = plannerElement.querySelector(`[data-mmr-output="${name}"]`);
    if (output instanceof HTMLOutputElement)
        output.value = value;
}
function unsignedInteger(value) {
    const source = value.trim();
    if (!/^[0-9]+$/.test(source))
        return undefined;
    return BigInt(source);
}
function occupiedPeakHeights(leafCount) {
    const heights = [];
    let remaining = leafCount;
    let height = 0;
    while (remaining > 0n) {
        if ((remaining & 1n) === 1n)
            heights.push(height);
        remaining >>= 1n;
        height += 1;
    }
    return heights;
}
function updatePeakOptions(peaks) {
    const current = Number(peakHeightSelect.value);
    const selectedHeight = String(peaks.includes(current) ? current : peaks.at(-1));
    const buttons = Array.from(peakChoices.querySelectorAll('button'));
    const existingHeights = buttons.map(button => Number(button.dataset['peakHeight']));
    if (existingHeights.length === peaks.length && existingHeights.every((height, index) => height === peaks[index])) {
        peakHeightSelect.disabled = false;
        peakHeightSelect.value = selectedHeight;
        for (const button of buttons) {
            button.disabled = false;
            button.setAttribute('aria-pressed', String(button.dataset['peakHeight'] === selectedHeight));
        }
        return;
    }
    peakHeightSelect.disabled = false;
    peakHeightSelect.replaceChildren(...peaks.map(height => {
        const option = document.createElement('option');
        option.value = String(height);
        option.textContent = `Height ${height}`;
        return option;
    }));
    peakHeightSelect.value = selectedHeight;
    peakChoices.replaceChildren(...peaks.map(height => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `Height ${height}`;
        button.dataset['peakHeight'] = String(height);
        button.setAttribute('aria-pressed', String(peakHeightSelect.value === String(height)));
        button.addEventListener('click', () => {
            peakHeightSelect.value = String(height);
            peakHeightSelect.dispatchEvent(new Event('change', { bubbles: true }));
            plannerElement.dispatchEvent(new CustomEvent('docs:tool-input-change'));
        });
        return button;
    }));
}
function clearPeakOptions() {
    peakHeightSelect.disabled = true;
    for (const button of peakChoices.querySelectorAll('button'))
        button.disabled = true;
}
function updatePlanner() {
    const leafCount = unsignedInteger(leafCountInput.value);
    if (leafCount === undefined || leafCount < 1n || leafCount >= 1n << 64n) {
        updateInputError(leafCountInput, leafCountError, 'Enter an integer from 1 through 2⁶⁴ − 1.');
        updateInputError(leafIndexInput, leafIndexError);
        clearPeakOptions();
        for (const name of ['binary', 'peaks', 'capacity', 'mmrSiblings', 'selection']) {
            writeOutput(name, '—');
        }
        plannerElement.dataset['widgetState'] = 'unsafe';
        return;
    }
    updateInputError(leafCountInput, leafCountError);
    const peaks = occupiedPeakHeights(leafCount);
    updatePeakOptions(peaks);
    const peakHeight = Number(peakHeightSelect.value);
    const capacity = 1n << BigInt(peakHeight);
    const leafIndex = unsignedInteger(leafIndexInput.value);
    const validIndex = leafIndex !== undefined && leafIndex < capacity;
    updateInputError(leafIndexInput, leafIndexError, validIndex ? undefined : `Enter an index from 0 through ${capacity - 1n}.`);
    for (const button of peakChoices.querySelectorAll('button'))
        button.setAttribute('aria-pressed', String(button.dataset['peakHeight'] === peakHeightSelect.value));
    writeOutput('binary', `${leafCount.toString(2)}₂`);
    writeOutput('peaks', peaks.join(', '));
    writeOutput('capacity', `${capacity.toLocaleString()} ${capacity === 1n ? 'leaf' : 'leaves'}; local indexes 0…${(capacity - 1n).toLocaleString()}`);
    writeOutput('mmrSiblings', String(peakHeight + peaks.length - 1));
    writeOutput('nullifierSiblings', '64');
    writeOutput('selection', validIndex ? 'Valid peak-local index' : `Index must be between 0 and ${capacity - 1n}`);
    plannerElement.dataset['widgetState'] = validIndex ? 'safe' : 'unsafe';
}
leafCountInput.addEventListener('input', () => {
    updatePlanner();
});
peakHeightSelect.addEventListener('change', updatePlanner);
leafIndexInput.addEventListener('input', updatePlanner);
const initialLeafCount = unsignedInteger(leafCountInput.value);
if (initialLeafCount === undefined)
    throw new Error('MMR proof planner default leaf count is invalid');
updatePeakOptions(occupiedPeakHeights(initialLeafCount));
peakHeightSelect.value = '2';
updatePlanner();
