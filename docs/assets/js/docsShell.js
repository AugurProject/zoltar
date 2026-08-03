;(() => {
	const data = window.statoblastDocs
	if (typeof data !== 'object' || data === null || !Array.isArray(data.sections) || !Array.isArray(data.pages)) return

	const script = document.currentScript
	if (!(script instanceof HTMLScriptElement)) return
	const docsRoot = new URL('../../', script.src)
	const relativePath = decodeURIComponent(location.pathname.slice(docsRoot.pathname.length)) || 'documentation.html'
	const currentPage = data.pages.find(page => page.path === relativePath)
	const currentSection = data.sections.find(section => section.id === currentPage?.section)
	const main = document.querySelector('main')
	if (!(main instanceof HTMLElement)) return
	const favicon = document.createElement('link')
	favicon.rel = 'icon'
	favicon.href = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#176653"/><text x="16" y="22" fill="white" font-family="Georgia,serif" font-size="20" text-anchor="middle">S</text></svg>')}`
	document.head.append(favicon)

	document.body.classList.add('docs-shell-page')
	main.id = main.id || 'main-content'
	main.tabIndex = -1

	function docsUrl(path, fragment = '') {
		const url = new URL(path, docsRoot)
		url.hash = fragment
		return url.href
	}

	function element(name, className, text) {
		const node = document.createElement(name)
		if (className.length > 0) node.className = className
		if (text !== undefined) node.textContent = text
		return node
	}

	function sectionPages(sectionId) {
		return data.pages.filter(page => page.section === sectionId)
	}

	const skipLink = element('a', 'docs-skip-link', 'Skip to documentation')
	skipLink.href = `#${main.id}`

	const topbar = element('header', 'docs-topbar')
	const brand = element('a', 'docs-brand')
	brand.href = docsUrl('documentation.html')
	brand.append(element('span', 'docs-brand-mark', 'S'), element('span', '', 'Statoblast docs'))

	const actions = element('div', 'docs-top-actions')
	const menuButton = element('button', 'docs-icon-button', '☰')
	menuButton.type = 'button'
	menuButton.setAttribute('aria-label', 'Open documentation menu')
	menuButton.setAttribute('aria-expanded', 'false')
	const searchButton = element('button', 'docs-search-button')
	searchButton.type = 'button'
	searchButton.setAttribute('aria-label', 'Search documentation')
	searchButton.append(element('span', '', 'Search'), element('span', 'docs-search-icon', '⌕'), element('kbd', '', 'Ctrl/⌘ K'))
	actions.append(menuButton, searchButton)
	topbar.append(brand, actions)

	const left = element('aside', 'docs-left')
	left.setAttribute('aria-label', 'Documentation navigation')
	left.append(element('p', 'docs-navigation-title', 'Documentation'))
	const navigation = element('nav', 'docs-navigation')
	for (const section of data.sections) {
		const sectionDetails = element('details', 'docs-navigation-section')
		sectionDetails.open = currentPage === undefined || currentPage.section === section.id
		sectionDetails.append(element('summary', '', section.title))
		const topics = new Map()
		for (const page of sectionPages(section.id)) {
			const pages = topics.get(page.topic) ?? []
			pages.push(page)
			topics.set(page.topic, pages)
		}
		for (const [topic, pages] of topics) {
			const topicDetails = element('details', 'docs-navigation-topic')
			topicDetails.open = currentPage === undefined || pages.some(page => page.path === currentPage.path)
			topicDetails.append(element('summary', '', topic))
			const list = element('ul', 'docs-navigation-list')
			for (const page of pages) {
				const item = element('li', '')
				const link = element('a', '', page.title)
				link.href = docsUrl(page.path)
				if (page.path === currentPage?.path) link.setAttribute('aria-current', 'page')
				item.append(link)
				list.append(item)
			}
			topicDetails.append(list)
			sectionDetails.append(topicDetails)
		}
		navigation.append(sectionDetails)
	}
	left.append(navigation)

	const right = element('aside', 'docs-right')
	right.setAttribute('aria-label', 'On this page')
	right.append(element('p', 'docs-outline-title', 'On this page'))
	const outline = element('ol', 'docs-outline-list')
	const outlineLinks = new Map()
	for (const heading of main.querySelectorAll('h2[id], h3[id], section[id] > h2:first-child, section[id] > .section-heading > h2:first-child')) {
		const id = heading.id || heading.closest('[id]')?.id
		if (id === undefined || id.length === 0 || outlineLinks.has(id)) continue
		const item = element('li', heading.matches('h3') ? 'docs-outline-h3' : '')
		const link = element('a', '', heading.textContent?.replace(/\s+/g, ' ').trim() ?? id)
		link.href = `#${encodeURIComponent(id)}`
		item.append(link)
		outline.append(item)
		outlineLinks.set(id, link)
	}
	if (outline.childElementCount === 0) right.hidden = true
	right.append(outline)
	const mobileOutline = element('details', 'docs-mobile-outline')
	mobileOutline.append(element('summary', '', 'On this page'), outline.cloneNode(true))

	if (currentPage !== undefined && currentSection !== undefined) {
		const context = element('div', 'docs-page-context')
		const breadcrumbs = element('nav', 'docs-breadcrumbs')
		breadcrumbs.setAttribute('aria-label', 'Breadcrumb')
		const home = element('a', '', 'Docs')
		home.href = docsUrl('documentation.html')
		breadcrumbs.append(home, document.createTextNode('/'), element('span', '', currentSection.title))
		context.append(breadcrumbs, element('span', 'docs-type-badge', currentSection.title), element('p', 'docs-page-summary', currentPage.summary))
		main.prepend(context)
		if (!right.hidden) context.after(mobileOutline)

		const peers = sectionPages(currentPage.section)
		const index = peers.findIndex(page => page.path === currentPage.path)
		const pager = element('nav', 'docs-page-pager')
		pager.setAttribute('aria-label', 'Adjacent documentation')
		for (const [label, page] of [
			['Previous', peers[index - 1]],
			['Next', peers[index + 1]],
		]) {
			if (page === undefined) {
				pager.append(element('span', ''))
				continue
			}
			const link = element('a', '')
			link.href = docsUrl(page.path)
			link.append(element('span', '', label), document.createTextNode(page.title))
			pager.append(link)
		}
		main.append(pager)
	} else if (!right.hidden) {
		main.prepend(mobileOutline)
	}

	const layout = element('div', 'docs-layout')
	main.before(layout)
	layout.append(left, main, right)
	const backdrop = element('button', 'docs-navigation-backdrop')
	backdrop.type = 'button'
	backdrop.setAttribute('aria-label', 'Close documentation menu')
	document.body.prepend(skipLink, topbar)
	document.body.append(backdrop)

	function isMobileNavigation() {
		return window.innerWidth <= 820
	}
	function navigationFocusables() {
		return [menuButton, ...left.querySelectorAll('a[href], summary, button'), backdrop].filter(node => !node.inert)
	}
	function syncNavigationIsolation() {
		const mobile = isMobileNavigation()
		const open = mobile && document.body.dataset.docsNavigationOpen === 'true'
		left.inert = mobile && !open
		for (const node of [brand, searchButton, main, right]) node.inert = open
		backdrop.inert = !open
		if (!mobile && document.body.dataset.docsNavigationOpen === 'true') {
			document.body.dataset.docsNavigationOpen = 'false'
			menuButton.setAttribute('aria-expanded', 'false')
			menuButton.setAttribute('aria-label', 'Open documentation menu')
		}
	}
	function setNavigationOpen(open, restoreFocus = !open) {
		document.body.dataset.docsNavigationOpen = String(open)
		menuButton.setAttribute('aria-expanded', String(open))
		menuButton.setAttribute('aria-label', open ? 'Close documentation menu' : 'Open documentation menu')
		syncNavigationIsolation()
		if (open && isMobileNavigation()) navigationFocusables()[1]?.focus()
		else if (restoreFocus) menuButton.focus()
	}
	menuButton.addEventListener('click', () => setNavigationOpen(document.body.dataset.docsNavigationOpen !== 'true'))
	backdrop.addEventListener('click', () => setNavigationOpen(false))
	navigation.addEventListener('click', event => {
		if (event.target instanceof HTMLAnchorElement) setNavigationOpen(false, false)
	})
	window.addEventListener('resize', syncNavigationIsolation)
	syncNavigationIsolation()

	const dialog = element('dialog', 'docs-search')
	dialog.setAttribute('aria-label', 'Search documentation')
	const searchForm = element('form', 'docs-search-form')
	searchForm.setAttribute('role', 'search')
	const searchInput = element('input', 'docs-search-input')
	searchInput.type = 'search'
	searchInput.placeholder = 'Search titles, concepts, contracts, and events'
	searchInput.setAttribute('aria-label', 'Search documentation')
	const closeSearch = element('button', 'docs-search-close', 'Close')
	closeSearch.type = 'button'
	searchForm.append(searchInput, closeSearch)
	const searchStatus = element('p', 'docs-search-status', 'Start typing to search all documentation.')
	searchStatus.setAttribute('role', 'status')
	const searchResults = element('ol', 'docs-search-results')
	dialog.append(searchForm, searchStatus, searchResults)
	document.body.append(dialog)

	function openSearch() {
		if (!dialog.open) dialog.showModal()
		searchInput.focus()
	}
	function closeSearchDialog() {
		dialog.close()
		searchButton.focus()
	}
	searchButton.addEventListener('click', openSearch)
	closeSearch.addEventListener('click', closeSearchDialog)
	searchForm.addEventListener('submit', event => event.preventDefault())
	dialog.addEventListener('click', event => {
		if (event.target === dialog) closeSearchDialog()
	})
	document.addEventListener('keydown', event => {
		if (event.key === 'Tab' && isMobileNavigation() && document.body.dataset.docsNavigationOpen === 'true') {
			const focusables = navigationFocusables()
			const first = focusables[0]
			const last = focusables.at(-1)
			if (first === undefined || last === undefined) return
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault()
				last.focus()
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault()
				first.focus()
			}
		} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault()
			openSearch()
		} else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !/^(?:INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) {
			event.preventDefault()
			openSearch()
		} else if (event.key === 'Escape' && document.body.dataset.docsNavigationOpen === 'true') {
			setNavigationOpen(false)
			menuButton.focus()
		}
	})

	function normalized(value) {
		return value
			.toLocaleLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim()
	}
	function searchTermScore(entry, normalizedTitle, term) {
		if (normalizedTitle.startsWith(term)) return 8
		if (normalizedTitle.includes(term)) return 5
		if (entry.headings.some(heading => normalized(heading).includes(term))) return 3
		return 1
	}
	function updateSearch() {
		const query = normalized(searchInput.value)
		searchResults.replaceChildren()
		if (query.length < 2) {
			searchStatus.textContent = 'Enter at least two characters.'
			return
		}
		const terms = query.split(/\s+/)
		const matches = data.searchIndex
			.map(entry => {
				const title = normalized(entry.title)
				const haystack = normalized(`${entry.title} ${entry.sectionTitle} ${entry.topic} ${entry.keywords.join(' ')} ${entry.headings.join(' ')} ${entry.text}`)
				if (!terms.every(term => haystack.includes(term))) return undefined
				const score = terms.reduce((total, term) => total + searchTermScore(entry, title, term), 0)
				return { entry, score }
			})
			.filter(Boolean)
			.sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title))
			.slice(0, 20)
		searchStatus.textContent = matches.length === 0 ? 'No matching documentation.' : `${matches.length} result${matches.length === 1 ? '' : 's'}`
		for (const { entry } of matches) {
			const item = element('li', '')
			const link = element('a', '')
			link.href = docsUrl(entry.path, entry.fragment)
			link.append(element('span', 'docs-search-result-meta', `${entry.sectionTitle} · ${entry.topic}`), element('strong', '', entry.title), element('span', 'docs-search-result-snippet', entry.summary))
			item.append(link)
			searchResults.append(item)
		}
	}
	searchInput.addEventListener('input', updateSearch)

	if ('IntersectionObserver' in window && outlineLinks.size > 0) {
		const observer = new IntersectionObserver(
			entries => {
				const visible = entries.filter(entry => entry.isIntersecting).sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0]
				if (visible === undefined) return
				for (const link of outlineLinks.values()) link.removeAttribute('aria-current')
				outlineLinks.get(visible.target.id)?.setAttribute('aria-current', 'location')
			},
			{ rootMargin: '-20% 0px -70% 0px' },
		)
		for (const id of outlineLinks.keys()) {
			const target = document.getElementById(id)
			if (target !== null) observer.observe(target)
		}
	}
})()
