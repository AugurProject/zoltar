import { renderRepMarketConsensusError, renderRepMarketConsensusPanel } from '@zoltar/bot-shared/dashboard/rep-market-consensus'
import { isSnapshot } from './snapshot-validation.ts'
import { decodeConnectivity, decodePrediction, decodeExecutorDeployment, isRuntimeLimits, isSettlementSettings, isStrategySettings, isSubmissionSettings, isDeploymentSettings, isStringArray } from './api-validation.ts'
import { applyQuorumRpcUrls, loadCentralizedMarkets, loadDeployment, loadExecutionMode, loadRuntimeLimits, loadSettings, loadSettlement, loadSubmission, registerFocusedSettingsForms, setLoadedRpcQuorum } from './settings-forms.ts'
import { formIsSubmitting, markFormClean, refreshAllFormButtons, refreshFormButton, setFormSubmitting, trackForm } from '@zoltar/bot-shared/dashboard/form-state'
import { renderSettingsInsights } from './settings-insights.ts'
import { renderBalances, renderHealth, renderTransactions } from './overview-panels.ts'
import { createSettingsNavigation } from '@zoltar/bot-shared/dashboard/settings-navigation'
import { createUniverseExplorer } from '@zoltar/bot-shared/dashboard/universe-explorer'
let approvedUniverseIds = new Set<string>()
let universeSavePending = false
let universeExplorer: ReturnType<typeof createUniverseExplorer> | undefined

import { executorDeploymentRecoveryCopy, operatorNoticePresentation, pauseFailurePresentation } from './dashboard-notice.ts'
import { EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED } from '#state/executor-deployment-recovery'
import { resumePreflightRows } from './resume-preflight-rows.ts'
import { endpointHealthDetail, endpointRow, renderDisconnectedHeader, setAttentionBadge } from '@zoltar/bot-shared/dashboard/components'
import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import { CONFIGURATION_REQUEST_TIMEOUT_MS, PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE, PROFILE_SWITCH_REQUEST_TIMEOUT_MS, requestWithTimeout, singleFlight, STATE_REQUEST_TIMEOUT_MS } from '@zoltar/bot-shared/dashboard/polling'
import { closeResumePreflight, openResumePreflight } from '@zoltar/bot-shared/dashboard/resume-preflight'
import { createSectionNavigation } from '@zoltar/bot-shared/dashboard/section-navigation'
import { urlLines } from '@zoltar/bot-shared/dashboard/forms'
import type { ConnectivitySettings } from '#monitoring/connectivity'
import type { PublicExecutionRecord, PublicOperationEntry, PublicOperatorSnapshot, PublicPositionRecord } from '#state/operator-state'
import type { OpportunitySnapshot } from '#state/opportunity-snapshot'
import {
	amount,
	blockAgeLabel,
	botStatusLabels,
	chartPointX,
	configurationNetwork,
	connectivityControlsDisabled,
	countLabel,
	exactAmount,
	isConfigurationEnvelope,
	marketPoolStrategyUse,
	networkTargetStatus,
	opportunityCountLabel,
	opportunityDecisionReason,
	pauseControlState,
	persistedConnectivity,
	pollRetryStatus,
	requiredSignerPrivateKey,
	signerControlState,
	signerSummaryLabel,
	statePollingFailureMessage,
	sumSignedDecimals,
} from './dashboard-format.js'
import { venueLabel } from '#core/venue-strategy'
import { renderMarketPriceChart } from './market-price-chart.ts'
import { decisionBadge, element, explorerLink, row, setText, shorten } from './dom.js'
import { renderSettlements } from './settlement-panel.js'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
let latestSnapshot: PublicOperatorSnapshot | undefined
let settingsLoaded = false
let submissionLoaded = false
let connectivityLoaded = false
let connectivityRequestPending = false
let persistedNetwork: 'mainnet' | 'sepolia' | undefined
let pendingNetworkProfile: 'mainnet' | 'sepolia' | undefined
let pendingProfileStateConfirmed = false
let profileSwitchTimedOut = false
let profileRequestEpoch = 0
let deploymentLoaded = false
let tokensLoaded = false
let focusedRuntimeLoaded = false
let configurationLoaded = false
let configurationLoading = false
let configurationLoadError: string | undefined
let configuredScanIntervalMilliseconds: number | undefined
let initialFragmentApplied = false
let connected = false
let signerFeedback: { error: boolean; message: string } | undefined
let signerRequestPending = false
let pauseRequestPending: 'pause' | 'resume' | undefined
/**
 * The last rejected pause or resume request stays on the overview notice across polls until the operator retries or a poll shows the
 * requested run state applied after all. A recovery refusal additionally retires itself once a poll has shown the recovery pending and
 * a later poll shows it cleared, whichever client reconciled it.
 */
let pauseFailure: { message: string; recoverySeen: boolean; requestedPaused: boolean } | undefined

function prettyJson(value: unknown) {
	const serialized = JSON.stringify(value, undefined, 2)
	if (serialized === undefined) throw new Error('Configuration cannot be represented as JSON')
	return serialized
}

function setControlsEnabled(enabled: boolean) {
	connected = enabled
	const mutationsEnabled = enabled && pendingNetworkProfile === undefined
	const configurationEnabled = mutationsEnabled && configurationLoaded
	const focusedSettingsEnabled = configurationEnabled && latestSnapshot?.networkConfigured === true
	const pauseControls = pauseControlState({
		connected: mutationsEnabled,
		networkConfigured: latestSnapshot?.networkConfigured === true,
		paused: latestSnapshot?.paused === true,
		snapshotAvailable: latestSnapshot !== undefined,
	})
	const pauseButton = element('pause-button', HTMLButtonElement)
	pauseButton.disabled = pauseRequestPending !== undefined || pauseControls.pauseDisabled
	pauseButton.textContent = pauseButtonLabel(pauseRequestPending === 'pause', latestSnapshot?.paused === true)
	if (pauseRequestPending === 'pause') pauseButton.setAttribute('aria-busy', 'true')
	else pauseButton.removeAttribute('aria-busy')
	const confirmResume = element('confirm-resume', HTMLButtonElement)
	confirmResume.disabled = pauseRequestPending !== undefined || pauseControls.confirmDisabled
	confirmResume.textContent = pauseRequestPending === 'resume' ? 'Resuming…' : 'Resume bot'
	if (pauseRequestPending === 'resume') confirmResume.setAttribute('aria-busy', 'true')
	else confirmResume.removeAttribute('aria-busy')
	if (!mutationsEnabled) closeResumePreflight()
	const fieldset = element('strategy-fieldset')
	if (!(fieldset instanceof HTMLFieldSetElement)) throw new Error('Missing strategy fieldset')
	fieldset.disabled = !focusedSettingsEnabled || !settingsLoaded || formIsSubmitting('strategy-form')
	const submissionFieldset = element('submission-fieldset')
	if (!(submissionFieldset instanceof HTMLFieldSetElement)) throw new Error('Missing submission fieldset')
	submissionFieldset.disabled = !focusedSettingsEnabled || !submissionLoaded || formIsSubmitting('submission-form')
	for (const id of ['connectivity-fieldset', 'deployment-fieldset', 'create2-fieldset', 'signer-fieldset', 'tokens-fieldset', 'runtime-fieldset', 'settlement-fieldset', 'execution-fieldset', 'market-fieldset']) {
		const fieldset = element(id)
		if (!(fieldset instanceof HTMLFieldSetElement)) throw new Error(`Missing ${id}`)
		if (id === 'connectivity-fieldset') fieldset.disabled = connectivityControlsDisabled(configurationEnabled, connectivityRequestPending) || !connectivityLoaded
		else if (id === 'deployment-fieldset' || id === 'create2-fieldset') fieldset.disabled = !focusedSettingsEnabled || !deploymentLoaded
		else if (id === 'tokens-fieldset') fieldset.disabled = !focusedSettingsEnabled || !tokensLoaded || universeSavePending
		else if (id === 'signer-fieldset') fieldset.disabled = !focusedSettingsEnabled
		else fieldset.disabled = !focusedSettingsEnabled || !focusedRuntimeLoaded
		// A save in flight keeps its fieldset locked regardless of the connection state so later edits cannot be lost.
		if (formIsSubmitting(id.replace(/-fieldset$/, '-form'))) fieldset.disabled = true
	}
	element('network-name', HTMLSelectElement).disabled = !enabled || pendingNetworkProfile !== undefined || persistedNetwork === undefined
	updateConfigurationControls()
	refreshAllFormButtons()
}

function updateConfigurationControls() {
	const fieldset = element('configuration-fieldset')
	if (!(fieldset instanceof HTMLFieldSetElement)) throw new Error('Missing configuration fieldset')
	fieldset.disabled = !connected || pendingNetworkProfile !== undefined || !configurationLoaded || latestSnapshot?.networkConfigured !== true || configurationLoading
	element('reload-configuration-button', HTMLButtonElement).disabled = !connected || (pendingNetworkProfile !== undefined && !profileSwitchTimedOut) || configurationLoading
	const profileRetry = element('profile-switch-retry-button', HTMLButtonElement)
	profileRetry.hidden = !profileSwitchTimedOut
	profileRetry.disabled = !connected || configurationLoading
	element('profile-switch-retry-actions').hidden = !profileSwitchTimedOut
}

function updateSettingsLoadState() {
	const container = element('settings-load-state')
	const retry = element('retry-settings-button', HTMLButtonElement)
	if (configurationLoading) {
		container.hidden = false
		setText('settings-load-status', 'Loading operator configuration…')
		retry.hidden = true
		retry.disabled = true
		return
	}
	if (configurationLoaded) {
		container.hidden = true
		retry.hidden = true
		retry.disabled = false
		return
	}
	container.hidden = false
	setText('settings-load-status', configurationLoadError === undefined ? 'Operator configuration is unavailable.' : `${configurationLoadError} Editable settings remain locked.`)
	retry.hidden = false
	retry.disabled = false
}

function updateNetworkTargetStatus() {
	const target = element('network-target-status')
	if (pendingNetworkProfile !== undefined) {
		target.hidden = false
		setText('network-target-status', `Switching from ${persistedNetwork ?? 'the active chain'} to ${pendingNetworkProfile}. Existing chain settings remain visible until the new profile loads.`)
		return
	}
	const status = networkTargetStatus(latestSnapshot?.network, persistedNetwork)
	target.hidden = status === undefined
	if (status !== undefined) setText('network-target-status', status)
}

function synchronizePersistedConnectivity(configuration: unknown) {
	const selectedNetwork = typeof configuration === 'object' && configuration !== null && !Array.isArray(configuration) ? Reflect.get(configuration, 'network') : undefined
	if (selectedNetwork !== 'mainnet' && selectedNetwork !== 'sepolia') throw new Error('Bot returned an invalid active chain profile')
	const rpcQuorum = typeof configuration === 'object' && configuration !== null && !Array.isArray(configuration) ? Reflect.get(configuration, 'rpcQuorum') : undefined
	if (rpcQuorum !== 1 && rpcQuorum !== 2) throw new Error('Bot returned an invalid RPC quorum setting')
	element('rpc-quorum', HTMLSelectElement).value = rpcQuorum.toString()
	setLoadedRpcQuorum(rpcQuorum)
	const focused = persistedConnectivity(configuration)
	if (focused === undefined) {
		element('read-rpc-url', HTMLInputElement).value = ''
		element('public-rpc-urls', HTMLTextAreaElement).value = ''
		persistedNetwork = selectedNetwork
		element('network-name', HTMLSelectElement).value = selectedNetwork
		const networkLabel = selectedNetwork === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
		setText('settings-chain-scope', `Editing the ${networkLabel} profile.`)
		element('network-name', HTMLSelectElement).disabled = false
		connectivityLoaded = true
		updateNetworkTargetStatus()
		return
	}
	loadConnectivity(focused.connectivity)
	element('network-name', HTMLSelectElement).value = focused.network
	element('network-name', HTMLSelectElement).disabled = false
	persistedNetwork = focused.network
	const networkLabel = focused.network === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
	setText('settings-chain-scope', `Editing the ${networkLabel} profile.`)
	connectivityLoaded = true
	updateNetworkTargetStatus()
}

function finishPendingProfileIfReady(network: 'mainnet' | 'sepolia') {
	if (pendingNetworkProfile !== network || !pendingProfileStateConfirmed || persistedNetwork !== network) return false
	pendingNetworkProfile = undefined
	pendingProfileStateConfirmed = false
	profileSwitchTimedOut = false
	updateNetworkTargetStatus()
	setText('connectivity-status', 'Chain profile loaded. All settings shown belong to this chain.')
	setControlsEnabled(connected)
	return true
}

async function loadCompleteConfiguration() {
	if (configurationLoading) return
	const requestEpoch = profileRequestEpoch
	configurationLoading = true
	configurationLoaded = false
	configurationLoadError = undefined
	updateConfigurationControls()
	updateSettingsLoadState()
	setControlsEnabled(connected)
	setText('configuration-status', 'Loading complete configuration…')
	try {
		const envelope = await requestWithTimeout(signal => api('/api/configuration', { signal }), CONFIGURATION_REQUEST_TIMEOUT_MS, 'Configuration request timed out.')
		if (requestEpoch !== profileRequestEpoch) return
		if (!isConfigurationEnvelope(envelope)) throw new Error('Bot returned an invalid configuration document')
		const network = configurationNetwork(envelope.configuration)
		if (pendingNetworkProfile !== undefined && network !== pendingNetworkProfile) return
		element('configuration-json', HTMLTextAreaElement).value = prettyJson(envelope.configuration)
		synchronizeFocusedConfiguration(envelope.configuration)
		configurationLoaded = true
		configurationLoadError = undefined
		setText('configuration-status', '')
		if (network !== undefined) finishPendingProfileIfReady(network)
	} catch (error) {
		if (requestEpoch !== profileRequestEpoch) return
		configurationLoaded = false
		configurationLoadError = error instanceof Error ? error.message : String(error)
		setText('configuration-status', `${configurationLoadError} Use Reload configuration to retry.`)
	} finally {
		configurationLoading = false
		if (requestEpoch !== profileRequestEpoch) return
		updateSettingsLoadState()
		setControlsEnabled(connected)
	}
}

async function waitForNetworkProfile(network: 'mainnet' | 'sepolia') {
	const requestEpoch = profileRequestEpoch
	for (let attempt = 0; attempt < 40; attempt++) {
		await new Promise(resolve => setTimeout(resolve, 500))
		if (requestEpoch !== profileRequestEpoch || pendingNetworkProfile !== network) return
		try {
			await refresh()
			if (pendingProfileStateConfirmed) await loadCompleteConfiguration()
			if (pendingNetworkProfile === undefined) return
		} catch (error) {
			// The dashboard is briefly unavailable while the bot releases the old
			// chain's resources and reopens them for the selected profile.
			void error
		}
	}
	profileSwitchTimedOut = true
	setText('connectivity-status', 'The profile was saved, but the dashboard did not reconnect in time. Retry the profile load when the dashboard is available.')
	updateConfigurationControls()
}

async function api(path: string, init?: RequestInit) {
	const response = await fetch(path, init)
	const value: unknown = await response.json()
	if (!response.ok) {
		if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string') throw new Error(value.error)
		throw new Error(`Request failed with status ${response.status.toString()}`)
	}
	return value
}

const link = (value: string, kind: 'address' | 'tx', focusKey: string) => explorerLink(latestSnapshot?.explorerUrl ?? 'https://etherscan.io', value, kind, focusKey)

const renderedPanelSignatures = new Map<string, string>()
function renderChangedPanel(name: string, value: unknown, renderPanel: () => void) {
	const signature = JSON.stringify(value)
	if (renderedPanelSignatures.get(name) === signature) return
	renderPanel()
	renderedPanelSignatures.set(name, signature)
}

const OPPORTUNITY_LABELS = ['Report', 'Decision', 'Reference deviation', 'Executable REP / ETH', 'Reason', 'Direction', 'Estimated net', 'Required WETH', 'Required token', 'Window', 'Venue', 'Pool / manager']
const NOT_PRICED = '—'

function opportunityRow(opportunity: OpportunitySnapshot) {
	// A skipped report never reached a venue quote, so quote-derived columns stay blank; the direction column names the WETH/token pair instead.
	if (opportunity.decision === 'skipped') {
		return row([opportunity.reportId, decisionBadge(opportunity.decision), NOT_PRICED, NOT_PRICED, opportunityDecisionReason(opportunity), `WETH/${opportunity.tokenSymbol}`, NOT_PRICED, NOT_PRICED, NOT_PRICED, `${opportunity.timeRemaining} ${opportunity.windowUnit}`, NOT_PRICED, NOT_PRICED], OPPORTUNITY_LABELS)
	}
	return row(
		[
			opportunity.reportId,
			decisionBadge(opportunity.decision),
			opportunity.centralizedPriceDeviationBps === undefined ? 'Unavailable' : `${opportunity.centralizedPriceDeviationBps} bps`,
			amount(opportunity.executablePriceRepPerEth, 'REP / ETH'),
			opportunityDecisionReason(opportunity),
			opportunity.direction === 'buy-rep' ? `buy ${opportunity.tokenSymbol}` : `sell ${opportunity.tokenSymbol}`,
			amount(opportunity.estimatedNetProfitEth, 'ETH'),
			amount(opportunity.requiredWeth, 'WETH'),
			amount(opportunity.requiredToken, opportunity.tokenSymbol),
			`${opportunity.timeRemaining} ${opportunity.windowUnit}`,
			venueLabel(opportunity.venue),
			link(opportunity.pool, 'address', `opportunity:${opportunity.reportId}:pool`),
		],
		OPPORTUNITY_LABELS,
	)
}

function renderOpportunities(opportunities: readonly OpportunitySnapshot[]) {
	const body = element('opportunities-body', HTMLTableSectionElement)
	body.replaceChildren(...opportunities.map(opportunityRow))
	element('opportunities-empty').hidden = opportunities.length !== 0
	setText('opportunity-count', opportunityCountLabel(opportunities))
}

function renderHistory(history: readonly PublicExecutionRecord[], recordCount: number) {
	const body = element('history-body', HTMLTableSectionElement)
	body.replaceChildren()
	for (const record of history) {
		body.append(
			row(
				[
					new Date(record.executedAt).toLocaleString(),
					record.reportId,
					record.direction === 'buy-rep' ? `buy ${record.tokenSymbol}` : `sell ${record.tokenSymbol}`,
					exactAmount(record.estimatedNetProfitWeth, 'ETH'),
					exactAmount(record.trackedNetProfitEth, 'ETH'),
					exactAmount(record.actualGasCostEth, 'ETH'),
					`${amount(record.requiredWeth, 'WETH')} · ${amount(record.requiredToken, record.tokenSymbol)}`,
					link(record.transactionHash, 'tx', `history:${record.reportId}:transaction`),
				],
				['Time', 'Report', 'Direction', 'Modeled net', 'Tracked net', 'Actual gas', 'Inventory used', 'Transaction'],
			),
		)
	}
	element('history-empty').hidden = history.length !== 0
	renderProfitChart(history, recordCount)
}

function renderPositions(positions: readonly PublicPositionRecord[], recordCount: number) {
	const body = element('positions-body', HTMLTableSectionElement)
	body.replaceChildren()
	for (const position of positions) {
		const manuallyReconciled = position.manuallyReconciled
		const awaitingEntryEvidence = position.actualEntryGasCostEth === '0'
		const awaitingLifecycleEvidence = position.hasLifecycleTransactions && !position.lifecycleReceiptRecovered
		const accountingPending = !manuallyReconciled && (awaitingEntryEvidence || awaitingLifecycleEvidence)
		let hedgedProfit = exactAmount(position.hedgedProfitBeforeGasEth, 'ETH')
		if (manuallyReconciled) hedgedProfit = 'Manual reconciliation recorded'
		else if (accountingPending) hedgedProfit = `Awaiting ${awaitingEntryEvidence ? 'entry' : 'lifecycle'} evidence`
		let lifecycleGas = exactAmount(position.lifecycleGasCostEth, 'ETH')
		if (manuallyReconciled && awaitingLifecycleEvidence) lifecycleGas = 'Manual evidence; RPC quorum unavailable'
		else if (awaitingLifecycleEvidence) lifecycleGas = 'Awaiting lifecycle evidence'
		const settlerRewardAttoEth = awaitingLifecycleEvidence ? 'Awaiting lifecycle evidence' : exactAmount(position.lifecycleSettlerRewardEth, 'ETH')
		body.append(
			row(
				[
					new Date(position.openedAt).toLocaleString(),
					position.reportId,
					position.direction === 'buy-rep' ? `buy ${position.tokenSymbol}` : `sell ${position.tokenSymbol}`,
					manuallyReconciled ? `${position.status} · manual` : position.status,
					hedgedProfit,
					awaitingEntryEvidence ? 'Awaiting entry evidence' : exactAmount(position.actualEntryGasCostEth, 'ETH'),
					lifecycleGas,
					settlerRewardAttoEth,
					exactAmount(position.realizedNetProfitEth, 'ETH'),
					`${amount(position.withdrawnWeth, 'WETH')} · ${amount(position.withdrawnToken, position.tokenSymbol)}`,
					link(position.entryTransactionHash, 'tx', `position:${position.reportId}:transaction`),
				],
				['Opened', 'Report', 'Direction', 'Status', 'Hedged pre-gas', 'Entry gas', 'Lifecycle gas', 'Settler reward', 'Realized net', 'Withdrawn', 'Entry transaction'],
			),
		)
	}
	element('positions-empty').hidden = positions.length !== 0
	setText('position-count', recordCount > positions.length ? `Latest ${positions.length.toString()} of ${recordCount.toString()}` : countLabel(recordCount, 'durable position'))
}

function renderProfitChart(history: readonly PublicExecutionRecord[], recordCount: number) {
	const container = element('profit-chart')
	container.replaceChildren()
	if (history.length === 0) return
	const chronological = [...history].reverse()
	let total = 0
	const values = chronological.map(record => {
		total += Number(record.trackedNetProfitEth)
		return total
	})
	const minimum = Math.min(0, ...values)
	const maximum = Math.max(0, ...values)
	const range = maximum - minimum || 1
	const width = Math.max(container.clientWidth, 320)
	const height = 90
	const points = values.map((value, index) => {
		const x = chartPointX(index, values.length, width)
		const y = height - ((value - minimum) / range) * (height - 16) - 8
		return `${x.toFixed(2)},${y.toFixed(2)}`
	})
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg')
	svg.setAttribute('viewBox', `0 0 ${width.toString()} ${height.toString()}`)
	svg.setAttribute('role', 'img')
	const title = document.createElementNS(SVG_NAMESPACE, 'title')
	title.textContent = 'Tracked net profit in ETH for the displayed submitted disputes'
	const baseline = document.createElementNS(SVG_NAMESPACE, 'line')
	const baselineY = height - ((0 - minimum) / range) * (height - 16) - 8
	baseline.setAttribute('x1', '0')
	baseline.setAttribute('x2', width.toString())
	baseline.setAttribute('y1', baselineY.toFixed(2))
	baseline.setAttribute('y2', baselineY.toFixed(2))
	baseline.setAttribute('stroke', '#273141')
	const polyline = document.createElementNS(SVG_NAMESPACE, 'polyline')
	polyline.setAttribute('points', points.join(' '))
	polyline.setAttribute('fill', 'none')
	polyline.setAttribute('stroke', '#77e0ad')
	polyline.setAttribute('stroke-width', '3')
	polyline.setAttribute('vector-effect', 'non-scaling-stroke')
	svg.append(title, baseline, polyline)
	if (values.length === 1) {
		const [x = '0', y = '0'] = points[0]?.split(',') ?? []
		const marker = document.createElementNS(SVG_NAMESPACE, 'circle')
		marker.setAttribute('cx', x)
		marker.setAttribute('cy', y)
		marker.setAttribute('fill', '#77e0ad')
		marker.setAttribute('r', '6')
		svg.append(marker)
	}
	const summary = document.createElement('div')
	summary.className = 'profit-chart-summary'
	const label = document.createElement('span')
	label.textContent = recordCount > history.length ? `Tracked net profit · latest ${history.length.toString()} of ${recordCount.toString()} records` : `Tracked net profit · ${countLabel(recordCount, 'record')}`
	const value = document.createElement('strong')
	value.textContent = exactAmount(sumSignedDecimals(chronological.map(record => record.trackedNetProfitEth)), 'ETH')
	summary.append(label, value)
	container.append(summary, svg)
}

function loadConnectivity(connectivity: ConnectivitySettings) {
	element('read-rpc-url', HTMLInputElement).value = connectivity.readRpcUrl
	element('public-rpc-urls', HTMLTextAreaElement).value = connectivity.publicRpcUrls.join('\n')
}

function synchronizeFocusedConfiguration(configuration: unknown) {
	if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) throw new Error('Bot returned an invalid configuration document')
	const strategy = Reflect.get(configuration, 'strategy')
	const submission = Reflect.get(configuration, 'submission')
	const deployment = Reflect.get(configuration, 'deployment')
	const approvedUniverses = Reflect.get(configuration, 'approvedUniverses')
	const runtime = Reflect.get(configuration, 'runtime')
	const settlement = Reflect.get(configuration, 'settlement')
	const centralizedMarkets = Reflect.get(configuration, 'centralizedMarkets')
	if (!isStrategySettings(strategy) || !isSubmissionSettings(submission) || !isDeploymentSettings(deployment) || !isStringArray(approvedUniverses)) throw new Error('Bot returned an invalid configuration document')
	const execute = typeof runtime === 'object' && runtime !== null ? Reflect.get(runtime, 'execute') : undefined
	if (!isRuntimeLimits(runtime) || typeof execute !== 'boolean' || !isSettlementSettings(settlement) || typeof centralizedMarkets !== 'object' || centralizedMarkets === null || Array.isArray(centralizedMarkets)) throw new Error('Bot returned an invalid configuration document')
	configuredScanIntervalMilliseconds = strategy.pollMilliseconds
	if (latestSnapshot !== undefined) renderHealth(latestSnapshot, configuredScanIntervalMilliseconds, !connected)
	loadSettings(strategy)
	settingsLoaded = true
	loadSubmission(submission)
	submissionLoaded = true
	synchronizePersistedConnectivity(configuration)
	loadDeployment(deployment, 'configuration')
	deploymentLoaded = true
	approvedUniverseIds = new Set(approvedUniverses)
	tokensLoaded = true
	markFormClean('tokens-form')
	loadRuntimeLimits(runtime)
	loadSettlement(settlement)
	loadExecutionMode(execute)
	loadCentralizedMarkets({ ...centralizedMarkets })
	focusedRuntimeLoaded = true
	markFormClean('connectivity-form')
	if (latestSnapshot !== undefined) renderSettingsInsights(latestSnapshot)
}

function renderEndpointChecks(snapshot: PublicOperatorSnapshot) {
	const container = element('endpoint-checks')
	container.replaceChildren()
	const endpointChecksMatchActiveChain = snapshot.endpointChecks.every(check => check.chainId === undefined || check.chainId === snapshot.expectedChainId)
	const endpointChecks = endpointChecksMatchActiveChain ? snapshot.endpointChecks : []
	if (endpointChecks.length > 0) {
		const heading = document.createElement('h3')
		heading.className = 'endpoint-check-heading'
		heading.textContent = 'Configuration validation'
		container.append(heading)
	}
	for (const check of endpointChecks) {
		container.append(endpointRow('endpoint-check', check, check.error ?? `Chain ${check.chainId?.toString() ?? 'unconfirmed'} · ${check.kind}`))
	}
	const runtimeHealth = endpointChecksMatchActiveChain ? (snapshot.rpcEndpointHealth ?? []) : []
	if (runtimeHealth.length > 0) {
		const heading = document.createElement('h3')
		heading.className = 'endpoint-check-heading'
		heading.textContent = 'Live RPC health'
		container.append(heading)
	}
	for (const endpoint of runtimeHealth) {
		container.append(endpointRow('endpoint-check', endpoint, endpointHealthDetail(endpoint)))
	}
}

function renderOperations(operations: readonly PublicOperationEntry[]) {
	const filter = element('operation-filter', HTMLSelectElement).value
	const visibleOperations = operations.filter(operation => operation.category !== 'scan' && (filter === 'all' || operation.level === filter))
	const body = element('operations-body', HTMLTableSectionElement)
	body.replaceChildren()
	for (const operation of visibleOperations) {
		const level = document.createElement('span')
		level.className = 'log-level'
		level.dataset['level'] = operation.level
		level.textContent = operation.level
		body.append(row([new Date(operation.timestamp).toLocaleString(), level, operation.category, operation.reportId ?? '—', operation.message, operation.reason ?? '—', operation.details ?? '—'], ['Time', 'Level', 'Category', 'Report', 'Operation', 'Why', 'Details']))
	}
	element('operations-empty').hidden = visibleOperations.length !== 0
	setText('operation-count', countLabel(visibleOperations.length, 'entry', 'entries'))
}

function renderTokenMarkets(snapshot: PublicOperatorSnapshot) {
	universeExplorer ??= createUniverseExplorer(element('approved-universes'), {
		onChange: next => {
			approvedUniverseIds = next
			refreshFormButton('tokens-form')
		},
		savedMessage: '',
	})
	universeExplorer.update({ universes: snapshot.universes ?? [], approved: approvedUniverseIds, network: snapshot.network, disabled: element('tokens-fieldset', HTMLFieldSetElement).disabled })

	const body = element('token-markets-body', HTMLTableSectionElement)
	body.replaceChildren()
	const executableTokens = new Set(snapshot.tokenAddresses.map(address => address.toLowerCase()))
	for (const token of snapshot.tokenMarkets) {
		if (token.pools.length === 0) {
			body.append(
				row(
					[token.symbol, link(token.address, 'address', `token:${token.address}:address`), amount(token.balance, token.symbol), '—', 'Monitoring only', 'No supported WETH pools found', '—', 'Unavailable', '0'],
					['Token', 'Address', 'Wallet balance', 'Exchange', 'Strategy use', 'Pool', 'Fee', 'Spot', 'Liquidity / reserves'],
				),
			)
			continue
		}
		for (const pool of token.pools) {
			const poolLink = document.createElement('a')
			poolLink.href = pool.url
			poolLink.dataset['focusKey'] = `token:${token.address}:pool:${pool.address}`
			poolLink.target = '_blank'
			poolLink.rel = 'noreferrer'
			poolLink.textContent = shorten(pool.address)
			const strategyUse = marketPoolStrategyUse(executableTokens.has(token.address.toLowerCase()), pool.venue)
			body.append(
				row(
					[token.symbol, link(token.address, 'address', `token:${token.address}:address:${pool.address}`), amount(token.balance, token.symbol), pool.venue, strategyUse, poolLink, `${(pool.fee / 10_000).toString()}%`, amount(pool.priceWeth, 'WETH'), pool.liquidity],
					['Token', 'Address', 'Wallet balance', 'Exchange', 'Strategy use', 'Pool', 'Fee', 'Spot', 'Liquidity / reserves'],
				),
			)
		}
	}
	element('token-markets-empty').hidden = snapshot.tokenMarkets.length !== 0
	const poolCount = snapshot.tokenMarkets.reduce((total, token) => total + token.pools.length, 0)
	setText('token-count', `${countLabel(snapshot.tokenMarkets.length, 'token')} · ${countLabel(poolCount, 'pool')}`)
}

function renderCentralizedMarket(snapshot: PublicOperatorSnapshot) {
	const market = snapshot.centralizedMarket
	const consensus = snapshot.marketConsensus
	renderRepMarketConsensusPanel(document, {
		status: market === undefined ? (consensusStatusText(consensus, 'Reliable DEX consensus') ?? 'No market sources configured') : (consensusStatusText(consensus, 'Reliable independent CEX + DEX consensus') ?? (market.reliable ? 'Reliable CEX estimate' : market.reasons.join(' · '))),
		emptyText: 'Add public exchange sources in the operator configuration.',
		values: {
			cexPrice: market?.priceRepPerEth ?? '—',
			dexPrice: consensus?.dex.reliable === true ? consensus.dex.priceRepPerEth : '—',
			guardedPrice: consensus?.reliable === true ? (consensus.priceRepPerEth ?? '—') : '—',
			dexBidDepth: consensus === undefined ? '—' : `${consensus.dex.bidDepthEth} ETH`,
			dexAskDepth: consensus === undefined ? '—' : `${consensus.dex.askDepthEth} ETH`,
			cexBidDepth: market === undefined ? '—' : `${market.bidDepthEth} ETH`,
			cexAskDepth: market === undefined ? '—' : `${market.askDepthEth} ETH`,
			sources: consensus === undefined ? `${market?.observations.length ?? 0} CEX` : `${consensus.cex.sourceCount.toString()} CEX · ${consensus.dex.sourceCount.toString()} DEX`,
		},
		observations: (market?.observations ?? []).map(observation => ({
			exchange: observation.exchangeId,
			market: observation.repMarket,
			price: observation.priceRepPerEth,
			bidDepth: `${observation.bidDepthEth} ETH`,
			askDepth: `${observation.askDepthEth} ETH`,
			observed: new Date(observation.observedAt).toLocaleTimeString(),
		})),
	})
}

function renderDisputePaths(snapshot: PublicOperatorSnapshot) {
	const container = element('dispute-paths')
	const disclosureState = new Map(Array.from(container.querySelectorAll<HTMLDetailsElement>('details[data-report-id]')).map(details => [details.dataset['reportId'] ?? '', { focused: details.querySelector('summary') === document.activeElement, open: details.open }]))
	container.replaceChildren()
	for (const path of snapshot.reportPaths) {
		const details = document.createElement('details')
		details.className = 'dispute-path'
		details.dataset['reportId'] = path.reportId
		const summary = document.createElement('summary')
		summary.dataset['focusKey'] = `dispute:${path.reportId}:summary`
		summary.textContent = `Report ${path.reportId} · ${countLabel(path.steps.length, 'step')} · ${path.settled ? 'settled' : 'active'}`
		details.append(summary)
		for (const step of path.steps) {
			const item = document.createElement('div')
			item.className = 'dispute-step'
			const event = document.createElement('strong')
			event.textContent = step.event
			const block = document.createElement('span')
			block.textContent = `Block ${step.blockNumber}`
			const description = document.createElement('span')
			const amounts = step.amount1 === undefined ? '' : ` · amounts ${step.amount1} / ${step.amount2 ?? '—'}`
			description.textContent = `${step.reporter === undefined ? 'No reporter' : shorten(step.reporter)}${amounts}`
			if (step.transactionHash !== undefined) description.append(' · ', link(step.transactionHash, 'tx', `dispute:${path.reportId}:${step.blockNumber}:transaction`))
			item.append(event, block, description)
			details.append(item)
		}
		container.append(details)
		const previous = disclosureState.get(path.reportId)
		if (previous?.open === true) details.open = true
		if (previous?.focused === true) summary.focus({ preventScroll: true })
	}
	element('dispute-paths-empty').hidden = snapshot.reportPaths.length !== 0
	setText('dispute-path-count', countLabel(snapshot.reportPaths.length, 'report path'))
}

function renderSignerStatus(snapshot: PublicOperatorSnapshot) {
	const privateKeyInput = element('private-key', HTMLInputElement)
	const rememberSignerInput = element('remember-signer', HTMLInputElement)
	const signerStatus = element('signer-status')
	// The panel summary reports the active and saved signer; the status line reports the last request's outcome.
	setText('signer-summary', signerSummaryLabel(snapshot))
	if (signerFeedback !== undefined) {
		signerStatus.textContent = signerFeedback.message
		signerStatus.setAttribute('role', signerFeedback.error ? 'alert' : 'status')
		signerStatus.classList.toggle('error', signerFeedback.error)
		privateKeyInput.setAttribute('aria-invalid', signerFeedback.error.toString())
	} else {
		signerStatus.textContent = 'Keys stay local and are never returned by the API or logged.'
		signerStatus.setAttribute('role', 'status')
		signerStatus.classList.remove('error')
		privateKeyInput.setAttribute('aria-invalid', 'false')
	}
	const controls = signerControlState({
		hasQueuedSigner: typeof snapshot.queuedWallet === 'string',
		hasWallet: snapshot.wallet !== undefined,
		privateKey: privateKeyInput.value,
		requestPending: signerRequestPending,
	})
	privateKeyInput.disabled = controls.inputDisabled
	rememberSignerInput.disabled = controls.inputDisabled
	element('clear-signer-button', HTMLButtonElement).disabled = controls.clearDisabled
	element('forget-signer-button', HTMLButtonElement).disabled = signerRequestPending || snapshot.savedWallet === undefined
	element('set-signer-button', HTMLButtonElement).disabled = controls.setDisabled
}

function renderBlockStatus(snapshot = latestSnapshot) {
	const value = snapshot?.blockNumber === undefined ? 'Block — · waiting for first observation' : `Block ${snapshot.blockNumber} · ${blockAgeLabel(snapshot.blockTimestamp)}`
	setText('header-block-status', value)
}

element('transaction-filter', HTMLSelectElement).addEventListener('change', () => renderTransactions(latestSnapshot?.transactionActivity ?? [], latestSnapshot?.explorerUrl))
element('operation-filter', HTMLSelectElement).addEventListener('change', () => renderOperations(latestSnapshot?.operationLog ?? []))

function pauseButtonLabel(pausing: boolean, paused: boolean) {
	if (pausing) return 'Pausing…'
	return paused ? 'Resume bot' : 'Pause bot'
}

function consensusStatusText(consensus: { reasons: readonly string[]; reliable: boolean } | undefined, reliableLabel: string) {
	if (consensus === undefined) return undefined
	return consensus.reliable ? reliableLabel : consensus.reasons.join(' · ')
}

function runStatusKey(snapshot: PublicOperatorSnapshot) {
	if (snapshot.paused) return 'paused'
	return snapshot.status === 'error' && snapshot.marketAvailability?.kind === 'missing-deployment' ? 'syncing' : snapshot.status
}

function runStatusBadgeClass(runStatus: string) {
	if (runStatus === 'running') return ' success'
	return runStatus === 'error' ? ' error' : ' warning'
}

function attentionTarget(networkSetupCount: number, recoveryCount: number, uncertainTransactionCount: number) {
	if (networkSetupCount > 0) return '/settings#network-connectivity'
	if (recoveryCount > 0) return '/operations#position-lifecycle'
	return uncertainTransactionCount > 0 ? '/operations#transaction-tracking' : '/overview#notice'
}

function renderOperatorNotice(snapshot: PublicOperatorSnapshot) {
	if (pauseFailure !== undefined && snapshot.paused === pauseFailure.requestedPaused) pauseFailure = undefined
	if (pauseFailure?.message === EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED) {
		if (snapshot.executorDeploymentRecovery !== undefined) pauseFailure.recoverySeen = true
		else if (pauseFailure.recoverySeen) pauseFailure = undefined
	}
	const presentation = pauseFailure === undefined ? operatorNoticePresentation(snapshot) : pauseFailurePresentation(pauseFailure.message)
	setText('notice-title', presentation.noticeTitle)
	setText('notice-copy', presentation.noticeCopy)
	element('notice').dataset['tone'] = presentation.noticeTone
}

function renderExecutorRecovery(recovery: PublicOperatorSnapshot['executorDeploymentRecovery']) {
	element('create2-recovery').hidden = recovery === undefined
	if (recovery === undefined) element('create2-recovery-copy').replaceChildren()
	else element('create2-recovery-copy').replaceChildren(executorDeploymentRecoveryCopy(recovery, 'executor-form'), ' Transaction ', link(recovery.transactionHash, 'tx', 'create2-recovery-transaction'))
}

function render(snapshot: PublicOperatorSnapshot) {
	const activeElement = document.activeElement
	const focusKey = activeElement instanceof HTMLElement ? activeElement.dataset['focusKey'] : undefined
	const scrollPosition = { left: window.scrollX, top: window.scrollY }
	latestSnapshot = snapshot
	renderHealth(snapshot, configuredScanIntervalMilliseconds, false)
	setText('deployment-executor', snapshot.executor ?? 'Unavailable')
	setText('deployment-coordinators', snapshot.coordinatorAddresses.length === 0 ? 'No pools discovered in approved universes.' : snapshot.coordinatorAddresses.join('\n'))
	setControlsEnabled(true)
	const modeBadge = element('mode-badge')
	const statusLabels = botStatusLabels(snapshot)
	modeBadge.className = 'badge'
	modeBadge.dataset['mode'] = snapshot.mode
	modeBadge.textContent = statusLabels.mode
	const runStatusBadge = element('run-status-badge')
	const runStatus = runStatusKey(snapshot)
	runStatusBadge.dataset['status'] = runStatus
	runStatusBadge.textContent = statusLabels.status
	runStatusBadge.className = `badge${runStatusBadgeClass(runStatus)}`
	const capabilityBadge = element('capability-badge')
	capabilityBadge.hidden = snapshot.operatorCapable
	capabilityBadge.textContent = snapshot.operatorCapable ? '' : 'Operator blocked'
	capabilityBadge.className = `badge${snapshot.operatorCapable ? ' success' : ' warning'}`
	renderPollRetry(snapshot)
	const headerNetworkBadge = element('header-network-badge')
	headerNetworkBadge.textContent = snapshot.networkConfigured ? `${snapshot.network} · ${snapshot.expectedChainId.toString()}` : 'Network setup'
	headerNetworkBadge.className = `badge${snapshot.networkConfigured ? '' : ' warning'}`
	const recoveryCount = snapshot.positions.filter(position => position.status === 'recovery-required').length
	const uncertainTransactionCount = snapshot.transactionActivity.filter(transaction => transaction.status === 'confirmation-unknown').length
	const networkSetupCount = snapshot.networkConfigured ? 0 : 1
	const detailedAttentionCount = networkSetupCount + recoveryCount + uncertainTransactionCount + (snapshot.lastError === undefined ? 0 : 1)
	const attentionCount = Math.max(snapshot.operatorCapable ? 0 : 1, detailedAttentionCount)
	const attentionBadge = element('attention-badge', HTMLAnchorElement)
	setAttentionBadge(attentionBadge, attentionCount, attentionTarget(networkSetupCount, recoveryCount, uncertainTransactionCount))
	setText('status-value', statusLabels.status)
	setText('last-poll-value', snapshot.lastPollAt === undefined ? 'No poll completed' : `Updated ${new Date(snapshot.lastPollAt).toLocaleTimeString()}`)
	setText('active-report-value', snapshot.activeReportCount.toString())
	renderBlockStatus(snapshot)
	setText('profit-value', exactAmount(snapshot.totalRealizedNetProfitEth, 'ETH'))
	setText('open-profit-value', exactAmount(snapshot.totalOpenHedgedNetProfitEth, 'ETH'))
	setText('hedged-profit-value', exactAmount(snapshot.totalHedgedProfitBeforeGasEth, 'ETH'))
	setText('gas-value', exactAmount(snapshot.totalActualGasCostEth, 'ETH'))
	setText('game-capital-value', exactAmount(snapshot.gameCapital.totalEthWeth, 'ETH'))
	setText('game-capital-detail', `${exactAmount(snapshot.gameCapital.eth, 'ETH')} · ${exactAmount(snapshot.gameCapital.weth, 'WETH')} in observed active games`)
	setText('risk-open-positions', `${snapshot.risk.usage.openPositions.toString()} open · ${snapshot.risk.limits.maxConcurrentPositions.toString()} maximum`)
	setText('risk-locked', `${exactAmount(snapshot.risk.usage.lockedWeth, 'WETH')} / ${exactAmount(snapshot.risk.limits.maxTotalLockedWeth, 'WETH')}`)
	setText('risk-daily-gas', `${exactAmount(snapshot.risk.usage.dailyGasSpentWeth, 'ETH')} / ${exactAmount(snapshot.risk.limits.maxDailyGasSpendWeth, 'ETH')}`)
	setText('risk-position-limit', exactAmount(snapshot.risk.limits.maxPositionNotionalWeth, 'WETH'))
	setText('risk-lifecycle-reserve', exactAmount(snapshot.risk.limits.lifecycleGasReserveWeth, 'ETH'))
	setText('network-value', snapshot.networkConfigured ? `Active: ${snapshot.network} · chain ${snapshot.expectedChainId.toString()}` : 'Network not configured')
	updateNetworkTargetStatus()
	renderSignerStatus(snapshot)
	const launchNotice = element('launch-notice')
	if (!snapshot.networkConfigured) {
		launchNotice.hidden = false
		setText('launch-notice-title', 'Network setup required')
		setText('launch-notice-copy', 'Choose the chain and verified RPC endpoints in Settings. They apply to the next scan; the bot remains paused until you resume it.')
		launchNotice.dataset['tone'] = 'warning'
	} else if (snapshot.network === 'mainnet') {
		launchNotice.hidden = true
		setText('launch-notice-title', 'Mainnet execution network')
		setText('launch-notice-copy', 'Use only reviewed deployments, current market evidence, low risk limits, and supervised recovery procedures.')
		launchNotice.dataset['tone'] = 'warning'
	} else {
		launchNotice.hidden = true
		setText('launch-notice-title', 'Sepolia network')
		setText('launch-notice-copy', 'Use this network to exercise execution and recovery with a dedicated low-balance key and low risk limits.')
		launchNotice.dataset['tone'] = 'warning'
	}
	renderOperatorNotice(snapshot)
	renderExecutorRecovery(snapshot.executorDeploymentRecovery)
	renderChangedPanel('balances', [snapshot.wallet, snapshot.balances], () => renderBalances(snapshot))
	renderChangedPanel('opportunities', [snapshot.opportunities, snapshot.explorerUrl], () => renderOpportunities(snapshot.opportunities))
	renderChangedPanel('settlements', [snapshot.settlements, snapshot.explorerUrl], () => renderSettlements(snapshot.settlements, link))
	renderSettingsInsights(snapshot)
	renderChangedPanel('transactions', [snapshot.transactionActivity, snapshot.explorerUrl], () => renderTransactions(snapshot.transactionActivity, snapshot.explorerUrl))
	renderChangedPanel('endpoints', [snapshot.endpointChecks, snapshot.rpcEndpointHealth, snapshot.network], () => renderEndpointChecks(snapshot))
	renderChangedPanel('operations', snapshot.operationLog, () => renderOperations(snapshot.operationLog))
	renderChangedPanel('history', [snapshot.executionHistory, snapshot.executionHistoryRecordCount, snapshot.explorerUrl], () => renderHistory(snapshot.executionHistory, snapshot.executionHistoryRecordCount))
	renderChangedPanel('positions', [snapshot.positions, snapshot.positionRecordCount, snapshot.explorerUrl], () => renderPositions(snapshot.positions, snapshot.positionRecordCount))
	renderChangedPanel('tokens', [snapshot.tokenMarkets, snapshot.tokenAddresses, snapshot.universes, snapshot.network, snapshot.explorerUrl, [...approvedUniverseIds], element('tokens-fieldset', HTMLFieldSetElement).disabled], () => renderTokenMarkets(snapshot))
	renderChangedPanel('market', [snapshot.centralizedMarket, snapshot.marketConsensus], () => renderCentralizedMarket(snapshot))
	renderChangedPanel('paths', [snapshot.reportPaths, snapshot.explorerUrl], () => renderDisputePaths(snapshot))
	renderMarketPriceChart(snapshot)
	if (focusKey !== undefined) {
		const target = Array.from(document.querySelectorAll<HTMLElement>('[data-focus-key]')).find(candidate => candidate.dataset['focusKey'] === focusKey)
		target?.focus({ preventScroll: true })
	}
	window.scrollTo(scrollPosition)
	if (!initialFragmentApplied) {
		initialFragmentApplied = true
		const fragment = decodeURIComponent(window.location.hash.slice(1))
		if (fragment !== '') {
			syncSectionNavigation()
			scrollToSection(fragment)
		}
	}
}

function renderPollRetry(snapshot: PublicOperatorSnapshot) {
	const badge = element('retry-status-badge')
	const retry = pollRetryStatus(snapshot)
	badge.parentElement?.toggleAttribute('data-retry-active', retry !== undefined)
	badge.hidden = retry === undefined
	badge.textContent = retry?.label ?? 'Retry —'
	badge.className = `badge ${retry?.state === 'retrying' ? 'error' : 'warning'}`
}

function clearPollRetry() {
	const badge = element('retry-status-badge')
	badge.parentElement?.removeAttribute('data-retry-active')
	badge.hidden = true
	badge.textContent = 'Retry —'
	badge.className = 'badge warning'
}

const refresh = singleFlight(async () => {
	const requestEpoch = profileRequestEpoch
	try {
		const value: unknown = await requestWithTimeout(signal => api('/api/state', { signal }), STATE_REQUEST_TIMEOUT_MS)
		if (requestEpoch !== profileRequestEpoch) return
		if (!isSnapshot(value)) throw new Error('Bot returned an invalid state snapshot')
		if (pendingNetworkProfile !== undefined && value.network !== pendingNetworkProfile) return
		render(value)
		if (pendingNetworkProfile !== undefined) {
			pendingProfileStateConfirmed = true
			finishPendingProfileIfReady(value.network)
		}
	} catch (error) {
		if (requestEpoch !== profileRequestEpoch) return
		void error
		if (latestSnapshot !== undefined) renderHealth(latestSnapshot, configuredScanIntervalMilliseconds, true)
		setControlsEnabled(false)
		clearPollRetry()
		const modeBadge = element('mode-badge')
		const statusLabels = botStatusLabels(undefined)
		delete modeBadge.dataset['mode']
		const runStatusBadge = element('run-status-badge')
		runStatusBadge.dataset['status'] = latestSnapshot === undefined ? 'disconnected' : 'stale'
		renderRepMarketConsensusError(document)
		let lastKnownModeLabel: string | undefined
		if (latestSnapshot !== undefined) lastKnownModeLabel = latestSnapshot.mode === 'execute' ? 'Live armed' : 'Dry run'
		renderDisconnectedHeader({
			attentionBadge: element('attention-badge', HTMLAnchorElement),
			attentionTarget: '/overview#notice',
			capabilityBadge: element('capability-badge'),
			capabilityBadgeClassName: 'badge warning',
			lastKnownModeLabel,
			modeBadge,
			modeBadgeClassName: 'badge warning',
			retainedAttentionCount: latestSnapshot === undefined ? 0 : latestSnapshot.positions.filter(position => position.status === 'recovery-required').length + latestSnapshot.transactionActivity.filter(transaction => transaction.status === 'confirmation-unknown').length + (latestSnapshot.networkConfigured ? 0 : 1),
			runStatusBadge,
			runStatusBadgeClassName: 'badge error',
			showNotice: title => {
				setText('notice-title', title)
				setText('notice-copy', statePollingFailureMessage(error))
				element('notice').dataset['tone'] = 'danger'
			},
		})
		const headerNetworkBadge = element('header-network-badge')
		if (latestSnapshot?.networkConfigured === true) headerNetworkBadge.textContent = `${latestSnapshot.network} · ${latestSnapshot.expectedChainId.toString()} · last known`
		else if (latestSnapshot !== undefined) headerNetworkBadge.textContent = 'Network setup · last known'
		else headerNetworkBadge.textContent = 'Network unavailable'
		headerNetworkBadge.className = 'badge warning'
		setText('status-value', latestSnapshot === undefined ? statusLabels.status : 'State stale')
		element('launch-notice').hidden = true
	}
})

element('reload-configuration-button').addEventListener('click', () => void loadCompleteConfiguration())
element('profile-switch-retry-button', HTMLButtonElement).addEventListener('click', async event => {
	const button = event.currentTarget
	if (!(button instanceof HTMLButtonElement) || pendingNetworkProfile === undefined || !profileSwitchTimedOut || button.disabled) return
	button.disabled = true
	button.setAttribute('aria-busy', 'true')
	button.textContent = 'Retrying profile load…'
	try {
		await refresh()
		await loadCompleteConfiguration()
	} finally {
		button.removeAttribute('aria-busy')
		button.textContent = 'Retry profile load'
		updateConfigurationControls()
	}
})

element('network-name', HTMLSelectElement).addEventListener('change', async event => {
	const select = event.currentTarget
	if (!(select instanceof HTMLSelectElement) || pendingNetworkProfile !== undefined || (select.value !== 'mainnet' && select.value !== 'sepolia') || select.value === persistedNetwork) return
	const previousNetwork = persistedNetwork
	const requestedNetwork = select.value
	profileRequestEpoch += 1
	pendingNetworkProfile = requestedNetwork
	pendingProfileStateConfirmed = false
	profileSwitchTimedOut = false
	select.value = previousNetwork ?? requestedNetwork
	select.disabled = true
	updateNetworkTargetStatus()
	setControlsEnabled(connected)
	setText('connectivity-status', '')
	try {
		await requestWithTimeout(signal => api('/api/network-profile', { body: JSON.stringify({ network: requestedNetwork }), headers: { 'content-type': 'application/json' }, method: 'PUT', signal }), PROFILE_SWITCH_REQUEST_TIMEOUT_MS, PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE)
		setText('connectivity-status', 'Profile saved. The bot is switching chains in place; settings will reload automatically.')
		void waitForNetworkProfile(requestedNetwork)
	} catch (error) {
		if (error instanceof Error && error.message === PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE) {
			setText('connectivity-status', 'The switch request timed out with an unknown outcome. Existing settings remain locked while the dashboard checks the selected profile.')
			void waitForNetworkProfile(requestedNetwork)
			return
		}
		profileRequestEpoch += 1
		pendingNetworkProfile = undefined
		pendingProfileStateConfirmed = false
		profileSwitchTimedOut = false
		setText('connectivity-status', error instanceof Error ? error.message : String(error))
		select.value = previousNetwork ?? 'mainnet'
		updateNetworkTargetStatus()
		setControlsEnabled(connected)
	}
})
element('retry-settings-button').addEventListener('click', () => void loadCompleteConfiguration())
element('price-token', HTMLSelectElement).addEventListener('change', () => {
	if (latestSnapshot !== undefined) renderMarketPriceChart(latestSnapshot)
})
element('tokens-form').addEventListener('submit', async event => {
	event.preventDefault()
	const requestEpoch = profileRequestEpoch
	universeSavePending = true
	setControlsEnabled(connected)
	setFormSubmitting('tokens-form', true)
	setText('tokens-status', 'Saving universe approvals…')
	try {
		await api('/api/approved-universes', {
			body: JSON.stringify([...approvedUniverseIds]),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		if (requestEpoch !== profileRequestEpoch) return
		markFormClean('tokens-form')
		setText('tokens-status', 'Universe approvals saved.')
	} catch (error) {
		if (requestEpoch === profileRequestEpoch) setText('tokens-status', error instanceof Error ? error.message : String(error))
	} finally {
		universeSavePending = false
		setFormSubmitting('tokens-form', false)
		setControlsEnabled(connected)
	}
})

async function changePaused(paused: boolean) {
	const emergencyPauseAvailable = paused && latestSnapshot?.paused === false
	if ((!connected && !emergencyPauseAvailable) || (!paused && latestSnapshot?.networkConfigured !== true)) {
		closeResumePreflight()
		return
	}
	pauseRequestPending = paused ? 'pause' : 'resume'
	pauseFailure = undefined
	setControlsEnabled(connected)
	try {
		await api('/api/paused', {
			body: JSON.stringify({ paused }),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		await refresh()
		closeResumePreflight()
	} catch (error) {
		setControlsEnabled(false)
		pauseFailure = { message: error instanceof Error ? error.message : String(error), recoverySeen: false, requestedPaused: paused }
		if (latestSnapshot !== undefined) renderOperatorNotice(latestSnapshot)
	} finally {
		pauseRequestPending = undefined
		setControlsEnabled(connected)
	}
}

element('pause-button').addEventListener('click', () => {
	if (latestSnapshot === undefined) return
	if (latestSnapshot.paused && (!connected || !latestSnapshot.networkConfigured)) return
	if (latestSnapshot.paused && latestSnapshot.execute) {
		openResumePreflight(resumePreflightRows(latestSnapshot))
		return
	}
	void changePaused(!latestSnapshot.paused)
})

element('cancel-resume').addEventListener('click', closeResumePreflight)
element('confirm-resume').addEventListener('click', () => {
	if (!connected || latestSnapshot?.networkConfigured !== true) return
	void changePaused(false)
})

const dashboardPaths = new Set(['/overview', '/operations', '/games', '/markets', '/settings'])
const { scrollToSection, syncSectionNavigation } = createSectionNavigation(link => dashboardPaths.has(new URL(link.href).pathname))

registerFocusedSettingsForms({ api, refresh, syncControls: () => setControlsEnabled(connected) })
// The universe explorer keeps its selection outside form controls, so its signature is the sorted selection.
trackForm('tokens-form', { extra: () => [...approvedUniverseIds].sort().join(','), section: 'universes' })

element('connectivity-form', HTMLFormElement).addEventListener('submit', async event => {
	event.preventDefault()
	if (connectivityRequestPending) return
	const fieldset = element('connectivity-fieldset', HTMLFieldSetElement)
	const networkSelect = element('network-name', HTMLSelectElement)
	const selectedNetwork = networkSelect.value
	const selectedNetworkLabel = networkSelect.selectedOptions.item(0)?.textContent?.trim() ?? 'the selected chain'
	connectivityRequestPending = true
	fieldset.disabled = true
	setText('connectivity-status', `Checking every endpoint for ${selectedNetworkLabel}…`)
	try {
		const connectivity = {
			publicRpcUrls: urlLines(element('public-rpc-urls', HTMLTextAreaElement).value),
			readRpcUrl: element('read-rpc-url', HTMLInputElement).value.trim(),
		}
		const rpcQuorum = Number(element('rpc-quorum', HTMLSelectElement).value)
		const quorumRpcUrls = urlLines(element('quorum-rpc-urls', HTMLTextAreaElement).value)
		const response = decodeConnectivity(
			await api('/api/connectivity', {
				body: JSON.stringify({ connectivity, network: selectedNetwork, quorumRpcUrls, rpcQuorum }),
				headers: { 'content-type': 'application/json' },
				method: 'PUT',
			}),
		)
		loadConnectivity(response.connectivity)
		element('network-name', HTMLSelectElement).value = response.network
		element('network-name', HTMLSelectElement).disabled = false
		persistedNetwork = response.network
		const networkLabel = response.network === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
		setText('settings-chain-scope', `Editing the ${networkLabel} profile.`)
		element('rpc-quorum', HTMLSelectElement).value = response.rpcQuorum.toString()
		setLoadedRpcQuorum(response.rpcQuorum)
		applyQuorumRpcUrls(response.quorumRpcUrls)
		markFormClean('connectivity-form')
		updateNetworkTargetStatus()
		await refresh()
		setText('connectivity-status', 'Chain and RPCs passed validation and were saved.')
	} catch (error) {
		await refresh()
		setText('connectivity-status', error instanceof Error ? error.message : String(error))
	} finally {
		connectivityRequestPending = false
		setControlsEnabled(connected)
	}
})

element('create2-form', HTMLFormElement).addEventListener('submit', async event => {
	event.preventDefault()
	const button = element('deploy-executor-button', HTMLButtonElement)
	button.disabled = true
	setText('create2-status', 'Calculating the CREATE2 address…')
	try {
		const prediction = decodePrediction(
			await api('/api/executor-prediction', {
				body: JSON.stringify({}),
				headers: { 'content-type': 'application/json' },
				method: 'POST',
			}),
		)
		if (!(await confirmOperatorAction({ title: 'Deploy executor', description: `Deploy the executor at ${prediction.address} with the active local signer.`, phrase: 'DEPLOY EXECUTOR', confirmLabel: 'Deploy executor' }))) {
			setText('create2-status', `Deployment cancelled. Predicted executor address: ${prediction.address}.`)
			return
		}
		setText('create2-status', `Checking the canonical CREATE2 proxy before deploying ${prediction.address}…`)
		const result = decodeExecutorDeployment(
			await api('/api/executor-deployment', {
				body: JSON.stringify({}),
				headers: { 'content-type': 'application/json' },
				method: 'POST',
			}),
		)
		setText('deployment-executor', result.address)
		setText('create2-status', result.alreadyDeployed ? `Verified existing executor at ${result.address}.` : `Deployed ${result.address} in transaction ${result.transactionHash ?? 'unknown'}.`)
		// A verified deployment is the recovery the refusal asked for; do not wait for a poll that may never have shown the journal.
		if (pauseFailure?.message === EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED) pauseFailure = undefined
		await refresh()
	} catch (error) {
		setText('create2-status', error instanceof Error ? error.message : String(error))
	} finally {
		button.disabled = !connected
	}
})

async function updateSigner(privateKey: string | undefined, rememberSigner: boolean) {
	if (signerRequestPending) return
	const input = element('private-key', HTMLInputElement)
	signerRequestPending = true
	signerFeedback = { error: false, message: privateKey === undefined ? 'Clearing signer…' : 'Validating signer…' }
	if (latestSnapshot !== undefined) renderSignerStatus(latestSnapshot)
	try {
		await api('/api/signer', {
			body: JSON.stringify({ privateKey: privateKey ?? null, rememberSigner }),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		input.value = ''
		element('remember-signer', HTMLInputElement).checked = false
		signerFeedback = undefined
	} catch (error) {
		input.value = ''
		signerFeedback = { error: true, message: error instanceof Error ? error.message : String(error) }
	} finally {
		signerRequestPending = false
		await refresh()
	}
}

element('signer-form', HTMLFormElement).addEventListener('submit', event => {
	event.preventDefault()
	try {
		const privateKey = requiredSignerPrivateKey(element('private-key', HTMLInputElement).value)
		void updateSigner(privateKey, element('remember-signer', HTMLInputElement).checked)
	} catch (error) {
		signerFeedback = { error: true, message: error instanceof Error ? error.message : String(error) }
		if (latestSnapshot !== undefined) renderSignerStatus(latestSnapshot)
	}
})
element('clear-signer-button').addEventListener(
	'click',
	() =>
		void (async () => {
			if (await confirmOperatorAction({ title: 'Clear signer', description: 'Remove the active signer from this bot.', phrase: 'CLEAR SIGNER', confirmLabel: 'Clear signer' })) await updateSigner(undefined, false)
		})(),
)
element('forget-signer-button').addEventListener('click', async () => {
	if (signerRequestPending) return
	if (!(await confirmOperatorAction({ title: 'Forget saved signer', description: 'Remove the saved private key from the local operator file.', phrase: 'FORGET SIGNER', confirmLabel: 'Forget signer' }))) return
	signerRequestPending = true
	signerFeedback = { error: false, message: 'Removing the saved key…' }
	if (latestSnapshot !== undefined) renderSignerStatus(latestSnapshot)
	try {
		await api('/api/signer', {
			body: JSON.stringify({ forgetSavedSigner: true }),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		signerFeedback = undefined
	} catch (error) {
		signerFeedback = { error: true, message: error instanceof Error ? error.message : String(error) }
	} finally {
		signerRequestPending = false
		await refresh()
	}
})
element('private-key', HTMLInputElement).addEventListener('input', () => {
	if (signerRequestPending) return
	signerFeedback = undefined
	if (latestSnapshot !== undefined) renderSignerStatus(latestSnapshot)
})

createSettingsNavigation()
void refresh()
void loadCompleteConfiguration()
window.setInterval(() => void refresh(), 2_000)
window.setInterval(() => {
	if (connected && latestSnapshot !== undefined) renderPollRetry(latestSnapshot)
}, 1_000)
window.setInterval(renderBlockStatus, 1_000)
