import { ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { createWalletActions, expectWalletFixDescribesAction } from '@zoltar/ui-core-shared/tests/testUtils/walletActions.js'
import { WalletActionsProvider } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolWorkflowRouteContentProps } from '@zoltar/ui-zoltar-shared/features/types.js'
import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { SecurityPoolWorkflowSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolWorkflowSection.js'
import { PoolActionCard } from '@zoltar/ui-statoblast-shared/features/security-pools/components/PoolStagePanel.js'
import type { SelectedPoolView } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolWorkflow.js'
import { createAccountState, createLoadedPoolProps, createOracleManagerDetails, createSelectedPool, createSecurityPoolWorkflowProps } from './workflow/builders.js'
import { useSecurityPoolWorkflowSectionTestDom } from './workflow/testDom.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'

installStatoblastRouting()
const { renderLoadedPool, renderWorkflow, setCleanup } = useSecurityPoolWorkflowSectionTestDom()
// Renders the full pool page (header included) for one loaded pool, optionally at a chain time.
const renderPoolPage = async (pool: ListedSecurityPool, overrides: Partial<SecurityPoolWorkflowRouteContentProps> = {}, chainTimestamp?: bigint) =>
	await renderWorkflow(createSecurityPoolWorkflowProps({ securityPoolAddress: pool.securityPoolAddress, securityPools: [pool], ...overrides }), { chainTimestamp, showHeader: true })
const pendingReportManager = (pendingReportReadyAtTimestamp: bigint) => createOracleManagerDetails({ lastPrice: 0n, lastSettlementTimestamp: 0n, pendingReportId: 7n, pendingReportReadyAtTimestamp })
const unpricedPool = () => createSelectedPool({ lastOraclePrice: undefined, lastOracleSettlementTimestamp: 0n })
const pricedPool = () => createSelectedPool({ lastOraclePrice: 10n ** 18n, lastOracleSettlementTimestamp: 1n })

test('shows a loaded pool address read-only and keeps typed entry for an address that has not resolved', async () => {
	const pool = createSelectedPool()
	const addressChanges: string[] = []
	function Harness() {
		const [address, setAddress] = useState('0x1111111111111111111111111111111111111111')
		return (
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					securityPoolAddress: address,
					securityPools: [pool],
					onSecurityPoolAddressChange: nextAddress => {
						addressChanges.push(nextAddress)
						setAddress(nextAddress)
					},
				})}
			/>
		)
	}
	setCleanup((await renderIntoDocument(<Harness />)).cleanup)
	const switcher = document.querySelector<HTMLDetailsElement>('details.pool-switcher')
	if (switcher === null) throw new Error('Expected the pool switcher')
	expect(switcher.open).toBe(false)
	switcher.open = true
	const page = within(document.body)
	expect(page.queryByRole('button', { name: 'Change pool' }) === null).toBe(true)
	expect(page.queryByRole('button', { name: 'Open pool' }) === null).toBe(true)
	expect(document.querySelector('.pool-object-identity') === null).toBe(true)
	const input = page.getByRole('textbox', { name: 'Security pool address' })
	// A partial address stays in the field without leaving the current page.
	await act(() => fireEvent.input(input, { target: { value: '0x123' } }))
	expect(addressChanges).toEqual([])
	await act(() => fireEvent.input(input, { target: { value: pool.securityPoolAddress } }))
	expect(addressChanges).toEqual([pool.securityPoolAddress])
	expect(document.querySelector('.pool-object-identity') !== null).toBe(true)
	expect(page.queryByRole('textbox', { name: 'Security pool address' })).toBeNull()
	expect(document.querySelector('.pool-address-display .address-value')?.getAttribute('title')).toBe(pool.securityPoolAddress)
	expect(page.getByRole('button', { name: `Copy address ${pool.securityPoolAddress}` })).not.toBeNull()
	expect(page.getByRole('button', { name: 'Refresh pool' }).hasAttribute('disabled')).toBe(false)
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
	await renderPoolPage(pool, { loadingSecurityPools: true })
	expect(within(document.body).getByRole('button', { name: 'Refreshing pool…' }).hasAttribute('disabled')).toBe(true)
})

test('keeps a directly opened advanced view visible and returns to the three primary tabs', async () => {
	setCleanup((await renderIntoDocument(<NavigationHarness />)).cleanup)
	const page = within(document.body)
	expect(page.getByRole('tab', { name: 'Staged operations' }).getAttribute('aria-selected')).toBe('true')
	await act(() => fireEvent.click(page.getByRole('tab', { name: 'Vaults' })))
	expect(page.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Vaults', 'Shares', 'Reporting'])
	// Secondary tools stay out of the layout until the More tools popover opens.
	expect(page.queryByRole('button', { name: 'Price oracle' })).toBeNull()
	const moreTools = page.getByRole('button', { name: 'More tools' })
	await act(() => fireEvent.click(moreTools))
	expect(moreTools.getAttribute('aria-expanded')).toBe('true')
	await act(() => fireEvent.click(page.getByRole('button', { name: 'Price oracle' })))
	expect(page.getByRole('tab', { name: 'Price oracle' }).getAttribute('aria-selected')).toBe('true')
	expect(page.queryByRole('button', { name: 'Staged operations' })).toBeNull()
})

test('surfaces actionable pool exceptions independently of the selected tab', async () => {
	const views: SelectedPoolView[] = []
	const reports: bigint[] = []
	await renderLoadedPool({
		securityPools: [createSelectedPool({ hasForkActivity: true, systemState: 'poolForked' })],
		poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, pendingReportId: 7n, activeStagedOperationCount: 2n }),
		onViewPendingReport: id => reports.push(id),
		onSelectedPoolViewChange: view => views.push(view),
		selectedPoolView: 'vaults',
	})
	const page = within(document.body)
	for (const name of ['View report', 'Review operations', 'Open fork & migration']) await act(() => fireEvent.click(page.getByRole('button', { name })))
	expect(reports).toEqual([7n])
	expect(views).toEqual(['staged-operations', 'fork-workflow'])
})

test('shows one oracle price row that counts down a pending report instead of an unavailable warning', async () => {
	await renderLoadedPool({ poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, lastPrice: 0n, lastSettlementTimestamp: 0n, pendingReportId: 7n, pendingReportReadyAtTimestamp: 10n ** 12n }) })
	const rows = document.body.querySelectorAll('.pool-oracle-status')
	expect(rows).toHaveLength(1)
	expect(rows[0]?.textContent).toContain('Open Oracle price')
	expect(rows[0]?.textContent).toContain('Available in')
	expect(document.body.textContent).not.toContain('Oracle price unavailable')
	expect(within(document.body).queryByRole('button', { name: 'Request new price' })).toBeNull()
})

test('keeps the pool oracle request visible but disabled with its reason when no wallet is connected', async () => {
	const opened: unknown[] = []
	await renderLoadedPool({
		accountState: createAccountState({ address: undefined }),
		poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, lastPrice: 10n ** 18n, lastSettlementTimestamp: 1n, pendingReportId: 0n }),
		RequestPriceModal: ({ review }) => {
			if (review !== undefined) opened.push(review)
			return null
		},
	})
	const row = document.body.querySelector('.pool-oracle-status.warning')
	const button = within(document.body).getByRole('button', { name: 'Request new price' })
	expect(button.hasAttribute('disabled')).toBe(true)
	expect(row?.querySelector('.tx-action-feedback')?.textContent).toContain('Connect a wallet')
	await act(() => fireEvent.click(button))
	expect(opened).toEqual([])
})

async function renderLoadedPoolWithWalletActions(overrides: Partial<SecurityPoolWorkflowRouteContentProps>) {
	const walletFix = createWalletActions()
	const props = createLoadedPoolProps(overrides)
	setCleanup(
		(
			await renderIntoDocument(
				<WalletActionsProvider walletActions={walletFix.walletActions}>
					<SecurityPoolWorkflowSection {...props} showHeader={false} />
				</WalletActionsProvider>,
			)
		).cleanup,
	)
	return walletFix
}

const expiredPriceManager = () => createOracleManagerDetails({ isPriceValid: false, lastPrice: 10n ** 18n, lastSettlementTimestamp: 1n, pendingReportId: 0n })

for (const [accountState, fixLabel] of [
	[createAccountState({ address: undefined }), 'Connect wallet'],
	[createAccountState({ address: '0x0000000000000000000000000000000000000001', chainId: '0x1', ethBalanceAttoEth: 10n ** 21n }), 'Switch to Sepolia'],
] as const)
	test(`offers the ${fixLabel} fix on the pool price requests the wallet blocks`, async () => {
		const { calls } = await renderLoadedPoolWithWalletActions({ accountState, poolOracleManagerDetails: expiredPriceManager(), selectedPoolView: 'price-oracle' })
		expectWalletFixDescribesAction(document.body, 'Request new price', fixLabel)
		const fix = expectWalletFixDescribesAction(document.body, 'Request new price…', fixLabel)
		await act(() => fireEvent.click(fix))
		expect(calls).toEqual([fixLabel === 'Connect wallet' ? 'connect' : 'switch'])
	})

test('keeps the load-oracle reason as text on the price row while the wallet is disconnected', async () => {
	await renderLoadedPoolWithWalletActions({ accountState: createAccountState({ address: undefined }), poolOracleManagerDetails: undefined, poolOracleManagerError: 'Oracle unavailable.', poolOracleManagerErrorAddress: zeroAddress })
	expect(within(document.body).queryByRole('button', { name: 'Connect wallet' })).toBeNull()
	expect(getTransactionButtonState(document.body, 'Request new price')).toEqual({ disabled: true, reason: 'Loading price oracle details…' })
})

test('requests a new price straight from the pool oracle row', async () => {
	const opened: unknown[] = []
	await renderLoadedPool({
		accountState: createAccountState({ address: '0x0000000000000000000000000000000000000001', ethBalanceAttoEth: 10n ** 21n }),
		poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, lastPrice: 10n ** 18n, lastSettlementTimestamp: 1n, pendingReportId: 0n }),
		RequestPriceModal: ({ review }) => {
			if (review !== undefined) opened.push(review)
			return null
		},
	})
	const row = document.body.querySelector('.pool-oracle-status')
	expect(row?.classList.contains('warning')).toBe(true)
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Request new price' })))
	expect(opened.length > 0).toBe(true)
})

test('shows the stage, marks the open tab row, and offers controls that leave it', async () => {
	const views: SelectedPoolView[] = []
	await renderLoadedPool({ onSelectedPoolViewChange: view => views.push(view) })
	const card = document.querySelector('.pool-action-card')
	if (!(card instanceof HTMLElement)) throw new Error('Expected the action card')
	expect(document.querySelector('.pool-lifecycle [aria-current="step"]')?.textContent).toContain('Operational')
	expect(within(card).queryByRole('button', { name: 'Open vaults' })).toBeNull()
	// The open tab's row keeps its control slot, marked as shown below, so rows do not shift between tabs.
	expect(card.querySelectorAll('.pool-action-control')).toHaveLength(card.querySelectorAll('.pool-action-item').length)
	expect(card.querySelector('.pool-action-current')?.textContent).toBe('Shown below')
	await act(() => fireEvent.click(within(card).getByRole('button', { name: 'Open shares' })))
	expect(views).toEqual(['trading'])
})

test('omits the open vault navigation hint while retaining reporting deadlines on the open reporting tab', async () => {
	const items = [
		{ id: 'manageVault', tab: 'vaults', tone: 'action' },
		{ id: 'reportOrEscalate', tab: 'reporting', tone: 'attention', deadline: 1_060n },
	] as const
	const firstRender = await renderIntoDocument(<PoolActionCard currentTimestamp={1_000n} currentView='vaults' items={items} onChange={() => undefined} />)
	setCleanup(firstRender.cleanup)
	expect(document.body.textContent).not.toContain('Manage your vault')
	expect(document.body.textContent).toContain('Report or escalate an outcome')
	expect(document.querySelector('time')?.getAttribute('datetime')).toBe('1970-01-01T00:17:40.000Z')
	await firstRender.cleanup()
	const secondRender = await renderIntoDocument(<PoolActionCard currentTimestamp={1_000n} currentView='reporting' items={items} onChange={() => undefined} />)
	setCleanup(secondRender.cleanup)
	expect(within(document.body).getByRole('button', { name: 'Open vaults' })).not.toBeNull()
	expect(document.body.textContent).toContain('Report or escalate an outcome')
	expect(document.body.textContent).toContain('in 1m')
})

test('shows known standing commitments independently of a missing price', async () => {
	await renderLoadedPool({ uiPriceOracle: 'uniswap', repPerEthPrice: undefined })
	const header = document.body.querySelector('.pool-overview-header')
	expect(header?.textContent).toContain('/ 5.00 ETH')
	expect(header?.querySelector('.progress-meter-track') !== null).toBe(true)
})

for (const timestamp of [undefined, 100000n]) {
	test('keeps reference capacity consistent when chain time is ' + String(timestamp), async () => {
		await renderPoolPage(pricedPool(), {}, timestamp)
		expect(document.querySelector('.pool-overview-header')?.textContent).toContain('/ 5.00 ETH')
		expect(document.querySelector('.pool-reference-details')?.textContent).not.toContain('Collateral in use / capacity')
	})
}
test('keeps the pending report reachable while the pool universe differs', async () => {
	const reports: bigint[] = []
	await renderLoadedPool({ activeUniverseId: 2n, poolOracleManagerDetails: createOracleManagerDetails({ pendingReportId: 7n }), onViewPendingReport: id => reports.push(id) })
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'View report' })))
	expect(reports).toEqual([7n])
	expect(within(document.body).queryByRole('button', { name: 'Request new price' })).toBeNull()
})

test('uses the refreshed manager price for the single capacity summary', async () => {
	await renderPoolPage(pricedPool(), { poolOracleManagerDetails: createOracleManagerDetails({ lastPrice: 2n * 10n ** 18n, lastSettlementTimestamp: 1n }) }, 2n)
	expect(document.querySelector('.pool-overview-header .pool-capacity-limit')?.textContent).toContain('5.00 ETH')
	expect(document.querySelectorAll('.pool-capacity-summary')).toHaveLength(1)
})

test('shows the pending report countdown in selected pool price fields', async () => {
	await renderPoolPage(unpricedPool(), { selectedPoolView: 'price-oracle', poolOracleManagerDetails: pendingReportManager(154n) }, 100n)
	expect(document.body.textContent).toContain('Available in 54s')
	expect(document.body.textContent).not.toContain('Unavailable ↻')
	const shownOraclePrices = Array.from(document.querySelectorAll('.metric-label'))
		.filter(label => label.textContent === 'Open Oracle price')
		.map(label => label.nextElementSibling?.textContent?.trim())
	// Pool details omit the price while the page's price row already shows it.
	expect(shownOraclePrices).toEqual(['Available in 54s↻'])
	await act(async () => await new Promise(resolve => setTimeout(resolve, 1100)))
	expect(document.body.textContent).toContain('Available in 53s')
})

test('keeps the pending price countdown moving above one hour', async () => {
	await renderPoolPage(unpricedPool(), { selectedPoolView: 'price-oracle', poolOracleManagerDetails: pendingReportManager(3702n) }, 100n)
	expect(document.body.textContent).toContain('Available in 1h 0m 2s')
	await act(async () => await new Promise(resolve => setTimeout(resolve, 1100)))
	expect(document.body.textContent).toContain('Available in 1h 0m 1s')
})

test('keeps the prior price expiry visible while a new report is pending', async () => {
	await renderPoolPage(pricedPool(), { selectedPoolView: 'price-oracle', poolOracleManagerDetails: createOracleManagerDetails({ lastPrice: 10n ** 18n, lastSettlementTimestamp: 1n, pendingReportId: 7n, pendingReportReadyAtTimestamp: 2054n, priceValidUntilTimestamp: 1000n }) }, 2000n)
	const price = document.querySelector('.oracle-price-value')?.textContent ?? ''
	expect(price).toContain('expired')
	expect(price).toContain('New price available in 54s')
})

for (const outcome of ['disputed', 'settled'] as const) {
	test(`refreshes the ${outcome} oracle state when the pending timer expires`, async () => {
		const pool = unpricedPool()
		const refreshes: string[] = []
		function Harness() {
			const [manager, setManager] = useState(pendingReportManager(100n))
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
								setManager(outcome === 'disputed' ? pendingReportManager(154n) : createOracleManagerDetails({ lastPrice: 10n ** 18n, lastSettlementTimestamp: 100n, pendingReportId: 0n }))
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

test('refreshes the selected pool when one pending price report is replaced by another', async () => {
	const pool = unpricedPool()
	const refreshes: string[] = []
	function Harness() {
		const [manager, setManager] = useState(pendingReportManager(200n))
		return (
			<ChainTimestampContext.Provider value={100n}>
				<button type='button' onClick={() => setManager(createOracleManagerDetails({ lastPrice: 10n ** 18n, lastSettlementTimestamp: 80n, pendingReportId: 8n, pendingReportReadyAtTimestamp: 154n }))}>
					Replace report
				</button>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						securityPoolAddress: pool.securityPoolAddress,
						securityPools: [pool],
						selectedPoolView: 'price-oracle',
						poolOracleManagerDetails: manager,
						onRefreshSelectedPoolData: () => refreshes.push('pool'),
					})}
				/>
			</ChainTimestampContext.Provider>
		)
	}
	setCleanup((await renderIntoDocument(<Harness />)).cleanup)
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Replace report' })))
	expect(refreshes).toEqual(['pool'])
	expect(document.body.textContent).toContain('New price available in 54s')
})
