/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { ApprovedAmountValue, APPROVAL_MAX_DISPLAY_THRESHOLD, APPROVAL_MAX_LABEL } from '../components/ApprovedAmountValue.js'

describe('ApprovedAmountValue', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders the max label when approval exceeds max-display threshold', async () => {
		const renderedComponent = await renderIntoDocument(<ApprovedAmountValue value={APPROVAL_MAX_DISPLAY_THRESHOLD + 1n} requiredAmount={0n} suffix='REP' units={18} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const valueBadge = documentQueries.getByText(APPROVAL_MAX_LABEL)
		expect(valueBadge.textContent).toBe('Max')
		expect(valueBadge.className).toContain('approval-max')
		expect(documentQueries.queryByText(/^≈/)).toBeNull()
		expect(documentQueries.queryByText('—')).toBeNull()
	})

	test('renders currency output with tone class for sufficient amounts', async () => {
		const renderedComponent = await renderIntoDocument(<ApprovedAmountValue value={2n * 10n ** 18n} requiredAmount={1n} suffix='REP' units={18} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const currencyOutput = document.body.querySelector('button[type="button"]')
		if (currencyOutput === null) throw new Error('Expected currency value button')

		expect(currencyOutput.className).toContain('approval-sufficient')
		expect(documentQueries.getByText(/≈ 2\.00 REP/)).not.toBeNull()
	})

	test('renders placeholder while value is unavailable', async () => {
		const renderedComponent = await renderIntoDocument(<ApprovedAmountValue value={undefined} requiredAmount={1n} suffix='REP' units={18} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('—')).not.toBeNull()
	})
})
