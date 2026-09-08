import * as commonCopy from '../copy/common.js'
/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { maxUint200 } from '../transactions/tokenApproval.js'
import { ApprovedAmountValue } from '../components/ApprovedAmountValue.js'

describe('ApprovedAmountValue', () => {
	const { trackRendered } = installDomTestLifecycle()

	test('renders the max label when approval exceeds max-display threshold', async () => {
		trackRendered(await renderIntoDocument(<ApprovedAmountValue value={maxUint200 + 1n} requiredAmount={0n} suffix='REP' units={18} />))

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
		const currencyOutput = document.body.querySelector('button[type="button"]')
		if (currencyOutput === null) throw new Error('Expected currency value button')

		expect(currencyOutput.className).toContain('approval-sufficient')
		expect(documentQueries.getByText(/≈ 2\.00 REP/)).not.toBeNull()
	})

	test('renders placeholder while value is unavailable', async () => {
		trackRendered(await renderIntoDocument(<ApprovedAmountValue value={undefined} requiredAmount={1n} suffix='REP' units={18} />))

		expect(within(document.body).getByText('—')).not.toBeNull()
	})
})
