import { expect, test } from 'bun:test'
import { installDomEnvironment } from '../../ui/coreShared/ts/tests/testUtils/domEnvironment.ts'

const globalKeys = ['HTMLScriptElement', 'HTMLAnchorElement', 'HTMLDialogElement', 'IntersectionObserver', 'KeyboardEvent'] as const

type DocsManifest = { sections: Array<Record<string, unknown>>; pages: Array<Record<string, unknown>> }

async function loadShell(url = 'http://localhost/docs/explanation/open-oracle.html', viewportWidth = 1280, transformManifest?: (data: DocsManifest) => DocsManifest) {
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
		const plainLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('.docs-navigation-list a')).find(candidate => candidate.textContent === 'Security model')
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
		expect(document.querySelector('.docs-search-result-snippet')?.textContent).toBe('REP/ETH price oracle for Statoblast.')
		expect(document.querySelector('.docs-search-status')?.textContent).toBe('2 results')

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
