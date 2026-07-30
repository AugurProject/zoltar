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
	botVault: Vault
	candidates: Candidate[]
	collateralEth: string
	isPriceValid: boolean
	lastPrice: string
	multiplierBps: string
	questionId: string
	selected: boolean
	systemState: string
	totalAllowanceEth: string
	totalRep: string
	truncatedVaults: boolean
}

type Snapshot = {
	activities: Activity[]
	error?: string
	execute: boolean
	lastScanAt?: string
	metrics: {
		assumedDebtEth: string
		candidateCount: number
		deployedRep: string
		poolCount: number
		selectedPoolCount: number
		walletEth: string
		walletRep: string
	}
	paused: boolean
	pools: Pool[]
	scanning: boolean
	status: string
	wallet?: string
}

type Configuration = {
	selectedPools: string[]
	strategy: Record<string, string | number | boolean>
}

function element<T extends Element>(id: string, constructor: { new (): T }) {
	const value = document.getElementById(id)
	if (!(value instanceof constructor)) throw new Error(`Missing dashboard element #${id}`)
	return value
}

const metrics = element('metrics', HTMLDivElement)
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
let selectedPools = new Set<string>()

async function api<T>(path: string, options?: RequestInit): Promise<T> {
	const response = await fetch(path, options)
	const value: unknown = await response.json()
	if (!response.ok) {
		const message = typeof value === 'object' && value !== null && typeof Reflect.get(value, 'error') === 'string' ? Reflect.get(value, 'error') : `Request failed with HTTP ${response.status.toString()}`
		throw new Error(message)
	}
	return value as T
}

function put<T = unknown>(path: string, value: unknown) {
	return api<T>(path, {
		body: JSON.stringify(value),
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

function renderMetrics(snapshot: Snapshot) {
	metrics.replaceChildren(
		metric('Pools', snapshot.metrics.poolCount.toString()),
		metric('Enabled', snapshot.metrics.selectedPoolCount.toString()),
		metric('Candidates', snapshot.metrics.candidateCount.toString()),
		metric('Deployed REP', snapshot.metrics.deployedRep),
		metric('Assumed debt', `${snapshot.metrics.assumedDebtEth} ETH`),
		metric('Wallet ETH', snapshot.metrics.walletEth),
		metric('Wallet REP', snapshot.metrics.walletRep),
	)
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
	element.textContent = message
	element.classList.toggle('error', failed)
}

function botVaultState(vault: Vault) {
	const health = vault.healthBps === undefined ? undefined : BigInt(vault.healthBps)
	if (vault.rep === '0' && vault.allowanceEth === '0') return 'Inactive'
	if (health === undefined) return 'No assumed debt'
	if (health < 10_000n) return `Top-up required · ${health.toString()} bps`
	return `Healthy · ${health.toString()} bps`
}

function renderPools(snapshot: Snapshot) {
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
			checkbox.checked = selectedPools.has(pool.address.toLowerCase())
			checkbox.setAttribute('aria-label', `Enable pool ${pool.address}`)
			checkbox.disabled = currentConfiguration === undefined
			const toggle = document.createElement('label')
			toggle.className = 'pool-toggle'
			const toggleText = document.createElement('span')
			toggleText.className = 'visually-hidden'
			toggleText.textContent = `Enable pool ${pool.address}`
			toggle.append(checkbox, toggleText)
			const poolStatus = document.createElement('span')
			poolStatus.className = 'action-status'
			checkbox.addEventListener('change', async () => {
				checkbox.disabled = true
				actionStatus(poolStatus, 'Saving…')
				const next = new Set(selectedPools)
				if (checkbox.checked) next.add(pool.address.toLowerCase())
				else next.delete(pool.address.toLowerCase())
				try {
					await put('/api/selected-pools', [...next])
					selectedPools = next
					actionStatus(poolStatus, 'Saved')
				} catch (error) {
					checkbox.checked = !checkbox.checked
					actionStatus(poolStatus, error instanceof Error ? error.message : String(error), true)
				} finally {
					checkbox.disabled = false
				}
			})
			const addressDetails = document.createElement('details')
			addressDetails.className = 'address-details'
			const address = document.createElement('summary')
			address.className = 'address'
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
				cell(oracleBadge, stacked('', `${pool.lastPrice} REP / ETH`)),
				cell(stacked(`${pool.totalRep} REP`, `${pool.totalAllowanceEth} ETH allowance · ${pool.activeVaultCount} vaults`)),
				cell(stacked(botVaultState(pool.botVault), `${pool.botVault.rep} REP · ${pool.botVault.allowanceEth} ETH assumed · ${pool.botVault.unpaidEthFees} ETH fees`)),
				cell(stacked(pool.candidates.length.toString(), pool.truncatedVaults ? 'Vault scan capped' : pool.candidates[0] === undefined ? 'No executable target' : `${pool.candidates[0].bonusValueEth} ETH best bonus`)),
			]
			const labels = ['Enabled', 'Pool', 'Question', 'Oracle', 'Pool totals', 'Bot vault', 'Targets']
			for (const [index, value] of cells.entries()) value.dataset['label'] = labels[index]
			row.append(...cells)
			return row
		}),
	)
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
	if (snapshot.error === undefined) {
		globalError.classList.add('hidden')
		globalError.textContent = ''
	} else {
		globalError.classList.remove('hidden')
		globalError.textContent = snapshot.error
	}
	renderMetrics(snapshot)
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
	selectedPools = new Set(configuration.selectedPools.map(pool => pool.toLowerCase()))
	for (const [name, value] of Object.entries(configuration.strategy)) setFormValue(name, value)
	strategyFields.disabled = false
	configurationStatus.classList.add('hidden')
	configurationStatus.replaceChildren()
	if (currentSnapshot !== undefined) renderPools(currentSnapshot)
}

function showGlobalError(error: unknown) {
	globalError.classList.remove('hidden')
	globalError.textContent = error instanceof Error ? error.message : String(error)
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
		actionStatus(pauseStatus, error instanceof Error ? error.message : String(error), true)
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
	for (const name of ['allowAutomaticDeposits', 'allowAutomaticWithdrawals']) {
		const field = strategyForm.elements.namedItem(name)
		next[name] = field instanceof HTMLInputElement && field.checked
	}
	try {
		const configuration = await put<Configuration>('/api/strategy', next)
		populateConfiguration(configuration)
		actionStatus(strategyStatus, 'Saved')
	} catch (error) {
		actionStatus(strategyStatus, error instanceof Error ? error.message : String(error), true)
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
		actionStatus(signerStatus, error instanceof Error ? error.message : String(error), true)
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
		actionStatus(signerStatus, error instanceof Error ? error.message : String(error), true)
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
		message.textContent = `${error instanceof Error ? error.message : String(error)} `
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
