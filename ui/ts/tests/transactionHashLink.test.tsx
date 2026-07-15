/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { TransactionHashLink } from '../components/TransactionHashLink.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('TransactionHashLink', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreDomEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders the complete transaction hash', async () => {
		const hash = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const renderedComponent = await renderIntoDocument(<TransactionHashLink hash={hash} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const hashValue = document.body.querySelector('.transaction-hash-link')
		expect(hashValue?.textContent).toBe(hash)
	})
})
