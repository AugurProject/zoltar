import { expect, test } from 'bun:test'
import { installDomEnvironment } from '../ui/ts/tests/testUtils/domEnvironment.ts'

const globalKeys = ['HTMLScriptElement', 'HTMLAnchorElement', 'HTMLDialogElement', 'IntersectionObserver'] as const

async function loadShell(url = 'http://localhost/docs/tutorials/first-market.html', viewportWidth = 1280) {
	const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
	for (const key of globalKeys) previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
	const environment = installDomEnvironment(url)
	Object.defineProperty(environment.window, 'innerWidth', { configurable: true, value: viewportWidth, writable: true })
	const windowValues = environment.window as unknown as Record<string, unknown>
	for (const key of globalKeys) {
		Object.defineProperty(globalThis, key, { configurable: true, value: windowValues[key], writable: true })
	}
	const source = await Bun.file('docs/tutorials/first-market.html').text()
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
	} finally {
		shell.cleanup()
	}
})

test('documentation search indexes the complete corpus', async () => {
	const shell = await loadShell()
	try {
		const searchButton = document.querySelector<HTMLButtonElement>('.docs-search-button')
		searchButton?.click()
		const dialog = document.querySelector<HTMLDialogElement>('.docs-search')
		expect(dialog?.open).toBeTrue()
		expect(dialog?.getAttribute('aria-label')).toBe('Search documentation')
		const input = document.querySelector<HTMLInputElement>('.docs-search-input')
		if (input === null) throw new Error('Search input is missing')
		input.value = 'reorg indexer'
		input.dispatchEvent(new Event('input'))
		expect(document.querySelector('.docs-search-results strong')?.textContent).toBe('Build a reorg-safe event indexer')
		expect(document.querySelector('.docs-search-status')?.textContent).toMatch(/^\d+ results$/)
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
		document.querySelector<HTMLButtonElement>('.docs-navigation-backdrop')?.click()
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
