import { fullIdentifier, formatDate, node, replaceWhenChanged, setBadge, statusLabel, statusTone, transactionExplorerUrl } from './dom.js'

export type TimelineActivity = {
	at?: string | undefined
	details?: string | undefined
	label?: string | undefined
	operationId?: string | undefined
	status?: string | undefined
	summary?: string | undefined
	txHash?: string | undefined
}

const COLLAPSED_ACTIVITY_COUNT = 10

function timelineItem(activity: TimelineActivity, explorerUrl: string | undefined) {
	const row = node('li', 'timeline-item')
	row.append(node('time', 'timeline-time', formatDate(activity.at)))
	const main = node('div', 'timeline-main')
	main.append(node('strong', undefined, activity.label ?? activity.operationId ?? 'Bot activity'))
	if (activity.summary !== undefined) main.append(node('span', 'timeline-detail', activity.summary))
	if (activity.details !== undefined) {
		const disclosure = node('details', 'activity-details')
		disclosure.append(node('summary', undefined, activity.status === 'dry-run' ? 'What was planned' : 'Details'), node('p', 'timeline-detail', activity.details))
		main.append(disclosure)
	}
	if (activity.txHash !== undefined) {
		const identifier = node('div', 'activity-identifier')
		identifier.append(fullIdentifier(activity.txHash, 'activity transaction hash', { explorerUrl: transactionExplorerUrl(explorerUrl, activity.txHash) }))
		main.append(identifier)
	}
	row.append(main)
	// Activity records describe past events; an immutable pending badge would imply a live transaction status.
	if (activity.status !== 'pending') {
		const status = node('span')
		setBadge(status, statusLabel(activity.status ?? 'info'), statusTone(activity.status))
		row.append(status)
	}
	return row
}

/**
 * Renders the overview activity timeline, collapsed to the newest actions until the operator asks
 * for the rest.
 */
export function createActivityTimeline() {
	const list = document.querySelector('#activity-list')
	const expand = document.querySelector('#activity-expand')
	const filter = document.querySelector('#activity-filter')
	if (!(list instanceof HTMLOListElement) || !(expand instanceof HTMLButtonElement) || !(filter instanceof HTMLSelectElement)) throw new Error('Activity timeline elements are missing')
	let expanded = false
	let rendered: readonly TimelineActivity[] = []
	// Reusing an unchanged item keeps its expanded details and explorer focus across polls.
	let cache = new Map<string, HTMLLIElement[]>()
	const empty = node('li', 'empty-state', 'No activity recorded.')
	let renderedExplorerUrl: string | undefined
	const render = (values: readonly TimelineActivity[], explorerUrl: string | undefined) => {
		rendered = values
		renderedExplorerUrl = explorerUrl
		const filtered = filter.value === 'all' ? values : values.filter(activity => activity.status === filter.value)
		const expandable = filtered.length > COLLAPSED_ACTIVITY_COUNT
		const shown = expandable && !expanded ? filtered.slice(0, COLLAPSED_ACTIVITY_COUNT) : filtered
		expand.classList.toggle('hidden', !expandable)
		expand.setAttribute('aria-expanded', expanded ? 'true' : 'false')
		expand.textContent = expanded ? 'Show fewer' : `Show all ${filtered.length.toString()} actions`
		if (filtered.length === 0) {
			cache = new Map()
			empty.textContent = values.length === 0 ? 'No activity recorded.' : 'No activity matches this filter.'
			replaceWhenChanged(list, [empty])
			return
		}
		const retained = new Map<string, HTMLLIElement[]>()
		const items = shown.map(activity => {
			// The explorer origin is part of the key so a network switch rebuilds the links.
			const key = JSON.stringify([explorerUrl, activity])
			const item = cache.get(key)?.pop() ?? timelineItem(activity, explorerUrl)
			retained.set(key, [...(retained.get(key) ?? []), item])
			return item
		})
		cache = retained
		replaceWhenChanged(list, items)
	}
	expand.addEventListener('click', () => {
		expanded = !expanded
		render(rendered, renderedExplorerUrl)
	})
	filter.addEventListener('change', () => render(rendered, renderedExplorerUrl))
	return render
}
