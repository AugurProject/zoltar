/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { Badge } from '../components/Badge.js'
import { MetricGrid } from '../components/MetricGrid.js'
import { TransactionStatusCard } from '../components/TransactionStatusCard.js'

describe('TransactionStatusCard', () => {
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

	test('renders title, badge, and detail', async () => {
		const renderedComponent = await renderIntoDocument(<TransactionStatusCard title='Liquidation Submitted' badge={<Badge tone='warning'>Check State</Badge>} detail='Refresh staged operations.' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Submitted' })).not.toBeNull()
		expect(documentQueries.getByText('Check State')).not.toBeNull()
		expect(documentQueries.getByText('Refresh staged operations.')).not.toBeNull()
	})

	test('renders metrics when provided', async () => {
		const renderedComponent = await renderIntoDocument(
			<TransactionStatusCard
				title='REP Withdrawal Queued'
				badge={<Badge tone='warning'>Queued</Badge>}
				metrics={
					<MetricGrid>
						<div>Staged Operation</div>
						<div>#7</div>
					</MetricGrid>
				}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Staged Operation')).not.toBeNull()
		expect(documentQueries.getByText('#7')).not.toBeNull()
	})

	test('renders follow-up actions when provided', async () => {
		const renderedComponent = await renderIntoDocument(
			<TransactionStatusCard
				title='Bond Allowance Queued'
				badge={<Badge tone='warning'>Queued</Badge>}
				actions={
					<button className='secondary' type='button'>
						View In Staged Operations
					</button>
				}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'View In Staged Operations' })).not.toBeNull()
	})

	test('uses a flat surface when composed inside a dialog or workflow card', async () => {
		const renderedComponent = await renderIntoDocument(<TransactionStatusCard badge={<Badge tone='warning'>Check State</Badge>} surface='flat' title='Liquidation Submitted' detail='Refresh staged operations.' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.transaction-status-card.flat')).not.toBeNull()
	})
})
