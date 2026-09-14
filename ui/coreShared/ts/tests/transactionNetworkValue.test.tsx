/// <reference types='bun-types' />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { TransactionNetworkValue } from '../components/TransactionNetworkValue.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'
import { within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('TransactionNetworkValue', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			resetActiveEnvironmentForTesting()
		},
	})

	test('renders the active public network', async () => {
		installActiveEnvironmentForTesting(createFakeBackend())
		const renderedComponent = await renderIntoDocument(<TransactionNetworkValue />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('Ethereum Mainnet')).not.toBeNull()
	})

	test('makes the local simulation profile explicit', async () => {
		installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		const renderedComponent = await renderIntoDocument(<TransactionNetworkValue />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('Browser Simulation · local sandbox')).not.toBeNull()
	})
})
