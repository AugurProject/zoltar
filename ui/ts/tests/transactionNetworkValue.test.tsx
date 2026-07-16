/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { TransactionNetworkValue } from '../components/TransactionNetworkValue.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { within } from './testUtils/queries.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('TransactionNetworkValue', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		resetActiveEnvironmentForTesting()
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
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
