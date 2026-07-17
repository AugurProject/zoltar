import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import type { OracleOperationBounty } from '../../../../types/contracts.js'
import { createReportingAndOracleFixture, useSecurityPoolWorkflowSectionTestDom } from './fixture'

describe('SecurityPoolWorkflowSection: reporting and oracle', () => {
	const testDom = useSecurityPoolWorkflowSectionTestDom()
	const { setCleanup } = testDom
	const fixture = createReportingAndOracleFixture()
	const {
		fireEvent,
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

	test('defers future reporting actions until the market has ended', async () => {
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
		expect(documentQueries.queryByRole('heading', { name: 'Escalation Metrics' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report Outcome' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Withdraw Escalation Deposits' })).toBeNull()
		expect(documentQueries.queryByText('Load reporting details to populate live stakes, bond progression, and deposit indexes.')).toBeNull()
		expect(documentQueries.queryByText('Reporting unlocks after the market end timestamp for the selected pool.')).toBeNull()
		expect(documentQueries.queryByText(expectedLockedReason)).not.toBeNull()
		expect(document.body.querySelectorAll('.escalation-side')).toHaveLength(0)
		expect(document.body.textContent?.includes('Your deposits: None')).toBe(false)
		expect(document.body.textContent?.includes('Projected payout for current amount')).toBe(false)
		expect(document.body.textContent?.includes('Projected profit if this side wins')).toBe(false)

		expect(documentQueries.queryByRole('button', { name: 'Report On Selected Side' })).toBeNull()
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
		expect(documentQueries.getByRole('heading', { name: 'Reporting Not Enabled' })).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Report On Selected Side' })).toBeNull()
		expect(documentQueries.queryByText(getReportingLockedUntilMessage(100n, 100n))).not.toBeNull()
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

	test('keeps self-funded requests and exposes creator, operator, claim, and refund bounty controls', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const otherAddress = getAddress('0x00000000000000000000000000000000000000b2')
		const repToken = getAddress('0x00000000000000000000000000000000000000c3')
		const wethToken = getAddress('0x00000000000000000000000000000000000000d4')
		const loadedBountyIds: Array<{ bountyId: bigint; managerAddress: Address }> = []
		const refundedBountyIds: Array<{ bountyId: bigint; managerAddress: Address }> = []
		let clearedLookupErrors = 0
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1_000n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState({ address: walletAddress }),
						checkedSecurityPoolAddress: zeroAddress,
						poolOracleManagerDetails: createOracleManagerDetails({
							operationBountyBoardAddress: otherAddress,
							operationBounties: [
								{
									acceptanceDeadline: 2_000n,
									amount: 2n * 10n ** 18n,
									bountyId: 4n,
									creator: otherAddress,
									executionErrorMessage: undefined,
									executionStatus: 'none',
									maximumInitialWeth: 4n * 10n ** 18n,
									minimumInitialWeth: 2n * 10n ** 18n,
									operation: 'liquidation',
									operationId: 0n,
									operator: zeroAddress,
									refundAvailableAt: undefined,
									reportId: 0n,
									rewardAmount: 1n * 10n ** 18n,
									rewardToken: repToken,
									state: 'open',
									targetVault: otherAddress,
									validForSeconds: 300n,
								},
								{
									acceptanceDeadline: 2_000n,
									amount: 5n * 10n ** 18n,
									bountyId: 3n,
									creator: walletAddress,
									executionErrorMessage: undefined,
									executionStatus: 'none',
									maximumInitialWeth: 0n,
									minimumInitialWeth: 0n,
									operation: 'setSecurityBondsAllowance',
									operationId: 0n,
									operator: zeroAddress,
									refundAvailableAt: undefined,
									reportId: 0n,
									rewardAmount: 2n * 10n ** 18n,
									rewardToken: wethToken,
									state: 'open',
									targetVault: walletAddress,
									validForSeconds: 300n,
								},
								{
									acceptanceDeadline: 2_000n,
									amount: 1n * 10n ** 18n,
									bountyId: 2n,
									creator: otherAddress,
									executionErrorMessage: undefined,
									executionStatus: 'succeeded',
									maximumInitialWeth: 0n,
									minimumInitialWeth: 0n,
									operation: 'liquidation',
									operationId: 8n,
									operator: walletAddress,
									refundAvailableAt: undefined,
									reportId: 4n,
									rewardAmount: 3n * 10n ** 18n,
									rewardToken: repToken,
									state: 'assigned',
									targetVault: otherAddress,
									validForSeconds: 300n,
								},
								{
									acceptanceDeadline: 2_000n,
									amount: 1n * 10n ** 18n,
									bountyId: 1n,
									creator: walletAddress,
									executionErrorMessage: 'oracle report exposure exceeded',
									executionStatus: 'failed',
									maximumInitialWeth: 0n,
									minimumInitialWeth: 0n,
									operation: 'withdrawRep',
									operationId: 7n,
									operator: otherAddress,
									refundAvailableAt: undefined,
									reportId: 4n,
									rewardAmount: 1n * 10n ** 18n,
									rewardToken: wethToken,
									state: 'assigned',
									targetVault: walletAddress,
									validForSeconds: 300n,
								},
							],
							reputationTokenAddress: repToken,
							wethAddress: wethToken,
						}),
						poolOracleActiveAction: 'acceptOperationBounty',
						poolOracleActiveBountyId: 3n,
						onLoadPoolOperationBounty: (managerAddress, bountyId) => loadedBountyIds.push({ bountyId, managerAddress }),
						onClearPoolOperationBountyLookupError: () => {
							clearedLookupErrors += 1
						},
						onRefundPoolOperationBounty: (managerAddress, bountyId) => refundedBountyIds.push({ bountyId, managerAddress }),
						poolOperationBountyLookupError: 'Operation bounty #99 does not exist',
						securityPoolAddress: zeroAddress,
						securityPools: [createSelectedPool()],
						selectedPoolView: 'price-oracle',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Self-funded price request' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Request New Price' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Operation Bounties', level: 3 })).not.toBeNull()
		expect(documentQueries.getByText('Acceptance revalidates the operation and, when the price is stale, requires room in the four-operation settlement batch.')).not.toBeNull()
		expect(documentQueries.getByText("Optional bounds apply to either a proposed new report's WETH amount or the current WETH amount of an existing pending report.")).not.toBeNull()
		expect(documentQueries.getByText('The cancellation deadline is fixed when accepted: queued time + one oracle settlement window + this execution window. Disputes do not extend it.')).not.toBeNull()
		const operationPicker = documentQueries.getByRole('combobox', { name: 'Operation' })
		expect(documentQueries.getByLabelText('Amount (ETH)')).not.toBeNull()
		fireEvent.change(operationPicker, { currentTarget: { value: 'withdrawRep' }, target: { value: 'withdrawRep' } })
		expect(documentQueries.getByLabelText('Amount (REP)')).not.toBeNull()
		fireEvent.change(operationPicker, { currentTarget: { value: 'liquidation' }, target: { value: 'liquidation' } })
		expect(documentQueries.getByLabelText('Amount (ETH)')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Operation bounties', level: 4 })).not.toBeNull()
		expect(documentQueries.getByRole('alert').textContent).toContain('Operation bounty #99 does not exist')
		fireEvent.input(documentQueries.getByLabelText('Bounty ID'), { currentTarget: { value: '1' }, target: { value: '1' } })
		expect(clearedLookupErrors).toBe(1)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Load Bounty' }))
		expect(loadedBountyIds).toEqual([{ bountyId: 1n, managerAddress: zeroAddress }])
		const boundedBountyHeading = documentQueries.getByRole('heading', { name: 'Bounty #4 · Liquidation', level: 5 })
		const allowanceBountyHeading = documentQueries.getByRole('heading', { name: 'Bounty #3 · Set Bond Allowance', level: 5 })
		const liquidationBountyHeading = documentQueries.getByRole('heading', { name: 'Bounty #2 · Liquidation', level: 5 })
		const withdrawalBountyHeading = documentQueries.getByRole('heading', { name: 'Bounty #1 · Withdraw REP', level: 5 })
		const boundedBountyCard = boundedBountyHeading.closest('article')
		const allowanceBountyCard = allowanceBountyHeading.closest('article')
		const liquidationBountyCard = liquidationBountyHeading.closest('article')
		const withdrawalBountyCard = withdrawalBountyHeading.closest('article')
		if (boundedBountyCard === null || allowanceBountyCard === null || liquidationBountyCard === null || withdrawalBountyCard === null) throw new Error('Expected bounty headings to be nested in bounty cards')
		expect(within(allowanceBountyCard).getByText('≈ 5.00 ETH')).not.toBeNull()
		expect(within(allowanceBountyCard).getByText('No minimum')).not.toBeNull()
		expect(within(allowanceBountyCard).getByText('No maximum')).not.toBeNull()
		expect(within(liquidationBountyCard).getByText('≈ 1.00 ETH')).not.toBeNull()
		expect(within(boundedBountyCard).getByText('≈ 2.00 WETH')).not.toBeNull()
		expect(within(boundedBountyCard).getByText('≈ 4.00 WETH')).not.toBeNull()
		expect(within(withdrawalBountyCard).getByText('≈ 1.00 REP')).not.toBeNull()
		fireEvent.click(within(withdrawalBountyCard).getByRole('button', { name: 'Cancel & Refund' }))
		expect(refundedBountyIds).toEqual([{ bountyId: 1n, managerAddress: zeroAddress }])
		expect(documentQueries.getByRole('button', { name: 'Post Bounty' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Accepting bounty…' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Accept & Fund Report' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Claim Bounty' })).not.toBeNull()
		expect(documentQueries.getAllByRole('button', { name: /Refund|Cancel & Refund/ })).toHaveLength(2)
	})

	test('distinguishes exact bounty deadlines from strictly expired acceptance and execution states', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const otherAddress = getAddress('0x00000000000000000000000000000000000000b2')
		const createBounty = (bountyId: bigint, overrides: Partial<OracleOperationBounty>): OracleOperationBounty => ({
			acceptanceDeadline: 1_000n,
			amount: 0n,
			bountyId,
			creator: walletAddress,
			executionErrorMessage: undefined,
			executionStatus: 'none',
			maximumInitialWeth: 0n,
			minimumInitialWeth: 0n,
			operation: 'setSecurityBondsAllowance',
			operationId: 0n,
			operator: zeroAddress,
			refundAvailableAt: undefined,
			reportId: 0n,
			rewardAmount: 1n,
			rewardToken: otherAddress,
			state: 'open',
			targetVault: walletAddress,
			validForSeconds: 300n,
			...overrides,
		})
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1_000n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState({ address: walletAddress }),
						checkedSecurityPoolAddress: zeroAddress,
						poolOracleManagerDetails: createOracleManagerDetails({
							operationBountyBoardAddress: otherAddress,
							operationBounties: [
								createBounty(4n, {}),
								createBounty(3n, { acceptanceDeadline: 999n }),
								createBounty(2n, {
									executionStatus: 'pending',
									operationId: 2n,
									operator: walletAddress,
									refundAvailableAt: 1_000n,
									reportId: 1n,
									state: 'assigned',
								}),
								createBounty(1n, {
									executionStatus: 'pending',
									operationId: 1n,
									operator: walletAddress,
									refundAvailableAt: 999n,
									reportId: 1n,
									state: 'assigned',
								}),
							],
							reputationTokenAddress: otherAddress,
							wethAddress: otherAddress,
						}),
						securityPoolAddress: zeroAddress,
						securityPools: [createSelectedPool()],
						selectedPoolView: 'price-oracle',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const exactAcceptanceCard = documentQueries.getByRole('heading', { name: 'Bounty #4 · Set Bond Allowance', level: 5 }).closest('article')
		const expiredAcceptanceCard = documentQueries.getByRole('heading', { name: 'Bounty #3 · Set Bond Allowance', level: 5 }).closest('article')
		const exactExecutionCard = documentQueries.getByRole('heading', { name: 'Bounty #2 · Set Bond Allowance', level: 5 }).closest('article')
		const expiredExecutionCard = documentQueries.getByRole('heading', { name: 'Bounty #1 · Set Bond Allowance', level: 5 }).closest('article')
		if (exactAcceptanceCard === null || expiredAcceptanceCard === null || exactExecutionCard === null || expiredExecutionCard === null) throw new Error('Expected deadline test bounties to render as cards')
		expect(within(exactAcceptanceCard).getByText('Open')).not.toBeNull()
		expect(within(expiredAcceptanceCard).getByText('Acceptance expired')).not.toBeNull()
		expectTransactionButtonDisabled(expiredAcceptanceCard, 'Accept & Fund Report', 'This bounty’s acceptance window has expired.')
		expect(within(exactExecutionCard).getByText('In progress')).not.toBeNull()
		expectTransactionButtonDisabled(exactExecutionCard, 'Claim Bounty', 'Wait for the staged operation to execute successfully.')
		expect(within(expiredExecutionCard).getByText('Execution expired')).not.toBeNull()
		expectTransactionButtonDisabled(expiredExecutionCard, 'Claim Bounty', 'Expired operation bounties cannot be claimed.')
		const expiredRefundButton = within(expiredExecutionCard).getByRole('button', { name: 'Cancel & Refund' })
		if (!(expiredRefundButton instanceof HTMLButtonElement)) throw new Error('Expected expired bounty refund button')
		expect(expiredRefundButton.disabled).toBe(false)
	})

	test('disables stale-price bounty acceptance for a full settlement queue while preserving fresh-price execution', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const tokenAddress = getAddress('0x00000000000000000000000000000000000000b2')
		const openBounty: OracleOperationBounty = {
			acceptanceDeadline: 2_000n,
			amount: 0n,
			bountyId: 1n,
			creator: walletAddress,
			executionErrorMessage: undefined,
			executionStatus: 'none',
			maximumInitialWeth: 0n,
			minimumInitialWeth: 0n,
			operation: 'setSecurityBondsAllowance',
			operationId: 0n,
			operator: zeroAddress,
			refundAvailableAt: undefined,
			reportId: 0n,
			rewardAmount: 1n,
			rewardToken: tokenAddress,
			state: 'open',
			targetVault: walletAddress,
			validForSeconds: 300n,
		}
		const createWorkflow = (isPriceValid: boolean) => (
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ address: walletAddress }),
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid,
						operationBountyBoardAddress: tokenAddress,
						operationBounties: [openBounty],
						pendingSettlementOperationIds: [1n, 2n, 3n, 4n],
						pendingSettlementQueueCapacity: 4n,
						reputationTokenAddress: tokenAddress,
						wethAddress: tokenAddress,
					}),
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'price-oracle',
				})}
				showHeader={false}
			/>
		)
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1_000n}>
				<div data-testid='stale-full-queue'>{createWorkflow(false)}</div>
				<div data-testid='fresh-full-queue'>{createWorkflow(true)}</div>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		const staleSurface = document.body.querySelector('[data-testid="stale-full-queue"]')
		const freshSurface = document.body.querySelector('[data-testid="fresh-full-queue"]')
		if (!(staleSurface instanceof HTMLElement) || !(freshSurface instanceof HTMLElement)) throw new Error('Expected stale and fresh queue fixtures')
		expectTransactionButtonDisabled(staleSurface, 'Accept & Fund Report', 'This bounty cannot be accepted while the pending settlement queue is full.')
		const freshAcceptButton = within(freshSurface).getByRole('button', { name: 'Accept & Fund Report' })
		if (!(freshAcceptButton instanceof HTMLButtonElement)) throw new Error('Expected fresh-price bounty acceptance button')
		expect(freshAcceptButton.disabled).toBe(false)
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
