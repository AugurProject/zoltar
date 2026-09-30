import { markCurrentPage } from '@zoltar/bot-shared/dashboard/dom'

/** Switches dashboard pages client-side from the section navigation and keeps the active link scrolled into view. */
export function registerSectionNavigation() {
	let currentSectionLink: HTMLAnchorElement | undefined
	const sectionLinks = [...document.querySelectorAll<HTMLAnchorElement>('.section-nav a[href^="/"]')]

	function showDashboardPage(pathname: string, push = false) {
		const page = pathname === '/' ? 'overview' : pathname.replace(/^\//, '').replace(/\/$/, '')
		document.body.dataset['page'] = page
		for (const link of sectionLinks) markCurrentPage(link, new URL(link.href).pathname.replace(/\/$/, '') === `/${page}`)
		const activeLink = sectionLinks.find(link => link.hasAttribute('aria-current'))
		const navigation = activeLink?.closest<HTMLElement>('.section-nav')
		if (activeLink !== undefined && navigation !== null && navigation !== undefined) {
			window.requestAnimationFrame(() => {
				navigation.scrollLeft = activeLink.offsetLeft - (navigation.clientWidth - activeLink.offsetWidth) / 2
			})
		}
		if (push) window.history.pushState({}, '', `/${page}`)
		window.scrollTo({ top: 0 })
	}

	for (const link of sectionLinks) {
		if ((link instanceof HTMLAnchorElement && new URL(link.href).pathname === window.location.pathname.replace(/\/$/, '')) || (window.location.pathname === '/' && link instanceof HTMLAnchorElement && new URL(link.href).pathname === '/overview')) {
			link.setAttribute('aria-current', 'page')
			currentSectionLink = link
		}
		link.addEventListener('click', event => {
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
			event.preventDefault()
			showDashboardPage(new URL(link.href).pathname, true)
		})
	}
	window.addEventListener('popstate', () => showDashboardPage(window.location.pathname))

	if (currentSectionLink !== undefined) {
		const link = currentSectionLink
		window.requestAnimationFrame(() => {
			const navigation = link.closest('.section-nav')
			if (!(navigation instanceof HTMLElement)) return
			const navigationBounds = navigation.getBoundingClientRect()
			const linkBounds = link.getBoundingClientRect()
			const centeredScrollLeft = navigation.scrollLeft + linkBounds.left - navigationBounds.left - (navigation.clientWidth - linkBounds.width) / 2
			const maximumScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth)
			navigation.scrollLeft = Math.min(maximumScrollLeft, Math.max(0, centeredScrollLeft))
		})
	}
}
