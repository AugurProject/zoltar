import { describe, expect, test } from 'bun:test'
import { createStagedOperationsFixture, useSecurityPoolWorkflowSectionTestDom } from './fixture'

describe('SecurityPoolWorkflowSection: staged operations', () => {
	const testDom = useSecurityPoolWorkflowSectionTestDom()

	const { setCleanup } = testDom

	const fixture = createStagedOperationsFixture()

	const { fireEvent, within, act, zeroAddress, SecurityPoolWorkflowSection, renderIntoDocument, createAccountState, createReportingProps, createSecurityVaultProps, createSecurityVaultDetails, createOracleManagerDetails, createMarketDetails, createSelectedPool, createSecurityPoolWorkflowProps } = fixture

	describe('queueing and execution feedback', () => {
		test('refreshes staged operations after queueing a vault withdrawal', async () => {
			const loadPoolOracleManagerCalls: string[] = []
			const selectedPoolAddress = zeroAddress
			const managerAddress = '0x00000000000000000000000000000000000000aa'
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						onLoadPoolOracleManager: managerAddressInput => {
							loadPoolOracleManagerCalls.push(managerAddressInput)
						},
						poolOracleManagerDetails: createOracleManagerDetails({ managerAddress }),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ managerAddress, securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							securityVaultResult: {
								action: 'queueWithdrawRep',
								hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
								stagedExecution: {
									errorMessage: undefined,
									operation: 'withdrawRep',
									operationId: 7n,
									success: true,
								},
							},
						}),
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(loadPoolOracleManagerCalls).toEqual([managerAddress])
		})

		test('keeps the withdraw modal open and links to the queued staged operation', async () => {
			const selectedViews: string[] = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						onSelectedPoolViewChange: view => {
							selectedViews.push(view ?? '')
						},
						poolOracleManagerDetails: createOracleManagerDetails({
							pendingOperation: {
								amount: 5n * 10n ** 18n,
								initiatorVault: zeroAddress,
								operation: 'withdrawRep',
								operationId: 7n,
								targetVault: zeroAddress,
							},
							pendingOperationSlotId: 7n,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							securityVaultDetails: createSecurityVaultDetails(),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '1',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
							securityVaultResult: {
								action: 'queueWithdrawRep',
								hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			expect(documentQueries.queryByText('A REP withdrawal was queued for the selected vault.')).toBeNull()
			expect(documentQueries.queryByText('Next: Review the queued entry in Staged Operations and execute it when the oracle price is valid.')).toBeNull()

			await act(() => {
				fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
			})

			const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
			const dialogQueries = within(withdrawDialog)
			expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Queued' })).not.toBeNull()
			expect(dialogQueries.getByText('#7')).not.toBeNull()
			expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Queued' }).closest('.actions')).toBeNull()

			await act(() => {
				fireEvent.click(dialogQueries.getByRole('button', { name: 'View In Staged Operations' }))
			})

			expect(selectedViews).toEqual(['staged-operations'])
			expect(dialogQueries.getByRole('heading', { name: 'Withdraw REP' })).not.toBeNull()
			expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Queued' })).not.toBeNull()
		})

		test('shows manual execution guidance for overflow queued withdrawals', async () => {
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: false,
							pendingOperation: {
								amount: 3n * 10n ** 18n,
								initiatorVault: zeroAddress,
								operation: 'liquidation',
								operationId: 6n,
								targetVault: '0x0000000000000000000000000000000000000001',
							},
							pendingOperationSlotId: 6n,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							securityVaultDetails: createSecurityVaultDetails(),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '1',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
							securityVaultResult: {
								action: 'queueWithdrawRep',
								hash: '0x00000000000000000000000000000000000000000000000000000000000000bc',
								queuedOperation: {
									isPendingSlot: false,
									operation: 'withdrawRep',
									operationId: 11n,
								},
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			await act(() => {
				fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
			})

			const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
			const dialogQueries = within(withdrawDialog)
			expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Queued' })).not.toBeNull()
			expect(dialogQueries.getByText('#11')).not.toBeNull()
			expect(dialogQueries.getByText('The settlement auto-execute list is full. Execute this staged operation manually with its ID after a valid oracle price is available.')).not.toBeNull()
		})

		test('shows immediate execution when a withdraw uses an already valid oracle price', async () => {
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							pendingOperation: undefined,
							pendingOperationSlotId: 0n,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							securityVaultDetails: createSecurityVaultDetails(),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '1',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
							securityVaultResult: {
								action: 'queueWithdrawRep',
								hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			await act(() => {
				fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
			})

			const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
			const dialogQueries = within(withdrawDialog)
			expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Executed' })).not.toBeNull()
			expect(dialogQueries.queryByRole('button', { name: 'View In Staged Operations' })).toBeNull()
			expect(dialogQueries.getByText('A valid oracle price was already available, so the withdrawal executed immediately and no staged operation was created.')).not.toBeNull()
		})

		test('shows withdraw failure details when the staged execution event reports a rejection', async () => {
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							pendingOperation: undefined,
							pendingOperationSlotId: 0n,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							securityVaultDetails: createSecurityVaultDetails(),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '10000',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
							securityVaultResult: {
								action: 'queueWithdrawRep',
								hash: '0x00000000000000000000000000000000000000000000000000000000000000be',
								stagedExecution: {
									errorMessage: 'Local Security Bond Allowance broken',
									operation: 'withdrawRep',
									operationId: 8n,
									success: false,
								},
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const documentQueries = within(document.body)
			await act(() => {
				fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
			})

			const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
			const dialogQueries = within(withdrawDialog)
			expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Failed' })).not.toBeNull()
			expect(dialogQueries.getByText('Local Security Bond Allowance broken')).not.toBeNull()
			expect(dialogQueries.queryByRole('button', { name: 'View In Staged Operations' })).toBeNull()
		})

		test('shows liquidation successful in the selected pool workflow after an immediate execution', async () => {
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						liquidationManagerAddress: zeroAddress,
						liquidationSecurityPoolAddress: selectedPoolAddress,
						liquidationTargetVault: zeroAddress,
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							managerAddress: zeroAddress,
							pendingOperation: undefined,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPoolOverviewResult: {
							action: 'queueLiquidation',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000c1',
							securityPoolAddress: selectedPoolAddress,
						},
						securityPools: [createSelectedPool({ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress })],
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const dialog = within(document.body).getByRole('dialog', { name: 'Execute Vault Liquidation' })
			const dialogQueries = within(dialog)
			expect(dialogQueries.getByRole('heading', { name: 'Liquidation Executed' })).not.toBeNull()
			expect(dialogQueries.getByText('A valid oracle price was already available, so the liquidation executed immediately and no staged operation was created.')).not.toBeNull()
		})

		test('shows liquidation failed in the selected pool workflow with the revert detail', async () => {
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						liquidationManagerAddress: zeroAddress,
						liquidationSecurityPoolAddress: selectedPoolAddress,
						liquidationTargetVault: zeroAddress,
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							managerAddress: zeroAddress,
							pendingOperation: undefined,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPoolOverviewResult: {
							action: 'queueLiquidation',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000c2',
							securityPoolAddress: selectedPoolAddress,
							stagedExecution: {
								errorMessage: 'Local Security Bond Allowance broken',
								operation: 'liquidation',
								operationId: 13n,
								success: false,
							},
						},
						securityPools: [createSelectedPool({ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress })],
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			const dialog = within(document.body).getByRole('dialog', { name: 'Execute Vault Liquidation' })
			const dialogQueries = within(dialog)
			expect(dialogQueries.getByRole('heading', { name: 'Liquidation Failed' })).not.toBeNull()
			expect(dialogQueries.getByText('Local Security Bond Allowance broken')).not.toBeNull()
		})
	})

	describe('refresh side effects', () => {
		test('refreshes the selected pool and loaded vault after an immediate REP withdrawal execution', async () => {
			const refreshSelectedPoolCalls: Array<string | undefined> = []
			const loadSecurityVaultCalls: Array<string | undefined> = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshSelectedPoolCalls.push(securityPoolAddressInput)
						},
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							pendingOperation: undefined,
							pendingOperationSlotId: 0n,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							onLoadSecurityVault: vaultAddress => {
								loadSecurityVaultCalls.push(vaultAddress)
							},
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '1',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
							securityVaultResult: {
								action: 'queueWithdrawRep',
								hash: '0x00000000000000000000000000000000000000000000000000000000000000dd',
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
			expect(loadSecurityVaultCalls).toEqual([undefined])
		})

		test('refreshes the selected pool and loaded vault after withdrawing escalation deposits from reporting', async () => {
			const refreshSelectedPoolCalls: Array<string | undefined> = []
			const loadSecurityVaultCalls: Array<string | undefined> = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshSelectedPoolCalls.push(securityPoolAddressInput)
						},
						reporting: createReportingProps({
							reportingResult: {
								action: 'withdrawEscalation',
								hash: '0x00000000000000000000000000000000000000000000000000000000000000de',
								outcome: 'yes',
								securityPoolAddress: selectedPoolAddress,
								universeId: 1n,
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							onLoadSecurityVault: vaultAddress => {
								loadSecurityVaultCalls.push(vaultAddress)
							},
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
						}),
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
			expect(loadSecurityVaultCalls).toEqual([undefined])
		})

		test('refreshes loaded reporting after depositing REP into the selected vault', async () => {
			const refreshSelectedPoolCalls: Array<string | undefined> = []
			const reportingLoadCalls: string[] = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshSelectedPoolCalls.push(securityPoolAddressInput)
						},
						reporting: createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls.push('refresh')
							},
							reportingDetails: {
								completeSetCollateralAmount: 1n,
								currentTime: 3n,
								forkThreshold: 10n,
								marketDetails: createMarketDetails({ endTime: 0n }),
								nonDecisionThreshold: 20n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								startBond: 1n,
								status: 'not-started',
								systemState: 'operational',
								universeId: 1n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
								viewerVaultAvailableEscalationRep: 12_000n,
								viewerVaultExists: true,
								viewerVaultEscrowedRep: 0n,
								viewerVaultRepDepositShare: 12_000n,
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
							securityVaultResult: {
								action: 'depositRep',
								hash: '0x00000000000000000000000000000000000000000000000000000000000000df',
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
			expect(reportingLoadCalls).toEqual(['refresh'])
		})

		test('refreshes the selected pool and loaded vault after a liquidation resolves as queued', async () => {
			const refreshSelectedPoolCalls: Array<string | undefined> = []
			const loadSecurityVaultCalls: Array<string | undefined> = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						liquidationManagerAddress: zeroAddress,
						liquidationSecurityPoolAddress: selectedPoolAddress,
						liquidationTargetVault: zeroAddress,
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshSelectedPoolCalls.push(securityPoolAddressInput)
						},
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: false,
							managerAddress: zeroAddress,
							pendingOperation: {
								amount: 1n,
								initiatorVault: zeroAddress,
								operation: 'liquidation',
								operationId: 10n,
								targetVault: zeroAddress,
							},
							pendingOperationSlotId: 10n,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPoolOverviewResult: {
							action: 'queueLiquidation',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000d1',
							securityPoolAddress: selectedPoolAddress,
						},
						securityPools: [createSelectedPool({ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							onLoadSecurityVault: vaultAddress => {
								loadSecurityVaultCalls.push(vaultAddress)
							},
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
			expect(loadSecurityVaultCalls).toEqual([undefined])
		})

		test('refreshes the selected pool and loaded vault after an immediate liquidation execution', async () => {
			const refreshSelectedPoolCalls: Array<string | undefined> = []
			const loadSecurityVaultCalls: Array<string | undefined> = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						liquidationManagerAddress: zeroAddress,
						liquidationSecurityPoolAddress: selectedPoolAddress,
						liquidationTargetVault: zeroAddress,
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshSelectedPoolCalls.push(securityPoolAddressInput)
						},
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							managerAddress: zeroAddress,
							pendingOperation: undefined,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPoolOverviewResult: {
							action: 'queueLiquidation',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000d2',
							securityPoolAddress: selectedPoolAddress,
						},
						securityPools: [createSelectedPool({ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							onLoadSecurityVault: vaultAddress => {
								loadSecurityVaultCalls.push(vaultAddress)
							},
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
			expect(loadSecurityVaultCalls).toEqual([undefined])
		})

		test('refreshes the selected pool and loaded vault after a failed immediate liquidation execution', async () => {
			const refreshSelectedPoolCalls: Array<string | undefined> = []
			const loadSecurityVaultCalls: Array<string | undefined> = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						liquidationManagerAddress: zeroAddress,
						liquidationSecurityPoolAddress: selectedPoolAddress,
						liquidationTargetVault: zeroAddress,
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshSelectedPoolCalls.push(securityPoolAddressInput)
						},
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							managerAddress: zeroAddress,
							pendingOperation: undefined,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPoolOverviewResult: {
							action: 'queueLiquidation',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000d3',
							securityPoolAddress: selectedPoolAddress,
							stagedExecution: {
								errorMessage: 'Local Security Bond Allowance broken',
								operation: 'liquidation',
								operationId: 14n,
								success: false,
							},
						},
						securityPools: [createSelectedPool({ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							onLoadSecurityVault: vaultAddress => {
								loadSecurityVaultCalls.push(vaultAddress)
							},
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
			expect(loadSecurityVaultCalls).toEqual([undefined])
		})

		test('refreshes the selected pool and loaded vault after executing a staged operation', async () => {
			const refreshSelectedPoolCalls: Array<string | undefined> = []
			const loadSecurityVaultCalls: Array<string | undefined> = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshSelectedPoolCalls.push(securityPoolAddressInput)
						},
						poolPriceOracleResult: {
							action: 'executeStagedOperation',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000cc',
						},
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							onLoadSecurityVault: vaultAddress => {
								loadSecurityVaultCalls.push(vaultAddress)
							},
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
			expect(loadSecurityVaultCalls).toEqual([undefined])
		})

		test('refreshes loaded reporting after executing a staged REP withdrawal', async () => {
			const refreshSelectedPoolCalls: Array<string | undefined> = []
			const reportingLoadCalls: string[] = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshSelectedPoolCalls.push(securityPoolAddressInput)
						},
						poolPriceOracleResult: {
							action: 'executeStagedOperation',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000cf',
							stagedExecution: {
								errorMessage: undefined,
								operation: 'withdrawRep',
								operationId: 15n,
								success: true,
							},
						},
						reporting: createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls.push('refresh')
							},
							reportingDetails: {
								completeSetCollateralAmount: 1n,
								currentTime: 3n,
								forkThreshold: 10n,
								marketDetails: createMarketDetails({ endTime: 0n }),
								nonDecisionThreshold: 20n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								startBond: 1n,
								status: 'not-started',
								systemState: 'operational',
								universeId: 1n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
								viewerVaultAvailableEscalationRep: 12_000n,
								viewerVaultExists: true,
								viewerVaultEscrowedRep: 0n,
								viewerVaultRepDepositShare: 12_000n,
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '1',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
			expect(reportingLoadCalls).toEqual(['refresh'])
		})

		test('refreshes the selected pool after a failed staged operation execution', async () => {
			const refreshSelectedPoolCalls: Array<string | undefined> = []
			const loadSecurityVaultCalls: Array<string | undefined> = []
			const selectedPoolAddress = zeroAddress
			const renderedComponent = await renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState(),
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshSelectedPoolCalls.push(securityPoolAddressInput)
						},
						poolPriceOracleResult: {
							action: 'executeStagedOperation',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000ce',
							stagedExecution: {
								errorMessage: 'Local Security Bond Allowance broken',
								operation: 'withdrawRep',
								operationId: 12n,
								success: false,
							},
						},
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							managerAddress: zeroAddress,
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							onLoadSecurityVault: vaultAddress => {
								loadSecurityVaultCalls.push(vaultAddress)
							},
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
							securityVaultForm: {
								depositAmount: '',
								repWithdrawAmount: '',
								securityBondAllowanceAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultAddress: zeroAddress,
							},
						}),
						selectedPoolView: 'staged-operations',
					})}
					showHeader={false}
				/>,
			)
			setCleanup(renderedComponent.cleanup)

			expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
			expect(loadSecurityVaultCalls).toEqual([])
		})
	})
})
