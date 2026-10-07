import { expect, test } from 'bun:test'
import { installDomEnvironment } from '../../ui/coreShared/ts/tests/testUtils/domEnvironment.ts'

const globalKeys = ['HTMLScriptElement', 'HTMLAnchorElement', 'HTMLDialogElement', 'IntersectionObserver', 'KeyboardEvent'] as const

type DocsManifest = { sections: Array<Record<string, unknown>>; pages: Array<Record<string, unknown>> }

type LayoutBox = { bottom: number; height: number; top: number }

// happy-dom has no layout, so a test describes where elements sit before the shell measures them.
function mockLayout(layout: (element: HTMLElement) => LayoutBox | undefined) {
	const prototype = HTMLElement.prototype
	Object.defineProperty(prototype, 'getBoundingClientRect', {
		configurable: true,
		value(this: HTMLElement) {
			const box = layout(this) ?? { bottom: 0, height: 0, top: 0 }
			return { ...box, left: 0, right: 0, width: 0, x: 0, y: box.top }
		},
	})
	Object.defineProperty(prototype, 'getClientRects', {
		configurable: true,
		value(this: HTMLElement) {
			return layout(this) === undefined ? [] : [this.getBoundingClientRect()]
		},
	})
}

async function loadShell(url = 'http://localhost/docs/explanation/open-oracle.html', viewportWidth = 1280, transformManifest?: (data: DocsManifest) => DocsManifest, beforeRuntime?: () => void) {
	const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
	for (const key of globalKeys) previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
	const environment = installDomEnvironment(url)
	Object.defineProperty(environment.window, 'innerWidth', { configurable: true, value: viewportWidth, writable: true })
	const windowValues = environment.window as unknown as Record<string, unknown>
	for (const key of globalKeys) {
		Object.defineProperty(globalThis, key, { configurable: true, value: windowValues[key], writable: true })
	}
	const route = new URL(url).pathname.replace(/^.*\/docs\//, '')
	const source = await Bun.file(`docs/${route}`).text()
	document.write(source)
	document.close()
	Function(await Bun.file('docs/assets/js/docsData.js').text())()
	if (transformManifest !== undefined) {
		const data: unknown = Reflect.get(window, 'statoblastDocs')
		if (typeof data !== 'object' || data === null || !Array.isArray(Reflect.get(data, 'sections')) || !Array.isArray(Reflect.get(data, 'pages'))) throw new Error('docsData.js must define the documentation manifest')
		Reflect.set(window, 'statoblastDocs', transformManifest({ pages: Reflect.get(data, 'pages'), sections: Reflect.get(data, 'sections') }))
	}
	const runtimeScript = document.createElement('script')
	runtimeScript.src = 'http://localhost/docs/assets/js/docsShell.js'
	Object.defineProperty(document, 'currentScript', { configurable: true, value: runtimeScript })
	beforeRuntime?.()
	Function(await Bun.file('docs/assets/js/docsShell.js').text())()
	return {
		cleanup: () => {
			environment.cleanup()
			for (const key of globalKeys) {
				const descriptor = previousGlobals.get(key)
				if (descriptor === undefined) Reflect.deleteProperty(globalThis, key)
				else Object.defineProperty(globalThis, key, descriptor)
			}
		},
		window: environment.window,
	}
}

async function finishSearchLoad(source?: string) {
	const searchScript = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src$="/assets/js/docsSearchData.js"]')).at(-1)
	if (searchScript === undefined) throw new Error('Lazy documentation search script is missing')
	Function(source ?? (await Bun.file('docs/assets/js/docsSearchData.js').text()))()
	searchScript.dispatchEvent(new Event('load'))
	await Promise.resolve()
}

test('documentation landing lists every page of each section and opens the section a link targets', async () => {
	const shell = await loadShell('http://localhost/docs/documentation.html#how-to')
	try {
		const data: unknown = Reflect.get(shell.window, 'statoblastDocs')
		const pages: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'pages') : undefined
		const sections: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'sections') : undefined
		if (!Array.isArray(pages) || !Array.isArray(sections)) throw new Error('docsData.js must define the documentation manifest')
		for (const section of sections) {
			const sectionId = String(Reflect.get(section, 'id'))
			const expected = pages.filter(page => Reflect.get(page, 'section') === sectionId).map(page => `http://localhost/docs/${String(Reflect.get(page, 'path'))}`)
			const index = document.getElementById(sectionId)?.querySelector<HTMLDetailsElement>('.docs-section-index')
			const listed = Array.from(index?.querySelectorAll<HTMLAnchorElement>('a') ?? []).map(link => link.href)
			expect(listed.toSorted()).toEqual(expected.toSorted())
			expect(index?.open).toBe(sectionId === 'how-to')
		}
	} finally {
		shell.cleanup()
	}
})

test('documentation landing keeps global navigation compact and omits a redundant page outline', async () => {
	const shell = await loadShell('http://localhost/docs/documentation.html')
	try {
		expect(document.body.classList.contains('docs-landing-page')).toBeTrue()
		expect(document.querySelector('.docs-brand-mark')?.getAttribute('aria-hidden')).toBe('true')
		expect(document.querySelectorAll('.docs-navigation-section[open]')).toHaveLength(0)
		expect(document.querySelector('.docs-right')?.hasAttribute('hidden')).toBeTrue()
		expect(document.querySelector('.docs-mobile-outline')).toBeNull()
	} finally {
		shell.cleanup()
	}
})

test('navigation lists reading-path sections in manifest order and omits sections without pages', async () => {
	const emptySection = { description: 'A section with no pages yet.', id: 'zz-empty', title: 'Empty section' }
	const shell = await loadShell('http://localhost/docs/explanation/open-oracle.html', 1280, data => ({ ...data, sections: [...data.sections, emptySection] }))
	try {
		const data: unknown = Reflect.get(window, 'statoblastDocs')
		if (typeof data !== 'object' || data === null) throw new Error('docsData.js must define the documentation manifest')
		const sections: unknown = Reflect.get(data, 'sections')
		const pages: unknown = Reflect.get(data, 'pages')
		if (!Array.isArray(sections) || !Array.isArray(pages)) throw new Error('documentation manifest must list sections and pages')
		expect(sections.some(section => Reflect.get(section, 'id') === emptySection.id)).toBeTrue()
		const populatedSectionTitles = sections.filter(section => pages.some(page => Reflect.get(page, 'section') === Reflect.get(section, 'id'))).map(section => Reflect.get(section, 'title'))
		const renderedSectionTitles = Array.from(document.querySelectorAll('.docs-navigation-section > summary')).map(summary => summary.textContent)
		expect(renderedSectionTitles).toEqual(populatedSectionTitles)
		expect(renderedSectionTitles).not.toContain(emptySection.title)
		expect(renderedSectionTitles.length).toBeGreaterThan(0)
	} finally {
		shell.cleanup()
	}
})

test('contract reference index preserves the fragment ids of the former single page', async () => {
	const shell = await loadShell('http://localhost/docs/reference/contracts.html')
	try {
		const contractPages = [...new Bun.Glob('docs/reference/contracts/*.html').scanSync('.')]
		expect(contractPages.length).toBeGreaterThan(0)
		for (const pagePath of contractPages) {
			const slug = pagePath.replace(/^docs\/reference\/contracts\/|\.html$/g, '')
			const row = document.getElementById(slug)
			expect(row?.tagName).toBe('TR')
			expect(row?.querySelector('a')?.getAttribute('href')).toBe(`./contracts/${slug}.html`)
		}
		expect(document.getElementById('child-game-trust-boundary')?.getAttribute('href')).toBe('./contracts/securitypoolforker.html#child-game-trust-boundary')
	} finally {
		shell.cleanup()
	}
})

test('documentation navigation adds word-break opportunities inside camel-case contract titles', async () => {
	const shell = await loadShell('http://localhost/docs/reference/contracts/uniformpricedualcapbatchauction.html')
	try {
		const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('.docs-navigation-list a')).find(candidate => candidate.getAttribute('aria-current') === 'page')
		if (link === undefined) throw new Error('Current contract page is missing from the navigation')
		expect(link.textContent).toBe('UniformPriceDualCapBatchAuction')
		expect(Array.from(link.childNodes).map(node => node.nodeName)).toEqual(['#text', 'WBR', '#text', 'WBR', '#text', 'WBR', '#text', 'WBR', '#text', 'WBR', '#text'])
		const plainLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('.docs-navigation-list a')).find(candidate => candidate.textContent === 'Statoblast security model')
		expect(plainLink?.querySelector('wbr')).toBeNull()
	} finally {
		shell.cleanup()
	}
})

test('documentation search loads on demand, normalizes Unicode, and links to the best matching section', async () => {
	const shell = await loadShell('http://localhost/docs/explanation/open-oracle.html')
	try {
		const searchButton = document.querySelector<HTMLButtonElement>('.docs-search-button')
		searchButton?.click()
		const dialog = document.querySelector<HTMLDialogElement>('.docs-search')
		expect(dialog?.open).toBeTrue()
		expect(dialog?.getAttribute('aria-label')).toBe('Search documentation')
		expect(document.querySelector('.docs-search-status')?.textContent).toBe('Loading documentation search…')
		await finishSearchLoad()
		const input = document.querySelector<HTMLInputElement>('.docs-search-input')
		if (input === null) throw new Error('Search input is missing')
		input.value = 'Why Statoblast uses OpenOracle'
		input.dispatchEvent(new Event('input'))
		expect(document.querySelector('.docs-search-results strong')?.textContent).toBe('Why Statoblast uses OpenOracle')
		expect(document.querySelector<HTMLAnchorElement>('.docs-search-results a')?.href).toBe('http://localhost/docs/explanation/open-oracle.html')
		expect(document.querySelector('.docs-search-result-snippet')?.textContent).toBe('Why a contestable REP/ETH price guards solvency-sensitive operations, and where it stops.')
		expect(document.querySelector('.docs-search-status')?.textContent).toMatch(/^\d+ results$/)

		const searchData: unknown = Reflect.get(shell.window, 'statoblastDocsSearch')
		if (!Array.isArray(searchData) || typeof searchData[0] !== 'object' || searchData[0] === null) throw new Error('Search fixture is missing')
		const searchEntry = searchData.find(entry => typeof entry === 'object' && entry !== null && Reflect.get(entry, 'path') === 'explanation/open-oracle.html')
		if (typeof searchEntry !== 'object' || searchEntry === null) throw new Error('Search fixture entry is missing')
		const keywords: unknown = Reflect.get(searchEntry, 'keywords')
		if (!Array.isArray(keywords)) throw new Error('Search fixture keywords are missing')
		keywords.push('Diátaxis')
		input.value = 'diataxis'
		input.dispatchEvent(new Event('input'))
		expect(document.querySelector('.docs-search-results strong')?.textContent).toBe('Why Statoblast uses OpenOracle')
	} finally {
		shell.cleanup()
	}
})

test('documentation search resolves an invariant identifier to its own entry', async () => {
	const shell = await loadShell('http://localhost/docs/explanation/open-oracle.html')
	try {
		document.querySelector<HTMLButtonElement>('.docs-search-button')?.click()
		await finishSearchLoad()
		const input = document.querySelector<HTMLInputElement>('.docs-search-input')
		if (input === null) throw new Error('Search input is missing')
		input.value = 'UNI-01'
		input.dispatchEvent(new Event('input'))
		const result = document.querySelector<HTMLAnchorElement>('.docs-search-results a')
		expect(result?.href).toBe('http://localhost/docs/reference/invariants.html#uni-01')
		expect(result?.querySelector('.docs-search-result-snippet')?.textContent).toStartWith('UNI-01 One fork per universe — ')
	} finally {
		shell.cleanup()
	}
})

test('documentation search failure stays actionable and retries the lazy request', async () => {
	const shell = await loadShell('http://localhost/docs/explanation/open-oracle.html')
	try {
		document.querySelector<HTMLButtonElement>('.docs-search-button')?.click()
		const failedScript = document.querySelector<HTMLScriptElement>('script[src$="/assets/js/docsSearchData.js"]')
		if (failedScript === null) throw new Error('Initial lazy documentation search script is missing')
		failedScript.dispatchEvent(new Event('error'))
		await Promise.resolve()
		await Promise.resolve()
		const status = document.querySelector('.docs-search-status')
		const retry = document.querySelector<HTMLButtonElement>('.docs-search-retry')
		expect(status?.textContent).toBe('Search is unavailable.')
		expect(retry?.hidden).toBeFalse()

		const input = document.querySelector<HTMLInputElement>('.docs-search-input')
		if (input === null) throw new Error('Search input is missing')
		input.value = 'market'
		input.dispatchEvent(new Event('input'))
		expect(status?.textContent).toBe('Search is unavailable.')
		expect(retry?.hidden).toBeFalse()

		const searchSource = await Bun.file('docs/assets/js/docsSearchData.js').text()
		const originalAppend = document.head.append
		let retryScript: HTMLScriptElement | undefined
		document.head.append = (...nodes) => {
			const script = nodes.find(node => node instanceof HTMLScriptElement && node.src.endsWith('/assets/js/docsSearchData.js'))
			if (script instanceof HTMLScriptElement) retryScript = script
			else originalAppend.call(document.head, ...nodes)
		}
		retry?.click()
		document.head.append = originalAppend
		expect(status?.textContent).toBe('Loading documentation search…')
		expect(retry?.hidden).toBeTrue()
		if (retryScript === undefined) throw new Error('Retried lazy documentation search script is missing')
		Function(searchSource)()
		retryScript.dispatchEvent(new Event('load'))
		await Promise.resolve()
		expect(status?.textContent).toMatch(/^\d+ results$/)
	} finally {
		shell.cleanup()
	}
})

async function openLoadedSearch(query: string, source?: string) {
	document.querySelector<HTMLButtonElement>('.docs-search-button')?.click()
	await finishSearchLoad(source)
	const input = document.querySelector<HTMLInputElement>('.docs-search-input')
	if (input === null) throw new Error('Search input is missing')
	input.value = query
	input.dispatchEvent(new Event('input'))
	return input
}

function searchResultTitles(): string[] {
	return Array.from(document.querySelectorAll('.docs-search-results strong')).map(title => title.textContent ?? '')
}

// A fixture index keeps the ranking test independent of page titles and wording in the live corpus.
const searchFixture = `window.statoblastDocsSearch = ${JSON.stringify([
	{ fragment: '', heading: '', keywords: [], path: 'explanation/fixture-overview.html', sectionTitle: 'Explanations', summary: 'How the fixture protocol works.', text: 'How the fixture protocol keeps vaults solvent, and how liquidations restore coverage.', title: 'Fixture overview', topic: 'Fixture', weight: 1 },
	{
		fragment: '',
		heading: '',
		keywords: ['liquidation'],
		path: 'how-to/fixture-liquidation.html',
		sectionTitle: 'How-to guides',
		summary: 'Liquidate an undercollateralized fixture vault.',
		text: 'Liquidate a vault whose backing no longer covers its commitment.',
		title: 'Fixture liquidation',
		topic: 'Fixture',
		weight: 1,
	},
	{ fragment: '', heading: '', keywords: [], path: 'reference/fixture-glossary.html', sectionTitle: 'Reference', summary: 'Fixture terms.', text: 'Reporting and escalation terms.', title: 'Fixture glossary', topic: 'Fixture', weight: 1 },
])}`

test('documentation search ignores question filler words and matches other word forms', async () => {
	const shell = await loadShell()
	try {
		await openLoadedSearch('how do I liquidate a vault', searchFixture)
		expect(searchResultTitles()[0]).toBe('Fixture liquidation')
		const input = await openLoadedSearch('liquidations', searchFixture)
		const pluralResults = searchResultTitles()
		input.value = 'liquidate'
		input.dispatchEvent(new Event('input'))
		expect(searchResultTitles()).toEqual(pluralResults)
		expect(pluralResults).toContain('Fixture liquidation')
	} finally {
		shell.cleanup()
	}
})

test('documentation search opens the first result on Enter and moves through results with the arrow keys', async () => {
	const shell = await loadShell()
	try {
		const input = await openLoadedSearch('auction')
		const dialog = document.querySelector<HTMLDialogElement>('.docs-search')
		const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.docs-search-results a'))
		const [first, second] = links
		if (dialog === null || first === undefined || second === undefined) throw new Error('Search results are missing')
		const openedResults: string[] = []
		for (const link of links)
			link.addEventListener('click', event => {
				event.preventDefault()
				openedResults.push(link.href)
			})

		input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }))
		expect(document.activeElement).toBe(first)
		first.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }))
		expect(document.activeElement).toBe(second)
		second.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp' }))
		expect(document.activeElement).toBe(first)
		first.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp' }))
		expect(document.activeElement).toBe(input)

		document.querySelector('.docs-search-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
		expect(openedResults).toEqual([first.href])
		expect(dialog.open).toBeFalse()
	} finally {
		shell.cleanup()
	}
})

type ReadingOrderPage = { path: string; section: string; title: string }

// The reading order the sidebar shows: manifest sections in order, each section's pages grouped by topic in first-appearance order.
function manifestReadingOrder(window: unknown): { order: ReadingOrderPage[]; sectionTitles: Map<string, string> } {
	const data: unknown = Reflect.get(window as object, 'statoblastDocs')
	const pages: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'pages') : undefined
	const sections: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'sections') : undefined
	if (!Array.isArray(pages) || !Array.isArray(sections)) throw new Error('docsData.js must define the documentation manifest')
	const order: ReadingOrderPage[] = []
	const sectionTitles = new Map<string, string>()
	for (const section of sections) {
		const sectionId = String(Reflect.get(section, 'id'))
		sectionTitles.set(sectionId, String(Reflect.get(section, 'title')))
		const topics = new Map<string, ReadingOrderPage[]>()
		for (const page of pages) {
			if (Reflect.get(page, 'section') !== sectionId) continue
			const topic = String(Reflect.get(page, 'topic'))
			topics.set(topic, [...(topics.get(topic) ?? []), { path: String(Reflect.get(page, 'path')), section: sectionId, title: String(Reflect.get(page, 'title')) }])
		}
		order.push(...Array.from(topics.values()).flat())
	}
	return { order, sectionTitles }
}

test('previous and next follow the sidebar order and continue into the next section', async () => {
	const overview = await loadShell('http://localhost/docs/explanation/system-overview.html')
	let readingOrder: ReturnType<typeof manifestReadingOrder> | undefined
	try {
		readingOrder = manifestReadingOrder(overview.window)
		const { order, sectionTitles } = readingOrder
		const sidebarPaths = Array.from(document.querySelectorAll<HTMLAnchorElement>('.docs-navigation-list a')).map(link => link.href.replace('http://localhost/docs/', ''))
		expect(sidebarPaths).toEqual(order.map(page => page.path))
		const index = order.findIndex(page => page.path === 'explanation/system-overview.html')
		const current = order[index]
		const following = order[index + 1]
		if (current === undefined || following === undefined) throw new Error('The overview page needs a following page')
		const nextLabel = following.section === current.section ? 'Next' : `Next · ${sectionTitles.get(following.section) ?? ''}`
		expect(document.querySelector('.docs-page-pager a:last-child')?.textContent).toBe(`${nextLabel}${following.title}`)
		const sectionCrumb = document.querySelector<HTMLAnchorElement>('.docs-breadcrumbs a:last-child')
		expect(sectionCrumb?.textContent).toBe(sectionTitles.get(current.section))
		expect(sectionCrumb?.href).toBe(`http://localhost/docs/documentation.html#${current.section}`)
	} finally {
		overview.cleanup()
	}
	if (readingOrder === undefined) throw new Error('The manifest reading order is missing')
	const { order, sectionTitles } = readingOrder
	const boundary = order.findIndex((page, index) => order[index + 1] !== undefined && order[index + 1]?.section !== page.section)
	const lastInSection = order[boundary]
	const firstInNextSection = order[boundary + 1]
	if (lastInSection === undefined || firstInNextSection === undefined) throw new Error('The manifest needs two non-empty sections')
	const crossing = await loadShell(`http://localhost/docs/${lastInSection.path}`)
	try {
		expect(document.querySelector('.docs-page-pager a:last-child span')?.textContent).toBe(`Next · ${sectionTitles.get(firstInNextSection.section) ?? ''}`)
		expect(document.querySelector<HTMLAnchorElement>('.docs-page-pager a:last-child')?.href).toBe(`http://localhost/docs/${firstInNextSection.path}`)
	} finally {
		crossing.cleanup()
	}
})

test('contract page titles get word-break points and the navigation column reveals the current page', async () => {
	const shell = await loadShell('http://localhost/docs/reference/contracts/uniformpricedualcapbatchauction.html', 1280, undefined, () =>
		mockLayout(element => {
			if (element.classList.contains('docs-left')) return { bottom: 900, height: 836, top: 64 }
			if (element.getAttribute('aria-current') === 'page') return { bottom: 1045, height: 44, top: 1001 }
			return undefined
		}),
	)
	try {
		const heading = document.querySelector('main h1')
		expect(heading?.textContent).toBe('UniformPriceDualCapBatchAuction')
		expect(heading?.querySelectorAll('wbr')).toHaveLength(5)
		expect(document.querySelector('.docs-brand-name')?.textContent).toBe('Augur documentation')
		expect(document.querySelector<HTMLElement>('.docs-left')?.scrollTop).toBeGreaterThan(0)
	} finally {
		shell.cleanup()
	}
})

test('the page outline marks the section under the header, and nothing above the first section', async () => {
	const headingTops = new Map<string, number>()
	const shell = await loadShell('http://localhost/docs/explanation/open-oracle.html', 1280, undefined, () =>
		mockLayout(element => {
			if (element.classList.contains('docs-topbar')) return { bottom: 64, height: 64, top: 0 }
			const top = headingTops.get(element.id)
			return top === undefined ? undefined : { bottom: top + 40, height: 40, top }
		}),
	)
	try {
		const outlineLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.docs-right .docs-outline-list a'))
		const [firstLink, secondLink, thirdLink] = outlineLinks
		if (firstLink === undefined || secondLink === undefined || thirdLink === undefined) throw new Error('The page outline needs at least three sections')
		const ids = [firstLink, secondLink, thirdLink].map(link => decodeURIComponent(link.hash.slice(1)))
		const current = () => Array.from(document.querySelectorAll('.docs-outline-list a[aria-current="location"]')).map(link => link.getAttribute('href'))
		ids.forEach((id, index) => headingTops.set(id, 500 + index * 600))
		window.dispatchEvent(new Event('scroll'))
		await Bun.sleep(30)
		expect(current()).toEqual([])

		headingTops.set(ids[0] ?? '', -400)
		headingTops.set(ids[1] ?? '', 70)
		headingTops.set(ids[2] ?? '', 700)
		window.dispatchEvent(new Event('scroll'))
		await Bun.sleep(30)
		// The desktop outline and its collapsed mobile copy agree.
		expect(current()).toEqual([secondLink.getAttribute('href'), secondLink.getAttribute('href')])
	} finally {
		shell.cleanup()
	}
})

test('the theme control follows the system preference until the reader picks a theme, and remembers the choice', async () => {
	const first = await loadShell()
	try {
		const select = document.querySelector<HTMLSelectElement>('#docs-theme-select')
		if (select === null) throw new Error('Theme control is missing')
		expect(document.querySelector('label[for="docs-theme-select"]')?.textContent).toBe('Theme')
		expect(select.value).toBe('system')
		expect(document.documentElement.dataset['docsTheme']).toBe('light')
		select.value = 'dark'
		select.dispatchEvent(new Event('change'))
		expect(document.documentElement.dataset['docsTheme']).toBe('dark')
		expect(window.localStorage.getItem('augur-docs.theme')).toBe('dark')
	} finally {
		first.cleanup()
	}
	// A stored choice applies on the next page load before the reader touches the control.
	const second = await loadShell(undefined, undefined, undefined, () => window.localStorage.setItem('augur-docs.theme', 'dark'))
	try {
		const select = document.querySelector<HTMLSelectElement>('#docs-theme-select')
		if (select === null) throw new Error('Theme control is missing')
		expect(select.value).toBe('dark')
		expect(document.documentElement.dataset['docsTheme']).toBe('dark')
		select.value = 'system'
		select.dispatchEvent(new Event('change'))
		expect(window.localStorage.getItem('augur-docs.theme')).toBeNull()
		expect(document.documentElement.dataset['docsTheme']).toBe('light')
	} finally {
		second.cleanup()
	}
})
