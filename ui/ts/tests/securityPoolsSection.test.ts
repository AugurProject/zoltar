/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'
import { SecurityPoolsSection, shouldRefreshSelectedPoolDataOnViewOpen } from '../components/SecurityPoolsSection.js'
import type { AccountState } from '../types/app.js'
import type { ListedSecurityPool, MarketDetails } from '../types/contracts.js'
import type { ForkAuctionRouteContentProps, ReportingRouteContentProps, SecurityPoolRouteContentProps, SecurityPoolsOverviewRouteContentProps, SecurityPoolsSectionProps, SecurityPoolWorkflowRouteContentProps, SecurityVaultRouteContentProps, TradingRouteContentProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createTradingProps(overrides: Partial<TradingRouteContentProps> = {}): TradingRouteContentProps {
	return {
		accountState: createAccountState(),
		loadingTradingForkUniverse: false,
		loadingTradingDetails: false,
		onCreateCompleteSet: () => undefined,
		onMigrateShares: () => undefined,
		onRedeemCompleteSet: () => undefined,
		onRedeemShares: () => undefined,
		onTradingFormChange: () => undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		selectedPool: undefined,
		tradingActiveAction: undefined,
		tradingDetails: undefined,
		tradingError: undefined,
		tradingForkUniverse: undefined,
		tradingForm: {
			completeSetAmount: '',
			redeemAmount: '',
			securityPoolAddress: '',
			selectedShareOutcome: 'yes',
			targetOutcomeIndexes: '',
		},
		tradingResult: undefined,
		...overrides,
	}
}

function createReportingProps(overrides: Partial<ReportingRouteContentProps> = {}): ReportingRouteContentProps {
	return {
		accountState: createAccountState(),
		loadingReportingDetails: false,
		onLoadReporting: () => undefined,
		onReportOutcome: () => undefined,
		onReportingFormChange: () => undefined,
		onWithdrawEscalation: () => undefined,
		reportingActiveAction: undefined,
		reportingDetails: undefined,
		reportingError: undefined,
		reportingForm: {
			reportAmount: '',
			securityPoolAddress: '',
			selectedOutcome: 'yes',
			withdrawDepositIndexes: '',
		},
		reportingResult: undefined,
		...overrides,
	}
}

function createSecurityVaultProps(overrides: Partial<SecurityVaultRouteContentProps> = {}): SecurityVaultRouteContentProps {
	return {
		accountState: createAccountState(),
		loadingSecurityVault: false,
		onApproveRep: () => undefined,
		onDepositRep: () => undefined,
		onLoadSecurityVault: () => undefined,
		onRedeemFees: () => undefined,
		onSetSecurityBondAllowance: () => undefined,
		onSecurityVaultFormChange: () => undefined,
		onWithdrawRep: () => undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPoolVaults: undefined,
		securityVaultActiveAction: undefined,
		securityVaultDetails: undefined,
		securityVaultError: undefined,
		securityVaultForm: {
			depositAmount: '',
			repWithdrawAmount: '',
			securityBondAllowanceAmount: '',
			securityPoolAddress: '',
			selectedVaultAddress: '',
		},
		securityVaultMissing: false,
		securityVaultRepApproval: {
			error: undefined,
			loading: false,
			value: 0n,
		},
		securityVaultRepBalance: undefined,
		securityVaultResult: undefined,
		selectedPoolSecurityMultiplier: undefined,
		...overrides,
	}
}

function createForkAuctionProps(overrides: Partial<ForkAuctionRouteContentProps> = {}): ForkAuctionRouteContentProps {
	return {
		accountState: createAccountState(),
		forkAuctionActiveAction: undefined,
		forkAuctionDetails: undefined,
		forkAuctionError: undefined,
		forkAuctionForm: {
			claimBidIndex: '',
			claimBidTick: '',
			depositIndexes: '',
			directForkQuestionId: '',
			directForkUniverseId: '',
			refundBidIndex: '',
			refundTick: '',
			repMigrationOutcomes: '',
			securityPoolAddress: '',
			selectedOutcome: 'yes',
			submitBidAmount: '',
			submitBidTick: '',
			vaultAddress: '',
			withdrawBidIndex: '',
			withdrawForAddress: '',
			withdrawTick: '',
		},
		forkAuctionResult: undefined,
		loadingForkAuctionDetails: false,
		onClaimAuctionProceeds: () => undefined,
		onCreateChildUniverse: () => undefined,
		onFinalizeTruthAuction: () => undefined,
		onForkAuctionFormChange: () => undefined,
		onForkUniverse: () => undefined,
		onForkWithOwnEscalation: () => undefined,
		onInitiateFork: () => undefined,
		onLoadForkAuction: () => undefined,
		onMigrateEscalationDeposits: () => undefined,
		onMigrateRepToZoltar: () => undefined,
		onMigrateVault: () => undefined,
		onRefundLosingBids: () => undefined,
		onStartTruthAuction: () => undefined,
		onSubmitBid: () => undefined,
		onWithdrawBids: () => undefined,
		...overrides,
	}
}

function createMarketDetails(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Will this resolve?',
		...overrides,
	}
}

function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return {
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 10n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		parent: zeroAddress,
		questionOutcome: 'yes',
		questionId: '0x01',
		securityMultiplier: 2n,
		securityPoolAddress: zeroAddress,
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 5n * 10n ** 18n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		vaultCount: 3n,
		vaults: [],
		...overrides,
	}
}

function createWorkflowProps(overrides: Partial<SecurityPoolWorkflowRouteContentProps> = {}): SecurityPoolWorkflowRouteContentProps {
	return {
		accountState: createAccountState(),
		activeUniverseId: 1n,
		checkedSecurityPoolAddress: undefined,
		closeLiquidationModal: () => undefined,
		forkAuction: createForkAuctionProps(),
		liquidationAmount: '',
		liquidationManagerAddress: undefined,
		liquidationModalOpen: false,
		liquidationSecurityPoolAddress: undefined,
		liquidationTargetVault: '',
		loadingPoolOracleManager: false,
		loadingSecurityPools: false,
		onLiquidationAmountChange: () => undefined,
		onLiquidationTargetVaultChange: () => undefined,
		onLoadPoolOracleManager: () => undefined,
		onOpenLiquidationModal: () => undefined,
		onQueueLiquidation: () => undefined,
		onExecutePendingPoolOperation: () => undefined,
		onRefreshSelectedPoolData: () => undefined,
		onRequestPoolPrice: () => undefined,
		onSelectedPoolViewChange: () => undefined,
		onSecurityPoolAddressChange: () => undefined,
		onViewPendingReport: () => undefined,
		poolOracleActiveAction: undefined,
		poolOracleManagerDetails: undefined,
		poolOracleManagerError: undefined,
		poolPriceOracleResult: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		reporting: createReportingProps(),
		selectedPoolView: '',
		securityPoolAddress: '',
		securityPoolOverviewActiveAction: undefined,
		securityPools: [],
		securityVault: createSecurityVaultProps(),
		trading: createTradingProps(),
		...overrides,
	}
}

function createOverviewProps(overrides: Partial<SecurityPoolsOverviewRouteContentProps> = {}): SecurityPoolsOverviewRouteContentProps {
	return {
		accountState: createAccountState(),
		checkedSecurityPoolAddress: undefined,
		closeLiquidationModal: () => undefined,
		hasLoadedSecurityPools: false,
		liquidationAmount: '',
		liquidationManagerAddress: undefined,
		liquidationModalOpen: false,
		liquidationSecurityPoolAddress: undefined,
		liquidationTargetVault: '',
		loadingSecurityPools: false,
		onLiquidationAmountChange: () => undefined,
		onLiquidationTargetVaultChange: () => undefined,
		onLoadSecurityPools: () => undefined,
		onOpenLiquidationModal: () => undefined,
		onQueueLiquidation: () => undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPoolOverviewActiveAction: undefined,
		securityPoolOverviewError: undefined,
		securityPoolOverviewResult: undefined,
		securityPools: [],
		...overrides,
	}
}

function createCreatePoolProps(overrides: Partial<SecurityPoolRouteContentProps> = {}): SecurityPoolRouteContentProps {
	return {
		accountState: createAccountState(),
		checkingDuplicateOriginPool: false,
		duplicateOriginPoolExists: false,
		loadingMarketDetails: false,
		marketDetails: undefined,
		onCreateSecurityPool: () => undefined,
		onLoadMarket: () => undefined,
		onLoadMarketById: async () => undefined,
		onResetSecurityPoolCreation: () => undefined,
		onSecurityPoolFormChange: () => undefined,
		poolCreationMarketDetails: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPools: [],
		securityPoolCreating: false,
		securityPoolError: undefined,
		securityPoolForm: {
			currentRetentionRate: '',
			marketId: '',
			securityMultiplier: '',
		},
		securityPoolResult: undefined,
		zoltarUniverseHasForked: false,
		...overrides,
	}
}

function createSecurityPoolsSectionProps(overrides: Partial<SecurityPoolsSectionProps> = {}): SecurityPoolsSectionProps {
	return {
		createPool: createCreatePoolProps(),
		overview: createOverviewProps(),
		workflow: createWorkflowProps(),
		...overrides,
	}
}

void describe('security pools selected tab refresh', () => {
	const currentSecurityPoolAddress = '0x1234567890123456789012345678901234567890'
	const nextSecurityPoolAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

	void test('refreshes selected pool data only when opening the selected pool view for a pool that is not already loaded', () => {
		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'browse',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
				selectedPoolExists: false,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'create',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
				selectedPoolExists: false,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress: '',
				selectedPoolExists: false,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
				selectedPoolExists: true,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
				selectedPoolExists: false,
			}),
		).toBe(true)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress,
				selectedPoolExists: true,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress,
				selectedPoolExists: false,
			}),
		).toBe(true)
	})
})

void describe('SecurityPoolsSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	void test('renders the header switch and hides the route summary in browse mode', async () => {
		const renderedComponent = await renderIntoDocument(h(SecurityPoolsSection, createSecurityPoolsSectionProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('tab', { name: 'Browse' })).not.toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Create' })).not.toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Operate' })).not.toBeNull()
		expect(documentQueries.queryByText('Mode')).toBeNull()
		expect(document.body.querySelector('.route-summary-strip')).toBeNull()
		expect(documentQueries.queryByText('Loaded pools')).toBeNull()
		expect(documentQueries.queryByText('Selected pool')).toBeNull()
		expect(documentQueries.queryByText('Pool status')).toBeNull()
		expect(documentQueries.queryByText('Next step')).toBeNull()
	})

	void test('auto-loads pool browse data once when opening the browse view without loaded pools', async () => {
		const calls: string[] = []
		const initialProps = createSecurityPoolsSectionProps({
			overview: createOverviewProps({
				hasLoadedSecurityPools: false,
				loadingSecurityPools: false,
				onLoadSecurityPools: () => {
					calls.push('load')
				},
			}),
		})

		const renderedComponent = await renderIntoDocument(h(SecurityPoolsSection, initialProps))
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(calls).toEqual(['load'])

		await act(() => {
			render(
				h(SecurityPoolsSection, {
					...initialProps,
					overview: createOverviewProps({
						hasLoadedSecurityPools: false,
						loadingSecurityPools: false,
						onLoadSecurityPools: () => {
							calls.push('rerender')
						},
					}),
				}),
				renderedComponent.container,
			)
		})

		expect(calls).toEqual(['load'])
	})

	void test('retries the browse auto-load after an earlier automatic load fails', async () => {
		const calls: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolsSection,
				createSecurityPoolsSectionProps({
					overview: createOverviewProps({
						hasLoadedSecurityPools: false,
						loadingSecurityPools: false,
						onLoadSecurityPools: () => {
							calls.push('load')
							return Promise.reject(new Error('temporary failure'))
						},
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		await Promise.resolve()
		await Promise.resolve()

		await act(() => {
			render(
				h(
					SecurityPoolsSection,
					createSecurityPoolsSectionProps({
						overview: createOverviewProps({
							hasLoadedSecurityPools: false,
							loadingSecurityPools: false,
							onLoadSecurityPools: () => {
								calls.push('retry')
							},
						}),
					}),
				),
				renderedComponent.container,
			)
		})

		expect(calls).toEqual(['load', 'retry'])
	})

	void test('keeps the route summary hidden even when the selected pool is resolved in operate mode', async () => {
		const selectedPool = createSelectedPool()
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolsSection,
				createSecurityPoolsSectionProps({
					overview: createOverviewProps({
						securityPools: [selectedPool],
					}),
					workflow: createWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						securityPoolAddress: zeroAddress,
						securityPools: [selectedPool],
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.route-summary-strip')).toBeNull()
		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Loaded pools')).toBeNull()
		expect(documentQueries.queryByText('Selected pool')).toBeNull()
		expect(documentQueries.queryByText('Pool status')).toBeNull()
		expect(documentQueries.queryByText('Next step')).toBeNull()
	})

	void test('keeps the route summary hidden in operate mode until the selected pool resolves', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolsSection,
				createSecurityPoolsSectionProps({
					workflow: createWorkflowProps({
						securityPoolAddress: '0x0000000000000000000000000000000000000001',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.route-summary-strip')).toBeNull()
	})

	void test('hides the truth auction metric when a listed pool has no truth auction address', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolsSection,
				createSecurityPoolsSectionProps({
					overview: createOverviewProps({
						hasLoadedSecurityPools: true,
						securityPools: [createSelectedPool()],
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Truth Auction')).toBeNull()
	})
})
