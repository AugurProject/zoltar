import { describe, expect, test } from 'bun:test'
import { createRefreshAutoloadFixture, useSecurityPoolWorkflowSectionTestDom } from './fixture'

describe('SecurityPoolWorkflowSection: refresh and autoload', () => {
	const testDom = useSecurityPoolWorkflowSectionTestDom()
	const { setCleanup } = testDom
	const fixture = createRefreshAutoloadFixture()
	const { render, act, getAddress, zeroAddress, SecurityPoolWorkflowSection, ChainTimestampContext, renderIntoDocument, createAccountState, createReportingProps, createSecurityVaultProps, createSecurityVaultDetails, createForkAuctionProps, createMarketDetails, createSelectedPool, createSecurityPoolWorkflowProps } =
		fixture

	test('autoloads reporting once after the reporting form pool matches the selected pool', async () => {
		let reportingLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const stalePoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			reporting: createReportingProps({
				onLoadReporting: () => {
					reportingLoadCalls += 1
				},
				reportingForm: {
					reportAmount: '',
					securityPoolAddress: '',
					selectedOutcome: 'yes',
					selectedWithdrawDepositIndexesByOutcome: {
						invalid: [],
						yes: [],
						no: [],
					},
				},
			}),
			securityPoolAddress: selectedPoolAddress,
			securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress: selectedPoolAddress })],
			selectedPoolView: 'reporting',
		})

		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1n}>
				<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)
		expect(reportingLoadCalls).toBe(0)

		await act(async () => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<SecurityPoolWorkflowSection
						{...baseProps}
						reporting={createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
							reportingForm: {
								reportAmount: '',
								securityPoolAddress: stalePoolAddress,
								selectedOutcome: 'yes',
								selectedWithdrawDepositIndexesByOutcome: {
									invalid: [],
									yes: [],
									no: [],
								},
							},
						})}
						showHeader={false}
					/>
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(0)

		await act(async () => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<SecurityPoolWorkflowSection
						{...baseProps}
						reporting={createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
							reportingForm: {
								reportAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedOutcome: 'yes',
								selectedWithdrawDepositIndexesByOutcome: {
									invalid: [],
									yes: [],
									no: [],
								},
							},
						})}
						showHeader={false}
					/>
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(1)

		await act(async () => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<SecurityPoolWorkflowSection
						{...baseProps}
						reporting={createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
							reportingForm: {
								reportAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedOutcome: 'yes',
								selectedWithdrawDepositIndexesByOutcome: {
									invalid: [],
									yes: [],
									no: [],
								},
							},
						})}
						showHeader={false}
					/>
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(1)
	})

	test('re-arms reporting autoload after leaving and re-entering the reporting tab', async () => {
		let reportingLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const reportingProps = createReportingProps({
			onLoadReporting: () => {
				reportingLoadCalls += 1
			},
			reportingForm: {
				reportAmount: '',
				securityPoolAddress: selectedPoolAddress,
				selectedOutcome: 'yes',
				selectedWithdrawDepositIndexesByOutcome: {
					invalid: [],
					yes: [],
					no: [],
				},
			},
		})
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			reporting: reportingProps,
			securityPoolAddress: selectedPoolAddress,
			securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress: selectedPoolAddress })],
		})

		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1n}>
				<SecurityPoolWorkflowSection {...baseProps} selectedPoolView='reporting' showHeader={false} />
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)
		expect(reportingLoadCalls).toBe(1)

		await act(async () => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<SecurityPoolWorkflowSection {...baseProps} selectedPoolView='vaults' showHeader={false} />
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(1)

		await act(async () => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<SecurityPoolWorkflowSection {...baseProps} selectedPoolView='reporting' showHeader={false} />
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(2)
	})

	test('retries fork autoload on rerender until matching details are available', async () => {
		let forkLoadCalls = 0
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: zeroAddress,
			forkAuction: createForkAuctionProps({
				onLoadForkAuction: () => {
					forkLoadCalls += 1
				},
			}),
			securityPoolAddress: zeroAddress,
			securityPools: [createSelectedPool()],
			selectedPoolView: 'fork-migration',
		})

		const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />)
		setCleanup(renderedComponent.cleanup)
		expect(forkLoadCalls).toBe(1)

		await act(async () => {
			render(
				<SecurityPoolWorkflowSection
					{...baseProps}
					forkAuction={createForkAuctionProps({
						onLoadForkAuction: () => {
							forkLoadCalls += 1
						},
					})}
					showHeader={false}
				/>,
				renderedComponent.container,
			)
		})

		expect(forkLoadCalls).toBe(2)
	})

	test('refreshes the selected pool and current vault after finalized auction settlement', async () => {
		const selectedPoolAddress = zeroAddress
		let refreshedPoolAddress: string | undefined
		let vaultLoadCalls = 0
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionResult: {
							action: 'claimAuctionProceeds',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000ca',
							securityPoolAddress: selectedPoolAddress,
							universeId: 1n,
						},
					}),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshedPoolAddress = securityPoolAddressInput
					},
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: () => {
							vaultLoadCalls += 1
						},
						securityVaultDetails: createSecurityVaultDetails({
							securityPoolAddress: selectedPoolAddress,
							vaultAddress: zeroAddress,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'fork-migration',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		expect(refreshedPoolAddress).toBe(selectedPoolAddress)
		expect(vaultLoadCalls).toBe(1)
	})

	test('refreshes the selected pool after starting truth auction', async () => {
		const selectedPoolAddress = zeroAddress
		let refreshedPoolAddress: string | undefined
		const loadedForkAuctionAddresses: string[] = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						onLoadForkAuction: securityPoolAddressOverride => {
							if (securityPoolAddressOverride !== undefined) loadedForkAuctionAddresses.push(securityPoolAddressOverride)
						},
						forkAuctionResult: {
							action: 'startTruthAuction',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000cc',
							securityPoolAddress: selectedPoolAddress,
							universeId: 1n,
						},
					}),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshedPoolAddress = securityPoolAddressInput
					},
					securityPoolAddress: selectedPoolAddress,
					selectedPoolView: 'fork-migration',
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		expect(refreshedPoolAddress).toBe(selectedPoolAddress)
		expect(loadedForkAuctionAddresses).toContain(selectedPoolAddress)
	})

	test('reloads reporting after claiming parent escalation deposits in the fork workflow', async () => {
		const selectedPoolAddress = zeroAddress
		let reportingLoadCalls = 0
		let refreshedPoolAddress: string | undefined
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						forkAuction: createForkAuctionProps({
							forkAuctionResult: {
								action: 'claimParentEscalationDeposits',
								hash: '0x00000000000000000000000000000000000000000000000000000000000000cb',
								securityPoolAddress: selectedPoolAddress,
								universeId: 1n,
							},
						}),
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshedPoolAddress = securityPoolAddressInput
						},
						reporting: createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
							reportingDetails: {
								activationTime: 0n,
								bindingCapital: 0n,
								completeSetCollateralAmount: 0n,
								currentRequiredBond: 0n,
								currentTime: 1n,
								escalationEndTime: 2n,
								escalationGameAddress: zeroAddress,
								forkThreshold: 0n,
								hasReachedNonDecision: false,
								marketDetails: createMarketDetails({ endTime: 0n }),
								nonDecisionThreshold: 0n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								sides: [
									{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
									{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
									{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
								],
								startBond: 0n,
								status: 'active',
								systemState: 'operational',
								totalCost: 0n,
								universeId: 1n,
								viewerVaultAvailableEscalationRep: 0n,
								viewerVaultExists: true,
								viewerVaultEscrowedRep: 0n,
								viewerVaultRepDepositShare: 0n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
							},
							reportingForm: {
								reportAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedOutcome: 'yes',
								selectedWithdrawDepositIndexesByOutcome: {
									invalid: [],
									yes: [],
									no: [],
								},
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress: selectedPoolAddress })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		expect(refreshedPoolAddress).toBe(selectedPoolAddress)
		expect(reportingLoadCalls).toBe(1)
	})
})
