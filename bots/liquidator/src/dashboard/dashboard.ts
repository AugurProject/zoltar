type Activity = {
	at: string
	details?: string
	hash?: string
	kind: string
	message: string
	status: string
}

type Vault = {
	address: string
	capacityOwnershipRep: string
	openInterestDisplay: string
	healthBps?: string
	vaultRepBacking: string
	claimableFeesEth: string
}

type Candidate = {
	bonusValueEth: string
	requestedDebtEth: string
	target: string
	topUpRep: string
}

type Pool = {
	knownVaultCount: string
	address: string
	approvedUniverse: boolean
	botVault: Vault
	candidates: Candidate[]
	settlementCollateralEth: string
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
	truncatedVaults: boolean
	universeId: string
}

type Universe = {
	approved: boolean
	forkedPoolCount: number
	forkQuestionId: string
	forkTime: string
	id: string
	migratableVaultCount: number
	operationalPoolCount: number
	outcomeIndex?: string
	parentId?: string
	poolCount: number
	repToken: string
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
	sourceCount: number
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
	paused: boolean
	pendingTransactions: { hash: string; kind: string; label: string; maxBlockNumber: string; mode: 'private' | 'public'; nonce: string; requiresMarketEvidence: boolean; submissionBlock: string }[]
	pools: Pool[]
	scanning: boolean
	status: string
	marketSources: MarketSourceRow[]
	universes: Universe[]
	wallet?: string
}

type Configuration = {
	approvedUniverses: string[]
	childMarketConfigurations: unknown[]
	centralizedMarkets: unknown
	connectivity: { publicRpcUrls: string[]; quorumRpcUrls: string[]; readRpcUrl: string }
	desiredPools: unknown[]
	network: { chainId: number; explorerUrl: string; name: 'mainnet' | 'sepolia' }
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
const networkStatus = element('network-status', HTMLSpanElement)
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
const marketSourceTestStatus = element('market-source-test-status', HTMLParagraphElement)
const marketSourceRows = element('market-source-rows', HTMLTableSectionElement)
const operatorAlerts = element('operator-alerts', HTMLUListElement)
const recoveryList = element('recovery-list', HTMLDivElement)
const recheckRecovery = element('recheck-recovery', HTMLButtonElement)
const universeRows = element('universe-rows', HTMLTableSectionElement)
const poolRows = element('pool-rows', HTMLTableSectionElement)
const activityList = element('activity-list', HTMLOListElement)
const modeBadge = element('mode-badge', HTMLSpanElement)
const runStatusBadge = element('run-status-badge', HTMLSpanElement)
const pauseButton = element('pause-button', HTMLButtonElement)
const pauseStatus = element('pause-status', HTMLSpanElement)
const lastScan = element('last-scan', HTMLParagraphElement)
const globalError = element('global-error', HTMLDivElement)
const configurationStatus = element('configuration-status', HTMLDivElement)
const poolFilter = element('pool-filter', HTMLInputElement)
const strategyForm = element('strategy-form', HTMLFormElement)
const strategyFields = element('strategy-fields', HTMLFieldSetElement)
const strategyStatus = element('strategy-status', HTMLSpanElement)
const signerForm = element('signer-form', HTMLFormElement)
const signerStatus = element('signer-status', HTMLSpanElement)
const updateSignerButton = element('update-signer', HTMLButtonElement)
const clearSignerButton = element('clear-signer', HTMLButtonElement)
const walletAddress = element('wallet-address', HTMLParagraphElement)

let currentSnapshot: Snapshot | undefined
let currentConfiguration: Configuration | undefined
let approvedUniverses = new Set<string>()
let selectedPools = new Set<string>()
let pendingPoolMutations = 0
let pendingUniverseMutations = 0
const poolActionStates = new Map<string, { failed: boolean; message: string }>()
const universeActionStates = new Map<string, { failed: boolean; message: string }>()
const recoveryActionStates = new Map<string, { failed: boolean; message: string }>()
let renderedAlertKey: string | undefined
let marketSourceProbeRows: MarketSourceRow[] | undefined

async function api<T>(path: string, options?: RequestInit): Promise<T> {
	const response = await fetch(path, options)
	const value: unknown = await response.json()
	if (!response.ok) {
		const error = typeof value === 'object' && value !== null ? Reflect.get(value, 'error') : undefined
		const message = typeof error === 'string' ? error : `Request failed with HTTP ${response.status.toString()}`
		throw new Error(message)
	}
	return value as T
}

function put<T = unknown>(path: string, value: unknown) {
	const body = JSON.stringify(value)
	if (body === undefined) throw new Error('Request body is not JSON serializable')
	return api<T>(path, {
		body,
		headers: { 'content-type': 'application/json' },
		method: 'PUT',
	})
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
	const alertKey = snapshot.alerts.map(alert => `${alert.severity}:${alert.message}`).join('\n')
	if (renderedAlertKey === alertKey) return
	renderedAlertKey = alertKey
	operatorAlerts.classList.toggle('hidden', snapshot.alerts.length === 0)
	operatorAlerts.replaceChildren(
		...snapshot.alerts.map(alert => {
			const item = document.createElement('li')
			item.className = `notice ${alert.severity}`
			item.textContent = alert.message
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
	if (snapshot.pendingTransactions.length === 0) {
		const empty = document.createElement('p')
		empty.className = 'empty'
		empty.textContent = 'No pending transaction intents.'
		recoveryList.replaceChildren(empty)
		return
	}
	recoveryList.replaceChildren(
		...snapshot.pendingTransactions.map(intent => {
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
			button.disabled = !snapshot.paused
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
					button.disabled = !snapshot.paused
				}
			})
			card.append(heading, metadata, form)
			return card
		}),
	)
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

function renderUniverses(snapshot: Snapshot) {
	if (pendingUniverseMutations > 0) return
	const focusedRecord = activeRecordKey(universeRows)
	if (snapshot.universes.length === 0) {
		const row = document.createElement('tr')
		const empty = cell('No universes are registered.')
		empty.colSpan = 6
		empty.className = 'empty'
		row.append(empty)
		universeRows.replaceChildren(row)
		return
	}
	universeRows.replaceChildren(
		...snapshot.universes.map(universe => {
			const row = document.createElement('tr')
			const checkbox = document.createElement('input')
			checkbox.type = 'checkbox'
			checkbox.dataset['recordKey'] = `universe:${universe.id}`
			checkbox.checked = approvedUniverses.has(universe.id)
			checkbox.disabled = currentConfiguration === undefined
			checkbox.setAttribute('aria-label', `Approve universe ${universe.id}`)
			const toggle = document.createElement('label')
			toggle.className = 'pool-toggle'
			const hidden = document.createElement('span')
			hidden.className = 'visually-hidden'
			hidden.textContent = `Approve universe ${universe.id}`
			toggle.append(checkbox, hidden)
			const status = document.createElement('span')
			status.className = 'action-status'
			const savedActionState = universeActionStates.get(universe.id)
			if (savedActionState !== undefined) {
				actionStatus(status, savedActionState.message, savedActionState.failed)
				if (!savedActionState.failed && savedActionState.message === 'Saved') universeActionStates.delete(universe.id)
			}
			checkbox.addEventListener('change', async () => {
				checkbox.disabled = true
				pendingUniverseMutations += 1
				universeActionStates.set(universe.id, { failed: false, message: 'Saving…' })
				actionStatus(status, 'Saving…')
				const next = new Set(approvedUniverses)
				if (checkbox.checked) next.add(universe.id)
				else next.delete(universe.id)
				try {
					await put('/api/approved-universes', [...next])
					approvedUniverses = next
					universeActionStates.set(universe.id, { failed: false, message: 'Saved' })
					actionStatus(status, 'Saved')
				} catch (error) {
					checkbox.checked = !checkbox.checked
					const message = publicFailure(error, 'Could not save universe approval. Retry this selection.')
					universeActionStates.set(universe.id, { failed: true, message })
					actionStatus(status, message, true)
				} finally {
					checkbox.disabled = false
					pendingUniverseMutations -= 1
				}
			})
			const migration = universe.migratableVaultCount > 0 ? `${universe.migratableVaultCount.toString()} eligible parent vault${universe.migratableVaultCount === 1 ? '' : 's'}` : 'No eligible parent vault'
			const cells = [
				cell(toggle, status),
				cell(stacked(`#${universe.id}`, `${universe.poolCount.toString()} pool${universe.poolCount === 1 ? '' : 's'} · question #${universe.forkQuestionId}`)),
				cell(universe.parentId === undefined ? 'Root universe' : `#${universe.parentId}`),
				cell(forkOutcome(universe.outcomeIndex)),
				cell(stacked(universeState(universe), `${universe.selectedPoolCount.toString()} selected pool${universe.selectedPoolCount === 1 ? '' : 's'}`)),
				cell(migration),
			]
			const labels = ['Approved', 'Universe', 'Parent', 'Fork outcome', 'Pool state', 'Vault migration']
			const headings = ['universe-approved-heading', 'universe-id-heading', 'universe-parent-heading', 'universe-outcome-heading', 'universe-state-heading', 'universe-migration-heading']
			for (const [index, value] of cells.entries()) {
				value.dataset['label'] = labels[index]
				value.headers = headings[index] ?? ''
			}
			row.append(...cells)
			return row
		}),
	)
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
			checkbox.disabled = currentConfiguration === undefined
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
				checkbox.disabled = true
				pendingPoolMutations += 1
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
					checkbox.disabled = false
					pendingPoolMutations -= 1
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
				cell(stacked(pool.candidates.length.toString(), pool.truncatedVaults ? 'Vault scan capped' : pool.candidates[0] === undefined ? 'No executable target' : `${pool.candidates[0].bonusValueEth} ETH best bonus`)),
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

function render(snapshot: Snapshot) {
	currentSnapshot = snapshot
	modeBadge.textContent = snapshot.execute ? 'Live' : 'Dry run'
	modeBadge.className = `badge ${snapshot.execute ? 'warning' : 'ok'}`
	runStatusBadge.textContent = snapshot.error !== undefined ? 'Error' : snapshot.paused ? 'Paused' : snapshot.scanning ? 'Scanning' : 'Running'
	runStatusBadge.className = `badge ${snapshot.paused || snapshot.error !== undefined ? 'warning' : 'ok'}`
	pauseButton.textContent = snapshot.paused ? 'Resume' : 'Pause'
	lastScan.textContent = snapshot.lastScanAt === undefined ? (snapshot.scanning ? 'Scanning factory registry…' : 'Waiting for first scan') : `Last scan ${new Date(snapshot.lastScanAt).toLocaleString()}`
	walletAddress.textContent = snapshot.wallet ?? 'No active signer'
	setGlobalError(snapshot.error === undefined ? undefined : 'The bot scan failed. Check the bot logs; the dashboard will retry automatically.')
	renderMetrics(snapshot)
	renderAlerts(snapshot)
	renderCentralizedMarket(snapshot)
	renderMarketSources(marketSourceProbeRows ?? snapshot.marketSources)
	renderRecovery(snapshot)
	renderUniverses(snapshot)
	renderPools(snapshot)
	renderActivities(snapshot.activities)
}

function setFormValue(name: string, value: string | number | boolean) {
	const field = strategyForm.elements.namedItem(name)
	if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = value === true
	else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = String(value)
}

function populateConfiguration(configuration: Configuration) {
	currentConfiguration = configuration
	approvedUniverses = new Set(configuration.approvedUniverses)
	selectedPools = new Set(configuration.selectedPools.map(pool => pool.toLowerCase()))
	for (const [name, value] of Object.entries(configuration.strategy)) setFormValue(name, value)
	networkName.value = configuration.network.name
	readRpcUrl.value = configuration.connectivity.readRpcUrl
	publicRpcUrls.value = configuration.connectivity.publicRpcUrls.join('\n')
	quorumRpcUrls.value = configuration.connectivity.quorumRpcUrls.join('\n')
	networkFields.disabled = false
	marketConfigurationJson.value = JSON.stringify({ children: configuration.childMarketConfigurations, desiredPools: configuration.desiredPools, root: configuration.centralizedMarkets }, undefined, 2) ?? ''
	marketConfigurationFields.disabled = false
	strategyFields.disabled = false
	configurationStatus.classList.add('hidden')
	configurationStatus.replaceChildren()
	if (currentSnapshot !== undefined) {
		renderUniverses(currentSnapshot)
		renderPools(currentSnapshot)
	}
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
			connectivity: { publicRpcUrls: lines(publicRpcUrls.value), quorumRpcUrls: lines(quorumRpcUrls.value), readRpcUrl: readRpcUrl.value.trim() },
			network: networkName.value,
		})
		populateConfiguration(configuration)
		actionStatus(networkStatus, 'Chain and RPCs passed validation, were saved, and apply to the next scan.')
	} catch (error) {
		actionStatus(networkStatus, publicFailure(error, 'Could not apply the chain and RPC settings.'), true)
	} finally {
		networkFields.disabled = false
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
		marketConfigurationFields.disabled = false
	}
})

testMarketSourcesButton.addEventListener('click', async () => {
	testMarketSourcesButton.disabled = true
	actionStatus(marketSourceTestStatus, 'Testing saved CEX and DEX sources…')
	try {
		const result = await put<{ assets: { assetId: string; sources: { id: string; kind: 'cex' | 'dex'; market: string; reason?: string; status: 'failed' | 'observed' }[] }[]; blockNumber: string }>('/api/test-market-sources', {})
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
		marketSourceProbeRows = undefined
		marketSourceCaption.textContent = 'Configured source admission'
		showActiveAdmissionButton.classList.add('hidden')
		if (currentSnapshot !== undefined) renderMarketSources(currentSnapshot.marketSources)
		actionStatus(marketSourceTestStatus, publicFailure(error, 'Could not test saved market sources. Check the bot logs and retry.'), true)
	} finally {
		testMarketSourcesButton.disabled = false
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
		recheckRecovery.disabled = false
	}
})

function setGlobalError(message?: string) {
	if (message === undefined) {
		if (!globalError.classList.contains('hidden')) globalError.classList.add('hidden')
		if (globalError.textContent !== '') globalError.textContent = ''
		return
	}
	if (globalError.classList.contains('hidden')) globalError.classList.remove('hidden')
	if (globalError.textContent !== message) globalError.textContent = message
}

function showGlobalError(error: unknown) {
	setGlobalError(publicFailure(error, 'Dashboard data is unavailable. Check the bot connection; the dashboard will retry automatically.'))
}

pauseButton.addEventListener('click', async () => {
	if (currentSnapshot === undefined) return
	pauseButton.disabled = true
	actionStatus(pauseStatus, currentSnapshot.paused ? 'Resuming…' : 'Pausing…')
	try {
		await put('/api/paused', { paused: !currentSnapshot.paused })
		await refresh()
		actionStatus(pauseStatus, '')
	} catch (error) {
		actionStatus(pauseStatus, publicFailure(error, 'Could not change bot status. Check the bot connection and retry.'), true)
	} finally {
		pauseButton.disabled = false
	}
})

poolFilter.addEventListener('input', () => {
	if (currentSnapshot !== undefined) renderPools(currentSnapshot)
})

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
	updateSignerButton.disabled = !(privateKeyField instanceof HTMLInputElement) || privateKeyField.value.trim() === ''
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
		clearSignerButton.disabled = false
	}
})

let refreshInFlight: Promise<void> | undefined
let refreshQueued = false

function refresh() {
	if (refreshInFlight !== undefined) {
		refreshQueued = true
		return refreshInFlight
	}
	refreshInFlight = (async () => {
		refreshQueued = false
		await performRefresh()
		while (refreshQueued) {
			refreshQueued = false
			await performRefresh()
		}
	})().finally(() => {
		refreshInFlight = undefined
	})
	return refreshInFlight
}

async function performRefresh() {
	try {
		render(await api<Snapshot>('/api/state'))
	} catch (error) {
		showGlobalError(error)
	}
}

async function loadConfiguration() {
	strategyFields.disabled = true
	configurationStatus.classList.remove('hidden')
	configurationStatus.classList.remove('error')
	configurationStatus.textContent = 'Loading pool selection and strategy…'
	try {
		populateConfiguration(await api<Configuration>('/api/configuration'))
	} catch (error) {
		configurationStatus.classList.add('error')
		const message = document.createElement('span')
		message.textContent = publicFailure(error, 'Configuration is unavailable. Check the bot connection, then retry. ')
		const retry = document.createElement('button')
		retry.className = 'secondary compact'
		retry.type = 'button'
		retry.textContent = 'Retry configuration'
		retry.addEventListener('click', loadConfiguration)
		configurationStatus.replaceChildren(message, retry)
	}
}

void loadConfiguration()
void refresh()
setInterval(refresh, 3_000)
