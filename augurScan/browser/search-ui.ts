import { isRecord } from './api-validation.ts'

const searchResultCountLabel = (count: number): string => {
	if (count === 0) return 'No indexed matches'
	return `${count} ${count === 1 ? 'result' : 'results'}`
}

export const mountSearch = (api: (path: string) => Promise<unknown>, chainId: () => string): void => {
	const form = document.querySelector<HTMLFormElement>('#global-search')
	const input = document.querySelector<HTMLInputElement>('#global-search-input')
	const results = document.querySelector<HTMLElement>('#global-search-results')
	if (form === null || input === null || results === null) return
	// Only the short status line is a live region; the result links live in a separately labelled group.
	results.removeAttribute('role')
	const status = document.createElement('div')
	status.className = 'global-search-status'
	status.setAttribute('role', 'status')
	const list = document.createElement('div')
	list.className = 'global-search-list'
	list.setAttribute('role', 'group')
	list.setAttribute('aria-label', 'Search results')
	let generation = 0
	let renderedQuery: string | undefined
	const clearTimer = () => window.clearTimeout(Number(input.dataset['searchTimer'] ?? 0))
	const hide = () => {
		results.hidden = true
		results.replaceChildren()
		list.replaceChildren()
		renderedQuery = undefined
	}
	const show = (message: string) => {
		results.hidden = false
		status.textContent = message
		if (status.parentElement !== results || list.parentElement !== results) results.replaceChildren(status, list)
	}
	const contains = (node: EventTarget | null): boolean => node instanceof Node && (form.contains(node) || results.contains(node))
	const search = async (openTopResult = false) => {
		const query = input.value.trim()
		const current = ++generation
		if (query.length === 0) {
			hide()
			return
		}
		list.replaceChildren()
		renderedQuery = undefined
		show('Searching…')
		try {
			const params = new URLSearchParams({ q: query })
			if (chainId() !== '') params.set('chainId', chainId())
			const response = await api(`/api/v1/search?${params}`)
			if (current !== generation) return
			if (!isRecord(response) || !Array.isArray(response['items'])) throw new Error('Search response is malformed')
			const anchors: HTMLAnchorElement[] = []
			for (const item of response['items']) {
				if (!isRecord(item) || typeof item['href'] !== 'string' || typeof item['label'] !== 'string') continue
				const anchor = document.createElement('a')
				const destination = new URL(item['href'], location.origin)
				if (new URL(location.href).searchParams.get('demo') === '1') destination.searchParams.set('demo', '1')
				anchor.href = `${destination.pathname}${destination.search}`
				const type = String(item['type'] ?? 'Result')
				const label = item['label'].toLowerCase().startsWith(type.toLowerCase()) ? item['label'] : `${type} · ${item['label']}`
				const detail = typeof item['detail'] === 'string' && item['detail'] !== '' && item['detail'].toLowerCase() !== item['label'].toLowerCase() ? item['detail'] : undefined
				if (detail === undefined) anchor.textContent = label
				else {
					const detailNode = document.createElement('small')
					detailNode.className = 'global-search-detail'
					detailNode.textContent = detail
					anchor.append(document.createTextNode(`${label} `), detailNode)
				}
				anchors.push(anchor)
			}
			list.replaceChildren(...anchors)
			show(searchResultCountLabel(anchors.length))
			renderedQuery = query
			if (openTopResult) anchors[0]?.click()
		} catch (error) {
			if (current !== generation) return
			list.replaceChildren()
			show(error instanceof Error ? error.message : 'Search unavailable')
		}
	}
	form.addEventListener('submit', event => {
		event.preventDefault()
		clearTimer()
		// Enter opens the best match; results already shown for this query are used without searching again.
		const top = !results.hidden && renderedQuery === input.value.trim() ? list.querySelector<HTMLAnchorElement>('a') : null
		if (top !== null) top.click()
		else void search(true)
	})
	results.addEventListener('click', event => {
		if (!(event.target instanceof Element) || event.target.closest('a') === null) return
		generation++
		window.setTimeout(() => {
			hide()
			input.value = ''
			input.scrollLeft = 0
		}, 0)
	})
	input.addEventListener('input', () => {
		generation++
		hide()
		clearTimer()
		input.dataset['searchTimer'] = String(window.setTimeout(() => void search(), 250))
	})
	const dismiss = () => {
		if (results.hidden) return
		generation++
		clearTimer()
		hide()
	}
	// The panel closes when attention leaves the search: a press elsewhere on the page or focus moving out by keyboard.
	document.addEventListener('pointerdown', event => {
		if (!contains(event.target)) dismiss()
	})
	for (const scope of [form, results])
		scope.addEventListener('focusout', event => {
			if (event.relatedTarget !== null && !contains(event.relatedTarget)) dismiss()
		})
	document.addEventListener('keydown', event => {
		if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement) && !(event.target instanceof HTMLElement && event.target.isContentEditable)) {
			event.preventDefault()
			input.focus()
		}
		if (event.key === 'Escape' && (document.activeElement === input || results.contains(document.activeElement))) {
			const focusWasInResults = results.contains(document.activeElement)
			generation++
			clearTimer()
			input.value = ''
			input.scrollLeft = 0
			hide()
			if (focusWasInResults) input.focus()
			else input.blur()
		}
	})
}
