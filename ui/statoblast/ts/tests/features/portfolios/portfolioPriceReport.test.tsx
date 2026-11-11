import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { PortfolioPriceReport } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioPriceReport.js'
import { accountPriceTarget, branchPriceTarget, type PortfolioPriceParameters } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioPrice.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/portfolioPrice.js'
import { capitalSnapshot, owner } from './capitalFixture.js'
import { priceFeed, priceFixture } from './priceFixture.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
test('branch report keeps preparation, wrap, editable approvals and recovery controls visible in fixed order', async () => {
	const fixture = priceFixture()
	const fork = await fixture.fork()
	const actions: PortfolioPriceParameters['actions'] = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioPriceReport scope='branch' target={undefined} actions={actions} />)
	lifecycle.trackRendered(view)
	const labels = () => Array.from(view.container.querySelectorAll('button')).map(button => button.textContent ?? '')
	const initial = labels()
	const originalButtons = Array.from(view.container.querySelectorAll('button'))
	for (const name of ['Prepare price feed', 'Wrap ETH for report', 'Approve WETH', 'Approve REP', 'Request branch price', 'Settle price report', 'Recover settled report', 'Return released funding']) expect(initial.some(label => label.includes(name))).toBe(true)
	expect(Array.from(view.container.querySelectorAll('button')).filter(button => !button.disabled)).toHaveLength(0)
	await act(() => render(<PortfolioPriceReport scope='branch' target={branchPriceTarget(fork)} actions={actions} />, view.container))
	await waitFor(() => expect(view.container.textContent).toContain('already prepared'))
	expect(labels()).toEqual(initial)
	expect(view.container.querySelectorAll('.card .card')).toHaveLength(0)
	const input = Array.from(view.container.querySelectorAll('input')).find(input => input.closest('.field')?.querySelector('label')?.textContent?.includes('Proposed price'))
	if (input === undefined) throw new Error('Missing proposed price input')
	await act(() => {
		input.value = '2'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await waitFor(() => expect(Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Wrap ETH for report')?.disabled).toBe(false))
	for (const [index, button] of Array.from(view.container.querySelectorAll('button')).entries()) expect(button === originalButtons[index]).toBe(true)
	const requestButton = Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Request branch price')
	expect(requestButton?.disabled).toBe(true)
	expect(view.container.textContent).toContain('Wrap the required ETH')
	await act(() => render(<PortfolioPriceReport scope='branch' target={branchPriceTarget(fork)} actions={{ ...actions, busy: 'wrapPortfolioPrice' }} />, view.container))
	expect(view.container.textContent).toContain('Wrapping ETH…')
	expect(view.container.querySelectorAll('button').length).toBe(initial.length)
})

test('an unreported feed has no accepted price until its first accepted settlement', async () => {
	const fixture = priceFixture()
	fixture.values['lastPrice'] = 0n
	fixture.values['lastSettlementTimestamp'] = 0n
	const fork = await fixture.fork()
	const actions: PortfolioPriceParameters['actions'] = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioPriceReport scope='branch' target={branchPriceTarget(fork)} actions={actions} />)
	lifecycle.trackRendered(view)
	const acceptedPrice = () =>
		Array.from(view.container.querySelectorAll('.metric-label'))
			.find(label => label.textContent === 'Last accepted price (REP per ETH)')
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

async function renderReportWithPrice(fixture: ReturnType<typeof priceFixture>, price: string, referencePrice?: bigint) {
	const fork = await fixture.fork()
	const actions: PortfolioPriceParameters['actions'] = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioPriceReport scope='branch' target={branchPriceTarget(fork)} actions={actions} referencePrice={referencePrice} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('already prepared'))
	const input = Array.from(view.container.querySelectorAll('input')).find(input => input.closest('.field')?.querySelector('label')?.textContent?.includes('Proposed price'))
	if (input === undefined) throw new Error('Missing proposed price input')
	await act(() => {
		input.value = price
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	return view
}

test('a price far from the feed price warns before any funds move and leaves the request available', async () => {
	const fixture = priceFixture()
	fixture.values['lastPrice'] = 300n * 10n ** 18n
	fixture.values['lastSettlementTimestamp'] = 1n
	const view = await renderReportWithPrice(fixture, '0.0033')
	await waitFor(() => expect(view.container.textContent?.replaceAll('\u00a0', ' ')).toContain('This looks inverted (ETH per REP). Enter REP per ETH; the last accepted price is 300.00 REP per ETH.'))
	expect(view.container.querySelector('.initial-price-input [aria-live="polite"]')?.textContent).toContain('looks inverted')
	const describedBy = view.container.querySelector('.initial-price-input input')?.getAttribute('aria-describedby') ?? ''
	expect(
		describedBy
			.split(' ')
			.map(id => document.getElementById(id)?.textContent ?? '')
			.join(' '),
	).toContain('looks inverted')
	expect(Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Wrap ETH for report')?.disabled).toBe(false)
})

test('a new branch feed compares against the portfolio price until it has its own', async () => {
	const fixture = priceFixture()
	fixture.values['lastPrice'] = 0n
	fixture.values['lastSettlementTimestamp'] = 0n
	const view = await renderReportWithPrice(fixture, '3000', 300n * 10n ** 18n)
	await waitFor(() => expect(view.container.textContent?.replaceAll('\u00a0', ' ')).toContain('More than double the last accepted price of 300.00 REP per ETH.'))
})

test('a price with no reference to compare against shows no warning', async () => {
	const fixture = priceFixture()
	fixture.values['lastPrice'] = 0n
	fixture.values['lastSettlementTimestamp'] = 0n
	const view = await renderReportWithPrice(fixture, '3000')
	expect(view.container.textContent).not.toContain('last accepted price of')
})

test('a branch reload keeps comparing against the feed price, never the portfolio price', async () => {
	const fixture = priceFixture()
	fixture.values['lastPrice'] = 900n * 10n ** 18n
	fixture.values['lastSettlementTimestamp'] = 1n
	const fork = await fixture.fork()
	const actions: PortfolioPriceParameters['actions'] = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }
	const referencePrice = 300n * 10n ** 18n
	const view = await renderIntoDocument(<PortfolioPriceReport scope='branch' target={branchPriceTarget(fork)} actions={actions} referencePrice={referencePrice} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('already prepared'))
	const input = Array.from(view.container.querySelectorAll('input')).find(input => input.closest('.field')?.querySelector('label')?.textContent?.includes('Proposed price'))
	if (input === undefined) throw new Error('Missing proposed price input')
	const propose = async (price: string) => {
		await act(() => {
			input.value = price
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}
	const warning = () => view.container.querySelector('.initial-price-input [aria-live="polite"]')?.textContent?.replaceAll('\u00a0', ' ')
	// 850 is fine against the feed but more than double the portfolio price.
	await propose('850')
	expect(warning()).toBe('')
	await act(() => render(<PortfolioPriceReport scope='branch' target={undefined} actions={actions} referencePrice={referencePrice} />, view.container))
	expect(warning()).toBe('')
	await act(() => render(<PortfolioPriceReport scope='branch' target={branchPriceTarget(fork)} actions={actions} referencePrice={referencePrice} />, view.container))
	await waitFor(() => expect(view.container.textContent).toContain('already prepared'))
	// 3000 warns against the feed, and that warning must survive the reload unchanged.
	await propose('3000')
	const feedWarning = 'More than double the last accepted price of 900.00 REP per ETH. Check the price before sending.'
	expect(warning()).toBe(feedWarning)
	await act(() => render(<PortfolioPriceReport scope='branch' target={undefined} actions={actions} referencePrice={referencePrice} />, view.container))
	expect(warning()).toBe(feedWarning)
})

test('the universe report has no feed preparation, branch deadline or branch wording', async () => {
	const fixture = priceFixture()
	fixture.set(priceFeed, 'universeId', 0n)
	const actions: PortfolioPriceParameters['actions'] = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(<PortfolioPriceReport scope='universe' target={accountPriceTarget(capitalSnapshot())} actions={actions} bidder={owner} />)
	lifecycle.trackRendered(view)
	// The funding guard replaces the loading reason once the feed has loaded.
	await waitFor(() => expect(view.container.textContent).toContain(copy.priceInvalid))
	// The Shared backing disclosure names the universe report, so it has no heading of its own.
	expect(view.container.querySelector('h4') === null).toBe(true)
	const labels = Array.from(view.container.querySelectorAll('button')).map(button => button.textContent ?? '')
	expect(labels).toContain(copy.scopes.universe.request)
	expect(labels).not.toContain(copy.prepare)
	const metrics = Array.from(view.container.querySelectorAll('.metric-label')).map(label => label.textContent)
	expect(metrics).toContain(copy.currentPrice)
	expect(metrics).not.toContain(copy.reportingDeadline)
	expect(metrics).not.toContain(copy.validUntil)
	expect(view.container.textContent).not.toMatch(/branch/i)
})

test('a pending universe request leaves the branch report on the same page idle', async () => {
	const fixture = priceFixture()
	const fork = await fixture.fork()
	// The universe report's request ID; the branch report keeps the unsuffixed one.
	const actions: PortfolioPriceParameters['actions'] = { scope: unscopedTransaction, busy: 'requestPortfolioPrice:universe', ownerReason: undefined, runPortfolioAction: async () => undefined }
	const view = await renderIntoDocument(
		<>
			<PortfolioPriceReport scope='branch' target={branchPriceTarget(fork)} actions={actions} />
			<PortfolioPriceReport scope='universe' target={accountPriceTarget(capitalSnapshot())} actions={actions} bidder={owner} />
		</>,
	)
	lifecycle.trackRendered(view)
	const labels = Array.from(view.container.querySelectorAll('button')).map(button => button.textContent)
	expect(labels).toContain(copy.scopes.universe.requesting)
	expect(labels).toContain(copy.scopes.branch.request)
	expect(labels).not.toContain(copy.scopes.branch.requesting)
})

test('a custom approval amount survives block reloads and a folded report', async () => {
	const fixture = priceFixture()
	fixture.set(priceFeed, 'universeId', 0n)
	const actions: PortfolioPriceParameters['actions'] = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runPortfolioAction: async () => undefined }
	const account = capitalSnapshot()
	const target = accountPriceTarget(account)
	const view = await renderIntoDocument(<PortfolioPriceReport scope='universe' target={target} actions={actions} bidder={owner} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain(copy.priceInvalid))
	const approval = () =>
		Array.from(view.container.querySelectorAll('.approval-amount-field'))
			.find(field => field.querySelector('.approval-amount-label')?.textContent === 'WETH approval amount')
			?.querySelector('input')
	await act(() => {
		const input = approval()
		if (input === undefined) throw new Error('Missing WETH approval amount')
		input.value = '7'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	// Each block reloads the feed under a new block hash; folding removes the target.
	await act(() => render(<PortfolioPriceReport scope='universe' target={accountPriceTarget({ ...account, blockHash: `0x${'12'.repeat(32)}` })} actions={actions} bidder={owner} />, view.container))
	expect(approval()?.value).toBe('7')
	await act(() => render(<PortfolioPriceReport scope='universe' target={undefined} actions={actions} bidder={owner} />, view.container))
	expect(approval()?.value).toBe('7')
	await act(() => render(<PortfolioPriceReport scope='universe' target={target} actions={actions} bidder={owner} />, view.container))
	await waitFor(() => expect(view.container.textContent).toContain(copy.priceInvalid))
	expect(approval()?.value).toBe('7')
})
