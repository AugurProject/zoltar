import type { ConnectivitySettings } from '#monitoring/connectivity'
import type { OpportunitySnapshot, PublicExecutionRecord, PublicOperationEntry, PublicOperatorSnapshot, PublicPositionRecord, PublicTransactionActivity, StrategySettings } from '#state/operator-state'
import {
	blockAgeLabel,
	botStatusLabels,
	chartPointX,
	chartTimeTickIndexes,
	connectivityControlsDisabled,
	countLabel,
	exactAmount,
	marketPoolStrategyUse,
	marketPriceChartDescription,
	networkTargetStatus,
	opportunityDecisionReason,
	pauseControlState,
	persistedConnectivity,
	pollRetryStatus,
	requiredSignerPrivateKey,
	requestWithTimeout,
	selectedTokenPriceHistory,
	signerControlState,
	singleFlight,
	statePollingFailureMessage,
	sumSignedDecimals,
	transactionKindLabel,
	venueLabel,
} from './dashboard-format.js'
import type { SubmissionSettings } from '#execution/transaction-submission'
import type { DeploymentSettings } from '#config/deployment-settings'

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
let configurationLoaded = false
let configurationLoading = false
let configurationLoadError: string | undefined
let configurationRevision: string | undefined
let initialFragmentApplied = false
let connected = false
let signerFeedback: { error: boolean; message: string } | undefined
let signerRequestPending = false
let pauseRequestPending: 'pause' | 'resume' | undefined
let manualRefreshPending = false

const STATE_REQUEST_TIMEOUT_MS = 1_000
const CONFIGURATION_REQUEST_TIMEOUT_MS = 2_000
const PROFILE_SWITCH_REQUEST_TIMEOUT_MS = 2_000
const PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE = 'Profile switch request timed out.'

function element<T extends HTMLElement>(id: string) {
	const found = document.getElementById(id)
	if (!(found instanceof HTMLElement)) throw new Error(`Missing dashboard element: ${id}`)
	return found as T
}

function setText(id: string, value: string) {
	const target = element(id)
	if (target.textContent !== value) target.textContent = value
}

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
	const pauseButton = element<HTMLButtonElement>('pause-button')
	pauseButton.disabled = pauseRequestPending !== undefined || pauseControls.pauseDisabled
	pauseButton.textContent = pauseRequestPending === 'pause' ? 'Pausing…' : latestSnapshot?.paused === true ? 'Resume bot' : 'Pause bot'
	if (pauseRequestPending === 'pause') pauseButton.setAttribute('aria-busy', 'true')
	else pauseButton.removeAttribute('aria-busy')
	const confirmResume = element<HTMLButtonElement>('confirm-resume')
	confirmResume.disabled = pauseRequestPending !== undefined || pauseControls.confirmDisabled
	confirmResume.textContent = pauseRequestPending === 'resume' ? 'Resuming…' : 'Resume bot'
	if (pauseRequestPending === 'resume') confirmResume.setAttribute('aria-busy', 'true')
	else confirmResume.removeAttribute('aria-busy')
	if (!mutationsEnabled) closeResumePreflight()
	const fieldset = element('strategy-fieldset')
	if (!(fieldset instanceof HTMLFieldSetElement)) throw new Error('Missing strategy fieldset')
	fieldset.disabled = !focusedSettingsEnabled || !settingsLoaded
	const submissionFieldset = element('submission-fieldset')
	if (!(submissionFieldset instanceof HTMLFieldSetElement)) throw new Error('Missing submission fieldset')
	submissionFieldset.disabled = !focusedSettingsEnabled || !submissionLoaded
	for (const id of ['connectivity-fieldset', 'deployment-fieldset', 'create2-fieldset', 'signer-fieldset', 'tokens-fieldset']) {
		const fieldset = element(id)
		if (!(fieldset instanceof HTMLFieldSetElement)) throw new Error(`Missing ${id}`)
		if (id === 'connectivity-fieldset') fieldset.disabled = connectivityControlsDisabled(configurationEnabled, connectivityRequestPending) || !connectivityLoaded
		else if (id === 'deployment-fieldset' || id === 'create2-fieldset') fieldset.disabled = !focusedSettingsEnabled || !deploymentLoaded
		else if (id === 'tokens-fieldset') fieldset.disabled = !focusedSettingsEnabled || !tokensLoaded
		else fieldset.disabled = !focusedSettingsEnabled
	}
	element<HTMLSelectElement>('network-name').disabled = !enabled || pendingNetworkProfile !== undefined || persistedNetwork === undefined
	updateConfigurationControls()
}

function updateConfigurationControls() {
	const fieldset = element('configuration-fieldset')
	if (!(fieldset instanceof HTMLFieldSetElement)) throw new Error('Missing configuration fieldset')
	fieldset.disabled = !connected || pendingNetworkProfile !== undefined || !configurationLoaded || latestSnapshot?.networkConfigured !== true || configurationLoading
	element<HTMLButtonElement>('reload-configuration-button').disabled = !connected || (pendingNetworkProfile !== undefined && !profileSwitchTimedOut) || configurationLoading
	const profileRetry = element<HTMLButtonElement>('profile-switch-retry-button')
	profileRetry.hidden = !profileSwitchTimedOut
	profileRetry.disabled = !connected || configurationLoading
	element('profile-switch-retry-actions').hidden = !profileSwitchTimedOut
}

function updateSettingsLoadState() {
	const container = element('settings-load-state')
	const retry = element<HTMLButtonElement>('retry-settings-button')
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

function updateManualRefreshState() {
	const button = element<HTMLButtonElement>('refresh-button')
	button.disabled = manualRefreshPending
	button.textContent = manualRefreshPending ? 'Refreshing…' : 'Refresh'
	if (manualRefreshPending) button.setAttribute('aria-busy', 'true')
	else button.removeAttribute('aria-busy')
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
	element<HTMLSelectElement>('rpc-quorum').value = rpcQuorum.toString()
	const focused = persistedConnectivity(configuration)
	if (focused === undefined) {
		element<HTMLInputElement>('read-rpc-url').value = ''
		element<HTMLTextAreaElement>('public-rpc-urls').value = ''
		persistedNetwork = selectedNetwork
		element<HTMLSelectElement>('network-name').value = selectedNetwork
		const networkLabel = selectedNetwork === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
		setText('settings-chain-scope', `Editing the ${networkLabel} profile. Every setting and durable journal is retained only for this chain; selecting another chain loads its separate profile.`)
		element<HTMLSelectElement>('network-name').disabled = false
		connectivityLoaded = true
		updateNetworkTargetStatus()
		return
	}
	loadConnectivity(focused.connectivity)
	element<HTMLSelectElement>('network-name').value = focused.network
	element<HTMLSelectElement>('network-name').disabled = false
	persistedNetwork = focused.network
	const networkLabel = focused.network === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
	setText('settings-chain-scope', `Editing the ${networkLabel} profile. Every setting and durable journal is retained only for this chain; selecting another chain loads its separate profile.`)
	connectivityLoaded = true
	updateNetworkTargetStatus()
}

function shorten(value: string, leading = 8, trailing = 6) {
	return value.length <= leading + trailing + 1 ? value : `${value.slice(0, leading)}…${value.slice(-trailing)}`
}

function optionalInput(id: string) {
	const value = element<HTMLInputElement>(id).value.trim()
	return value === '' ? undefined : value
}

function lines(id: string) {
	return element<HTMLTextAreaElement>(id)
		.value.split('\n')
		.map(value => value.trim())
		.filter(Boolean)
}

function loadDeployment(deployment: DeploymentSettings) {
	element<HTMLInputElement>('deployment-rep').value = deployment.rep
	element<HTMLInputElement>('deployment-weth').value = deployment.weth
	element<HTMLInputElement>('deployment-open-oracle').value = deployment.openOracle
	element<HTMLInputElement>('deployment-executor').value = deployment.executor ?? ''
	element<HTMLInputElement>('deployment-v3-factory').value = deployment.uniswapFactory
	element<HTMLInputElement>('deployment-v3-quoter').value = deployment.uniswapQuoter
	element<HTMLInputElement>('deployment-v3-router').value = deployment.uniswapRouter ?? ''
	element<HTMLInputElement>('deployment-v2-router').value = deployment.uniswapV2Router ?? ''
	element<HTMLInputElement>('deployment-v4-pool-manager').value = deployment.uniswapV4PoolManager ?? ''
	element<HTMLInputElement>('deployment-v4-quoter').value = deployment.uniswapV4Quoter ?? ''
	element<HTMLTextAreaElement>('deployment-coordinators').value = deployment.coordinatorAddresses.join('\n')
	element<HTMLTextAreaElement>('deployment-quorum-rpcs').value = deployment.quorumRpcUrls.join('\n')
	element<HTMLTextAreaElement>('deployment-manifest').value = deployment.deploymentManifest === undefined ? '' : JSON.stringify(deployment.deploymentManifest, undefined, 2)
}

function amount(value: string | undefined, symbol: string) {
	if (value === undefined) return 'Unavailable'
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return `${value} ${symbol}`
	return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(numeric)} ${symbol}`
}

function isSnapshot(value: unknown): value is PublicOperatorSnapshot {
	return typeof value === 'object' && value !== null && 'status' in value && 'submission' in value && 'opportunities' in value && 'executionHistory' in value && 'positions' in value && 'transactionActivity' in value
}

function isConfigurationEnvelope(value: unknown): value is { configuration: unknown; revision: string } {
	return typeof value === 'object' && value !== null && 'configuration' in value && 'revision' in value && typeof value.revision === 'string'
}

function configurationNetwork(configuration: unknown) {
	const network = typeof configuration === 'object' && configuration !== null && !Array.isArray(configuration) ? Reflect.get(configuration, 'network') : undefined
	return network === 'mainnet' || network === 'sepolia' ? network : undefined
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
		const envelope = await requestWithTimeout(signal => api<unknown>('/api/configuration', { signal }), CONFIGURATION_REQUEST_TIMEOUT_MS, 'Configuration request timed out.')
		if (requestEpoch !== profileRequestEpoch) return
		if (!isConfigurationEnvelope(envelope)) throw new Error('Bot returned an invalid configuration document')
		const network = configurationNetwork(envelope.configuration)
		if (pendingNetworkProfile !== undefined && network !== pendingNetworkProfile) return
		element<HTMLTextAreaElement>('configuration-json').value = prettyJson(envelope.configuration)
		synchronizeFocusedConfiguration(envelope.configuration)
		configurationRevision = envelope.revision
		configurationLoaded = true
		configurationLoadError = undefined
		setText('configuration-status', '')
		if (network !== undefined) finishPendingProfileIfReady(network)
	} catch (error) {
		if (requestEpoch !== profileRequestEpoch) return
		configurationLoaded = false
		configurationLoadError = error instanceof Error ? error.message : String(error)
		configurationRevision = undefined
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

async function api<T>(path: string, init?: RequestInit) {
	const response = await fetch(path, init)
	const value: unknown = await response.json()
	if (!response.ok) {
		if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string') throw new Error(value.error)
		throw new Error(`Request failed with status ${response.status.toString()}`)
	}
	return value as T
}

function row(cells: readonly (HTMLElement | string)[], labels?: readonly string[]) {
	const tableRow = document.createElement('tr')
	for (const [index, value] of cells.entries()) {
		const cell = document.createElement('td')
		const label = labels?.[index]
		if (label !== undefined) cell.dataset['label'] = label
		if (typeof value === 'string') cell.textContent = value
		else cell.append(value)
		tableRow.append(cell)
	}
	return tableRow
}

function headingRow(labels: readonly string[]) {
	const tableRow = document.createElement('tr')
	for (const label of labels) {
		const cell = document.createElement('th')
		cell.scope = 'col'
		cell.textContent = label
		tableRow.append(cell)
	}
	return tableRow
}

function link(value: string, kind: 'address' | 'tx', focusKey: string) {
	const anchor = document.createElement('a')
	anchor.href = `${latestSnapshot?.explorerUrl ?? 'https://etherscan.io'}/${kind}/${value}`
	anchor.dataset['focusKey'] = focusKey
	anchor.target = '_blank'
	anchor.rel = 'noreferrer'
	anchor.textContent = shorten(value)
	anchor.title = value
	return anchor
}

function decisionBadge(opportunity: OpportunitySnapshot) {
	const badge = document.createElement('span')
	badge.className = 'decision'
	badge.dataset['decision'] = opportunity.decision
	badge.textContent = opportunity.decision.replaceAll('-', ' ')
	return badge
}

function renderBalances(snapshot: PublicOperatorSnapshot) {
	const list = element('balance-list')
	list.replaceChildren()
	setText('wallet-address', snapshot.wallet === undefined ? 'No execution wallet' : snapshot.wallet)
	if (snapshot.balances === undefined) {
		const empty = document.createElement('p')
		empty.className = 'balance-empty'
		empty.textContent = 'Set a local signer to load its ETH, WETH, REP, and executable portfolio balances.'
		list.append(empty)
		return
	}
	const values: [string, string][] = [
		['ETH', amount(snapshot.balances.availableEth, 'ETH')],
		['WETH', amount(snapshot.balances.availableWeth, 'WETH')],
		['REP', amount(snapshot.balances.availableRep, 'REP')],
		['REP executable value', amount(snapshot.balances.repValueWeth, 'WETH')],
		['Executable portfolio', amount(snapshot.balances.totalValueWeth, 'WETH')],
	]
	for (const [label, value] of values) {
		const container = document.createElement('div')
		container.className = 'balance-row'
		const name = document.createElement('span')
		name.textContent = label
		const balance = document.createElement('strong')
		balance.textContent = value
		container.append(name, balance)
		list.append(container)
	}
}

function renderOpportunities(opportunities: readonly OpportunitySnapshot[]) {
	const body = element<HTMLTableSectionElement>('opportunities-body')
	body.replaceChildren()
	for (const opportunity of opportunities) {
		body.append(
			row(
				[
					opportunity.reportId,
					decisionBadge(opportunity),
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
				['Report', 'Decision', 'Reference deviation', 'Executable REP / ETH', 'Reason', 'Direction', 'Estimated net', 'Required WETH', 'Required token', 'Window', 'Venue', 'Pool / manager'],
			),
		)
	}
	element('opportunities-empty').hidden = opportunities.length !== 0
	setText('opportunity-count', `${opportunities.length.toString()} evaluated`)
}

function renderHistory(history: readonly PublicExecutionRecord[], recordCount: number) {
	const body = element<HTMLTableSectionElement>('history-body')
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
	const body = element<HTMLTableSectionElement>('positions-body')
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

function input(name: keyof StrategySettings) {
	const found = document.querySelector(`[name="${name}"]`)
	if (!(found instanceof HTMLInputElement)) throw new Error(`Missing strategy input: ${name}`)
	return found
}

function loadSettings(settings: StrategySettings) {
	input('minimumProfitWeth').value = settings.minimumProfitWeth
	input('minimumProfitBps').value = settings.minimumProfitBps
	input('maxSpotTwapTicks').value = settings.maxSpotTwapTicks
	input('twapSeconds').value = settings.twapSeconds.toString()
	input('minimumRemainingBlocks').value = settings.minimumRemainingBlocks
	input('minimumRemainingSeconds').value = settings.minimumRemainingSeconds
	input('pollMilliseconds').value = settings.pollMilliseconds.toString()
}

function loadSubmission(submission: SubmissionSettings) {
	const mode = element<HTMLSelectElement>('submission-mode')
	mode.value = submission.mode
	element<HTMLTextAreaElement>('relay-urls').value = submission.relayUrls.join('\n')
	element<HTMLInputElement>('minimum-bundle-relay-successes').value = submission.minimumBundleRelaySuccesses.toString()
}

function loadConnectivity(connectivity: ConnectivitySettings) {
	element<HTMLInputElement>('read-rpc-url').value = connectivity.readRpcUrl
	element<HTMLTextAreaElement>('public-rpc-urls').value = connectivity.publicRpcUrls.join('\n')
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isStrategySettings(value: unknown): value is StrategySettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	return (
		typeof Reflect.get(value, 'maxSpotTwapTicks') === 'string' &&
		typeof Reflect.get(value, 'minimumProfitBps') === 'string' &&
		typeof Reflect.get(value, 'minimumProfitWeth') === 'string' &&
		typeof Reflect.get(value, 'minimumRemainingBlocks') === 'string' &&
		typeof Reflect.get(value, 'minimumRemainingSeconds') === 'string' &&
		typeof Reflect.get(value, 'pollMilliseconds') === 'number' &&
		typeof Reflect.get(value, 'twapSeconds') === 'number'
	)
}

function isSubmissionSettings(value: unknown): value is SubmissionSettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const mode = Reflect.get(value, 'mode')
	return (mode === 'private' || mode === 'public') && typeof Reflect.get(value, 'minimumBundleRelaySuccesses') === 'number' && isStringArray(Reflect.get(value, 'relayUrls'))
}

function isDeploymentSettings(value: unknown): value is DeploymentSettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	for (const key of ['openOracle', 'rep', 'uniswapFactory', 'uniswapQuoter', 'weth']) {
		if (typeof Reflect.get(value, key) !== 'string') return false
	}
	for (const key of ['executor', 'uniswapRouter', 'uniswapV2Router', 'uniswapV4PoolManager', 'uniswapV4Quoter']) {
		const candidate = Reflect.get(value, key)
		if (candidate !== undefined && candidate !== null && typeof candidate !== 'string') return false
	}
	return isStringArray(Reflect.get(value, 'coordinatorAddresses')) && isStringArray(Reflect.get(value, 'quorumRpcUrls'))
}

function synchronizeFocusedConfiguration(configuration: unknown) {
	if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) throw new Error('Bot returned an invalid configuration document')
	const strategy = Reflect.get(configuration, 'strategy')
	const submission = Reflect.get(configuration, 'submission')
	const deployment = Reflect.get(configuration, 'deployment')
	const tokenAddresses = Reflect.get(configuration, 'tokenAddresses')
	if (!isStrategySettings(strategy) || !isSubmissionSettings(submission) || !isDeploymentSettings(deployment) || !isStringArray(tokenAddresses)) throw new Error('Bot returned an invalid configuration document')
	loadSettings(strategy)
	settingsLoaded = true
	loadSubmission(submission)
	submissionLoaded = true
	synchronizePersistedConnectivity(configuration)
	loadDeployment(deployment)
	deploymentLoaded = true
	element<HTMLTextAreaElement>('token-addresses').value = tokenAddresses.join('\n')
	tokensLoaded = true
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
		const item = document.createElement('div')
		item.className = 'endpoint-check'
		item.dataset['status'] = check.status
		const status = document.createElement('strong')
		status.textContent = check.status
		const target = document.createElement('span')
		target.className = 'mono'
		target.textContent = check.target
		const detail = document.createElement('small')
		detail.textContent = check.error ?? `Chain ${check.chainId?.toString() ?? 'unconfirmed'} · ${check.kind}`
		item.append(status, target, detail)
		container.append(item)
	}
	const runtimeHealth = endpointChecksMatchActiveChain ? (snapshot.rpcEndpointHealth ?? []) : []
	if (runtimeHealth.length > 0) {
		const heading = document.createElement('h3')
		heading.className = 'endpoint-check-heading'
		heading.textContent = 'Live RPC health'
		container.append(heading)
	}
	for (const endpoint of runtimeHealth) {
		const item = document.createElement('div')
		item.className = 'endpoint-check'
		item.dataset['status'] = endpoint.status
		const status = document.createElement('strong')
		status.textContent = endpoint.status
		const target = document.createElement('span')
		target.className = 'mono'
		target.textContent = endpoint.target
		const detail = document.createElement('small')
		const metadata = [endpoint.consecutiveFailures > 0 ? `${endpoint.consecutiveFailures.toString()} consecutive failure${endpoint.consecutiveFailures === 1 ? '' : 's'}` : undefined, endpoint.nextRetryAt === undefined ? undefined : `retry ${new Date(endpoint.nextRetryAt).toLocaleTimeString()}`].filter(
			value => value !== undefined,
		)
		const primaryDetail = endpoint.error ?? (endpoint.latencyMilliseconds === undefined ? 'Awaiting first request' : `${endpoint.latencyMilliseconds.toString()} ms`)
		detail.textContent = [primaryDetail, ...metadata].join(' · ')
		item.append(status, target, detail)
		container.append(item)
	}
}

function renderOperations(operations: readonly PublicOperationEntry[]) {
	const visibleOperations = operations.filter(operation => operation.category !== 'scan')
	const body = element<HTMLTableSectionElement>('operations-body')
	body.replaceChildren()
	for (const operation of visibleOperations) {
		const level = document.createElement('span')
		level.className = 'log-level'
		level.dataset['level'] = operation.level
		level.textContent = operation.level
		body.append(row([new Date(operation.timestamp).toLocaleTimeString(), level, operation.category, operation.reportId ?? '—', operation.message, operation.reason ?? '—', operation.details ?? '—'], ['Time', 'Level', 'Category', 'Report', 'Operation', 'Why', 'Details']))
	}
	element('operations-empty').hidden = visibleOperations.length !== 0
	setText('operation-count', countLabel(visibleOperations.length, 'entry', 'entries'))
}

function renderTokenMarkets(snapshot: PublicOperatorSnapshot) {
	setText('tracked-token-addresses', snapshot.tokenAddresses.length === 0 ? 'None observed' : snapshot.tokenAddresses.join(' · '))
	const body = element<HTMLTableSectionElement>('token-markets-body')
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
	const body = element<HTMLTableSectionElement>('centralized-market-body')
	body.replaceChildren()
	const market = snapshot.centralizedMarket
	const consensus = snapshot.marketConsensus
	setText('dex-market-price', consensus?.dex.reliable === true ? consensus.dex.priceRepPerEth : '—')
	setText('guarded-market-price', consensus?.reliable === true ? (consensus.priceRepPerEth ?? '—') : '—')
	setText('dex-market-bid-depth', consensus === undefined ? '—' : `${consensus.dex.bidDepthEth} ETH`)
	setText('dex-market-ask-depth', consensus === undefined ? '—' : `${consensus.dex.askDepthEth} ETH`)
	if (market === undefined) {
		setText('centralized-market-status', consensus === undefined ? 'No market sources configured' : consensus.reliable ? 'Reliable DEX consensus' : consensus.reasons.join(' · '))
		setText('centralized-market-price', '—')
		setText('centralized-market-bid-depth', '—')
		setText('centralized-market-ask-depth', '—')
		setText('centralized-market-source-count', consensus === undefined ? '0 CEX' : `${consensus.cex.sourceCount.toString()} CEX · ${consensus.dex.sourceCount.toString()} DEX`)
		element('centralized-market-empty').hidden = false
		return
	}
	setText('centralized-market-status', consensus === undefined ? (market.reliable ? 'Reliable CEX estimate' : market.reasons.join(' · ')) : consensus.reliable ? 'Reliable independent CEX + DEX consensus' : consensus.reasons.join(' · '))
	setText('centralized-market-price', market.priceRepPerEth)
	setText('centralized-market-bid-depth', `${market.bidDepthEth} ETH`)
	setText('centralized-market-ask-depth', `${market.askDepthEth} ETH`)
	setText('centralized-market-source-count', consensus === undefined ? `${market.observations.length.toString()} CEX` : `${consensus.cex.sourceCount.toString()} CEX · ${consensus.dex.sourceCount.toString()} DEX`)
	for (const observation of market.observations) {
		body.append(row([observation.exchangeId, observation.repMarket, observation.priceRepPerEth, `${observation.bidDepthEth} ETH`, `${observation.askDepthEth} ETH`, new Date(observation.observedAt).toLocaleTimeString()], ['Exchange', 'Market', 'REP / ETH', 'Bid depth', 'Ask depth', 'Observed']))
	}
	element('centralized-market-empty').hidden = market.observations.length !== 0
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

const SERIES_COLORS = ['#77e0ad', '#88b8ff', '#f0c36b', '#ff8b8b', '#c69cff', '#63d6e5']
const SERIES_DASHES = ['', '10 6', '3 5', '14 5 3 5', '2 3', '18 6']

function svgText(value: string, x: number, y: number, anchor: 'start' | 'middle' | 'end' = 'start') {
	const label = document.createElementNS(SVG_NAMESPACE, 'text')
	label.textContent = value
	label.setAttribute('x', x.toString())
	label.setAttribute('y', y.toString())
	label.setAttribute('text-anchor', anchor)
	return label
}

function chartPrice(value: number) {
	return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 5, notation: 'scientific' }).format(value)
}

function renderMarketPriceChart(snapshot: PublicOperatorSnapshot) {
	const selector = element<HTMLSelectElement>('price-token')
	const selected = selector.value
	const tokens = [...new Map(snapshot.priceHistory.map(point => [point.token.toLowerCase(), { address: point.token, symbol: point.symbol }])).values()]
	selector.replaceChildren(...tokens.map(token => new Option(`${token.symbol} · ${shorten(token.address)}`, token.address)))
	if (tokens.some(token => token.address === selected)) selector.value = selected
	const token = selector.value
	const points = selectedTokenPriceHistory(snapshot.priceHistory, token)
	const container = element('market-price-chart')
	const previousSamples = container.querySelector<HTMLDetailsElement>('details.chart-data')
	const samplesWereOpen = previousSamples?.open === true
	const samplesWereFocused = previousSamples?.querySelector('summary') === document.activeElement
	container.replaceChildren()
	setText('price-point-count', `${countLabel(points.length, 'persisted sample')}`)
	if (points.length === 0) {
		container.textContent = 'No quoted price samples are available for this token.'
		return
	}
	const values = points.map(point => Number(point.priceWeth)).filter(Number.isFinite)
	const minimum = Math.min(...values)
	const maximum = Math.max(...values)
	const range = maximum - minimum || Math.max(maximum, 1)
	const width = Math.max(container.clientWidth, 320)
	const compact = width < 600
	const height = compact ? 300 : 270
	const plot = { bottom: compact ? 250 : 220, left: 105, right: width - 70, top: 24 }
	const plotWidth = plot.right - plot.left
	const plotHeight = plot.bottom - plot.top
	const orderedPoints = [...points].sort((left, right) => Date.parse(left.sampledAt) - Date.parse(right.sampledAt))
	const times = orderedPoints.map(point => Date.parse(point.sampledAt))
	const first = Math.min(...times)
	const last = Math.max(...times)
	const timeRange = last - first || 1
	const series = [...new Map(points.map(point => [point.pool.toLowerCase(), point.venue])).entries()]
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg')
	svg.setAttribute('viewBox', `0 0 ${width.toString()} ${height.toString()}`)
	svg.setAttribute('role', 'img')
	const titleId = 'market-price-chart-title'
	const descriptionId = 'market-price-chart-description'
	svg.setAttribute('aria-labelledby', `${titleId} ${descriptionId}`)
	const title = document.createElementNS(SVG_NAMESPACE, 'title')
	title.id = titleId
	title.textContent = `${points[0]?.symbol ?? 'Token'} spot price in WETH by exchange pool`
	const description = document.createElementNS(SVG_NAMESPACE, 'desc')
	description.id = descriptionId
	description.textContent = marketPriceChartDescription(points)
	svg.append(title, description)
	for (const fraction of [0, 0.5, 1]) {
		const y = plot.bottom - fraction * plotHeight
		const value = minimum + fraction * range
		const grid = document.createElementNS(SVG_NAMESPACE, 'line')
		grid.setAttribute('x1', plot.left.toString())
		grid.setAttribute('x2', plot.right.toString())
		grid.setAttribute('y1', y.toString())
		grid.setAttribute('y2', y.toString())
		grid.setAttribute('class', 'chart-grid')
		svg.append(grid, svgText(`${chartPrice(value)} WETH`, plot.left - 10, y + 4, 'end'))
	}
	const xTicks = chartTimeTickIndexes(times, compact, plotWidth)
		.map(index => orderedPoints[index])
		.filter(point => point !== undefined)
	for (const point of xTicks) {
		const x = plot.left + ((Date.parse(point.sampledAt) - first) / timeRange) * plotWidth
		const blockLabel = svgText(`Block ${point.blockNumber}`, x, height - 26, 'middle')
		const timeLabel = svgText(new Date(point.sampledAt).toLocaleTimeString(), x, height - 8, 'middle')
		blockLabel.setAttribute('class', 'chart-axis-label')
		timeLabel.setAttribute('class', 'chart-axis-label')
		svg.append(blockLabel, timeLabel)
	}
	for (const [index, [pool]] of series.entries()) {
		const poolPoints = orderedPoints.filter(point => point.pool.toLowerCase() === pool)
		const coordinates = poolPoints.map(point => {
			const x = plot.left + ((Date.parse(point.sampledAt) - first) / timeRange) * plotWidth
			const y = plot.bottom - ((Number(point.priceWeth) - minimum) / range) * plotHeight
			return { point, x, y }
		})
		const polyline = document.createElementNS(SVG_NAMESPACE, 'polyline')
		polyline.setAttribute('points', coordinates.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '))
		polyline.setAttribute('fill', 'none')
		polyline.setAttribute('stroke', SERIES_COLORS[index % SERIES_COLORS.length] ?? '#77e0ad')
		polyline.setAttribute('stroke-dasharray', SERIES_DASHES[index % SERIES_DASHES.length] ?? '')
		polyline.setAttribute('stroke-width', '3')
		polyline.setAttribute('vector-effect', 'non-scaling-stroke')
		svg.append(polyline)
		for (const { point, x, y } of coordinates) {
			const marker = document.createElementNS(SVG_NAMESPACE, 'circle')
			marker.setAttribute('cx', x.toFixed(2))
			marker.setAttribute('cy', y.toFixed(2))
			marker.setAttribute('r', '4')
			marker.setAttribute('fill', SERIES_COLORS[index % SERIES_COLORS.length] ?? '#77e0ad')
			const tooltip = document.createElementNS(SVG_NAMESPACE, 'title')
			tooltip.textContent = `${point.venue}: ${point.priceWeth} WETH at block ${point.blockNumber}, ${new Date(point.sampledAt).toLocaleString()}`
			marker.append(tooltip)
			svg.append(marker)
		}
	}
	const legend = document.createElement('div')
	legend.className = 'chart-legend'
	for (const [index, [pool, venue]] of series.entries()) {
		const item = document.createElement('span')
		item.style.setProperty('--series-color', SERIES_COLORS[index % SERIES_COLORS.length] ?? '#77e0ad')
		item.textContent = `${venue} · ${shorten(pool)}`
		legend.append(item)
	}
	const samples = document.createElement('details')
	samples.className = 'chart-data'
	const summary = document.createElement('summary')
	summary.dataset['focusKey'] = `price-samples:${token}:summary`
	const recentPoints = orderedPoints.slice(-100).reverse()
	summary.textContent = `Recent exact price samples (${recentPoints.length.toString()} of ${countLabel(points.length, 'sample')})`
	const tableScroll = document.createElement('div')
	tableScroll.className = 'table-scroll'
	tableScroll.tabIndex = 0
	tableScroll.setAttribute('aria-label', 'Recent exact token price samples')
	const table = document.createElement('table')
	const head = document.createElement('thead')
	head.append(headingRow(['Block', 'Observed', 'Exchange pool', 'Price']))
	const body = document.createElement('tbody')
	for (const point of recentPoints) body.append(row([point.blockNumber, new Date(point.sampledAt).toLocaleString(), point.venue, `${point.priceWeth} WETH`]))
	table.append(head, body)
	tableScroll.append(table)
	samples.append(summary, tableScroll)
	container.append(svg, legend, samples)
	samples.open = samplesWereOpen
	if (samplesWereFocused) summary.focus({ preventScroll: true })
}

function renderSignerStatus(snapshot: PublicOperatorSnapshot) {
	const privateKeyInput = element<HTMLInputElement>('private-key')
	const rememberSignerInput = element<HTMLInputElement>('remember-signer')
	const signerStatus = element('signer-status')
	if (signerFeedback !== undefined) {
		signerStatus.textContent = signerFeedback.message
		signerStatus.setAttribute('role', signerFeedback.error ? 'alert' : 'status')
		privateKeyInput.setAttribute('aria-invalid', signerFeedback.error.toString())
	} else {
		signerStatus.setAttribute('role', 'status')
		privateKeyInput.setAttribute('aria-invalid', 'false')
		const activeSigner = snapshot.wallet === undefined ? 'no active signer' : `active ${shorten(snapshot.wallet)}`
		const savedSigner = snapshot.savedWallet === undefined ? 'not saved' : `saved ${shorten(snapshot.savedWallet)}`
		if (snapshot.queuedWallet === null) signerStatus.textContent = `Clearing signer · ${activeSigner}`
		else if (typeof snapshot.queuedWallet === 'string') signerStatus.textContent = `Applying ${shorten(snapshot.queuedWallet)} · ${activeSigner}`
		else if (snapshot.wallet === undefined) signerStatus.textContent = snapshot.savedWallet === undefined ? 'Locked · no signer' : `Locked · ${shorten(snapshot.savedWallet)} available`
		else if (snapshot.savedWallet === undefined) signerStatus.textContent = `Unlocked · ${shorten(snapshot.wallet)} · memory only`
		else if (snapshot.savedWallet.toLowerCase() === snapshot.wallet.toLowerCase()) signerStatus.textContent = `Unlocked · ${shorten(snapshot.wallet)} · saved`
		else signerStatus.textContent = `Unlocked · ${shorten(snapshot.wallet)} · ${savedSigner}`
	}
	const controls = signerControlState({
		hasQueuedSigner: typeof snapshot.queuedWallet === 'string',
		hasWallet: snapshot.wallet !== undefined,
		privateKey: privateKeyInput.value,
		requestPending: signerRequestPending,
	})
	privateKeyInput.disabled = controls.inputDisabled
	rememberSignerInput.disabled = controls.inputDisabled
	element<HTMLButtonElement>('clear-signer-button').disabled = controls.clearDisabled
	element<HTMLButtonElement>('forget-signer-button').disabled = signerRequestPending || snapshot.savedWallet === undefined
	element<HTMLButtonElement>('set-signer-button').disabled = controls.setDisabled
}

function renderBlockStatus(snapshot = latestSnapshot) {
	setText('block-value', snapshot?.blockNumber === undefined ? 'Block — · waiting for first observation' : `Block ${snapshot.blockNumber} · ${blockAgeLabel(snapshot.blockTimestamp)}`)
}

function renderTransactions(transactions: readonly PublicTransactionActivity[]) {
	const body = element<HTMLTableSectionElement>('transactions-body')
	body.replaceChildren()
	for (const transaction of transactions) {
		const accepted = transaction.acceptedTargets.map(target => `accepted: ${target}`)
		const failed = transaction.failedTargets.map(target => `failed: ${target.target}${target.error === undefined ? '' : ` (${target.error})`}`)
		const targets = [...accepted, ...failed].join(', ') || '—'
		body.append(
			row(
				[
					new Date(transaction.updatedAt).toLocaleString(),
					transaction.reportId,
					link(transaction.hash, 'tx', `transaction:${transaction.reportId}:${transaction.hash}`),
					transactionKindLabel(transaction),
					transaction.mode,
					transaction.status.replaceAll('-', ' '),
					targets,
					exactAmount(transaction.estimatedNetProfitEth, 'ETH'),
					exactAmount(transaction.trackedNetProfitEth, 'ETH'),
					exactAmount(transaction.actualGasCostEth, 'ETH'),
				],
				['Updated', 'Report', 'Transaction', 'Kind', 'Delivery', 'Status', 'Target results', 'Estimated net', 'Tracked net', 'Actual gas'],
			),
		)
	}
	element('transactions-empty').hidden = transactions.length !== 0
	setText('transaction-count', `${transactions.length.toString()} tracked`)
}

function render(snapshot: PublicOperatorSnapshot) {
	const activeElement = document.activeElement
	const focusKey = activeElement instanceof HTMLElement ? activeElement.dataset['focusKey'] : undefined
	const scrollPosition = { left: window.scrollX, top: window.scrollY }
	latestSnapshot = snapshot
	setControlsEnabled(true)
	const modeBadge = element('mode-badge')
	const statusLabels = botStatusLabels(snapshot)
	modeBadge.className = 'badge'
	modeBadge.dataset['mode'] = snapshot.mode
	modeBadge.textContent = statusLabels.mode
	const runStatusBadge = element('run-status-badge')
	const runStatus = snapshot.paused ? 'paused' : snapshot.status
	runStatusBadge.dataset['status'] = runStatus
	runStatusBadge.textContent = statusLabels.status
	runStatusBadge.className = `badge${runStatus === 'running' ? ' badge-ok' : runStatus === 'error' ? ' badge-danger' : ' badge-warning'}`
	const capabilityBadge = element('capability-badge')
	capabilityBadge.textContent = snapshot.operatorCapable ? 'Operator capable' : 'Operator blocked'
	capabilityBadge.className = `badge${snapshot.operatorCapable ? ' badge-ok' : ' badge-warning'}`
	renderPollRetry(snapshot)
	const headerNetworkBadge = element('header-network-badge')
	headerNetworkBadge.textContent = snapshot.networkConfigured ? `${snapshot.network} · ${snapshot.expectedChainId.toString()}` : 'Network setup'
	headerNetworkBadge.className = `badge${snapshot.networkConfigured ? '' : ' badge-warning'}`
	const recoveryCount = snapshot.positions.filter(position => position.status === 'recovery-required').length
	const uncertainTransactionCount = snapshot.transactionActivity.filter(transaction => transaction.status === 'confirmation-unknown').length
	const networkSetupCount = snapshot.networkConfigured ? 0 : 1
	const attentionCount = networkSetupCount + recoveryCount + uncertainTransactionCount + (snapshot.lastError === undefined ? 0 : 1)
	const attentionBadge = element<HTMLAnchorElement>('attention-badge')
	attentionBadge.textContent = attentionCount === 0 ? 'No blockers' : `${attentionCount.toString()} ${attentionCount === 1 ? 'action' : 'actions'}`
	attentionBadge.className = `badge attention-badge${attentionCount === 0 ? ' badge-ok' : ' badge-warning'}`
	attentionBadge.href = networkSetupCount > 0 ? '/settings#network-connectivity' : recoveryCount > 0 ? '/operations#position-lifecycle' : uncertainTransactionCount > 0 ? '/operations#transaction-tracking' : snapshot.lastError === undefined ? '/overview' : '/overview#notice'
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
	setText('risk-open-positions', `${snapshot.risk.usage.openPositions.toString()} / ${snapshot.risk.limits.maxConcurrentPositions.toString()}`)
	setText('risk-locked', `${exactAmount(snapshot.risk.usage.lockedWeth, 'WETH')} / ${exactAmount(snapshot.risk.limits.maxTotalLockedWeth, 'WETH')}`)
	setText('risk-daily-gas', `${exactAmount(snapshot.risk.usage.dailyGasSpentWeth, 'ETH')} / ${exactAmount(snapshot.risk.limits.maxDailyGasSpendWeth, 'ETH')}`)
	setText('risk-position-limit', exactAmount(snapshot.risk.limits.maxPositionNotionalWeth, 'WETH'))
	setText('risk-lifecycle-reserve', exactAmount(snapshot.risk.limits.lifecycleGasReserveWeth, 'ETH'))
	setText('oracle-address', `Oracle ${snapshot.openOracle}`)
	setText('executor-address', snapshot.executor === undefined ? 'Executor not configured' : `Executor ${snapshot.executor}`)
	setText('network-value', snapshot.networkConfigured ? `Active: ${snapshot.network} · chain ${snapshot.expectedChainId.toString()}` : 'Network not configured')
	updateNetworkTargetStatus()
	setText('chain-safety', snapshot.networkConfigured ? '' : 'Set the chain and RPC endpoints in RPC connectivity before scanning.')
	renderSignerStatus(snapshot)
	const launchNotice = element('launch-notice')
	if (!snapshot.networkConfigured) {
		launchNotice.hidden = false
		setText('launch-notice-title', 'Network setup required')
		setText('launch-notice-copy', 'Choose the chain and verified RPC endpoints below. They apply to the next scan; the bot remains paused until you resume it.')
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
	const notice = element('notice')
	let noticeTitle = 'Dry-run mode'
	let noticeCopy = 'Opportunities are monitored, but this process cannot submit transactions. Enable runtime.execute in the configuration to change modes.'
	let noticeTone = 'info'
	if (snapshot.execute) {
		noticeTitle = 'Execution mode is locally armed'
		noticeCopy = 'The local wallet can submit disputes when every strategy, timing, inventory, state, and delivery guard passes.'
		noticeTone = 'warning'
	}
	if (snapshot.paused) {
		noticeTitle = 'Bot paused'
		noticeCopy = 'New entries are paused. Settlement and withdrawal continue for already-funded positions so capital is not stranded.'
		noticeTone = 'warning'
	}
	if (snapshot.lastError !== undefined) {
		const retry = pollRetryStatus(snapshot)
		noticeTitle = snapshot.retryInProgress ? 'Automatic retry in progress' : retry?.state === 'due' ? 'Automatic retry due' : snapshot.lastPollFailureAt === undefined ? 'Operator attention required' : 'Latest poll failed'
		const failure = retry === undefined ? snapshot.lastError : snapshot.lastError.replace(/ Automatic retry remains active\.$/, '')
		const failureTime = snapshot.lastPollFailureAt === undefined ? '' : ` Poll failed at ${new Date(snapshot.lastPollFailureAt).toLocaleTimeString()}.`
		const nextRetry = retry?.state === 'scheduled' && snapshot.nextRetryAt !== undefined ? ` Next automatic retry is scheduled for ${new Date(snapshot.nextRetryAt).toLocaleTimeString()}.` : ''
		const retryDue = retry?.state === 'due' && snapshot.nextRetryAt !== undefined ? ` Automatic retry became due at ${new Date(snapshot.nextRetryAt).toLocaleTimeString()}.` : ''
		const lastRetry = snapshot.lastRetryAt === undefined ? '' : ` ${snapshot.retryInProgress ? 'Automatic retry' : 'Last automatic retry'} started at ${new Date(snapshot.lastRetryAt).toLocaleTimeString()}.`
		noticeCopy = `${failure}${failureTime}${nextRetry}${retryDue}${lastRetry}`
		noticeTone = 'danger'
	}
	setText('notice-title', noticeTitle)
	setText('notice-copy', noticeCopy)
	notice.dataset['tone'] = noticeTone
	renderBalances(snapshot)
	renderOpportunities(snapshot.opportunities)
	renderTransactions(snapshot.transactionActivity)
	renderEndpointChecks(snapshot)
	renderOperations(snapshot.operationLog)
	renderHistory(snapshot.executionHistory, snapshot.executionHistoryRecordCount)
	renderPositions(snapshot.positions, snapshot.positionRecordCount)
	renderTokenMarkets(snapshot)
	renderCentralizedMarket(snapshot)
	renderDisputePaths(snapshot)
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
	badge.className = `badge ${retry?.state === 'retrying' ? 'badge-danger' : 'badge-warning'}`
}

function clearPollRetry() {
	const badge = element('retry-status-badge')
	badge.parentElement?.removeAttribute('data-retry-active')
	badge.hidden = true
	badge.textContent = 'Retry —'
	badge.className = 'badge badge-warning'
}

const refresh = singleFlight(async () => {
	const requestEpoch = profileRequestEpoch
	try {
		const value: unknown = await requestWithTimeout(signal => api<unknown>('/api/state', { signal }), STATE_REQUEST_TIMEOUT_MS)
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
		setControlsEnabled(false)
		clearPollRetry()
		const modeBadge = element('mode-badge')
		const statusLabels = botStatusLabels(undefined)
		delete modeBadge.dataset['mode']
		modeBadge.textContent = 'Mode unavailable'
		modeBadge.className = 'badge badge-danger'
		const runStatusBadge = element('run-status-badge')
		runStatusBadge.dataset['status'] = 'disconnected'
		runStatusBadge.textContent = 'Disconnected'
		runStatusBadge.className = 'badge badge-danger'
		const attentionBadge = element<HTMLAnchorElement>('attention-badge')
		const retainedAttentionCount = latestSnapshot === undefined ? 0 : latestSnapshot.positions.filter(position => position.status === 'recovery-required').length + latestSnapshot.transactionActivity.filter(transaction => transaction.status === 'confirmation-unknown').length + (latestSnapshot.networkConfigured ? 0 : 1)
		const attentionCount = retainedAttentionCount + 1
		attentionBadge.textContent = `${attentionCount.toString()} ${attentionCount === 1 ? 'action' : 'actions'}`
		attentionBadge.className = 'badge attention-badge badge-danger'
		attentionBadge.href = '/overview#notice'
		const headerNetworkBadge = element('header-network-badge')
		if (latestSnapshot?.networkConfigured === true) headerNetworkBadge.textContent = `${latestSnapshot.network} · ${latestSnapshot.expectedChainId.toString()} · last known`
		else if (latestSnapshot !== undefined) headerNetworkBadge.textContent = 'Network setup · last known'
		else headerNetworkBadge.textContent = 'Network unavailable'
		headerNetworkBadge.className = 'badge badge-warning'
		setText('status-value', statusLabels.status)
		setText('notice-title', 'Dashboard disconnected')
		setText('notice-copy', statePollingFailureMessage(error))
		element('notice').dataset['tone'] = 'danger'
	}
})

async function manualRefresh() {
	if (manualRefreshPending) return
	manualRefreshPending = true
	updateManualRefreshState()
	try {
		await refresh()
	} finally {
		manualRefreshPending = false
		updateManualRefreshState()
	}
}

element('refresh-button').addEventListener('click', () => void manualRefresh())
element('reload-configuration-button').addEventListener('click', () => void loadCompleteConfiguration())
element<HTMLButtonElement>('profile-switch-retry-button').addEventListener('click', async event => {
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

element<HTMLSelectElement>('network-name').addEventListener('change', async event => {
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
element<HTMLFormElement>('configuration-form').addEventListener('submit', async event => {
	event.preventDefault()
	const button = element<HTMLFormElement>('configuration-form').querySelector('button[type="submit"]')
	if (!(button instanceof HTMLButtonElement)) return
	button.disabled = true
	setText('configuration-status', 'Validating complete configuration…')
	try {
		const value: unknown = JSON.parse(element<HTMLTextAreaElement>('configuration-json').value)
		if (configurationRevision === undefined) throw new Error('Reload the configuration before saving')
		const response = await api<unknown>('/api/configuration', {
			body: prettyJson({ configuration: value, revision: configurationRevision }),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		if (!isConfigurationEnvelope(response)) throw new Error('Bot returned an invalid configuration document')
		element<HTMLTextAreaElement>('configuration-json').value = prettyJson(response.configuration)
		synchronizeFocusedConfiguration(response.configuration)
		configurationRevision = response.revision
		setText('configuration-status', 'Complete configuration saved. Changes apply at the next scan boundary.')
	} catch (error) {
		setText('configuration-status', error instanceof Error ? error.message : String(error))
	} finally {
		button.disabled = !connected
	}
})
element<HTMLSelectElement>('price-token').addEventListener('change', () => {
	if (latestSnapshot !== undefined) renderMarketPriceChart(latestSnapshot)
})
element('tokens-form').addEventListener('submit', async event => {
	event.preventDefault()
	const addresses = element<HTMLTextAreaElement>('token-addresses')
		.value.split('\n')
		.map(value => value.trim())
		.filter(Boolean)
	try {
		await api('/api/tokens', {
			body: JSON.stringify(addresses),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		setText('tokens-status', 'Token list checked and saved. Discovery refreshes on the next block.')
	} catch (error) {
		setText('tokens-status', error instanceof Error ? error.message : String(error))
	}
})

function preflightItem(label: string, value: string) {
	const item = document.createElement('li')
	const name = document.createElement('span')
	name.textContent = label
	const status = document.createElement('strong')
	status.textContent = value
	item.append(name, status)
	return item
}

function openResumePreflight(snapshot: PublicOperatorSnapshot) {
	const recoveryCount = snapshot.positions.filter(position => position.status === 'recovery-required').length
	const uncertainTransactions = snapshot.transactionActivity.filter(transaction => transaction.status === 'confirmation-unknown').length
	const selectedOpportunities = snapshot.opportunities.filter(opportunity => opportunity.decision === 'selected' || opportunity.decision === 'eligible').length
	element('resume-preflight').replaceChildren(
		preflightItem('Mode', 'Live execution'),
		preflightItem('Network', snapshot.networkConfigured ? `${snapshot.network} · chain ${snapshot.expectedChainId.toString()}` : 'Not configured'),
		preflightItem('Execution signer', snapshot.wallet === undefined ? 'Missing' : shorten(snapshot.wallet)),
		preflightItem('Recovery-required positions', recoveryCount.toString()),
		preflightItem('Unknown confirmations', uncertainTransactions.toString()),
		preflightItem('Market evidence', snapshot.marketConsensus?.reliable === true ? 'Reliable' : 'Guarded / unavailable'),
		preflightItem('Eligible opportunities now', selectedOpportunities.toString()),
		preflightItem('Submission', snapshot.submission.mode === 'private' ? `${snapshot.submission.minimumBundleRelaySuccesses.toString()} private relay confirmations` : 'Public mempool'),
	)
	const dialog = element<HTMLDialogElement>('resume-dialog')
	if (typeof dialog.showModal === 'function') dialog.showModal()
	if (!dialog.hasAttribute('open')) dialog.setAttribute('open', '')
	element<HTMLElement>('resume-title').focus({ preventScroll: true })
	dialog.scrollTop = 0
}

function closeResumePreflight() {
	const dialog = element<HTMLDialogElement>('resume-dialog')
	if (dialog.open && typeof dialog.close === 'function') dialog.close()
	else dialog.removeAttribute('open')
}

async function changePaused(paused: boolean) {
	const emergencyPauseAvailable = paused && latestSnapshot?.paused === false
	if ((!connected && !emergencyPauseAvailable) || (!paused && latestSnapshot?.networkConfigured !== true)) {
		closeResumePreflight()
		return
	}
	pauseRequestPending = paused ? 'pause' : 'resume'
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
		setText('notice-title', 'Unable to change bot state')
		setText('notice-copy', error instanceof Error ? error.message : String(error))
		element('notice').dataset['tone'] = 'danger'
	} finally {
		pauseRequestPending = undefined
		setControlsEnabled(connected)
	}
}

element('pause-button').addEventListener('click', () => {
	if (latestSnapshot === undefined) return
	if (latestSnapshot.paused && (!connected || !latestSnapshot.networkConfigured)) return
	if (latestSnapshot.paused && latestSnapshot.execute) {
		openResumePreflight(latestSnapshot)
		return
	}
	void changePaused(!latestSnapshot.paused)
})

element('cancel-resume').addEventListener('click', closeResumePreflight)
element('confirm-resume').addEventListener('click', () => {
	if (!connected || latestSnapshot?.networkConfigured !== true) return
	void changePaused(false)
})

const sectionLinks = [...document.querySelectorAll<HTMLAnchorElement>('.section-nav a[href^="/"]')]

function secureExternalLinks(root: ParentNode) {
	const links = root instanceof HTMLAnchorElement ? [root] : [...root.querySelectorAll<HTMLAnchorElement>('a[href]')]
	for (const link of links) {
		if (link.origin === window.location.origin) continue
		link.target = '_blank'
		link.rel = 'noopener noreferrer'
	}
}

secureExternalLinks(document)
new MutationObserver(records => {
	for (const record of records) {
		for (const node of record.addedNodes) if (node instanceof HTMLElement) secureExternalLinks(node)
	}
}).observe(document.body, { childList: true, subtree: true })

function revealSectionLink(link: HTMLAnchorElement) {
	const navigation = link.closest<HTMLElement>('.section-nav')
	if (navigation === null) return
	const align = () => {
		navigation.scrollLeft = link.offsetLeft - (navigation.clientWidth - link.offsetWidth) / 2
	}
	align()
	if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(align)
	window.addEventListener('load', align, { once: true })
	window.addEventListener('resize', align)
	new ResizeObserver(align).observe(navigation)
	void document.fonts?.ready.then(align)
}

function scrollToSection(id: string) {
	const target = document.getElementById(id)
	const shell = document.querySelector<HTMLElement>('.operator-shell')
	if (target === null || shell === null) return
	if (target instanceof HTMLDetailsElement) target.open = true
	else target.closest('details')?.setAttribute('open', '')
	const align = () => {
		const top = target.getBoundingClientRect().top + window.scrollY - shell.getBoundingClientRect().height - 16
		window.scrollTo({ top: Math.max(0, top) })
	}
	align()
	if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => window.requestAnimationFrame(align))
	void document.fonts?.ready.then(align)
}

function syncSectionNavigation(scrollToTarget = false) {
	const activePath = window.location.pathname === '/' ? '/overview' : window.location.pathname
	let activeLink: HTMLAnchorElement | undefined
	for (const link of sectionLinks) {
		if (link.pathname === activePath) {
			link.setAttribute('aria-current', 'page')
			activeLink = link
		} else link.removeAttribute('aria-current')
	}
	if (activeLink !== undefined) revealSectionLink(activeLink)
	const targetId = window.location.hash.slice(1)
	if (scrollToTarget && targetId !== '') scrollToSection(targetId)
}

window.addEventListener('hashchange', () => syncSectionNavigation(true))
syncSectionNavigation()

element<HTMLFormElement>('strategy-form').addEventListener('submit', async event => {
	event.preventDefault()
	const button = element<HTMLFormElement>('strategy-form').querySelector('button[type="submit"]')
	if (!(button instanceof HTMLButtonElement)) return
	button.disabled = true
	setText('form-status', 'Applying strategy…')
	try {
		const settings = {
			maxSpotTwapTicks: input('maxSpotTwapTicks').value,
			minimumProfitBps: input('minimumProfitBps').value,
			minimumProfitWeth: input('minimumProfitWeth').value,
			minimumRemainingBlocks: input('minimumRemainingBlocks').value,
			minimumRemainingSeconds: input('minimumRemainingSeconds').value,
			pollMilliseconds: Number(input('pollMilliseconds').value),
			twapSeconds: Number(input('twapSeconds').value),
		} satisfies StrategySettings
		const response = await api<{ settings: StrategySettings }>('/api/settings', {
			body: JSON.stringify(settings),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		loadSettings(response.settings)
		setText('form-status', 'Strategy saved. Applies to the next scan.')
		await refresh()
	} catch (error) {
		setText('form-status', error instanceof Error ? error.message : String(error))
		await refresh()
	} finally {
		button.disabled = !connected
	}
})

element<HTMLFormElement>('submission-form').addEventListener('submit', async event => {
	event.preventDefault()
	const button = element<HTMLFormElement>('submission-form').querySelector('button[type="submit"]')
	if (!(button instanceof HTMLButtonElement)) return
	button.disabled = true
	setText('submission-status', 'Applying submission settings…')
	try {
		const submission = {
			minimumBundleRelaySuccesses: Number(element<HTMLInputElement>('minimum-bundle-relay-successes').value),
			mode: element<HTMLSelectElement>('submission-mode').value,
			relayUrls: element<HTMLTextAreaElement>('relay-urls')
				.value.split('\n')
				.map(value => value.trim())
				.filter(value => value !== ''),
		}
		const response = await api<{ submission: SubmissionSettings }>('/api/submission', {
			body: JSON.stringify(submission),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		loadSubmission(response.submission)
		setText('submission-status', 'Submission settings saved. Applies to the next scan.')
		await refresh()
	} catch (error) {
		setText('submission-status', error instanceof Error ? error.message : String(error))
		await refresh()
	} finally {
		button.disabled = !connected
	}
})

element<HTMLFormElement>('connectivity-form').addEventListener('submit', async event => {
	event.preventDefault()
	if (connectivityRequestPending) return
	const fieldset = element<HTMLFieldSetElement>('connectivity-fieldset')
	const networkSelect = element<HTMLSelectElement>('network-name')
	const selectedNetwork = networkSelect.value
	const selectedNetworkLabel = networkSelect.selectedOptions.item(0)?.textContent?.trim() ?? 'the selected chain'
	connectivityRequestPending = true
	fieldset.disabled = true
	setText('connectivity-status', `Checking every endpoint for ${selectedNetworkLabel}…`)
	try {
		const connectivity = {
			publicRpcUrls: element<HTMLTextAreaElement>('public-rpc-urls')
				.value.split('\n')
				.map(value => value.trim())
				.filter(value => value !== ''),
			readRpcUrl: element<HTMLInputElement>('read-rpc-url').value.trim(),
		}
		const rpcQuorum = Number(element<HTMLSelectElement>('rpc-quorum').value)
		const response = await api<{ connectivity: ConnectivitySettings; network: 'mainnet' | 'sepolia'; rpcQuorum: 1 | 2 }>('/api/connectivity', {
			body: JSON.stringify({ connectivity, network: selectedNetwork, rpcQuorum }),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		loadConnectivity(response.connectivity)
		element<HTMLSelectElement>('network-name').value = response.network
		element<HTMLSelectElement>('network-name').disabled = false
		persistedNetwork = response.network
		const networkLabel = response.network === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
		setText('settings-chain-scope', `Editing the ${networkLabel} profile. Every setting and durable journal is retained only for this chain; selecting another chain loads its separate profile.`)
		element<HTMLSelectElement>('rpc-quorum').value = response.rpcQuorum.toString()
		updateNetworkTargetStatus()
		setText('connectivity-status', 'Chain and RPCs passed validation, were saved, and apply to the next scan.')
		await refresh()
	} catch (error) {
		setText('connectivity-status', error instanceof Error ? error.message : String(error))
		await refresh()
	} finally {
		connectivityRequestPending = false
		setControlsEnabled(connected)
	}
})

element<HTMLFormElement>('deployment-form').addEventListener('submit', async event => {
	event.preventDefault()
	const button = element<HTMLFormElement>('deployment-form').querySelector('button[type="submit"]')
	if (!(button instanceof HTMLButtonElement)) return
	button.disabled = true
	setText('deployment-status', 'Validating deployment configuration…')
	try {
		const manifestText = element<HTMLTextAreaElement>('deployment-manifest').value.trim()
		const deployment = {
			coordinatorAddresses: lines('deployment-coordinators'),
			deploymentManifest: manifestText === '' ? undefined : JSON.parse(manifestText),
			executor: optionalInput('deployment-executor'),
			openOracle: element<HTMLInputElement>('deployment-open-oracle').value.trim(),
			quorumRpcUrls: lines('deployment-quorum-rpcs'),
			rep: element<HTMLInputElement>('deployment-rep').value.trim(),
			uniswapFactory: element<HTMLInputElement>('deployment-v3-factory').value.trim(),
			uniswapQuoter: element<HTMLInputElement>('deployment-v3-quoter').value.trim(),
			uniswapRouter: optionalInput('deployment-v3-router'),
			uniswapV2Router: optionalInput('deployment-v2-router'),
			uniswapV4PoolManager: optionalInput('deployment-v4-pool-manager'),
			uniswapV4Quoter: optionalInput('deployment-v4-quoter'),
			weth: element<HTMLInputElement>('deployment-weth').value.trim(),
		}
		const response = await api<{ deployment: DeploymentSettings }>('/api/deployment', {
			body: JSON.stringify(deployment),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		loadDeployment(response.deployment)
		setText('deployment-status', 'Deployment configuration saved. Protocol identities and quorum RPCs apply at the next scan boundary.')
	} catch (error) {
		setText('deployment-status', error instanceof Error ? error.message : String(error))
	} finally {
		button.disabled = !connected
	}
})

element<HTMLFormElement>('create2-form').addEventListener('submit', async event => {
	event.preventDefault()
	const button = element<HTMLButtonElement>('deploy-executor-button')
	const salt = element<HTMLInputElement>('create2-salt').value.trim()
	button.disabled = true
	setText('create2-status', 'Calculating the CREATE2 address…')
	try {
		const prediction = await api<{ address: string }>('/api/executor-prediction', {
			body: JSON.stringify({ salt }),
			headers: { 'content-type': 'application/json' },
			method: 'POST',
		})
		if (!window.confirm(`Deploy the executor at predictable address ${prediction.address} with the active local signer?`)) {
			setText('create2-status', `Deployment cancelled. Predicted executor address: ${prediction.address}.`)
			return
		}
		setText('create2-status', `Checking the canonical CREATE2 proxy before deploying ${prediction.address}…`)
		const result = await api<{ address: string; alreadyDeployed: boolean; transactionHash: string | undefined }>('/api/executor-deployment', {
			body: JSON.stringify({ salt }),
			headers: { 'content-type': 'application/json' },
			method: 'POST',
		})
		element<HTMLInputElement>('deployment-executor').value = result.address
		element<HTMLTextAreaElement>('deployment-manifest').value = ''
		setText('create2-status', result.alreadyDeployed ? `Verified existing executor at ${result.address}; replace the cleared execution manifest.` : `Deployed ${result.address} in transaction ${result.transactionHash ?? 'unknown'}; replace the cleared execution manifest.`)
		await refresh()
	} catch (error) {
		setText('create2-status', error instanceof Error ? error.message : String(error))
	} finally {
		button.disabled = !connected
	}
})

async function updateSigner(privateKey: string | undefined, rememberSigner: boolean) {
	if (signerRequestPending) return
	const input = element<HTMLInputElement>('private-key')
	signerRequestPending = true
	signerFeedback = { error: false, message: privateKey === undefined ? 'Clearing signer…' : 'Validating signer…' }
	if (latestSnapshot !== undefined) renderSignerStatus(latestSnapshot)
	try {
		await api<{ wallet: string | undefined }>('/api/signer', {
			body: JSON.stringify({ privateKey: privateKey ?? null, rememberSigner }),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		input.value = ''
		element<HTMLInputElement>('remember-signer').checked = false
		signerFeedback = undefined
	} catch (error) {
		input.value = ''
		signerFeedback = { error: true, message: error instanceof Error ? error.message : String(error) }
	} finally {
		signerRequestPending = false
		await refresh()
	}
}

element<HTMLFormElement>('signer-form').addEventListener('submit', event => {
	event.preventDefault()
	try {
		const privateKey = requiredSignerPrivateKey(element<HTMLInputElement>('private-key').value)
		void updateSigner(privateKey, element<HTMLInputElement>('remember-signer').checked)
	} catch (error) {
		signerFeedback = { error: true, message: error instanceof Error ? error.message : String(error) }
		if (latestSnapshot !== undefined) renderSignerStatus(latestSnapshot)
	}
})
element('clear-signer-button').addEventListener('click', () => void updateSigner(undefined, false))
element('forget-signer-button').addEventListener('click', async () => {
	if (signerRequestPending) return
	signerRequestPending = true
	signerFeedback = { error: false, message: 'Removing the saved key…' }
	if (latestSnapshot !== undefined) renderSignerStatus(latestSnapshot)
	try {
		await api<{ wallet: string | undefined }>('/api/signer', {
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
element<HTMLInputElement>('private-key').addEventListener('input', () => {
	if (signerRequestPending) return
	signerFeedback = undefined
	if (latestSnapshot !== undefined) renderSignerStatus(latestSnapshot)
})

void refresh()
void loadCompleteConfiguration()
window.setInterval(() => void refresh(), 2_000)
window.setInterval(() => {
	if (connected && latestSnapshot !== undefined) renderPollRetry(latestSnapshot)
}, 1_000)
window.setInterval(renderBlockStatus, 1_000)
