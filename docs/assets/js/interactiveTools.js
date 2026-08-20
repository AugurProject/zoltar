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
    for (const input of toolInputs(tool)) {
        const key = inputKey(input);
        const value = key === undefined ? undefined : values[key];
        if (value === undefined)
            continue;
        input.value = String(value);
        dispatchInput(input);
    }
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
    const scenarioText = document.createElement('span');
    scenarioText.textContent = 'Scenario';
    const scenarioSelect = document.createElement('select');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a preset';
    scenarioSelect.append(placeholder);
    for (const [index, preset] of presets.entries()) {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = preset.label;
        scenarioSelect.append(option);
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
        applyValues(tool, preset.values);
        status.textContent = `${preset.label} applied; results updated.`;
    });
    reset.addEventListener('click', () => {
        if (reset.disabled)
            return;
        resetTool(tool);
        scenarioSelect.value = '';
        status.textContent = 'Default values restored.';
    });
    copy.addEventListener('click', async () => {
        const copied = await copyText(scenarioUrl(tool));
        status.textContent = copied ? 'Scenario link copied.' : 'Copy failed; use the current values to create a link manually.';
    });
    const syncAvailability = () => {
        const unavailable = toolIsUnavailable(tool);
        scenarioSelect.disabled = unavailable || presets.length === 0;
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
    toolbar.append(scenarioLabel, reset, copy, status);
    return toolbar;
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
    if (!(tool instanceof HTMLDetailsElement) || !tool.classList.contains('interactive-example')) {
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
        applyValues(tool, state);
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
for (const tool of document.querySelectorAll('details.interactive-example[id]')) {
    if (!(tool instanceof HTMLDetailsElement))
        continue;
    for (const input of toolInputs(tool)) {
        input.dataset['toolDefaultValue'] = input.value;
    }
    tool.querySelector('summary')?.insertAdjacentElement('afterend', createToolbar(tool));
    makeOutputsLive(tool);
}
applyLinkedScenario();
window.dispatchEvent(new CustomEvent('docs:tools-ready'));
