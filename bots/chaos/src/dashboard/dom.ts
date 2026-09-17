export function node<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className?: string, text?: string): HTMLElementTagNameMap[Tag] {
	const value = document.createElement(tag)
	if (className !== undefined) value.className = className
	if (text !== undefined) value.textContent = text
	return value
}

export function setBadge(target: HTMLElement, label: string, tone: 'error' | 'info' | 'neutral' | 'success' | 'warning') {
	target.textContent = label
	target.className = `badge ${tone}`
}

export function formatDate(value: string | undefined) {
	if (value === undefined) return 'Not scheduled'
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? 'Timestamp unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
}

export function statusTone(status: string | undefined): 'error' | 'info' | 'neutral' | 'success' | 'warning' {
	const normalized = status?.toLowerCase()
	if (normalized === 'confirmed' || normalized === 'complete' || normalized === 'eligible' || normalized === 'healthy' || normalized === 'success') return 'success'
	if (normalized === 'failed' || normalized === 'error' || normalized === 'blocked') return 'error'
	if (normalized === 'pending' || normalized === 'submitted' || normalized === 'recovering' || normalized === 'due') return 'warning'
	if (normalized === 'dry-run' || normalized === 'simulated') return 'info'
	if (normalized === 'deferred') return 'neutral'
	return 'neutral'
}

export function statusLabel(status: string | undefined) {
	const normalized = status?.trim().replaceAll('_', ' ').replaceAll('-', ' ')
	if (normalized === undefined || normalized.length === 0) return 'Waiting'
	return `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1).toLowerCase()}`
}

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/i

/** Builds the configured block explorer page for a transaction hash; undefined when no explorer is known. */
export function transactionExplorerUrl(explorerUrl: string | undefined, hash: string) {
	if (explorerUrl === undefined || !TRANSACTION_HASH_PATTERN.test(hash)) return undefined
	return `${explorerUrl.replace(/\/+$/, '')}/tx/${hash}`
}

/** Keeps the visible label short; the explorer hostname stays in the accessible name and tooltip. */
function explorerLink(url: string, type: string, value: string) {
	if (!URL.canParse(url)) return undefined
	const hostname = new URL(url).hostname
	const link = node('a', 'identifier-explorer', 'Explorer')
	link.href = url
	link.rel = 'noreferrer'
	link.target = '_blank'
	link.title = `Open on ${hostname}`
	link.setAttribute('aria-label', `Open ${type} on ${hostname}: ${value}`)
	return link
}

export function fullIdentifier(value: string, type: string, options: { explorerUrl?: string | undefined } = {}) {
	const wrapper = node('span', 'full-identifier')
	wrapper.dataset['identifierType'] = type
	const display = node('span', 'identifier-value mono', value)
	const explorer = options.explorerUrl === undefined ? undefined : explorerLink(options.explorerUrl, type, value)
	wrapper.append(display, ...(explorer === undefined ? [] : [explorer]))
	return wrapper
}

/** Replaces children only when they actually differ, so unchanged subtrees keep their DOM nodes. */
export function replaceWhenChanged(parent: ParentNode, children: readonly Element[]) {
	const current = [...parent.children]
	if (current.length === children.length && current.every((child, index) => child === children[index])) return
	parent.replaceChildren(...children)
}
