import { rpcConnectivityFields } from '@zoltar/bot-shared/dashboard/rpc-connectivity'
import { executionModePanel, formActions, settingsGroup, settingsIntro, settingsPage, settingsSection, signerPanel, submissionPanel, switchField } from '@zoltar/bot-shared/dashboard/settings-markup'

// All inputs are repository-owned markup, never request or runtime data.

function numberField(label: string, name: string, attributes: string) {
	return `<label><span>${label}</span><input name="${name}" type="number" ${attributes} required /></label>`
}

const connectivityPanel = settingsGroup({
	body: `<p id="network-target-status" class="muted" role="status" aria-live="polite" hidden></p><p class="section-note">Changing Chain saves the current profile, safely pauses the bot, and loads that chain's separate settings and journals without restarting the process. Every endpoint is checked against the selected chain before it is accepted.</p><form id="connectivity-form"><fieldset id="connectivity-fieldset" disabled>${rpcConnectivityFields({ independentQuorum: true, statusId: 'connectivity-status', statusText: '', submissionLimit: 8, submitLabel: 'Save RPC endpoints' })}</fieldset><div id="profile-switch-retry-actions" class="form-actions" hidden><button id="profile-switch-retry-button" class="button button-secondary" type="button" hidden>Retry profile load</button></div></form><div id="endpoint-checks" class="endpoint-checks" aria-label="Endpoint health checks"></div>`,
	formId: 'connectivity-form',
	id: 'network-connectivity',
	summary: 'Unknown network',
	summaryId: 'network-value',
	title: 'Chain and RPC endpoints',
})

const universesPanel = settingsGroup({
	body: `<form id="tokens-form"><fieldset id="tokens-fieldset" disabled><div id="approved-universes" class="universe-explorer">Universe discovery has not completed.</div><p class="section-note">Existing positions continue recovery after a change.</p>${formActions({ statusId: 'tokens-status', submitLabel: 'Save universe approvals' })}</fieldset></form>`,
	formId: 'tokens-form',
	summary: 'Only explicitly approved universe REP can be traded',
	title: 'Approved universes',
})

const venuesPanel = settingsGroup({
	body: `<form id="deployment-form"><fieldset id="deployment-fieldset" disabled><div class="deployment-grid"><div class="derived-contract"><span>Derived executor</span><p id="deployment-executor" class="mono">Loading deployment…</p></div><div class="derived-contract"><span>Pool coordinators</span><p id="deployment-coordinators" class="mono" tabindex="0" aria-label="Discovered pool coordinators">Discovered from approved universes.</p></div>${switchField({ id: 'deployment-v2-enabled', label: 'Enable Uniswap V2 · mainnet only' })}${switchField({ id: 'deployment-v3-enabled', label: 'Enable Uniswap V3' })}${switchField({ id: 'deployment-v4-enabled', label: 'Enable Uniswap V4' })}</div><p class="section-note">Uniswap addresses follow the selected network. Each enabled version supplies its own prices; the TWAP check applies to V3.</p>${formActions({ statusId: 'deployment-status', submitLabel: 'Save venues' })}</fieldset></form><form id="create2-form" class="create2-form"><fieldset id="create2-fieldset" disabled><p class="section-note">Deploys through the canonical deterministic proxy with the active signer.</p><div id="create2-recovery" class="notice" data-tone="danger" aria-live="polite" hidden><strong>Recovery required</strong><span id="create2-recovery-copy"></span></div>${formActions({ statusId: 'create2-status', submitId: 'deploy-executor-button', submitLabel: 'Deploy predictable executor' })}</fieldset></form>`,
	formId: 'deployment-form',
	id: 'deployment-configuration',
	summary: 'Uniswap versions and the executor contract',
	title: 'Venues and executor',
})

const marketSourceTable = `<div class="table-scroll" tabindex="0" aria-label="Centralized market sources"><table class="market-source-table"><thead><tr><th scope="col">Exchange · CCXT id</th><th scope="col">REP market</th><th scope="col">ETH market · blank when quoted in ETH</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead><tbody id="market-source-rows"></tbody></table></div><div class="market-source-actions"><p id="market-sources-empty" class="empty-state">No centralized sources configured; the guard relies on DEX evidence only.</p><button id="market-source-add" class="button button-secondary" type="button">Add source</button></div>`

const marketThresholds = [
	numberField('Minimum sources', 'minimumSourceCount', 'min="1" max="100" step="1"'),
	numberField('Depth band (bps)', 'depthBps', 'min="1" max="5000" step="1"'),
	numberField('Maximum venue dispersion (bps)', 'maximumVenueDispersionBps', 'min="1" max="10000" step="1"'),
	numberField('Maximum DEX deviation (bps)', 'maximumDexDeviationBps', 'min="1" max="10000" step="1"'),
	numberField('Minimum bid depth (ETH)', 'minimumBidDepthEth', 'min="0" step="any"'),
	numberField('Minimum ask depth (ETH)', 'minimumAskDepthEth', 'min="0" step="any"'),
	numberField('Observation max age (ms)', 'maximumObservationAgeMilliseconds', 'min="1000" max="3600000" step="1"'),
	numberField('Request timeout (ms)', 'requestTimeoutMilliseconds', 'min="250" max="60000" step="1"'),
	numberField('Order book depth (levels)', 'orderBookLimit', 'min="1" max="1000" step="1"'),
].join('')

const venueConsensusFields = [
	['dexProbeDepthEth', 'DEX probe depth (ETH)', '0', 'any'],
	['maximumGroupDeviationBps', 'Maximum group deviation (bps)', '1', '1'],
	['minimumDexAskDepthEth', 'Minimum DEX ask depth (ETH)', '0', 'any'],
	['minimumDexBidDepthEth', 'Minimum DEX bid depth (ETH)', '0', 'any'],
	['minimumDexSourceCount', 'Minimum DEX sources', '1', '1'],
	['minimumSourceObservationCount', 'Observations per source', '1', '1'],
	['minimumSourceObservationSpanMilliseconds', 'Observation span (ms)', '0', '1'],
	['minimumTotalSourceCount', 'Minimum total sources', '2', '1'],
]
	.map(([name, label, min, step]) => `<label><span>${label}</span><input name="venue-${name}" type="number" min="${min}" step="${step}" required /></label>`)
	.join('')

const venueConsensusForm = `<fieldset class="settings-subpanel"><legend>Venue consensus</legend>${switchField({ id: 'venue-consensus-enabled', label: 'Use DEX venue consensus' })}<div class="field-grid">${venueConsensusFields}</div>${switchField({ id: 'venue-allow-single-group-fallback', label: 'Allow one venue group when the other is unavailable' })}<div class="table-scroll"><table><thead><tr><th>Source ID</th><th>Pair address</th><th>Fee (bps)</th><th>Action</th></tr></thead><tbody id="venue-dex-source-rows"></tbody></table></div><button id="venue-dex-source-add" class="button button-secondary" type="button">Add DEX source</button></fieldset>`

const marketPanel = settingsGroup({
	body: `<form id="market-form"><fieldset id="market-fieldset" disabled>${marketSourceTable}${switchField({ id: 'market-required', label: 'Require market consensus before execution', leading: true })}<div class="field-grid">${marketThresholds}</div>${venueConsensusForm}<p class="section-note">Source changes discard prior evidence before a replacement source can authorize execution.</p>${formActions({ statusId: 'market-status', submitLabel: 'Save market sources' })}</fieldset></form>`,
	formId: 'market-form',
	summary: 'Centralized exchanges and consensus thresholds for the reference price',
	title: 'REP market sources',
})

const strategyFields = [
	numberField('Minimum profit (WETH)', 'minimumProfitWeth', 'min="0" max="1000" step="any"'),
	numberField('Minimum return (bps)', 'minimumProfitBps', 'min="0" max="100000" step="1"'),
	numberField('Maximum spot/TWAP ticks', 'maxSpotTwapTicks', 'min="0" max="100000" step="1"'),
	numberField('TWAP window (seconds)', 'twapSeconds', 'min="60" max="86400"'),
	numberField('Minimum remaining blocks', 'minimumRemainingBlocks', 'min="1" max="1000" step="1"'),
	numberField('Minimum remaining seconds', 'minimumRemainingSeconds', 'min="1" max="86400" step="1"'),
	numberField('Poll interval (milliseconds)', 'pollMilliseconds', 'min="1000" max="3600000"'),
].join('')

const strategyPanel = settingsGroup({
	body: `<form id="strategy-form"><fieldset id="strategy-fieldset" disabled><div class="field-grid">${strategyFields}</div>${formActions({ statusId: 'form-status', submitLabel: 'Save strategy' })}</fieldset></form>`,
	formId: 'strategy-form',
	summary: 'Profit threshold, price safety, timing, and polling',
	title: 'Strategy',
})

const riskFields = [
	numberField('Maximum position notional (WETH)', 'maxPositionNotionalWeth', 'min="0" step="any"'),
	numberField('Maximum total locked (WETH)', 'maxTotalLockedWeth', 'min="0" step="any"'),
	numberField('Maximum concurrent positions', 'maxConcurrentPositions', 'min="1" max="1000" step="1"'),
	numberField('Maximum daily gas spend (WETH)', 'maxDailyGasSpendWeth', 'min="0" step="any"'),
	numberField('Lifecycle gas reserve (WETH)', 'lifecycleGasReserveWeth', 'min="0" step="any"'),
	numberField('Maximum hedge slippage (bps)', 'maxHedgeSlippageBps', 'min="0" max="1000" step="1"'),
	numberField('Event lookback (blocks · 0 disables)', 'lookbackBlocks', 'min="0" max="256" step="1"'),
].join('')

const riskPanel = settingsGroup({
	body: `<div id="risk-usage" class="usage-row" aria-label="Current risk usage"><div class="usage-metric"><span>Locked now</span><strong id="usage-locked">—</strong></div><div class="usage-metric"><span>Open positions</span><strong id="usage-positions">—</strong></div><div class="usage-metric"><span>Gas spent today</span><strong id="usage-daily-gas">—</strong></div></div><form id="runtime-form"><fieldset id="runtime-fieldset" disabled><div class="field-grid">${riskFields}</div><p class="section-note">Caps are rechecked before every entry; changing the lookback rebuilds the coordinator-free report window.</p>${formActions({ statusId: 'runtime-status', submitLabel: 'Save risk limits' })}</fieldset></form>`,
	formId: 'runtime-form',
	summary: 'Capital caps, gas budget, hedge slippage, and event lookback',
	title: 'Risk limits and scanning',
})

const settlementFields = [
	numberField('Minimum net (ETH)', 'settlementMinimumProfitWeth', 'min="0" max="1" step="any"'),
	numberField('Gas price cap (nanoETH)', 'settlementMaxGasPriceNanoEth', 'min="0.000000001" max="10000" step="any"'),
	numberField('Reward withdraw threshold (ETH)', 'settlementRewardWithdrawThresholdEth', 'min="0.000000000000000001" max="100" step="any"'),
].join('')

const settlementPanel = settingsGroup({
	body: `<form id="settlement-form"><fieldset id="settlement-fieldset" disabled>${switchField({ id: 'settlement-enabled', label: 'Enable third-party settlement', leading: true })}<div class="field-grid">${settlementFields}</div><p class="section-note">Settler rewards are paid in ETH. Dry-run mode only reports settlement decisions; settlement shares the daily gas budget with positions.</p>${formActions({ statusId: 'settlement-status', submitLabel: 'Save settlement' })}</fieldset></form>`,
	formId: 'settlement-form',
	summary: 'Third-party settlement of reports the bot never disputed',
	summaryId: 'settlement-panel-summary',
	title: 'Settlement',
})

const configurationPanel = settingsGroup({
	body: `<div class="section-heading"><button id="reload-configuration-button" class="button button-secondary" type="button" disabled>Reload configuration</button></div><form id="configuration-form"><fieldset id="configuration-fieldset" disabled><label><span>Operator configuration JSON</span><textarea id="configuration-json" class="configuration-json mono" rows="24" spellcheck="false" readonly></textarea></label><span id="configuration-status" class="action-status muted" role="status" aria-live="polite"></span></fieldset></form>`,
	id: 'complete-configuration',
	open: false,
	summary: 'Copy the current operator file · save changes in the forms above',
	title: 'Complete configuration',
})

/** The Settings page: Connect, Markets, Trading policy, Go live, and Advanced, with the load-state notice under the chip row. */
export const settingsPageMarkup = settingsPage({
	intro: settingsIntro({ scopeText: 'Select a chain profile first.' }),
	notices: '<div id="settings-load-state" class="notice settings-load-state" data-page-content="settings"><span id="settings-load-status" role="status" aria-live="polite">Loading operator configuration…</span><button id="retry-settings-button" class="button button-secondary" type="button" hidden>Retry</button></div>',
	sections: [
		settingsSection({ groups: connectivityPanel, id: 'settings-connect', step: 1, title: 'Connect' }),
		settingsSection({ groups: universesPanel + venuesPanel + marketPanel, id: 'settings-markets', step: 2, title: 'Markets' }),
		settingsSection({ groups: strategyPanel + riskPanel + settlementPanel, id: 'settings-policy', step: 3, title: 'Trading policy' }),
		settingsSection({
			groups:
				signerPanel({ forgetButton: true }) +
				submissionPanel({ note: 'Both delivery modes submit one parent-bound atomic entry transaction and require sufficient pre-existing ERC-20 and OpenOracle internal allowances before an opportunity is eligible.' }) +
				executionModePanel({ note: 'Enabling pauses the bot; it activates at the next scan boundary and signs only after you resume through the readiness check.' }),
			id: 'settings-go-live',
			step: 4,
			title: 'Go live',
		}),
		settingsSection({ collapsed: true, groups: configurationPanel, id: 'settings-advanced', title: 'Advanced' }),
	].join(''),
	steps: [
		{ id: 'settings-connect', label: 'Connect', step: 1 },
		{ id: 'settings-markets', label: 'Markets', step: 2 },
		{ id: 'settings-policy', label: 'Trading policy', step: 3 },
		{ id: 'settings-go-live', label: 'Go live', step: 4 },
		{ id: 'settings-advanced', label: 'Advanced' },
	],
})
