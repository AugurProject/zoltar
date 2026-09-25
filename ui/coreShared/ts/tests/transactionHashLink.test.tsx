/// <reference types='bun-types' />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { installActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { createInjectedBackend } from '../wallet/chainBackend.js'
import { createSimulationProfile } from '../wallet/networkProfile.js'
import { TransactionHashLink } from '../components/TransactionHashLink.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('TransactionHashLink', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('renders the complete transaction hash', async () => {
		const hash = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const renderedComponent = await renderIntoDocument(<TransactionHashLink hash={hash} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const hashValue = document.body.querySelector('.transaction-hash-link')
		expect(hashValue?.textContent).toBe(hash)
	})
	test('shows the full local hash without an external link when no explorer exists', async () => {
		const address = '0x0000000000000000000000000000000000000001'
		const restore = installActiveEnvironmentForTesting(createInjectedBackend({ profile: createSimulationProfile({ genesisRepTokenAddress: address, wethAddress: address }) }))
		try {
			const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12'
			const rendered = await renderIntoDocument(<TransactionHashLink hash={hash} />)
			cleanupRenderedComponent = rendered.cleanup
			expect(rendered.container.textContent).toBe(hash)
			expect(rendered.container.querySelector('a')).toBeNull()
		} finally {
			restore()
		}
	})
})
