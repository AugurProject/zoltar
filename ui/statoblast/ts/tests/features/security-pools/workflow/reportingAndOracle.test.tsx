import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { expectTransactionButtonDisabled, getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { ActiveReportingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { getReportingLockedUntilMessage } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reporting.js'
import { createAccountState, createActiveReportingDetails, createEscalationSides, createLoadedPoolProps, createMarketDetails, createOracleManagerDetails, createReportingForm, createReportingProps, createSelectedPool } from './builders.js'
import { useSecurityPoolWorkflowSectionTestDom } from './testDom.js'

installTestRouting()
describe('SecurityPoolWorkflowSection: reporting and oracle', () => {
	const { renderLoadedPool, renderWorkflow } = useSecurityPoolWorkflowSectionTestDom()
	const endedMarket = () => createMarketDetails({ endTime: 0n })
	const fundedAccount = () => createAccountState({ ethBalanceAttoEth: 100n * 10n ** 18n })
	const expiredOracle = () => createOracleManagerDetails({ isPriceValid: false, lastSettlementTimestamp: 1n })
	const settledOracle = { lastPrice: 2n * 10n ** 18n, lastSettlementTimestamp: 100n } as const
	const pendingWithdrawal = { amount: 5n * 10n ** 18n, operator: zeroAddress, operation: 'withdrawRep', operationId: 7n, targetVault: zeroAddress } as const

	const createLoadedReportingDetails = (overrides: Partial<ActiveReportingDetails> = {}) =>
		createActiveReportingDetails({
			activationTime: 1n,
			bindingCapital: 5n,
			currentTime: 100n,
			escalationEndTime: 500n,
			forkThresholdAttoRep: 10n,
			marketDetails: endedMarket(),
			sides: createEscalationSides([1n, 5n, 2n]),
			totalCostAttoRep: 2n,
			viewerPoolHeldVaultRepBackingAttoRep: 10n,
			viewerVaultDisputeStakedAttoRep: 0n,
			viewerVaultRepBackingAttoRep: 10n,
			...overrides,
		})

	const createLoadedReportingProps = (questionOutcome: 'none' | 'yes' = 'none') =>
		createReportingProps({
			reportingDetails: createLoadedReportingDetails({ questionOutcome }),
			reportingForm: createReportingForm({ reportAmount: '0.000000000000000001', securityPoolAddress: zeroAddress, selectedOutcome: 'no' }),
		})

	const openPriceRequestDialog = () => {
		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Request new price…' }))
		return documentQueries.getByRole('dialog', { name: 'Request new price' })
	}

	test('hides the truth auction metric when the selected pool has no truth auction address', async () => {
		await renderLoadedPool({ activeUniverseId: 1n, securityPools: [createSelectedPool({ systemState: 'poolForked', truthAuctionAddress: zeroAddress })] })

		const selectedPoolSummary = document.body.querySelector('.selected-pool-object-header')
		if (!(selectedPoolSummary instanceof HTMLElement)) throw new Error('Expected selected pool summary')
		const summaryLabels = Array.from(selectedPoolSummary.querySelectorAll('.metric-label')).map(element => element.textContent?.trim() ?? '')
		expect(summaryLabels).not.toContain('Truth auction')
	})

	test('defers future reporting actions until the market has ended', async () => {
		const futureMarket = createMarketDetails({ endTime: 1_700_003_600n })
		const expectedLockedReason = getReportingLockedUntilMessage(futureMarket.endTime, 1_700_000_000n)
		await renderLoadedPool({ securityPools: [createSelectedPool({ marketDetails: futureMarket })], selectedPoolView: 'reporting' }, { chainTimestamp: 1_700_000_000n })

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Question' })).toBeNull()
		expect(documentQueries.getAllByRole('heading', { name: 'Will this resolve?' })).toHaveLength(1)
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Reporting not enabled' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Outcome Sides' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Escalation metrics' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report outcome' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Withdraw Escalation Deposits' })).toBeNull()
		expect(documentQueries.queryByText('Load reporting details to populate live stakes, bond progression, and deposit indexes.')).toBeNull()
		expect(documentQueries.queryByText('Reporting unlocks after the market end timestamp for the selected pool.')).toBeNull()
		expect(documentQueries.queryByText(expectedLockedReason)).not.toBeNull()
		expect(document.body.querySelectorAll('.escalation-side')).toHaveLength(0)
		expect(document.body.textContent?.includes('Your deposits: None')).toBe(false)
		expect(document.body.textContent?.includes('Projected payout for current amount')).toBe(false)
		expect(document.body.textContent?.includes('Projected profit if this side wins')).toBe(false)

		expect(documentQueries.queryByRole('button', { name: 'Report on selected side' })).toBeNull()
	})

	test('locks reporting actions while the selected pool is not operational', async () => {
		await renderLoadedPool(
			{
				poolOracleManagerDetails: expiredOracle(),
				reporting: createReportingProps({
					reportingDetails: createLoadedReportingDetails({ activationTime: 1_699_999_000n, currentTime: 1_700_000_000n, escalationEndTime: 1_700_000_500n, systemState: 'forkTruthAuction' }),
				}),
				securityPools: [createSelectedPool({ systemState: 'forkTruthAuction' })],
				selectedPoolView: 'reporting',
			},
			{ chainTimestamp: 1_700_000_000n },
		)

		const reportButton = within(document.body).getByRole('button', { name: 'Report on selected side' })
		if (!(reportButton instanceof HTMLButtonElement)) throw new Error('Expected report button')
		expect(reportButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Report on selected side').reason).toBe('This pool is in truth auction. Reporting actions unlock once the pool becomes operational.')
		expect(document.body.textContent).not.toContain("The pool's oracle price expired.")
	})

	test('allows reporting with a stale oracle price when the pool has no underwriting commitments', async () => {
		await renderLoadedPool(
			{
				poolOracleManagerDetails: expiredOracle(),
				reporting: createLoadedReportingProps(),
				securityPools: [createSelectedPool({ marketDetails: endedMarket(), totalUnderwritingLimitAttoEth: 0n })],
				selectedPoolView: 'reporting',
			},
			{ chainTimestamp: 100n },
		)

		const reportButton = within(document.body).getByRole('button', { name: /^Report No ·/ })
		if (!(reportButton instanceof HTMLButtonElement)) throw new Error('Expected report button')
		expect(reportButton.disabled).toBe(false)
		expect(document.body.textContent).not.toContain("The pool's oracle price expired.")
	})

	test.each([
		['wallet', false, false],
		['vault', true, false],
		['vault', false, false],
		['wallet', false, true],
	] as const)('applies the stale-price guard to the selected %s funding source (vault: %s)', async (contributionFunding, viewerVaultExists, forkContinuation) => {
		const reporting = createReportingProps({
			reportingDetails: createLoadedReportingDetails({
				contributionFunding: 'wallet',
				forkContinuation,
				minimumVaultRepDepositAttoRep: 1n,
				walletVaultFunding: { vaultRepBackingUnits: 0n, totalRepBackingUnits: 0n, totalPoolHeldRepAttoRep: 0n },
				viewerVaultExists,
				viewerPoolHeldVaultRepBackingAttoRep: viewerVaultExists ? 10n : 0n,
				viewerWalletRepAllowanceAttoRep: 10n,
				viewerWalletRepBalanceAttoRep: 10n,
			}),
			reportingForm: { ...createLoadedReportingProps().reportingForm, contributionFunding },
		})
		await renderLoadedPool(
			{
				poolOracleManagerDetails: expiredOracle(),
				reporting,
				securityPools: [createSelectedPool({ marketDetails: endedMarket(), totalUnderwritingLimitAttoEth: forkContinuation ? 0n : 10n })],
				selectedPoolView: 'reporting',
			},
			{ chainTimestamp: 100n },
		)

		const reportButton = within(document.body).getByRole('button', { name: /^Report No ·/ })
		if (!(reportButton instanceof HTMLButtonElement)) throw new Error('Expected report button')
		expect(reportButton.disabled).toBe(contributionFunding === 'vault' || forkContinuation)
		if (forkContinuation) expectTransactionButtonDisabled(document.body, reportButton.textContent ?? '', 'A current pool oracle price is required before reporting.')
		if (contributionFunding === 'vault') expectTransactionButtonDisabled(document.body, reportButton.textContent ?? '', viewerVaultExists ? 'A current pool oracle price is required before reporting.' : 'No REP is available in your pool vault. Select Wallet REP to report.')
	})

	test('preserves the finalized reporting blocker instead of stale-price recovery', async () => {
		await renderLoadedPool(
			{
				poolOracleManagerDetails: expiredOracle(),
				reporting: createLoadedReportingProps('yes'),
				securityPools: [createSelectedPool({ marketDetails: endedMarket(), questionOutcome: 'yes' })],
				selectedPoolView: 'reporting',
			},
			{ chainTimestamp: 100n },
		)

		expect(within(document.body).queryByRole('button', { name: /^Report No ·/ })).toBeNull()
		expect(document.body.textContent).toContain('Resolved as Yes.')
		expect(document.body.textContent).not.toContain("The pool's oracle price expired.")
	})

	test('uses the shared chain timestamp context for oracle expiry text', async () => {
		await renderLoadedPool({ securityPools: [createSelectedPool({ lastOraclePrice: 3n * 10n ** 18n, lastOracleSettlementTimestamp: 1n })], selectedPoolView: 'price-oracle' }, { chainTimestamp: 1n + 60n * 60n + 60n })

		expect(document.body.textContent?.includes('(expired 1m ago)')).toBe(true)
	})

	test('uses the shared chain timestamp context to unlock reporting after market end', async () => {
		await renderLoadedPool({ securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 100n }) })], selectedPoolView: 'reporting' }, { chainTimestamp: 150n })

		const reportButton = within(document.body).getByRole('button', { name: 'Report on selected side' }) as HTMLButtonElement
		expect(reportButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Report on selected side').reason).toBe('Loading reporting details.')
	})

	test('keeps reporting disabled one second before the market end timestamp', async () => {
		await renderLoadedPool({ securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 100n }) })], selectedPoolView: 'reporting' }, { chainTimestamp: 99n })

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Reporting not enabled' })).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Report on selected side' })).toBeNull()
		expect(documentQueries.queryByText(getReportingLockedUntilMessage(100n, 99n))).not.toBeNull()
	})

	// The contracts accept reporting once block.timestamp >= the question end time.
	test('unlocks reporting at the exact market end timestamp', async () => {
		await renderLoadedPool({ securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 100n }) })], selectedPoolView: 'reporting' }, { chainTimestamp: 100n })

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Reporting not enabled' })).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Report on selected side' })).not.toBeNull()
	})

	test('renders staged operations management inside the staged operations tab instead of a standalone section', async () => {
		await renderLoadedPool({ poolOracleManagerDetails: createOracleManagerDetails(settledOracle), selectedPoolView: 'staged-operations' })

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('tab', { name: 'Staged operations' }).getAttribute('aria-selected')).toBe('true')
		expect(documentQueries.getByRole('heading', { name: 'Staged operations' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Pool Oracle & Pending Operations' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Staged operations List' })).toBeNull()
		expect(documentQueries.getByText('No staged operations are currently queued for this pool.')).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Request new price' })).toBeNull()
	})

	test('shows queued target changes in the existing staged operations table with ETH commitment units', async () => {
		await renderLoadedPool(
			{
				selectedPoolView: 'staged-operations',
				poolOracleManagerDetails: createOracleManagerDetails({
					managerAddress: zeroAddress,
					pendingOperation: { amount: 2n * 10n ** 18n, operator: zeroAddress, operation: 'setVaultUnderwritingLimit', operationId: 7n, targetVault: zeroAddress },
					pendingOperationSlotId: 7n,
					pendingSettlementOperationIds: [7n],
				}),
			},
			{ showHeader: true },
		)
		const page = within(document.body)
		expect(page.getByText('Commitment limit (ETH)')).not.toBeNull()
		expect(page.getByText('Set commitment limit')).not.toBeNull()
		expect(page.getByText('Commitment limit (ETH)').parentElement?.textContent).toMatch(/2(?:\.0+)?\s*ETH/)
	})

	test('lists staged operations in the staged operations tab', async () => {
		const executions: Array<{ operationId: bigint; securityPoolAddress: string; universeId: bigint }> = []
		const pool = createSelectedPool({ universeId: 4n })
		await renderLoadedPool({
			activeUniverseId: pool.universeId,
			onExecutePendingPoolOperation: (_managerAddress, operationId, securityPoolAddress, universeId) => executions.push({ operationId, securityPoolAddress, universeId }),
			poolOracleManagerDetails: createOracleManagerDetails({ ...settledOracle, activeStagedOperationCount: 4n, pendingOperation: pendingWithdrawal, pendingOperationSlotId: 7n, pendingSettlementOperationIds: [7n], pendingReportId: 12n }),
			securityPools: [pool],
			selectedPoolView: 'staged-operations',
		})

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Withdraw REP')).not.toBeNull()
		expect(documentQueries.getByText('Auto-exec pending')).not.toBeNull()
		expect(documentQueries.getByText('Operation ID')).not.toBeNull()
		expect(documentQueries.getByText('5 REP')).not.toBeNull()
		expect(documentQueries.getByText('Staged operation ID')).not.toBeNull()
		expect(documentQueries.getByText('7')).not.toBeNull()
		expect(documentQueries.getByText('Showing 1 of 4 active staged operations, newest first.')).not.toBeNull()
		expect(documentQueries.queryByText('Pending Price Request')).toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Execute staged operation' }))
		expect(executions).toEqual([{ operationId: 7n, securityPoolAddress: pool.securityPoolAddress, universeId: pool.universeId }])
	})

	test('labels liquidation amounts by accounting role', async () => {
		await renderLoadedPool({
			poolOracleManagerDetails: createOracleManagerDetails({ pendingOperation: { ...pendingWithdrawal, operation: 'liquidation' }, pendingOperationSlotId: 7n }),
			selectedPoolView: 'staged-operations',
		})

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Commitment to transfer')).not.toBeNull()
		expect(documentQueries.getByText('5 ETH')).not.toBeNull()
	})

	test('does not show staged-operation cancellation actions', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const targetVault = getAddress('0x00000000000000000000000000000000000000a2')
		await renderLoadedPool({
			accountState: createAccountState({ address: walletAddress }),
			poolOracleManagerDetails: createOracleManagerDetails({ pendingOperation: { amount: 1n, operator: walletAddress, operation: 'liquidation', operationId: 9n, targetVault }, pendingOperationSlotId: 9n }),
			selectedPoolView: 'staged-operations',
		})

		expect(within(document.body).queryByRole('button', { name: 'Cancel Staged operation' })).toBeNull()
	})

	test('blocks staged-operation execution after the selected pool has ended', async () => {
		await renderLoadedPool({
			poolOracleManagerDetails: createOracleManagerDetails({ ...settledOracle, pendingOperation: pendingWithdrawal, pendingOperationSlotId: 7n, pendingSettlementOperationIds: [7n] }),
			securityPools: [createSelectedPool({ questionOutcome: 'yes' })],
			selectedPoolView: 'staged-operations',
		})

		expectTransactionButtonDisabled(document.body, 'Execute staged operation')
	})

	test('renders price oracle details and request controls in the price oracle tab', async () => {
		await renderLoadedPool({ poolOracleManagerDetails: createOracleManagerDetails({ ...settledOracle, pendingReportId: 12n, requestPriceCostAttoEth: 114_800_101n }), selectedPoolView: 'price-oracle' })

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('tab', { name: 'Price oracle' }).getAttribute('aria-selected')).toBe('true')
		const priceOracleSection = documentQueries.getByRole('heading', { name: 'Price oracle' }).closest('section')
		if (!(priceOracleSection instanceof HTMLElement)) throw new Error('Expected the Price oracle section to render')
		const sectionQueries = within(priceOracleSection)
		expect(sectionQueries.getByRole('heading', { name: 'Price oracle' })).not.toBeNull()
		expect(sectionQueries.getByText('OpenOracle price')).not.toBeNull()
		expect(sectionQueries.getByText('≈ 0.00000000011 ETH').closest('[title]')?.getAttribute('title')).toBe('0.000000000114800101 ETH')
		expect(sectionQueries.queryByText('Price Window')).toBeNull()
		expect(sectionQueries.queryByText('Last Settlement')).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Request new price…' })).not.toBeNull()
		expect(sectionQueries.getByText('Pending request')).not.toBeNull()
		expect(sectionQueries.getByRole('button', { name: /Report #\s*12/ })).not.toBeNull()
	})

	test('submits the buffered ETH cost directly from the price input form', async () => {
		const requests: Array<{ managerAddress: string; reviewedRequestValueAttoEth: bigint; securityPoolAddress: string; universeId: bigint }> = []
		const pool = createSelectedPool()
		const baseProps = createLoadedPoolProps({
			accountState: fundedAccount(),
			onRequestPoolPrice: (managerAddress, securityPoolAddress, reviewedRequestValueAttoEth, universeId) => requests.push({ managerAddress, reviewedRequestValueAttoEth, securityPoolAddress, universeId }),
			poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, pendingReportId: 0n, requestPriceCostAttoEth: 2n * 10n ** 18n }),
			securityPools: [pool],
			selectedPoolView: 'price-oracle',
		})
		const { rerender } = await renderWorkflow(baseProps)

		const dialog = openPriceRequestDialog()
		expect(within(dialog).queryByText(/≈/)).toBeNull()
		expect(requests).toEqual([])

		await rerender({ ...baseProps, poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, pendingReportId: 0n, requestPriceCostAttoEth: 3n * 10n ** 18n }) })
		expect(within(dialog).queryByText('3.6 ETH')).toBeNull()

		fireEvent.input(within(dialog).getByRole('textbox', { name: 'OpenOracle REP per ETH starting price' }), { target: { value: '3' } })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Request new price' }))
		expect(requests).toEqual([{ managerAddress: pool.managerAddress, reviewedRequestValueAttoEth: 2_400_000_000_000_000_000n, securityPoolAddress: pool.securityPoolAddress, universeId: pool.universeId }])
	})

	describe('focus after a price request closes', () => {
		const baseProps = () => createLoadedPoolProps({ accountState: fundedAccount(), poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, pendingReportId: 0n }), selectedPoolView: 'price-oracle' })

		test('returns focus to the pending report when a price request closes after the request action becomes disabled', async () => {
			const props = baseProps()
			const { rerender } = await renderWorkflow(props)
			const queries = within(document.body)
			queries.getByRole('tab', { name: 'Price oracle' }).focus()
			expect(openPriceRequestDialog()).not.toBeNull()
			await rerender({ ...props, poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, pendingReportId: 2n }) })
			expect(queries.getByRole('button', { name: 'Request new price…' }).hasAttribute('disabled')).toBe(true)
			expect(document.getElementById('selected-pool-workflow-panel')?.querySelector('.workflow-metric-grid button.link')?.textContent?.trim()).toBe('Report #2')
			await act(() => fireEvent.click(queries.getByRole('button', { name: 'Close' })))
			expect(queries.queryByRole('dialog', { name: 'Request new price' })).toBeNull()
			expect(document.activeElement?.textContent?.trim()).toBe('Report #2')
		})

		test('returns focus to the price oracle heading while the new report is still loading', async () => {
			const props = baseProps()
			const { rerender } = await renderWorkflow(props)
			const queries = within(document.body)
			queries.getByRole('button', { name: 'Request new price…' }).focus()
			expect(openPriceRequestDialog()).not.toBeNull()
			await rerender({ ...props, poolOracleManagerDetails: undefined })
			expect(queries.getByRole('button', { name: 'Request new price…' }).hasAttribute('disabled')).toBe(true)
			expect(queries.queryByRole('button', { name: /Report #/ })).toBeNull()
			await act(() => fireEvent.click(queries.getByRole('button', { name: 'Close' })))
			expect(document.activeElement?.tagName).toBe('H3')
			expect(document.activeElement?.textContent?.trim()).toBe('Price oracle')
		})
	})

	test('accepts a manual REP per ETH price without requiring a Uniswap quote', async () => {
		const requests: Array<bigint | undefined> = []
		await renderLoadedPool({
			accountState: fundedAccount(),
			onRequestPoolPrice: (_manager, _pool, _value, _universe, price) => requests.push(price),
			poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, pendingReportId: 0n }),
			selectedPoolView: 'price-oracle',
		})
		const queries = within(document.body)
		const dialog = openPriceRequestDialog()
		const confirm = within(dialog).getByRole('button', { name: 'Request new price' })
		expect(getTransactionButtonState(dialog, 'Request new price').disabled).toBe(true)
		const input = queries.getByRole('textbox', { name: 'OpenOracle REP per ETH starting price' })
		expect(queries.getByRole('button', { name: 'Fetch from Uniswap' })).not.toBeNull()
		for (const value of ['0', '-1', 'abc', '0.0000000000000000001', (2n ** 256n).toString()]) {
			fireEvent.input(input, { target: { value } })
			expect(getTransactionButtonState(dialog, 'Request new price').disabled).toBe(true)
			expect(queries.getAllByText('Enter a positive REP per ETH price with up to 18 decimal places.')).toHaveLength(1)
			expect(getTransactionButtonState(dialog, 'Request new price').reason).toContain('Enter a positive REP per ETH price')
		}
		await act(() => {
			input.dispatchEvent(new Event('blur'))
		})
		const priceError = queries.getByText('Enter a positive REP per ETH price with up to 18 decimal places.')
		expect(priceError.classList.contains('field-error')).toBe(true)
		expect(queries.getAllByText('Enter a positive REP per ETH price with up to 18 decimal places.')).toHaveLength(1)
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(confirm.getAttribute('aria-describedby')).toBe(priceError.id)
		fireEvent.input(input, { target: { value: '1.25' } })
		expect(getTransactionButtonState(dialog, 'Request new price').disabled).toBe(false)
		fireEvent.click(confirm)
		expect(requests).toEqual([1_250_000_000_000_000_000n])
	})

	test('retains the reviewed pool universe when selection changes before confirming a price request', async () => {
		const requests: Array<{ securityPoolAddress: string; universeId: bigint }> = []
		const reviewedPool = createSelectedPool({ universeId: 2n })
		const newlySelectedPool = createSelectedPool({
			managerAddress: getAddress('0x00000000000000000000000000000000000000b1'),
			securityPoolAddress: getAddress('0x00000000000000000000000000000000000000b2'),
			universeId: 3n,
		})
		const baseProps = createLoadedPoolProps({
			accountState: fundedAccount(),
			activeUniverseId: reviewedPool.universeId,
			onRequestPoolPrice: (_managerAddress, securityPoolAddress, _reviewedRequestValueAttoEth, universeId) => requests.push({ securityPoolAddress, universeId }),
			poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, pendingReportId: 0n, requestPriceCostAttoEth: 2n * 10n ** 18n }),
			securityPools: [reviewedPool],
			selectedPoolView: 'price-oracle',
		})
		const { rerender } = await renderWorkflow(baseProps)

		const dialog = openPriceRequestDialog()

		await rerender({ ...baseProps, activeUniverseId: newlySelectedPool.universeId, checkedSecurityPoolAddress: newlySelectedPool.securityPoolAddress, securityPoolAddress: newlySelectedPool.securityPoolAddress, securityPools: [newlySelectedPool] })

		fireEvent.input(within(dialog).getByRole('textbox', { name: 'OpenOracle REP per ETH starting price' }), { target: { value: '3' } })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Request new price' }))
		expect(requests).toEqual([{ securityPoolAddress: reviewedPool.securityPoolAddress, universeId: reviewedPool.universeId }])
	})

	test('disables Request New Price when the wallet lacks the buffered oracle bounty ETH', async () => {
		await renderLoadedPool({
			accountState: createAccountState({ ethBalanceAttoEth: 5n * 10n ** 18n }),
			poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, pendingReportId: 0n, requestPriceCostAttoEth: 10n * 10n ** 18n }),
			selectedPoolView: 'price-oracle',
		})

		expectTransactionButtonDisabled(document.body, 'Request new price…', 'Need 7\u00a0more\u00a0ETH in this wallet to request a new price.')
	})

	test('disables Request New Price while the current oracle price remains valid', async () => {
		await renderLoadedPool({ poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, pendingReportId: 0n }), selectedPoolView: 'price-oracle' })

		expectTransactionButtonDisabled(document.body, 'Request new price…', 'The current oracle price is still valid.')
	})

	test('enables Request New Price when the shared chain time reaches a loaded price expiry', async () => {
		await renderLoadedPool(
			{
				accountState: fundedAccount(),
				poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastSettlementTimestamp: 700n, pendingReportId: 0n, priceValidUntilTimestamp: 1000n, requestPriceCostAttoEth: 1n }),
				selectedPoolView: 'price-oracle',
			},
			{ chainTimestamp: 1000n },
		)

		const requestButton = within(document.body).getByRole('button', { name: 'Request new price…' })
		if (!(requestButton instanceof HTMLButtonElement)) throw new Error('Expected Request New Price button')
		expect(requestButton.disabled).toBe(false)
		expect(requestButton.classList.contains('primary')).toBe(true)
		const refresh = within(document.body).getByRole('button', { name: 'Refresh oracle' })
		expect(refresh.closest('.metric-field-value')).not.toBeNull()
		expect(document.body.textContent).toContain('(expired less than a minute ago)')
		expect(document.body.textContent).not.toContain('The current oracle price is still valid.')
	})

	test('uses the lifted selected pool view state and reports tab changes through the shared setter', async () => {
		const selectedViews: string[] = []
		await renderLoadedPool({
			onSelectedPoolViewChange: view => {
				selectedViews.push(view ?? '')
			},
			selectedPoolView: 'reporting',
		})

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('tab', { name: 'Reporting' }).getAttribute('aria-selected')).toBe('true')

		expect(documentQueries.queryByRole('tab', { name: 'Withdraw Escalation Deposits' })).toBeNull()
		expect(selectedViews).toEqual([])
	})

	test('shows the shared question card above reporting without empty positions', async () => {
		await renderLoadedPool({ selectedPoolView: 'reporting' })

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Question' })).toBeNull()
		const objectHeader = document.body.querySelector('.selected-pool-object-header')
		if (!(objectHeader instanceof HTMLElement)) throw new Error('Expected the selected-pool object header')
		expect(within(objectHeader).getByRole('heading', { name: 'Will this resolve?' })).not.toBeNull()
		expect(documentQueries.getAllByText('Question description')).toHaveLength(1)
		expect(documentQueries.queryByRole('heading', { name: 'Your positions' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Report outcome' })).not.toBeNull()
	})
})
