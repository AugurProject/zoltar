import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { PortfolioRepair } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioRepair.js'
import { capitalSnapshot, unit } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
test('voluntary repair keeps its action visible and rejects donations exceeding post-retirement active backing', async () => {
	const snapshot = capitalSnapshot()
	const source = capitalClient(snapshot)
	source.setRead('bookIds', 1n)
	source.setRead('totals', [10n * unit, 20n * unit, 0n, 1000n, false])
	source.setRead('eligibleActiveCommitment', 10n * unit)
	source.install()
	let submissions = 0
	const view = await renderIntoDocument(
		<PortfolioRepair
			snapshot={snapshot}
			actions={{
				scope: unscopedTransaction,
				busy: undefined,
				ownerReason: undefined,
				runPortfolioAction: async () => {
					submissions++
				},
			}}
		/>,
	)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('Cash shortfall: 10 ETH'))
	const input = view.container.querySelector('input')
	const button = view.container.querySelector('button')
	if (input === null || button === null) throw new Error('Donation controls missing')
	await act(() => {
		input.value = '1'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	expect(button.textContent).toContain('Donate settlement cash')
	expect(button.disabled).toBe(true)
	expect(view.container.textContent).toContain('Insufficient active backing after queued retirements')
	expect(view.container.textContent).toContain('no shares, REP or repayment claim')
	expect(submissions).toBe(0)
})
