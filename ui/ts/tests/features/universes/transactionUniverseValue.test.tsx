/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { TransactionUniverseValue } from '../../../features/universes/components/TransactionUniverseValue.js'
import { within } from '../../testUtils/queries.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

describe('TransactionUniverseValue', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

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

	test('renders user-facing genesis and child-universe labels', async () => {
		const renderedComponent = await renderIntoDocument(
			<div>
				<span>
					<TransactionUniverseValue universeId={0n} />
				</span>
				<span>
					<TransactionUniverseValue universeId={7n} />
				</span>
			</div>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Genesis (0x0)')).not.toBeNull()
		expect(documentQueries.getByText('Universe 0x7')).not.toBeNull()
	})
})
