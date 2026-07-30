import { expect, test } from 'bun:test'
import { installDomEnvironment } from '../ui/ts/tests/testUtils/domEnvironment.ts'

const extraGlobalKeys = ['HTMLDetailsElement', 'HTMLAnchorElement', 'HTMLIFrameElement', 'fetch', 'matchMedia'] as const
type FetchDocument = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function mediaQueryList(query: string, narrow: boolean): MediaQueryList {
	return {
		addEventListener: () => undefined,
		addListener: () => undefined,
		dispatchEvent: () => true,
		matches: query === '(max-width: 980px)' && narrow,
		media: query,
		onchange: null,
		removeEventListener: () => undefined,
		removeListener: () => undefined,
	}
}

async function loadReader(narrow: boolean, fetchDocument: FetchDocument = async () => new Response('<!doctype html><html><body><main><h1>Document</h1><h2 id="abstract">Abstract</h2></main></body></html>')) {
	const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
	for (const key of extraGlobalKeys) {
		previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
	}

	const environment = installDomEnvironment('http://localhost/docs/documentation.html')
	const windowValues = environment.window as unknown as Record<string, unknown>

	for (const key of ['HTMLDetailsElement', 'HTMLAnchorElement', 'HTMLIFrameElement']) {
		Object.defineProperty(globalThis, key, {
			configurable: true,
			value: windowValues[key],
			writable: true,
		})
	}

	const matchMedia = (query: string) => mediaQueryList(query, narrow)
	Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchDocument, writable: true })
	Reflect.set(environment.window, 'fetch', fetchDocument)
	Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: matchMedia, writable: true })
	Reflect.set(environment.window, 'matchMedia', matchMedia)
	Reflect.set(environment.window, 'scrollTo', () => undefined)
	environment.window.HTMLElement.prototype.scrollIntoView = () => undefined

	const shell = await Bun.file('docs/documentation.html').text()
	const generatedMarkdown = await Bun.file('docs/assets/js/docsReaderMarkdown.js').text()
	const runtime = await Bun.file('docs/assets/js/docsReader.js').text()
	document.write(shell)
	Function(generatedMarkdown)()
	Function(runtime)()
	await Bun.sleep(25)

	return {
		cleanup: () => {
			environment.cleanup()
			for (const key of extraGlobalKeys) {
				const descriptor = previousGlobals.get(key)
				if (descriptor === undefined) {
					Reflect.deleteProperty(globalThis, key)
				} else {
					Object.defineProperty(globalThis, key, descriptor)
				}
			}
		},
		window: environment.window,
	}
}

function visibleDocumentPaths() {
	return Array.from(document.querySelectorAll<HTMLElement>('.reader-chapter'))
		.filter(chapter => !chapter.hidden)
		.map(chapter => chapter.dataset['documentPath'])
}

function expandedNavigationDocumentPaths() {
	return Array.from(document.querySelectorAll<HTMLDetailsElement>('.reader-nav-document[open]')).map(documentEntry => documentEntry.dataset['navigationDocumentPath'])
}

function documentLink(path: string) {
	const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('.reader-nav-document-link')).find(candidate => candidate.dataset['documentPath'] === path)
	if (link === undefined) throw new Error(`Reader navigation link is missing for ${path}`)
	return link
}

async function waitForHistory() {
	await Bun.sleep(25)
}

test('documentation reader shows and navigates one document at a time', async () => {
	const reader = await loadReader(false)
	try {
		expect(visibleDocumentPaths()).toEqual(['whitepapers/statoblast-whitepaper.html'])
		expect(expandedNavigationDocumentPaths()).toEqual(['whitepapers/statoblast-whitepaper.html'])
		expect(document.querySelector('[aria-current="location"]')?.getAttribute('data-document-path')).toBe('whitepapers/statoblast-whitepaper.html')
		expect(document.querySelector<HTMLIFrameElement>('.reader-document-frame')?.getAttribute('srcdoc')).toContain('<h1>Document</h1>')
		for (const selector of ['[data-doc-search]', '[data-search-status]', '[data-search-results]', '[data-retry-search]', '[data-reader-empty]']) {
			expect(document.querySelector(selector)).toBeNull()
		}
		const slashEvent = new reader.window.KeyboardEvent('keydown', { cancelable: true, key: '/' })
		expect(reader.window.document.dispatchEvent(slashEvent)).toBeTrue()
		const chapterActions = Array.from(document.querySelectorAll('.reader-chapter-header a, .reader-chapter-header button'))
		expect(chapterActions.some(action => /open source/i.test(action.textContent ?? '') || /open source/i.test(action.getAttribute('aria-label') ?? ''))).toBeFalse()

		documentLink('whitepapers/zoltar-whitepaper.html').click()
		await waitForHistory()
		expect(visibleDocumentPaths()).toEqual(['whitepapers/zoltar-whitepaper.html'])
		expect(expandedNavigationDocumentPaths()).toEqual(['whitepapers/zoltar-whitepaper.html'])
		expect(location.hash).toBe('#doc-whitepapers-zoltar-whitepaper')

		history.back()
		await waitForHistory()
		expect(location.hash).toBe('')
		expect(visibleDocumentPaths()).toEqual(['whitepapers/statoblast-whitepaper.html'])
		expect(document.querySelector<HTMLIFrameElement>('.reader-document-frame')?.getAttribute('srcdoc')).toContain('<h1>Document</h1>')
		expect(document.querySelector('[aria-current="location"]')?.getAttribute('data-document-path')).toBe('whitepapers/statoblast-whitepaper.html')

		history.forward()
		await waitForHistory()
		expect(location.hash).toBe('#doc-whitepapers-zoltar-whitepaper')
		expect(visibleDocumentPaths()).toEqual(['whitepapers/zoltar-whitepaper.html'])

		history.back()
		await waitForHistory()
		expect(location.hash).toBe('')
		expect(visibleDocumentPaths()).toEqual(['whitepapers/statoblast-whitepaper.html'])
		expect(document.querySelector('[aria-current="location"]')?.getAttribute('data-document-path')).toBe('whitepapers/statoblast-whitepaper.html')

		history.forward()
		await waitForHistory()
		expect(location.hash).toBe('#doc-whitepapers-zoltar-whitepaper')
		expect(visibleDocumentPaths()).toEqual(['whitepapers/zoltar-whitepaper.html'])

		const sectionLink = document.createElement('a')
		sectionLink.href = '#doc-whitepapers-zoltar-whitepaper--abstract'
		sectionLink.dataset['documentPath'] = 'whitepapers/zoltar-whitepaper.html'
		sectionLink.dataset['documentFragment'] = 'abstract'
		document.querySelector('[data-reader-navigation]')?.append(sectionLink)
		sectionLink.click()
		await waitForHistory()
		expect(visibleDocumentPaths()).toEqual(['whitepapers/zoltar-whitepaper.html'])
		expect(location.hash).toBe('#doc-whitepapers-zoltar-whitepaper--abstract')
	} finally {
		reader.cleanup()
	}
})

test('opening an inactive document disclosure selects that document', async () => {
	const reader = await loadReader(false)
	try {
		const zoltarDisclosure = document.querySelector<HTMLDetailsElement>('[data-navigation-document-path="whitepapers/zoltar-whitepaper.html"]')
		if (zoltarDisclosure === null) throw new Error('Zoltar disclosure is missing')
		zoltarDisclosure.querySelector('summary')?.click()
		await waitForHistory()

		expect(visibleDocumentPaths()).toEqual(['whitepapers/zoltar-whitepaper.html'])
		expect(expandedNavigationDocumentPaths()).toEqual(['whitepapers/zoltar-whitepaper.html'])
		expect(document.querySelector('[aria-current="location"]')?.getAttribute('data-document-path')).toBe('whitepapers/zoltar-whitepaper.html')
		expect(location.hash).toBe('#doc-whitepapers-zoltar-whitepaper')
	} finally {
		reader.cleanup()
	}
})

test('links inside reader documents preserve grouped same-directory and cross-directory navigation', async () => {
	const reader = await loadReader(false, async input => {
		const url = String(input)
		if (url.includes('whitepapers/statoblast-whitepaper.html')) {
			return new Response('<!doctype html><html><body><main><h1>Statoblast</h1><a href="./zoltar-whitepaper.html#abstract">Zoltar</a></main></body></html>')
		}
		if (url.includes('whitepapers/zoltar-whitepaper.html')) {
			return new Response('<!doctype html><html><body><main><h1>Zoltar</h1><h2 id="abstract">Abstract</h2><a href="../protocol-design/liquidation.html#model">Liquidation</a></main></body></html>')
		}
		return new Response('<!doctype html><html><body><main><h1>Liquidation</h1><h2 id="model">Model</h2></main></body></html>')
	})
	try {
		const activeFrame = () => document.querySelector<HTMLIFrameElement>('.reader-chapter:not([hidden]) .reader-document-frame')
		activeFrame()?.contentDocument?.querySelector<HTMLAnchorElement>('a')?.click()
		await waitForHistory()
		expect(visibleDocumentPaths()).toEqual(['whitepapers/zoltar-whitepaper.html'])
		expect(location.hash).toBe('#doc-whitepapers-zoltar-whitepaper--abstract')

		activeFrame()?.contentDocument?.querySelector<HTMLAnchorElement>('a')?.click()
		await waitForHistory()
		expect(visibleDocumentPaths()).toEqual(['protocol-design/liquidation.html'])
		expect(location.hash).toBe('#doc-protocol-design-liquidation--model')
		expect(document.querySelectorAll('.reader-document-frame[data-reader-source-ready="true"]')).toHaveLength(1)
	} finally {
		reader.cleanup()
	}
})

test('Markdown reader documents load shared assets from the documentation root', async () => {
	const reader = await loadReader(false)
	try {
		documentLink('safety-operations/operator-reference.md').click()
		await waitForHistory()
		const source = document.querySelector<HTMLIFrameElement>('.reader-chapter:not([hidden]) .reader-document-frame')?.getAttribute('srcdoc')
		expect(source).toContain('href="http://localhost/docs/assets/css/shared-docs.css"')
		expect(source).toContain('src="http://localhost/docs/assets/js/responsiveDocs.js"')
	} finally {
		reader.cleanup()
	}
})

test('the active document outline can collapse without unloading its document', async () => {
	const reader = await loadReader(false)
	try {
		const statoblastDisclosure = document.querySelector<HTMLDetailsElement>('[data-navigation-document-path="whitepapers/statoblast-whitepaper.html"]')
		if (statoblastDisclosure === null) throw new Error('Statoblast disclosure is missing')
		statoblastDisclosure.querySelector('summary')?.click()

		expect(visibleDocumentPaths()).toEqual(['whitepapers/statoblast-whitepaper.html'])
		expect(expandedNavigationDocumentPaths()).toEqual([])
		expect(document.querySelector('[aria-current="location"]')?.getAttribute('data-document-path')).toBe('whitepapers/statoblast-whitepaper.html')
	} finally {
		reader.cleanup()
	}
})

test('documentation reader collapse state remains accessible on desktop and narrow layouts', async () => {
	const desktopReader = await loadReader(false)
	try {
		const toggle = document.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')
		if (toggle === null) throw new Error('Reader sidebar toggle is missing')
		toggle.click()
		expect(toggle.getAttribute('aria-expanded')).toBe('false')
		expect(toggle.getAttribute('aria-label')).toBe('Expand menu')

		toggle.click()
		expect(toggle.getAttribute('aria-expanded')).toBe('true')
	} finally {
		desktopReader.cleanup()
	}

	const narrowReader = await loadReader(true)
	try {
		expect(document.querySelector('.reader-shell')?.getAttribute('data-sidebar-collapsed')).toBe('true')
		expect(document.querySelector('[data-sidebar-toggle]')?.getAttribute('aria-expanded')).toBe('false')
		expect(visibleDocumentPaths()).toEqual(['whitepapers/statoblast-whitepaper.html'])

		document.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')?.click()
		const link = documentLink('whitepapers/zoltar-whitepaper.html')
		link.focus()
		link.click()
		await waitForHistory()
		expect(document.activeElement?.id).toBe('reader-content')
		expect(document.querySelector('.reader-shell')?.getAttribute('data-sidebar-collapsed')).toBe('true')
		expect(visibleDocumentPaths()).toEqual(['whitepapers/zoltar-whitepaper.html'])
	} finally {
		narrowReader.cleanup()
	}
})

test('narrow navigation collapses and transfers focus before loading settles', async () => {
	let resolveDocument: ((response: Response) => void) | undefined
	const pendingFetch: FetchDocument = async input => {
		if (!String(input).includes('whitepapers/zoltar-whitepaper.html')) {
			return new Response('<!doctype html><html><body><main><h1>Document</h1></main></body></html>')
		}
		return await new Promise<Response>(resolve => {
			resolveDocument = resolve
		})
	}
	const pendingReader = await loadReader(true, pendingFetch)
	try {
		document.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')?.click()
		const link = documentLink('whitepapers/zoltar-whitepaper.html')
		link.focus()
		link.click()

		expect(document.activeElement?.id).toBe('reader-content')
		expect(document.querySelector('.reader-shell')?.getAttribute('data-sidebar-collapsed')).toBe('true')
		expect(visibleDocumentPaths()).toEqual(['whitepapers/zoltar-whitepaper.html'])
		const pendingFrame = document.querySelector<HTMLIFrameElement>('.reader-document-frame')
		expect(pendingFrame?.hidden).toBeTrue()
		expect(pendingFrame?.getAttribute('srcdoc')).toContain('<h1>Document</h1>')

		if (resolveDocument === undefined) throw new Error('Pending document request did not start')
		resolveDocument(new Response('<!doctype html><html><body><main><h1>Zoltar</h1></main></body></html>'))
		await waitForHistory()
		expect(location.hash).toBe('#doc-whitepapers-zoltar-whitepaper')
		expect(pendingFrame?.hidden).toBeFalse()
		expect(pendingFrame?.getAttribute('srcdoc')).toContain('<h1>Zoltar</h1>')
	} finally {
		pendingReader.cleanup()
	}

	const rejectedFetch: FetchDocument = async input => {
		if (String(input).includes('whitepapers/zoltar-whitepaper.html')) throw new TypeError('Document request failed')
		return new Response('<!doctype html><html><body><main><h1>Document</h1></main></body></html>')
	}
	const rejectedReader = await loadReader(true, rejectedFetch)
	try {
		document.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')?.click()
		const link = documentLink('whitepapers/zoltar-whitepaper.html')
		link.focus()
		link.click()

		expect(document.activeElement?.id).toBe('reader-content')
		expect(document.querySelector('.reader-shell')?.getAttribute('data-sidebar-collapsed')).toBe('true')
		await waitForHistory()
		expect(document.querySelector('.reader-frame-error')).not.toBeNull()
	} finally {
		rejectedReader.cleanup()
	}
})
