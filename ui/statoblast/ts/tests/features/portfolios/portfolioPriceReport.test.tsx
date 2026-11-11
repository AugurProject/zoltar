import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { PortfolioPriceReport } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioPriceReport.js'
import type { PortfolioPriceParameters } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioPrice.js'
import { priceFixture, priceOracle } from './priceFixture.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
test('branch report keeps preparation, wrap, editable approvals and recovery controls visible in fixed order', async () => {
	const fixture = priceFixture()
	const fork = await fixture.fork()
	const actions: PortfolioPriceParameters['actions'] = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioPriceReport fork={undefined} actions={actions} />)
	lifecycle.trackRendered(view)
	const labels = () => Array.from(view.container.querySelectorAll('button')).map(button => button.textContent ?? '')
	const initial = labels()
	const originalButtons = Array.from(view.container.querySelectorAll('button'))
	for (const name of ['Prepare price feed', 'Approve Collateral', 'Approve REP', 'Request branch price', 'Settle price report', 'Recover settled report', 'Return released funding']) expect(initial.some(label => label.includes(name))).toBe(true)
	expect(Array.from(view.container.querySelectorAll('button')).filter(button => !button.disabled)).toHaveLength(0)
	await act(() => render(<PortfolioPriceReport fork={fork} actions={actions} />, view.container))
	await waitFor(() => expect(view.container.textContent).toContain('already prepared'))
	const normalize = (values: string[]) => values.map(value => (value.includes('Approve') && !value.includes('REP') ? 'Approve collateral' : value))
	expect(normalize(labels().filter(label => !label.includes('Wrap ETH for report')))).toEqual(normalize(initial))
	expect(view.container.querySelectorAll('.card .card')).toHaveLength(0)
	const input = Array.from(view.container.querySelectorAll('input')).find(input => input.closest('.field')?.querySelector('label')?.textContent?.includes('Proposed price'))
	if (input === undefined) throw new Error('Missing proposed price input')
	await act(() => {
		input.value = '2'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await waitFor(() => expect(Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Wrap ETH for report')?.disabled).toBe(false))
	for (const button of Array.from(view.container.querySelectorAll('button'))) expect(button.textContent === 'Wrap ETH for report' || originalButtons.includes(button)).toBe(true)
	const requestButton = Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Request branch price')
	expect(requestButton?.disabled).toBe(true)
	expect(view.container.textContent).toContain('Insufficient collateral to fund the report.')
	await act(() => render(<PortfolioPriceReport fork={fork} actions={{ ...actions, busy: 'wrapPortfolioPrice' }} />, view.container))
	expect(view.container.textContent).toContain('Wrapping ETH…')
	expect(view.container.querySelectorAll('button').length).toBe(initial.length + 1)
})

test('an unreported feed has no accepted price until its first accepted settlement', async () => {
	const fixture = priceFixture()
	fixture.values['lastPrice'] = 0n
	fixture.values['lastSettlementTimestamp'] = 0n
	const fork = await fixture.fork()
	const actions: PortfolioPriceParameters['actions'] = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioPriceReport fork={fork} actions={actions} />)
	lifecycle.trackRendered(view)
	const acceptedPrice = () =>
		Array.from(view.container.querySelectorAll('.metric-label'))
			.find(label => label.textContent === 'Last accepted price (REP per collateral token)')
			?.parentElement?.querySelector('.metric-field-value')?.textContent
	await waitFor(() => expect(view.container.textContent).toContain('already prepared'))
	expect(acceptedPrice()).toBe('—')
	fixture.values['lastPrice'] = 3n * 10n ** 18n
	fixture.values['lastSettlementTimestamp'] = 900n
	const refresh = Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Refresh report status')
	if (refresh === undefined) throw new Error('Missing report refresh button')
	await act(() => refresh.click())
	await waitFor(() => expect(acceptedPrice()).toBe('3.00'))
})

test('six-decimal reports label released collateral accurately and omit native wrapping', async () => {
	const fixture = priceFixture()
	fixture.values['collateralToken'] = MAINNET_NETWORK_PROFILE.usdcAddress
	fixture.values['minimumToken1ReportAttoEth'] = 2_000_000n
	fixture.values['lastPrice'] = 10n ** 30n
	fixture.values['pendingReportId'] = 9n
	fixture.game.token1 = MAINNET_NETWORK_PROFILE.usdcAddress
	fixture.game.currentAmount1 = 2_000_000n
	fixture.set(priceOracle, 'tokenHolder', 2_000_001n)
	const fork = await fixture.fork()
	const actions: PortfolioPriceParameters['actions'] = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioPriceReport fork={fork} actions={actions} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('Released USDC'))
	const credit = Array.from(view.container.querySelectorAll('.metric-label')).find(label => label.textContent === 'Released USDC')?.parentElement
	await waitFor(() => expect(credit?.textContent).toContain('2.00 USDC'))
	expect(view.container.textContent).not.toContain('ETH to wrap')
	expect(view.container.textContent).not.toContain('Wrap ETH for report')
	expect(view.container.textContent).not.toContain('Released WETH')
})
