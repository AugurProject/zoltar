export function createSectionNavigation(linkFilter: (link: HTMLAnchorElement) => boolean = () => true) {
	const sectionLinks = [...document.querySelectorAll<HTMLAnchorElement>('.section-nav a[href^="/"]')].filter(linkFilter)

	function showDashboardPage(pathname: string, push = false) {
		const page = pathname === '/' ? 'overview' : pathname.replace(/^\//, '').replace(/\/$/, '')
		document.body.dataset['page'] = page
		for (const link of sectionLinks) link.toggleAttribute('aria-current', new URL(link.href).pathname.replace(/\/$/, '') === `/${page}`)
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
		link.addEventListener('click', event => {
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
			event.preventDefault()
			showDashboardPage(new URL(link.href).pathname, true)
		})
	}
	window.addEventListener('popstate', () => showDashboardPage(window.location.pathname))

	function secureExternalLinks(root: ParentNode) {
		const links = root instanceof HTMLAnchorElement ? [root] : [...root.querySelectorAll<HTMLAnchorElement>('a[href]')]
		for (const link of links) {
			if (link.origin === window.location.origin) continue
			link.target = '_blank'
			link.rel = 'noopener noreferrer'
		}
	}

	secureExternalLinks(document)
	new MutationObserver(records => {
		for (const record of records) {
			for (const node of record.addedNodes) if (node instanceof HTMLElement) secureExternalLinks(node)
		}
	}).observe(document.body, { childList: true, subtree: true })

	let sectionNavigationAlignmentInitialized = false

	function revealSectionLink(_link: HTMLAnchorElement) {
		const navigation = sectionLinks[0]?.closest<HTMLElement>('.section-nav')
		if (navigation === undefined || navigation === null) return
		const align = () => {
			const link = sectionLinks.find(candidate => candidate.hasAttribute('aria-current'))
			if (link === undefined) return
			navigation.scrollLeft = link.offsetLeft - (navigation.clientWidth - link.offsetWidth) / 2
		}
		align()
		if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(align)
		if (!sectionNavigationAlignmentInitialized) {
			sectionNavigationAlignmentInitialized = true
			window.addEventListener('load', align, { once: true })
			window.addEventListener('resize', align)
			new ResizeObserver(align).observe(navigation)
		}
		void document.fonts?.ready.then(align)
	}

	function scrollToSection(id: string) {
		const target = document.getElementById(id)
		const shell = document.querySelector<HTMLElement>('.operator-shell')
		if (target === null || shell === null) return
		if (target instanceof HTMLDetailsElement) target.open = true
		else target.closest('details')?.setAttribute('open', '')
		const align = () => {
			const top = target.getBoundingClientRect().top + window.scrollY - shell.getBoundingClientRect().height - 16
			window.scrollTo({ top: Math.max(0, top) })
		}
		align()
		if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => window.requestAnimationFrame(align))
		void document.fonts?.ready.then(align)
	}

	function syncSectionNavigation(scrollToTarget = false) {
		const activePath = window.location.pathname === '/' ? '/overview' : window.location.pathname
		let activeLink: HTMLAnchorElement | undefined
		for (const link of sectionLinks) {
			if (link.pathname === activePath) {
				link.setAttribute('aria-current', 'page')
				activeLink = link
			} else link.removeAttribute('aria-current')
		}
		if (activeLink !== undefined) revealSectionLink(activeLink)
		const targetId = window.location.hash.slice(1)
		if (scrollToTarget && targetId !== '') scrollToSection(targetId)
	}

	window.addEventListener('hashchange', () => syncSectionNavigation(true))
	syncSectionNavigation()

	return { scrollToSection, syncSectionNavigation }
}
