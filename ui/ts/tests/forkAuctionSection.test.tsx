/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, waitFor, within } from '@testing-library/dom'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { type Address, zeroAddress } from 'viem'
import { ForkAuctionSection } from '../components/ForkAuctionSection.js'
import { AUCTION_TIME_SECONDS, deriveHasForkActivity, getForkAuctionStageView, getTruthAuctionPriceAtTick } from '../lib/forkAuction.js'
import { formatCurrencyInputBalance, formatDuration } from '../lib/formatters.js'
import type { AccountState, ForkAuctionFormState, ReportingFormState } from '../types/app.js'
import type { ActiveReportingDetails, EscalationDeposit, ForkAuctionDetails, ListedSecurityPool, MarketDetails, ReadClient, TruthAuctionBidView, TruthAuctionTickSummary } from '../types/contracts.js'
import type { ForkAuctionSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from './testUtils/transactionActionButton.js'

const ETH = 10n ** 18n
const REP = 10n ** 18n
const PARENT_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f0'
const YES_CHILD_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f1'
const NO_CHILD_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f2'
const YES_TRUTH_AUCTION_ADDRESS: Address = '0x0000000000000000000000000000000000000aa1'
const NO_TRUTH_AUCTION_ADDRESS: Address = '0x0000000000000000000000000000000000000aa2'
type TruthAuctionReadContractRequest = Parameters<ReadClient['readContract']>[0]
type TruthAuctionReadContractHandler = (request: TruthAuctionReadContractRequest) => Promise<unknown>

function createReadContractStub(handler: TruthAuctionReadContractHandler): ReadClient['readContract'] {
	return async request => (await handler(request as TruthAuctionReadContractRequest)) as never
}

function createDeferred<T>() {
	let resolve: ((value: T | PromiseLike<T>) => void) | undefined
	let reject: ((reason?: unknown) => void) | undefined
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve
		reject = innerReject
	})

	return {
		promise,
		reject: (reason?: unknown) => {
			if (reject === undefined) throw new Error('Deferred promise reject handler was not initialized')
			reject(reason)
		},
		resolve: (value: T | PromiseLike<T>) => {
			if (resolve === undefined) throw new Error('Deferred promise resolve handler was not initialized')
			resolve(value)
		},
	}
}

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createMarketDetails(): MarketDetails {
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
	}
}

function rep(value: bigint) {
	return value * REP
}

function createDeposit(overrides: Partial<EscalationDeposit> = {}): EscalationDeposit {
	return {
		amount: rep(1n),
		cumulativeAmount: rep(1n),
		depositIndex: 0n,
		depositor: zeroAddress,
		...overrides,
	}
}

function createForkAuctionDetails(): ForkAuctionDetails {
	const forkAuctionDetails: ForkAuctionDetails = {
		auctionedSecurityBondAllowance: 10n,
		claimingAvailable: false,
		completeSetCollateralAmount: 1n,
		currentTime: 100n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		migrationEndsAt: 200n,
		parentSecurityPoolAddress: zeroAddress,
		questionOutcome: 'yes',
		repAtFork: 20n,
		securityPoolAddress: zeroAddress,
		systemState: 'forkMigration',
		truthAuction: undefined,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeId: 1n,
	}
	return {
		...forkAuctionDetails,
		hasForkActivity: deriveHasForkActivity(forkAuctionDetails),
	}
}

function createReportingForm(overrides: Partial<ReportingFormState> = {}): ReportingFormState {
	return {
		reportAmount: '',
		securityPoolAddress: zeroAddress,
		selectedOutcome: undefined,
		selectedWithdrawDepositIndexesByOutcome: {
			invalid: [],
			yes: [],
			no: [],
		},
		...overrides,
	}
}

function createReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		activationTime: 120n,
		bindingCapital: rep(10n),
		completeSetCollateralAmount: 1n,
		currentRequiredBond: rep(20n),
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThreshold: rep(40n),
		hasReachedNonDecision: true,
		marketDetails: createMarketDetails(),
		nonDecisionThreshold: rep(20n),
		questionOutcome: 'none',
		resolution: 'none',
		securityPoolAddress: zeroAddress,
		sides: [
			{ balance: rep(1n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			{ balance: rep(5n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
			{ balance: rep(5n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
		startBond: rep(3n),
		status: 'active',
		totalCost: rep(20n),
		universeId: 1n,
		viewerVaultAvailableEscalationRep: rep(10n),
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: rep(1n),
		viewerVaultRepDepositShare: rep(11n),
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		...overrides,
	}
}

function createPreviewPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	const previewPool: ListedSecurityPool = {
		completeSetCollateralAmount: 1n,
		currentRetentionRate: 10n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		parent: zeroAddress,
		questionOutcome: 'none',
		questionId: '0x01',
		securityMultiplier: 2n,
		securityPoolAddress: zeroAddress,
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 5n * ETH,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		vaultCount: 0n,
		vaults: [],
		...overrides,
	}
	return {
		...previewPool,
		hasForkActivity: overrides.hasForkActivity ?? deriveHasForkActivity(previewPool),
	}
}

function createTruthAuctionMetrics() {
	return {
		accumulatedEth: 0n,
		auctionEndsAt: 200n,
		clearingPrice: undefined,
		clearingTick: undefined,
		ethAtClearingTick: 0n,
		ethRaiseCap: 100n * ETH,
		ethRaised: 0n,
		finalized: false,
		hitCap: false,
		maxRepBeingSold: 100n * ETH,
		minBidSize: 2n * ETH,
		repPurchasableAtBid: undefined,
		timeRemaining: 100n,
		totalRepPurchased: 0n,
		underfunded: false,
	}
}

function createForkAuctionForm(overrides: Partial<ForkAuctionFormState> = {}): ForkAuctionFormState {
	return {
		claimBidIndex: '',
		claimBidTick: '',
		depositIndexes: '',
		directForkQuestionId: '',
		directForkUniverseId: '',
		refundBidIndex: '',
		refundTick: '',
		repMigrationOutcomes: '',
		securityPoolAddress: zeroAddress,
		selectedOutcome: 'yes',
		settlementAddress: '',
		submitBidAmount: '',
		submitBidPrice: '',
		vaultAddress: '',
		...overrides,
	}
}

function createTruthAuctionTickSummary(overrides: Partial<TruthAuctionTickSummary> = {}): TruthAuctionTickSummary {
	return {
		tick: 0n,
		price: ETH,
		currentTotalEth: 0n,
		submissionCount: 0n,
		active: false,
		...overrides,
	}
}

function createTruthAuctionBidView(overrides: Partial<TruthAuctionBidView> = {}): TruthAuctionBidView {
	return {
		tick: 0n,
		bidIndex: 0n,
		bidder: zeroAddress,
		ethAmount: 0n,
		cumulativeEth: 0n,
		activeCumulativeEthBeforeBid: 0n,
		claimed: false,
		refunded: false,
		...overrides,
	}
}

function createTruthAuctionReadClient(
	readContract: TruthAuctionReadContractHandler = async request => {
		if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary()
		if (request.functionName === 'activeTickCount') return 0n
		if (request.functionName === 'getActiveTickPage') return []
		if (request.functionName === 'getTickCount') return 0n
		if (request.functionName === 'getTickPage') return []
		if (request.functionName === 'getBidCountAtTick') return 0n
		if (request.functionName === 'getBidPageAtTick') return []
		if (request.functionName === 'getBidderBidCount') return 0n
		if (request.functionName === 'getBidderBidPage') return []
		throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
	},
): Pick<ReadClient, 'readContract'> {
	return {
		readContract: createReadContractStub(readContract),
	}
}

function createForkMigrationReadClient(
	readContract: TruthAuctionReadContractHandler = async request => {
		if (request.functionName === 'getChildUniverseId') return 11n
		if (request.functionName === 'getMigrationProxyAddress') return '0x00000000000000000000000000000000000000aa'
		if (request.functionName === 'getRepToken') return '0x00000000000000000000000000000000000000bb'
		if (request.functionName === 'balanceOf') {
			if ((request.args?.[0] ?? zeroAddress) === '0x00000000000000000000000000000000000000aa') return 5n * ETH
			return 0n
		}
		throw new Error(`Unexpected fork migration read: ${String(request.functionName)}`)
	},
): Pick<ReadClient, 'readContract'> {
	return {
		readContract: createReadContractStub(readContract),
	}
}

function createProps(overrides: Partial<ForkAuctionSectionProps> = {}): ForkAuctionSectionProps {
	const forkAuctionDetails = overrides.forkAuctionDetails ?? createForkAuctionDetails()
	const previewPool = overrides.previewPool
	const stageView =
		overrides.stageView ??
		getForkAuctionStageView({
			claimingAvailable: forkAuctionDetails?.claimingAvailable ?? false,
			forkOutcome: forkAuctionDetails?.forkOutcome ?? previewPool?.forkOutcome ?? 'none',
			migratedRep: forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep ?? 0n,
			systemState: forkAuctionDetails?.systemState ?? previewPool?.systemState ?? 'operational',
			truthAuction: forkAuctionDetails?.truthAuction,
			truthAuctionStartedAt: forkAuctionDetails?.truthAuctionStartedAt ?? previewPool?.truthAuctionStartedAt ?? 0n,
		})
	return {
		accountState: createAccountState(),
		auctionDetailsOverride: overrides.auctionDetailsOverride ?? (stageView === 'auction' || stageView === 'settlement' ? forkAuctionDetails : undefined),
		embedInCard: false,
		forkAuctionActiveAction: undefined,
		forkAuctionDetails,
		forkAuctionError: undefined,
		forkAuctionForm: createForkAuctionForm(),
		forkAuctionResult: undefined,
		forkMigrationReadClient: createForkMigrationReadClient(),
		loadingForkAuctionDetails: false,
		loadingReportingDetails: false,
		onClaimAuctionProceeds: () => undefined,
		onCreateChildUniverse: () => undefined,
		onFinalizeTruthAuction: () => undefined,
		onForkAuctionFormChange: () => undefined,
		onForkUniverse: () => undefined,
		onForkWithOwnEscalation: () => undefined,
		onInitiateFork: () => undefined,
		onLoadForkAuction: () => undefined,
		onMigrateEscalationDeposits: (_outcome, _depositIndexes) => undefined,
		onMigrateRepToZoltar: _outcomes => undefined,
		onMigrateVault: () => undefined,
		onRefundLosingBids: () => undefined,
		onReportingFormChange: () => undefined,
		onStartTruthAuction: () => undefined,
		onSubmitBid: () => undefined,
		previewPool,
		reportingDetails: undefined,
		reportingForm: createReportingForm(),
		securityPools: [],
		stageView,
		showHeader: false,
		showSecurityPoolAddressInput: false,
		truthAuctionReadClient: createTruthAuctionReadClient(),
		...overrides,
	}
}

function expectElementBefore(left: Element, right: Element) {
	expect((left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
}

function getMetricValue(container: HTMLElement, label: string) {
	const labelElement = within(container).getByText(label)
	const metricValue = labelElement.parentElement?.querySelector('.metric-field-value')
	if (metricValue === null || metricValue === undefined) throw new Error(`Missing metric value for ${label}`)
	return metricValue.textContent
}

describe('ForkAuctionSection', () => {
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

	test('omits the redundant stage banner and collapses lower-priority detail below the action area', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('This pool is operational. If it is a child universe, the fork and auction path has completed.')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Fork Workflow' })).toBeNull()
		expect(documentQueries.queryByRole('tablist', { name: 'Fork lifecycle stages' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Live Snapshot' })).toBeNull()
	})

	test('shows migration preview content before any fork activity exists', async () => {
		const renderedComponent = await renderIntoDocument(
			h(ForkAuctionSection, {
				...createProps({
					previewPool: createPreviewPool(),
					showHeader: true,
					showSecurityPoolAddressInput: true,
					stageView: 'migration',
				}),
				forkAuctionDetails: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const migrationSection = documentQueries.getByRole('heading', { name: 'Migration Status' }).closest('section')
		if (!(migrationSection instanceof HTMLElement)) throw new Error('Expected migration status section to render')

		expect(documentQueries.queryByRole('heading', { name: 'Fork Workflow' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Fork Trigger' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Refresh fork' })).toBeNull()
		expect(document.body.textContent?.includes('This pool is currently operational. Migration controls become meaningful once the pool has forked.')).toBe(false)
		expect(getMetricValue(migrationSection, 'Fork Type')).toBe('-')
	})

	test('keeps migration actions available while gating later-stage writes through the shared action matrix', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					previewPool: createPreviewPool({
						systemState: 'forkMigration',
						vaults: [
							{
								lockedRepInEscalationGame: rep(1n),
								repDepositShare: rep(2n),
								securityBondAllowance: 1n * ETH,
								unpaidEthFees: 0n,
								vaultAddress: zeroAddress,
							},
						],
					}),
					reportingDetails: createReportingDetails(),
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)

		expect(documentQueries.queryByRole('button', { name: 'Trigger Zoltar Fork' })).toBeNull()
		await waitFor(() => {
			expectTransactionButtonEnabled(document.body, 'Migrate Vault To Yes')
			expectTransactionButtonDisabled(document.body, 'Migrate Selected Yes Deposits', 'Select at least one deposit to migrate or use the all-deposits action below.')
			expectTransactionButtonEnabled(document.body, 'Migrate All Yes Deposits')
		})

		await act(() => {
			render(h(ForkAuctionSection, createProps({ stageView: 'auction' })), renderedComponent.container)
		})
		expectTransactionButtonDisabled(document.body, 'Start Truth Auction')
		expectTransactionButtonDisabled(document.body, 'Submit Bid')

		await act(() => {
			render(h(ForkAuctionSection, createProps({ stageView: 'settlement' })), renderedComponent.container)
		})
		expect(documentQueries.queryByRole('button', { name: 'Finalize Truth Auction' })).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Refund Losing Bid')
		expect(documentQueries.queryByRole('button', { name: 'Settle Finalized Bid' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Withdraw Bids' })).toBeNull()
	})

	test('gates disabled fork-workflow write controls while keeping the workflow banner visible', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					disabled: true,
					disabledMessage: 'This pool is currently operational, so fork and truth auction actions are read only.',
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)

		expectTransactionButtonDisabled(document.body, 'Migrate Vault To Yes')
		expectTransactionButtonDisabled(document.body, 'Migrate Selected Yes Deposits')
		expectTransactionButtonDisabled(document.body, 'Migrate All Yes Deposits')

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						disabled: true,
						disabledMessage: 'This pool is currently operational, so fork and truth auction actions are read only.',
						stageView: 'auction',
					}),
				),
				renderedComponent.container,
			)
		})
		expectTransactionButtonDisabled(document.body, 'Start Truth Auction')
		expectTransactionButtonDisabled(document.body, 'Submit Bid')

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						disabled: true,
						disabledMessage: 'This pool is currently operational, so fork and truth auction actions are read only.',
						stageView: 'settlement',
					}),
				),
				renderedComponent.container,
			)
		})
		expect(documentQueries.queryByRole('button', { name: 'Finalize Truth Auction' })).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Refund Losing Bid')
		expect(documentQueries.queryByRole('button', { name: 'Settle Finalized Bid' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Withdraw Bids' })).toBeNull()
	})

	test('shows wallet migration balances and moves escalation migration onto deposit selection rows', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkMigration',
					},
					previewPool: createPreviewPool({
						systemState: 'forkMigration',
						vaultCount: 1n,
						vaults: [
							{
								lockedRepInEscalationGame: 3n * ETH,
								repDepositShare: 12n * ETH,
								securityBondAllowance: 2n * ETH,
								unpaidEthFees: 0n,
								vaultAddress: zeroAddress,
							},
						],
					}),
					reportingDetails: createReportingDetails({
						sides: [
							{ balance: rep(1n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{
								balance: rep(5n),
								deposits: [],
								key: 'yes',
								label: 'Yes',
								userDeposits: [
									createDeposit({
										amount: rep(2n),
										cumulativeAmount: rep(3n),
										depositIndex: 1n,
									}),
								],
							},
							{ balance: rep(5n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Time Left')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'What You Need To Do Now' })).toBeNull()
		const migrationBalancesSection = documentQueries.getByRole('heading', { name: 'Your Migration Balances' }).closest('section')
		if (!(migrationBalancesSection instanceof HTMLElement)) throw new Error('Expected migration balances section to render')
		expect(within(migrationBalancesSection).getByText('REP Collateral')).not.toBeNull()
		expect(within(migrationBalancesSection).getByText('Security Bond Allowance')).not.toBeNull()
		expect(within(migrationBalancesSection).getByText('Locked REP')).not.toBeNull()
		expect(within(migrationBalancesSection).getByRole('heading', { name: 'Migrate Vault' })).not.toBeNull()
		expect(within(migrationBalancesSection).getByRole('heading', { name: 'Migrate Escalation Deposits' })).not.toBeNull()
		expect(within(migrationBalancesSection).getByRole('button', { name: 'Migrate Vault To Yes' })).not.toBeNull()
		expect(within(migrationBalancesSection).getByRole('button', { name: 'Migrate Selected Yes Deposits' })).not.toBeNull()
		expect(within(migrationBalancesSection).getByRole('button', { name: 'Migrate All Yes Deposits' })).not.toBeNull()
		expect(within(migrationBalancesSection).getByRole('checkbox', { name: /Deposit #1/i })).not.toBeNull()
		expect(within(migrationBalancesSection).queryByText('Vault Address')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Create Child Universe' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Migrate Pool REP' })).toBeNull()
	})

	test('prefers the live chain timestamp over the loaded snapshot for migration time left', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentTimestamp: 150n,
					forkAuctionDetails: createForkAuctionDetails(),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes(formatDuration(200n - 100n))).toBe(false)
		expect(document.body.textContent?.includes(formatDuration(200n - 150n))).toBe(true)
	})

	test('uses the selected escalation-deposit checkboxes to drive migration actions', async () => {
		const reportingFormUpdates: Partial<ReportingFormState>[] = []
		const migrateEscalationCalls: Array<{ depositIndexes: bigint[] | undefined; outcome: string }> = []
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					reportingDetails: createReportingDetails({
						sides: [
							{ balance: rep(1n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{
								balance: rep(5n),
								deposits: [],
								key: 'yes',
								label: 'Yes',
								userDeposits: [createDeposit({ amount: rep(2n), cumulativeAmount: rep(2n), depositIndex: 0n }), createDeposit({ amount: rep(3n), cumulativeAmount: rep(5n), depositIndex: 1n })],
							},
							{ balance: rep(5n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
					reportingForm: createReportingForm(),
					onMigrateEscalationDeposits: (outcome, depositIndexes) => {
						migrateEscalationCalls.push({ depositIndexes, outcome })
					},
					onReportingFormChange: update => {
						reportingFormUpdates.push(update)
					},
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('checkbox', { name: /Deposit #1/i }))

		expect(reportingFormUpdates).toContainEqual({
			selectedWithdrawDepositIndexesByOutcome: {
				invalid: [],
				yes: [1n],
				no: [],
			},
		})

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						reportingDetails: createReportingDetails({
							sides: [
								{ balance: rep(1n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
								{
									balance: rep(5n),
									deposits: [],
									key: 'yes',
									label: 'Yes',
									userDeposits: [createDeposit({ amount: rep(2n), cumulativeAmount: rep(2n), depositIndex: 0n }), createDeposit({ amount: rep(3n), cumulativeAmount: rep(5n), depositIndex: 1n })],
								},
								{ balance: rep(5n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
							],
						}),
						reportingForm: createReportingForm({
							selectedWithdrawDepositIndexesByOutcome: {
								invalid: [],
								yes: [1n],
								no: [],
							},
						}),
						onMigrateEscalationDeposits: (outcome, depositIndexes) => {
							migrateEscalationCalls.push({ depositIndexes, outcome })
						},
						onReportingFormChange: update => {
							reportingFormUpdates.push(update)
						},
						stageView: 'migration',
					}),
				),
				renderedComponent.container,
			)
		})

		fireEvent.click(documentQueries.getByRole('button', { name: 'Migrate Selected Yes Deposits' }))
		fireEvent.click(documentQueries.getByRole('button', { name: 'Migrate All Yes Deposits' }))

		expect(migrateEscalationCalls).toEqual([
			{ depositIndexes: [1n], outcome: 'yes' },
			{ depositIndexes: [0n, 1n], outcome: 'yes' },
		])
	})

	test('updates locked rep in the parent migration balances after escalation migration succeeds', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					previewPool: createPreviewPool({
						systemState: 'forkMigration',
						vaultCount: 1n,
						vaults: [
							{
								lockedRepInEscalationGame: rep(3n),
								repDepositShare: 0n,
								securityBondAllowance: 0n,
								unpaidEthFees: 0n,
								vaultAddress: zeroAddress,
							},
						],
					}),
					reportingDetails: createReportingDetails({
						sides: [
							{ balance: rep(1n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{
								balance: rep(5n),
								deposits: [],
								key: 'yes',
								label: 'Yes',
								userDeposits: [
									createDeposit({
										amount: rep(2n),
										cumulativeAmount: rep(3n),
										depositIndex: 1n,
									}),
								],
							},
							{ balance: rep(5n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
					reportingForm: createReportingForm({
						selectedWithdrawDepositIndexesByOutcome: {
							invalid: [],
							yes: [1n],
							no: [],
						},
					}),
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const migrationBalancesSection = within(document.body).getByRole('heading', { name: 'Your Migration Balances' }).closest('section')
		if (!(migrationBalancesSection instanceof HTMLElement)) throw new Error('Expected migration balances section to render')
		const lockedRepMetric = within(migrationBalancesSection).getByText('Locked REP').closest('div')
		if (!(lockedRepMetric instanceof HTMLElement)) throw new Error('Expected locked REP metric to render')
		expect(within(lockedRepMetric).getByRole('button', { name: 'Copy exact value 3' })).not.toBeNull()

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Migrate Selected Yes Deposits' }))
		})

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						forkAuctionResult: {
							action: 'migrateEscalationDeposits',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000e1',
							securityPoolAddress: zeroAddress,
							universeId: 1n,
						},
						previewPool: createPreviewPool({
							systemState: 'forkMigration',
							vaultCount: 1n,
							vaults: [
								{
									lockedRepInEscalationGame: rep(3n),
									repDepositShare: 0n,
									securityBondAllowance: 0n,
									unpaidEthFees: 0n,
									vaultAddress: zeroAddress,
								},
							],
						}),
						reportingDetails: createReportingDetails({
							sides: [
								{ balance: rep(1n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
								{
									balance: rep(5n),
									deposits: [],
									key: 'yes',
									label: 'Yes',
									userDeposits: [
										createDeposit({
											amount: rep(2n),
											cumulativeAmount: rep(3n),
											depositIndex: 1n,
										}),
									],
								},
								{ balance: rep(5n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
							],
						}),
						reportingForm: createReportingForm({
							selectedWithdrawDepositIndexesByOutcome: {
								invalid: [],
								yes: [1n],
								no: [],
							},
						}),
						stageView: 'migration',
					}),
				),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(within(lockedRepMetric).getByRole('button', { name: 'Copy exact value 1' })).not.toBeNull()
		})
	})

	test('requires pool migration before vault migration when the selected child pool has not been funded yet', async () => {
		const migrateRepCalls: Array<string[] | undefined> = []
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					forkMigrationReadClient: createForkMigrationReadClient(async request => {
						if (request.functionName === 'getChildUniverseId') return 11n
						if (request.functionName === 'getMigrationProxyAddress') return '0x00000000000000000000000000000000000000aa'
						if (request.functionName === 'getRepToken') return '0x00000000000000000000000000000000000000bb'
						if (request.functionName === 'balanceOf') return 0n
						throw new Error(`Unexpected fork migration read: ${String(request.functionName)}`)
					}),
					onMigrateRepToZoltar: outcomes => {
						migrateRepCalls.push(outcomes)
					},
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expectTransactionButtonDisabled(document.body, 'Migrate Vault To Yes', 'Migrate pool to the Yes universe before moving vault balances.')
		})
		fireEvent.click(within(document.body).getByRole('button', { name: 'Migrate Pool To Yes Universe' }))
		expect(migrateRepCalls).toEqual([['yes']])
	})

	test('shows pool migration as already complete and disables the pool migration button once funded', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					forkMigrationReadClient: createForkMigrationReadClient(async request => {
						if (request.functionName === 'getChildUniverseId') return 11n
						if (request.functionName === 'getMigrationProxyAddress') return '0x00000000000000000000000000000000000000aa'
						if (request.functionName === 'getRepToken') return '0x00000000000000000000000000000000000000bb'
						if (request.functionName === 'balanceOf') return request.address === '0x00000000000000000000000000000000000000aa' ? 0n : 1n
						throw new Error(`Unexpected fork migration read: ${String(request.functionName)}`)
					}),
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(within(document.body).getByText('Pool REP for this outcome is already staged and will sweep into the child universe during vault migration.')).not.toBeNull()
			expectTransactionButtonDisabled(document.body, 'Migrate Pool To Yes Universe', 'Pool REP has already been migrated to the Yes universe.')
		})
	})

	test('shows the selected child pool auction status and switches with the selected outcome', async () => {
		const parentDetails = {
			...createForkAuctionDetails(),
			currentTime: 300n,
			migrationEndsAt: 200n,
			securityPoolAddress: PARENT_POOL_ADDRESS,
			systemState: 'forkMigration' as const,
		}
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					auctionDetailsOverride: undefined,
					forkAuctionDetails: parentDetails,
					forkAuctionForm: createForkAuctionForm({
						selectedOutcome: 'yes',
					}),
					securityPools: [
						createPreviewPool({
							parent: PARENT_POOL_ADDRESS,
							questionOutcome: 'yes',
							securityPoolAddress: YES_CHILD_POOL_ADDRESS,
							truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
							truthAuctionStartedAt: 310n,
						}),
						createPreviewPool({
							parent: PARENT_POOL_ADDRESS,
							questionOutcome: 'no',
							securityPoolAddress: NO_CHILD_POOL_ADDRESS,
							truthAuctionAddress: NO_TRUTH_AUCTION_ADDRESS,
							truthAuctionStartedAt: 410n,
						}),
					],
					stageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const auctionStatusSection = within(document.body).getByRole('heading', { name: 'Auction Status' }).closest('section')
		if (!(auctionStatusSection instanceof HTMLElement)) throw new Error('Expected auction status section to render')
		expect(getMetricValue(auctionStatusSection, 'Auction Address')).toContain('0x0000')
		expect(getMetricValue(auctionStatusSection, 'Auction Address')).toContain('0aa1')

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						auctionDetailsOverride: undefined,
						forkAuctionDetails: parentDetails,
						forkAuctionForm: createForkAuctionForm({
							selectedOutcome: 'no',
						}),
						securityPools: [
							createPreviewPool({
								parent: PARENT_POOL_ADDRESS,
								questionOutcome: 'yes',
								securityPoolAddress: YES_CHILD_POOL_ADDRESS,
								truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
								truthAuctionStartedAt: 310n,
							}),
							createPreviewPool({
								parent: PARENT_POOL_ADDRESS,
								questionOutcome: 'no',
								securityPoolAddress: NO_CHILD_POOL_ADDRESS,
								truthAuctionAddress: NO_TRUTH_AUCTION_ADDRESS,
								truthAuctionStartedAt: 410n,
							}),
						],
						stageView: 'auction',
					}),
				),
				renderedComponent.container,
			)
		})

		expect(getMetricValue(auctionStatusSection, 'Auction Address')).toContain('0aa2')
	})

	test('shows a passive missing-child message on the auction tab without child-creation actions', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					auctionDetailsOverride: undefined,
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						currentTime: 300n,
						migrationEndsAt: 200n,
						securityPoolAddress: PARENT_POOL_ADDRESS,
						systemState: 'forkMigration',
					},
					stageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('Child universe not created for the Yes outcome yet.')).not.toBeNull()
		expect(within(document.body).queryByRole('button', { name: 'Create Child Universe' })).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Start Truth Auction', 'Child universe not created for the Yes outcome yet.')
	})

	test('starts the truth auction for the selected child pool instead of the parent pool', async () => {
		const startTruthAuctionCalls: Array<string | undefined> = []
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					auctionDetailsOverride: undefined,
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						currentTime: 300n,
						migrationEndsAt: 200n,
						securityPoolAddress: PARENT_POOL_ADDRESS,
						systemState: 'forkMigration',
					},
					onStartTruthAuction: securityPoolAddressOverride => {
						startTruthAuctionCalls.push(securityPoolAddressOverride)
					},
					securityPools: [
						createPreviewPool({
							parent: PARENT_POOL_ADDRESS,
							questionOutcome: 'yes',
							securityPoolAddress: YES_CHILD_POOL_ADDRESS,
						}),
					],
					stageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Start Truth Auction' }))
		})

		expect(startTruthAuctionCalls).toEqual([YES_CHILD_POOL_ADDRESS])
	})

	test('does not mark vault migration complete just because the selected child vault already has balances', async () => {
		const selectedOutcomeChildPool = createPreviewPool({
			parent: zeroAddress,
			questionOutcome: 'yes',
			securityPoolAddress: '0x0000000000000000000000000000000000000100',
			systemState: 'forkMigration',
			vaults: [
				{
					lockedRepInEscalationGame: 0n,
					repDepositShare: rep(1n),
					securityBondAllowance: 0n,
					unpaidEthFees: 0n,
					vaultAddress: zeroAddress,
				},
			],
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkMigration',
					},
					previewPool: createPreviewPool({
						systemState: 'forkMigration',
						vaults: [
							{
								lockedRepInEscalationGame: 0n,
								repDepositShare: rep(2n),
								securityBondAllowance: 1n,
								unpaidEthFees: 0n,
								vaultAddress: zeroAddress,
							},
						],
					}),
					securityPools: [selectedOutcomeChildPool],
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expectTransactionButtonEnabled(document.body, 'Migrate Vault To Yes')
		})
		expect(document.body.textContent?.includes('Already migrated')).toBe(false)
	})

	test('marks vault migration complete globally after a successful migration result', async () => {
		let migrateVaultCalls = 0
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkMigration',
					},
					forkAuctionForm: {
						...createForkAuctionForm(),
						selectedOutcome: 'yes',
					},
					forkAuctionResult: undefined,
					onMigrateVault: () => {
						migrateVaultCalls += 1
					},
					previewPool: createPreviewPool({
						systemState: 'forkMigration',
						vaults: [
							{
								lockedRepInEscalationGame: 0n,
								repDepositShare: rep(2n),
								securityBondAllowance: 1n,
								unpaidEthFees: 0n,
								vaultAddress: zeroAddress,
							},
						],
					}),
					securityPools: [
						createPreviewPool({
							parent: zeroAddress,
							questionOutcome: 'yes',
							securityPoolAddress: '0x0000000000000000000000000000000000000101',
							systemState: 'forkMigration',
							vaults: [
								{
									lockedRepInEscalationGame: 0n,
									repDepositShare: rep(2n),
									securityBondAllowance: 1n,
									unpaidEthFees: 0n,
									vaultAddress: zeroAddress,
								},
							],
						}),
						createPreviewPool({
							parent: zeroAddress,
							questionOutcome: 'invalid',
							securityPoolAddress: '0x0000000000000000000000000000000000000102',
							systemState: 'forkMigration',
							vaults: [],
						}),
					],
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expectTransactionButtonEnabled(document.body, 'Migrate Vault To Yes')
		})
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Migrate Vault To Yes' }))
		})
		expect(migrateVaultCalls).toBe(1)

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						forkAuctionDetails: {
							...createForkAuctionDetails(),
							systemState: 'forkMigration',
						},
						forkAuctionForm: {
							...createForkAuctionForm(),
							selectedOutcome: 'yes',
						},
						onMigrateVault: () => {
							migrateVaultCalls += 1
						},
						forkAuctionResult: {
							action: 'migrateVault',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000f3',
							securityPoolAddress: zeroAddress,
							universeId: 1n,
						},
						previewPool: createPreviewPool({
							systemState: 'forkMigration',
							vaults: [
								{
									lockedRepInEscalationGame: 0n,
									repDepositShare: rep(2n),
									securityBondAllowance: 1n,
									unpaidEthFees: 0n,
									vaultAddress: zeroAddress,
								},
							],
						}),
						securityPools: [
							createPreviewPool({
								parent: zeroAddress,
								questionOutcome: 'yes',
								securityPoolAddress: '0x0000000000000000000000000000000000000101',
								systemState: 'forkMigration',
								vaults: [
									{
										lockedRepInEscalationGame: 0n,
										repDepositShare: rep(2n),
										securityBondAllowance: 1n,
										unpaidEthFees: 0n,
										vaultAddress: zeroAddress,
									},
								],
							}),
							createPreviewPool({
								parent: zeroAddress,
								questionOutcome: 'invalid',
								securityPoolAddress: '0x0000000000000000000000000000000000000102',
								systemState: 'forkMigration',
								vaults: [],
							}),
						],
						stageView: 'migration',
					}),
				),
				renderedComponent.container,
			)
		})

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						forkAuctionDetails: {
							...createForkAuctionDetails(),
							systemState: 'forkMigration',
						},
						forkAuctionForm: {
							...createForkAuctionForm(),
							selectedOutcome: 'invalid',
						},
						onMigrateVault: () => {
							migrateVaultCalls += 1
						},
						forkAuctionResult: {
							action: 'migrateVault',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000f3',
							securityPoolAddress: zeroAddress,
							universeId: 1n,
						},
						previewPool: createPreviewPool({
							systemState: 'forkMigration',
							vaults: [
								{
									lockedRepInEscalationGame: 0n,
									repDepositShare: rep(2n),
									securityBondAllowance: 1n,
									unpaidEthFees: 0n,
									vaultAddress: zeroAddress,
								},
							],
						}),
						securityPools: [
							createPreviewPool({
								parent: zeroAddress,
								questionOutcome: 'yes',
								securityPoolAddress: '0x0000000000000000000000000000000000000101',
								systemState: 'forkMigration',
								vaults: [
									{
										lockedRepInEscalationGame: 0n,
										repDepositShare: rep(2n),
										securityBondAllowance: 1n,
										unpaidEthFees: 0n,
										vaultAddress: zeroAddress,
									},
								],
							}),
							createPreviewPool({
								parent: zeroAddress,
								questionOutcome: 'invalid',
								securityPoolAddress: '0x0000000000000000000000000000000000000102',
								systemState: 'forkMigration',
								vaults: [],
							}),
						],
						stageView: 'migration',
					}),
				),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expectTransactionButtonDisabled(document.body, 'Migrate Vault To Invalid', 'Vault migration is already complete for this wallet.')
		})
		expect(document.body.textContent?.includes('Already migrated')).toBe(true)
	})

	test('keeps vault migration available while no successful migration result or refreshed empty balances exist', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkMigration',
					},
					forkAuctionForm: {
						...createForkAuctionForm(),
						selectedOutcome: 'no',
					},
					previewPool: createPreviewPool({
						systemState: 'forkMigration',
						vaults: [
							{
								lockedRepInEscalationGame: 0n,
								repDepositShare: rep(2n),
								securityBondAllowance: 1n,
								unpaidEthFees: 0n,
								vaultAddress: zeroAddress,
							},
						],
					}),
					securityPools: [
						createPreviewPool({
							parent: zeroAddress,
							questionOutcome: 'no',
							securityPoolAddress: '0x0000000000000000000000000000000000000201',
							systemState: 'forkMigration',
							vaults: [
								{
									lockedRepInEscalationGame: 0n,
									repDepositShare: rep(2n),
									securityBondAllowance: 1n,
									unpaidEthFees: 0n,
									vaultAddress: zeroAddress,
								},
							],
						}),
						createPreviewPool({
							parent: zeroAddress,
							questionOutcome: 'yes',
							securityPoolAddress: '0x0000000000000000000000000000000000000202',
							systemState: 'forkMigration',
							vaults: [],
						}),
					],
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expectTransactionButtonEnabled(document.body, 'Migrate Vault To No')
		})

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						forkAuctionDetails: {
							...createForkAuctionDetails(),
							systemState: 'forkMigration',
						},
						forkAuctionForm: {
							...createForkAuctionForm(),
							selectedOutcome: 'yes',
						},
						previewPool: createPreviewPool({
							systemState: 'forkMigration',
							vaults: [
								{
									lockedRepInEscalationGame: 0n,
									repDepositShare: rep(2n),
									securityBondAllowance: 1n,
									unpaidEthFees: 0n,
									vaultAddress: zeroAddress,
								},
							],
						}),
						securityPools: [
							createPreviewPool({
								parent: zeroAddress,
								questionOutcome: 'no',
								securityPoolAddress: '0x0000000000000000000000000000000000000201',
								systemState: 'forkMigration',
								vaults: [
									{
										lockedRepInEscalationGame: 0n,
										repDepositShare: rep(2n),
										securityBondAllowance: 1n,
										unpaidEthFees: 0n,
										vaultAddress: zeroAddress,
									},
								],
							}),
							createPreviewPool({
								parent: zeroAddress,
								questionOutcome: 'yes',
								securityPoolAddress: '0x0000000000000000000000000000000000000202',
								systemState: 'forkMigration',
								vaults: [],
							}),
						],
						stageView: 'migration',
					}),
				),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expectTransactionButtonEnabled(document.body, 'Migrate Vault To Yes')
		})
		expect(document.body.textContent?.includes('Already migrated')).toBe(false)
	})

	test('renders latest fork action status outside action rows', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					forkAuctionResult: {
						action: 'migrateVault',
						hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
						securityPoolAddress: zeroAddress,
						universeId: 1n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(document.body.querySelector('.workflow-transaction-status')).not.toBeNull()
		expect(documentQueries.getByText('Vault Migrated')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Latest Fork / Auction Action' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Latest Fork / Auction Action' }).closest('.actions')).toBeNull()
	})

	test('disables wallet migration actions once the connected wallet has no migration balances left', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					previewPool: createPreviewPool({
						systemState: 'forkMigration',
						vaultCount: 1n,
						vaults: [
							{
								lockedRepInEscalationGame: 0n,
								repDepositShare: 0n,
								securityBondAllowance: 0n,
								unpaidEthFees: 0n,
								vaultAddress: zeroAddress,
							},
						],
					}),
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Migrate Vault To Yes', 'No REP collateral or security bond allowance remains to migrate for the connected wallet.')
		expectTransactionButtonDisabled(document.body, 'Migrate Selected Yes Deposits', 'No locked REP remains to migrate for the connected wallet.')
		expectTransactionButtonDisabled(document.body, 'Migrate All Yes Deposits', 'No locked REP remains to migrate for the connected wallet.')
	})

	test('does not imply a concrete fork type before a fork path is chosen after non-decision', async () => {
		const renderedComponent = await renderIntoDocument(
			h(ForkAuctionSection, {
				...createProps({
					forkAuctionDetails: undefined,
					lifecycleStateOverride: 'poolForked',
					previewPool: createPreviewPool({ questionOutcome: 'yes' }),
					showHeader: true,
					showSecurityPoolAddressInput: true,
					stageView: 'migration',
				}),
				forkAuctionDetails: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const migrationSection = documentQueries.getByRole('heading', { name: 'Migration Status' }).closest('section')
		if (!(migrationSection instanceof HTMLElement)) throw new Error('Expected migration status section to render')

		expect(documentQueries.queryByRole('heading', { name: 'Fork Workflow' })).toBeNull()
		expect(getMetricValue(migrationSection, 'Fork Type')).toBe('Not chosen yet')
		expect(within(migrationSection).queryByText('Viewing')).toBeNull()
		expect(within(migrationSection).queryByText('Fork Outcome')).toBeNull()
		expect(documentQueries.queryByText('Parent/Zoltar fork')).toBeNull()
	})

	test('recomputes truth auction time left from the live chain timestamp', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentTimestamp: 150n,
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						currentTime: 100n,
						systemState: 'forkTruthAuction',
						truthAuction: {
							accumulatedEth: 0n,
							auctionEndsAt: 200n,
							clearingPrice: undefined,
							clearingTick: undefined,
							ethAtClearingTick: 0n,
							ethRaiseCap: 10n,
							ethRaised: 0n,
							finalized: false,
							hitCap: false,
							maxRepBeingSold: 10n,
							minBidSize: 1n,
							repPurchasableAtBid: undefined,
							timeRemaining: 100n,
							totalRepPurchased: 0n,
							underfunded: false,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 200n - AUCTION_TIME_SECONDS,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes(formatDuration(100n))).toBe(false)
		expect(document.body.textContent?.includes(formatDuration(50n))).toBe(true)
	})

	test('blocks truth auction bids below the minimum bid size', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: createTruthAuctionMetrics(),
						truthAuctionStartedAt: 1n,
					},
					forkAuctionForm: {
						...createForkAuctionForm(),
						submitBidAmount: (1n * ETH).toString(),
						submitBidPrice: '1',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Submit Bid', 'Bid must be at least 2 ETH.')
	})

	test('blocks truth auction bids when the wallet lacks enough ETH for the selected amount', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 2n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: createTruthAuctionMetrics(),
						truthAuctionStartedAt: 1n,
					},
					forkAuctionForm: {
						...createForkAuctionForm(),
						submitBidAmount: (3n * ETH).toString(),
						submitBidPrice: '1',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Submit Bid', 'Need 1 more ETH in this wallet to bid the selected amount.')
	})

	test('uses finalized-aware time left and finalized bid guard on the auction tab', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					currentTimestamp: 150n,
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						currentTime: 150n,
						systemState: 'forkTruthAuction',
						truthAuction: {
							...createTruthAuctionMetrics(),
							auctionEndsAt: 1_000n,
							finalized: true,
							timeRemaining: 500n,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					forkAuctionForm: {
						...createForkAuctionForm(),
						submitBidAmount: (3n * ETH).toString(),
						submitBidPrice: 'abc',
					},
					stageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('Bid Price (ETH / REP)')).not.toBeNull()
		expect(within(document.body).queryByText('Bid Tick')).toBeNull()

		const auctionOverviewSection = within(document.body).getByRole('heading', { name: 'Auction Overview' }).closest('section')
		if (!(auctionOverviewSection instanceof HTMLElement)) throw new Error('Expected auction overview section to render')
		expect(getMetricValue(auctionOverviewSection, 'Time Left')).toBe('0m')
		expectTransactionButtonDisabled(document.body, 'Submit Bid', 'Truth auction is already finalized.')
	})

	test('shows a price-specific bid validation error for malformed live-auction prices', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: createTruthAuctionMetrics(),
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					forkAuctionForm: {
						...createForkAuctionForm(),
						submitBidAmount: (3n * ETH).toString(),
						submitBidPrice: 'abc',
					},
					stageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Submit Bid', 'Enter a valid bid price.')
	})

	test('disables start truth auction until migration ends and enables it afterwards', async () => {
		const baseProps = createProps({
			currentTimestamp: 150n,
			auctionDetailsOverride: undefined,
			forkAuctionDetails: {
				...createForkAuctionDetails(),
				migrationEndsAt: 200n,
				systemState: 'forkMigration',
			},
			securityPools: [
				createPreviewPool({
					parent: zeroAddress,
					questionOutcome: 'yes',
					securityPoolAddress: YES_CHILD_POOL_ADDRESS,
				}),
			],
			stageView: 'auction',
		})
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, baseProps))
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Start Truth Auction', 'Migration is still active. Truth auction can start once migration ends.')

		await act(() => {
			render(
				h(ForkAuctionSection, {
					...baseProps,
					currentTimestamp: 201n,
				}),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expectTransactionButtonEnabled(document.body, 'Start Truth Auction')
		})
	})

	test('shows a timer indicating when truth auction can be started', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentTimestamp: 150n,
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						migrationEndsAt: 210n,
						systemState: 'forkMigration',
					},
					stageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const auctionStatusSection = within(document.body).getByRole('heading', { name: 'Auction Status' }).closest('section')
		if (!(auctionStatusSection instanceof HTMLElement)) throw new Error('Expected auction status section to render')

		expect(document.body.textContent?.includes('Truth auction can be started in 1m once migration ends.')).toBe(true)
		expect(getMetricValue(auctionStatusSection, 'Started')).toBe('Starts in 1m')
		expect(document.body.textContent?.includes('This pool is currently in Migration. Auction controls become meaningful after migration completes and the truth auction starts.')).toBe(false)
	})

	test('shows bypass auction copy when no parent collateral remains to auction', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentTimestamp: 201n,
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						completeSetCollateralAmount: 0n,
						migrationEndsAt: 200n,
						systemState: 'forkMigration',
					},
					securityPools: [
						createPreviewPool({
							parent: zeroAddress,
							questionOutcome: 'yes',
							securityPoolAddress: YES_CHILD_POOL_ADDRESS,
						}),
					],
					stageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Bypass Auction')
		expect(document.body.textContent?.includes('No parent collateral remains to auction, so this step immediately bypasses bidding and finalizes the child pool.')).toBe(true)
		expect(within(document.body).queryByRole('button', { name: 'Start Truth Auction' })).toBeNull()
	})

	test('refreshes auction status immediately after truth auction start succeeds', async () => {
		let startTruthAuctionCalls = 0
		const baseProps = createProps({
			currentTimestamp: 201n,
			auctionDetailsOverride: undefined,
			forkAuctionDetails: {
				...createForkAuctionDetails(),
				migrationEndsAt: 200n,
				systemState: 'forkMigration',
			},
			onStartTruthAuction: () => {
				startTruthAuctionCalls += 1
			},
			securityPools: [
				createPreviewPool({
					parent: zeroAddress,
					questionOutcome: 'yes',
					securityPoolAddress: YES_CHILD_POOL_ADDRESS,
				}),
			],
			stageView: 'auction',
		})
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, baseProps))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		expectTransactionButtonEnabled(document.body, 'Start Truth Auction')
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Start Truth Auction' }))
		})
		expect(startTruthAuctionCalls).toBe(1)
		expectTransactionButtonDisabled(document.body, 'Start Truth Auction', 'Starting truth auction...')
		const pendingAuctionStatusSection = documentQueries.getByRole('heading', { name: 'Auction Status' }).closest('section')
		if (!(pendingAuctionStatusSection instanceof HTMLElement)) throw new Error('Expected auction status section to render')
		expect(getMetricValue(pendingAuctionStatusSection, 'Started')).toBe('Starting...')
		expect(getMetricValue(pendingAuctionStatusSection, 'Ends')).toBe('Pending confirmation')
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Start Truth Auction' }))
		})
		expect(startTruthAuctionCalls).toBe(1)

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						...baseProps,
						forkAuctionResult: {
							action: 'startTruthAuction',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000f0',
							securityPoolAddress: YES_CHILD_POOL_ADDRESS,
							universeId: 1n,
						},
					}),
				),
				renderedComponent.container,
			)
		})
		const auctionStatusSection = documentQueries.getByRole('heading', { name: 'Auction Status' }).closest('section')
		if (!(auctionStatusSection instanceof HTMLElement)) throw new Error('Expected auction status section to render')

		expectTransactionButtonDisabled(document.body, 'Start Truth Auction', 'Truth auction already started.')
		expect(getMetricValue(auctionStatusSection, 'Started')).not.toBe('Not started')
		expect(getMetricValue(auctionStatusSection, 'Ends')).not.toBe('Not started')
	})

	test('locks the vault migration button after submit until the wallet is marked fully migrated', async () => {
		let migrateVaultCalls = 0
		const selectedOutcomeVaults = [
			{
				lockedRepInEscalationGame: 0n,
				repDepositShare: rep(10n),
				securityBondAllowance: 3n * ETH,
				unpaidEthFees: 0n,
				vaultAddress: zeroAddress,
			},
		]
		const selectedOutcomeChildPool = createPreviewPool({
			questionOutcome: 'yes',
			parent: zeroAddress,
			securityPoolAddress: '0x00000000000000000000000000000000000000cd',
			vaults: [
				{
					lockedRepInEscalationGame: 0n,
					repDepositShare: 0n,
					securityBondAllowance: 0n,
					unpaidEthFees: 0n,
					vaultAddress: zeroAddress,
				},
			],
			vaultCount: 1n,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkMigration',
					},
					onMigrateVault: () => {
						migrateVaultCalls += 1
					},
					previewPool: createPreviewPool({
						systemState: 'forkMigration',
						vaults: selectedOutcomeVaults,
					}),
					securityPools: [selectedOutcomeChildPool],
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expectTransactionButtonEnabled(document.body, 'Migrate Vault To Yes')
		})

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Migrate Vault To Yes' }))
		})
		expect(migrateVaultCalls).toBe(1)
		expectTransactionButtonDisabled(document.body, 'Migrate Vault To Yes', 'Migrating vault...')
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Migrate Vault To Yes' }))
		})
		expect(migrateVaultCalls).toBe(1)

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						forkAuctionDetails: {
							...createForkAuctionDetails(),
							systemState: 'forkMigration',
						},
						onMigrateVault: () => {
							migrateVaultCalls += 1
						},
						previewPool: createPreviewPool({
							systemState: 'forkMigration',
							vaults: selectedOutcomeVaults,
						}),
						securityPools: [selectedOutcomeChildPool],
						forkAuctionResult: {
							action: 'migrateVault',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000f1',
							securityPoolAddress: zeroAddress,
							universeId: 1n,
						},
						stageView: 'migration',
					}),
				),
				renderedComponent.container,
			)
		})
		await waitFor(() => {
			expectTransactionButtonDisabled(document.body, 'Migrate Vault To Yes', 'Vault migration is already complete for this wallet.')
		})
		expect(document.body.textContent?.includes('Already migrated')).toBe(true)
		const migrationStatusSection = within(document.body).getByRole('heading', { name: 'Migration Status' }).closest('section')
		if (!(migrationStatusSection instanceof HTMLElement)) throw new Error('Expected migration status section to render')
		expect(within(migrationStatusSection).getByText('Migrated')).not.toBeNull()
	})

	test('clears vault migration completion when the connected wallet or parent pool changes', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: zeroAddress }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						securityPoolAddress: zeroAddress,
						systemState: 'forkMigration',
					},
					forkAuctionResult: {
						action: 'migrateVault',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000f2',
						securityPoolAddress: zeroAddress,
						universeId: 1n,
					},
					previewPool: createPreviewPool({
						securityPoolAddress: zeroAddress,
						systemState: 'forkMigration',
						vaults: [
							{
								lockedRepInEscalationGame: 0n,
								repDepositShare: rep(2n),
								securityBondAllowance: 1n,
								unpaidEthFees: 0n,
								vaultAddress: zeroAddress,
							},
						],
					}),
					securityPools: [createPreviewPool({ parent: zeroAddress, questionOutcome: 'yes', securityPoolAddress: YES_CHILD_POOL_ADDRESS })],
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expectTransactionButtonDisabled(document.body, 'Migrate Vault To Yes', 'Vault migration is already complete for this wallet.')
		})

		const otherAccount = '0x0000000000000000000000000000000000000001'
		const otherPool = '0x00000000000000000000000000000000000000aa'
		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						accountState: createAccountState({ address: otherAccount }),
						forkAuctionDetails: {
							...createForkAuctionDetails(),
							securityPoolAddress: otherPool,
							systemState: 'forkMigration',
						},
						forkAuctionResult: undefined,
						previewPool: createPreviewPool({
							securityPoolAddress: otherPool,
							systemState: 'forkMigration',
							vaults: [
								{
									lockedRepInEscalationGame: 0n,
									repDepositShare: rep(2n),
									securityBondAllowance: 1n,
									unpaidEthFees: 0n,
									vaultAddress: otherAccount,
								},
							],
						}),
						securityPools: [createPreviewPool({ parent: otherPool, questionOutcome: 'yes', securityPoolAddress: '0x00000000000000000000000000000000000000ab' })],
						stageView: 'migration',
					}),
				),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expectTransactionButtonEnabled(document.body, 'Migrate Vault To Yes')
		})
		expect(document.body.textContent?.includes('Already migrated')).toBe(false)
	})

	test('disables submit bid after auction end to prevent reverted bids', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					currentTimestamp: 201n,
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						currentTime: 100n,
						systemState: 'forkTruthAuction',
						truthAuction: {
							...createTruthAuctionMetrics(),
							auctionEndsAt: 200n,
							timeRemaining: 100n,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 200n - AUCTION_TIME_SECONDS,
					},
					forkAuctionForm: {
						...createForkAuctionForm(),
						submitBidAmount: (3n * ETH).toString(),
						submitBidPrice: '1',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Submit Bid', 'Truth auction has ended.')
	})

	test('shows an auction-ended notice with the end timestamp once bidding has closed', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentTimestamp: 201n,
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: {
							...createTruthAuctionMetrics(),
							auctionEndsAt: 200n,
							finalized: false,
							timeRemaining: 0n,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 200n - AUCTION_TIME_SECONDS,
					},
					stageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const endedNotice = document.body.querySelector('.notice.success')
		expect(endedNotice?.textContent).toContain('Truth auction has ended.')
		expect(endedNotice?.textContent).toContain('Ended at:')
		expect(endedNotice?.textContent).toContain('Finalize the truth auction')
	})

	test('shows the ended notice for finalized auctions too', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentTimestamp: 201n,
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						claimingAvailable: true,
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							auctionEndsAt: 200n,
							finalized: true,
							timeRemaining: 0n,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 200n - AUCTION_TIME_SECONDS,
					},
					stageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const endedNotice = document.body.querySelector('.notice.success')
		expect(endedNotice?.textContent).toContain('Truth auction has ended.')
		expect(endedNotice?.textContent).toContain('finalized settlement paths are now in effect')
		expect(endedNotice?.textContent).toContain('Ended at:')
	})

	test('gates settlement actions against lifecycle conditions that would otherwise revert onchain', async () => {
		const baseDetails = {
			...createForkAuctionDetails(),
			systemState: 'forkTruthAuction',
			truthAuction: {
				...createTruthAuctionMetrics(),
				auctionEndsAt: 200n,
				clearingPrice: 2n * ETH,
				clearingTick: 10n,
				ethAtClearingTick: 5n * ETH,
				hitCap: true,
			},
			truthAuctionAddress: '0x0000000000000000000000000000000000000001',
			truthAuctionStartedAt: 1n,
		} satisfies ForkAuctionDetails
		const baseProps = createProps({
			accountState: createAccountState({ ethBalance: 10n * ETH }),
			currentTimestamp: 150n,
			forkAuctionDetails: baseDetails,
			forkAuctionForm: {
				...createForkAuctionForm(),
				claimBidIndex: '0',
				claimBidTick: '10',
				refundBidIndex: '1',
				refundTick: '9',
			},
			securityPools: [
				createPreviewPool({
					parent: zeroAddress,
					questionOutcome: 'yes',
					securityPoolAddress: YES_CHILD_POOL_ADDRESS,
				}),
			],
			stageView: 'settlement',
		})
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, baseProps))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Finalize Truth Auction' })).toBeNull()
		expectTransactionButtonEnabled(document.body, 'Refund Losing Bid')
		expect(documentQueries.queryByRole('button', { name: 'Settle Finalized Bid' })).toBeNull()

		await act(() => {
			render(
				h(ForkAuctionSection, {
					...baseProps,
					currentTimestamp: 201n,
				}),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(documentQueries.queryByRole('button', { name: 'Finalize Truth Auction' })).toBeNull()
		})
		expectTransactionButtonEnabled(document.body, 'Refund Losing Bid')

		await act(() => {
			const finalizedDetails = {
				...baseDetails,
				claimingAvailable: true,
				systemState: 'operational',
				truthAuction: {
					...baseDetails.truthAuction,
					finalized: true,
					timeRemaining: 0n,
				},
			} satisfies ForkAuctionDetails
			render(
				h(ForkAuctionSection, {
					...baseProps,
					auctionDetailsOverride: finalizedDetails,
					currentTimestamp: 201n,
					forkAuctionDetails: finalizedDetails,
				}),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expectTransactionButtonEnabled(document.body, 'Settle Finalized Bid')
		})
		expect(within(document.body).queryByRole('button', { name: 'Finalize Truth Auction' })).toBeNull()
		expect(within(document.body).queryByRole('button', { name: 'Refund Losing Bid' })).toBeNull()
	})

	test('disables finalized settlement until the settlement inputs are complete', async () => {
		const baseDetails = {
			...createForkAuctionDetails(),
			claimingAvailable: true,
			systemState: 'operational',
			truthAuction: {
				...createTruthAuctionMetrics(),
				finalized: true,
				timeRemaining: 0n,
			},
			truthAuctionAddress: '0x0000000000000000000000000000000000000001',
			truthAuctionStartedAt: 1n,
		} satisfies ForkAuctionDetails
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: baseDetails,
					forkAuctionForm: createForkAuctionForm(),
					securityPools: [
						createPreviewPool({
							parent: zeroAddress,
							questionOutcome: 'yes',
							securityPoolAddress: YES_CHILD_POOL_ADDRESS,
						}),
					],
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Settlement Overview' })).not.toBeNull()
		expect(documentQueries.getAllByText('Bidder Address').length).toBeGreaterThan(0)
		expectTransactionButtonDisabled(document.body, 'Settle Finalized Bid', 'Enter a valid settlement bid tick.')

		await act(() => {
			render(
				h(ForkAuctionSection, {
					...createProps({
						accountState: createAccountState({ ethBalance: 10n * ETH }),
						forkAuctionDetails: baseDetails,
						forkAuctionForm: {
							...createForkAuctionForm(),
							claimBidTick: '10',
						},
						securityPools: [
							createPreviewPool({
								parent: zeroAddress,
								questionOutcome: 'yes',
								securityPoolAddress: YES_CHILD_POOL_ADDRESS,
							}),
						],
					}),
				}),
				renderedComponent.container,
			)
		})
		expectTransactionButtonDisabled(document.body, 'Settle Finalized Bid', 'Enter a valid settlement bid index.')

		await act(() => {
			render(
				h(ForkAuctionSection, {
					...createProps({
						accountState: createAccountState({ ethBalance: 10n * ETH }),
						forkAuctionDetails: baseDetails,
						forkAuctionForm: {
							...createForkAuctionForm(),
							claimBidIndex: '0',
							claimBidTick: '10',
							settlementAddress: 'not-an-address',
						},
						securityPools: [
							createPreviewPool({
								parent: zeroAddress,
								questionOutcome: 'yes',
								securityPoolAddress: YES_CHILD_POOL_ADDRESS,
							}),
						],
					}),
				}),
				renderedComponent.container,
			)
		})
		expectTransactionButtonDisabled(document.body, 'Settle Finalized Bid', 'Enter a valid bidder address.')

		await act(() => {
			render(
				h(ForkAuctionSection, {
					...createProps({
						accountState: createAccountState({ ethBalance: 10n * ETH }),
						forkAuctionDetails: baseDetails,
						forkAuctionForm: {
							...createForkAuctionForm(),
							claimBidIndex: '0',
							claimBidTick: '10',
						},
						securityPools: [
							createPreviewPool({
								parent: zeroAddress,
								questionOutcome: 'yes',
								securityPoolAddress: YES_CHILD_POOL_ADDRESS,
							}),
						],
					}),
				}),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expectTransactionButtonEnabled(document.body, 'Settle Finalized Bid')
		})
	})

	test('renders the controlled fork stage view across refreshed pool states', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkMigration',
					},
					stageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Migration Status')).not.toBeNull()

		await act(() => {
			render(
				h(ForkAuctionSection, {
					...createProps({
						accountState: createAccountState({ ethBalance: 10n * ETH }),
						forkAuctionDetails: {
							...createForkAuctionDetails(),
							systemState: 'forkTruthAuction',
							truthAuction: createTruthAuctionMetrics(),
							truthAuctionAddress: '0x0000000000000000000000000000000000000001',
							truthAuctionStartedAt: 1n,
						},
						stageView: 'auction',
					}),
				}),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(documentQueries.getByRole('heading', { name: 'Submit Bid' })).not.toBeNull()
		})

		await act(() => {
			render(
				h(ForkAuctionSection, {
					...createProps({
						accountState: createAccountState({ ethBalance: 10n * ETH }),
						forkAuctionDetails: {
							...createForkAuctionDetails(),
							claimingAvailable: true,
							systemState: 'operational',
							truthAuction: {
								...createTruthAuctionMetrics(),
								finalized: true,
								timeRemaining: 0n,
							},
							truthAuctionAddress: '0x0000000000000000000000000000000000000001',
							truthAuctionStartedAt: 1n,
						},
						stageView: 'settlement',
					}),
				}),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(documentQueries.getByRole('heading', { name: 'Settle Finalized Bid' })).not.toBeNull()
		})
	})

	test('renders the market view, visible depth chart, and wallet summary from contract-backed auction pages', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 2n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 2n, active: true }), createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 5n * ETH, submissionCount: 3n, active: true })]
			if (request.functionName === 'getTickSummary') {
				if ((request.args?.[0] ?? 0n) === 12n) return createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 2n, active: true })
				return createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 5n * ETH, submissionCount: 3n, active: true })
			}
			if (request.functionName === 'getBidCountAtTick') return 2n
			if (request.functionName === 'getBidPageAtTick' && (request.args?.[0] ?? 0n) === 12n) return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			if (request.functionName === 'getBidPageAtTick')
				return [createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH }), createTruthAuctionBidView({ tick: 10n, bidIndex: 1n, bidder: '0x0000000000000000000000000000000000000001', ethAmount: 3n * ETH, cumulativeEth: 5n * ETH, activeCumulativeEthBeforeBid: 2n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: 2n * ETH,
							clearingTick: 10n,
							ethAtClearingTick: 5n * ETH,
							ethRaised: 9n * ETH,
							hitCap: true,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByRole('group', { name: 'Truth auction visible depth chart' })).not.toBeNull()
			expect(documentQueries.getByRole('heading', { name: 'My Bids' })).not.toBeNull()
		})
		expect(documentQueries.getByRole('heading', { name: 'Market View' })).not.toBeNull()
		expect(document.body.textContent?.includes('Showing 2 of 2 active price levels')).toBe(true)
		expect(document.body.textContent?.includes('Loaded depth')).toBe(true)
		expect(document.body.textContent?.includes('Winning')).toBe(true)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Select tick 12 from depth chart' }))
		await waitFor(() => {
			expect(document.body.textContent?.includes('Tick 12 at')).toBe(true)
		})
		expect(documentQueries.getByText('Selected Price Level')).not.toBeNull()
		expect(document.body.textContent?.includes('2 submissions')).toBe(true)
	})

	test('clears stale selected price-level details while a historical wallet tick is loading', async () => {
		const historicalTickSummaryLoad = createDeferred<TruthAuctionTickSummary>()
		const historicalTickBidLoad = createDeferred<TruthAuctionBidView[]>()
		const activeTickSummary = createTruthAuctionTickSummary({
			tick: 12n,
			price: 3n * ETH,
			currentTotalEth: 4n * ETH,
			submissionCount: 1n,
			active: true,
		})
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [activeTickSummary]
			if (request.functionName === 'getTickSummary') {
				if ((request.args?.[0] ?? 0n) === 9n) return await historicalTickSummaryLoad.promise
				return activeTickSummary
			}
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') {
				if ((request.args?.[0] ?? 0n) === 9n) return await historicalTickBidLoad.promise
				return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			}
			if (request.functionName === 'getBidderBidCount') return 2n
			if (request.functionName === 'getBidderBidPage') {
				return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH }), createTruthAuctionBidView({ tick: 9n, bidIndex: 1n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH })]
			}
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: {
							...createTruthAuctionMetrics(),
							ethRaised: 4n * ETH,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(document.body.textContent?.includes('Tick 12 at')).toBe(true)
		})

		fireEvent.click(
			documentQueries.getAllByRole('button', { name: 'Show Price Level' })[1] ??
				(() => {
					throw new Error('Expected a historical Show Price Level button')
				})(),
		)

		await waitFor(() => {
			expect(document.body.textContent?.includes('Tick 12 at')).toBe(false)
			expect(document.body.textContent?.includes('Loading selected price level…')).toBe(true)
		})

		historicalTickSummaryLoad.resolve(
			createTruthAuctionTickSummary({
				tick: 9n,
				price: 2n * ETH,
				currentTotalEth: 0n,
				submissionCount: 1n,
				active: false,
			}),
		)
		historicalTickBidLoad.resolve([createTruthAuctionBidView({ tick: 9n, bidIndex: 1n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH })])

		await waitFor(() => {
			expect(document.body.textContent?.includes('Tick 9 at')).toBe(true)
		})
	})

	test('reloads the paged bidbook after a successful fork-auction action result changes', async () => {
		let activeTickPageCalls = 0
		let bidderBidPageCalls = 0
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') {
				activeTickPageCalls += 1
				return [createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })]
			}
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') {
				bidderBidPageCalls += 1
				return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			}
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const baseProps = createProps({
			accountState: createAccountState({ ethBalance: 10n * ETH }),
			forkAuctionDetails: {
				...createForkAuctionDetails(),
				systemState: 'forkTruthAuction',
				truthAuction: {
					...createTruthAuctionMetrics(),
					clearingPrice: 2n * ETH,
					clearingTick: 10n,
					ethAtClearingTick: 5n * ETH,
					hitCap: true,
				},
				truthAuctionAddress: '0x0000000000000000000000000000000000000001',
				truthAuctionStartedAt: 1n,
			},
			truthAuctionReadClient,
		})
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, baseProps))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(activeTickPageCalls).toBeGreaterThan(0)
			expect(bidderBidPageCalls).toBeGreaterThan(0)
		})
		const initialActiveTickPageCalls = activeTickPageCalls
		const initialBidderBidPageCalls = bidderBidPageCalls

		await act(() => {
			render(
				h(ForkAuctionSection, {
					...baseProps,
					forkAuctionResult: {
						action: 'submitBid',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000d4',
						securityPoolAddress: zeroAddress,
						universeId: 1n,
					},
				}),
				renderedComponent.container,
			)
		})
		await waitFor(() => {
			expect(activeTickPageCalls).toBeGreaterThan(initialActiveTickPageCalls)
			expect(bidderBidPageCalls).toBeGreaterThan(initialBidderBidPageCalls)
		})

		expect(activeTickPageCalls).toBeGreaterThan(initialActiveTickPageCalls)
		expect(bidderBidPageCalls).toBeGreaterThan(initialBidderBidPageCalls)
	})

	test('uses active cumulative ETH before the bid when classifying clearing-tick bids', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 3n * ETH, submissionCount: 2n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 3n * ETH, submissionCount: 2n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') return [createTruthAuctionBidView({ tick: 10n, bidIndex: 1n, ethAmount: 3n * ETH, cumulativeEth: 5n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 10n, bidIndex: 1n, ethAmount: 3n * ETH, cumulativeEth: 5n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: 2n * ETH,
							clearingTick: 10n,
							ethAtClearingTick: 3n * ETH,
							finalized: true,
							hitCap: true,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
					stageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getAllByText('Winning').length).toBeGreaterThan(0)
		})
		expect(Array.from(document.body.querySelectorAll('.truth-auction-status-pill')).some(element => element.textContent === 'Partial')).toBe(false)
		expect(documentQueries.getAllByText('Winning').length).toBeGreaterThan(0)
	})

	test('prefills finalized settlement inputs from wallet bid shortcuts in settlement mode', async () => {
		const formUpdates: Partial<ForkAuctionFormState>[] = []
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: 2n * ETH,
							clearingTick: 10n,
							ethAtClearingTick: 5n * ETH,
							finalized: true,
							hitCap: true,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					onForkAuctionFormChange: update => {
						formUpdates.push(update)
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getAllByRole('button', { name: 'Prefill Settle' }).length).toBeGreaterThan(0)
		})
		fireEvent.click(
			documentQueries.getAllByRole('button', { name: 'Prefill Settle' })[0] ??
				(() => {
					throw new Error('Expected at least one Prefill Settle button')
				})(),
		)

		expect(formUpdates).toContainEqual({
			claimBidIndex: '0',
			claimBidTick: '12',
			settlementAddress: zeroAddress,
		})
	})

	test('renders finalized losing bids as refundable settlement rows and settled losing bids as refunded', async () => {
		const formUpdates: Partial<ForkAuctionFormState>[] = []
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 5n * ETH, submissionCount: 2n, active: true })]
			if (request.functionName === 'getTickSummary') {
				if ((request.args?.[0] ?? 0n) === 9n) return createTruthAuctionTickSummary({ tick: 9n, price: 1n * ETH, currentTotalEth: 0n, submissionCount: 1n, active: false })
				if ((request.args?.[0] ?? 0n) === 8n) return createTruthAuctionTickSummary({ tick: 8n, price: 1n * ETH, currentTotalEth: 0n, submissionCount: 1n, active: false })
				return createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 5n * ETH, submissionCount: 2n, active: true })
			}
			if (request.functionName === 'getBidCountAtTick') {
				if ((request.args?.[0] ?? 0n) === 9n || (request.args?.[0] ?? 0n) === 8n) return 1n
				return 2n
			}
			if (request.functionName === 'getBidPageAtTick') {
				if ((request.args?.[0] ?? 0n) === 9n) return [createTruthAuctionBidView({ tick: 9n, bidIndex: 1n, ethAmount: 1n * ETH, cumulativeEth: 1n * ETH })]
				if ((request.args?.[0] ?? 0n) === 8n) return [createTruthAuctionBidView({ tick: 8n, bidIndex: 2n, ethAmount: 1n * ETH, cumulativeEth: 1n * ETH, claimed: true })]
				return [createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 5n * ETH, cumulativeEth: 5n * ETH })]
			}
			if (request.functionName === 'getBidderBidCount') return 3n
			if (request.functionName === 'getBidderBidPage') {
				return [
					createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 5n * ETH, cumulativeEth: 5n * ETH }),
					createTruthAuctionBidView({ tick: 9n, bidIndex: 1n, ethAmount: 1n * ETH, cumulativeEth: 1n * ETH }),
					createTruthAuctionBidView({ tick: 8n, bidIndex: 2n, ethAmount: 1n * ETH, cumulativeEth: 1n * ETH, claimed: true }),
				]
			}
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						claimingAvailable: true,
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: 2n * ETH,
							clearingTick: 10n,
							ethAtClearingTick: 5n * ETH,
							finalized: true,
							hitCap: true,
							timeRemaining: 0n,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					onForkAuctionFormChange: update => {
						formUpdates.push(update)
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getAllByRole('button', { name: 'Prefill Settle' }).length).toBeGreaterThan(0)
		})

		expect(document.body.textContent?.includes('Owner Withdrawal')).toBe(false)
		expect(documentQueries.getAllByText('Refundable').length).toBeGreaterThan(0)
		expect(documentQueries.getAllByText('Refunded').length).toBeGreaterThan(0)

		const settleButtons = documentQueries.getAllByRole('button', { name: 'Prefill Settle' })
		const refundableRowButton = settleButtons.find(button => button.closest('.truth-auction-bid-row')?.textContent?.includes('Refundable') === true)
		if (refundableRowButton === undefined) throw new Error('Expected a refundable Prefill Settle button')

		fireEvent.click(refundableRowButton)

		expect(formUpdates).toContainEqual({
			claimBidIndex: '1',
			claimBidTick: '9',
			settlementAddress: zeroAddress,
		})
	})

	test('hides selected price-level settlement shortcuts for bids owned by other wallets', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 5n * ETH, submissionCount: 2n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 5n * ETH, submissionCount: 2n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 2n
			if (request.functionName === 'getBidPageAtTick') {
				return [createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH }), createTruthAuctionBidView({ tick: 10n, bidIndex: 1n, bidder: '0x0000000000000000000000000000000000000001', ethAmount: 3n * ETH, cumulativeEth: 5n * ETH, activeCumulativeEthBeforeBid: 2n * ETH })]
			}
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						claimingAvailable: true,
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: 2n * ETH,
							clearingTick: 10n,
							ethAtClearingTick: 5n * ETH,
							finalized: true,
							hitCap: true,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Select tick 10 from depth chart' })).not.toBeNull()
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Select tick 10 from depth chart' }))
		})

		await waitFor(() => {
			expect(document.body.textContent?.includes('Tick 10 at')).toBe(true)
		})

		await waitFor(() => {
			expect(document.body.textContent?.includes('Bid #1')).toBe(true)
		})

		const selectedLevel = document.body.querySelector('.truth-auction-level-detail')
		if (!(selectedLevel instanceof HTMLElement)) throw new Error('Expected selected price-level detail to render')

		const bidRows = Array.from(selectedLevel.querySelectorAll('.truth-auction-bid-row')).slice(1)
		const viewerRow = bidRows.find(row => row.textContent?.includes('Bid #0') === true)
		const otherWalletRow = bidRows.find(row => row.textContent?.includes('Bid #1') === true)
		if (!(viewerRow instanceof HTMLElement)) throw new Error('Expected selected price-level viewer row to render')
		if (!(otherWalletRow instanceof HTMLElement)) throw new Error('Expected selected price-level non-viewer row to render')

		expect(within(viewerRow).getAllByRole('button', { name: 'Prefill Settle' }).length).toBe(1)
		expect(within(otherWalletRow).queryByRole('button', { name: 'Prefill Settle' })).toBeNull()
	})

	test('summarizes wallet bids from semantic bid outcomes instead of presentation labels', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 8n * ETH, submissionCount: 3n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 8n * ETH, submissionCount: 3n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 3n
			if (request.functionName === 'getBidPageAtTick') {
				return [
					createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH }),
					createTruthAuctionBidView({ tick: 10n, bidIndex: 1n, ethAmount: 4n * ETH, cumulativeEth: 6n * ETH, activeCumulativeEthBeforeBid: 4n * ETH }),
					createTruthAuctionBidView({ tick: 9n, bidIndex: 2n, ethAmount: 1n * ETH, cumulativeEth: 1n * ETH }),
				]
			}
			if (request.functionName === 'getBidderBidCount') return 5n
			if (request.functionName === 'getBidderBidPage') {
				return [
					createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH }),
					createTruthAuctionBidView({ tick: 10n, bidIndex: 1n, ethAmount: 4n * ETH, cumulativeEth: 6n * ETH, activeCumulativeEthBeforeBid: 4n * ETH }),
					createTruthAuctionBidView({ tick: 9n, bidIndex: 2n, ethAmount: 1n * ETH, cumulativeEth: 1n * ETH }),
					createTruthAuctionBidView({ tick: 8n, bidIndex: 3n, ethAmount: 1n * ETH, cumulativeEth: 1n * ETH, refunded: true }),
					createTruthAuctionBidView({ tick: 13n, bidIndex: 4n, ethAmount: 1n * ETH, cumulativeEth: 1n * ETH, claimed: true }),
				]
			}
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: 2n * ETH,
							clearingTick: 10n,
							ethAtClearingTick: 5n * ETH,
							finalized: true,
							hitCap: true,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(document.body.querySelector('.truth-auction-wallet-summary')).not.toBeNull()
		})

		await waitFor(() => {
			expect(document.body.querySelector('.truth-auction-wallet-summary')).not.toBeNull()
		})
		const walletSummary = document.body.querySelector('.truth-auction-wallet-summary')
		if (!(walletSummary instanceof HTMLElement)) throw new Error('Expected wallet summary to render')

		await waitFor(() => {
			expect(getMetricValue(walletSummary, 'Winning')).toBe('1')
			expect(getMetricValue(walletSummary, 'Partial')).toBe('1')
			expect(getMetricValue(walletSummary, 'Refundable')).toBe('1')
			expect(getMetricValue(walletSummary, 'REP Claimable')).toBe('2')
			expect(getMetricValue(walletSummary, 'Refunded')).toBe('1')
		})
	})

	test('counts live below-clearing bids separately before finalization in the wallet summary', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 5n * ETH, submissionCount: 2n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 5n * ETH, submissionCount: 2n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 0n
			if (request.functionName === 'getBidPageAtTick') return []
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 9n, bidIndex: 0n, ethAmount: 1n * ETH, cumulativeEth: 1n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: 2n * ETH,
							clearingTick: 10n,
							ethAtClearingTick: 5n * ETH,
							finalized: false,
							hitCap: true,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const walletSummary = document.body.querySelector('.truth-auction-wallet-summary')
		if (!(walletSummary instanceof HTMLElement)) throw new Error('Expected wallet summary to render')

		await waitFor(() => {
			expect(getMetricValue(walletSummary, 'Below Clearing')).toBe('1')
			expect(getMetricValue(walletSummary, 'REP Claimable')).toBe('0')
		})
	})

	test('keeps the auction stage ordered as market view, submit bid, finalize, then my bids and shows the form-linked preview state', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: {
							...createTruthAuctionMetrics(),
							ethRaised: 4n * ETH,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					forkAuctionForm: {
						...createForkAuctionForm(),
						submitBidAmount: (4n * ETH).toString(),
						submitBidPrice: formatCurrencyInputBalance(getTruthAuctionPriceAtTick(12n)),
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByRole('heading', { name: 'Market View' })).not.toBeNull()
			expect(documentQueries.getByRole('heading', { name: 'Submit Bid' })).not.toBeNull()
		})
		await waitFor(() => {
			expect(document.body.querySelector('.truth-auction-depth-marker.is-preview')).not.toBeNull()
		})

		const marketViewHeading = documentQueries.getByRole('heading', { name: 'Market View' })
		const submitBidHeading = documentQueries.getByRole('heading', { name: 'Submit Bid' })
		const finalizeHeading = documentQueries.getByRole('heading', { name: 'Finalize Truth Auction' })
		const myBidsHeading = documentQueries.getByRole('heading', { name: 'My Bids' })

		expectElementBefore(marketViewHeading, submitBidHeading)
		expectElementBefore(submitBidHeading, finalizeHeading)
		expectElementBefore(finalizeHeading, myBidsHeading)
		expect(documentQueries.getByText(/Selected ladder price:/)).not.toBeNull()
		expect(document.body.textContent?.includes('Current form tick')).toBe(true)
		expect(documentQueries.getByRole('button', { name: 'Use This Price' })).not.toBeNull()
		expect(documentQueries.getByText('Bid Price (ETH / REP)')).not.toBeNull()
		expect(documentQueries.queryByText('Bid Tick')).toBeNull()
		expect(document.body.querySelector('.truth-auction-depth-marker.is-preview')).not.toBeNull()
		expect(document.body.querySelector('.truth-auction-market-section')).not.toBeNull()
		expect(document.body.querySelector('.truth-auction-market-board .truth-auction-panel')).toBeNull()
	})

	test('keeps pre-finalization settlement focused on wallet actions before the market view and leaves operator tools collapsed by default', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							finalized: false,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
					stageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByRole('heading', { name: 'Refund Losing Bid' })).not.toBeNull()
		})

		const myBidsHeading = documentQueries.getByRole('heading', { name: 'My Bids' })
		const refundHeading = documentQueries.getByRole('heading', { name: 'Refund Losing Bid' })
		const marketViewHeading = documentQueries.getByRole('heading', { name: 'Market View' })

		expectElementBefore(myBidsHeading, refundHeading)
		expectElementBefore(refundHeading, marketViewHeading)
		expect(documentQueries.queryByRole('heading', { name: 'Settle Finalized Bid' })).toBeNull()
		expect(documentQueries.getByText('Operator Tools')).not.toBeNull()
		expect(documentQueries.getByText('Operator Tools').closest('details')?.open).toBe(false)
	})

	test('keeps finalized settlement focused on wallet actions before the market view', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						claimingAvailable: true,
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							finalized: true,
							timeRemaining: 0n,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
					stageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByRole('heading', { name: 'Settle Finalized Bid' })).not.toBeNull()
		})

		const myBidsHeading = documentQueries.getByRole('heading', { name: 'My Bids' })
		const settleHeading = documentQueries.getByRole('heading', { name: 'Settle Finalized Bid' })
		const marketViewHeading = documentQueries.getByRole('heading', { name: 'Market View' })

		expectElementBefore(myBidsHeading, settleHeading)
		expectElementBefore(settleHeading, marketViewHeading)
		expect(documentQueries.queryByRole('heading', { name: 'Refund Losing Bid' })).toBeNull()
	})

	test('expands visible depth coverage after loading more price levels', async () => {
		const firstPageTicks = Array.from({ length: 25 }, (_, index) =>
			createTruthAuctionTickSummary({
				tick: BigInt(50 - index),
				price: BigInt(50 - index) * ETH,
				currentTotalEth: 1n * ETH,
				submissionCount: 1n,
				active: true,
			}),
		)
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 26n
			if (request.functionName === 'getActiveTickPage') {
				if ((request.args?.[0] ?? 0n) === 25n) return [createTruthAuctionTickSummary({ tick: 25n, price: 25n * ETH, currentTotalEth: 1n * ETH, submissionCount: 1n, active: true })]
				return firstPageTicks
			}
			if (request.functionName === 'getTickSummary') return firstPageTicks[0] ?? createTruthAuctionTickSummary()
			if (request.functionName === 'getBidCountAtTick') return 0n
			if (request.functionName === 'getBidPageAtTick') return []
			if (request.functionName === 'getBidderBidCount') return 0n
			if (request.functionName === 'getBidderBidPage') return []
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: createTruthAuctionMetrics(),
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(document.body.textContent?.includes('Showing 25 of 26 active price levels')).toBe(true)
		})
		fireEvent.click(documentQueries.getByRole('button', { name: 'Load More Price Levels' }))
		await waitFor(() => {
			expect(document.body.textContent?.includes('Showing 26 of 26 active price levels')).toBe(true)
		})
	})

	test('shows aggregated auction bids without requiring a selected tick and keeps the section ordered after market view', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 2n
			if (request.functionName === 'getActiveTickPage') {
				return [createTruthAuctionTickSummary({ tick: 12n, price: getTruthAuctionPriceAtTick(12n), currentTotalEth: 5n * ETH, submissionCount: 2n, active: true }), createTruthAuctionTickSummary({ tick: 10n, price: getTruthAuctionPriceAtTick(10n), currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })]
			}
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 12n, price: getTruthAuctionPriceAtTick(12n), currentTotalEth: 5n * ETH, submissionCount: 2n, active: true })
			if (request.functionName === 'getBidCountAtTick') return (request.args?.[0] ?? 0n) === 12n ? 2n : 1n
			if (request.functionName === 'getBidPageAtTick') {
				if ((request.args?.[0] ?? 0n) === 12n) {
					return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH }), createTruthAuctionBidView({ tick: 12n, bidIndex: 1n, bidder: '0x0000000000000000000000000000000000000001', ethAmount: 3n * ETH, cumulativeEth: 5n * ETH, activeCumulativeEthBeforeBid: 2n * ETH })]
				}
				return [createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			}
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: createTruthAuctionMetrics(),
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByRole('heading', { name: 'Auction Bids' })).not.toBeNull()
			expect(document.body.textContent?.includes('Showing 3 of 3 bids across loaded levels')).toBe(true)
		})

		const marketViewHeading = documentQueries.getByRole('heading', { name: 'Market View' })
		const auctionBidsHeading = documentQueries.getByRole('heading', { name: 'Auction Bids' })
		const submitBidHeading = documentQueries.getByRole('heading', { name: 'Submit Bid' })

		expectElementBefore(marketViewHeading, auctionBidsHeading)
		expectElementBefore(auctionBidsHeading, submitBidHeading)
		expect(document.body.textContent?.includes('Bid #1')).toBe(true)
		expect(document.body.textContent?.includes('Tick 10')).toBe(true)
	})

	test('sorts aggregated auction bids by tick descending then bid index ascending and can prefill actions from that table', async () => {
		const formUpdates: Partial<ForkAuctionFormState>[] = []
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 2n
			if (request.functionName === 'getActiveTickPage') {
				return [createTruthAuctionTickSummary({ tick: 12n, price: getTruthAuctionPriceAtTick(12n), currentTotalEth: 5n * ETH, submissionCount: 2n, active: true }), createTruthAuctionTickSummary({ tick: 10n, price: getTruthAuctionPriceAtTick(10n), currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })]
			}
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 12n, price: getTruthAuctionPriceAtTick(12n), currentTotalEth: 5n * ETH, submissionCount: 2n, active: true })
			if (request.functionName === 'getBidCountAtTick') return (request.args?.[0] ?? 0n) === 12n ? 2n : 1n
			if (request.functionName === 'getBidPageAtTick') {
				if ((request.args?.[0] ?? 0n) === 12n) {
					return [createTruthAuctionBidView({ tick: 12n, bidIndex: 1n, bidder: '0x0000000000000000000000000000000000000001', ethAmount: 3n * ETH, cumulativeEth: 5n * ETH, activeCumulativeEthBeforeBid: 2n * ETH }), createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH })]
				}
				return [createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH, claimed: true })]
			}
			if (request.functionName === 'getBidderBidCount') return 2n
			if (request.functionName === 'getBidderBidPage') {
				return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH }), createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH, claimed: true })]
			}
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						claimingAvailable: true,
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: getTruthAuctionPriceAtTick(10n),
							clearingTick: 10n,
							ethAtClearingTick: 4n * ETH,
							finalized: true,
							hitCap: true,
							timeRemaining: 0n,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					onForkAuctionFormChange: update => {
						formUpdates.push(update)
					},
					stageView: 'settlement',
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByRole('heading', { name: 'Auction Bids' })).not.toBeNull()
			expect(documentQueries.getAllByRole('button', { name: 'Prefill Settle' }).length).toBeGreaterThan(0)
		})

		const aggregateTable = documentQueries.getByRole('heading', { name: 'Auction Bids' }).closest('.section-block')
		if (!(aggregateTable instanceof HTMLElement)) throw new Error('Expected aggregated auction bids section to render')
		await waitFor(() => {
			expect(aggregateTable.textContent?.includes('Bid #0')).toBe(true)
		})
		const aggregateRows = Array.from(aggregateTable.querySelectorAll('.truth-auction-bid-row.is-wide')).filter(row => !row.classList.contains('is-header'))
		expect(aggregateRows.length).toBeGreaterThanOrEqual(3)
		expect(aggregateRows[0]?.textContent).toContain('Tick 12')
		expect(aggregateRows[0]?.textContent).toContain('Bid #0')
		expect(aggregateRows[1]?.textContent).toContain('Tick 12')
		expect(aggregateRows[1]?.textContent).toContain('Bid #1')
		expect(aggregateRows[2]?.textContent).toContain('Tick 10')

		fireEvent.click(within(aggregateTable).getAllByRole('button', { name: 'Prefill Settle' })[0] as HTMLElement)
		expect(formUpdates).toContainEqual({
			claimBidIndex: '0',
			claimBidTick: '12',
			settlementAddress: zeroAddress,
		})
		expect(aggregateRows[1]?.textContent?.includes('Prefill Settle')).toBe(false)
	})

	test('expands aggregated auction bid coverage after loading more price levels and more bid pages', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 2n
			if (request.functionName === 'getActiveTickPage') {
				const offset = request.args?.[0] ?? 0n
				if (offset === 25n) {
					return [createTruthAuctionTickSummary({ tick: 9n, price: getTruthAuctionPriceAtTick(9n), currentTotalEth: 5n * ETH, submissionCount: 1n, active: true })]
				}
				return [createTruthAuctionTickSummary({ tick: 12n, price: getTruthAuctionPriceAtTick(12n), currentTotalEth: 5n * ETH, submissionCount: 2n, active: true })]
			}
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 12n, price: getTruthAuctionPriceAtTick(12n), currentTotalEth: 5n * ETH, submissionCount: 2n, active: true })
			if (request.functionName === 'getBidCountAtTick') return (request.args?.[0] ?? 0n) === 12n ? 2n : 1n
			if (request.functionName === 'getBidPageAtTick') {
				const tick = request.args?.[0] ?? 0n
				const offset = request.args?.[1] ?? 0n
				if (tick === 12n && offset === 0n) return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH })]
				if (tick === 12n && offset === 25n) return [createTruthAuctionBidView({ tick: 12n, bidIndex: 1n, ethAmount: 3n * ETH, cumulativeEth: 5n * ETH, activeCumulativeEthBeforeBid: 2n * ETH })]
				return [createTruthAuctionBidView({ tick: 9n, bidIndex: 0n, ethAmount: 5n * ETH, cumulativeEth: 5n * ETH })]
			}
			if (request.functionName === 'getBidderBidCount') return 0n
			if (request.functionName === 'getBidderBidPage') return []
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const firstPageTicks = Array.from({ length: 25 }, (_, index) =>
			createTruthAuctionTickSummary({
				tick: BigInt(100 - index),
				price: getTruthAuctionPriceAtTick(BigInt(100 - index)),
				currentTotalEth: 1n * ETH,
				submissionCount: index === 0 ? 2n : 0n,
				active: true,
			}),
		)
		const expandedTruthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 26n
			if (request.functionName === 'getActiveTickPage') {
				const offset = request.args?.[0] ?? 0n
				if (offset === 25n) return [createTruthAuctionTickSummary({ tick: 75n, price: getTruthAuctionPriceAtTick(75n), currentTotalEth: 1n * ETH, submissionCount: 1n, active: true })]
				return firstPageTicks
			}
			if (request.functionName === 'getTickSummary') return firstPageTicks[0] ?? createTruthAuctionTickSummary()
			if (request.functionName === 'getBidCountAtTick') {
				const tick = request.args?.[0] ?? 0n
				if (tick === 100n) return 2n
				if (tick === 75n) return 1n
				return 0n
			}
			if (request.functionName === 'getBidPageAtTick') {
				const tick = request.args?.[0] ?? 0n
				const offset = request.args?.[1] ?? 0n
				if (tick === 100n && offset === 0n) return [createTruthAuctionBidView({ tick: 100n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH })]
				if (tick === 100n && offset === 25n) return [createTruthAuctionBidView({ tick: 100n, bidIndex: 1n, ethAmount: 3n * ETH, cumulativeEth: 5n * ETH, activeCumulativeEthBeforeBid: 2n * ETH })]
				if (tick === 75n) return [createTruthAuctionBidView({ tick: 75n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
				return []
			}
			if (request.functionName === 'getBidderBidCount') return 0n
			if (request.functionName === 'getBidderBidPage') return []
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})

		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: createTruthAuctionMetrics(),
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(document.body.textContent?.includes('Showing 1 of 2 bids across loaded levels')).toBe(true)
		})
		fireEvent.click(documentQueries.getByRole('button', { name: 'Load More Auction Bids' }))
		await waitFor(() => {
			expect(document.body.textContent?.includes('Showing 2 of 2 bids across loaded levels')).toBe(true)
		})

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						accountState: createAccountState({ ethBalance: 10n * ETH }),
						forkAuctionDetails: {
							...createForkAuctionDetails(),
							systemState: 'forkTruthAuction',
							truthAuction: createTruthAuctionMetrics(),
							truthAuctionAddress: '0x0000000000000000000000000000000000000001',
							truthAuctionStartedAt: 1n,
						},
						truthAuctionReadClient: expandedTruthAuctionReadClient,
					}),
				),
				renderedComponent.container,
			)
		})

		fireEvent.click(documentQueries.getByRole('button', { name: 'Load More Price Levels' }))
		await waitFor(() => {
			expect(document.body.textContent?.includes('Showing 3 of 3 bids across loaded levels')).toBe(true)
		})
	})
})
