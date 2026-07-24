import type { ExecutionRecord, OperatorSnapshot, OpportunitySnapshot, StrategySettings } from './operator-state.js'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
let latestSnapshot: OperatorSnapshot | undefined
let settingsLoaded = false
let connected = false

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

function statusLabel(value: OperatorSnapshot['status']) {
	return value.charAt(0).toUpperCase() + value.slice(1)
}

function isSnapshot(value: unknown): value is OperatorSnapshot {
	return typeof value === 'object' && value !== null && 'status' in value && 'settings' in value && 'opportunities' in value && 'executionHistory' in value
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
	anchor.href = `https://etherscan.io/${kind}/${value}`
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

function renderBalances(snapshot: OperatorSnapshot) {
	const list = element('balance-list')
	list.replaceChildren()
	const values: [string, string][] =
		snapshot.balances === undefined
			? [
					['ETH', 'Execution wallet required'],
					['WETH', 'Execution wallet required'],
					['REP', 'Execution wallet required'],
					['Executable portfolio', 'Execution wallet required'],
				]
			: [
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
	setText('wallet-address', snapshot.wallet === undefined ? 'No execution wallet' : snapshot.wallet)
}

function renderOpportunities(opportunities: readonly OpportunitySnapshot[]) {
	const body = element<HTMLTableSectionElement>('opportunities-body')
	body.replaceChildren()
	for (const opportunity of opportunities) {
		body.append(
			row([opportunity.reportId, decisionBadge(opportunity), opportunity.direction, amount(opportunity.estimatedNetProfitWeth, 'WETH'), amount(opportunity.requiredWeth, 'WETH'), amount(opportunity.requiredRep, 'REP'), `${opportunity.timeRemaining} ${opportunity.windowUnit}`, link(opportunity.pool, 'address')]),
		)
	}
	element('opportunities-empty').hidden = opportunities.length !== 0
	setText('opportunity-count', `${opportunities.length.toString()} evaluated`)
}

function renderHistory(history: readonly ExecutionRecord[], recordCount: number) {
	const body = element<HTMLTableSectionElement>('history-body')
	body.replaceChildren()
	for (const record of history) {
		body.append(row([new Date(record.executedAt).toLocaleString(), record.reportId, record.direction, amount(record.estimatedNetProfitWeth, 'WETH'), amount(record.actualGasCostEth, 'ETH'), `${amount(record.requiredWeth, 'WETH')} · ${amount(record.requiredRep, 'REP')}`, link(record.transactionHash, 'tx')]))
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
		total += Number(record.estimatedNetProfitWeth)
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
	title.textContent = 'Estimated net profit trend for the displayed submitted disputes'
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
	label.textContent = recordCount > history.length ? `Estimated net profit trend · latest ${history.length.toString()} of ${recordCount.toString()} records` : `Estimated net profit trend · ${recordCount.toString()} records`
	const value = document.createElement('strong')
	value.textContent = amount(total.toString(), 'WETH')
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

function render(snapshot: OperatorSnapshot) {
	latestSnapshot = snapshot
	setControlsEnabled(true)
	if (!settingsLoaded) {
		loadSettings(snapshot.settings)
		settingsLoaded = true
	}
	const modeBadge = element('mode-badge')
	modeBadge.dataset['mode'] = snapshot.mode
	modeBadge.textContent = snapshot.mode
	setText('status-value', snapshot.paused ? 'Paused' : statusLabel(snapshot.status))
	setText('last-poll-value', snapshot.lastPollAt === undefined ? 'No poll completed' : `Updated ${new Date(snapshot.lastPollAt).toLocaleTimeString()}`)
	setText('active-report-value', snapshot.activeReportCount.toString())
	setText('block-value', snapshot.blockNumber === undefined ? 'Block —' : `Block ${snapshot.blockNumber}`)
	setText('profit-value', amount(snapshot.totalEstimatedNetProfitWeth, 'WETH'))
	setText('gas-value', amount(snapshot.totalActualGasCostEth, 'ETH'))
	setText('oracle-address', `Oracle ${snapshot.openOracle}`)
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
		noticeCopy = 'No new approvals or disputes will be sent. Transactions broadcast before the pause continue to confirmation.'
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
		setText('form-status', 'Strategy updated. Applies to the next scan.')
		await refresh()
	} catch (error) {
		setText('form-status', error instanceof Error ? error.message : String(error))
		await refresh()
	} finally {
		button.disabled = !connected
	}
})

void refresh()
window.setInterval(() => void refresh(), 2_000)
