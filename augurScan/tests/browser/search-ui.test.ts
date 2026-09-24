import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { mountSearch } from '../../browser/search-ui.ts'

test('Escape discards search results from an in-flight request', async () => {
	const browser = new Window({ url: 'https://scanner.test/' })
	browser.document.body.innerHTML = '<form id="global-search"><input id="global-search-input" /></form><div id="global-search-results" hidden></div>'
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
	const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
	Object.defineProperty(globalThis, 'document', { configurable: true, value: browser.document })
	Object.defineProperty(globalThis, 'location', { configurable: true, value: browser.location })
	Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
	try {
		let completeSearch: ((value: unknown) => void) | undefined
		const pending = new Promise<unknown>(resolve => {
			completeSearch = resolve
		})
		mountSearch(
			async () => pending,
			() => '1',
		)
		const input = browser.document.querySelector('input')
		const form = browser.document.querySelector('form')
		const results = browser.document.querySelector('div')
		if (input === null || form === null || results === null || completeSearch === undefined) throw new Error('Search fixture is incomplete')
		input.value = 'block'
		input.focus()
		form.dispatchEvent(new browser.Event('submit', { bubbles: true, cancelable: true }))
		expect(results.hidden).toBe(false)
		expect(results.textContent).toBe('Searching…')
		expect(browser.document.activeElement).toBe(input)
		input.value = 'transaction'
		input.scrollLeft = 100
		input.dispatchEvent(new browser.Event('input', { bubbles: true }))
		completeSearch({ items: [{ type: 'block', label: 'Block #1', href: '/block/1?chainId=1' }] })
		await Bun.sleep(0)
		expect(results.querySelector('a')).toBeNull()
		browser.document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
		await Bun.sleep(0)
		expect(results.hidden).toBe(true)
		expect(results.childElementCount).toBe(0)
		expect(input.value).toBe('')
		expect(input.scrollLeft).toBe(0)
	} finally {
		if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
		else Object.defineProperty(globalThis, 'document', originalDocument)
		if (originalLocation === undefined) Reflect.deleteProperty(globalThis, 'location')
		else Object.defineProperty(globalThis, 'location', originalLocation)
		if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
		else Object.defineProperty(globalThis, 'window', originalWindow)
		await browser.happyDOM.close()
	}
})
