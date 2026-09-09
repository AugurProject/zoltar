import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { renderOperatorHeader } from '../src/dashboard/header.ts'

const script = await Bun.build({ entrypoints: [new URL('../src/dashboard/header-notices.ts', import.meta.url).pathname], target: 'browser', format: 'iife' })
const output = script.outputs[0]
if (!script.success || output === undefined) throw new Error('Could not build header notices')
const source = await output.text()

test('counts active errors and warnings while preserving all notices and collapsed state', async () => {
	const window = new Window({ settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, suppressInsecureJavaScriptEnvironmentWarning: true } })
	try {
		window.document.write(renderOperatorHeader({ title: 'Bot', eyebrow: 'Operator', blockStatus: 'Block 1', safety: '', navigation: '', notices: '<div id="global-error" class="notice error hidden"></div><ul id="operator-alerts"></ul><section class="notice" data-tone="info">Dry-run mode</section>' }))
		window.eval(source)
		const disclosure = window.document.querySelector('details')
		const count = window.document.getElementById('header-notices-count')
		const alerts = window.document.getElementById('operator-alerts')
		const empty = window.document.getElementById('header-notices-empty')
		if (disclosure === null || alerts === null || !(empty instanceof window.HTMLElement)) throw new Error('Missing notice fixture')
		expect(count?.textContent).toBe('0')
		expect(disclosure.open).toBe(false)
		for (let index = 0; index < 100; index++) {
			const item = window.document.createElement('li')
			item.className = `notice ${index % 2 === 0 ? 'error' : 'warning'}`
			item.textContent = `Failure ${index.toString()}`
			alerts.append(item)
		}
		await window.happyDOM.waitUntilComplete()
		expect(count?.textContent).toBe('100')
		expect(disclosure.classList.contains('has-errors')).toBe(true)
		expect(disclosure.open).toBe(false)
		disclosure.open = true
		alerts.firstElementChild?.classList.add('hidden')
		await window.happyDOM.waitUntilComplete()
		expect(count?.textContent).toBe('99')
		expect(disclosure.open).toBe(true)
		alerts.classList.add('hidden')
		await window.happyDOM.waitUntilComplete()
		expect(count?.textContent).toBe('0')
		expect(disclosure.classList.contains('has-errors')).toBe(false)
		window.dispatchEvent(new window.PageTransitionEvent('pagehide'))
		alerts.classList.remove('hidden')
		await window.happyDOM.waitUntilComplete()
		expect(count?.textContent).toBe('0')
		window.dispatchEvent(new window.PageTransitionEvent('pageshow'))
		expect(count?.textContent).toBe('99')
		alerts.classList.add('hidden')
		await window.happyDOM.waitUntilComplete()
		expect(empty.hidden).toBe(true)
		window.document.querySelector('[data-tone="info"]')?.remove()
		await window.happyDOM.waitUntilComplete()
		expect(empty.hidden).toBe(false)
	} finally {
		await window.happyDOM.close()
	}
})

test('dismisses the list, restores keyboard focus, and reveals linked notices', async () => {
	const window = new Window({ url: 'http://localhost/overview#notice', settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, suppressInsecureJavaScriptEnvironmentWarning: true } })
	try {
		window.document.write(renderOperatorHeader({ title: 'Bot', eyebrow: 'Operator', blockStatus: 'Block 1', safety: '', navigation: '', notices: '<section id="notice" class="notice" data-tone="danger">Scan failed <a href="/settings">Settings</a></section>' }))
		window.eval(source)
		const disclosure = window.document.querySelector('details')
		const toggle = window.document.getElementById('header-notices-toggle')
		const close = window.document.getElementById('header-notices-close')
		if (disclosure === null || !(toggle instanceof window.HTMLElement) || !(close instanceof window.HTMLButtonElement)) throw new Error('Missing notice fixture')
		expect(disclosure.open).toBe(true)
		window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
		expect(disclosure.open).toBe(false)
		expect(window.document.activeElement).toBe(toggle)
		disclosure.open = true
		close.click()
		expect(disclosure.open).toBe(false)
		expect(window.document.activeElement).toBe(toggle)
		disclosure.open = true
		window.document.body.click()
		expect(disclosure.open).toBe(false)
		window.dispatchEvent(new window.HashChangeEvent('hashchange'))
		expect(disclosure.open).toBe(true)
		window.document.querySelector('#notice a')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
		expect(disclosure.open).toBe(false)
	} finally {
		await window.happyDOM.close()
	}
})
