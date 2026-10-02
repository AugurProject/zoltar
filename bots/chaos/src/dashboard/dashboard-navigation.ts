import { markCurrentPage } from '@zoltar/bot-shared/dashboard/dom'

const pageTitles = new Map([
	['overview', 'Overview'],
	['catalog', 'Operation catalog'],
	['workflows', 'Workflows'],
	['ecosystem', 'Ecosystem state'],
	['recovery', 'Recovery'],
	['settings', 'Settings'],
])
const applicationTitle = 'Zoltar chaos bot'

function dashboardPage(pathname: string) {
	const page = pathname === '/' ? 'overview' : pathname.replace(/^\//, '').replace(/\/$/, '')
	return pageTitles.has(page) ? page : undefined
}

/**
 * Switches dashboard pages client-side for every same-origin page link, so following a link never reloads the page and
 * discards unsaved drafts. Keeps the active section link scrolled into view, names the page in the document title, and
 * moves focus to the page heading after a navigation.
 */
export function registerSectionNavigation(onPageShown: () => void = () => undefined) {
	const sectionLinks = [...document.querySelectorAll<HTMLAnchorElement>('.section-nav a[href^="/"]')]

	function centerActiveLink() {
		const activeLink = sectionLinks.find(link => link.hasAttribute('aria-current'))
		const navigation = activeLink?.closest<HTMLElement>('.section-nav')
		if (activeLink === undefined || navigation === null || navigation === undefined) return
		window.requestAnimationFrame(() => {
			const navigationBounds = navigation.getBoundingClientRect()
			const linkBounds = activeLink.getBoundingClientRect()
			const centeredScrollLeft = navigation.scrollLeft + linkBounds.left - navigationBounds.left - (navigation.clientWidth - linkBounds.width) / 2
			const maximumScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth)
			navigation.scrollLeft = Math.min(maximumScrollLeft, Math.max(0, centeredScrollLeft))
		})
	}

	function showDashboardPage(page: string, options: { focusHeading: boolean; hash: string; push: boolean }) {
		document.body.dataset['page'] = page
		document.title = `${pageTitles.get(page) ?? page} · ${applicationTitle}`
		for (const link of sectionLinks) markCurrentPage(link, new URL(link.href).pathname.replace(/\/$/, '') === `/${page}`)
		centerActiveLink()
		// Following a link to the location already shown must not add a history entry.
		if (options.push && (window.location.pathname.replace(/\/$/, '') !== `/${page}` || window.location.hash !== options.hash)) window.history.pushState({}, '', `/${page}${options.hash}`)
		const target = options.hash.length > 1 ? document.getElementById(options.hash.slice(1)) : null
		if (target !== null) target.scrollIntoView()
		else window.scrollTo({ top: 0 })
		if (options.focusHeading) {
			const heading = document.querySelector<HTMLElement>(`[data-page-content="${page}"] h2`)
			if (heading !== null) {
				heading.tabIndex = -1
				heading.focus({ preventScroll: true })
			}
		}
		onPageShown()
	}

	document.addEventListener('click', event => {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		const link = event.target instanceof Element ? event.target.closest('a[href]') : null
		if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return
		const destination = new URL(link.href)
		if (destination.origin !== window.location.origin) return
		const page = dashboardPage(destination.pathname)
		if (page === undefined) return
		// A link that only moves within the page already shown keeps the browser's own fragment navigation.
		if (page === document.body.dataset['page'] && destination.hash !== '') return
		event.preventDefault()
		link.closest('dialog')?.close()
		showDashboardPage(page, { focusHeading: true, hash: destination.hash, push: true })
	})
	window.addEventListener('popstate', () => {
		const page = dashboardPage(window.location.pathname)
		if (page !== undefined && page !== document.body.dataset['page']) showDashboardPage(page, { focusHeading: false, hash: window.location.hash, push: false })
	})

	const initialPage = dashboardPage(window.location.pathname)
	if (initialPage !== undefined) {
		document.title = `${pageTitles.get(initialPage) ?? initialPage} · ${applicationTitle}`
		for (const link of sectionLinks) markCurrentPage(link, new URL(link.href).pathname.replace(/\/$/, '') === `/${initialPage}`)
		centerActiveLink()
	}
}
