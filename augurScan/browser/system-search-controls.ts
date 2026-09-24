export interface SystemSearchControls {
	input: HTMLInputElement
	list: HTMLElement
	count: HTMLElement
	loadMore: HTMLElement
	invalidate: () => void
	resetSelection: () => void
	load: () => Promise<boolean>
}

export const bindSystemSearchControls = ({ input, list, count, loadMore, invalidate, resetSelection, load }: SystemSearchControls): void => {
	const reset = () => {
		invalidate()
		resetSelection()
		window.clearTimeout(Number(input.dataset['searchTimer'] ?? 0))
	}
	input.addEventListener('input', () => {
		reset()
		list.replaceChildren()
		list.setAttribute('aria-busy', 'true')
		count.textContent = 'Searching…'
		loadMore.hidden = true
		input.dataset['searchTimer'] = String(window.setTimeout(() => void load(), 250))
	})
	input.addEventListener('keydown', event => {
		if (event.key !== 'Escape' || input.value === '') return
		event.preventDefault()
		input.value = ''
		reset()
		void load()
	})
}
