import { compactIdentifier, formatDate, node, replaceWhenChanged, setBadge, statusLabel, statusTone } from './dom.js'

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

function timelineItem(activity: TimelineActivity) {
	const row = node('li', 'timeline-item')
	row.append(node('time', 'timeline-time', formatDate(activity.at)))
	const main = node('div', 'timeline-main')
	main.append(node('strong', undefined, activity.label ?? activity.operationId ?? 'Bot activity'))
	if (activity.summary !== undefined) main.append(node('span', 'timeline-detail', activity.summary))
	if (activity.details !== undefined) {
		const disclosure = node('details', 'activity-details')
		disclosure.append(node('summary', undefined, 'What was planned'), node('p', 'timeline-detail', activity.details))
		main.append(disclosure)
	}
	if (activity.txHash !== undefined) {
		const identifier = node('div', 'activity-identifier')
		identifier.append(compactIdentifier(activity.txHash, 'activity transaction hash'))
		main.append(identifier)
	}
	const status = node('span')
	setBadge(status, statusLabel(activity.status ?? 'info'), statusTone(activity.status))
	row.append(main, status)
	return row
}

/**
 * Renders the overview activity timeline, collapsed to the newest actions until the operator asks
 * for the rest.
 */
export function createActivityTimeline() {
	const list = document.querySelector('#activity-list')
	const expand = document.querySelector('#activity-expand')
	if (!(list instanceof HTMLOListElement) || !(expand instanceof HTMLButtonElement)) throw new Error('Activity timeline elements are missing')
	let expanded = false
	let rendered: readonly TimelineActivity[] = []
	// Reusing an unchanged item keeps its open disclosure and copy feedback alive across polls.
	let cache = new Map<string, HTMLLIElement[]>()
	const empty = node('li', 'empty-state', 'No activity recorded.')
	const render = (values: readonly TimelineActivity[]) => {
		rendered = values
		const expandable = values.length > COLLAPSED_ACTIVITY_COUNT
		const shown = expandable && !expanded ? values.slice(0, COLLAPSED_ACTIVITY_COUNT) : values
		expand.classList.toggle('hidden', !expandable)
		expand.setAttribute('aria-expanded', expanded ? 'true' : 'false')
		expand.textContent = expanded ? 'Show fewer' : `Show all ${values.length.toString()} actions`
		if (values.length === 0) {
			cache = new Map()
			replaceWhenChanged(list, [empty])
			return
		}
		const retained = new Map<string, HTMLLIElement[]>()
		const items = shown.map(activity => {
			const key = JSON.stringify(activity)
			const item = cache.get(key)?.pop() ?? timelineItem(activity)
			retained.set(key, [...(retained.get(key) ?? []), item])
			return item
		})
		cache = retained
		replaceWhenChanged(list, items)
	}
	expand.addEventListener('click', () => {
		expanded = !expanded
		render(rendered)
	})
	return render
}
