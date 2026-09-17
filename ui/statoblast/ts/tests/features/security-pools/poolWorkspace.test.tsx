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

test('commits a new pool address only when the user opens it', async () => {
	const selected: string[] = []
	const loaded: Array<string | undefined> = []
	await renderLoadedPool({ onSecurityPoolAddressChange: address => selected.push(address), onRefreshSelectedPoolData: address => loaded.push(address) })
	selected.length = 0
	loaded.length = 0
	const page = within(document.body)
	expect(page.queryByRole('textbox', { name: 'Security Pool Address' })).toBeNull()
	await act(() => fireEvent.click(page.getByRole('button', { name: 'Change pool' })))
	await act(() => fireEvent.input(page.getByRole('textbox', { name: 'Security Pool Address' }), { target: { value: ' 0x456 ' } }))
	expect(selected).toEqual([])
	expect(loaded).toEqual([])
	await act(() => fireEvent.click(page.getByRole('button', { name: 'Open pool' })))
	expect(selected).toEqual(['0x456'])
	expect(loaded).toEqual(['0x456'])
})

function NavigationHarness() {
	const [view, setView] = useState<SelectedPoolView>('staged-operations')
	const pool = createSelectedPool()
	return <SecurityPoolWorkflowSection {...createSecurityPoolWorkflowProps({ securityPoolAddress: pool.securityPoolAddress, securityPools: [pool], selectedPoolView: view, onSelectedPoolViewChange: setView })} />
}
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
	expect(header?.textContent).toContain('Capacity needs a current price.')
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
		expect(document.querySelector('.pool-reference-details')?.textContent).toContain('/ Unavailable')
	})
}
test('keeps the pending report reachable while the pool universe differs', async () => {
	const reports: bigint[] = []
	await renderLoadedPool({ activeUniverseId: 2n, poolOracleManagerDetails: createOracleManagerDetails({ pendingReportId: 7n }), onViewPendingReport: id => reports.push(id) })
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'View report' })))
	expect(reports).toEqual([7n])
	expect(within(document.body).queryByRole('button', { name: 'Review oracle' })).toBeNull()
})

test('uses the refreshed manager price for both capacity summaries', async () => {
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
	expect(document.querySelector('.pool-reference-details')?.textContent).toContain('/ ≈ 1.25 ETH')
})
