import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import {
	createActiveReportingDetails,
	createEscalationSides,
	createForkAuctionProps,
	createLoadedPoolProps,
	createOracleManagerDetails,
	createMarketDetails,
	createReportingForm,
	createReportingProps,
	createSecurityVaultDetails,
	createSecurityVaultForm,
	createSecurityVaultProps,
	createSelectedPool,
} from './builders.js'
import { useSecurityPoolWorkflowSectionTestDom } from './testDom.js'

installTestRouting()
describe('SecurityPoolWorkflowSection: refresh and autoload', () => {
	const { renderLoadedPool, renderWorkflow } = useSecurityPoolWorkflowSectionTestDom()
	const atChainTimeOne = { chainTimestamp: 1n }
	const endedPoolAt = (securityPoolAddress: Address) => createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress })
	const yesReportingForm = (securityPoolAddress: Address | '') => createReportingForm({ securityPoolAddress, selectedOutcome: 'yes' })
	const forkAuctionFailure = (onLoadForkAuction: () => void) => createForkAuctionProps({ forkAuctionError: 'Failed to load fork and auction details. Reason: RPC unavailable', onLoadForkAuction })

	test('refreshes an already loaded queue when opening staged operations', async () => {
		let loads = 0
		const baseProps = createLoadedPoolProps({
			poolOracleManagerDetails: createOracleManagerDetails({ managerAddress: zeroAddress }),
			securityPools: [createSelectedPool({ managerAddress: zeroAddress })],
			onLoadPoolOracleManager: () => {
				loads += 1
			},
			selectedPoolView: 'vaults',
		})
		const { rerender } = await renderWorkflow(baseProps, atChainTimeOne)
		const before = loads
		await rerender({ ...baseProps, selectedPoolView: 'staged-operations' })
		expect(loads).toBe(before + 1)
		await rerender({ ...baseProps, selectedPoolView: 'staged-operations' })
		expect(loads).toBe(before + 1)
	})

	test('autoloads reporting once after the reporting form pool matches the selected pool', async () => {
		let reportingLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const stalePoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
		const reportingWithFormPool = (formPoolAddress: Address | '') =>
			createReportingProps({
				onLoadReporting: () => {
					reportingLoadCalls += 1
				},
				reportingForm: yesReportingForm(formPoolAddress),
			})
		const baseProps = createLoadedPoolProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			reporting: reportingWithFormPool(''),
			securityPoolAddress: selectedPoolAddress,
			securityPools: [endedPoolAt(selectedPoolAddress)],
			selectedPoolView: 'reporting',
		})

		const { rerender } = await renderWorkflow(baseProps, atChainTimeOne)
		expect(reportingLoadCalls).toBe(0)

		await rerender({ ...baseProps, reporting: reportingWithFormPool(stalePoolAddress) })
		expect(reportingLoadCalls).toBe(0)

		await rerender({ ...baseProps, reporting: reportingWithFormPool(selectedPoolAddress) })
		expect(reportingLoadCalls).toBe(1)

		await rerender({ ...baseProps, reporting: reportingWithFormPool(selectedPoolAddress) })
		expect(reportingLoadCalls).toBe(1)
	})

	test('re-arms reporting autoload after leaving and re-entering the reporting tab', async () => {
		let reportingLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const baseProps = createLoadedPoolProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			reporting: createReportingProps({
				onLoadReporting: () => {
					reportingLoadCalls += 1
				},
				reportingForm: yesReportingForm(selectedPoolAddress),
			}),
			securityPoolAddress: selectedPoolAddress,
			securityPools: [endedPoolAt(selectedPoolAddress)],
		})

		const { rerender } = await renderWorkflow({ ...baseProps, selectedPoolView: 'reporting' }, atChainTimeOne)
		expect(reportingLoadCalls).toBe(1)

		await rerender({ ...baseProps, selectedPoolView: 'vaults' })
		expect(reportingLoadCalls).toBe(1)

		await rerender({ ...baseProps, selectedPoolView: 'reporting' })
		expect(reportingLoadCalls).toBe(2)
	})

	test('shows an explicit retry after automatic reporting loads fail in reporting and fork views', async () => {
		let reportingLoadCalls = 0
		const baseProps = createLoadedPoolProps({
			reporting: createReportingProps({
				onLoadReporting: () => {
					reportingLoadCalls += 1
				},
				reportingError: 'Failed to load reporting details. Reason: RPC unavailable',
				reportingForm: yesReportingForm(zeroAddress),
			}),
			securityPools: [endedPoolAt(zeroAddress)],
		})
		const { rerender } = await renderWorkflow({ ...baseProps, selectedPoolView: 'reporting' }, atChainTimeOne)
		const documentQueries = within(document.body)

		expect(reportingLoadCalls).toBe(1)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry reporting' }))
		expect(reportingLoadCalls).toBe(2)

		await rerender({ ...baseProps, selectedPoolView: 'fork-migration' })
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry reporting' }))
		expect(reportingLoadCalls).toBe(3)
	})

	test('stabilizes a failed fork autoload until retry or the selected pool changes', async () => {
		let forkLoadCalls = 0
		const onLoadForkAuction = () => {
			forkLoadCalls += 1
		}
		const baseProps = createLoadedPoolProps({ forkAuction: createForkAuctionProps({ onLoadForkAuction }), selectedPoolView: 'fork-migration' })

		const { rerender } = await renderWorkflow(baseProps)
		expect(forkLoadCalls).toBe(1)

		await rerender({ ...baseProps, forkAuction: forkAuctionFailure(onLoadForkAuction) })

		expect(forkLoadCalls).toBe(1)
		fireEvent.click(within(document.body).getByRole('button', { name: 'Retry fork workflow' }))
		expect(forkLoadCalls).toBe(2)

		const nextPoolAddress = getAddress('0x00000000000000000000000000000000000000a9')
		await rerender({ ...baseProps, checkedSecurityPoolAddress: nextPoolAddress, forkAuction: forkAuctionFailure(onLoadForkAuction), securityPoolAddress: nextPoolAddress, securityPools: [createSelectedPool({ securityPoolAddress: nextPoolAddress })] })
		expect(forkLoadCalls).toBe(3)
	})

	test('refreshes the selected pool and current vault after finalized auction settlement', async () => {
		let refreshedPoolAddress: string | undefined
		let vaultLoadCalls = 0
		await renderLoadedPool({
			forkAuction: createForkAuctionProps({
				forkAuctionResult: { action: 'claimAuctionProceeds', hash: '0x00000000000000000000000000000000000000000000000000000000000000ca', securityPoolAddress: zeroAddress, universeId: 1n },
			}),
			onRefreshSelectedPoolData: securityPoolAddressInput => {
				refreshedPoolAddress = securityPoolAddressInput
			},
			securityVault: createSecurityVaultProps({
				onLoadSecurityVault: () => {
					vaultLoadCalls += 1
				},
				securityVaultDetails: createSecurityVaultDetails(),
				securityVaultForm: createSecurityVaultForm(),
			}),
			selectedPoolView: 'fork-migration',
		})

		expect(refreshedPoolAddress).toBe(zeroAddress)
		expect(vaultLoadCalls).toBe(1)
	})

	test('refreshes the selected pool after starting truth auction', async () => {
		let refreshedPoolAddress: string | undefined
		const loadedForkAuctionAddresses: string[] = []
		await renderLoadedPool({
			forkAuction: createForkAuctionProps({
				onLoadForkAuction: securityPoolAddressOverride => {
					if (securityPoolAddressOverride !== undefined) loadedForkAuctionAddresses.push(securityPoolAddressOverride)
				},
				forkAuctionResult: { action: 'startTruthAuction', hash: '0x00000000000000000000000000000000000000000000000000000000000000cc', securityPoolAddress: zeroAddress, universeId: 1n },
			}),
			onRefreshSelectedPoolData: securityPoolAddressInput => {
				refreshedPoolAddress = securityPoolAddressInput
			},
			selectedPoolView: 'fork-migration',
		})

		expect(refreshedPoolAddress).toBe(zeroAddress)
		expect(loadedForkAuctionAddresses).toContain(zeroAddress)
	})

	test('reloads reporting after claiming parent escalation deposits in the fork workflow', async () => {
		let reportingLoadCalls = 0
		let refreshedPoolAddress: string | undefined
		await renderLoadedPool(
			{
				forkAuction: createForkAuctionProps({
					forkAuctionResult: { action: 'claimParentEscalationDeposits', hash: '0x00000000000000000000000000000000000000000000000000000000000000cb', securityPoolAddress: zeroAddress, universeId: 1n },
				}),
				onRefreshSelectedPoolData: securityPoolAddressInput => {
					refreshedPoolAddress = securityPoolAddressInput
				},
				reporting: createReportingProps({
					onLoadReporting: () => {
						reportingLoadCalls += 1
					},
					reportingDetails: createActiveReportingDetails({
						activationTime: 0n,
						bindingCapital: 0n,
						settlementCollateralAttoEth: 0n,
						currentRequiredBond: 0n,
						currentTime: 1n,
						escalationEndTime: 2n,
						forkThresholdAttoRep: 0n,
						marketDetails: createMarketDetails({ endTime: 0n }),
						nonDecisionThresholdAttoRep: 0n,
						sides: createEscalationSides([0n, 0n, 0n]),
						startBondAttoRep: 0n,
						totalCostAttoRep: 0n,
						viewerPoolHeldVaultRepBackingAttoRep: 0n,
						viewerVaultDisputeStakedAttoRep: 0n,
						viewerVaultRepBackingAttoRep: 0n,
					}),
					reportingForm: yesReportingForm(zeroAddress),
				}),
				securityPools: [endedPoolAt(zeroAddress)],
				selectedPoolView: 'reporting',
			},
			atChainTimeOne,
		)

		expect(refreshedPoolAddress).toBe(zeroAddress)
		expect(reportingLoadCalls).toBe(1)
	})
})
