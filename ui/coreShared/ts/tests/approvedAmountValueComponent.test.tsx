import * as commonCopy from '../copy/common.js'
/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { ApprovedAmountValue } from '../components/ApprovedAmountValue.js'

describe('ApprovedAmountValue', () => {
	const { trackRendered } = installDomTestLifecycle()

	test('renders the max label when approval exceeds max-display threshold', async () => {
		trackRendered(await renderIntoDocument(<ApprovedAmountValue value={2n ** 200n} requiredAmount={0n} suffix='REP' units={18} />))

		const documentQueries = within(document.body)
		const valueBadge = documentQueries.getByText(commonCopy.max)
		expect(valueBadge.textContent).toBe('Max')
		expect(valueBadge.className).toContain('approval-max')
		expect(documentQueries.queryByText(/^≈/)).toBeNull()
		expect(documentQueries.queryByText('—')).toBeNull()
	})

	test('renders currency output with tone class for sufficient amounts', async () => {
		trackRendered(await renderIntoDocument(<ApprovedAmountValue value={2n * 10n ** 18n} requiredAmount={1n} suffix='REP' units={18} />))

		const documentQueries = within(document.body)
		const currencyOutput = document.body.querySelector('.currency-value')
		if (currencyOutput === null) throw new Error('Expected currency value')

		expect(document.body.querySelector('button')).toBeNull()
		expect(currencyOutput.className).toContain('approval-sufficient')
		expect(documentQueries.getByText('2.00 REP')).not.toBeNull()
	})

	test('supports exact precision for a finite recovery approval', async () => {
		const amount = 2_020_000_000_000_000_001n
		trackRendered(await renderIntoDocument(<ApprovedAmountValue precision='exact' value={amount} requiredAmount={amount} suffix='REP' units={18} />))
		expect(document.body.querySelector('.currency-value')?.textContent).toBe('2.020000000000000001 REP')
		expect(document.body.querySelector('.approval-sufficient')).not.toBeNull()
	})

	test('renders placeholder while value is unavailable', async () => {
		trackRendered(await renderIntoDocument(<ApprovedAmountValue value={undefined} requiredAmount={1n} suffix='REP' units={18} />))

		expect(within(document.body).getByText('—')).not.toBeNull()
	})
})
