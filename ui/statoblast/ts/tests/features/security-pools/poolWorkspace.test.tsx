import { ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { SecurityPoolWorkflowSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolWorkflowSection.js'
import type { SelectedPoolView } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolWorkflow.js'
import { createOracleManagerDetails, createSelectedPool, createSecurityPoolWorkflowProps } from './workflow/builders.js'
import { useSecurityPoolWorkflowSectionTestDom } from './workflow/testDom.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'

installTestRouting()
const { renderLoadedPool, setCleanup } = useSecurityPoolWorkflowSectionTestDom()

test('updates pool selection immediately and never shows contents for a different address', async () => {
	const pool = createSelectedPool()
	function Harness() {
		const [address, setAddress] = useState(pool.securityPoolAddress.toString())
		return <SecurityPoolWorkflowSection {...createSecurityPoolWorkflowProps({ securityPoolAddress: address, securityPools: [pool], onSecurityPoolAddressChange: setAddress })} />
	}
	setCleanup((await renderIntoDocument(<Harness />)).cleanup)
	const page = within(document.body)
	expect(page.queryByRole('textbox', { name: 'Security Pool Address' }) !== null).toBe(true)
	const input = page.getByRole('textbox', { name: 'Security Pool Address' })
	expect(page.queryByRole('button', { name: 'Change pool' }) === null).toBe(true)
	expect(page.queryByRole('button', { name: 'Open pool' }) === null).toBe(true)
	await act(() => fireEvent.input(input, { target: { value: '0x123' } }))
	expect(document.querySelector('.pool-object-identity') === null).toBe(true)
	await act(() => fireEvent.input(input, { target: { value: '0x1111111111111111111111111111111111111111' } }))
	expect(document.querySelector('.pool-object-identity') === null).toBe(true)
	await act(() => fireEvent.input(input, { target: { value: pool.securityPoolAddress } }))
	expect(document.querySelector('.pool-object-identity') !== null).toBe(true)
})

function NavigationHarness() {
	const [view, setView] = useState<SelectedPoolView>('staged-operations')
	const pool = createSelectedPool()
	return <SecurityPoolWorkflowSection {...createSecurityPoolWorkflowProps({ securityPoolAddress: pool.securityPoolAddress, securityPools: [pool], selectedPoolView: view, onSelectedPoolViewChange: setView })} />
}
test('shows the refresh busy label only while a shown pool reloads', async () => {
	const pool = createSelectedPool()
	const freshAddressRender = await renderIntoDocument(<SecurityPoolWorkflowSection {...createSecurityPoolWorkflowProps({ loadingSecurityPools: true, securityPoolAddress: '0x1111111111111111111111111111111111111111', securityPools: [pool] })} />)
	const page = within(document.body)
	expect(page.getByRole('button', { name: 'Refresh pool' }).hasAttribute('disabled')).toBe(true)
	expect(page.queryByText('Refreshing pool…') === null).toBe(true)
	await freshAddressRender.cleanup()
	setCleanup((await renderIntoDocument(<SecurityPoolWorkflowSection {...createSecurityPoolWorkflowProps({ loadingSecurityPools: true, securityPoolAddress: pool.securityPoolAddress, securityPools: [pool] })} />)).cleanup)
	expect(within(document.body).getByRole('button', { name: 'Refreshing pool…' }).hasAttribute('disabled')).toBe(true)
})

test('keeps a directly opened advanced view visible and returns to the three primary tabs', async () => {
	setCleanup((await renderIntoDocument(<NavigationHarness />)).cleanup)
	const page = within(document.body)
	expect(page.getByRole('tab', { name: 'Staged Operations' }).getAttribute('aria-selected')).toBe('true')
	await act(() => fireEvent.click(page.getByRole('tab', { name: 'Vaults' })))
	expect(page.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Vaults', 'Shares', 'Reporting'])
	await act(() => fireEvent.click(page.getByRole('button', { name: 'Price Oracle' })))
	expect(page.getByRole('tab', { name: 'Price Oracle' }).getAttribute('aria-selected')).toBe('true')
})

test('surfaces actionable pool exceptions independently of the selected tab', async () => {
	const views: SelectedPoolView[] = []
	const reports: bigint[] = []
	await renderLoadedPool({
		securityPools: [createSelectedPool({ hasForkActivity: true, systemState: 'poolForked' })],
		poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, pendingReportId: 7n, activeStagedOperationCount: 2n }),
		onViewPendingReport: id => reports.push(id),
		onSelectedPoolViewChange: view => views.push(view),
	})
	const page = within(document.body)
	for (const name of ['Review oracle', 'View report', 'Review operations', 'Review fork & migration']) await act(() => fireEvent.click(page.getByRole('button', { name })))
	expect(reports).toEqual([7n])
	expect(views).toEqual(['price-oracle', 'staged-operations', 'fork-workflow'])
})

test('shows unknown capacity without a progress gauge or implied zero capacity', async () => {
	await renderLoadedPool({ uiPriceOracle: 'uniswap', repPerEthPrice: undefined })
	const header = document.body.querySelector('.pool-overview-header')
	expect(header?.textContent).toContain('/ Unavailable')
	expect(header?.textContent).toContain('/ Unavailable')
	expect(header?.querySelector('.progress-meter-track')).toBeNull()
})

for (const timestamp of [undefined, 100000n]) {
	test('keeps reference capacity consistent when chain time is ' + String(timestamp), async () => {
		const pool = createSelectedPool({ lastOraclePrice: 10n ** 18n, lastOracleSettlementTimestamp: 1n })
		setCleanup(
			(
				await renderIntoDocument(
					<ChainTimestampContext.Provider value={timestamp}>
						<SecurityPoolWorkflowSection {...createSecurityPoolWorkflowProps({ securityPoolAddress: pool.securityPoolAddress, securityPools: [pool] })} />
					</ChainTimestampContext.Provider>,
				)
			).cleanup,
		)
		expect(document.querySelector('.pool-overview-header')?.textContent).toContain('/ Unavailable')
		expect(document.querySelector('.pool-reference-details')?.textContent).not.toContain('Open interest / estimated capacity')
	})
}
test('keeps the pending report reachable while the pool universe differs', async () => {
	const reports: bigint[] = []
	await renderLoadedPool({ activeUniverseId: 2n, poolOracleManagerDetails: createOracleManagerDetails({ pendingReportId: 7n }), onViewPendingReport: id => reports.push(id) })
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'View report' })))
	expect(reports).toEqual([7n])
	expect(within(document.body).queryByRole('button', { name: 'Review oracle' })).toBeNull()
})

test('uses the refreshed manager price for the single capacity summary', async () => {
	const pool = createSelectedPool({ lastOraclePrice: 10n ** 18n, lastOracleSettlementTimestamp: 1n })
	setCleanup(
		(
			await renderIntoDocument(
				<ChainTimestampContext.Provider value={2n}>
					<SecurityPoolWorkflowSection {...createSecurityPoolWorkflowProps({ securityPoolAddress: pool.securityPoolAddress, securityPools: [pool], poolOracleManagerDetails: createOracleManagerDetails({ lastPrice: 2n * 10n ** 18n, lastSettlementTimestamp: 1n }) })} />
				</ChainTimestampContext.Provider>,
			)
		).cleanup,
	)
	expect(document.querySelector('.pool-overview-header .pool-capacity-limit')?.textContent).toContain('1.25 ETH')
	expect(document.querySelectorAll('.pool-capacity-summary')).toHaveLength(1)
})

test('shows the pending report countdown in selected pool price fields', async () => {
	const pool = createSelectedPool({ lastOraclePrice: undefined, lastOracleSettlementTimestamp: 0n })
	setCleanup(
		(
			await renderIntoDocument(
				<ChainTimestampContext.Provider value={100n}>
					<SecurityPoolWorkflowSection
						{...createSecurityPoolWorkflowProps({ securityPoolAddress: pool.securityPoolAddress, securityPools: [pool], selectedPoolView: 'price-oracle', poolOracleManagerDetails: createOracleManagerDetails({ lastPrice: 0n, lastSettlementTimestamp: 0n, pendingReportId: 7n, pendingReportReadyAtTimestamp: 154n }) })}
					/>
				</ChainTimestampContext.Provider>,
			)
		).cleanup,
	)
	expect(document.body.textContent).toContain('Available in 54s')
	expect(document.body.textContent).not.toContain('Unavailable ↻')
	await act(async () => await new Promise(resolve => setTimeout(resolve, 1100)))
	expect(document.body.textContent).toContain('Available in 53s')
})

test('keeps the prior price expiry visible while a new report is pending', async () => {
	const pool = createSelectedPool({ lastOraclePrice: 10n ** 18n, lastOracleSettlementTimestamp: 1n })
	setCleanup(
		(
			await renderIntoDocument(
				<ChainTimestampContext.Provider value={2000n}>
					<SecurityPoolWorkflowSection
						{...createSecurityPoolWorkflowProps({
							securityPoolAddress: pool.securityPoolAddress,
							securityPools: [pool],
							selectedPoolView: 'price-oracle',
							poolOracleManagerDetails: createOracleManagerDetails({ lastPrice: 10n ** 18n, lastSettlementTimestamp: 1n, pendingReportId: 7n, pendingReportReadyAtTimestamp: 2054n, priceValidUntilTimestamp: 1000n }),
						})}
					/>
				</ChainTimestampContext.Provider>,
			)
		).cleanup,
	)
	const price = document.querySelector('.oracle-price-value')?.textContent ?? ''
	expect(price).toContain('expired')
	expect(price).toContain('New price available in 54s')
})

for (const outcome of ['disputed', 'settled'] as const) {
	test(`refreshes the ${outcome} oracle state when the pending timer expires`, async () => {
		const pool = createSelectedPool({ lastOraclePrice: undefined, lastOracleSettlementTimestamp: 0n })
		const refreshes: string[] = []
		function Harness() {
			const [manager, setManager] = useState(createOracleManagerDetails({ lastPrice: 0n, lastSettlementTimestamp: 0n, pendingReportId: 7n, pendingReportReadyAtTimestamp: 100n }))
			return (
				<ChainTimestampContext.Provider value={100n}>
					<SecurityPoolWorkflowSection
						{...createSecurityPoolWorkflowProps({
							securityPoolAddress: pool.securityPoolAddress,
							securityPools: [pool],
							selectedPoolView: 'price-oracle',
							poolOracleManagerDetails: manager,
							onLoadPoolOracleManager: () => {
								refreshes.push('manager')
								setManager(createOracleManagerDetails(outcome === 'disputed' ? { lastPrice: 0n, lastSettlementTimestamp: 0n, pendingReportId: 7n, pendingReportReadyAtTimestamp: 154n } : { lastPrice: 10n ** 18n, lastSettlementTimestamp: 100n, pendingReportId: 0n }))
							},
							onRefreshSelectedPoolData: () => refreshes.push('pool'),
						})}
					/>
				</ChainTimestampContext.Provider>
			)
		}
		setCleanup((await renderIntoDocument(<Harness />)).cleanup)
		await act(async () => await new Promise(resolve => setTimeout(resolve, 20)))
		expect(refreshes).toEqual(outcome === 'disputed' ? ['manager'] : ['manager', 'pool'])
		if (outcome === 'disputed') expect(document.body.textContent).toContain('Available in 54s')
		else {
			expect(document.body.textContent).not.toContain('Awaiting settlement')
			expect(document.body.textContent).not.toContain('Available in')
		}
	})
}
