import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { createSectionNavigation } from '../src/dashboard/section-navigation.ts'

function currentLinks(window: Window) {
	return [...window.document.querySelectorAll('.section-nav a')].filter(link => link.hasAttribute('aria-current')).map(link => [link.getAttribute('href'), link.getAttribute('aria-current')])
}

function clickLink(window: Window, href: string) {
	const link = window.document.querySelector(`.section-nav a[href="${href}"]`)
	if (link === null) throw new Error(`Missing ${href} link`)
	link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0, cancelable: true }))
}

test('in-page navigation marks the active section link with aria-current="page"', () => {
	const window = new Window({ url: 'http://127.0.0.1/settings' })
	const globalNames = ['document', 'window', 'HTMLAnchorElement', 'HTMLElement', 'HTMLDetailsElement', 'MutationObserver', 'ResizeObserver'] as const
	const previousGlobals = globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
	for (const name of globalNames) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : Reflect.get(window, name) })
	try {
		window.document.body.innerHTML = '<header class="operator-shell"><nav class="section-nav"><a href="/overview">Overview</a><a href="/ecosystem">Ecosystem</a><a href="/settings">Settings</a></nav></header>'
		createSectionNavigation()
		expect(currentLinks(window)).toEqual([['/settings', 'page']])

		clickLink(window, '/ecosystem')
		expect(window.document.body.dataset['page']).toBe('ecosystem')
		expect(currentLinks(window)).toEqual([['/ecosystem', 'page']])

		clickLink(window, '/settings')
		expect(window.document.body.dataset['page']).toBe('settings')
		expect(currentLinks(window)).toEqual([['/settings', 'page']])
	} finally {
		for (const [name, descriptor] of previousGlobals) {
			if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
			else Object.defineProperty(globalThis, name, descriptor)
		}
		void window.happyDOM.close()
	}
})
