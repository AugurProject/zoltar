import { describe, expect, test } from 'bun:test'
import { createForkWorkflowStateFixture, useSecurityPoolWorkflowSectionTestDom } from './fixture'

describe('SecurityPoolWorkflowSection: fork workflow state', () => {
	const testDom = useSecurityPoolWorkflowSectionTestDom()

	const { setCleanup } = testDom

	const fixture = createForkWorkflowStateFixture()

	const {
		fireEvent,
		waitFor,
		within,
		render,
		act,
		getAddress,
		zeroAddress,
		SecurityPoolWorkflowSection,
		ChainTimestampContext,
		renderIntoDocument,
		expectTransactionButtonEnabled,
		createReportingProps,
		createForkAuctionProps,
		createForkAuctionDetails,
		createMarketDetails,
		createSelectedPool,
		createSecurityPoolWorkflowProps,
	} = fixture

	describe('stage navigation', () => {
		test('does not offer Open Fork Workflow before the pool has entered its fork workflow', async () => {
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						reporting: createReportingProps({
							reportingDetails: {
								activationTime: 120n,
								bindingCapital: 10n,
								completeSetCollateralAmount: 1n,
								currentRequiredBond: 2n,
								currentTime: 150n,
								escalationEndTime: 300n,
								escalationGameAddress: zeroAddress,
								forkThreshold: 40n,
								hasReachedNonDecision: true,
								marketDetails: createMarketDetails({ endTime: 2n }),
								nonDecisionThreshold: 20n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								sides: [
									{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
									{
										balance: 20n,
										deposits: [],
										importedUserDeposits: [],
										key: 'yes',
										label: 'Yes',
										userDeposits: [
											{
												amount: 1n,
												cumulativeAmount: 1n,
												depositIndex: 0n,
												depositor: zeroAddress,
											},
										],
									},
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
								],
								startBond: 1n,
								status: 'active',
								systemState: 'operational',
								totalCost: 40n,
								universeId: 1n,
								viewerVaultAvailableEscalationRep: 12_000n,
								viewerVaultExists: true,
								viewerVaultEscrowedRep: 2n,
								viewerVaultRepDepositShare: 12_000n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 2n }), securityPoolAddress: selectedPoolAddress, systemState: 'operational' })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			expect(documentQueries.queryByRole('button', { name: 'Open Fork Workflow' })).toBeNull()
		})

		test('opens the concrete migration stage when the pool is already inside its fork workflow', async () => {
			const selectedViews: string[] = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						forkAuction: createForkAuctionProps({
							forkAuctionDetails: createForkAuctionDetails({
								forkOutcome: 'yes',
								hasForkActivity: true,
								marketDetails: createMarketDetails({ endTime: 2n }),
								migratedRep: 1n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								systemState: 'poolForked',
							}),
						}),
						onSelectedPoolViewChange: view => {
							selectedViews.push(view ?? '')
						},
						reporting: createReportingProps({
							reportingDetails: {
								activationTime: 120n,
								bindingCapital: 10n,
								completeSetCollateralAmount: 1n,
								currentRequiredBond: 2n,
								currentTime: 150n,
								escalationEndTime: 300n,
								escalationGameAddress: zeroAddress,
								forkThreshold: 40n,
								hasReachedNonDecision: true,
								marketDetails: createMarketDetails({ endTime: 2n }),
								nonDecisionThreshold: 20n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								sides: [
									{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
								],
								startBond: 1n,
								status: 'active',
								systemState: 'operational',
								totalCost: 40n,
								universeId: 1n,
								viewerVaultAvailableEscalationRep: 12_000n,
								viewerVaultExists: true,
								viewerVaultEscrowedRep: 2n,
								viewerVaultRepDepositShare: 12_000n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ forkOutcome: 'yes', marketDetails: createMarketDetails({ endTime: 2n }), migratedRep: 1n, securityPoolAddress: selectedPoolAddress, systemState: 'poolForked' })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			await act(() => {
				fireEvent.click(documentQueries.getByRole('tab', { name: 'Fork Workflow' }))
			})

			expect(selectedViews).toEqual(['fork-workflow'])
		})

		test('defaults the fork workflow to the current stage on first render', async () => {
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						forkAuction: createForkAuctionProps({
							forkAuctionDetails: createForkAuctionDetails({
								forkOutcome: 'yes',
								migratedRep: 1n,
								securityPoolAddress: selectedPoolAddress,
								systemState: 'forkTruthAuction',
								truthAuctionStartedAt: 1n,
							}),
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [
							createSelectedPool({
								forkOutcome: 'yes',
								migratedRep: 1n,
								securityPoolAddress: selectedPoolAddress,
								systemState: 'forkTruthAuction',
								truthAuctionStartedAt: 1n,
							}),
						],
						selectedPoolView: 'fork-workflow',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			expect(documentQueries.getByRole('heading', { name: 'Truth Auction Status' })).not.toBeNull()
			expect(documentQueries.queryByRole('heading', { name: 'Fork Triggered' })).toBeNull()
			expect(documentQueries.getByRole('tab', { name: 'Truth Auction' }).className.includes('is-selected')).toBe(true)
		})

		test('opens the migration step for root-universe pools that present as Fork Migration after universe fork', async () => {
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						securityPoolAddress: selectedPoolAddress,
						securityPools: [
							createSelectedPool({
								securityPoolAddress: selectedPoolAddress,
								systemState: 'operational',
								universeHasForked: true,
							}),
						],
						selectedPoolView: 'fork-migration',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			expect(documentQueries.getByRole('heading', { name: 'Migration Status' })).not.toBeNull()
			expect(documentQueries.getByRole('tab', { name: 'Migration' }).className.includes('is-selected')).toBe(true)
			expect(document.body.textContent?.includes('This step becomes active once the fork has been triggered.')).toBe(false)
		})

		test('advances the selected fork workflow panel when fresh fork details load a later current stage', async () => {
			const selectedPoolAddress = zeroAddress
			const baseProps = createSecurityPoolWorkflowProps({
				checkedSecurityPoolAddress: selectedPoolAddress,
				forkAuction: createForkAuctionProps(),
				securityPoolAddress: selectedPoolAddress,
				securityPools: [
					createSelectedPool({
						forkOutcome: 'yes',
						migratedRep: 1n,
						securityPoolAddress: selectedPoolAddress,
						systemState: 'operational',
						truthAuctionStartedAt: 1n,
					}),
				],
				selectedPoolView: 'fork-workflow',
			})
			const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />)
			setCleanup(renderedComponent.cleanup)

			let documentQueries = within(document.body)
			expect(documentQueries.getByRole('heading', { name: 'Settlement Status' })).not.toBeNull()
			expect(documentQueries.getByRole('tab', { name: 'Settlement' }).className.includes('is-selected')).toBe(true)

			await act(async () => {
				render(
					<SecurityPoolWorkflowSection
						{...baseProps}
						forkAuction={createForkAuctionProps({
							forkAuctionDetails: createForkAuctionDetails({
								claimingAvailable: false,
								forkOutcome: 'yes',
								migratedRep: 1n,
								securityPoolAddress: selectedPoolAddress,
								systemState: 'operational',
								truthAuction: {
									accumulatedEth: 0n,
									auctionEndsAt: 10n,
									clearingPrice: 1n,
									clearingTick: 0n,
									ethAtClearingTick: 0n,
									ethRaiseCap: 1n,
									ethRaised: 0n,
									finalized: true,
									hitCap: false,
									maxRepBeingSold: 1n,
									minBidSize: 1n,
									repPurchasableAtBid: undefined,
									timeRemaining: 0n,
									totalRepPurchased: 0n,
									underfunded: false,
								},
								truthAuctionStartedAt: 1n,
							}),
						})}
						showHeader={false}
					/>,
					renderedComponent.container,
				)
			})

			documentQueries = within(document.body)
			expect(documentQueries.getByRole('heading', { name: 'Settlement Status' })).not.toBeNull()
			expect(documentQueries.getByRole('heading', { name: 'Child Security Pools' })).not.toBeNull()
			expect(documentQueries.getByRole('tab', { name: 'Settlement' }).className.includes('is-selected')).toBe(true)
			expect(documentQueries.queryByRole('tab', { name: 'New Security Pools' })).toBeNull()
		})
	})

	describe('reporting triggers and stale state', () => {
		test('shows Trigger Zoltar Fork in the reporting workflow after non-decision', async () => {
			let triggerZoltarForkCalls = 0
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						forkAuction: createForkAuctionProps({
							onForkWithOwnEscalation: () => {
								triggerZoltarForkCalls += 1
							},
						}),
						reporting: createReportingProps({
							reportingDetails: {
								activationTime: 120n,
								bindingCapital: 10n,
								completeSetCollateralAmount: 1n,
								currentRequiredBond: 2n,
								currentTime: 150n,
								escalationEndTime: 300n,
								escalationGameAddress: zeroAddress,
								forkThreshold: 40n,
								hasReachedNonDecision: true,
								marketDetails: createMarketDetails({ endTime: 2n }),
								nonDecisionThreshold: 20n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								sides: [
									{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
								],
								startBond: 1n,
								status: 'active',
								systemState: 'operational',
								totalCost: 40n,
								universeId: 1n,
								viewerVaultAvailableEscalationRep: 12_000n,
								viewerVaultExists: true,
								viewerVaultEscrowedRep: 2n,
								viewerVaultRepDepositShare: 12_000n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 2n }), securityPoolAddress: selectedPoolAddress, systemState: 'operational' })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			expectTransactionButtonEnabled(document.body, 'Trigger Zoltar Fork')

			await act(() => {
				fireEvent.click(documentQueries.getByRole('button', { name: 'Trigger Zoltar Fork' }))
			})

			expect(triggerZoltarForkCalls).toBe(1)
		})

		test('hides Trigger Zoltar Fork after the pool has already entered its fork workflow and keeps Open Fork Workflow available', async () => {
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						forkAuction: createForkAuctionProps({
							forkAuctionDetails: createForkAuctionDetails({
								forkOutcome: 'yes',
								hasForkActivity: true,
								marketDetails: createMarketDetails({ endTime: 2n }),
								migratedRep: 1n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								systemState: 'poolForked',
							}),
						}),
						reporting: createReportingProps({
							reportingDetails: {
								activationTime: 120n,
								bindingCapital: 10n,
								completeSetCollateralAmount: 1n,
								currentRequiredBond: 2n,
								currentTime: 150n,
								escalationEndTime: 300n,
								escalationGameAddress: zeroAddress,
								forkThreshold: 40n,
								hasReachedNonDecision: true,
								marketDetails: createMarketDetails({ endTime: 2n }),
								nonDecisionThreshold: 20n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								sides: [
									{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
								],
								startBond: 1n,
								status: 'active',
								systemState: 'operational',
								totalCost: 40n,
								universeId: 1n,
								viewerVaultAvailableEscalationRep: 12_000n,
								viewerVaultExists: true,
								viewerVaultEscrowedRep: 2n,
								viewerVaultRepDepositShare: 12_000n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ forkOutcome: 'yes', marketDetails: createMarketDetails({ endTime: 2n }), migratedRep: 1n, securityPoolAddress: selectedPoolAddress, systemState: 'poolForked' })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			expect(documentQueries.queryByRole('button', { name: 'Trigger Zoltar Fork' })).toBeNull()
			expect(documentQueries.getByRole('tab', { name: 'Fork Workflow' })).not.toBeNull()
			expect(document.body.textContent?.includes('Fork Migration')).toBe(true)
		})

		test('prefers fresh fork-auction activity over stale pool-list state on the fork tab', async () => {
			let reportingLoadCalls = 0
			const selectedPoolAddress = zeroAddress
			const freshTruthAuctionAddress = getAddress('0x00000000000000000000000000000000000000f1')
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						forkAuction: createForkAuctionProps({
							forkAuctionDetails: createForkAuctionDetails({
								completeSetCollateralAmount: 2n,
								forkOutcome: 'yes',
								forkOwnSecurityPool: true,
								marketDetails: createMarketDetails({ endTime: 2n }),
								migratedRep: 5n,
								securityPoolAddress: selectedPoolAddress,
								systemState: 'operational',
								truthAuctionAddress: freshTruthAuctionAddress,
							}),
						}),
						reporting: createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ completeSetCollateralAmount: 0n, marketDetails: createMarketDetails({ endTime: 2n }), securityPoolAddress: selectedPoolAddress, systemState: 'operational', truthAuctionAddress: zeroAddress })],
						selectedPoolView: 'fork-migration',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			const selectedPoolSummary = document.body.querySelector('.selected-pool-context-summary')
			if (!(selectedPoolSummary instanceof HTMLElement)) throw new Error('Expected selected pool summary to render')
			const selectedPoolSummaryQueries = within(selectedPoolSummary)
			expect(reportingLoadCalls).toBe(0)
			expect(documentQueries.queryByText('This pool is currently operational, so fork and truth auction actions are read only.')).toBeNull()
			expect(selectedPoolSummaryQueries.queryByText('Fork Mode')).toBeNull()
			expect(selectedPoolSummaryQueries.queryByText('Fork Outcome')).toBeNull()
			expect(selectedPoolSummary.textContent?.includes(freshTruthAuctionAddress)).toBe(false)
		})

		test('prefers fresh operational selected-pool state over stale fork-auction details on the fork tab', async () => {
			let forkAuctionLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f2')
			const staleTruthAuctionAddress = getAddress('0x00000000000000000000000000000000000000f3')
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						forkAuction: createForkAuctionProps({
							forkAuctionDetails: createForkAuctionDetails({
								completeSetCollateralAmount: 2n,
								forkOutcome: 'yes',
								forkOwnSecurityPool: true,
								marketDetails: createMarketDetails({ endTime: 2n }),
								migratedRep: 5n,
								securityPoolAddress: selectedPoolAddress,
								systemState: 'forkTruthAuction',
								truthAuctionAddress: staleTruthAuctionAddress,
								truthAuctionStartedAt: 10n,
							}),
							onLoadForkAuction: () => {
								forkAuctionLoadCalls += 1
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ forkOutcome: 'yes', marketDetails: createMarketDetails({ endTime: 2n }), migratedRep: 5n, securityPoolAddress: selectedPoolAddress, systemState: 'operational', truthAuctionStartedAt: 10n })],
						selectedPoolView: 'fork-workflow',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			const selectedPoolSummary = document.body.querySelector('.selected-pool-context-summary')
			if (!(selectedPoolSummary instanceof HTMLElement)) throw new Error('Expected selected pool summary to render')
			const settlementStageTab = documentQueries.getByRole('tab', { name: 'Settlement' })
			expect(forkAuctionLoadCalls).toBe(1)
			expect(settlementStageTab.getAttribute('aria-current')).toBe('step')
			expect(selectedPoolSummary.textContent?.includes(staleTruthAuctionAddress)).toBe(false)
		})

		test('reloads fork-auction details instead of trusting stale same-address operational details after the pool enters fork mode', async () => {
			let forkAuctionLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000fa')
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						forkAuction: createForkAuctionProps({
							forkAuctionDetails: createForkAuctionDetails({
								completeSetCollateralAmount: 2n,
								forkOutcome: 'yes',
								forkOwnSecurityPool: true,
								hasForkActivity: true,
								marketDetails: createMarketDetails({ endTime: 2n }),
								migratedRep: 5n,
								questionOutcome: 'yes',
								securityPoolAddress: selectedPoolAddress,
								systemState: 'operational',
								truthAuctionStartedAt: 0n,
							}),
							onLoadForkAuction: () => {
								forkAuctionLoadCalls += 1
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ hasForkActivity: true, marketDetails: createMarketDetails({ endTime: 2n }), questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress, systemState: 'forkTruthAuction', truthAuctionStartedAt: 10n })],
						selectedPoolView: 'fork-workflow',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(forkAuctionLoadCalls).toBe(1)
		})

		test('reloads reporting instead of trusting stale same-address reporting details once the pool is operational again', async () => {
			let reportingLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f4')
			const renderedComponent = await renderIntoDocument(
				<ChainTimestampContext.Provider value={150n}>
					<SecurityPoolWorkflowSection
						{...createSecurityPoolWorkflowProps({
							checkedSecurityPoolAddress: selectedPoolAddress,
							reporting: createReportingProps({
								onLoadReporting: () => {
									reportingLoadCalls += 1
								},
								reportingDetails: {
									activationTime: 120n,
									bindingCapital: 10n,
									completeSetCollateralAmount: 1n,
									currentRequiredBond: 2n,
									currentTime: 150n,
									escalationEndTime: 300n,
									escalationGameAddress: zeroAddress,
									forkThreshold: 40n,
									hasReachedNonDecision: false,
									marketDetails: createMarketDetails({ endTime: 2n }),
									nonDecisionThreshold: 20n,
									questionOutcome: 'none',
									securityPoolAddress: selectedPoolAddress,
									sides: [
										{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
										{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
										{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
									],
									startBond: 1n,
									status: 'active',
									systemState: 'forkTruthAuction',
									totalCost: 40n,
									universeId: 1n,
									viewerVaultAvailableEscalationRep: 12_000n,
									viewerVaultExists: true,
									viewerVaultEscrowedRep: 2n,
									viewerVaultRepDepositShare: 12_000n,
									settlementState: 'locked',
									parentWithdrawalEnabled: false,
								},
								reportingForm: {
									reportAmount: '',
									securityPoolAddress: selectedPoolAddress,
									selectedOutcome: undefined,
									selectedWithdrawDepositIndexesByOutcome: {
										invalid: [],
										yes: [],
										no: [],
									},
								},
							}),
							securityPoolAddress: selectedPoolAddress,
							securityPools: [createSelectedPool({ forkOutcome: 'yes', hasForkActivity: true, marketDetails: createMarketDetails({ endTime: 2n }), questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress, systemState: 'operational', truthAuctionStartedAt: 10n })],
							selectedPoolView: 'reporting',
						})}
						showHeader={false}
					/>
				</ChainTimestampContext.Provider>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			await waitFor(() => {
				expect(reportingLoadCalls).toBe(1)
			})
			expect(document.body.textContent?.includes('This pool is in truth auction. Reporting actions unlock once the pool becomes operational.')).toBe(false)
			expect(documentQueries.queryByText('Market finalized as Yes')).toBeNull()
		})

		test('reloads reporting instead of trusting stale same-address operational reporting details after the pool enters fork mode', async () => {
			let reportingLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000fb')
			const renderedComponent = await renderIntoDocument(
				<ChainTimestampContext.Provider value={150n}>
					<SecurityPoolWorkflowSection
						{...createSecurityPoolWorkflowProps({
							checkedSecurityPoolAddress: selectedPoolAddress,
							reporting: createReportingProps({
								onLoadReporting: () => {
									reportingLoadCalls += 1
								},
								reportingDetails: {
									activationTime: 120n,
									bindingCapital: 10n,
									completeSetCollateralAmount: 1n,
									currentRequiredBond: 2n,
									currentTime: 150n,
									escalationEndTime: 300n,
									escalationGameAddress: zeroAddress,
									forkThreshold: 40n,
									hasReachedNonDecision: false,
									marketDetails: createMarketDetails({ endTime: 2n }),
									nonDecisionThreshold: 20n,
									questionOutcome: 'yes',
									securityPoolAddress: selectedPoolAddress,
									sides: [
										{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
										{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
										{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
									],
									startBond: 1n,
									status: 'active',
									systemState: 'operational',
									totalCost: 40n,
									universeId: 1n,
									viewerVaultAvailableEscalationRep: 12_000n,
									viewerVaultExists: true,
									viewerVaultEscrowedRep: 2n,
									viewerVaultRepDepositShare: 12_000n,
									settlementState: 'resolved',
									parentWithdrawalEnabled: true,
								},
								reportingForm: {
									reportAmount: '',
									securityPoolAddress: selectedPoolAddress,
									selectedOutcome: undefined,
									selectedWithdrawDepositIndexesByOutcome: {
										invalid: [],
										yes: [],
										no: [],
									},
								},
							}),
							securityPoolAddress: selectedPoolAddress,
							securityPools: [createSelectedPool({ hasForkActivity: true, marketDetails: createMarketDetails({ endTime: 2n }), questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress, systemState: 'forkTruthAuction' })],
							selectedPoolView: 'reporting',
						})}
						showHeader={false}
					/>
				</ChainTimestampContext.Provider>,
			)
			setCleanup(renderedComponent.cleanup)

			await waitFor(() => {
				expect(reportingLoadCalls).toBe(1)
			})
		})
	})

	describe('refresh-driven reloads', () => {
		test('reloads same-address reporting details after a selected-pool refresh', async () => {
			let reportingLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f5')
			const baseProps = createSecurityPoolWorkflowProps({
				checkedSecurityPoolAddress: selectedPoolAddress,
				reporting: createReportingProps({
					onLoadReporting: () => {
						reportingLoadCalls += 1
					},
					reportingDetails: {
						activationTime: 120n,
						bindingCapital: 10n,
						completeSetCollateralAmount: 1n,
						currentRequiredBond: 2n,
						currentTime: 150n,
						escalationEndTime: 300n,
						escalationGameAddress: zeroAddress,
						forkThreshold: 40n,
						hasReachedNonDecision: false,
						marketDetails: createMarketDetails({ endTime: 2n }),
						nonDecisionThreshold: 20n,
						questionOutcome: 'yes',
						securityPoolAddress: selectedPoolAddress,
						sides: [
							{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						startBond: 1n,
						status: 'active',
						systemState: 'operational',
						totalCost: 40n,
						universeId: 1n,
						viewerVaultAvailableEscalationRep: 12_000n,
						viewerVaultExists: true,
						viewerVaultEscrowedRep: 2n,
						viewerVaultRepDepositShare: 12_000n,
						settlementState: 'resolved',
						parentWithdrawalEnabled: true,
					},
					reportingForm: {
						reportAmount: '',
						securityPoolAddress: selectedPoolAddress,
						selectedOutcome: undefined,
						selectedWithdrawDepositIndexesByOutcome: {
							invalid: [],
							yes: [],
							no: [],
						},
					},
				}),
				securityPoolAddress: selectedPoolAddress,
				securityPools: [createSelectedPool({ hasForkActivity: false, marketDetails: createMarketDetails({ endTime: 2n }), questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress, systemState: 'operational' })],
				selectedPoolView: 'reporting',
				selectedPoolRefreshNonce: 0,
			})

			const renderedComponent = await renderIntoDocument(
				<ChainTimestampContext.Provider value={150n}>
					<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />
				</ChainTimestampContext.Provider>,
			)
			setCleanup(renderedComponent.cleanup)
			expect(reportingLoadCalls).toBe(0)

			await act(() => {
				render(
					<ChainTimestampContext.Provider value={150n}>
						<SecurityPoolWorkflowSection {...baseProps} selectedPoolRefreshNonce={1} showHeader={false} />
					</ChainTimestampContext.Provider>,
					renderedComponent.container,
				)
			})

			await waitFor(() => {
				expect(reportingLoadCalls).toBe(1)
			})
		})

		test('reloads same-address fork auction details after a selected-pool refresh', async () => {
			let forkAuctionLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f6')
			const baseProps = createSecurityPoolWorkflowProps({
				checkedSecurityPoolAddress: selectedPoolAddress,
				forkAuction: createForkAuctionProps({
					forkAuctionDetails: createForkAuctionDetails({
						completeSetCollateralAmount: 2n,
						forkOutcome: 'yes',
						forkOwnSecurityPool: true,
						hasForkActivity: true,
						marketDetails: createMarketDetails({ endTime: 2n }),
						migratedRep: 5n,
						questionOutcome: 'yes',
						securityPoolAddress: selectedPoolAddress,
						systemState: 'operational',
						truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f7'),
					}),
					onLoadForkAuction: () => {
						forkAuctionLoadCalls += 1
					},
				}),
				securityPoolAddress: selectedPoolAddress,
				securityPools: [createSelectedPool({ hasForkActivity: true, marketDetails: createMarketDetails({ endTime: 2n }), questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress, systemState: 'operational', truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f7') })],
				selectedPoolView: 'fork-workflow',
				selectedPoolRefreshNonce: 0,
			})

			const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />)
			setCleanup(renderedComponent.cleanup)
			expect(forkAuctionLoadCalls).toBe(0)

			await act(() => {
				render(<SecurityPoolWorkflowSection {...baseProps} selectedPoolRefreshNonce={1} showHeader={false} />, renderedComponent.container)
			})

			await waitFor(() => {
				expect(forkAuctionLoadCalls).toBe(1)
			})
		})
	})
})
