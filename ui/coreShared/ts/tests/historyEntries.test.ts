/// <reference types='bun-types' />

import { afterEach, describe, expect, test } from 'bun:test'
import { isHistoryTraversal, navigateToUrl, pushHistoryUrl, redirectInPlace, replaceHistoryUrl, subscribeToLocationChanges } from '../navigation/historyEntries.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'

async function goBack() {
	const popped = new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }))
	window.history.back()
	await popped
}

describe('history entries', () => {
	installDomTestLifecycle({ url: 'http://localhost/#/pools' })
	let unsubscribe: (() => void) | undefined

	afterEach(() => {
		unsubscribe?.()
		unsubscribe = undefined
	})

	test('reports Back as a traversal and a later navigation as a new page', async () => {
		unsubscribe = subscribeToLocationChanges(() => undefined)
		pushHistoryUrl('#/open-oracle')
		expect(isHistoryTraversal()).toBe(false)

		await goBack()
		expect(window.location.hash).toBe('#/pools')
		expect(isHistoryTraversal()).toBe(true)

		// Normalizing the reached URL keeps the entry, so it is still the page Back reached.
		replaceHistoryUrl('#/pools?universe=7')
		expect(isHistoryTraversal()).toBe(true)

		pushHistoryUrl('#/deploy')
		expect(isHistoryTraversal()).toBe(false)
	})

	test('treats popstate from a link or hash navigation as a new page, not a traversal', () => {
		unsubscribe = subscribeToLocationChanges(() => undefined)
		// A fragment navigation opens an entry without state and fires popstate, exactly like Back would.
		window.history.pushState(null, '', '#/open-oracle')
		window.dispatchEvent(new Event('popstate'))
		expect(isHistoryTraversal()).toBe(false)

		window.history.pushState(null, '', '#/deploy')
		window.dispatchEvent(new Event('popstate'))
		expect(isHistoryTraversal()).toBe(false)
	})

	test('notifies every subscriber within one location change', () => {
		const notifications: string[] = []
		const unsubscribeFirst = subscribeToLocationChanges(() => notifications.push(`first ${window.location.hash}`))
		const unsubscribeSecond = subscribeToLocationChanges(() => notifications.push(`second ${window.location.hash}`))
		unsubscribe = () => {
			unsubscribeFirst()
			unsubscribeSecond()
		}
		navigateToUrl('#/open-oracle')
		expect(notifications).toEqual(['first #/open-oracle', 'second #/open-oracle'])
	})

	test('adds no entry for the current URL and one entry for a new URL', () => {
		const lengthBefore = window.history.length
		navigateToUrl('#/pools')
		expect(window.history.length).toBe(lengthBefore)
		navigateToUrl('#/open-oracle')
		expect(window.history.length).toBe(lengthBefore + 1)
		expect(window.location.hash).toBe('#/open-oracle')
	})

	test('replaces the current entry for a navigation made during a redirect', () => {
		const lengthBefore = window.history.length
		redirectInPlace(() => navigateToUrl('#/deploy'))
		expect(window.location.hash).toBe('#/deploy')
		expect(window.history.length).toBe(lengthBefore)
		// Only the redirect itself replaces; a later navigation adds an entry again.
		navigateToUrl('#/pools')
		expect(window.history.length).toBe(lengthBefore + 1)
	})
})
