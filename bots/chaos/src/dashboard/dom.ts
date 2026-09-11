export function node<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className?: string, text?: string): HTMLElementTagNameMap[Tag] {
	const value = document.createElement(tag)
	if (className !== undefined) value.className = className
	if (text !== undefined) value.textContent = text
	return value
}

export function shortHex(value: string | undefined) {
	if (value === undefined || value.length < 14) return value ?? '—'
	return `${value.slice(0, 8)}…${value.slice(-6)}`
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
	let hostname: string
	try {
		hostname = new URL(url).hostname
	} catch {
		return undefined
	}
	const link = node('a', 'identifier-explorer', 'Explorer')
	link.href = url
	link.rel = 'noreferrer'
	link.target = '_blank'
	link.title = `Open on ${hostname}`
	link.setAttribute('aria-label', `Open ${type} on ${hostname}: ${value}`)
	return link
}

let identifierSequence = 0

export function compactIdentifier(value: string, type: string, options: { explorerUrl?: string | undefined } = {}) {
	const wrapper = node('span', 'compact-identifier')
	wrapper.dataset['identifierType'] = type
	const display = node('span', 'identifier-value mono', shortHex(value))
	const explorer = options.explorerUrl === undefined ? undefined : explorerLink(options.explorerUrl, type, value)
	const copy = document.createElement('button')
	copy.className = 'identifier-copy'
	copy.textContent = 'Copy'
	copy.type = 'button'
	copy.setAttribute('aria-label', `Copy ${type}: ${value}`)
	identifierSequence += 1
	const full = document.createElement('textarea')
	full.className = 'identifier-full mono'
	full.hidden = true
	full.id = `identifier-full-${identifierSequence.toString()}`
	full.readOnly = true
	full.rows = 2
	full.spellcheck = false
	full.value = value
	full.wrap = 'soft'
	full.setAttribute('aria-label', `Full ${type}`)
	const disclosure = document.createElement('button')
	disclosure.className = 'identifier-disclosure'
	disclosure.textContent = 'Show full'
	disclosure.type = 'button'
	disclosure.setAttribute('aria-controls', full.id)
	disclosure.setAttribute('aria-expanded', 'false')
	disclosure.setAttribute('aria-label', `Show full ${type}: ${value}`)
	const feedback = node('span', 'identifier-feedback')
	feedback.setAttribute('aria-live', 'polite')
	feedback.setAttribute('role', 'status')
	const setExpanded = (expanded: boolean) => {
		full.hidden = !expanded
		disclosure.textContent = expanded ? 'Hide full' : 'Show full'
		disclosure.setAttribute('aria-expanded', expanded ? 'true' : 'false')
		disclosure.setAttribute('aria-label', `${expanded ? 'Hide' : 'Show'} full ${type}: ${value}`)
	}
	disclosure.addEventListener('click', () => setExpanded(full.hidden))
	copy.addEventListener('click', () => {
		copy.disabled = true
		feedback.className = 'identifier-feedback'
		feedback.textContent = 'Copying…'
		const clipboard = navigator.clipboard
		const write = clipboard === undefined ? Promise.reject(new Error('Clipboard API unavailable')) : Promise.resolve().then(() => clipboard.writeText(value))
		void write.then(
			() => {
				copy.disabled = false
				feedback.className = 'identifier-feedback success'
				feedback.textContent = 'Copied'
			},
			() => {
				copy.disabled = false
				feedback.className = 'identifier-feedback error'
				feedback.textContent = 'Copy failed; full value shown'
				setExpanded(true)
			},
		)
	})
	wrapper.append(display, ...(explorer === undefined ? [] : [explorer]), copy, disclosure, feedback, full)
	return wrapper
}

/** Replaces children only when they actually differ, so unchanged subtrees keep their DOM nodes. */
export function replaceWhenChanged(parent: ParentNode, children: readonly Element[]) {
	const current = [...parent.children]
	if (current.length === children.length && current.every((child, index) => child === children[index])) return
	parent.replaceChildren(...children)
}
