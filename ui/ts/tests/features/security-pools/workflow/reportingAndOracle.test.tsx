import { describe, expect, test } from 'bun:test'
import { createReportingAndOracleFixture, useSecurityPoolWorkflowSectionTestDom } from './fixture'

describe('SecurityPoolWorkflowSection: reporting and oracle', () => {
	const testDom = useSecurityPoolWorkflowSectionTestDom()
	const { setCleanup } = testDom
	const fixture = createReportingAndOracleFixture()
	const {
		within,
		getAddress,
		zeroAddress,
		SecurityPoolWorkflowSection,
		ChainTimestampContext,
		getReportingLockedUntilMessage,
		renderIntoDocument,
		expectTransactionButtonDisabled,
		createAccountState,
		createReportingProps,
		createOracleManagerDetails,
		createMarketDetails,
		createSelectedPool,
		createSecurityPoolWorkflowProps,
	} = fixture

	test('hides the truth auction metric when the selected pool has no truth auction address', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					activeUniverseId: 1n,
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [
						createSelectedPool({
							systemState: 'poolForked',
							truthAuctionAddress: zeroAddress,
						}),
					],
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const selectedPoolSummary = document.body.querySelector('.selected-pool-context-summary')
		if (!(selectedPoolSummary instanceof HTMLElement)) throw new Error('Expected selected pool summary')
		const summaryLabels = Array.from(selectedPoolSummary.querySelectorAll('.metric-label')).map(element => element.textContent?.trim() ?? '')
		expect(summaryLabels).not.toContain('Truth Auction')
	})

	test('shows disabled reporting actions before market end instead of a placeholder message', async () => {
		const futureMarket = createMarketDetails({ endTime: 1_700_003_600n })
		const expectedLockedReason = getReportingLockedUntilMessage(futureMarket.endTime, 1_700_000_000n)
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1_700_000_000n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						securityPoolAddress: zeroAddress,
						securityPools: [createSelectedPool({ marketDetails: futureMarket })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByRole('heading', { name: 'Question' }).length).toBe(1)
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Reporting Not Enabled' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Outcome Sides' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Escalation Metrics' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Report Outcome' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Withdraw Escalation Deposits' })).toBeNull()
		expect(documentQueries.queryByText('Load reporting details to populate live stakes, bond progression, and deposit indexes.')).toBeNull()
		expect(documentQueries.queryByText('Reporting unlocks after the market end timestamp for the selected pool.')).toBeNull()
		expect(documentQueries.queryByText(expectedLockedReason)).not.toBeNull()
		expect(document.body.querySelectorAll('.escalation-side')).toHaveLength(3)
		expect(document.body.textContent?.includes('Your deposits: None')).toBe(false)
		expect(document.body.textContent?.includes('Projected payout for current amount')).toBe(false)
		expect(document.body.textContent?.includes('Projected profit if this side wins')).toBe(false)

		const reportButton = documentQueries.getByRole('button', { name: 'Report On Selected Side' }) as HTMLButtonElement
		expect(reportButton.disabled).toBe(true)
		expect(reportButton.title).toBe(expectedLockedReason)
	})

	test('locks reporting actions while the selected pool is not operational', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1_700_000_000n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						reporting: createReportingProps({
							reportingDetails: {
								activationTime: 1_699_999_000n,
								bindingCapital: 5n,
								completeSetCollateralAmount: 1n,
								currentRequiredBond: 2n,
								currentTime: 1_700_000_000n,
								escalationEndTime: 1_700_000_500n,
								escalationGameAddress: zeroAddress,
								forkThreshold: 10n,
								hasReachedNonDecision: false,
								marketDetails: createMarketDetails({ endTime: 0n }),
								nonDecisionThreshold: 20n,
								questionOutcome: 'none',
								securityPoolAddress: zeroAddress,
								sides: [
									{ balance: 1n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
									{ balance: 5n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
									{ balance: 2n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
								],
								startBond: 1n,
								status: 'active',
								systemState: 'forkTruthAuction',
								totalCost: 2n,
								universeId: 1n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
								viewerVaultAvailableEscalationRep: 10n,
								viewerVaultExists: true,
								viewerVaultEscrowedRep: 0n,
								viewerVaultRepDepositShare: 10n,
							},
						}),
						securityPoolAddress: zeroAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: zeroAddress, systemState: 'forkTruthAuction' })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const reportButton = documentQueries.getByRole('button', { name: 'Report On Selected Side' })
		if (!(reportButton instanceof HTMLButtonElement)) throw new Error('Expected report button')
		expect(reportButton.disabled).toBe(true)
		expect(reportButton.title).toBe('This pool is in truth auction. Reporting actions unlock once the pool becomes operational.')
	})

	test('uses the shared chain timestamp context for oracle expiry text', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1n + 5n * 60n + 60n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						securityPoolAddress: zeroAddress,
						securityPools: [
							createSelectedPool({
								lastOraclePrice: 3n * 10n ** 18n,
								lastOracleSettlementTimestamp: 1n,
							}),
						],
						selectedPoolView: 'price-oracle',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		expect(document.body.textContent?.includes('(expired 1m ago)')).toBe(true)
	})

	test('uses the shared chain timestamp context to unlock reporting after market end', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={150n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						securityPoolAddress: zeroAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 100n }) })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const reportButton = documentQueries.getByRole('button', { name: 'Report On Selected Side' }) as HTMLButtonElement
		expect(reportButton.disabled).toBe(true)
		expect(reportButton.title).toBe('Load reporting details before reporting on an outcome.')
	})

	test('keeps reporting disabled at the exact market end timestamp', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={100n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						securityPoolAddress: zeroAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 100n }) })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const reportButton = documentQueries.getByRole('button', { name: 'Report On Selected Side' }) as HTMLButtonElement
		expect(reportButton.disabled).toBe(true)
		expect(reportButton.title).toBe(getReportingLockedUntilMessage(100n, 100n))
	})

	test('renders staged operations management inside the staged operations tab instead of a standalone section', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
						pendingSettlementOperationIds: [],
						pendingSettlementQueueCapacity: 4n,
						pendingReportId: 0n,
						priceValidUntilTimestamp: 1000n,
						queuedOperationEthCost: 1n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('button', { name: 'Staged Operations' }) as HTMLElement).getAttribute('aria-pressed')).toBe('true')
		expect(documentQueries.getByRole('heading', { name: 'Staged Operations' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Pool Oracle & Pending Operations' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Staged Operations List' })).not.toBeNull()
		expect(documentQueries.getByText('No staged operations are currently queued for this pool.')).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Request New Price' })).toBeNull()
	})

	test('lists staged operations in the staged operations tab', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						activeStagedOperationCount: 4n,
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: {
							amount: 5n * 10n ** 18n,
							initiatorVault: zeroAddress,
							operation: 'withdrawRep',
							operationId: 7n,
							targetVault: zeroAddress,
						},
						pendingOperationSlotId: 7n,
						pendingSettlementOperationIds: [7n],
						pendingSettlementQueueCapacity: 4n,
						pendingReportId: 12n,
						priceValidUntilTimestamp: 1000n,
						queuedOperationEthCost: 1n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Withdraw REP')).not.toBeNull()
		expect(documentQueries.getByText('Auto-exec pending')).not.toBeNull()
		expect(documentQueries.getByText('7')).not.toBeNull()
		expect(documentQueries.getByText('Showing 1 of 4 active staged operations, newest first.')).not.toBeNull()
		expect(documentQueries.queryByText('Pending Price Request')).toBeNull()
	})

	test('does not show staged-operation cancellation actions', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const targetVault = getAddress('0x00000000000000000000000000000000000000a2')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ address: walletAddress }),
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						pendingOperation: {
							amount: 1n,
							initiatorVault: walletAddress,
							operation: 'liquidation',
							operationId: 9n,
							targetVault,
						},
						pendingOperationSlotId: 9n,
					}),
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Cancel Staged Operation' })).toBeNull()
	})

	test('blocks staged-operation execution after the selected pool has ended', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: {
							amount: 5n * 10n ** 18n,
							initiatorVault: zeroAddress,
							operation: 'withdrawRep',
							operationId: 7n,
							targetVault: zeroAddress,
						},
						pendingOperationSlotId: 7n,
						pendingSettlementOperationIds: [7n],
						pendingSettlementQueueCapacity: 4n,
						pendingReportId: 0n,
						priceValidUntilTimestamp: 1000n,
						queuedOperationEthCost: 1n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [
						createSelectedPool({
							questionOutcome: 'yes',
						}),
					],
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		expectTransactionButtonDisabled(document.body, 'Execute Staged Operation')
	})

	test('renders price oracle details and request controls in the price oracle tab', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
						pendingSettlementOperationIds: [],
						pendingSettlementQueueCapacity: 4n,
						pendingReportId: 12n,
						priceValidUntilTimestamp: 1000n,
						queuedOperationEthCost: 1n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'price-oracle',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('button', { name: 'Open Oracle' }) as HTMLElement).getAttribute('aria-pressed')).toBe('true')
		const priceOracleSection = documentQueries.getByRole('heading', { name: 'Open Oracle' }).closest('section')
		if (!(priceOracleSection instanceof HTMLElement)) throw new Error('Expected the Open Oracle section to render')
		const sectionQueries = within(priceOracleSection)
		expect(sectionQueries.getByRole('heading', { name: 'Open Oracle' })).not.toBeNull()
		expect(sectionQueries.getByText('Open Oracle Price')).not.toBeNull()
		expect(sectionQueries.queryByText('Price Window')).toBeNull()
		expect(sectionQueries.queryByText('Last Settlement')).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Request New Price' })).not.toBeNull()
		expect(sectionQueries.getByText('Pending Request')).not.toBeNull()
		expect(sectionQueries.getByRole('button', { name: /Report #\s*12/ })).not.toBeNull()
	})

	test('disables Request New Price when the wallet lacks the buffered oracle bounty ETH', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalance: 5n * 10n ** 18n }),
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						pendingReportId: 0n,
						requestPriceEthCost: 10n * 10n ** 18n,
					}),
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'price-oracle',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		expectTransactionButtonDisabled(document.body, 'Request New Price', 'Need 7 more ETH in this wallet to request a new price.')
	})

	test('uses the lifted selected pool view state and reports tab changes through the shared setter', async () => {
		const selectedViews: string[] = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					onSelectedPoolViewChange: view => {
						selectedViews.push(view ?? '')
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('button', { name: 'Reporting' }) as HTMLElement).getAttribute('aria-pressed')).toBe('true')

		expect(documentQueries.queryByRole('tab', { name: 'Withdraw Escalation Deposits' })).toBeNull()
		expect(selectedViews).toEqual([])
	})

	test('shows the shared question card above the reporting tab, including settlement controls', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByRole('heading', { name: 'Question' }).length).toBe(1)
		expect(documentQueries.getByRole('heading', { name: 'Settle Escalation Deposits' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Report Outcome' })).not.toBeNull()
	})
})
