import { isRecord } from './api-validation.ts'

export const mountSearch = (api: (path: string) => Promise<unknown>, chainId: () => string): void => {
	const form = document.querySelector<HTMLFormElement>('#global-search')
	const input = document.querySelector<HTMLInputElement>('#global-search-input')
	const results = document.querySelector<HTMLElement>('#global-search-results')
	if (form === null || input === null || results === null) return
	let generation = 0
	const search = async () => {
		const query = input.value.trim()
		const current = ++generation
		if (query.length === 0) {
			results.hidden = true
			results.replaceChildren()
			return
		}
		results.hidden = false
		results.textContent = 'Searching…'
		try {
			const params = new URLSearchParams({ q: query })
			if (chainId() !== '') params.set('chainId', chainId())
			const response = await api(`/api/v1/search?${params}`)
			if (current !== generation) return
			if (!isRecord(response) || !Array.isArray(response['items'])) throw new Error('Search response is malformed')
			results.replaceChildren()
			for (const item of response['items']) {
				if (!isRecord(item) || typeof item['href'] !== 'string' || typeof item['label'] !== 'string') continue
				const anchor = document.createElement('a')
				const destination = new URL(item['href'], location.origin)
				if (new URL(location.href).searchParams.get('demo') === '1') destination.searchParams.set('demo', '1')
				anchor.href = `${destination.pathname}${destination.search}`
				const type = String(item['type'] ?? 'Result')
				anchor.textContent = item['label'].toLowerCase().startsWith(type.toLowerCase()) ? item['label'] : `${type} · ${item['label']}`
				results.append(anchor)
			}
			if (results.childElementCount === 0) results.textContent = 'No indexed matches'
		} catch (error) {
			if (current === generation) results.textContent = error instanceof Error ? error.message : 'Search unavailable'
		}
	}
	form.addEventListener('submit', event => {
		event.preventDefault()
		void search()
	})
	results.addEventListener('click', event => {
		if (!(event.target instanceof Element) || event.target.closest('a') === null) return
		generation++
		window.setTimeout(() => {
			results.hidden = true
			results.replaceChildren()
			input.value = ''
			input.scrollLeft = 0
		}, 0)
	})
	input.addEventListener('input', () => {
		generation++
		results.hidden = true
		results.replaceChildren()
		window.clearTimeout(Number(input.dataset['searchTimer'] ?? 0))
		input.dataset['searchTimer'] = String(window.setTimeout(() => void search(), 250))
	})
	document.addEventListener('keydown', event => {
		if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLElement && event.target.isContentEditable)) {
			event.preventDefault()
			input.focus()
		}
		if (event.key === 'Escape' && document.activeElement === input) {
			generation++
			window.clearTimeout(Number(input.dataset['searchTimer'] ?? 0))
			input.value = ''
			input.scrollLeft = 0
			results.hidden = true
			results.replaceChildren()
			input.blur()
		}
	})
}
