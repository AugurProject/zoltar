/// <reference types='bun-types' />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
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
})
