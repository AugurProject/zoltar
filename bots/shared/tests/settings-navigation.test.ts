import { afterEach, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { settingsGroup, settingsIntro, settingsPage, settingsSection } from '../src/dashboard/settings-markup.ts'
import { createSettingsNavigation } from '../src/dashboard/settings-navigation.ts'

const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
let view: Window | undefined

function setup(width: number) {
	const current = new Window({ width, height: 900, url: 'http://localhost/settings' })
	view = current
	for (const name of ['window', 'document', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'HTMLDetailsElement', 'MutationObserver', 'ResizeObserver', 'getComputedStyle']) {
		previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
		Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? current : Reflect.get(current, name) })
	}
	current.document.body.innerHTML = settingsPage({
		intro: settingsIntro({ scopeText: 'Test profile' }),
		sections: ['connect', 'policy', 'advanced'].map(id => settingsSection({ id, title: id, collapsed: id === 'advanced', groups: settingsGroup({ title: id, summary: id, body: '<p>Settings</p>', open: id !== 'advanced' }) })).join(''),
		steps: ['connect', 'policy', 'advanced'].map(id => ({ id, label: id })),
	})
	createSettingsNavigation()
	return current
}

function click(id: string, options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number } = {}) {
	if (view === undefined) throw new Error('Missing window')
	const chip = view.document.querySelector(`a[data-settings-target="${id}"]`)
	if (chip === null) throw new Error('Missing settings link')
	return chip.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }))
}

function openSections() {
	return Array.from(document.querySelectorAll('.settings-section'))
		.filter(section => section.querySelector('details[open]') !== null)
		.map(section => section.id)
}

afterEach(async () => {
	await view?.happyDOM.close()
	view = undefined
	for (const [name, descriptor] of previousGlobals) {
		if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
		else Object.defineProperty(globalThis, name, descriptor)
	}
	previousGlobals.clear()
})

test('desktop Advanced link opens its panels without closing other sections', () => {
	setup(1440)
	expect(openSections()).toEqual(['connect', 'policy'])
	click('advanced')
	expect(openSections()).toEqual(['connect', 'policy', 'advanced'])
})

test('mobile navigation closes Advanced when another section is selected', () => {
	setup(390)
	click('advanced')
	expect(openSections()).toEqual(['advanced'])
	click('policy')
	expect(openSections()).toEqual(['policy'])
})

test('entering a narrow viewport collapses other sections and widening restores them', () => {
	const current = setup(1440)
	click('policy')
	current.happyDOM.setWindowSize({ width: 390, height: 844 })
	current.dispatchEvent(new current.Event('resize'))
	expect(openSections()).toEqual(['policy'])
	current.happyDOM.setWindowSize({ width: 1440, height: 900 })
	current.dispatchEvent(new current.Event('resize'))
	expect(openSections()).toEqual(['connect', 'policy'])
})

test('modified and non-primary clicks preserve browser link behavior', () => {
	setup(1440)
	for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
		expect(click('advanced', options)).toBe(true)
		expect(openSections()).toEqual(['connect', 'policy'])
	}
})
