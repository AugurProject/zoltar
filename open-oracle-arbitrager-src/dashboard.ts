import type { ConnectivitySettings } from './connectivity.js'
import type { ExecutionRecord, OperationEntry, OperatorSnapshot, OpportunitySnapshot, StrategySettings, TransactionActivity } from './operator-state.js'
import { blockAgeLabel, exactAmount, requiredSignerPrivateKey, signerControlState, sumSignedDecimals } from './dashboard-format.js'
import type { SubmissionSettings } from './transaction-submission.js'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
let latestSnapshot: OperatorSnapshot | undefined
let settingsLoaded = false
let submissionLoaded = false
let connectivityLoaded = false
let connected = false
let signerFeedback: { error: boolean; message: string } | undefined
let signerRequestPending = false

function element<T extends HTMLElement>(id: string) {
	const found = document.getElementById(id)
	if (!(found instanceof HTMLElement)) throw new Error(`Missing dashboard element: ${id}`)
	return found as T
}

function setText(id: string, value: string) {
	element(id).textContent = value
}

function setControlsEnabled(enabled: boolean) {
	connected = enabled
	element<HTMLButtonElement>('pause-button').disabled = !enabled
	const fieldset = element('strategy-fieldset')
	if (!(fieldset instanceof HTMLFieldSetElement)) throw new Error('Missing strategy fieldset')
	fieldset.disabled = !enabled
	const submissionFieldset = element('submission-fieldset')
	if (!(submissionFieldset instanceof HTMLFieldSetElement)) throw new Error('Missing submission fieldset')
	submissionFieldset.disabled = !enabled
	for (const id of ['connectivity-fieldset', 'signer-fieldset']) {
		const fieldset = element(id)
		if (!(fieldset instanceof HTMLFieldSetElement)) throw new Error(`Missing ${id}`)
		fieldset.disabled = !enabled
	}
}

function shorten(value: string, leading = 8, trailing = 6) {
	return value.length <= leading + trailing + 1 ? value : `${value.slice(0, leading)}…${value.slice(-trailing)}`
}

function amount(value: string | undefined, symbol: string) {
	if (value === undefined) return 'Unavailable'
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return `${value} ${symbol}`
	return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(numeric)} ${symbol}`
}

function isSnapshot(value: unknown): value is OperatorSnapshot {
	return typeof value === 'object' && value !== null && 'status' in value && 'settings' in value && 'submission' in value && 'opportunities' in value && 'executionHistory' in value && 'transactionActivity' in value
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

function row(cells: readonly (HTMLElement | string)[]) {
	const tableRow = document.createElement('tr')
	for (const value of cells) {
		const cell = document.createElement('td')
		if (typeof value === 'string') cell.textContent = value
		else cell.append(value)
		tableRow.append(cell)
	}
	return tableRow
}

function link(value: string, kind: 'address' | 'tx') {
	const anchor = document.createElement('a')
	anchor.href = `${latestSnapshot?.explorerUrl ?? 'https://etherscan.io'}/${kind}/${value}`
	anchor.target = '_blank'
	anchor.rel = 'noreferrer'
	anchor.textContent = shorten(value)
	anchor.title = value
	return anchor
}

function decisionReason(decision: OpportunitySnapshot['decision']) {
	const reasons: Record<OpportunitySnapshot['decision'], string> = {
		'dry-run-opportunity': 'All economic guards pass; execution mode is disabled',
		eligible: 'Profit, timing, state, and inventory guards pass',
		'execution-failed': 'Execution raised an error after selection',
		'history-unavailable': 'Confirmed-history durability is unavailable',
		'insufficient-inventory': 'Wallet lacks the required WETH or REP',
		paused: 'Operator paused execution',
		selected: 'Highest modeled net profit in this scan',
		'self-report': 'Current wallet is already the reporter',
		'signer-unavailable': 'Execution mode is locked until a local signer is set',
		submitted: 'Signed dispute was accepted for delivery',
		unprofitable: 'Modeled profit is below configured thresholds',
	}
	return reasons[decision]
}

function decisionBadge(opportunity: OpportunitySnapshot) {
	const badge = document.createElement('span')
	badge.className = 'decision'
	badge.dataset['decision'] = opportunity.decision
	badge.textContent = opportunity.decision.replaceAll('-', ' ')
	return badge
}

function renderBalances(snapshot: OperatorSnapshot) {
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
			row([
				opportunity.reportId,
				decisionBadge(opportunity),
				decisionReason(opportunity.decision),
				opportunity.direction,
				amount(opportunity.estimatedNetProfitEth, 'ETH'),
				amount(opportunity.requiredWeth, 'WETH'),
				amount(opportunity.requiredRep, 'REP'),
				`${opportunity.timeRemaining} ${opportunity.windowUnit}`,
				link(opportunity.pool, 'address'),
			]),
		)
	}
	element('opportunities-empty').hidden = opportunities.length !== 0
	setText('opportunity-count', `${opportunities.length.toString()} evaluated`)
}

function renderHistory(history: readonly ExecutionRecord[], recordCount: number) {
	const body = element<HTMLTableSectionElement>('history-body')
	body.replaceChildren()
	for (const record of history) {
		body.append(
			row([
				new Date(record.executedAt).toLocaleString(),
				record.reportId,
				record.direction,
				exactAmount(record.estimatedNetProfitWeth, 'ETH'),
				exactAmount(record.trackedNetProfitEth, 'ETH'),
				exactAmount(record.actualGasCostEth, 'ETH'),
				`${amount(record.requiredWeth, 'WETH')} · ${amount(record.requiredRep, 'REP')}`,
				link(record.transactionHash, 'tx'),
			]),
		)
	}
	element('history-empty').hidden = history.length !== 0
	renderProfitChart(history, recordCount)
}

function renderProfitChart(history: readonly ExecutionRecord[], recordCount: number) {
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
	const width = 1000
	const height = 90
	const points = values.map((value, index) => {
		const x = values.length === 1 ? width : (index / (values.length - 1)) * width
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
	const summary = document.createElement('div')
	summary.className = 'profit-chart-summary'
	const label = document.createElement('span')
	label.textContent = recordCount > history.length ? `Tracked net profit · latest ${history.length.toString()} of ${recordCount.toString()} records` : `Tracked net profit · ${recordCount.toString()} records`
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
}

function loadConnectivity(connectivity: ConnectivitySettings) {
	element<HTMLInputElement>('read-rpc-url').value = connectivity.readRpcUrl
	element<HTMLTextAreaElement>('public-rpc-urls').value = connectivity.publicRpcUrls.join('\n')
}

function renderEndpointChecks(snapshot: OperatorSnapshot) {
	const container = element('endpoint-checks')
	container.replaceChildren()
	for (const check of snapshot.endpointChecks) {
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
}

function renderOperations(operations: readonly OperationEntry[]) {
	const visibleOperations = operations.filter(operation => operation.category !== 'scan')
	const body = element<HTMLTableSectionElement>('operations-body')
	body.replaceChildren()
	for (const operation of visibleOperations) {
		const level = document.createElement('span')
		level.className = 'log-level'
		level.dataset['level'] = operation.level
		level.textContent = operation.level
		body.append(row([new Date(operation.timestamp).toLocaleTimeString(), level, operation.category, operation.reportId ?? '—', operation.message, operation.reason ?? '—', operation.details ?? '—']))
	}
	element('operations-empty').hidden = visibleOperations.length !== 0
	setText('operation-count', `${visibleOperations.length.toString()} entries`)
}

function renderSignerStatus(snapshot: OperatorSnapshot) {
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
		const restartSigner = snapshot.savedWallet === undefined ? 'no restart signer' : `restart ${shorten(snapshot.savedWallet)}`
		if (snapshot.queuedWallet === null) signerStatus.textContent = `Clear queued · ${activeSigner} · ${restartSigner}`
		else if (typeof snapshot.queuedWallet === 'string') signerStatus.textContent = `Queued ${shorten(snapshot.queuedWallet)} · ${activeSigner} · ${restartSigner}`
		else if (snapshot.wallet === undefined) signerStatus.textContent = snapshot.savedWallet === undefined ? 'Locked · no signer' : `Locked · ${shorten(snapshot.savedWallet)} saved for restart`
		else if (snapshot.savedWallet === undefined) signerStatus.textContent = `Unlocked · ${shorten(snapshot.wallet)} · memory only`
		else if (snapshot.savedWallet.toLowerCase() === snapshot.wallet.toLowerCase()) signerStatus.textContent = `Unlocked · ${shorten(snapshot.wallet)} · saved for restart`
		else signerStatus.textContent = `Unlocked · ${shorten(snapshot.wallet)} · restart uses ${shorten(snapshot.savedWallet)}`
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

function renderTransactions(transactions: readonly TransactionActivity[]) {
	const body = element<HTMLTableSectionElement>('transactions-body')
	body.replaceChildren()
	for (const transaction of transactions) {
		const accepted = transaction.acceptedTargets.map(target => `accepted: ${target}`)
		const failed = transaction.failedTargets.map(target => `failed: ${target.target}${target.error === undefined ? '' : ` (${target.error})`}`)
		const targets = [...accepted, ...failed].join(', ') || '—'
		body.append(
			row([
				new Date(transaction.updatedAt).toLocaleString(),
				transaction.reportId,
				link(transaction.hash, 'tx'),
				transaction.kind.replaceAll('-', ' '),
				transaction.mode,
				transaction.status.replaceAll('-', ' '),
				targets,
				exactAmount(transaction.estimatedNetProfitEth, 'ETH'),
				exactAmount(transaction.trackedNetProfitEth, 'ETH'),
				exactAmount(transaction.actualGasCostEth, 'ETH'),
			]),
		)
	}
	element('transactions-empty').hidden = transactions.length !== 0
	setText('transaction-count', `${transactions.length.toString()} tracked`)
}

function render(snapshot: OperatorSnapshot) {
	latestSnapshot = snapshot
	setControlsEnabled(true)
	if (!settingsLoaded) {
		loadSettings(snapshot.settings)
		settingsLoaded = true
	}
	if (!submissionLoaded) {
		loadSubmission(snapshot.submission)
		submissionLoaded = true
	}
	if (!connectivityLoaded) {
		loadConnectivity(snapshot.connectivity)
		connectivityLoaded = true
	}
	const modeBadge = element('mode-badge')
	modeBadge.dataset['mode'] = snapshot.mode
	modeBadge.textContent = snapshot.mode
	setText('status-value', snapshot.paused ? 'Paused' : 'Running')
	setText('last-poll-value', snapshot.lastPollAt === undefined ? 'No poll completed' : `Updated ${new Date(snapshot.lastPollAt).toLocaleTimeString()}`)
	setText('active-report-value', snapshot.activeReportCount.toString())
	setText('block-value', snapshot.blockNumber === undefined ? 'Block —' : `Block ${snapshot.blockNumber} · ${blockAgeLabel(snapshot.blockTimestamp)}`)
	setText('profit-value', exactAmount(snapshot.totalTrackedNetProfitEth, 'ETH'))
	setText('revenue-value', exactAmount(snapshot.totalRevenueBeforeGasEth, 'ETH'))
	setText('gas-value', exactAmount(snapshot.totalActualGasCostEth, 'ETH'))
	setText('game-capital-value', exactAmount(snapshot.gameCapital.totalEthWeth, 'ETH'))
	setText('game-capital-detail', `${exactAmount(snapshot.gameCapital.eth, 'ETH')} · ${exactAmount(snapshot.gameCapital.weth, 'WETH')} in observed active games`)
	setText('oracle-address', `Oracle ${snapshot.openOracle}`)
	setText('network-value', `${snapshot.network} · chain ${snapshot.expectedChainId.toString()}`)
	setText('chain-safety', `Expected and continuously verifies ${snapshot.network} chain ${snapshot.expectedChainId.toString()}.`)
	renderSignerStatus(snapshot)
	const pauseButton = element<HTMLButtonElement>('pause-button')
	pauseButton.textContent = snapshot.paused ? 'Resume bot' : 'Pause bot'
	const notice = element('notice')
	let noticeTitle = 'Dry-run mode'
	let noticeCopy = 'Opportunities are monitored, but this process cannot submit transactions. Restart with --execute to change modes.'
	let noticeTone = 'info'
	if (snapshot.execute) {
		noticeTitle = 'Execution mode is active'
		noticeCopy = 'The local wallet can submit disputes when every strategy, timing, inventory, and state guard passes.'
		noticeTone = 'warning'
	}
	if (snapshot.paused) {
		noticeTitle = 'Bot paused'
		noticeCopy = 'Pause is checked immediately before each submission. A submission already started may still finish, and broadcast transactions continue to confirmation.'
		noticeTone = 'warning'
	}
	if (snapshot.lastError !== undefined) {
		noticeTitle = 'Latest poll failed'
		noticeCopy = snapshot.lastError
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
}

async function refresh() {
	try {
		const value: unknown = await api<unknown>('/api/state')
		if (!isSnapshot(value)) throw new Error('Bot returned an invalid state snapshot')
		render(value)
	} catch (error) {
		setControlsEnabled(false)
		setText('notice-title', 'Dashboard disconnected')
		setText('notice-copy', error instanceof Error ? error.message : String(error))
		element('notice').dataset['tone'] = 'danger'
	}
}

element('refresh-button').addEventListener('click', () => void refresh())
element('pause-button').addEventListener('click', async event => {
	const button = event.currentTarget
	if (!(button instanceof HTMLButtonElement) || latestSnapshot === undefined) return
	button.disabled = true
	try {
		await api('/api/paused', {
			body: JSON.stringify({ paused: !latestSnapshot.paused }),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		await refresh()
	} catch (error) {
		setControlsEnabled(false)
		setText('notice-title', 'Unable to change bot state')
		setText('notice-copy', error instanceof Error ? error.message : String(error))
		element('notice').dataset['tone'] = 'danger'
	}
})

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
		setText('form-status', 'Strategy saved. Applies to the next scan and future restarts.')
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
		setText('submission-status', 'Submission settings saved. Applies to the next scan and future restarts.')
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
	const button = element<HTMLFormElement>('connectivity-form').querySelector('button[type="submit"]')
	if (!(button instanceof HTMLButtonElement)) return
	button.disabled = true
	setText('connectivity-status', `Checking every endpoint for ${latestSnapshot?.network ?? 'the selected network'}…`)
	try {
		const connectivity = {
			publicRpcUrls: element<HTMLTextAreaElement>('public-rpc-urls')
				.value.split('\n')
				.map(value => value.trim())
				.filter(value => value !== ''),
			readRpcUrl: element<HTMLInputElement>('read-rpc-url').value.trim(),
		}
		const response = await api<{ connectivity: ConnectivitySettings }>('/api/connectivity', {
			body: JSON.stringify(connectivity),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		loadConnectivity(response.connectivity)
		setText('connectivity-status', 'RPCs passed chain checks and were saved for the next scan and future restarts.')
		await refresh()
	} catch (error) {
		setText('connectivity-status', error instanceof Error ? error.message : String(error))
		await refresh()
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
	signerFeedback = { error: false, message: 'Removing the saved restart key…' }
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
window.setInterval(() => void refresh(), 2_000)
