import { expect, test } from 'bun:test'
import { installDomEnvironment } from '../ui/ts/tests/testUtils/domEnvironment.ts'

const extraGlobalKeys = ['HTMLDetailsElement', 'HTMLAnchorElement', 'HTMLIFrameElement', 'fetch', 'matchMedia'] as const

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

async function loadReader(narrow: boolean) {
	const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
	for (const key of extraGlobalKeys) {
		previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
	}

	const environment = installDomEnvironment('http://localhost/documentation.html')
	const windowValues = environment.window as unknown as Record<string, unknown>

	for (const key of ['HTMLDetailsElement', 'HTMLAnchorElement', 'HTMLIFrameElement']) {
		Object.defineProperty(globalThis, key, {
			configurable: true,
			value: windowValues[key],
			writable: true,
		})
	}

	const matchMedia = (query: string) => mediaQueryList(query, narrow)
	const fetchDocument = async () => new Response('<!doctype html><html><body><main><h1>Document</h1><h2 id="abstract">Abstract</h2></main></body></html>')
	Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchDocument, writable: true })
	Reflect.set(environment.window, 'fetch', fetchDocument)
	Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: matchMedia, writable: true })
	Reflect.set(environment.window, 'matchMedia', matchMedia)
	Reflect.set(environment.window, 'scrollTo', () => undefined)
	environment.window.HTMLElement.prototype.scrollIntoView = () => undefined

	const shell = await Bun.file('docs/documentation.html').text()
	const runtime = await Bun.file('docs/docsReader.js').text()
	document.write(shell)
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
		expect(visibleDocumentPaths()).toEqual(['statoblast-whitepaper.html'])
		expect(document.querySelector('[aria-current="location"]')?.getAttribute('data-document-path')).toBe('statoblast-whitepaper.html')
		for (const selector of ['[data-doc-search]', '[data-search-status]', '[data-search-results]', '[data-retry-search]', '[data-reader-empty]']) {
			expect(document.querySelector(selector)).toBeNull()
		}
		const slashEvent = new reader.window.KeyboardEvent('keydown', { cancelable: true, key: '/' })
		expect(reader.window.document.dispatchEvent(slashEvent)).toBeTrue()
		const chapterActions = Array.from(document.querySelectorAll('.reader-chapter-header a, .reader-chapter-header button'))
		expect(chapterActions.some(action => /open source/i.test(action.textContent ?? '') || /open source/i.test(action.getAttribute('aria-label') ?? ''))).toBeFalse()

		documentLink('zoltar-whitepaper.html').click()
		await waitForHistory()
		expect(visibleDocumentPaths()).toEqual(['zoltar-whitepaper.html'])
		expect(location.hash).toBe('#doc-zoltar-whitepaper')

		history.back()
		await waitForHistory()
		expect(location.hash).toBe('')
		expect(visibleDocumentPaths()).toEqual(['statoblast-whitepaper.html'])
		expect(document.querySelector('[aria-current="location"]')?.getAttribute('data-document-path')).toBe('statoblast-whitepaper.html')

		history.forward()
		await waitForHistory()
		expect(location.hash).toBe('#doc-zoltar-whitepaper')
		expect(visibleDocumentPaths()).toEqual(['zoltar-whitepaper.html'])

		history.back()
		await waitForHistory()
		expect(location.hash).toBe('')
		expect(visibleDocumentPaths()).toEqual(['statoblast-whitepaper.html'])
		expect(document.querySelector('[aria-current="location"]')?.getAttribute('data-document-path')).toBe('statoblast-whitepaper.html')

		history.forward()
		await waitForHistory()
		expect(location.hash).toBe('#doc-zoltar-whitepaper')
		expect(visibleDocumentPaths()).toEqual(['zoltar-whitepaper.html'])

		const sectionLink = document.createElement('a')
		sectionLink.href = '#doc-zoltar-whitepaper--abstract'
		sectionLink.dataset['documentPath'] = 'zoltar-whitepaper.html'
		sectionLink.dataset['documentFragment'] = 'abstract'
		document.querySelector('[data-reader-navigation]')?.append(sectionLink)
		sectionLink.click()
		await waitForHistory()
		expect(visibleDocumentPaths()).toEqual(['zoltar-whitepaper.html'])
		expect(location.hash).toBe('#doc-zoltar-whitepaper--abstract')
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
		expect(visibleDocumentPaths()).toEqual(['statoblast-whitepaper.html'])

		document.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')?.click()
		const link = documentLink('zoltar-whitepaper.html')
		link.focus()
		link.click()
		await waitForHistory()
		expect(document.activeElement?.id).toBe('reader-content')
		expect(document.querySelector('.reader-shell')?.getAttribute('data-sidebar-collapsed')).toBe('true')
		expect(visibleDocumentPaths()).toEqual(['zoltar-whitepaper.html'])
	} finally {
		narrowReader.cleanup()
	}
})
