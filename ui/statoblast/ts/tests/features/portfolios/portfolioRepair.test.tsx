import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { PortfolioRepair } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioRepair.js'
import { capitalSnapshot, unit } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })

function expectFundingStatus(container: HTMLElement, message: string) {
	expect(container.textContent?.split(message).length).toBe(2)
	const donation = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Donate settlement cash'))
	if (donation === undefined) throw new Error('Donation control missing')
	const description = donation
		.getAttribute('aria-describedby')
		?.split(' ')
		.map(id => document.getElementById(id)?.textContent)
		.join(' ')
	expect(description).toContain(message)
}
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
			loading={false}
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

test('automatic repair funding reads show checking until completion and replace loading with a read failure', async () => {
	const snapshot = capitalSnapshot()
	const source = capitalClient(snapshot)
	const totals = createDeferred<readonly bigint[]>()
	source.setRead('bookIds', 1n)
	source.setRead('totals', totals.promise)
	source.install()
	const view = await renderIntoDocument(<PortfolioRepair snapshot={snapshot} loading={false} actions={{ scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(source.reads.some(read => read.name === 'totals')).toBe(true))
	const button = view.container.querySelector('button')
	if (button === null) throw new Error('Donation control missing')
	expect(button.disabled).toBe(true)
	expectFundingStatus(view.container, 'Checking settlement funding…')
	await act(() => totals.reject(new Error('Settlement read unavailable')))
	await waitFor(() => expectFundingStatus(view.container, 'Settlement read unavailable'))
	expect(view.container.textContent).not.toContain('Checking settlement funding…')
	expect(button.disabled).toBe(true)
	source.setRead('totals', [10n * unit, 10n * unit, 0n, 1000n, false])
	source.setRead('eligibleActiveCommitment', 10n * unit)
	const retry = [...view.container.querySelectorAll('button')].find(candidate => candidate.textContent === 'Retry')
	if (retry === undefined) throw new Error('Funding retry missing')
	await act(() => retry.click())
	await waitFor(() => expectFundingStatus(view.container, 'Settlement is already fully funded.'))
	expect(view.container.querySelector('input')).not.toBeNull()
	expect(button.disabled).toBe(true)
})

test('missing accounts and inactive universes explain repair availability without starting funding reads', async () => {
	const source = capitalClient()
	source.install()
	const actions = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioRepair snapshot={undefined} loading={false} actions={actions} />)
	lifecycle.trackRendered(view)
	expectFundingStatus(view.container, 'Settlement funding is available after a portfolio account loads.')
	await act(() => render(<PortfolioRepair snapshot={undefined} loading={true} actions={actions} />, view.container))
	expectFundingStatus(view.container, 'Checking settlement funding…')
	await act(() => render(<PortfolioRepair snapshot={capitalSnapshot({ forkTime: 1n })} loading={false} actions={actions} />, view.container))
	expectFundingStatus(view.container, 'Settlement repair is available in active, unforked universes.')
	expect(view.container.querySelector('button')?.disabled).toBe(true)
	expect(source.reads.some(read => read.name === 'bookIds')).toBe(false)
})
