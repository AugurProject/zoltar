import { describe, expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { SecurityPoolWorkflowSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolWorkflowSection.js'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ForkAuctionDetails, ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'
import { createActiveReportingDetails, createEscalationSides, createFinalizedTruthAuction, createForkAuctionDetails, createForkAuctionProps, createMarketDetails, createReportingForm, createReportingProps, createSecurityPoolWorkflowProps, createSelectedPool } from './builders.js'
import { useSecurityPoolWorkflowSectionTestDom } from './testDom.js'

installTestRouting()
describe('SecurityPoolWorkflowSection: fork workflow state', () => {
	const { renderWorkflow, setCleanup } = useSecurityPoolWorkflowSectionTestDom()
	const endedMarket = () => createMarketDetails({ endTime: 2n })
	const forkedPoolState = { forkOutcome: 'yes', migratedAttoRep: 1n, systemState: 'poolForked' } as const
	const createForkedPoolProps = (selectedPoolAddress: Address = zeroAddress) =>
		createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			forkAuction: createForkAuctionProps({ forkAuctionDetails: createForkAuctionDetails({ ...forkedPoolState, securityPoolAddress: selectedPoolAddress }) }),
			securityPoolAddress: selectedPoolAddress,
			securityPools: [createSelectedPool({ ...forkedPoolState, securityPoolAddress: selectedPoolAddress })],
			selectedPoolView: 'fork-auction',
		})
	const createSettledForkAuctionProps = (overrides: Partial<ForkAuctionDetails> = {}) =>
		createForkAuctionProps({
			forkAuctionDetails: createForkAuctionDetails({
				claimingAvailable: false,
				forkOutcome: 'yes',
				migratedAttoRep: 1n,
				systemState: 'operational',
				truthAuction: createFinalizedTruthAuction(),
				truthAuctionStartedAt: 1n,
				...overrides,
			}),
		})
	const createPoolAt = (securityPoolAddress: Address, overrides: Partial<ListedSecurityPool> = {}) => createSelectedPool({ marketDetails: endedMarket(), securityPoolAddress, ...overrides })
	const createStaleReportingProps = (selectedPoolAddress: Address, onLoadReporting: () => void, reportingDetails: Parameters<typeof createActiveReportingDetails>[0], selectedPool: Partial<ListedSecurityPool>) =>
		createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			reporting: createReportingProps({
				onLoadReporting,
				reportingDetails: createActiveReportingDetails({ securityPoolAddress: selectedPoolAddress, ...reportingDetails }),
				reportingForm: createReportingForm({ securityPoolAddress: selectedPoolAddress }),
			}),
			securityPoolAddress: selectedPoolAddress,
			securityPools: [createPoolAt(selectedPoolAddress, selectedPool)],
			selectedPoolView: 'reporting',
		})
	const resolvedOperationalReporting = { questionOutcome: 'yes', settlementState: 'resolved', parentWithdrawalEnabled: true } as const

	describe('stage navigation', () => {
		test('does not offer Open fork & migration before the pool has entered its fork workflow', async () => {
			await renderWorkflow(
				createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					reporting: createReportingProps({
						reportingDetails: createActiveReportingDetails({
							hasReachedNonDecision: true,
							sides: createEscalationSides([7n, 20n, 20n], { yes: { userDeposits: [{ amountAttoRep: 1n, cumulativeAmountAttoRep: 1n, depositIndex: 0n, depositor: zeroAddress }] } }),
						}),
					}),
					securityPoolAddress: zeroAddress,
					securityPools: [createPoolAt(zeroAddress, { systemState: 'operational' })],
					selectedPoolView: 'reporting',
				}),
			)

			expect(within(document.body).queryByRole('button', { name: 'Open fork & migration' })).toBeNull()
		})

		test('opens the concrete migration stage when the pool is already inside its fork workflow', async () => {
			const selectedViews: string[] = []
			await renderWorkflow(
				createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({ ...forkedPoolState, hasForkActivity: true, marketDetails: endedMarket(), questionOutcome: 'none', securityPoolAddress: zeroAddress }),
					}),
					onSelectedPoolViewChange: view => {
						selectedViews.push(view ?? '')
					},
					reporting: createReportingProps({ reportingDetails: createActiveReportingDetails({ hasReachedNonDecision: true }) }),
					securityPoolAddress: zeroAddress,
					securityPools: [createPoolAt(zeroAddress, forkedPoolState)],
					selectedPoolView: 'reporting',
				}),
			)

			await act(() => {
				fireEvent.click(within(document.body).getByRole('tab', { name: 'Fork & migration' }))
			})

			expect(selectedViews).toEqual(['fork-workflow'])
		})

		test('defaults the fork workflow to the current stage on first render', async () => {
			const selectedViews: string[] = []
			const truthAuctionPoolState = { forkOutcome: 'yes', migratedAttoRep: 1n, securityPoolAddress: zeroAddress, systemState: 'forkTruthAuction', truthAuctionStartedAt: 1n } as const
			await renderWorkflow(
				createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					forkAuction: createForkAuctionProps({ forkAuctionDetails: createForkAuctionDetails(truthAuctionPoolState) }),
					securityPoolAddress: zeroAddress,
					onSelectedPoolViewChange: view => {
						selectedViews.push(view ?? '')
					},
					securityPools: [createSelectedPool(truthAuctionPoolState)],
					selectedPoolView: 'fork-workflow',
				}),
			)

			const documentQueries = within(document.body)
			expect(documentQueries.getByRole('heading', { name: 'Truth auction status' })).not.toBeNull()
			expect(documentQueries.queryByRole('heading', { name: 'Fork triggered' })).toBeNull()
			expect(documentQueries.getByRole('tab', { name: 'Truth auction' }).className.includes('is-selected')).toBe(true)

			await act(() => {
				fireEvent.click(documentQueries.getByRole('tab', { name: 'Migration' }))
			})

			expect(selectedViews).toEqual(['fork-migration'])
		})

		test('keeps a route-selected fork stage visible after selection effects settle', async () => {
			await renderWorkflow(createForkedPoolProps())

			await waitFor(() => {
				const documentQueries = within(document.body)
				expect(documentQueries.getByRole('tab', { name: 'Truth auction' }).getAttribute('aria-selected')).toBe('true')
				expect(documentQueries.getByRole('heading', { name: 'Truth auction status' })).not.toBeNull()
				expect(documentQueries.queryByRole('heading', { name: 'Migration status' })).toBeNull()
			})
		})

		test('returns to lifecycle-driven stages when a stage-specific route becomes the generic fork workflow', async () => {
			const baseProps = createForkedPoolProps()
			const { rerender } = await renderWorkflow(baseProps)

			await rerender({ ...baseProps, selectedPoolView: 'fork-workflow' })

			let documentQueries = within(document.body)
			expect(documentQueries.getByRole('tab', { name: 'Migration' }).getAttribute('aria-selected')).toBe('true')
			expect(documentQueries.getByRole('heading', { name: 'Migration status' })).not.toBeNull()

			await rerender({
				...baseProps,
				forkAuction: createSettledForkAuctionProps({ securityPoolAddress: zeroAddress }),
				securityPools: [createSelectedPool({ forkOutcome: 'yes', migratedAttoRep: 1n, securityPoolAddress: zeroAddress, systemState: 'operational', truthAuctionStartedAt: 1n })],
				selectedPoolView: 'fork-workflow',
			})

			documentQueries = within(document.body)
			expect(documentQueries.getByRole('tab', { name: 'Settlement' }).getAttribute('aria-selected')).toBe('true')
			expect(documentQueries.getByRole('heading', { name: 'Settlement status' })).not.toBeNull()
		})

		test('keeps Fork Triggered selected when its user action changes a stage-specific route to the generic workflow', async () => {
			const baseProps = createForkedPoolProps()
			const StatefulRouteHarness = () => {
				const [selectedPoolView, setSelectedPoolView] = useState<string>('fork-auction')
				return <SecurityPoolWorkflowSection {...baseProps} selectedPoolView={selectedPoolView} onSelectedPoolViewChange={view => setSelectedPoolView(view ?? 'fork-workflow')} showHeader={false} />
			}
			const renderedComponent = await renderIntoDocument(<StatefulRouteHarness />)
			setCleanup(renderedComponent.cleanup)

			await act(() => {
				fireEvent.click(within(document.body).getByRole('tab', { name: 'Fork readiness' }))
			})

			await waitFor(() => {
				const documentQueries = within(document.body)
				expect(documentQueries.getByRole('tab', { name: 'Fork readiness' }).getAttribute('aria-selected')).toBe('true')
				expect(documentQueries.getByRole('heading', { name: 'Fork triggered' })).not.toBeNull()
				expect(documentQueries.queryByRole('heading', { name: 'Migration status' })).toBeNull()
			})
		})

		test('opens the migration step for root-universe pools that present as Fork migration after universe fork', async () => {
			await renderWorkflow(
				createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: zeroAddress, systemState: 'operational', universeHasForked: true })],
					selectedPoolView: 'fork-migration',
				}),
			)

			const documentQueries = within(document.body)
			expect(documentQueries.getByRole('heading', { name: 'Migration status' })).not.toBeNull()
			expect(documentQueries.getByRole('tab', { name: 'Migration' }).className.includes('is-selected')).toBe(true)
			expect(document.body.textContent?.includes('This step becomes active once the fork has been triggered.')).toBe(false)
		})

		test('advances the selected fork workflow panel when fresh fork details load a later current stage', async () => {
			const baseProps = createSecurityPoolWorkflowProps({
				checkedSecurityPoolAddress: zeroAddress,
				forkAuction: createForkAuctionProps(),
				securityPoolAddress: zeroAddress,
				securityPools: [createSelectedPool({ forkOutcome: 'yes', migratedAttoRep: 1n, securityPoolAddress: zeroAddress, systemState: 'operational', truthAuctionStartedAt: 1n })],
				selectedPoolView: 'fork-workflow',
			})
			const { rerender } = await renderWorkflow(baseProps)

			let documentQueries = within(document.body)
			expect(documentQueries.getByRole('heading', { name: 'Settlement status' })).not.toBeNull()
			expect(documentQueries.getByRole('tab', { name: 'Settlement' }).className.includes('is-selected')).toBe(true)

			await rerender({ ...baseProps, forkAuction: createSettledForkAuctionProps({ securityPoolAddress: zeroAddress }) })

			documentQueries = within(document.body)
			expect(documentQueries.getByRole('heading', { name: 'Settlement status' })).not.toBeNull()
			expect(documentQueries.getByRole('heading', { name: 'Child security pools' })).not.toBeNull()
			expect(documentQueries.getByRole('tab', { name: 'Settlement' }).className.includes('is-selected')).toBe(true)
			expect(documentQueries.queryByRole('tab', { name: 'New Security pools' })).toBeNull()
		})
	})

	describe('reporting triggers and stale state', () => {
		test('shows Trigger universe fork in the reporting workflow after non-decision', async () => {
			let triggerZoltarForkCalls = 0
			await renderWorkflow(
				createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					forkAuction: createForkAuctionProps({
						onForkWithOwnEscalation: () => {
							triggerZoltarForkCalls += 1
						},
					}),
					reporting: createReportingProps({ reportingDetails: createActiveReportingDetails({ hasReachedNonDecision: true }) }),
					securityPoolAddress: zeroAddress,
					securityPools: [createPoolAt(zeroAddress, { systemState: 'operational' })],
					selectedPoolView: 'reporting',
				}),
			)

			expectTransactionButtonEnabled(document.body, 'Trigger universe fork')

			await act(() => {
				fireEvent.click(within(document.body).getByRole('button', { name: 'Trigger universe fork' }))
			})

			expect(triggerZoltarForkCalls).toBe(1)
		})

		test('hides Trigger universe fork after the pool has already entered its fork workflow and keeps Open fork & migration available', async () => {
			await renderWorkflow(
				createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({ ...forkedPoolState, hasForkActivity: true, marketDetails: endedMarket(), questionOutcome: 'none', securityPoolAddress: zeroAddress }),
					}),
					reporting: createReportingProps({ reportingDetails: createActiveReportingDetails({ hasReachedNonDecision: true }) }),
					securityPoolAddress: zeroAddress,
					securityPools: [createPoolAt(zeroAddress, forkedPoolState)],
					selectedPoolView: 'reporting',
				}),
			)

			const documentQueries = within(document.body)
			expect(documentQueries.queryByRole('button', { name: 'Trigger universe fork' })).toBeNull()
			expect(documentQueries.getByRole('tab', { name: 'Fork & migration' })).not.toBeNull()
		})

		test('prefers fresh fork-auction activity over stale pool-list state on the fork tab', async () => {
			let reportingLoadCalls = 0
			const freshTruthAuctionAddress = getAddress('0x00000000000000000000000000000000000000f1')
			await renderWorkflow(
				createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							settlementCollateralAttoEth: 2n,
							forkOutcome: 'yes',
							forkOwnSecurityPool: true,
							marketDetails: endedMarket(),
							migratedAttoRep: 5n,
							securityPoolAddress: zeroAddress,
							systemState: 'operational',
							truthAuctionAddress: freshTruthAuctionAddress,
						}),
					}),
					reporting: createReportingProps({
						onLoadReporting: () => {
							reportingLoadCalls += 1
						},
					}),
					securityPoolAddress: zeroAddress,
					securityPools: [createPoolAt(zeroAddress, { settlementCollateralAttoEth: 0n, systemState: 'operational', truthAuctionAddress: zeroAddress })],
					selectedPoolView: 'fork-migration',
				}),
			)

			const documentQueries = within(document.body)
			const selectedPoolSummary = document.body.querySelector('.selected-pool-object-header')
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
			await renderWorkflow(
				createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							settlementCollateralAttoEth: 2n,
							forkOutcome: 'yes',
							forkOwnSecurityPool: true,
							marketDetails: endedMarket(),
							migratedAttoRep: 5n,
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
					securityPools: [createPoolAt(selectedPoolAddress, { forkOutcome: 'yes', migratedAttoRep: 5n, systemState: 'operational', truthAuctionStartedAt: 10n })],
					selectedPoolView: 'fork-workflow',
				}),
			)

			const selectedPoolSummary = document.body.querySelector('.selected-pool-object-header')
			if (!(selectedPoolSummary instanceof HTMLElement)) throw new Error('Expected selected pool summary to render')
			const settlementStageTab = within(document.body).getByRole('tab', { name: 'Settlement' })
			expect(forkAuctionLoadCalls).toBe(1)
			expect(settlementStageTab.getAttribute('aria-current')).toBe('step')
			expect(selectedPoolSummary.textContent?.includes(staleTruthAuctionAddress)).toBe(false)
		})

		test('reloads fork-auction details instead of trusting stale same-address operational details after the pool enters fork mode', async () => {
			let forkAuctionLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000fa')
			await renderWorkflow(
				createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							settlementCollateralAttoEth: 2n,
							forkOutcome: 'yes',
							forkOwnSecurityPool: true,
							hasForkActivity: true,
							marketDetails: endedMarket(),
							migratedAttoRep: 5n,
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
					securityPools: [createPoolAt(selectedPoolAddress, { hasForkActivity: true, questionOutcome: 'yes', systemState: 'forkTruthAuction', truthAuctionStartedAt: 10n })],
					selectedPoolView: 'fork-workflow',
				}),
			)

			expect(forkAuctionLoadCalls).toBe(1)
		})

		test('reloads reporting instead of trusting stale same-address reporting details once the pool is operational again', async () => {
			let reportingLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f4')
			await renderWorkflow(
				createStaleReportingProps(
					selectedPoolAddress,
					() => {
						reportingLoadCalls += 1
					},
					{ systemState: 'forkTruthAuction' },
					{ forkOutcome: 'yes', hasForkActivity: true, questionOutcome: 'yes', systemState: 'operational', truthAuctionStartedAt: 10n },
				),
				{ chainTimestamp: 150n },
			)

			await waitFor(() => {
				expect(reportingLoadCalls).toBe(1)
			})
			expect(document.body.textContent?.includes('This pool is in truth auction. Reporting actions unlock once the pool becomes operational.')).toBe(false)
			expect(within(document.body).queryByText('Question finalized as Yes')).toBeNull()
		})

		test('reloads reporting instead of trusting stale same-address operational reporting details after the pool enters fork mode', async () => {
			let reportingLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000fb')
			await renderWorkflow(
				createStaleReportingProps(
					selectedPoolAddress,
					() => {
						reportingLoadCalls += 1
					},
					resolvedOperationalReporting,
					{ hasForkActivity: true, questionOutcome: 'yes', systemState: 'forkTruthAuction' },
				),
				{ chainTimestamp: 150n },
			)

			await waitFor(() => {
				expect(reportingLoadCalls).toBe(1)
			})
		})
	})

	describe('refresh-driven reloads', () => {
		test('reloads same-address reporting details after a selected-pool refresh', async () => {
			let reportingLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f5')
			const baseProps = createStaleReportingProps(
				selectedPoolAddress,
				() => {
					reportingLoadCalls += 1
				},
				resolvedOperationalReporting,
				{ hasForkActivity: false, questionOutcome: 'yes', systemState: 'operational' },
			)

			const { rerender } = await renderWorkflow(baseProps, { chainTimestamp: 150n })
			expect(reportingLoadCalls).toBe(0)

			await rerender({ ...baseProps, selectedPoolRefreshNonce: 1 })

			await waitFor(() => {
				expect(reportingLoadCalls).toBe(1)
			})
		})

		test('reloads same-address fork auction details after a selected-pool refresh', async () => {
			let forkAuctionLoadCalls = 0
			const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f6')
			const truthAuctionAddress = getAddress('0x00000000000000000000000000000000000000f7')
			const baseProps = createSecurityPoolWorkflowProps({
				checkedSecurityPoolAddress: selectedPoolAddress,
				forkAuction: createForkAuctionProps({
					forkAuctionDetails: createForkAuctionDetails({
						settlementCollateralAttoEth: 2n,
						forkOutcome: 'yes',
						forkOwnSecurityPool: true,
						hasForkActivity: true,
						marketDetails: endedMarket(),
						migratedAttoRep: 5n,
						questionOutcome: 'yes',
						securityPoolAddress: selectedPoolAddress,
						systemState: 'operational',
						truthAuctionAddress,
					}),
					onLoadForkAuction: () => {
						forkAuctionLoadCalls += 1
					},
				}),
				securityPoolAddress: selectedPoolAddress,
				securityPools: [createPoolAt(selectedPoolAddress, { hasForkActivity: true, questionOutcome: 'yes', systemState: 'operational', truthAuctionAddress })],
				selectedPoolView: 'fork-workflow',
			})

			const { rerender } = await renderWorkflow(baseProps)
			expect(forkAuctionLoadCalls).toBe(0)

			await rerender({ ...baseProps, selectedPoolRefreshNonce: 1 })

			await waitFor(() => {
				expect(forkAuctionLoadCalls).toBe(1)
			})
		})
	})
})
