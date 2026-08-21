// Generated from docs/runtime TypeScript by bun run docs:build-runtime. Do not edit.
const presetDefinitions = {
    'simple-auction-example': [
        {
            label: 'Weak demand',
            values: { aliceEth: '3', bobEth: '4', carolEth: '6', ethRaiseCap: '24', repInventory: '8' },
        },
        {
            label: 'No qualifying bids',
            values: { aliceEth: '3', bobEth: '4', carolEth: '6', ethRaiseCap: '30', repInventory: '4' },
        },
    ],
    'collateral-repair-example': [
        {
            label: 'Fully repaired',
            values: { auctionRaised: '2.5', forkSettlementCollateralReceived: '47.5', parentSettlementCollateral: '50' },
        },
        {
            label: 'Residual shortfall',
            values: { auctionRaised: '5', forkSettlementCollateralReceived: '35', parentSettlementCollateral: '50' },
        },
    ],
    'escalation-game-example': [
        {
            label: 'Leader deposit does not extend',
            values: { days: '7', invalid: '1', no: '1', yes: '4' },
        },
        {
            label: 'Median increases',
            values: { days: '7', invalid: '1', no: '4', yes: '4' },
        },
        {
            label: 'After the deadline',
            values: { days: '56', invalid: '1', no: '4', yes: '4' },
        },
    ],
    'initial-report-estimator-example': [
        {
            label: 'High gas cost',
            values: { blockBaseFeeGwei: '200', gasUnitsForOneDispute: '1000000', initialReportPriorityFeeGwei: '100', openOracleSecurityMultiplier: '20' },
        },
        {
            label: 'Caller raises report',
            values: { openInterestWeth: '100', requestedInitialWeth: '25' },
        },
    ],
    'binary-censorship-example': [
        {
            label: 'Executable manipulation',
            values: { censorshipDuration: '24', honestPrice: '100', liquidationThresholdPrice: '101', manipulatedPrice: '113' },
        },
        {
            label: 'Below execution guard',
            values: { censorshipDuration: '24', honestPrice: '100', liquidationThresholdPrice: '101', manipulatedPrice: '108' },
        },
        {
            label: 'Long censorship',
            values: { censorshipDuration: '168', externalPayoff: '1000', oracleReportLiquidity: '4000' },
        },
    ],
    'liquidation-health-example': [
        {
            label: 'Healthy vault',
            values: { coverageCommitment: '75', multiplier: '2', price: '5', rep: '1000' },
        },
        {
            label: 'Liquidatable vault',
            values: { coverageCommitment: '75', multiplier: '2', price: '10', rep: '1000' },
        },
        {
            label: 'Severe shortfall',
            values: { coverageCommitment: '150', multiplier: '3', price: '15', rep: '500' },
        },
    ],
    'liquidation-path-example': [
        {
            label: 'Two small requests',
            values: { first: '10', second: '15' },
        },
        {
            label: 'Two large requests',
            values: { first: '60', second: '60' },
        },
    ],
    'deployment-mask-decoder': [
        {
            label: 'First and third set',
            values: { deploymentMask: '0x5' },
        },
        {
            label: 'First eight set',
            values: { deploymentMask: '0xff' },
        },
        {
            label: 'Includes unknown high bit',
            values: { deploymentMask: '0x10005' },
        },
    ],
    'mmr-proof-planner': [
        {
            label: '13 leaves, height 2',
            values: { leafCount: '13', leafIndex: '3', peakHeight: '2' },
        },
        {
            label: 'Perfect peak of 8',
            values: { leafCount: '8', leafIndex: '7', peakHeight: '3' },
        },
        {
            label: '21 leaves, height 4',
            values: { leafCount: '21', leafIndex: '15', peakHeight: '4' },
        },
    ],
};
const toolInputSelector = '[data-example-input], [data-liquidation-input], [data-path-input], [data-tool-input]';
let numberControlId = 0;
function inputKey(input) {
    return input.dataset['exampleInput'] ?? input.dataset['liquidationInput'] ?? input.dataset['pathInput'] ?? input.dataset['toolInput'];
}
function toolInputs(tool) {
    return Array.from(tool.querySelectorAll(toolInputSelector)).filter((input) => input instanceof HTMLInputElement || input instanceof HTMLSelectElement);
}
function dispatchInput(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}
function applyValues(tool, values) {
    let valid = true;
    for (const input of toolInputs(tool)) {
        const key = inputKey(input);
        const value = key === undefined ? undefined : values[key];
        if (value === undefined)
            continue;
        if (input instanceof HTMLSelectElement && !Array.from(input.options).some(option => !option.disabled && option.value === value)) {
            valid = false;
            continue;
        }
        input.value = String(value);
        dispatchInput(input);
        if (input instanceof HTMLInputElement && input.getAttribute('aria-invalid') === 'true')
            valid = false;
    }
    return valid;
}
function resetTool(tool) {
    for (const input of toolInputs(tool)) {
        input.value = input.dataset['toolDefaultValue'] ?? '';
        dispatchInput(input);
    }
}
function toolState(tool) {
    return Object.fromEntries(toolInputs(tool)
        .map((input) => {
        const key = inputKey(input);
        return key === undefined ? undefined : [key, input.value];
    })
        .filter(entry => entry !== undefined));
}
function scenarioUrl(tool) {
    const url = new URL(document.baseURI);
    url.searchParams.set('tool', tool.id);
    url.searchParams.set('state', JSON.stringify(toolState(tool)));
    url.hash = tool.id;
    return url.href;
}
function toolIsUnavailable(tool) {
    return tool.dataset['toolUnavailable'] === 'true';
}
async function copyText(value) {
    try {
        await navigator.clipboard.writeText(value);
        return true;
    }
    catch (error) {
        if (!(error instanceof DOMException) && !(error instanceof TypeError))
            throw error;
        const input = document.createElement('textarea');
        input.value = value;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        return copied;
    }
}
function createToolbar(tool) {
    const toolbar = document.createElement('div');
    toolbar.className = 'interactive-tool-toolbar';
    toolbar.setAttribute('aria-label', 'Calculator scenarios and sharing');
    const presets = presetDefinitions[tool.id] ?? [];
    const scenarioLabel = document.createElement('label');
    scenarioLabel.className = 'interactive-tool-preset-select';
    const scenarioText = document.createElement('span');
    scenarioText.textContent = 'Scenario';
    const scenarioSelect = document.createElement('select');
    scenarioSelect.tabIndex = -1;
    scenarioSelect.setAttribute('aria-hidden', 'true');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a preset';
    scenarioSelect.append(placeholder);
    const presetButtons = document.createElement('div');
    presetButtons.className = 'interactive-tool-presets';
    presetButtons.setAttribute('aria-label', 'Scenarios');
    for (const [index, preset] of presets.entries()) {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = preset.label;
        scenarioSelect.append(option);
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset['presetIndex'] = String(index);
        button.textContent = preset.label;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
            if (button.disabled)
                return;
            scenarioSelect.value = String(index);
            scenarioSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
        presetButtons.append(button);
    }
    scenarioSelect.disabled = presets.length === 0;
    scenarioLabel.append(scenarioText, scenarioSelect);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy scenario link';
    const status = document.createElement('span');
    status.className = 'interactive-tool-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    let applyingPreset = false;
    const clearPresetSelection = () => {
        scenarioSelect.value = '';
        for (const button of presetButtons.querySelectorAll('button'))
            button.setAttribute('aria-pressed', 'false');
    };
    const handleToolChange = () => {
        if (applyingPreset)
            return;
        clearPresetSelection();
        if (status.dataset['validationError'] !== 'true')
            status.replaceChildren();
    };
    tool.addEventListener('input', handleToolChange);
    tool.addEventListener('docs:tool-input-change', handleToolChange);
    scenarioSelect.addEventListener('change', () => {
        if (scenarioSelect.disabled) {
            scenarioSelect.value = '';
            return;
        }
        if (scenarioSelect.value.length === 0)
            return;
        const preset = presets[Number(scenarioSelect.value)];
        if (preset === undefined)
            return;
        applyingPreset = true;
        try {
            resetTool(tool);
            applyValues(tool, preset.values);
        }
        finally {
            applyingPreset = false;
        }
        for (const button of presetButtons.querySelectorAll('button'))
            button.setAttribute('aria-pressed', String(button.dataset['presetIndex'] === scenarioSelect.value));
        status.textContent = '';
    });
    reset.addEventListener('click', () => {
        if (reset.disabled)
            return;
        resetTool(tool);
        clearPresetSelection();
        status.textContent = '';
    });
    copy.addEventListener('click', async () => {
        const url = scenarioUrl(tool);
        const copied = await copyText(url);
        if (copied) {
            status.textContent = 'Scenario link copied.';
            return;
        }
        const recoveryLink = document.createElement('a');
        recoveryLink.href = url;
        recoveryLink.textContent = 'Open scenario link';
        status.replaceChildren('Copy failed. ', recoveryLink);
        recoveryLink.focus();
    });
    const syncAvailability = () => {
        const unavailable = toolIsUnavailable(tool);
        scenarioSelect.disabled = unavailable || presets.length === 0;
        for (const button of presetButtons.querySelectorAll('button'))
            button.disabled = unavailable;
        for (const button of tool.querySelectorAll('.segmented-control button'))
            button.disabled = unavailable;
        for (const input of tool.querySelectorAll('.number-control input[type="number"]')) {
            const wrapper = input.closest('.number-control');
            if (wrapper !== null)
                updateNumberControl(input, wrapper);
        }
        reset.disabled = unavailable;
        if (unavailable) {
            scenarioSelect.value = '';
            status.textContent = '';
        }
    };
    tool.addEventListener('docs:tool-availability', () => {
        syncAvailability();
        applyLinkedScenario();
    });
    syncAvailability();
    const actions = document.createElement('div');
    actions.className = 'interactive-tool-actions';
    actions.append(reset, copy);
    toolbar.append(scenarioLabel, presetButtons, actions, status);
    return toolbar;
}
function inputName(input) {
    const storedName = input.dataset['controlLabel'];
    if (storedName !== undefined && storedName.length > 0)
        return storedName;
    const explicitName = input.getAttribute('aria-label')?.trim();
    if (explicitName !== undefined && explicitName.length > 0)
        return explicitName;
    const label = input.closest('label');
    if (label !== null) {
        const precedingText = [];
        for (const node of label.childNodes) {
            if (node === input)
                break;
            const text = node.textContent?.trim();
            if (text !== undefined && text.length > 0)
                precedingText.push(text);
        }
        if (precedingText.length > 0)
            return precedingText.join(' ');
    }
    return inputKey(input) ?? 'value';
}
function decimalPlaces(value) {
    return value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
}
function updateNumberControl(input, wrapper) {
    const value = Number(input.value);
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    const hasBounds = Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum;
    const progress = hasBounds && Number.isFinite(value) ? ((value - minimum) / (maximum - minimum)) * 100 : 0;
    wrapper.style.setProperty('--control-progress', `${Math.min(100, Math.max(0, progress))}%`);
    const invalid = input.getAttribute('aria-invalid') === 'true' || !input.validity.valid;
    wrapper.classList.toggle('is-invalid', invalid);
    const unavailable = input.closest('details.interactive-example, details.interactive-tool')?.dataset['toolUnavailable'] === 'true';
    const decrement = wrapper.querySelector('[data-step-direction="decrement"]');
    const increment = wrapper.querySelector('[data-step-direction="increment"]');
    if (decrement !== null)
        decrement.disabled = unavailable || invalid || !Number.isFinite(value) || (Number.isFinite(minimum) && value <= minimum);
    if (increment !== null)
        increment.disabled = unavailable || invalid || !Number.isFinite(value) || (Number.isFinite(maximum) && value >= maximum);
}
function numberControlError(input) {
    const value = Number(input.value);
    if (input.value.trim().length === 0 || !Number.isFinite(value))
        return 'Enter a number.';
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    if (Number.isFinite(minimum) && value < minimum)
        return `Enter a value of at least ${input.min}.`;
    if (Number.isFinite(maximum) && value > maximum)
        return `Enter a value of at most ${input.max}.`;
    const step = Number(input.step);
    if (Number.isFinite(step) && step > 0) {
        const base = Number.isFinite(minimum) ? minimum : 0;
        const stepOffset = (value - base) / step;
        if (Math.abs(stepOffset - Math.round(stepOffset)) > 1e-9)
            return `Enter a value in steps of ${input.step}.`;
    }
    return undefined;
}
function validateNumberControl(input, wrapper) {
    const error = numberControlError(input);
    input.setCustomValidity(error ?? '');
    if (error === undefined)
        input.removeAttribute('aria-invalid');
    else
        input.setAttribute('aria-invalid', 'true');
    const inlineErrorId = input.dataset['controlErrorId'];
    const inlineError = inlineErrorId === undefined ? null : document.getElementById(inlineErrorId);
    if (inlineError instanceof HTMLElement) {
        inlineError.textContent = error ?? '';
        inlineError.hidden = error === undefined;
    }
    const valueChip = input.closest('label')?.querySelector('.example-value');
    if (valueChip !== undefined && valueChip !== null)
        valueChip.hidden = error !== undefined;
    updateNumberControl(input, wrapper);
    const tool = input.closest('details.interactive-example, details.interactive-tool');
    tool?.dispatchEvent(new CustomEvent('docs:tool-input-change'));
    const status = tool?.querySelector('.interactive-tool-status');
    const firstInvalidInput = tool?.querySelector('input[aria-invalid="true"]');
    if (status !== undefined && status !== null) {
        if (firstInvalidInput !== undefined && firstInvalidInput !== null) {
            status.dataset['validationError'] = 'true';
            status.textContent = `${inputName(firstInvalidInput)}: ${numberControlError(firstInvalidInput) ?? 'Enter a valid value.'}`;
        }
        else if (status.dataset['validationError'] === 'true') {
            delete status.dataset['validationError'];
            status.textContent = '';
        }
    }
    if (tool !== null) {
        const outputRegion = tool.querySelector('.example-output-grid, .example-output, [data-tool-output-region]');
        const existingCue = tool.querySelector('.interactive-tool-results-cue');
        if (firstInvalidInput !== undefined && firstInvalidInput !== null) {
            tool.dataset['inputsValid'] = 'false';
            tool.dataset['widgetState'] = 'unsafe';
            if (existingCue === null && outputRegion instanceof HTMLElement) {
                const cue = document.createElement('p');
                cue.className = 'interactive-tool-results-cue';
                cue.setAttribute('role', 'status');
                cue.textContent = 'Results show the last valid values.';
                outputRegion.insertAdjacentElement('beforebegin', cue);
            }
        }
        else {
            delete tool.dataset['inputsValid'];
            existingCue?.remove();
        }
    }
    return firstInvalidInput === null;
}
function stepNumberInput(input, direction) {
    const current = Number(input.value);
    const step = Number(input.step);
    const increment = Number.isFinite(step) && step > 0 ? step : 1;
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    let next = (Number.isFinite(current) ? current : 0) + increment * direction;
    if (Number.isFinite(minimum))
        next = Math.max(minimum, next);
    if (Number.isFinite(maximum))
        next = Math.min(maximum, next);
    input.value = next.toFixed(decimalPlaces(input.step)).replace(/\.0+$/, '');
    dispatchInput(input);
}
function enhanceNumberInput(input) {
    if (input.type !== 'number' || input.parentElement?.classList.contains('number-control'))
        return;
    const wrapper = document.createElement('span');
    wrapper.className = 'number-control';
    const accessibleName = inputName(input);
    input.dataset['controlLabel'] = accessibleName;
    const inlineError = document.createElement('span');
    inlineError.className = 'number-control-error';
    inlineError.id = `number-control-error-${++numberControlId}`;
    inlineError.hidden = true;
    input.dataset['controlErrorId'] = inlineError.id;
    const describedBy = input.getAttribute('aria-describedby')?.trim();
    input.setAttribute('aria-describedby', describedBy === undefined || describedBy.length === 0 ? inlineError.id : `${describedBy} ${inlineError.id}`);
    const decrement = document.createElement('button');
    decrement.type = 'button';
    decrement.className = 'number-control-step';
    decrement.dataset['stepDirection'] = 'decrement';
    decrement.textContent = '−';
    decrement.setAttribute('aria-label', `Decrease ${accessibleName}`);
    const increment = document.createElement('button');
    increment.type = 'button';
    increment.className = 'number-control-step';
    increment.dataset['stepDirection'] = 'increment';
    increment.textContent = '+';
    increment.setAttribute('aria-label', `Increase ${accessibleName}`);
    input.before(wrapper);
    wrapper.append(decrement, input, increment);
    wrapper.insertAdjacentElement('afterend', inlineError);
    decrement.addEventListener('click', () => stepNumberInput(input, -1));
    increment.addEventListener('click', () => stepNumberInput(input, 1));
    input.addEventListener('input', event => {
        if (!validateNumberControl(input, wrapper))
            event.stopImmediatePropagation();
    }, { capture: true });
    validateNumberControl(input, wrapper);
}
function enhanceSegmentedSelect(select) {
    if (select.dataset['exampleInput'] !== 'depositOutcome')
        return;
    const group = document.createElement('span');
    group.className = 'segmented-control';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Deposit outcome');
    const update = () => {
        for (const button of group.querySelectorAll('button'))
            button.setAttribute('aria-pressed', String(button.dataset['value'] === select.value));
    };
    for (const option of select.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset['value'] = option.value;
        button.textContent = option.textContent;
        button.addEventListener('click', () => {
            select.value = option.value;
            dispatchInput(select);
        });
        group.append(button);
    }
    select.classList.add('visually-hidden-control');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.insertAdjacentElement('afterend', group);
    select.addEventListener('change', update);
    update();
}
function makeOutputsLive(tool) {
    const outputRegion = tool.querySelector('.example-output-grid, .example-output, [data-tool-output-region]');
    if (!(outputRegion instanceof HTMLElement))
        return;
    outputRegion.setAttribute('aria-live', 'polite');
    outputRegion.setAttribute('aria-atomic', 'false');
}
let linkedScenarioHandled = false;
function isToolState(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(entry => typeof entry === 'string');
}
function applyLinkedScenario() {
    if (linkedScenarioHandled)
        return;
    const url = new URL(document.baseURI);
    const toolId = url.searchParams.get('tool');
    const encodedState = url.searchParams.get('state');
    if (toolId === null || encodedState === null) {
        linkedScenarioHandled = true;
        return;
    }
    const tool = document.getElementById(toolId);
    if (!(tool instanceof HTMLDetailsElement) || (!tool.classList.contains('interactive-example') && !tool.classList.contains('interactive-tool'))) {
        linkedScenarioHandled = true;
        return;
    }
    if (toolIsUnavailable(tool))
        return;
    linkedScenarioHandled = true;
    const status = tool.querySelector('.interactive-tool-status');
    try {
        const state = JSON.parse(encodedState);
        if (!isToolState(state)) {
            if (status instanceof HTMLElement)
                status.textContent = 'The shared scenario could not be read; defaults remain active.';
            return;
        }
        if (!applyValues(tool, state)) {
            resetTool(tool);
            if (status instanceof HTMLElement)
                status.textContent = 'The shared scenario contains invalid values; defaults remain active.';
            return;
        }
        tool.open = true;
        if (status instanceof HTMLElement)
            status.textContent = 'Shared scenario loaded; results updated.';
    }
    catch (error) {
        if (!(error instanceof SyntaxError))
            throw error;
        if (status instanceof HTMLElement)
            status.textContent = 'The shared scenario could not be read; defaults remain active.';
    }
}
for (const tool of document.querySelectorAll('details.interactive-example[id], details.interactive-tool[id]')) {
    if (!(tool instanceof HTMLDetailsElement))
        continue;
    for (const input of toolInputs(tool)) {
        input.dataset['toolDefaultValue'] = input.value;
        if (input instanceof HTMLInputElement)
            enhanceNumberInput(input);
        else
            enhanceSegmentedSelect(input);
    }
    tool.querySelector('summary')?.insertAdjacentElement('afterend', createToolbar(tool));
    makeOutputsLive(tool);
}
applyLinkedScenario();
window.dispatchEvent(new CustomEvent('docs:tools-ready'));
