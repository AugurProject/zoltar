import { expect, test } from 'bun:test'
import { installDomEnvironment } from '../ui/ts/tests/testUtils/domEnvironment.ts'

const globalKeys = ['HTMLScriptElement', 'HTMLAnchorElement', 'HTMLDialogElement', 'IntersectionObserver', 'KeyboardEvent'] as const

async function loadShell(url = 'http://localhost/docs/tutorials/first-market.html', viewportWidth = 1280) {
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

test('documentation shell provides native Diátaxis navigation without an iframe', async () => {
	const shell = await loadShell()
	try {
		expect(document.querySelector('iframe')).toBeNull()
		expect(document.querySelector('.docs-topbar')).not.toBeNull()
		expect(document.querySelector('.docs-topnav')).toBeNull()
		expect(document.querySelector('.docs-navigation-list a[aria-current="page"]')?.textContent).toBe('Explore a seeded market and security pool')
		expect(document.querySelector('.docs-type-badge')?.textContent).toBe('Tutorials')
		expect(document.querySelector('.docs-outline-list a')?.getAttribute('href')).toBe('#before-you-start')
		expect(document.querySelector('.docs-mobile-outline')).not.toBeNull()
		expect(document.querySelector('.docs-search-icon')?.textContent).toBe('⌕')
		expect(document.querySelector('.docs-search-button kbd')?.textContent).toBe('Ctrl/⌘ K')
		expect(document.querySelector('script[src$="/assets/js/docsSearchData.js"]')).toBeNull()
	} finally {
		shell.cleanup()
	}
})

test('documentation landing keeps global navigation compact and omits a redundant page outline', async () => {
	const shell = await loadShell('http://localhost/docs/documentation.html')
	try {
		expect(document.body.classList.contains('docs-landing-page')).toBeTrue()
		expect(document.querySelectorAll('.docs-navigation-section[open]')).toHaveLength(0)
		expect(document.querySelector('.docs-right')?.hasAttribute('hidden')).toBeTrue()
		expect(document.querySelector('.docs-mobile-outline')).toBeNull()
	} finally {
		shell.cleanup()
	}
})

test('documentation search loads on demand, normalizes Unicode, and links to the best matching section', async () => {
	const shell = await loadShell()
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
		input.value = 'noncanonical replacement branch'
		input.dispatchEvent(new Event('input'))
		expect(document.querySelector('.docs-search-results strong')?.textContent).toBe('Build a reorg-safe event indexer')
		expect(document.querySelector<HTMLAnchorElement>('.docs-search-results a')?.href).toBe('http://localhost/docs/how-to/build-event-indexer.html#handle-reorganizations')
		expect(document.querySelector('.docs-search-result-snippet')?.textContent).toMatch(/^Handle reorganizations —/)
		expect(document.querySelector('.docs-search-status')?.textContent).toBe('1 result')

		const searchData: unknown = Reflect.get(shell.window, 'statoblastDocsSearch')
		if (!Array.isArray(searchData) || typeof searchData[0] !== 'object' || searchData[0] === null) throw new Error('Search fixture is missing')
		const keywords: unknown = Reflect.get(searchData[0], 'keywords')
		if (!Array.isArray(keywords)) throw new Error('Search fixture keywords are missing')
		keywords.push('Diátaxis')
		input.value = 'diataxis'
		input.dispatchEvent(new Event('input'))
		expect(document.querySelector('.docs-search-results strong')?.textContent).toBe('Explore a seeded market and security pool')
	} finally {
		shell.cleanup()
	}
})

test('documentation search failure stays actionable and retries the lazy request', async () => {
	const shell = await loadShell()
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

test('mobile menu isolates focus while open and restores desktop navigation after resize', async () => {
	const shell = await loadShell('http://localhost/docs/tutorials/first-market.html', 390)
	try {
		const button = document.querySelector<HTMLButtonElement>('.docs-icon-button')
		const left = document.querySelector<HTMLElement>('.docs-left')
		const main = document.querySelector<HTMLElement>('main')
		expect(left?.inert).toBeTrue()
		button?.click()
		expect(document.body.dataset['docsNavigationOpen']).toBe('true')
		expect(button?.getAttribute('aria-expanded')).toBe('true')
		expect(left?.inert).toBeFalse()
		expect(main?.inert).toBeTrue()
		expect(document.activeElement?.closest('.docs-left')).not.toBeNull()
		const backdrop = document.querySelector<HTMLButtonElement>('.docs-navigation-backdrop')
		expect(backdrop?.tabIndex).toBe(-1)
		const visibleNavigationItems = Array.from(document.querySelectorAll<HTMLElement>('.docs-left summary, .docs-left a')).filter(node => {
			for (let ancestor = node.parentElement; ancestor !== null && !ancestor.classList.contains('docs-left'); ancestor = ancestor.parentElement) {
				if (ancestor.matches('details:not([open])') && ancestor.firstElementChild !== node) return false
			}
			return true
		})
		const lastNavigationItem = visibleNavigationItems.at(-1)
		if (lastNavigationItem === undefined) throw new Error('Visible mobile navigation item is missing')
		lastNavigationItem.focus()
		document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }))
		expect(document.activeElement).toBe(button)
		document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab', shiftKey: true }))
		expect(document.activeElement).toBe(lastNavigationItem)
		backdrop?.click()
		expect(document.body.dataset['docsNavigationOpen']).toBe('false')
		expect(left?.inert).toBeTrue()
		expect(main?.inert).toBeFalse()
		expect(document.activeElement).toBe(button)
		button?.click()
		Object.defineProperty(shell.window, 'innerWidth', { configurable: true, value: 900, writable: true })
		shell.window.dispatchEvent(new shell.window.Event('resize'))
		expect(document.body.dataset['docsNavigationOpen']).toBe('false')
		expect(left?.inert).toBeFalse()
		expect(main?.inert).toBeFalse()
	} finally {
		shell.cleanup()
	}
})
