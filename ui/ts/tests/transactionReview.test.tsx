/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { TransactionReview } from '../components/TransactionReview.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { within } from './testUtils/queries'

describe('TransactionReview', () => {
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

	test('keeps decision data without a generic instruction', async () => {
		const renderedComponent = await renderIntoDocument(<TransactionReview primary={[{ label: 'You Pay', value: '1 ETH' }]} risks={['Funds remain locked until settlement.']} technicalDetails={[{ label: 'Network', value: 'Ethereum Mainnet' }]} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const reviewHeading = within(document.body).getByRole('heading', { name: 'Transaction Review' })
		const review = reviewHeading.closest('.transaction-review')
		if (!(review instanceof HTMLElement)) throw new Error('Expected a transaction review')
		expect(review.querySelector('.transaction-review-header .detail')).toBeNull()
		expect(review.textContent).toContain('1 ETH')
		expect(review.textContent).toContain('Funds remain locked until settlement.')
		const technicalDetailsSummary = within(review).getByText('Technical Details', { selector: 'summary' })
		const technicalDetails = technicalDetailsSummary.closest('details')
		if (!(technicalDetails instanceof HTMLElement)) throw new Error('Expected technical details disclosure')
		expect(technicalDetails.hasAttribute('open')).toBe(false)
		expect(technicalDetails.textContent).toContain('Ethereum Mainnet')
	})
})
