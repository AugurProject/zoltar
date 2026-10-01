import type { LiveChangeOptions } from './browser-types.ts'
import { requiredArrayItem } from './api-decoding.ts'
import { element } from './app-dom.ts'
import { exactNumber } from './format.ts'
import { classifyLiveRecords } from './live-refresh.ts'

type TimeValue = string | number | Date | null | undefined

export const counted = (value: string | number | bigint | null | undefined, singular: string, plural = `${singular}s`): string => `${exactNumber(value)} ${Number(value) === 1 ? singular : plural}`

/** Formats elapsed time relative to the server clock (`clockOffsetMs` corrects the client clock). */
export const relativeAge = (clockOffsetMs: number, value: TimeValue): string => {
	if (!value) return 'unavailable'
	const seconds = Math.max(0, Math.floor((Date.now() + clockOffsetMs - new Date(value).getTime()) / 1000))
	if (seconds < 60) return `${seconds}s ago`
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
	return `${Math.floor(seconds / 86400)}d ago`
}

export const relativeUntil = (clockOffsetMs: number, value: TimeValue): string => {
	if (!value) return 'time unknown'
	const seconds = Math.ceil((new Date(value).getTime() - (Date.now() + clockOffsetMs)) / 1000)
	if (seconds <= 0) return 'now'
	return seconds < 60 ? `in ${seconds}s` : `in ${Math.ceil(seconds / 60)}m`
}

export const exactTimestamp = (value: TimeValue): string => (value ? new Date(value).toISOString() : 'No timestamp')

export const liveSnapshot = (container: ParentNode, selector = '[data-live-key]'): Map<string, string> =>
	new Map(
		[...container.querySelectorAll<HTMLElement>(selector)].flatMap(node => {
			const key = node.dataset['liveKey']
			return key === undefined ? [] : [[key, node.dataset['liveSignature'] ?? node.textContent ?? '']]
		}),
	)

export const setLiveRecord = <T extends HTMLElement>(node: T, key: string, value: unknown): T => {
	node.dataset['liveKey'] = key
	node.dataset['liveSignature'] = typeof value === 'string' ? value : (JSON.stringify(value) ?? 'undefined')
	return node
}

const animateLiveNode = (node: HTMLElement, className: string) => {
	node.classList.remove('live-added', 'live-changed', className)
	requestAnimationFrame(() => {
		node.classList.add(className)
		const clear = () => node.classList.remove(className)
		node.addEventListener('animationend', clear, { once: true })
		window.setTimeout(clear, 1_600)
	})
}

export const applyLiveChanges = (container: ParentNode, previous: ReadonlyMap<string, string>, { live = false, selector = '[data-live-key]' }: LiveChangeOptions = {}) => {
	const changes = { added: 0, changed: 0 }
	if (!live) return changes
	const nodes = [...container.querySelectorAll<HTMLElement>(selector)]
	const classified = classifyLiveRecords(
		previous,
		nodes.flatMap(node => {
			const key = node.dataset['liveKey']
			return key === undefined ? [] : [{ key, signature: node.dataset['liveSignature'] ?? '' }]
		}),
	)
	for (const [index, record] of classified.entries()) {
		const node = requiredArrayItem(nodes, index, 'Classified live node')
		if (record.state === 'added') {
			changes.added++
			animateLiveNode(node, 'live-added')
		} else if (record.state === 'changed') {
			changes.changed++
			animateLiveNode(node, 'live-changed')
		}
	}
	return changes
}

export const eventStreamState = (eventSource: EventSource | undefined): 'closed' | 'connecting' | 'open' => {
	if (eventSource?.readyState === EventSource.OPEN) return 'open'
	return eventSource?.readyState === EventSource.CONNECTING || eventSource === undefined ? 'connecting' : 'closed'
}

export const renderRetryStatus = (status: HTMLElement, message: string, retryAction: () => undefined | Promise<unknown>): void => {
	status.hidden = false
	status.className = 'system-status error'
	const retry = element('button', '', 'Retry')
	retry.type = 'button'
	retry.addEventListener('click', retryAction)
	status.replaceChildren(element('span', '', message), retry)
}

export const accountTransactionsError = (detail: string, hasLoaded: boolean, append: boolean): string => {
	if (!hasLoaded) return `Could not load sent transactions: ${detail}`
	return append ? `Could not load more transactions; showing the last known activity: ${detail}` : `Could not refresh sent transactions; showing the last known activity: ${detail}`
}

export const richListError = (detail: string, append: boolean, empty: boolean): string => {
	if (append) return `Could not load more; showing known rankings: ${detail}`
	return empty ? `Rich list unavailable: ${detail}` : `Refresh failed; showing last known rankings: ${detail}`
}

export const yesNoCheckpoint = (value: unknown): string => {
	if (value === undefined) return 'No checkpoint'
	return value ? 'Yes' : 'No'
}

export const nextTabIndex = (key: string, current: number, count: number): number => {
	if (key === 'Home') return 0
	if (key === 'End') return count - 1
	return (current + (key === 'ArrowRight' ? 1 : -1) + count) % count
}
