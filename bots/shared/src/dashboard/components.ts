export function setAttentionBadge(element: HTMLAnchorElement, count: number, target: string) {
	element.hidden = count === 0
	const label = count === 0 ? '' : `${count.toString()} ${count === 1 ? 'action' : 'actions'}`
	if (element.textContent !== label) element.textContent = label
	element.className = 'badge attention-badge'
	element.dataset['tone'] = count === 0 ? 'ok' : 'warning'
	if (count === 0) element.removeAttribute('href')
	else element.setAttribute('href', target)
}

export function renderDisconnectedHeader(options: {
	attentionBadge: HTMLAnchorElement
	attentionTarget: string
	capabilityBadge: HTMLElement
	capabilityBadgeClassName: string
	lastKnownModeLabel: string | undefined
	modeBadge: HTMLElement
	modeBadgeClassName: string
	retainedAttentionCount: number
	runStatusBadge: HTMLElement
	runStatusBadgeClassName: string
	showNotice: (title: string) => void
}) {
	options.modeBadge.textContent = options.lastKnownModeLabel === undefined ? 'Mode unavailable' : `${options.lastKnownModeLabel} · last known`
	options.modeBadge.className = options.modeBadgeClassName
	options.capabilityBadge.hidden = false
	options.capabilityBadge.textContent = 'Capability unavailable'
	options.capabilityBadge.className = options.capabilityBadgeClassName
	options.runStatusBadge.textContent = 'Disconnected'
	options.runStatusBadge.className = options.runStatusBadgeClassName
	setAttentionBadge(options.attentionBadge, options.retainedAttentionCount + 1, options.attentionTarget)
	options.showNotice('Dashboard disconnected')
}

export function endpointHealthDetail(endpoint: { consecutiveFailures: number; error?: string | undefined; latencyMilliseconds?: number | undefined; nextRetryAt?: string | undefined }) {
	const metadata = [endpoint.consecutiveFailures > 0 ? `${endpoint.consecutiveFailures.toString()} consecutive failure${endpoint.consecutiveFailures === 1 ? '' : 's'}` : undefined, endpoint.nextRetryAt === undefined ? undefined : `retry ${new Date(endpoint.nextRetryAt).toLocaleTimeString()}`].filter(
		value => value !== undefined,
	)
	const primaryDetail = endpoint.error ?? (endpoint.latencyMilliseconds === undefined ? 'Awaiting first request' : `${endpoint.latencyMilliseconds.toString()} ms`)
	return [primaryDetail, ...metadata].join(' · ')
}

export function endpointRow(className: string, endpoint: { status: string; target: string }, detail: string) {
	const item = document.createElement('div')
	item.className = className
	item.dataset['status'] = endpoint.status
	const status = document.createElement('strong')
	status.textContent = endpoint.status
	const target = document.createElement('span')
	target.className = 'mono'
	target.textContent = endpoint.target
	const detailElement = document.createElement('small')
	detailElement.textContent = detail
	item.append(status, target, detailElement)
	return item
}

export function createMetric(label: string, value: string, detail?: string) {
	const container = document.createElement('dl')
	container.className = 'metric'
	const term = document.createElement('dt')
	term.textContent = label
	const description = document.createElement('dd')
	description.textContent = value
	container.append(term, description)
	if (detail !== undefined) {
		const note = document.createElement('dd')
		note.className = 'metric-detail'
		note.textContent = detail
		container.append(note)
	}
	return container
}
