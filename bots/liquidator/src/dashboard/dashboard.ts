import { createUniverseExplorer } from '@zoltar/bot-shared/dashboard/universe-explorer'
import { readinessGuidance } from './readiness-status.js'
import { blockStatusText, scanStatusText } from './block-status.js'
import { createMetric, endpointHealthDetail, endpointRow, renderDisconnectedHeader, setAttentionBadge } from '@zoltar/bot-shared/dashboard/components'
import { CONFIGURATION_REQUEST_TIMEOUT_MS, PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE, PROFILE_SWITCH_REQUEST_TIMEOUT_MS, requestWithTimeout, singleFlight, STATE_REQUEST_TIMEOUT_MS } from '@zoltar/bot-shared/dashboard/polling'
import { closeResumePreflight, openResumePreflight } from '@zoltar/bot-shared/dashboard/resume-preflight'
import { createSectionNavigation } from '@zoltar/bot-shared/dashboard/section-navigation'
import { urlLines } from '@zoltar/bot-shared/dashboard/forms'
type Activity = {
	at: string
	details?: string
	message: string
	status: string
}

type Vault = {
	capacityOwnershipRep: string
	openInterestDisplay: string
	healthBps?: string
	vaultRepBacking: string
	claimableFeesEth: string
}

type Pool = {
	knownVaultCount: string
	address: string
	approvedUniverse: boolean
	bestCandidateBonusValueEth?: string
	botVault: Vault
	candidateCount: number
	centralizedPriceAllowed: boolean
	centralizedPriceDeviationBps?: string
	isPriceValid: boolean
	lastPrice: string
	multiplierBps: string
	questionId: string
	selected: boolean
	systemState: string
	totalCapacityOwnershipRep: string
	totalPoolHeldRep: string
}

type Universe = {
	repToken?: string

	forkedPoolCount: number
	forkQuestionId: string
	id: string
	migratableVaultCount: number
	operationalPoolCount: number
	outcomeIndex?: string
	parentId?: string
	poolCount: number
	selectedPoolCount: number
}

type CentralizedMarket = {
	askDepthEth: string
	bidDepthEth: string
	observations: {
		askDepthEth: string
		bidDepthEth: string
		exchangeId: string
		observedAt: string
		priceRepPerEth: string
		repMarket: string
	}[]
	priceRepPerEth: string
	reasons: string[]
	reliable: boolean
}

type MarketConsensus = {
	cex: { askDepthEth: string; bidDepthEth: string; priceRepPerEth: string; reliable: boolean; sourceCount: number }
	dex: { askDepthEth: string; bidDepthEth: string; priceRepPerEth: string; reliable: boolean; sourceCount: number }
	priceRepPerEth?: string
	reasons: string[]
	reliable: boolean
}

type MarketSourceRow = {
	assetId: string
	id: string
	kind: 'cex' | 'dex'
	market: string
	reason?: string
	status: 'admitted' | 'excluded' | 'failed' | 'observed'
}

type Snapshot = {
	activities: Activity[]
	alerts: { message: string; severity: 'error' | 'warning' }[]
	centralizedMarket?: CentralizedMarket
	marketConsensus?: MarketConsensus
	error?: string
	execute: boolean
	deploymentMissingName?: string
	deploymentCheckedBlock?: string
	deploymentCheckedTimestamp?: string
	lastScanAt?: string
	lastScannedBlock?: string
	lastScannedTimestamp?: string
	metrics: {
		approvedUniverseCount: number
		assumedOpenInterestEth: string
		candidateCount: number
		deployedRep: string
		eligiblePoolCount: number
		poolCount: number
		selectedPoolCount: number
		walletEth: string
		walletRep: string
	}
	network: 'mainnet' | 'sepolia'
	paused: boolean
	rpcEndpointHealth?: { consecutiveFailures: number; error?: string; latencyMilliseconds?: number; nextRetryAt?: string; status: string; target: string }[]
	pendingStagedOperations: { candidateBlock?: string; coordinator: string; historicalRecoveryComplete: boolean; latestRecoveryBlock?: string; nextHistoricalBlock?: string; operationId: string; queuedBlock: string; target: string }[]
	pendingTransactions: { hash: string; kind: string; label: string; maxBlockNumber: string; mode: 'private' | 'public'; nonce: string; requiresMarketEvidence: boolean; submissionBlock: string }[]
	operatorCapable: boolean
	pools: Pool[]
	scanning: boolean
	status: 'connectivity-degraded' | 'dry-run' | 'error' | 'paused' | 'running' | 'starting'
	marketSources: MarketSourceRow[]
	universes: Universe[]
	wallet?: string
}

type Configuration = {
	approvedUniverses: string[]
	childMarketConfigurations: unknown[]
	centralizedMarkets: unknown
	connectivity?: { publicRpcUrls: string[]; quorumRpcUrls: string[]; readRpcUrl: string; rpcQuorum: 1 | 2 } | undefined
	desiredPools: unknown[]
	network?: { chainId: number; explorerUrl: string; name: 'mainnet' | 'sepolia' } | undefined
	networkConfigured?: boolean | undefined
	runtime: { historicalLogRecovery: boolean; logLookbackBlocks: number }
	selectedPools: string[]
	strategy: Record<string, string | number | boolean>
}

function element<T extends Element>(id: string, constructor: { new (): T }) {
	const value = document.getElementById(id)
	if (!(value instanceof constructor)) throw new Error(`Missing dashboard element #${id}`)
	return value
}

const metrics = element('metrics', HTMLDivElement)
const networkForm = element('network-form', HTMLFormElement)
const networkFields = element('network-fields', HTMLFieldSetElement)
const networkName = element('network-name', HTMLSelectElement)
const readRpcUrl = element('read-rpc-url', HTMLInputElement)
const publicRpcUrls = element('public-rpc-urls', HTMLTextAreaElement)
const quorumRpcUrls = element('quorum-rpc-urls', HTMLTextAreaElement)
const rpcQuorum = element('rpc-quorum', HTMLSelectElement)
const networkStatus = element('network-status', HTMLSpanElement)
const networkScopeSummary = element('network-scope-summary', HTMLElement)
const centralizedMarketRows = element('centralized-market-rows', HTMLTableSectionElement)
const centralizedMarketStatus = element('centralized-market-status', HTMLParagraphElement)
const centralizedMarketPrice = element('centralized-market-price', HTMLElement)
const centralizedMarketBidDepth = element('centralized-market-bid-depth', HTMLElement)
const centralizedMarketAskDepth = element('centralized-market-ask-depth', HTMLElement)
const centralizedMarketSourceCount = element('centralized-market-source-count', HTMLElement)
const dexMarketPrice = element('dex-market-price', HTMLElement)
const guardedMarketPrice = element('guarded-market-price', HTMLElement)
const dexMarketBidDepth = element('dex-market-bid-depth', HTMLElement)
const dexMarketAskDepth = element('dex-market-ask-depth', HTMLElement)
const marketConfigurationForm = element('market-configuration-form', HTMLFormElement)
const marketConfigurationFields = element('market-configuration-fields', HTMLFieldSetElement)
const marketConfigurationJson = element('market-configuration-json', HTMLTextAreaElement)
const marketConfigurationSaveStatus = element('market-configuration-save-status', HTMLSpanElement)
const testMarketSourcesButton = element('test-market-sources', HTMLButtonElement)
const showActiveAdmissionButton = element('show-active-admission', HTMLButtonElement)
const marketSourceCaption = element('market-source-caption', HTMLTableCaptionElement)
const marketSourceTestStatus = element('market-source-test-status', HTMLSpanElement)
const marketSourceRows = element('market-source-rows', HTMLTableSectionElement)
const operatorAlerts = element('operator-alerts', HTMLUListElement)
const recoveryList = element('recovery-list', HTMLDivElement)
const recoveryGuidance = element('recovery-guidance', HTMLParagraphElement)
const recheckRecovery = element('recheck-recovery', HTMLButtonElement)
const universeRows = element('universe-rows', HTMLDivElement)
const poolRows = element('pool-rows', HTMLTableSectionElement)
const activityList = element('activity-list', HTMLOListElement)
const modeBadge = element('mode-badge', HTMLSpanElement)
const networkBadge = element('network-badge', HTMLSpanElement)
const runStatusBadge = element('run-status-badge', HTMLSpanElement)
const capabilityBadge = element('capability-badge', HTMLSpanElement)
const attentionBadge = element('attention-badge', HTMLAnchorElement)
const pauseButton = element('pause-button', HTMLButtonElement)
const pauseStatus = element('pause-status', HTMLSpanElement)
const lastScan = element('last-scan', HTMLParagraphElement)
const blockStatus = element('block-status', HTMLParagraphElement)
const globalError = element('global-error', HTMLDivElement)
const configurationStatus = element('configuration-status', HTMLDivElement)
const poolFilter = element('pool-filter', HTMLInputElement)
const strategyForm = element('strategy-form', HTMLFormElement)
const strategyFields = element('strategy-fields', HTMLFieldSetElement)
const strategyStatus = element('strategy-status', HTMLSpanElement)
const settingsChainScope = element('settings-chain-scope', HTMLParagraphElement)
const signerForm = element('signer-form', HTMLFormElement)
const signerStatus = element('signer-status', HTMLSpanElement)
const updateSignerButton = element('update-signer', HTMLButtonElement)
const clearSignerButton = element('clear-signer', HTMLButtonElement)
const walletAddress = element('wallet-address', HTMLElement)
const healthPolicyPreview = element('health-policy-preview', HTMLParagraphElement)
const resumeDialog = element('resume-dialog', HTMLElement)
const cancelResume = element('cancel-resume', HTMLButtonElement)
const confirmResume = element('confirm-resume', HTMLButtonElement)

let currentSnapshot: Snapshot | undefined
let currentConfiguration: Configuration | undefined
let pendingNetworkProfile: 'mainnet' | 'sepolia' | undefined
let pendingProfileStateConfirmed = false
let profileRequestEpoch = 0
let approvedUniverses = new Set<string>()
let selectedPools = new Set<string>()
let pendingPoolMutations = 0
const poolActionStates = new Map<string, { failed: boolean; message: string }>()
let universeExplorer: ReturnType<typeof createUniverseExplorer> | undefined
const recoveryActionStates = new Map<string, { failed: boolean; message: string }>()
let renderedAlertKey: string | undefined
let marketSourceProbeRows: MarketSourceRow[] | undefined
let initialFragmentApplied = false
let stateConnected = false
let configurationConnected = false
let pauseRequestPending: boolean | undefined

function renderBlockStatus(snapshot = currentSnapshot) {
	blockStatus.textContent = blockStatusText(snapshot)
	element('header-block-status', HTMLParagraphElement).textContent = blockStatus.textContent
}

function setMutationControlsEnabled(enabled: boolean) {
	const configurationAvailable = enabled && currentConfiguration !== undefined
	const chainSettingsAvailable = configurationAvailable && pendingNetworkProfile === undefined && currentConfiguration?.networkConfigured === true
	const resumeAvailable = configurationAvailable && pendingNetworkProfile === undefined && configurationConnected && currentConfiguration?.networkConfigured === true
	const paused = currentSnapshot?.paused
	pauseButton.textContent = pauseButtonLabel(pauseRequestPending, paused)
	pauseButton.disabled = pauseRequestPending !== undefined || currentSnapshot === undefined || (paused === true && !resumeAvailable)
	pauseButton.toggleAttribute('aria-busy', pauseRequestPending !== undefined)
	if (pauseRequestPending !== undefined) pauseButton.setAttribute('aria-busy', 'true')
	confirmResume.textContent = pauseRequestPending === false ? 'Resuming…' : 'Resume bot'
	confirmResume.disabled = pauseRequestPending !== undefined || !resumeAvailable
	confirmResume.toggleAttribute('aria-busy', pauseRequestPending === false)
	if (pauseRequestPending === false) confirmResume.setAttribute('aria-busy', 'true')
	networkFields.disabled = !configurationAvailable || pendingNetworkProfile !== undefined
	marketConfigurationFields.disabled = !chainSettingsAvailable
	strategyFields.disabled = !chainSettingsAvailable
	const privateKeyField = signerForm.elements.namedItem('privateKey')
	for (const control of signerForm.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) control.disabled = !chainSettingsAvailable
	updateSignerButton.disabled = !chainSettingsAvailable || !(privateKeyField instanceof HTMLInputElement) || privateKeyField.value.trim() === ''
	testMarketSourcesButton.disabled = !chainSettingsAvailable
	recheckRecovery.disabled = !chainSettingsAvailable
	if (!chainSettingsAvailable) {
		for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#pool-rows input, #recovery-list input, #recovery-list button')) control.disabled = true
	}
	if (currentSnapshot !== undefined) renderUniverses(currentSnapshot, !chainSettingsAvailable)
}

async function api<T>(path: string, options?: RequestInit, timeoutMilliseconds?: number): Promise<T> {
	const response = await (timeoutMilliseconds === undefined ? fetch(path, options) : requestWithTimeout(signal => fetch(path, { ...options, signal }), timeoutMilliseconds))
	const value: unknown = await response.json()
	if (!response.ok) {
		const error = typeof value === 'object' && value !== null ? Reflect.get(value, 'error') : undefined
		const message = typeof error === 'string' ? error : `Request failed with HTTP ${response.status.toString()}`
		throw new Error(message)
	}
	return value as T
}

function put<T = unknown>(path: string, value: unknown, timeoutMilliseconds?: number, timeoutMessage?: string) {
	const body = JSON.stringify(value)
	if (body === undefined) throw new Error('Request body is not JSON serializable')
	const options = { body, headers: { 'content-type': 'application/json' }, method: 'PUT' }
	if (timeoutMilliseconds === undefined) return api<T>(path, options)
	return requestWithTimeout(signal => api<T>(path, { ...options, signal }), timeoutMilliseconds, timeoutMessage)
}

const MARKET_SOURCE_STATUS_PRESENTATION: Record<MarketSourceRow['status'], { badgeClass: string; defaultReason: string; label: string }> = {
	admitted: { badgeClass: 'ok', defaultReason: 'Meets the active admission policy', label: 'Admitted' },
	excluded: { badgeClass: 'warning', defaultReason: 'Excluded by the active admission policy', label: 'Excluded' },
	failed: { badgeClass: 'warning', defaultReason: 'Probe did not return usable evidence', label: 'Failed' },
	observed: { badgeClass: '', defaultReason: 'Probe succeeded; admission still requires the persistence and consensus policy', label: 'Observed' },
}

const NETWORK_LABELS = new Map<string | undefined, string>([
	['mainnet', 'Mainnet'],
	['sepolia', 'Sepolia'],
])

function pauseButtonLabel(pauseRequestPending: boolean | undefined, paused: boolean | undefined) {
	if (pauseRequestPending !== undefined) return pauseRequestPending ? 'Pausing…' : 'Resuming…'
	return paused === true ? 'Resume' : 'Pause'
}

function pauseButtonAction(snapshot: Snapshot) {
	if (!snapshot.paused) return 'pause'
	return snapshot.execute ? 'confirm-resume' : 'resume'
}

function consensusStatusText(consensus: { reasons: readonly string[]; reliable: boolean } | undefined, reliableLabel: string) {
	if (consensus === undefined) return undefined
	return consensus.reliable ? reliableLabel : consensus.reasons.join(' · ')
}

function poolStatusText(pool: { approvedUniverse: boolean; centralizedPriceAllowed: boolean; selected: boolean; systemState: string }) {
	if (!pool.approvedUniverse) return 'Universe not approved'
	if (pool.systemState !== '0') return 'Pool inactive'
	if (!pool.centralizedPriceAllowed) return 'Market consensus guard'
	return pool.selected ? 'Eligible' : ''
}

function activityBadgeClass(status: string) {
	if (status === 'failed') return 'warning'
	return status === 'confirmed' ? 'ok' : ''
}

function runStatusLabel(snapshot: Snapshot) {
	if (snapshot.status === 'connectivity-degraded') return 'Connectivity degraded'
	if (snapshot.error !== undefined) return 'Error'
	if (snapshot.paused) return 'Paused'
	if (snapshot.scanning) return 'Scanning'
	return snapshot.deploymentMissingName !== undefined ? 'Waiting' : 'Running'
}

function globalErrorPresentation(snapshot: Snapshot): { message: string | undefined; title: string; tone: 'error' | 'info' | 'warning' } {
	if (snapshot.error === undefined) {
		const guidance = capabilityBlockerGuidance(snapshot)
		return { message: guidance?.message, title: guidance?.title ?? 'Operator blocked', tone: guidance?.pending === true ? 'info' : 'warning' }
	}
	const message = snapshot.status === 'connectivity-degraded' ? 'RPC connectivity is degraded. Execution is blocked and the bot will retry automatically.' : `${scanFailureDetail(snapshot.error)} Automatic retry is active. Check the bot logs if the next cycle also fails.`
	return { message, title: 'Scan failed', tone: 'error' }
}

function shortAddress(address: string) {
	return address.length <= 18 ? address : `${address.slice(0, 10)}…${address.slice(-6)}`
}

function updateText(target: Element, value: string) {
	if (target.textContent !== value) target.textContent = value
}

function renderMetrics(snapshot: Snapshot) {
	metrics.replaceChildren(
		createMetric('Pools', snapshot.metrics.poolCount.toString()),
		createMetric('Selected', snapshot.metrics.selectedPoolCount.toString()),
		createMetric('Approved universes', snapshot.metrics.approvedUniverseCount.toString()),
		createMetric('Eligible pools', snapshot.metrics.eligiblePoolCount.toString()),
		createMetric('Candidates', snapshot.metrics.candidateCount.toString()),
		createMetric('Open interest assumed', `${snapshot.metrics.assumedOpenInterestEth} ETH`),
	)
	element('wallet-metrics', HTMLDivElement).replaceChildren(createMetric('Wallet ETH', snapshot.metrics.walletEth), createMetric('Wallet REP', snapshot.metrics.walletRep), createMetric('REP deployed in pools', snapshot.metrics.deployedRep))
}

function renderAlerts(snapshot: Snapshot) {
	const alertKey = `${snapshot.pendingTransactions.length.toString()}\n${snapshot.alerts.map(alert => `${alert.severity}:${alert.message}`).join('\n')}`
	if (renderedAlertKey === alertKey) return
	renderedAlertKey = alertKey
	const alerts: { actionHref?: string; actionLabel?: string; message: string; severity: 'error' | 'warning' }[] = snapshot.alerts.map(alert => ({ ...alert }))
	if (snapshot.pendingTransactions.length > 0) {
		const recoveryAlert = alerts[0]
		if (recoveryAlert === undefined) {
			alerts.unshift({
				actionHref: '/operations#recovery',
				actionLabel: 'Review recovery',
				message: `${snapshot.pendingTransactions.length.toString()} transaction ${snapshot.pendingTransactions.length === 1 ? 'intent requires' : 'intents require'} operator recovery before execution can continue.`,
				severity: 'warning',
			})
		} else {
			recoveryAlert.actionHref = '/operations#recovery'
			recoveryAlert.actionLabel = 'Review recovery'
		}
	}
	operatorAlerts.classList.toggle('hidden', alerts.length === 0)
	operatorAlerts.replaceChildren(
		...alerts.map(alert => {
			const item = document.createElement('li')
			item.className = `notice alert-row ${alert.severity}`
			const message = document.createElement('span')
			message.textContent = alert.message
			item.append(message)
			if (alert.actionHref !== undefined && alert.actionLabel !== undefined) {
				const action = document.createElement('a')
				action.className = 'alert-action'
				action.href = alert.actionHref
				action.textContent = alert.actionLabel
				item.append(action)
			}
			return item
		}),
	)
}

function renderMarketSources(sources: MarketSourceRow[]) {
	if (sources.length === 0) {
		const row = document.createElement('tr')
		const empty = cell('No market sources are configured.')
		empty.colSpan = 6
		empty.className = 'empty'
		row.append(empty)
		marketSourceRows.replaceChildren(row)
		return
	}
	marketSourceRows.replaceChildren(
		...sources.map(source => {
			const row = document.createElement('tr')
			const badge = document.createElement('span')
			const presentation = MARKET_SOURCE_STATUS_PRESENTATION[source.status]
			badge.className = `badge ${presentation.badgeClass}`
			badge.textContent = presentation.label
			const cells = [cell(source.kind.toUpperCase()), cell(source.id), cell(shortAddress(source.assetId)), cell(source.market), cell(badge), cell(source.reason ?? presentation.defaultReason)]
			const labels = ['Venue', 'Source', 'REP asset', 'Market', 'Status', 'Reason']
			const headings = ['source-kind-heading', 'source-id-heading', 'source-asset-heading', 'source-market-heading', 'source-status-heading', 'source-reason-heading']
			for (const [index, value] of cells.entries()) {
				value.dataset['label'] = labels[index]
				value.headers = headings[index] ?? ''
			}
			row.append(...cells)
			return row
		}),
	)
}

function renderRecovery(snapshot: Snapshot) {
	if (document.activeElement instanceof HTMLElement && recoveryList.contains(document.activeElement)) return
	if (snapshot.pendingTransactions.length === 0 && snapshot.pendingStagedOperations.length === 0) {
		const empty = document.createElement('p')
		empty.className = 'empty'
		empty.textContent = 'No pending recovery work.'
		recoveryList.replaceChildren(empty)
		return
	}
	const transactionCards = snapshot.pendingTransactions.map(intent => {
		const card = document.createElement('article')
		card.className = 'recovery-card'
		const heading = document.createElement('h3')
		heading.textContent = intent.label
		const metadata = document.createElement('p')
		metadata.className = 'mono muted'
		metadata.textContent = `${intent.mode} · nonce ${intent.nonce} · submitted at block ${intent.submissionBlock} · ${intent.hash}`
		const form = document.createElement('form')
		form.className = 'reconciliation-form'
		const label = document.createElement('label')
		label.textContent = 'Finalized replacement or cancellation hash'
		const input = document.createElement('input')
		input.autocomplete = 'off'
		input.inputMode = 'text'
		input.pattern = '0x[0-9a-fA-F]{64}'
		input.placeholder = '0x…'
		input.required = true
		const button = document.createElement('button')
		button.type = 'submit'
		button.textContent = 'Verify & reconcile'
		button.disabled = pendingNetworkProfile !== undefined || !stateConnected || !snapshot.paused
		const status = document.createElement('span')
		status.className = 'action-status'
		status.setAttribute('role', 'alert')
		const saved = recoveryActionStates.get(intent.hash.toLowerCase())
		if (saved !== undefined) actionStatus(status, saved.message, saved.failed)
		label.append(input)
		form.append(label, button, status)
		form.addEventListener('submit', async event => {
			event.preventDefault()
			if (!window.confirm('Reconcile only if this finalized transaction intentionally replaced or canceled the pending intent. Continue?')) return
			button.disabled = true
			actionStatus(status, 'Checking RPC quorum and canonical finality…')
			try {
				await put('/api/reconcile-transaction', { intentHash: intent.hash, replacementHash: input.value.trim() })
				recoveryActionStates.delete(intent.hash.toLowerCase())
				actionStatus(status, 'Reconciled')
				await refresh()
			} catch (error) {
				const message = publicFailure(error, 'Could not reconcile this intent. Confirm the replacement hash and finality, then retry.')
				recoveryActionStates.set(intent.hash.toLowerCase(), { failed: true, message })
				actionStatus(status, message, true)
			} finally {
				button.disabled = pendingNetworkProfile !== undefined || !stateConnected || !snapshot.paused
			}
		})
		card.append(heading, metadata, form)
		return card
	})
	const stagedCards = snapshot.pendingStagedOperations.map(operation => {
		const card = document.createElement('article')
		card.className = 'recovery-card'
		const heading = document.createElement('h3')
		heading.textContent = `Staged operation ${operation.operationId}`
		const metadata = document.createElement('p')
		metadata.className = 'mono muted'
		metadata.textContent = `queued block ${operation.queuedBlock} · latest checked ${operation.latestRecoveryBlock ?? 'not yet'} · historical ${operation.historicalRecoveryComplete ? 'complete' : (operation.nextHistoricalBlock ?? 'not enabled')} · ${operation.coordinator} → ${operation.target}`
		const status = document.createElement('p')
		status.className = 'muted'
		status.textContent = operation.candidateBlock === undefined ? 'Waiting for a canonical outcome.' : `Outcome found at block ${operation.candidateBlock}; waiting for canonical finality.`
		card.append(heading, metadata, status)
		return card
	})
	recoveryList.replaceChildren(...transactionCards, ...stagedCards)
}

function renderCentralizedMarket(snapshot: Snapshot) {
	const market = snapshot.centralizedMarket
	const consensus = snapshot.marketConsensus
	updateText(dexMarketPrice, consensus?.dex.reliable === true ? consensus.dex.priceRepPerEth : '—')
	updateText(guardedMarketPrice, consensus?.reliable === true ? (consensus.priceRepPerEth ?? '—') : '—')
	updateText(dexMarketBidDepth, consensus === undefined ? '—' : `${consensus.dex.bidDepthEth} ETH`)
	updateText(dexMarketAskDepth, consensus === undefined ? '—' : `${consensus.dex.askDepthEth} ETH`)
	if (market === undefined) {
		updateText(centralizedMarketStatus, consensusStatusText(consensus, 'Reliable DEX consensus') ?? 'No market sources configured')
		updateText(centralizedMarketPrice, '—')
		updateText(centralizedMarketBidDepth, '—')
		updateText(centralizedMarketAskDepth, '—')
		updateText(centralizedMarketSourceCount, consensus === undefined ? '0 CEX' : `${consensus.cex.sourceCount.toString()} CEX · ${consensus.dex.sourceCount.toString()} DEX`)
		const row = document.createElement('tr')
		const empty = cell('Add public exchange sources in the operator configuration.')
		empty.colSpan = 6
		empty.className = 'empty'
		row.append(empty)
		centralizedMarketRows.replaceChildren(row)
		return
	}
	updateText(centralizedMarketStatus, consensusStatusText(consensus, 'Reliable independent CEX + DEX consensus') ?? (market.reliable ? 'Reliable CEX estimate' : market.reasons.join(' · ')))
	updateText(centralizedMarketPrice, market.priceRepPerEth)
	updateText(centralizedMarketBidDepth, `${market.bidDepthEth} ETH`)
	updateText(centralizedMarketAskDepth, `${market.askDepthEth} ETH`)
	updateText(centralizedMarketSourceCount, consensus === undefined ? `${market.observations.length.toString()} CEX` : `${consensus.cex.sourceCount.toString()} CEX · ${consensus.dex.sourceCount.toString()} DEX`)
	centralizedMarketRows.replaceChildren(
		...market.observations.map(observation => {
			const row = document.createElement('tr')
			const cells = [cell(observation.exchangeId), cell(observation.repMarket), cell(observation.priceRepPerEth), cell(`${observation.bidDepthEth} ETH`), cell(`${observation.askDepthEth} ETH`), cell(new Date(observation.observedAt).toLocaleTimeString())]
			const labels = ['Exchange', 'Market', 'REP / ETH', 'Bid depth', 'Ask depth', 'Observed']
			const headings = ['market-exchange-heading', 'market-pair-heading', 'market-price-heading', 'market-bid-heading', 'market-ask-heading', 'market-observed-heading']
			for (const [index, value] of cells.entries()) {
				value.dataset['label'] = labels[index]
				value.headers = headings[index] ?? ''
			}
			row.append(...cells)
			return row
		}),
	)
}

function universeState(universe: Universe) {
	if (universe.poolCount === 0) return 'No security pool yet'
	if (universe.operationalPoolCount > 0) return `${universe.operationalPoolCount.toString()} operational`
	if (universe.forkedPoolCount > 0) return `${universe.forkedPoolCount.toString()} forked`
	return 'Migration / settlement'
}

function activeRecordKey(container: HTMLElement) {
	const active = document.activeElement
	if (!(active instanceof HTMLElement) || !container.contains(active)) return undefined
	return active.dataset['recordKey']
}

function restoreRecordFocus(container: HTMLElement, recordKey?: string) {
	if (recordKey === undefined) return
	for (const candidate of container.querySelectorAll<HTMLElement>('[data-record-key]')) {
		if (candidate.dataset['recordKey'] !== recordKey) continue
		candidate.focus()
		return
	}
}

function renderUniverses(snapshot: Snapshot, disabled?: boolean) {
	universeExplorer ??= createUniverseExplorer(universeRows, {
		savedMessage: 'Universe approvals saved.',
		onChange: async next => {
			const epoch = profileRequestEpoch
			try {
				await put('/api/approved-universes', [...next])
				if (epoch === profileRequestEpoch) approvedUniverses = next
			} catch (error) {
				throw new Error(publicFailure(error, 'Could not save universe approval. Retry this selection.'))
			}
		},
	})
	universeExplorer.update({
		universes: snapshot.universes.map(universe => ({ ...universe, summary: `${universe.poolCount} pools · ${universeState(universe)} · ${universe.selectedPoolCount} selected · ${universe.migratableVaultCount} migratable vaults` })),
		approved: approvedUniverses,
		network: snapshot.network,
		disabled: disabled ?? (pendingNetworkProfile !== undefined || currentConfiguration?.networkConfigured !== true || !stateConnected),
	})
}

function cell(...children: (Node | string)[]) {
	const value = document.createElement('td')
	for (const child of children) {
		value.append(typeof child === 'string' ? document.createTextNode(child) : child)
	}
	return value
}

function stacked(primary: string, secondary: string) {
	const fragment = document.createDocumentFragment()
	const strong = document.createElement('strong')
	strong.textContent = primary
	const small = document.createElement('small')
	small.textContent = secondary
	fragment.append(strong, small)
	return fragment
}

function actionStatus(element: HTMLElement, message: string, failed = false) {
	if (element.textContent !== message) element.textContent = message
	if (element.classList.contains('error') !== failed) element.classList.toggle('error', failed)
}

function publicFailure(error: unknown, message: string, includeDetail = false) {
	if (includeDetail && error instanceof Error) {
		const detail = error.message.trim()
		if (detail !== '' && detail !== message && !/^Request failed with HTTP \d+$/.test(detail) && !/(?:https?:\/\/[^\s/:]+:[^@\s]+@|authorization|bearer|password|secret|token\s*[=:])/i.test(detail)) return detail
	}
	return message
}

function botVaultState(vault: Vault) {
	const health = vault.healthBps === undefined ? undefined : BigInt(vault.healthBps)
	if (vault.vaultRepBacking === '0' && vault.openInterestDisplay === '0') return 'Inactive'
	if (health === undefined) return 'No open interest'
	if (health < 10_000n) return `Top-up required · ${health.toString()} bps`
	return `Healthy · ${health.toString()} bps`
}

function renderPools(snapshot: Snapshot) {
	if (pendingPoolMutations > 0) return
	const focusedRecord = activeRecordKey(poolRows)
	const expandedAddresses = new Set(
		[...poolRows.querySelectorAll<HTMLDetailsElement>('details[data-pool-address]')]
			.filter(details => details.open)
			.map(details => details.dataset['poolAddress'])
			.filter(address => address !== undefined),
	)
	const filter = poolFilter.value.trim().toLowerCase()
	const visible = snapshot.pools.filter(pool => filter === '' || pool.address.toLowerCase().includes(filter) || pool.questionId.toLowerCase().includes(filter))
	if (visible.length === 0) {
		const row = document.createElement('tr')
		const empty = cell(snapshot.pools.length === 0 ? 'No configured pools are available.' : 'No pools match this filter.')
		empty.colSpan = 7
		empty.className = 'empty'
		row.append(empty)
		poolRows.replaceChildren(row)
		return
	}
	poolRows.replaceChildren(
		...visible.map(pool => {
			const row = document.createElement('tr')
			const checkbox = document.createElement('input')
			checkbox.type = 'checkbox'
			checkbox.dataset['recordKey'] = `pool:${pool.address.toLowerCase()}`
			checkbox.checked = selectedPools.has(pool.address.toLowerCase())
			checkbox.setAttribute('aria-label', `Select pool ${pool.address}`)
			checkbox.disabled = pendingNetworkProfile !== undefined || currentConfiguration?.networkConfigured !== true || !stateConnected
			const toggle = document.createElement('label')
			toggle.className = 'pool-toggle'
			const toggleText = document.createElement('span')
			toggleText.className = 'visually-hidden'
			toggleText.textContent = `Select pool ${pool.address}`
			toggle.append(checkbox, toggleText)
			const poolStatus = document.createElement('span')
			poolStatus.className = 'action-status'
			const savedActionState = poolActionStates.get(pool.address.toLowerCase())
			if (savedActionState === undefined) {
				poolStatus.textContent = poolStatusText(pool)
			} else {
				actionStatus(poolStatus, savedActionState.message, savedActionState.failed)
				if (!savedActionState.failed && savedActionState.message === 'Saved') poolActionStates.delete(pool.address.toLowerCase())
			}
			checkbox.addEventListener('change', async () => {
				if (pendingPoolMutations > 0) {
					checkbox.checked = selectedPools.has(pool.address.toLowerCase())
					return
				}
				pendingPoolMutations += 1
				for (const control of poolRows.querySelectorAll<HTMLInputElement>('input')) control.disabled = true
				poolActionStates.set(pool.address.toLowerCase(), { failed: false, message: 'Saving…' })
				actionStatus(poolStatus, 'Saving…')
				const next = new Set(selectedPools)
				if (checkbox.checked) next.add(pool.address.toLowerCase())
				else next.delete(pool.address.toLowerCase())
				try {
					await put('/api/selected-pools', [...next])
					selectedPools = next
					poolActionStates.set(pool.address.toLowerCase(), { failed: false, message: 'Saved' })
					actionStatus(poolStatus, 'Saved')
				} catch (error) {
					checkbox.checked = !checkbox.checked
					const message = publicFailure(error, 'Could not save pool selection. Retry this selection.')
					poolActionStates.set(pool.address.toLowerCase(), { failed: true, message })
					actionStatus(poolStatus, message, true)
				} finally {
					pendingPoolMutations -= 1
					if (currentSnapshot !== undefined) renderPools(currentSnapshot)
				}
			})
			const addressDetails = document.createElement('details')
			addressDetails.className = 'address-details'
			addressDetails.dataset['poolAddress'] = pool.address.toLowerCase()
			addressDetails.open = expandedAddresses.has(pool.address.toLowerCase())
			const address = document.createElement('summary')
			address.className = 'address'
			address.dataset['recordKey'] = `pool-address:${pool.address.toLowerCase()}`
			const addressText = document.createElement('span')
			addressText.className = 'address-text'
			addressText.textContent = shortAddress(pool.address)
			address.append(addressText)
			const fullAddress = document.createElement('code')
			fullAddress.className = 'full-address'
			fullAddress.textContent = pool.address
			addressDetails.append(address, fullAddress)
			const oracleBadge = document.createElement('span')
			oracleBadge.className = `badge ${pool.isPriceValid ? 'ok' : 'warning'}`
			oracleBadge.textContent = pool.isPriceValid ? 'Fresh' : 'Stale'
			const cells = [
				cell(toggle, poolStatus),
				cell(addressDetails),
				cell(stacked(`#${pool.questionId}`, `${pool.multiplierBps} bps collateral`)),
				cell(oracleBadge, stacked('', `${pool.lastPrice} REP / ETH${pool.centralizedPriceDeviationBps === undefined ? '' : ` · ${pool.centralizedPriceDeviationBps} bps from reference`}`)),
				cell(stacked(`${pool.totalPoolHeldRep} REP`, `${pool.totalCapacityOwnershipRep} REP capacity ownership · ${pool.knownVaultCount} known vaults`)),
				cell(stacked(botVaultState(pool.botVault), `${pool.botVault.vaultRepBacking} REP backing · ${pool.botVault.capacityOwnershipRep} REP capacity ownership · ${pool.botVault.openInterestDisplay} ETH open interest · ${pool.botVault.claimableFeesEth} ETH fees`)),
				cell(stacked(pool.candidateCount.toString(), pool.bestCandidateBonusValueEth === undefined ? 'No executable target' : `${pool.bestCandidateBonusValueEth} ETH best bonus`)),
			]
			const labels = ['Selected', 'Pool', 'Question', 'Oracle', 'Pool totals', 'Bot vault', 'Targets']
			const headings = ['pool-selected-heading', 'pool-address-heading', 'pool-question-heading', 'pool-oracle-heading', 'pool-totals-heading', 'pool-vault-heading', 'pool-targets-heading']
			for (const [index, value] of cells.entries()) {
				value.dataset['label'] = labels[index]
				value.headers = headings[index] ?? ''
			}
			row.append(...cells)
			return row
		}),
	)
	restoreRecordFocus(poolRows, focusedRecord)
}

function renderActivities(activities: Activity[]) {
	if (activities.length === 0) {
		const empty = document.createElement('li')
		empty.className = 'empty'
		empty.textContent = 'No activity yet'
		activityList.replaceChildren(empty)
		return
	}
	activityList.replaceChildren(
		...activities.slice(0, 50).map(activity => {
			const item = document.createElement('li')
			item.className = 'activity'
			const badge = document.createElement('span')
			badge.className = `badge ${activityBadgeClass(activity.status)}`
			badge.textContent = activity.status
			const body = document.createElement('div')
			const message = document.createElement('p')
			message.textContent = activity.message
			const time = document.createElement('time')
			time.dateTime = activity.at
			time.textContent = new Date(activity.at).toLocaleString()
			body.append(message, time)
			if (activity.details !== undefined) {
				const details = document.createElement('p')
				details.className = 'muted mono'
				details.textContent = activity.details
				body.append(details)
			}
			item.append(badge, body)
			return item
		}),
	)
}

function renderRpcEndpointHealth(health: Snapshot['rpcEndpointHealth']) {
	const container = element('rpc-endpoint-health', HTMLDivElement)
	container.replaceChildren(...(health ?? []).map(endpoint => endpointRow('rpc-health-item', endpoint, endpointHealthDetail(endpoint))))
}

function renderCurrentRpcEndpointHealth(snapshot = currentSnapshot) {
	const configuredNetwork = currentConfiguration?.network?.name
	const health = snapshot !== undefined && currentConfiguration?.networkConfigured === true && snapshot.network === configuredNetwork ? snapshot.rpcEndpointHealth : undefined
	renderRpcEndpointHealth(health)
}

function render(snapshot: Snapshot) {
	currentSnapshot = snapshot
	renderBlockStatus(snapshot)
	stateConnected = true
	pauseButton.dataset['action'] = pauseButtonAction(snapshot)
	setMutationControlsEnabled(true)
	renderNetworkBadge()
	modeBadge.textContent = snapshot.execute ? 'Live' : 'Dry run'
	modeBadge.className = `badge ${snapshot.execute ? 'warning' : 'ok'}`
	runStatusBadge.textContent = runStatusLabel(snapshot)
	runStatusBadge.className = `badge ${snapshot.paused || snapshot.error !== undefined ? 'warning' : 'ok'}`
	capabilityBadge.hidden = snapshot.operatorCapable
	capabilityBadge.textContent = snapshot.operatorCapable ? '' : 'Operator blocked'
	capabilityBadge.className = `badge ${snapshot.operatorCapable ? 'ok' : 'warning'}`
	renderAttention(snapshot)
	recoveryGuidance.hidden = snapshot.paused
	lastScan.textContent = scanStatusText(snapshot)
	walletAddress.textContent = snapshot.wallet ?? 'No active signer'
	const globalError = globalErrorPresentation(snapshot)
	setGlobalError(globalError.message, globalError.title, globalError.tone)
	renderMetrics(snapshot)
	renderAlerts(snapshot)
	renderCentralizedMarket(snapshot)
	renderMarketSources(marketSourceProbeRows ?? snapshot.marketSources)
	renderRecovery(snapshot)
	renderUniverses(snapshot)
	renderPools(snapshot)
	renderActivities(snapshot.activities)
	renderCurrentRpcEndpointHealth(snapshot)
	if (!initialFragmentApplied) {
		initialFragmentApplied = true
		const fragment = decodeURIComponent(window.location.hash.slice(1))
		if (fragment !== '') {
			syncSectionNavigation()
			scrollToSection(fragment)
		}
	}
}

function snapshotDetailedAttentionCount(snapshot: Snapshot) {
	return (configurationConnected && currentConfiguration?.networkConfigured !== true ? 1 : 0) + Math.max(snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length, snapshot.alerts.length) + (snapshot.error === undefined ? 0 : 1)
}

function snapshotAttentionCount(snapshot: Snapshot) {
	return Math.max(snapshotDetailedAttentionCount(snapshot), snapshot.operatorCapable === false ? 1 : 0)
}

function capabilityBlockerGuidance(snapshot: Snapshot) {
	return readinessGuidance(snapshot, snapshotDetailedAttentionCount(snapshot) > 0)
}

function renderAttention(snapshot: Snapshot) {
	const networkSetupRequired = configurationConnected && currentConfiguration?.networkConfigured !== true
	const attentionCount = snapshotAttentionCount(snapshot)
	let attentionTarget = '/overview#global-error'
	if (networkSetupRequired) attentionTarget = '/settings#network-connectivity'
	else if (snapshot.pendingTransactions.length > 0 || snapshot.pendingStagedOperations.length > 0) attentionTarget = '/operations#recovery'
	else if (snapshot.error !== undefined) attentionTarget = '/overview#global-error'
	else if (snapshot.alerts.length > 0) attentionTarget = '/operations'
	setAttentionBadge(attentionBadge, attentionCount, attentionTarget)
	if (capabilityBlockerGuidance(snapshot)?.pending === true) {
		attentionBadge.textContent = capabilityBlockerGuidance(snapshot)?.label ?? 'Awaiting first scan'
		if (snapshot.deploymentMissingName === undefined) attentionBadge.removeAttribute('href')
	}
}

function setFormValue(name: string, value: string | number | boolean) {
	const field = strategyForm.elements.namedItem(name)
	if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = value === true
	else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = String(value)
}

function populateConfiguration(configuration: Configuration) {
	if (pendingNetworkProfile !== undefined && configuration.network?.name !== pendingNetworkProfile) return
	currentConfiguration = configuration
	configurationConnected = true
	renderNetworkBadge()
	approvedUniverses = new Set(configuration.approvedUniverses)
	selectedPools = new Set(configuration.selectedPools.map(pool => pool.toLowerCase()))
	for (const [name, value] of Object.entries(configuration.strategy)) setFormValue(name, value)
	setFormValue('logLookbackBlocks', configuration.runtime.logLookbackBlocks)
	setFormValue('historicalLogRecovery', configuration.runtime.historicalLogRecovery)
	if (configuration.network !== undefined) {
		const networkLabel = configuration.network.name === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
		settingsChainScope.textContent = `Editing the ${networkLabel} profile. Every setting and durable recovery record is retained only for this chain; selecting another chain loads its separate profile.`
		networkScopeSummary.textContent = `${networkLabel} profile · switchable`
		networkName.value = configuration.network.name
		networkName.disabled = false
		readRpcUrl.value = configuration.connectivity?.readRpcUrl ?? ''
		publicRpcUrls.value = configuration.connectivity?.publicRpcUrls.join('\n') ?? ''
		quorumRpcUrls.value = configuration.connectivity?.quorumRpcUrls.join('\n') ?? ''
		rpcQuorum.value = configuration.connectivity?.rpcQuorum?.toString() ?? '1'
	} else {
		settingsChainScope.textContent = 'Select a chain profile first. Every other setting is locked until its chain is verified, and the saved configuration and recovery state belong only to that chain.'
		networkScopeSummary.textContent = 'No profile selected'
		networkName.disabled = false
		readRpcUrl.value = ''
		publicRpcUrls.value = ''
		quorumRpcUrls.value = ''
		rpcQuorum.value = '1'
	}
	networkFields.disabled = pendingNetworkProfile !== undefined
	marketConfigurationJson.value = JSON.stringify({ children: configuration.childMarketConfigurations, desiredPools: configuration.desiredPools, root: configuration.centralizedMarkets }, undefined, 2) ?? ''
	marketConfigurationFields.disabled = configuration.networkConfigured !== true
	strategyFields.disabled = configuration.networkConfigured !== true
	configurationStatus.classList.add('hidden')
	configurationStatus.replaceChildren()
	updateHealthPolicyPreview()
	if (currentSnapshot !== undefined) {
		renderAttention(currentSnapshot)
		renderUniverses(currentSnapshot)
		renderPools(currentSnapshot)
	}
	renderCurrentRpcEndpointHealth()
	setMutationControlsEnabled(stateConnected)
	if (window.location.hash !== '') syncSectionNavigation(true)
}

networkName.addEventListener('change', async () => {
	if (currentConfiguration?.network?.name === networkName.value) return
	if (networkName.value !== 'mainnet' && networkName.value !== 'sepolia') return
	const requestedNetwork = networkName.value
	const activeNetwork = currentConfiguration?.network?.name
	profileRequestEpoch += 1
	pendingNetworkProfile = requestedNetwork
	pendingProfileStateConfirmed = false
	if (activeNetwork !== undefined) networkName.value = activeNetwork
	if (activeNetwork !== undefined) networkScopeSummary.textContent = `${activeNetwork === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'} profile · switching to ${requestedNetwork === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'}`
	marketSourceProbeRows = undefined
	marketSourceCaption.textContent = 'Configured source admission'
	showActiveAdmissionButton.classList.add('hidden')
	actionStatus(marketSourceTestStatus, '')
	renderMarketSources([])
	networkFields.disabled = true
	setMutationControlsEnabled(stateConnected)
	actionStatus(networkStatus, `Switching to the ${requestedNetwork === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'} profile…`)
	try {
		await put<Configuration>('/api/network-profile', { network: requestedNetwork }, PROFILE_SWITCH_REQUEST_TIMEOUT_MS, PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE)
		networkFields.disabled = true
		actionStatus(networkStatus, 'Profile saved. The bot is switching chains in place; settings will reload automatically.')
		await waitForNetworkProfile(requestedNetwork)
	} catch (error) {
		if (error instanceof Error && error.message === PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE) {
			actionStatus(networkStatus, 'The switch request timed out with an unknown outcome. Existing settings remain locked while the dashboard checks the selected profile.')
			await waitForNetworkProfile(requestedNetwork)
			return
		}
		if (pendingNetworkProfile === requestedNetwork) {
			profileRequestEpoch += 1
			pendingNetworkProfile = undefined
			pendingProfileStateConfirmed = false
		}
		actionStatus(networkStatus, publicFailure(error, 'Could not switch chain profiles.'), true)
		if (currentConfiguration?.network !== undefined) {
			networkName.value = currentConfiguration.network.name
			networkScopeSummary.textContent = `${currentConfiguration.network.name === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'} profile · switchable`
		}
		networkFields.disabled = pendingNetworkProfile !== undefined || !stateConnected || currentConfiguration === undefined
	}
})

async function waitForNetworkProfile(network: string) {
	for (let attempt = 0; attempt < 40; attempt++) {
		await new Promise(resolve => setTimeout(resolve, 500))
		await refresh()
		if (pendingNetworkProfile === undefined && currentConfiguration?.network?.name === network) return
	}
	actionStatus(networkStatus, 'The profile was saved, but the dashboard did not reconnect in time. It keeps retrying automatically.', true)
}

networkForm.addEventListener('submit', async event => {
	event.preventDefault()
	networkFields.disabled = true
	actionStatus(networkStatus, 'Checking every RPC against the selected chain…')
	try {
		const configuration = await put<Configuration>('/api/network-connectivity', {
			connectivity: { publicRpcUrls: urlLines(publicRpcUrls.value), quorumRpcUrls: urlLines(quorumRpcUrls.value), readRpcUrl: readRpcUrl.value.trim(), rpcQuorum: Number(rpcQuorum.value) },
			network: networkName.value,
		})
		populateConfiguration(configuration)
		actionStatus(networkStatus, 'Chain and RPCs passed validation, were saved, and apply to the next scan.')
	} catch (error) {
		actionStatus(networkStatus, publicFailure(error, 'Could not apply the chain and RPC settings.', true), true)
	} finally {
		networkFields.disabled = pendingNetworkProfile !== undefined || !stateConnected || currentConfiguration === undefined
	}
})

marketConfigurationForm.addEventListener('submit', async event => {
	event.preventDefault()
	marketConfigurationFields.disabled = true
	actionStatus(marketConfigurationSaveStatus, 'Validating…')
	try {
		const value: unknown = JSON.parse(marketConfigurationJson.value)
		const configuration = await put<Configuration>('/api/market-configuration', value)
		marketSourceProbeRows = undefined
		marketSourceCaption.textContent = 'Configured source admission'
		showActiveAdmissionButton.classList.add('hidden')
		actionStatus(marketSourceTestStatus, '')
		populateConfiguration(configuration)
		actionStatus(marketConfigurationSaveStatus, 'Saved; changes apply on the next scan')
	} catch (error) {
		actionStatus(marketConfigurationSaveStatus, publicFailure(error, 'Could not save market configuration. Review the JSON and retry.'), true)
	} finally {
		marketConfigurationFields.disabled = pendingNetworkProfile !== undefined || !stateConnected || currentConfiguration?.networkConfigured !== true
	}
})

testMarketSourcesButton.addEventListener('click', async () => {
	const requestEpoch = profileRequestEpoch
	testMarketSourcesButton.disabled = true
	actionStatus(marketSourceTestStatus, 'Testing saved CEX and DEX sources…')
	try {
		const result = await put<{ assets: { assetId: string; sources: { id: string; kind: 'cex' | 'dex'; market: string; reason?: string; status: 'failed' | 'observed' }[] }[]; blockNumber: string }>('/api/test-market-sources', {})
		if (requestEpoch !== profileRequestEpoch) return
		marketSourceProbeRows = result.assets.flatMap(asset =>
			asset.sources.map(source => ({
				...source,
				assetId: asset.assetId,
				status: source.status,
			})),
		)
		marketSourceCaption.textContent = 'Latest source probe (not admission)'
		showActiveAdmissionButton.classList.remove('hidden')
		renderMarketSources(marketSourceProbeRows)
		actionStatus(marketSourceTestStatus, `Source test completed at block ${result.blockNumber}`)
	} catch (error) {
		if (requestEpoch !== profileRequestEpoch) return
		marketSourceProbeRows = undefined
		marketSourceCaption.textContent = 'Configured source admission'
		showActiveAdmissionButton.classList.add('hidden')
		if (currentSnapshot !== undefined) renderMarketSources(currentSnapshot.marketSources)
		actionStatus(marketSourceTestStatus, publicFailure(error, 'Could not test saved market sources. Check the bot logs and retry.'), true)
	} finally {
		testMarketSourcesButton.disabled = pendingNetworkProfile !== undefined || !stateConnected || currentConfiguration?.networkConfigured !== true
	}
})

showActiveAdmissionButton.addEventListener('click', () => {
	marketSourceProbeRows = undefined
	marketSourceCaption.textContent = 'Configured source admission'
	showActiveAdmissionButton.classList.add('hidden')
	actionStatus(marketSourceTestStatus, 'Showing active admission from persisted consensus evidence')
	if (currentSnapshot !== undefined) renderMarketSources(currentSnapshot.marketSources)
})

recheckRecovery.addEventListener('click', async () => {
	recheckRecovery.disabled = true
	try {
		await refresh()
	} finally {
		recheckRecovery.disabled = pendingNetworkProfile !== undefined || !stateConnected || currentConfiguration?.networkConfigured !== true
	}
})

function scanFailureDetail(error: string) {
	const logRange = /fromBlock (\d+) · toBlock (\d+)/i.exec(error)
	if (logRange !== null) return `Log scan failed for fromBlock ${logRange[1]} through toBlock ${logRange[2]}.`
	const normalized = error.toLowerCase()
	if (normalized.includes('rpc')) return 'RPC connectivity or chain reads failed.'
	if (normalized.includes('market') || normalized.includes('price')) return 'Market evidence or price validation failed.'
	if (normalized.includes('persist') || normalized.includes('state')) return 'Durable operator state could not be saved.'
	if (normalized.includes('signer') || normalized.includes('wallet')) return 'Signer or wallet access failed.'
	if (normalized.includes('chain') || normalized.includes('block')) return 'Canonical chain data validation failed.'
	return 'The latest scan cycle returned an unexpected error.'
}

function setGlobalError(message?: string, title = 'Dashboard unavailable', tone: 'error' | 'warning' | 'info' = 'error') {
	if (message === undefined) {
		if (!globalError.classList.contains('hidden')) globalError.classList.add('hidden')
		if (globalError.childNodes.length > 0) globalError.replaceChildren()
		delete globalError.dataset['noticeKey']
		return
	}
	const noticeKey = `${tone}\n${title}\n${message}`
	if (globalError.dataset['noticeKey'] === noticeKey && !globalError.classList.contains('hidden')) return
	globalError.setAttribute('role', tone === 'info' ? 'status' : 'alert')
	globalError.classList.toggle('error', tone === 'error')
	globalError.classList.toggle('warning', tone === 'warning')
	globalError.dataset['noticeKey'] = noticeKey
	if (globalError.classList.contains('hidden')) globalError.classList.remove('hidden')
	const heading = document.createElement('strong')
	heading.textContent = title
	const copy = document.createElement('p')
	copy.textContent = message
	globalError.replaceChildren(heading, copy)
}

function networkFailureLabel(retainedSnapshot: boolean) {
	if (currentConfiguration?.network === undefined) return 'Network unavailable'
	const networkLabel = currentConfiguration.network.name === 'mainnet' ? 'Mainnet' : 'Sepolia'
	return `${networkLabel} · chain ${currentConfiguration.network.chainId.toString()} · ${retainedSnapshot ? 'last known' : 'unverified'}`
}

function renderNetworkBadge() {
	if (!stateConnected) {
		networkBadge.textContent = networkFailureLabel(currentSnapshot !== undefined)
		networkBadge.className = 'badge warning'
		return
	}
	if (!configurationConnected) {
		networkBadge.textContent = 'Network unavailable'
		networkBadge.className = 'badge warning'
		return
	}
	if (currentConfiguration?.network === undefined || currentConfiguration.networkConfigured !== true) {
		const networkLabel = NETWORK_LABELS.get(currentConfiguration?.network?.name)
		networkBadge.textContent = networkLabel === undefined ? 'Choose chain' : `${networkLabel} · RPC setup required`
		networkBadge.className = 'badge warning'
		return
	}
	const networkLabel = currentConfiguration.network.name === 'mainnet' ? 'Mainnet' : 'Sepolia'
	networkBadge.textContent = `${networkLabel} · chain ${currentConfiguration.network.chainId.toString()}`
	networkBadge.className = 'badge'
}

function renderConnectionFailure(error: unknown) {
	void error
	const snapshot = currentSnapshot
	stateConnected = false
	renderNetworkBadge()
	let lastKnownModeLabel: string | undefined
	if (snapshot !== undefined) lastKnownModeLabel = snapshot.execute ? 'Live' : 'Dry run'
	renderDisconnectedHeader({
		attentionBadge,
		attentionTarget: '/overview#global-error',
		capabilityBadge,
		capabilityBadgeClassName: 'badge warning',
		lastKnownModeLabel,
		modeBadge,
		modeBadgeClassName: 'badge warning',
		retainedAttentionCount: snapshot === undefined ? 0 : Math.max(snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length, snapshot.alerts.length),
		runStatusBadge,
		runStatusBadgeClassName: 'badge warning',
		showNotice: title => setGlobalError('State polling failed. Automatic retry is active; use the next successful poll before making an execution decision.', title),
	})
	recoveryGuidance.hidden = true
	setMutationControlsEnabled(false)
}

function strategyInput(name: string) {
	const field = strategyForm.elements.namedItem(name)
	return field instanceof HTMLInputElement ? field.value.trim() : ''
}

function healthPercent(value: string) {
	if (value === '') return '—'
	const basisPoints = Number(value)
	return Number.isFinite(basisPoints) ? `${(basisPoints / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%` : '—'
}

function updateHealthPolicyPreview() {
	const topUp = healthPercent(strategyInput('vaultTopUpHealthBps'))
	const target = healthPercent(strategyInput('vaultTargetHealthBps'))
	const withdraw = healthPercent(strategyInput('vaultWithdrawHealthBps'))
	healthPolicyPreview.textContent = `Top up below ${topUp} · restore to ${target} · withdraw excess above ${withdraw}`
}

function openResumeConfirmation(snapshot: Snapshot) {
	const automaticActions = ['allowAutomaticDeposits', 'allowAutomaticPoolCreation', 'allowAutomaticVaultMigrations', 'allowAutomaticWithdrawals'].filter(name => {
		const field = strategyForm.elements.namedItem(name)
		return field instanceof HTMLInputElement && field.checked
	}).length
	openResumePreflight([
		['Mode', 'Live execution'],
		['Recovery work', snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length === 0 ? 'Clear' : `${(snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length).toString()} unresolved`],
		['Market evidence', snapshot.marketConsensus?.reliable === true ? 'Reliable' : 'Guarded / unavailable'],
		['Eligible pools', snapshot.metrics.eligiblePoolCount.toString()],
		['Execution signer', snapshot.wallet === undefined ? 'Missing' : shortAddress(snapshot.wallet)],
		['Automatic actions enabled', automaticActions.toString()],
	])
}

async function changePaused(paused: boolean) {
	if (pauseRequestPending !== undefined || currentSnapshot === undefined || (!paused && (pendingNetworkProfile !== undefined || !stateConnected || !configurationConnected || currentConfiguration?.networkConfigured !== true))) return
	pauseRequestPending = paused
	setMutationControlsEnabled(stateConnected)
	actionStatus(pauseStatus, '')
	try {
		await put('/api/paused', { paused })
		await refresh()
		actionStatus(pauseStatus, '')
		closeResumePreflight()
	} catch (error) {
		actionStatus(pauseStatus, publicFailure(error, 'Could not change bot status. Check the bot connection and retry.'), true)
	} finally {
		pauseRequestPending = undefined
		setMutationControlsEnabled(stateConnected)
	}
}

pauseButton.addEventListener('click', () => {
	if (currentSnapshot === undefined) return
	if (pauseButton.dataset['action'] === 'confirm-resume') {
		openResumeConfirmation(currentSnapshot)
		return
	}
	void changePaused(!currentSnapshot.paused)
})

cancelResume.addEventListener('click', closeResumePreflight)
confirmResume.addEventListener('click', () => void changePaused(false))
resumeDialog.addEventListener('cancel', () => actionStatus(pauseStatus, ''))

poolFilter.addEventListener('input', () => {
	if (currentSnapshot !== undefined) renderPools(currentSnapshot)
})

strategyForm.addEventListener('input', updateHealthPolicyPreview)

const { scrollToSection, syncSectionNavigation } = createSectionNavigation()

strategyForm.addEventListener('submit', async event => {
	event.preventDefault()
	if (currentConfiguration === undefined) return
	strategyStatus.textContent = 'Saving…'
	const data = new FormData(strategyForm)
	const next = { ...currentConfiguration.strategy }
	for (const [name, value] of data.entries()) next[name] = String(value)
	for (const name of ['stalePriceFundingBufferBps', 'stagedOperationValidForSeconds', 'vaultTargetHealthBps', 'vaultTopUpHealthBps', 'vaultWithdrawHealthBps']) {
		const value = next[name]
		if (typeof value === 'string' && value !== '') next[name] = Number(value)
	}
	for (const name of ['allowAutomaticDeposits', 'allowAutomaticPoolCreation', 'allowAutomaticVaultMigrations', 'allowAutomaticWithdrawals']) {
		const field = strategyForm.elements.namedItem(name)
		next[name] = field instanceof HTMLInputElement && field.checked
	}
	const logLookbackBlocks = Number(data.get('logLookbackBlocks'))
	const historicalLogRecovery = strategyForm.elements.namedItem('historicalLogRecovery')
	next['logLookbackBlocks'] = logLookbackBlocks
	next['historicalLogRecovery'] = historicalLogRecovery instanceof HTMLInputElement && historicalLogRecovery.checked
	try {
		const configuration = await put<Configuration>('/api/strategy', next)
		populateConfiguration(configuration)
		actionStatus(strategyStatus, 'Saved')
	} catch (error) {
		actionStatus(strategyStatus, publicFailure(error, 'Could not save strategy. Review the fields and retry.'), true)
	}
})

signerForm.addEventListener('submit', async event => {
	event.preventDefault()
	const privateKeyField = signerForm.elements.namedItem('privateKey')
	const rememberField = signerForm.elements.namedItem('rememberSigner')
	if (!(privateKeyField instanceof HTMLInputElement) || !(rememberField instanceof HTMLInputElement)) return
	if (privateKeyField.value.trim() === '') {
		actionStatus(signerStatus, 'Enter a private key or use Clear signer.', true)
		return
	}
	actionStatus(signerStatus, 'Updating…')
	try {
		const result = await put<{ wallet?: string }>('/api/signer', {
			privateKey: privateKeyField.value,
			rememberSigner: rememberField.checked,
		})
		privateKeyField.value = ''
		updateSignerButton.disabled = true
		actionStatus(signerStatus, result.wallet === undefined ? 'Signer cleared' : `Signer active: ${shortAddress(result.wallet)}`)
	} catch (error) {
		actionStatus(signerStatus, publicFailure(error, 'Could not update the signer. Check the bot connection and retry.'), true)
	}
})

signerForm.addEventListener('input', () => {
	const privateKeyField = signerForm.elements.namedItem('privateKey')
	updateSignerButton.disabled = pendingNetworkProfile !== undefined || !stateConnected || currentConfiguration?.networkConfigured !== true || !(privateKeyField instanceof HTMLInputElement) || privateKeyField.value.trim() === ''
})

clearSignerButton.addEventListener('click', async () => {
	if (!window.confirm('Clear the active signer and remove its saved private key from the local operator file?')) return
	clearSignerButton.disabled = true
	actionStatus(signerStatus, 'Clearing…')
	try {
		const result = await put<{ wallet?: string }>('/api/signer', {
			privateKey: '',
			rememberSigner: true,
		})
		actionStatus(signerStatus, result.wallet === undefined ? 'Signer cleared' : 'Signer was not cleared', result.wallet !== undefined)
		await refresh()
	} catch (error) {
		actionStatus(signerStatus, publicFailure(error, 'Could not clear the signer. Check the bot connection and retry.'), true)
	} finally {
		clearSignerButton.disabled = pendingNetworkProfile !== undefined || !stateConnected || currentConfiguration?.networkConfigured !== true
	}
})

const refresh = singleFlight(performRefresh)

async function performRefresh() {
	const requestEpoch = profileRequestEpoch
	try {
		const snapshot = await api<Snapshot>('/api/state', undefined, STATE_REQUEST_TIMEOUT_MS)
		if (requestEpoch !== profileRequestEpoch) return
		if (pendingNetworkProfile !== undefined && snapshot.network !== pendingNetworkProfile) return
		render(snapshot)
		if (pendingNetworkProfile !== undefined) pendingProfileStateConfirmed = true
		if (pendingNetworkProfile !== undefined) await loadConfiguration()
	} catch (error) {
		if (requestEpoch !== profileRequestEpoch) return
		renderConnectionFailure(error)
	}
}

async function loadConfiguration() {
	const expectedNetwork = pendingNetworkProfile
	const requestEpoch = profileRequestEpoch
	strategyFields.disabled = true
	if (expectedNetwork === undefined) {
		configurationStatus.classList.remove('hidden')
		configurationStatus.classList.remove('error')
		configurationStatus.textContent = 'Loading pool selection and strategy…'
	}
	try {
		const configuration = await api<Configuration>('/api/configuration', undefined, CONFIGURATION_REQUEST_TIMEOUT_MS)
		if (profileRequestEpoch !== requestEpoch || pendingNetworkProfile !== expectedNetwork) return false
		if (expectedNetwork !== undefined && configuration.network?.name !== expectedNetwork) {
			networkName.value = expectedNetwork
			networkFields.disabled = true
			return false
		}
		if (expectedNetwork !== undefined && !pendingProfileStateConfirmed) return false
		if (expectedNetwork !== undefined) {
			pendingNetworkProfile = undefined
			pendingProfileStateConfirmed = false
		}
		populateConfiguration(configuration)
		if (expectedNetwork !== undefined) {
			const networkLabel = expectedNetwork === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
			actionStatus(networkStatus, configuration.networkConfigured === true ? `${networkLabel} profile loaded. Its saved settings are active.` : `${networkLabel} profile loaded; RPC setup required.`)
		}
		return true
	} catch (error) {
		if (profileRequestEpoch !== requestEpoch || pendingNetworkProfile !== expectedNetwork) return false
		if (expectedNetwork !== undefined) {
			networkName.value = expectedNetwork
			networkFields.disabled = true
			return false
		}
		currentConfiguration = undefined
		configurationConnected = false
		networkBadge.textContent = 'Network unavailable'
		networkBadge.className = 'badge warning'
		configurationStatus.classList.add('error')
		const message = document.createElement('span')
		message.textContent = publicFailure(error, 'Configuration is unavailable. Check the bot connection, then retry. ')
		const retry = document.createElement('button')
		retry.className = 'secondary compact'
		retry.type = 'button'
		retry.textContent = 'Retry configuration'
		retry.addEventListener('click', loadConfiguration)
		configurationStatus.replaceChildren(message, retry)
		setMutationControlsEnabled(stateConnected)
		return false
	}
}

void loadConfiguration()
void refresh()
setInterval(refresh, 3_000)
setInterval(renderBlockStatus, 1_000)
