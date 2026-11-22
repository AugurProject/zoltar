/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from 'bun:test'
import { getBuiltInScenarioLocation, hasSavedSimulationStateRoute } from '../../simulation/scenarioNavigation.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { installTestRouting } from '../testUtils/testRouting.js'

describe('simulation scenario navigation', () => {
	let cleanup: (() => void) | undefined

	afterEach(() => {
		cleanup?.()
		cleanup = undefined
	})

	test.each(['http://localhost/?simulate=1&simState=broken-save#/open-oracle', 'http://localhost/#/open-oracle?simulate=1&simState=broken-save'])('finds a saved-state selection in either URL form: %s', url => {
		const uninstallRouting = installTestRouting()
		const dom = installDomEnvironment(url)
		cleanup = () => {
			dom.cleanup()
			uninstallRouting()
		}

		expect(hasSavedSimulationStateRoute()).toBe(true)
		const next = new URL(getBuiltInScenarioLocation('baseline'))
		expect(next.searchParams.has('simState')).toBe(false)
		expect(next.hash).not.toContain('simState')
	})

	test('reports no saved state when neither URL form selects one', () => {
		const uninstallRouting = installTestRouting()
		const dom = installDomEnvironment('http://localhost/?simulate=1#/open-oracle?simScenario=baseline')
		cleanup = () => {
			dom.cleanup()
			uninstallRouting()
		}

		expect(hasSavedSimulationStateRoute()).toBe(false)
	})
})
