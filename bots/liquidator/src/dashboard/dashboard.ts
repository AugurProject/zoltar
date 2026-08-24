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
const refreshButton = element('refresh-button', HTMLButtonElement)
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
const resumePreflight = element('resume-preflight', HTMLUListElement)
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
let pendingUniverseMutations = 0
const poolActionStates = new Map<string, { failed: boolean; message: string }>()
const universeActionStates = new Map<string, { failed: boolean; message: string }>()
const recoveryActionStates = new Map<string, { failed: boolean; message: string }>()
let renderedAlertKey: string | undefined
let marketSourceProbeRows: MarketSourceRow[] | undefined
let initialFragmentApplied = false
let stateConnected = false
let configurationConnected = false
let pauseRequestPending: boolean | undefined

const STATE_REQUEST_TIMEOUT_MS = 1_000
const CONFIGURATION_REQUEST_TIMEOUT_MS = 2_000
const PROFILE_SWITCH_REQUEST_TIMEOUT_MS = 2_000
const PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE = 'Profile switch request timed out.'

function compactDuration(seconds: number) {
	if (seconds < 60) return `${seconds.toString()}s`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes.toString()}m`
	const hours = Math.floor(minutes / 60)
	return hours < 24 ? `${hours.toString()}h` : `${Math.floor(hours / 24).toString()}d`
}

function renderBlockStatus(snapshot = currentSnapshot) {
	if (snapshot?.lastScannedBlock === undefined) {
		blockStatus.textContent = 'Block — · waiting for first observation'
		return
	}
	const timestamp = snapshot.lastScannedTimestamp
	if (timestamp === undefined || !/^(?:0|[1-9]\d*)$/.test(timestamp)) {
		blockStatus.textContent = `Block ${snapshot.lastScannedBlock} · timestamp unavailable`
		return
	}
	const timestampMilliseconds = Number(timestamp) * 1_000
	if (!Number.isSafeInteger(timestampMilliseconds)) {
		blockStatus.textContent = `Block ${snapshot.lastScannedBlock} · timestamp unavailable`
		return
	}
	const differenceSeconds = Math.floor(Math.abs(Date.now() - timestampMilliseconds) / 1_000)
	const age = compactDuration(differenceSeconds)
	blockStatus.textContent = Date.now() >= timestampMilliseconds ? `Block ${snapshot.lastScannedBlock} · seen ${age} ago` : `Block ${snapshot.lastScannedBlock} · ${age} ahead of local clock`
}

function setMutationControlsEnabled(enabled: boolean) {
	const configurationAvailable = enabled && currentConfiguration !== undefined
	const chainSettingsAvailable = configurationAvailable && pendingNetworkProfile === undefined && currentConfiguration?.networkConfigured === true
	const resumeAvailable = configurationAvailable && pendingNetworkProfile === undefined && configurationConnected && currentConfiguration?.networkConfigured === true
	const paused = currentSnapshot?.paused
	const pendingLabel = pauseRequestPending === true ? 'Pausing…' : 'Resuming…'
	pauseButton.textContent = pauseRequestPending === undefined ? (paused === true ? 'Resume' : 'Pause') : pendingLabel
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
		for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#pool-rows input, #universe-rows input, #recovery-list input, #recovery-list button')) control.disabled = true
	}
}

async function requestWithTimeout<T>(request: (signal: AbortSignal) => Promise<T>, timeoutMilliseconds: number, timeoutMessage = 'Dashboard state request timed out') {
	const controller = new window.AbortController()
	let timeout: number | undefined
	const deadline = new Promise<never>((_resolve, reject) => {
		timeout = window.setTimeout(() => {
			reject(new Error(timeoutMessage))
			controller.abort()
		}, timeoutMilliseconds)
	})
	try {
		return await Promise.race([request(controller.signal), deadline])
	} finally {
		if (timeout !== undefined) window.clearTimeout(timeout)
	}
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

function shortAddress(address: string) {
	return address.length <= 18 ? address : `${address.slice(0, 10)}…${address.slice(-6)}`
}

function metric(label: string, value: string) {
	const container = document.createElement('dl')
	container.className = 'metric'
	const term = document.createElement('dt')
	term.textContent = label
	const description = document.createElement('dd')
	description.textContent = value
	container.append(term, description)
	return container
}

function updateText(target: Element, value: string) {
	if (target.textContent !== value) target.textContent = value
}

function renderMetrics(snapshot: Snapshot) {
	metrics.replaceChildren(
		metric('Pools', snapshot.metrics.poolCount.toString()),
		metric('Selected', snapshot.metrics.selectedPoolCount.toString()),
		metric('Approved universes', snapshot.metrics.approvedUniverseCount.toString()),
		metric('Eligible pools', snapshot.metrics.eligiblePoolCount.toString()),
		metric('Candidates', snapshot.metrics.candidateCount.toString()),
		metric('Deployed REP', snapshot.metrics.deployedRep),
		metric('Open interest assumed', `${snapshot.metrics.assumedOpenInterestEth} ETH`),
		metric('Wallet ETH', snapshot.metrics.walletEth),
		metric('Wallet REP', snapshot.metrics.walletRep),
	)
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
			badge.className = `badge ${source.status === 'admitted' ? 'ok' : source.status === 'excluded' || source.status === 'failed' ? 'warning' : ''}`
			badge.textContent = source.status === 'admitted' ? 'Admitted' : source.status === 'excluded' ? 'Excluded' : source.status === 'observed' ? 'Observed' : 'Failed'
			const defaultReason =
				source.status === 'admitted' ? 'Meets the active admission policy' : source.status === 'observed' ? 'Probe succeeded; admission still requires the persistence and consensus policy' : source.status === 'failed' ? 'Probe did not return usable evidence' : 'Excluded by the active admission policy'
			const cells = [cell(source.kind.toUpperCase()), cell(source.id), cell(shortAddress(source.assetId)), cell(source.market), cell(badge), cell(source.reason ?? defaultReason)]
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
		updateText(centralizedMarketStatus, consensus === undefined ? 'No market sources configured' : consensus.reliable ? 'Reliable DEX consensus' : consensus.reasons.join(' · '))
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
	updateText(centralizedMarketStatus, consensus === undefined ? (market.reliable ? 'Reliable CEX estimate' : market.reasons.join(' · ')) : consensus.reliable ? 'Reliable independent CEX + DEX consensus' : consensus.reasons.join(' · '))
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

function forkOutcome(outcomeIndex?: string) {
	if (outcomeIndex === undefined) return 'Origin'
	if (outcomeIndex === '0') return 'Invalid'
	if (outcomeIndex === '1') return 'Yes'
	if (outcomeIndex === '2') return 'No'
	return `Outcome ${outcomeIndex}`
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

function universeMetadata(universe: Universe, includeOutcome: boolean) {
	const metadata = document.createElement('p')
	metadata.className = 'truth-metadata'
	const values = [
		`${universe.poolCount.toString()} pool${universe.poolCount === 1 ? '' : 's'} · question #${universe.forkQuestionId}`,
		universeState(universe),
		`${universe.selectedPoolCount.toString()} selected`,
		universe.migratableVaultCount > 0 ? `${universe.migratableVaultCount.toString()} migratable vault${universe.migratableVaultCount === 1 ? '' : 's'}` : 'No vault migration',
	]
	if (includeOutcome) values.unshift(forkOutcome(universe.outcomeIndex))
	for (const value of values) {
		const item = document.createElement('span')
		item.textContent = value
		metadata.append(item)
	}
	return metadata
}

async function saveUniversePolicy(actionKey: string, next: Set<string>, status: HTMLElement) {
	if (pendingUniverseMutations > 0) return
	pendingUniverseMutations += 1
	for (const control of universeRows.querySelectorAll<HTMLInputElement>('input')) control.disabled = true
	universeActionStates.set(actionKey, { failed: false, message: 'Saving…' })
	actionStatus(status, 'Saving…')
	try {
		await put('/api/approved-universes', [...next])
		approvedUniverses = next
		universeActionStates.set(actionKey, { failed: false, message: 'Saved' })
	} catch (error) {
		universeActionStates.set(actionKey, { failed: true, message: publicFailure(error, 'Could not save universe approval. Retry this selection.') })
	} finally {
		pendingUniverseMutations -= 1
		if (currentSnapshot !== undefined) renderUniverses(currentSnapshot)
	}
}

function selectUniversePath(universe: Universe) {
	const next = new Set(approvedUniverses)
	if (currentSnapshot === undefined) {
		next.add(universe.id)
		return next
	}
	const universesById = new Map(currentSnapshot.universes.map(candidate => [candidate.id, candidate]))
	let selected: Universe | undefined = universe
	const visited = new Set<string>()
	while (selected !== undefined && !visited.has(selected.id)) {
		visited.add(selected.id)
		next.add(selected.id)
		if (selected.parentId === undefined) break
		const selectedId = selected.id
		const parentId = selected.parentId
		removeUniverseSubtrees(
			next,
			currentSnapshot.universes.filter(candidate => candidate.parentId === parentId && candidate.id !== selectedId).map(candidate => candidate.id),
		)
		selected = universesById.get(parentId)
	}
	return next
}

function removeUniverseSubtrees(next: Set<string>, rootIds: readonly string[]) {
	if (currentSnapshot === undefined) {
		for (const rootId of rootIds) next.delete(rootId)
		return
	}
	const childrenByParent = new Map<string, string[]>()
	for (const universe of currentSnapshot.universes) {
		if (universe.parentId === undefined) continue
		const children = childrenByParent.get(universe.parentId) ?? []
		children.push(universe.id)
		childrenByParent.set(universe.parentId, children)
	}
	const pending = [...rootIds]
	for (let index = 0; index < pending.length; index += 1) {
		const universeId = pending[index]
		if (universeId === undefined) continue
		next.delete(universeId)
		pending.push(...(childrenByParent.get(universeId) ?? []))
	}
}

function universeChoice(universe: Universe) {
	const choice = document.createElement('label')
	choice.className = 'truth-choice'
	const input = document.createElement('input')
	input.type = 'radio'
	input.name = `truth-path-${universe.parentId ?? 'root'}`
	input.value = universe.id
	input.dataset['recordKey'] = `universe:${universe.id}`
	input.checked = approvedUniverses.has(universe.id)
	input.disabled = pendingNetworkProfile !== undefined || currentConfiguration?.networkConfigured !== true || !stateConnected
	const copy = document.createElement('span')
	copy.className = 'truth-choice-copy'
	const title = document.createElement('strong')
	title.textContent = `${forkOutcome(universe.outcomeIndex)} · universe #${universe.id}`
	copy.append(title, universeMetadata(universe, false))
	const status = document.createElement('span')
	status.className = 'action-status'
	const saved = universeActionStates.get(universe.id)
	if (saved !== undefined) actionStatus(status, saved.message, saved.failed)
	input.addEventListener('change', () => {
		if (!input.checked) return
		void saveUniversePolicy(universe.id, selectUniversePath(universe), status)
	})
	choice.append(copy, input, status)
	return choice
}

function universeFamily(parent: Universe, children: readonly Universe[]) {
	const family = document.createElement('div')
	family.className = 'truth-family'
	const heading = document.createElement('div')
	heading.className = 'truth-parent'
	const copy = document.createElement('div')
	const title = document.createElement('h3')
	title.textContent = `${parent.parentId === undefined ? 'Root' : 'Parent'} universe #${parent.id}`
	copy.append(title, universeMetadata(parent, parent.parentId !== undefined))
	heading.append(copy)
	if (parent.parentId === undefined) {
		const toggleTarget = document.createElement('label')
		toggleTarget.className = 'pool-toggle truth-root-toggle'
		const toggle = document.createElement('input')
		toggle.type = 'checkbox'
		toggle.dataset['recordKey'] = `universe:${parent.id}`
		toggle.checked = approvedUniverses.has(parent.id)
		toggle.disabled = pendingNetworkProfile !== undefined || currentConfiguration?.networkConfigured !== true || !stateConnected
		toggle.setAttribute('aria-label', `Approve root universe ${parent.id}`)
		toggle.addEventListener('change', () => {
			const next = new Set(approvedUniverses)
			if (toggle.checked) next.add(parent.id)
			else removeUniverseSubtrees(next, [parent.id])
			void saveUniversePolicy(parent.id, next, status)
		})
		const status = document.createElement('span')
		status.className = 'action-status truth-parent-status'
		const saved = universeActionStates.get(parent.id)
		if (saved !== undefined) actionStatus(status, saved.message, saved.failed)
		toggleTarget.append(toggle)
		heading.append(toggleTarget, status)
	} else {
		const approval = document.createElement('span')
		approval.className = `badge ${approvedUniverses.has(parent.id) ? 'ok' : ''}`
		approval.textContent = approvedUniverses.has(parent.id) ? 'Approved path' : 'Not approved'
		heading.append(approval)
	}
	family.append(heading)
	if (children.length === 0) return family
	const options = document.createElement('fieldset')
	options.className = 'truth-options'
	const legend = document.createElement('legend')
	legend.append(document.createTextNode('Truth outcome'))
	const legendContext = document.createElement('span')
	legendContext.className = 'visually-hidden'
	legendContext.textContent = ` for universe #${parent.id}`
	legend.append(legendContext)
	options.append(legend)
	const childIds = children.map(child => child.id)
	const none = document.createElement('label')
	none.className = 'truth-choice'
	const noneInput = document.createElement('input')
	noneInput.type = 'radio'
	noneInput.name = `truth-path-${parent.id}`
	noneInput.value = ''
	noneInput.dataset['recordKey'] = `universe:none:${parent.id}`
	noneInput.checked = childIds.every(childId => !approvedUniverses.has(childId))
	noneInput.disabled = pendingNetworkProfile !== undefined || currentConfiguration?.networkConfigured !== true || !stateConnected
	const noneCopy = document.createElement('span')
	noneCopy.className = 'truth-choice-copy'
	const noneTitle = document.createElement('strong')
	noneTitle.textContent = 'No child approved'
	const noneDescription = document.createElement('small')
	noneDescription.textContent = 'Keep every child universe inert'
	noneCopy.append(noneTitle, noneDescription)
	const noneStatus = document.createElement('span')
	noneStatus.className = 'action-status'
	const saved = universeActionStates.get(`none:${parent.id}`)
	if (saved !== undefined) actionStatus(noneStatus, saved.message, saved.failed)
	noneInput.addEventListener('change', () => {
		if (!noneInput.checked) return
		const next = new Set(approvedUniverses)
		removeUniverseSubtrees(next, childIds)
		void saveUniversePolicy(`none:${parent.id}`, next, noneStatus)
	})
	none.append(noneCopy, noneInput, noneStatus)
	options.append(none, ...children.map(child => universeChoice(child)))
	family.append(options)
	return family
}

function renderUniverses(snapshot: Snapshot) {
	if (pendingUniverseMutations > 0) return
	const focusedRecord = activeRecordKey(universeRows)
	if (snapshot.universes.length === 0) {
		const empty = document.createElement('p')
		empty.className = 'empty'
		empty.textContent = 'No universes are registered.'
		universeRows.replaceChildren(empty)
		return
	}
	const childrenByParent = new Map<string, Universe[]>()
	for (const universe of snapshot.universes) {
		if (universe.parentId === undefined) continue
		const children = childrenByParent.get(universe.parentId) ?? []
		children.push(universe)
		childrenByParent.set(universe.parentId, children)
	}
	const families: HTMLElement[] = []
	const visited = new Set<string>()
	const appendFamily = (parent: Universe) => {
		if (visited.has(parent.id)) return
		visited.add(parent.id)
		const children = childrenByParent.get(parent.id) ?? []
		families.push(universeFamily(parent, children))
		for (const child of children) {
			if (childrenByParent.has(child.id)) appendFamily(child)
		}
	}
	for (const root of snapshot.universes.filter(universe => universe.parentId === undefined)) appendFamily(root)
	for (const universe of snapshot.universes) {
		if (!visited.has(universe.id) && childrenByParent.has(universe.id)) appendFamily(universe)
	}
	universeRows.replaceChildren(...families)
	restoreRecordFocus(universeRows, focusedRecord)
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

function publicFailure(error: unknown, message: string) {
	void error
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
		const empty = cell(snapshot.pools.length === 0 ? 'No security pools are registered.' : 'No pools match this filter.')
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
				poolStatus.textContent = !pool.approvedUniverse ? 'Universe not approved' : pool.systemState !== '0' ? 'Pool inactive' : !pool.centralizedPriceAllowed ? 'Market consensus guard' : pool.selected ? 'Eligible' : ''
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
			badge.className = `badge ${activity.status === 'failed' ? 'warning' : activity.status === 'confirmed' ? 'ok' : ''}`
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
	container.replaceChildren(
		...(health ?? []).map(endpoint => {
			const item = document.createElement('div')
			item.className = 'rpc-health-item'
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
			return item
		}),
	)
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
	pauseButton.dataset['action'] = snapshot.paused ? (snapshot.execute ? 'confirm-resume' : 'resume') : 'pause'
	setMutationControlsEnabled(true)
	renderNetworkBadge()
	modeBadge.textContent = snapshot.execute ? 'Live' : 'Dry run'
	modeBadge.className = `badge ${snapshot.execute ? 'warning' : 'ok'}`
	runStatusBadge.textContent = snapshot.status === 'connectivity-degraded' ? 'Connectivity degraded' : snapshot.error !== undefined ? 'Error' : snapshot.paused ? 'Paused' : snapshot.scanning ? 'Scanning' : 'Running'
	runStatusBadge.className = `badge ${snapshot.paused || snapshot.error !== undefined ? 'warning' : 'ok'}`
	capabilityBadge.textContent = snapshot.operatorCapable ? 'Operator capable' : 'Operator blocked'
	capabilityBadge.className = `badge ${snapshot.operatorCapable ? 'ok' : 'warning'}`
	renderAttention(snapshot)
	recoveryGuidance.hidden = snapshot.paused
	lastScan.textContent = snapshot.lastScanAt === undefined ? (snapshot.scanning ? 'Scanning factory registry…' : 'Waiting for first scan') : `Last scan ${new Date(snapshot.lastScanAt).toLocaleString()}`
	walletAddress.textContent = snapshot.wallet ?? 'No active signer'
	setGlobalError(
		snapshot.error === undefined ? undefined : snapshot.status === 'connectivity-degraded' ? 'RPC connectivity is degraded. Execution is blocked and the bot will retry automatically.' : `${scanFailureDetail(snapshot.error)} Automatic retry is active. Check the bot logs if the next cycle also fails.`,
		'Scan failed',
	)
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

function snapshotAttentionCount(snapshot: Snapshot) {
	return (configurationConnected && currentConfiguration?.networkConfigured !== true ? 1 : 0) + Math.max(snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length, snapshot.alerts.length) + (snapshot.error === undefined ? 0 : 1)
}

function renderAttention(snapshot: Snapshot) {
	const networkSetupRequired = configurationConnected && currentConfiguration?.networkConfigured !== true
	const attentionCount = snapshotAttentionCount(snapshot)
	attentionBadge.textContent = attentionCount === 0 ? 'No blockers' : `${attentionCount.toString()} ${attentionCount === 1 ? 'action' : 'actions'}`
	attentionBadge.className = `badge ${attentionCount === 0 ? 'ok' : 'warning'}`
	let attentionTarget = '/overview'
	if (networkSetupRequired) attentionTarget = '/settings#network-connectivity'
	else if (snapshot.pendingTransactions.length > 0 || snapshot.pendingStagedOperations.length > 0) attentionTarget = '/operations#recovery'
	else if (snapshot.error !== undefined) attentionTarget = '/overview#global-error'
	else if (snapshot.alerts.length > 0) attentionTarget = '/operations'
	attentionBadge.href = attentionTarget
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
	actionStatus(networkStatus, 'The profile was saved, but the dashboard did not reconnect in time. Use Refresh to retry.', true)
}

networkForm.addEventListener('submit', async event => {
	event.preventDefault()
	networkFields.disabled = true
	actionStatus(networkStatus, 'Checking every RPC against the selected chain…')
	try {
		const lines = (value: string) =>
			value
				.split('\n')
				.map(entry => entry.trim())
				.filter(Boolean)
		const configuration = await put<Configuration>('/api/network-connectivity', {
			connectivity: { publicRpcUrls: lines(publicRpcUrls.value), quorumRpcUrls: lines(quorumRpcUrls.value), readRpcUrl: readRpcUrl.value.trim(), rpcQuorum: Number(rpcQuorum.value) },
			network: networkName.value,
		})
		populateConfiguration(configuration)
		actionStatus(networkStatus, 'Chain and RPCs passed validation, were saved, and apply to the next scan.')
	} catch (error) {
		actionStatus(networkStatus, publicFailure(error, 'Could not apply the chain and RPC settings.'), true)
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

function setGlobalError(message?: string, title = 'Dashboard unavailable') {
	if (message === undefined) {
		if (!globalError.classList.contains('hidden')) globalError.classList.add('hidden')
		if (globalError.childNodes.length > 0) globalError.replaceChildren()
		delete globalError.dataset['noticeKey']
		return
	}
	const noticeKey = `${title}\n${message}`
	if (globalError.dataset['noticeKey'] === noticeKey && !globalError.classList.contains('hidden')) return
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
		const networkLabel = currentConfiguration?.network?.name === 'mainnet' ? 'Mainnet' : currentConfiguration?.network?.name === 'sepolia' ? 'Sepolia' : undefined
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
	modeBadge.textContent = snapshot === undefined ? 'Mode unavailable' : `${snapshot.execute ? 'Live' : 'Dry run'} · last known`
	modeBadge.className = 'badge warning'
	renderNetworkBadge()
	runStatusBadge.textContent = 'Disconnected'
	runStatusBadge.className = 'badge warning'
	const attentionCount = 1 + (snapshot === undefined ? 0 : Math.max(snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length, snapshot.alerts.length))
	attentionBadge.textContent = `${attentionCount.toString()} ${attentionCount === 1 ? 'action' : 'actions'}`
	attentionBadge.className = 'badge warning'
	attentionBadge.href = '/overview#global-error'
	recoveryGuidance.hidden = true
	setMutationControlsEnabled(false)
	setGlobalError('State polling failed. Automatic retry is active; use the next successful poll before making an execution decision.', 'Dashboard disconnected')
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

function preflightItem(label: string, value: string) {
	const item = document.createElement('li')
	const name = document.createElement('span')
	name.textContent = label
	const status = document.createElement('strong')
	status.textContent = value
	item.append(name, status)
	return item
}

function openResumePreflight(snapshot: Snapshot) {
	const automaticActions = ['allowAutomaticDeposits', 'allowAutomaticPoolCreation', 'allowAutomaticVaultMigrations', 'allowAutomaticWithdrawals'].filter(name => {
		const field = strategyForm.elements.namedItem(name)
		return field instanceof HTMLInputElement && field.checked
	}).length
	resumePreflight.replaceChildren(
		preflightItem('Mode', 'Live execution'),
		preflightItem('Recovery work', snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length === 0 ? 'Clear' : `${(snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length).toString()} unresolved`),
		preflightItem('Market evidence', snapshot.marketConsensus?.reliable === true ? 'Reliable' : 'Guarded / unavailable'),
		preflightItem('Eligible pools', snapshot.metrics.eligiblePoolCount.toString()),
		preflightItem('Execution signer', snapshot.wallet === undefined ? 'Missing' : shortAddress(snapshot.wallet)),
		preflightItem('Automatic actions enabled', automaticActions.toString()),
	)
	if ('showModal' in resumeDialog && typeof resumeDialog.showModal === 'function') resumeDialog.showModal()
	if (!resumeDialog.hasAttribute('open')) resumeDialog.setAttribute('open', '')
	element('resume-title', HTMLElement).focus({ preventScroll: true })
	resumeDialog.scrollTop = 0
}

function closeResumePreflight() {
	if (resumeDialog.hasAttribute('open') && 'close' in resumeDialog && typeof resumeDialog.close === 'function') resumeDialog.close()
	else resumeDialog.removeAttribute('open')
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
		openResumePreflight(currentSnapshot)
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

let refreshInFlight: Promise<void> | undefined
let refreshQueued = false

function setRefreshControlPending(pending: boolean) {
	refreshButton.disabled = pending
	refreshButton.textContent = pending ? 'Refreshing…' : 'Refresh'
	refreshButton.toggleAttribute('aria-busy', pending)
	if (pending) refreshButton.setAttribute('aria-busy', 'true')
}

function refresh() {
	if (refreshInFlight !== undefined) {
		refreshQueued = true
		return refreshInFlight
	}
	const operation = (async () => {
		refreshQueued = false
		await performRefresh()
		while (refreshQueued) {
			refreshQueued = false
			await performRefresh()
		}
	})()
	refreshInFlight = operation.finally(() => {
		refreshInFlight = undefined
		setRefreshControlPending(false)
	})
	setRefreshControlPending(true)
	return refreshInFlight
}

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
refreshButton.addEventListener('click', () => void refresh())
void refresh()
setInterval(refresh, 3_000)
setInterval(renderBlockStatus, 1_000)
