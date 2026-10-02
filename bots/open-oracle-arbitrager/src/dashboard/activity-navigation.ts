import { element } from './dom.ts'

/** Keeps historical views in one panel while preserving recovery links to the original section IDs. */
export function createActivityNavigation() {
	const select = element('activity-view', HTMLSelectElement)
	const views = [...document.querySelectorAll<HTMLElement>('[data-activity-view]')]
	function show(id: string) {
		if (!views.some(view => view.id === id)) return
		select.value = id
		for (const view of views) view.hidden = view.id !== id
	}
	function revealFragment(fragment = window.location.hash.slice(1)) {
		const target = document.getElementById(fragment)
		const view = target?.closest<HTMLElement>('[data-activity-view]')
		if (view !== undefined && view !== null) show(view.id)
	}
	select.addEventListener('change', () => {
		show(select.value)
		window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}#${select.value}`)
	})
	window.addEventListener('hashchange', () => revealFragment())
	window.addEventListener('popstate', () => revealFragment())
	revealFragment()
	return { revealFragment }
}
