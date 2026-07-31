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
	allowanceEth: string
	healthBps?: string
	rep: string
	unpaidEthFees: string
}

type Candidate = {
	bonusValueEth: string
	debtToMoveEth: string
	target: string
	topUpRep: string
}

type Pool = {
	activeVaultCount: string
	address: string
	approvedUniverse: boolean
	botVault: Vault
	candidates: Candidate[]
	collateralEth: string
	centralizedPriceAllowed: boolean
	centralizedPriceDeviationBps?: string
	isPriceValid: boolean
	lastPrice: string
	multiplierBps: string
	questionId: string
	selected: boolean
	systemState: string
	totalAllowanceEth: string
	totalRep: string
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

type Snapshot = {
	activities: Activity[]
	centralizedMarket?: CentralizedMarket
	error?: string
	execute: boolean
	lastScanAt?: string
	metrics: {
		approvedUniverseCount: number
		assumedDebtEth: string
		candidateCount: number
		deployedRep: string
		eligiblePoolCount: number
		poolCount: number
		selectedPoolCount: number
		walletEth: string
		walletRep: string
	}
	paused: boolean
	pools: Pool[]
	scanning: boolean
	status: string
	universes: Universe[]
	wallet?: string
}

type Configuration = {
	approvedUniverses: string[]
	selectedPools: string[]
	strategy: Record<string, string | number | boolean>
}

function element<T extends Element>(id: string, constructor: { new (): T }) {
	const value = document.getElementById(id)
	if (!(value instanceof constructor)) throw new Error(`Missing dashboard element #${id}`)
	return value
}

const metrics = element('metrics', HTMLDivElement)
const centralizedMarketRows = element('centralized-market-rows', HTMLTableSectionElement)
const centralizedMarketStatus = element('centralized-market-status', HTMLParagraphElement)
const centralizedMarketPrice = element('centralized-market-price', HTMLElement)
const centralizedMarketBidDepth = element('centralized-market-bid-depth', HTMLElement)
const centralizedMarketAskDepth = element('centralized-market-ask-depth', HTMLElement)
const centralizedMarketSourceCount = element('centralized-market-source-count', HTMLElement)
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
		metric('Assumed debt', `${snapshot.metrics.assumedDebtEth} ETH`),
		metric('Wallet ETH', snapshot.metrics.walletEth),
		metric('Wallet REP', snapshot.metrics.walletRep),
	)
}

function renderCentralizedMarket(snapshot: Snapshot) {
	const market = snapshot.centralizedMarket
	if (market === undefined) {
		updateText(centralizedMarketStatus, 'No exchange sources configured')
		updateText(centralizedMarketPrice, '—')
		updateText(centralizedMarketBidDepth, '—')
		updateText(centralizedMarketAskDepth, '—')
		updateText(centralizedMarketSourceCount, '0')
		const row = document.createElement('tr')
		const empty = cell('Add public exchange sources in the operator configuration.')
		empty.colSpan = 6
		empty.className = 'empty'
		row.append(empty)
		centralizedMarketRows.replaceChildren(row)
		return
	}
	updateText(centralizedMarketStatus, market.reliable ? 'Reliable cross-venue estimate' : market.reasons.join(' · '))
	updateText(centralizedMarketPrice, market.priceRepPerEth)
	updateText(centralizedMarketBidDepth, `${market.bidDepthEth} ETH`)
	updateText(centralizedMarketAskDepth, `${market.askDepthEth} ETH`)
	updateText(centralizedMarketSourceCount, market.observations.length.toString())
	centralizedMarketRows.replaceChildren(
		...market.observations.map(observation => {
			const row = document.createElement('tr')
			const cells = [cell(observation.exchangeId), cell(observation.repMarket), cell(observation.priceRepPerEth), cell(`${observation.bidDepthEth} ETH`), cell(`${observation.askDepthEth} ETH`), cell(new Date(observation.observedAt).toLocaleTimeString())]
			const labels = ['Exchange', 'Market', 'REP / ETH', 'Bid depth', 'Ask depth', 'Observed']
			for (const [index, value] of cells.entries()) value.dataset['label'] = labels[index]
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
			for (const [index, value] of cells.entries()) value.dataset['label'] = labels[index]
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
	if (vault.rep === '0' && vault.allowanceEth === '0') return 'Inactive'
	if (health === undefined) return 'No assumed debt'
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
				poolStatus.textContent = !pool.approvedUniverse ? 'Universe not approved' : pool.systemState !== '0' ? 'Pool inactive' : !pool.centralizedPriceAllowed ? 'CEX price guard' : pool.selected ? 'Eligible' : ''
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
				cell(oracleBadge, stacked('', `${pool.lastPrice} REP / ETH${pool.centralizedPriceDeviationBps === undefined ? '' : ` · ${pool.centralizedPriceDeviationBps} bps from CEX`}`)),
				cell(stacked(`${pool.totalRep} REP`, `${pool.totalAllowanceEth} ETH allowance · ${pool.activeVaultCount} vaults`)),
				cell(stacked(botVaultState(pool.botVault), `${pool.botVault.rep} REP · ${pool.botVault.allowanceEth} ETH assumed · ${pool.botVault.unpaidEthFees} ETH fees`)),
				cell(stacked(pool.candidates.length.toString(), pool.truncatedVaults ? 'Vault scan capped' : pool.candidates[0] === undefined ? 'No executable target' : `${pool.candidates[0].bonusValueEth} ETH best bonus`)),
			]
			const labels = ['Selected', 'Pool', 'Question', 'Oracle', 'Pool totals', 'Bot vault', 'Targets']
			for (const [index, value] of cells.entries()) value.dataset['label'] = labels[index]
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
	renderCentralizedMarket(snapshot)
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
	strategyFields.disabled = false
	configurationStatus.classList.add('hidden')
	configurationStatus.replaceChildren()
	if (currentSnapshot !== undefined) {
		renderUniverses(currentSnapshot)
		renderPools(currentSnapshot)
	}
}

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
	for (const name of ['allowAutomaticDeposits', 'allowAutomaticVaultMigrations', 'allowAutomaticWithdrawals']) {
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

async function refresh() {
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
