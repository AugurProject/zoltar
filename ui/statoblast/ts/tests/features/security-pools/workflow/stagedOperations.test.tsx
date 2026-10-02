import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import type { ReportingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { SecurityPoolStagedOperationsSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolOracleSections.js'
import type { SecurityPoolWorkflowRouteContentProps, SecurityVaultRouteContentProps } from '@zoltar/ui-zoltar-shared/features/types.js'
import { createMarketDetails, createOracleManagerDetails, createReportingProps, createSecurityPoolWorkflowProps, createSecurityVaultDetails, createSecurityVaultForm, createSecurityVaultProps, createSelectedPool } from './builders.js'
import { useSecurityPoolWorkflowSectionTestDom } from './testDom.js'

installTestRouting()
describe('SecurityPoolWorkflowSection: staged operations', () => {
	const { renderWorkflow, setCleanup } = useSecurityPoolWorkflowSectionTestDom()
	const managedPool = () => createSelectedPool({ managerAddress: zeroAddress })
	const validPriceWithoutPendingOperation = () => createOracleManagerDetails({ isPriceValid: true, pendingOperation: undefined, pendingOperationSlotId: 0n })
	const liquidationTargetProps = { liquidationManagerAddress: zeroAddress, liquidationSecurityPoolAddress: zeroAddress, liquidationTargetVault: zeroAddress } as const
	const immediateLiquidationOracle = () => createOracleManagerDetails({ isPriceValid: true, managerAddress: zeroAddress, pendingOperation: undefined })
	const liquidationFailure = (operationId: bigint) => ({ errorMessage: 'Local Underwriting commitments broken', operation: 'liquidation', operationId, success: false }) as const
	const notStartedReportingDetails: ReportingDetails = {
		settlementCollateralAttoEth: 1n,
		currentTime: 3n,
		forkThresholdAttoRep: 10n,
		marketDetails: createMarketDetails({ endTime: 0n }),
		nonDecisionThresholdAttoRep: 20n,
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
		startBondAttoRep: 1n,
		status: 'not-started',
		systemState: 'operational',
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerPoolHeldVaultRepBackingAttoRep: 12_000n,
		viewerVaultExists: true,
		viewerVaultDisputeStakedAttoRep: 0n,
		viewerVaultRepBackingAttoRep: 12_000n,
	}

	const renderSelectedPool = async (overrides: Partial<SecurityPoolWorkflowRouteContentProps>, chainTimestamp?: bigint) =>
		await renderWorkflow(createSecurityPoolWorkflowProps({ securityPoolAddress: zeroAddress, securityPools: [createSelectedPool()], ...overrides }), chainTimestamp === undefined ? {} : { chainTimestamp })

	const openWithdrawDialog = async (poolOracleManagerDetails: SecurityPoolWorkflowRouteContentProps['poolOracleManagerDetails'], securityVault: Partial<SecurityVaultRouteContentProps>) => {
		await renderSelectedPool({
			poolOracleManagerDetails,
			securityVault: createSecurityVaultProps({ securityVaultDetails: createSecurityVaultDetails(), securityVaultForm: createSecurityVaultForm({ repWithdrawAmount: '1' }), ...securityVault }),
			selectedPoolView: 'vaults',
		})
		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})
		return within(documentQueries.getByRole('dialog', { name: 'Withdraw REP' }))
	}

	const getLiquidationDialog = () => within(within(document.body).getByRole('dialog', { name: 'Execute vault liquidation' }))

	// Renders with refresh, vault-load, and reporting-load spies so each refresh side effect can be asserted.
	const renderRefreshScenario = async ({ reporting = {}, securityVault = {}, ...overrides }: Partial<Omit<SecurityPoolWorkflowRouteContentProps, 'reporting' | 'securityVault'>> & { reporting?: Parameters<typeof createReportingProps>[0]; securityVault?: Partial<SecurityVaultRouteContentProps> }) => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const reportingLoadCalls: string[] = []
		await renderSelectedPool({
			onRefreshSelectedPoolData: securityPoolAddressInput => {
				refreshSelectedPoolCalls.push(securityPoolAddressInput)
			},
			reporting: createReportingProps({
				onLoadReporting: () => {
					reportingLoadCalls.push('refresh')
				},
				...reporting,
			}),
			securityVault: createSecurityVaultProps({
				onLoadSecurityVault: vaultAddress => {
					loadSecurityVaultCalls.push(vaultAddress)
				},
				securityVaultDetails: createSecurityVaultDetails(),
				securityVaultForm: createSecurityVaultForm(),
				...securityVault,
			}),
			selectedPoolView: 'vaults',
			...overrides,
		})
		return { loadSecurityVaultCalls, refreshSelectedPoolCalls, reportingLoadCalls }
	}

	test('executes each card directly with its exact ID and retains per-operation guards', async () => {
		const executed: bigint[] = []
		function Operations() {
			const [manualId, setManualId] = useState('1')
			const [pending, setPending] = useState(false)
			return (
				<SecurityPoolStagedOperationsSection
					activeOperationCount={2n}
					canExecute={true}
					executeGuardMessage={undefined}
					operationGuardMessages={
						new Map([
							[1n, 'Wait for a valid price'],
							[2n, undefined],
						])
					}
					executionPending={pending}
					loadingManager={false}
					managerAddress={zeroAddress}
					managerDetails={createOracleManagerDetails()}
					managerError={undefined}
					manualOperationId={manualId}
					onExecute={(_manager, id) => {
						executed.push(id)
						setPending(true)
					}}
					onLoadManager={() => undefined}
					onManualOperationIdChange={setManualId}
					pendingSettlementOperationIds={[]}
					resolvedOperationId={BigInt(manualId)}
					securityPoolAddress={zeroAddress}
					stagedOperations={[
						{ operationId: 1n, operation: 'withdrawRep', amount: 1n, operator: zeroAddress, targetVault: zeroAddress },
						{ operationId: 2n, operation: 'withdrawRep', amount: 2n, operator: zeroAddress, targetVault: zeroAddress },
					]}
					suggestedOperationId={1n}
					universeId={0n}
				/>
			)
		}
		const rendered = await renderIntoDocument(<Operations />)
		setCleanup(rendered.cleanup)
		const queries = within(document.body)
		expect(queries.queryByRole('button', { name: 'Selected' })).toBeNull()
		expect(queries.queryByRole('button', { name: 'Select operation' })).toBeNull()
		const [blocked, execute] = queries.getAllByRole('button', { name: 'Execute staged operation' })
		if (!(blocked instanceof HTMLButtonElement) || !(execute instanceof HTMLButtonElement)) throw new Error('Expected each operation card to have an execute button')
		expect(blocked.disabled).toBe(true)
		expect(blocked.closest('details')).toBeNull()
		expect(blocked.parentElement?.parentElement?.querySelector('.tx-action-feedback') === null).toBe(true)
		const group = blocked.closest('.tx-action-group')
		expect(group?.querySelector('.tx-action-feedback')?.textContent).toContain('Wait for a valid price')
		expect(blocked.getAttribute('aria-describedby')).toBe(group?.querySelector('.tx-action-feedback [id]')?.id)
		expect(execute.disabled).toBe(false)
		await act(async () => {
			fireEvent.click(execute)
		})
		expect(executed).toEqual([2n])
		expect(queries.getAllByRole('button', { name: 'Executing staged operation…' })).toHaveLength(1)
		expect(blocked.disabled).toBe(true)
		expect(execute.disabled).toBe(true)
	})

	describe('queueing and execution feedback', () => {
		test('does not loop the automatic oracle-manager read after an error', async () => {
			const loadPoolOracleManagerCalls: string[] = []
			const managerAddress = '0x00000000000000000000000000000000000000aa'
			await renderSelectedPool({
				onLoadPoolOracleManager: managerAddressInput => {
					loadPoolOracleManagerCalls.push(managerAddressInput)
				},
				poolOracleManagerDetails: undefined,
				poolOracleManagerError: 'Failed to load price oracle details. Reason: RPC unavailable',
				poolOracleManagerErrorAddress: managerAddress,
				securityPools: [createSelectedPool({ managerAddress })],
			})

			await act(async () => {
				await Promise.resolve()
			})
			expect(loadPoolOracleManagerCalls).toEqual([])
		})

		test('refreshes staged operations after queueing a vault withdrawal', async () => {
			const loadPoolOracleManagerCalls: string[] = []
			const managerAddress = '0x00000000000000000000000000000000000000aa'
			await renderSelectedPool({
				onLoadPoolOracleManager: managerAddressInput => {
					loadPoolOracleManagerCalls.push(managerAddressInput)
				},
				poolOracleManagerDetails: createOracleManagerDetails({ managerAddress }),
				securityPools: [createSelectedPool({ managerAddress })],
				securityVault: createSecurityVaultProps({
					securityVaultResult: {
						action: 'queueWithdrawRep',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
						stagedExecution: { errorMessage: undefined, operation: 'withdrawRep', operationId: 7n, success: true },
					},
				}),
			})

			expect(loadPoolOracleManagerCalls).toEqual([managerAddress])
		})

		test('keeps the withdraw modal open and links to the queued staged operation', async () => {
			const selectedViews: string[] = []
			await renderSelectedPool({
				onSelectedPoolViewChange: view => {
					selectedViews.push(view ?? '')
				},
				poolOracleManagerDetails: createOracleManagerDetails({
					pendingOperation: { amount: 5n * 10n ** 18n, operator: zeroAddress, operation: 'withdrawRep', operationId: 7n, targetVault: zeroAddress },
					pendingOperationSlotId: 7n,
				}),
				securityVault: createSecurityVaultProps({
					securityVaultDetails: createSecurityVaultDetails(),
					securityVaultForm: createSecurityVaultForm({ repWithdrawAmount: '1' }),
					securityVaultResult: { action: 'queueWithdrawRep', hash: '0x00000000000000000000000000000000000000000000000000000000000000bb' },
				}),
				selectedPoolView: 'vaults',
			})

			const documentQueries = within(document.body)
			expect(documentQueries.queryByText('A REP withdrawal was queued for the selected vault.')).toBeNull()
			expect(documentQueries.queryByText('Next: Review the queued entry in Staged operations and execute it when the oracle price is valid.')).toBeNull()

			await act(() => {
				fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
			})

			const dialogQueries = within(documentQueries.getByRole('dialog', { name: 'Withdraw REP' }))
			expect(dialogQueries.getByRole('heading', { name: 'REP withdrawal queued' })).not.toBeNull()
			expect(dialogQueries.getByText('#7')).not.toBeNull()
			expect(dialogQueries.getByRole('heading', { name: 'REP withdrawal queued' }).closest('.actions')).toBeNull()

			await act(() => {
				fireEvent.click(dialogQueries.getByRole('button', { name: 'View in staged operations' }))
			})

			expect(selectedViews).toEqual(['staged-operations'])
			expect(dialogQueries.getByRole('heading', { name: 'Withdraw REP' })).not.toBeNull()
			expect(dialogQueries.getByRole('heading', { name: 'REP withdrawal queued' })).not.toBeNull()
		})

		test('shows manual execution guidance for overflow queued withdrawals', async () => {
			const dialogQueries = await openWithdrawDialog(
				createOracleManagerDetails({
					isPriceValid: false,
					pendingOperation: { amount: 3n * 10n ** 18n, operator: zeroAddress, operation: 'liquidation', operationId: 6n, targetVault: '0x0000000000000000000000000000000000000001' },
					pendingOperationSlotId: 6n,
				}),
				{
					securityVaultResult: {
						action: 'queueWithdrawRep',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000bc',
						queuedOperationState: { status: 'manual-queued' },
						queuedOperation: { isPendingSlot: false, operation: 'withdrawRep', operationId: 11n },
					},
				},
			)

			expect(dialogQueries.getByRole('heading', { name: 'REP withdrawal queued' })).not.toBeNull()
			expect(dialogQueries.getByText('#11')).not.toBeNull()
			expect(dialogQueries.getByText('The settlement auto-execute list is full. Execute this staged operation manually with its ID after a valid oracle price is available.')).not.toBeNull()
		})

		test('explains automatic execution while the queued operation waits for oracle settlement', async () => {
			await renderSelectedPool({
				poolOracleManagerDetails: createOracleManagerDetails({
					isPriceValid: false,
					pendingOperation: { amount: 10n * 10n ** 18n, operator: zeroAddress, operation: 'setVaultUnderwritingLimit', operationId: 7n, targetVault: zeroAddress },
					pendingOperationSlotId: 7n,
					pendingReportId: 12n,
					pendingSettlementOperationIds: [7n],
				}),
				selectedPoolView: 'staged-operations',
			})
			const execute = within(document.body).getByRole('button', { name: 'Execute staged operation' })
			expect(execute.hasAttribute('disabled')).toBe(true)
			expect(document.body.textContent).toContain('Auto-executes after oracle settlement.')
			expect(document.body.textContent).not.toContain('Request a new price in Price oracle before executing this operation.')
			const descriptionId = execute.getAttribute('aria-describedby')
			expect(descriptionId).not.toBeNull()
			expect(document.getElementById(descriptionId ?? '')?.textContent).toBe('Auto-executes after oracle settlement.')
		})

		test('gives each card its own automatic or manual price guard', async () => {
			await renderSelectedPool({
				poolOracleManagerDetails: createOracleManagerDetails({
					isPriceValid: false,
					pendingOperationSlotId: 7n,
					pendingReportId: 12n,
					pendingSettlementOperationIds: [7n],
					stagedOperations: [
						{ amount: 10n * 10n ** 18n, operator: zeroAddress, operation: 'setVaultUnderwritingLimit', operationId: 7n, targetVault: zeroAddress },
						{ amount: 1n * 10n ** 18n, operator: zeroAddress, operation: 'withdrawRep', operationId: 8n, targetVault: zeroAddress },
					],
				}),
				selectedPoolView: 'staged-operations',
			})
			const buttons = within(document.body).getAllByRole('button', { name: 'Execute staged operation' })
			expect(buttons).toHaveLength(2)
			const reasons = buttons.map(button => document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent)
			expect(reasons).toEqual(['Auto-executes after oracle settlement.', 'Request a new price in Price oracle before executing this operation.'])
			expect(buttons.every(button => button.hasAttribute('disabled'))).toBe(true)
		})

		test('blocks staged-operation execution at the exact oracle expiry boundary', async () => {
			await renderSelectedPool(
				{
					poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastSettlementTimestamp: 100n, pendingOperationSlotId: 6n, priceValidUntilTimestamp: 400n }),
					selectedPoolView: 'staged-operations',
				},
				400n,
			)

			const executeButton = within(document.body).getByRole('button', { name: 'Execute staged operation' })
			if (!(executeButton instanceof HTMLButtonElement)) throw new Error('Expected Execute Staged operation button')
			expect(executeButton.disabled).toBe(true)
			expect(document.body.textContent).toContain('Request a new price in Price oracle before executing this operation.')
		})

		test('shows immediate execution when a withdraw uses an already valid oracle price', async () => {
			const dialogQueries = await openWithdrawDialog(validPriceWithoutPendingOperation(), {
				securityVaultResult: {
					action: 'queueWithdrawRep',
					stagedExecution: { operation: 'withdrawRep', operationId: 0n, success: true },
					hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
				},
			})

			expect(dialogQueries.getByRole('heading', { name: 'REP withdrawal executed' })).not.toBeNull()
			expect(dialogQueries.queryByRole('button', { name: 'View in staged operations' })).toBeNull()
			expect(dialogQueries.getByText('A valid oracle price was already available, so the withdrawal executed immediately and no staged operation was created.')).not.toBeNull()
		})

		test('shows withdraw failure details when the staged execution event reports a rejection', async () => {
			const dialogQueries = await openWithdrawDialog(validPriceWithoutPendingOperation(), {
				securityVaultForm: createSecurityVaultForm({ repWithdrawAmount: '10000' }),
				securityVaultResult: {
					action: 'queueWithdrawRep',
					hash: '0x00000000000000000000000000000000000000000000000000000000000000be',
					stagedExecution: { errorMessage: 'Local Underwriting commitments broken', operation: 'withdrawRep', operationId: 8n, success: false },
				},
			})

			expect(dialogQueries.getByRole('heading', { name: 'REP withdrawal failed' })).not.toBeNull()
			expect(dialogQueries.getByText('Local Underwriting commitments broken')).not.toBeNull()
			expect(dialogQueries.queryByRole('button', { name: 'View in staged operations' })).toBeNull()
		})

		test('shows liquidation successful in the selected pool workflow after an immediate execution', async () => {
			await renderSelectedPool({
				...liquidationTargetProps,
				poolOracleManagerDetails: immediateLiquidationOracle(),
				liquidationModalOpen: true,
				securityPoolOverviewResult: { action: 'queueLiquidation', hash: '0x00000000000000000000000000000000000000000000000000000000000000c1', securityPoolAddress: zeroAddress },
				securityPools: [managedPool()],
			})

			const dialogQueries = getLiquidationDialog()
			expect(dialogQueries.getByRole('heading', { name: 'Liquidation executed' })).not.toBeNull()
			expect(dialogQueries.getByText('A valid oracle price was already available, so the liquidation executed immediately and no staged operation was created.')).not.toBeNull()
		})

		test('shows liquidation failed in the selected pool workflow with the revert detail', async () => {
			await renderSelectedPool({
				...liquidationTargetProps,
				poolOracleManagerDetails: immediateLiquidationOracle(),
				liquidationModalOpen: true,
				securityPoolOverviewResult: { action: 'queueLiquidation', hash: '0x00000000000000000000000000000000000000000000000000000000000000c2', securityPoolAddress: zeroAddress, stagedExecution: liquidationFailure(13n) },
				securityPools: [managedPool()],
			})

			const dialogQueries = getLiquidationDialog()
			expect(dialogQueries.getByRole('heading', { name: 'Liquidation failed' })).not.toBeNull()
			expect(dialogQueries.getByText('Local Underwriting commitments broken')).not.toBeNull()
		})
	})

	describe('refresh side effects', () => {
		test.each<[string, Parameters<typeof renderRefreshScenario>[0], Array<string | undefined>]>([
			[
				'refreshes the selected pool and loaded vault after an immediate REP withdrawal execution',
				{
					poolOracleManagerDetails: validPriceWithoutPendingOperation(),
					securityVault: {
						securityVaultForm: createSecurityVaultForm({ repWithdrawAmount: '1' }),
						securityVaultResult: { action: 'queueWithdrawRep', hash: '0x00000000000000000000000000000000000000000000000000000000000000dd' },
					},
				},
				[undefined],
			],
			[
				'refreshes the selected pool and loaded vault after withdrawing escalation deposits from reporting',
				{
					reporting: { reportingResult: { action: 'withdrawEscalation', hash: '0x00000000000000000000000000000000000000000000000000000000000000de', outcome: 'yes', securityPoolAddress: zeroAddress, universeId: 1n } },
					selectedPoolView: 'reporting',
				},
				[undefined],
			],
			[
				'refreshes the selected pool and loaded vault after a liquidation resolves as queued',
				{
					...liquidationTargetProps,
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: false,
						managerAddress: zeroAddress,
						pendingOperation: { amount: 1n, operator: zeroAddress, operation: 'liquidation', operationId: 10n, targetVault: zeroAddress },
						pendingOperationSlotId: 10n,
					}),
					securityPoolOverviewResult: { action: 'queueLiquidation', hash: '0x00000000000000000000000000000000000000000000000000000000000000d1', securityPoolAddress: zeroAddress },
					securityPools: [managedPool()],
				},
				[undefined],
			],
			[
				'refreshes the selected pool and loaded vault after an immediate liquidation execution',
				{
					...liquidationTargetProps,
					poolOracleManagerDetails: immediateLiquidationOracle(),
					securityPoolOverviewResult: { action: 'queueLiquidation', hash: '0x00000000000000000000000000000000000000000000000000000000000000d2', securityPoolAddress: zeroAddress },
					securityPools: [managedPool()],
				},
				[undefined],
			],
			[
				'refreshes the selected pool and loaded vault after a failed immediate liquidation execution',
				{
					...liquidationTargetProps,
					poolOracleManagerDetails: immediateLiquidationOracle(),
					securityPoolOverviewResult: { action: 'queueLiquidation', hash: '0x00000000000000000000000000000000000000000000000000000000000000d3', securityPoolAddress: zeroAddress, stagedExecution: liquidationFailure(14n) },
					securityPools: [managedPool()],
				},
				[undefined],
			],
			['refreshes the selected pool and loaded vault after executing a staged operation', { poolPriceOracleResult: { action: 'executeStagedOperation', hash: '0x00000000000000000000000000000000000000000000000000000000000000cc' } }, [undefined]],
			[
				'refreshes the selected pool after a failed staged operation execution',
				{
					poolPriceOracleResult: {
						action: 'executeStagedOperation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000ce',
						stagedExecution: { errorMessage: 'Local Underwriting commitments broken', operation: 'withdrawRep', operationId: 12n, success: false },
					},
					poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, managerAddress: zeroAddress }),
					selectedPoolView: 'staged-operations',
				},
				[],
			],
		])('%s', async (_name, scenario, expectedVaultLoads) => {
			const { loadSecurityVaultCalls, refreshSelectedPoolCalls } = await renderRefreshScenario(scenario)

			expect(refreshSelectedPoolCalls).toEqual([zeroAddress])
			expect(loadSecurityVaultCalls).toEqual(expectedVaultLoads)
		})

		test.each<[string, Parameters<typeof renderRefreshScenario>[0]]>([
			['refreshes loaded reporting after depositing REP into the selected vault', { securityVault: { securityVaultForm: createSecurityVaultProps().securityVaultForm, securityVaultResult: { action: 'depositRepToVault', hash: '0x00000000000000000000000000000000000000000000000000000000000000df' } } }],
			[
				'refreshes loaded reporting after executing a staged REP withdrawal',
				{
					poolPriceOracleResult: {
						action: 'executeStagedOperation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000cf',
						stagedExecution: { errorMessage: undefined, operation: 'withdrawRep', operationId: 15n, success: true },
					},
					securityVault: { securityVaultForm: createSecurityVaultForm({ repWithdrawAmount: '1' }) },
				},
			],
		])('%s', async (_name, scenario) => {
			const { refreshSelectedPoolCalls, reportingLoadCalls } = await renderRefreshScenario({
				...scenario,
				reporting: { reportingDetails: notStartedReportingDetails },
				securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }) })],
			})

			expect(refreshSelectedPoolCalls).toEqual([zeroAddress])
			expect(reportingLoadCalls).toEqual(['refresh'])
		})
	})
})
