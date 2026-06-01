/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getActiveNetworkProfile, installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { getGenesisReputationTokenAddress, formatUniverseCollectionLabel, formatUniverseLabel, getUniverseLinkHref, navigateToUniverse } from '../lib/universe.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'

void describe('universe helpers', () => {
	let cleanup: (() => void) | undefined

	beforeEach(() => {
		cleanup = installDomEnvironment('http://localhost/#/zoltar?universe=2&zoltarView=create').cleanup
	})

	afterEach(() => {
		cleanup?.()
		cleanup = undefined
		resetActiveEnvironmentForTesting()
	})

	test('renders genesis and non-genesis labels', () => {
		expect(formatUniverseLabel(0n)).toBe('Genesis (0)')
		expect(formatUniverseLabel(7n)).toBe('Universe 7')
	})

	test('builds collection labels for empty, single, and multiple ids', () => {
		expect(formatUniverseCollectionLabel([])).toBe('Genesis (0)')
		expect(formatUniverseCollectionLabel([3n])).toBe('Universe 3')
		expect(formatUniverseCollectionLabel([3n, 3n, 4n])).toBe('Multiple (3, 4)')
	})

	test('resolves the current universe link from route hash and query', () => {
		expect(getUniverseLinkHref(8n)).toBe('#/zoltar?universe=8&zoltarView=create')
	})

	test('does not dispatch navigation when universe stays the same', () => {
		navigateToUniverse(2n)
		expect(window.location.hash).toBe('#/zoltar?universe=2&zoltarView=create')
	})

	test('updates route hash query and dispatches popstate when universe changes', () => {
		;(globalThis as { PopStateEvent?: (typeof window.Event) | (typeof Event) }).PopStateEvent = window.PopStateEvent ?? window.Event
		let popstateFired = false
		window.addEventListener('popstate', () => {
			popstateFired = true
		})

		navigateToUniverse(9n)
		expect(window.location.hash).toBe('#/zoltar?universe=9&zoltarView=create')
		expect(popstateFired).toBe(true)
	})

	test('reads genesis REP address from the active network profile', () => {
		const fakeProfile = createFakeSimulationProfile()
		const resetEnvironment = installActiveEnvironmentForTesting(
			createFakeBackend({
				accountAddress: '0x0000000000000000000000000000000000000001',
				profile: fakeProfile,
			}),
		)
		expect(getActiveNetworkProfile().chainIdHex).toBe(fakeProfile.chainIdHex)
		expect(getGenesisReputationTokenAddress()).toBe(fakeProfile.genesisRepTokenAddress)
		resetEnvironment()
	})
})
