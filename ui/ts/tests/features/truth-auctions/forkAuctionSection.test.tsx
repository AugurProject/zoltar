/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from '../../testUtils/queries'
import { h } from 'preact'
import { type Address, getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { ForkAuctionSection } from '../../../features/truth-auctions/components/ForkAuctionSection.js'
import type { ForkAuctionSectionProps } from '../../../features/types.js'
import type { AccountState, ForkAuctionFormState, ReportingFormState } from '../../../types/app.js'
import type { EscalationDeposit, ForkAuctionDetails, ListedSecurityPool, MarketDetails, ReadClient, ReportingDetails } from '../../../types/contracts.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

const PARENT_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f0'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
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
		securityPoolAddress: PARENT_POOL_ADDRESS,
		selectedOutcome: 'yes',
		settlementAddress: '',
		submitBidAmount: '',
		submitBidPrice: '',
		vaultAddress: '',
		...overrides,
	}
}

function createReportingForm(overrides: Partial<ReportingFormState> = {}): ReportingFormState {
	return {
		reportAmount: '',
		securityPoolAddress: PARENT_POOL_ADDRESS,
		selectedOutcome: 'yes',
		selectedWithdrawDepositIndexesByOutcome: {
			invalid: [],
			yes: [],
			no: [],
		},
		...overrides,
	}
}

function createReportingDeposit(overrides: Partial<EscalationDeposit> = {}): EscalationDeposit {
	return {
		amount: 10n,
		cumulativeAmount: 10n,
		depositIndex: 0n,
		depositor: zeroAddress,
		...overrides,
	}
}

function createActiveReportingDetails(overrides: Partial<ReportingDetails> = {}): ReportingDetails {
	return {
		bindingCapital: 5n,
		completeSetCollateralAmount: 0n,
		currentRequiredBond: 1n,
		currentTime: 3n,
		escalationEndTime: 50n,
		escalationGameAddress: getAddress('0x00000000000000000000000000000000000000fa'),
		forkThreshold: 100n,
		hasReachedNonDecision: false,
		marketDetails: createMarketDetails(),
		nonDecisionThreshold: 100n,
		questionOutcome: 'none',
		securityPoolAddress: PARENT_POOL_ADDRESS,
		settlementState: 'locked',
		sides: [
			{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
		startBond: 1n,
		status: 'active',
		systemState: 'operational',
		universeId: 1n,
		parentWithdrawalEnabled: false,
		viewerVaultAvailableEscalationRep: 0n,
		viewerVaultExists: false,
		viewerVaultEscrowedRep: 0n,
		viewerVaultRepDepositShare: 0n,
		activationTime: 1n,
		totalCost: 1n,
		...overrides,
	}
}

function createForkAuctionDetails(overrides: Partial<ForkAuctionDetails> = {}): ForkAuctionDetails {
	return {
		auctionedSecurityBondAllowance: 0n,
		claimingAvailable: false,
		completeSetCollateralAmount: 0n,
		currentTime: 3n,
		hasForkActivity: true,
		forkOutcome: 'yes',
		forkOwnSecurityPool: false,
		marketDetails: createMarketDetails(),
		migratedRep: 1n,
		migrationEndsAt: 100n,
		parentSecurityPoolAddress: zeroAddress,
		questionOutcome: 'yes',
		auctionableRepAtFork: 0n,
		securityPoolAddress: PARENT_POOL_ADDRESS,
		systemState: 'forkTruthAuction',
		truthAuction: undefined,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 1n,
		universeId: 1n,
		...overrides,
	}
}

function createChildPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return {
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 10n,
		hasForkActivity: true,
		forkOutcome: 'yes',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 1n,
		parent: PARENT_POOL_ADDRESS,
		questionOutcome: 'yes',
		questionId: '0x01',
		securityMultiplier: 2n,
		securityPoolAddress: '0x00000000000000000000000000000000000000f1',
		shareTokenSupply: 0n,
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 0n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 1n,
		universeHasForked: true,
		universeId: 11n,
		vaultCount: 0n,
		vaults: [],
		...overrides,
	}
}

function createForkMigrationReadClient(): Pick<ReadClient, 'readContract'> {
	return {
		readContract: mock(async request => {
			switch (request.functionName) {
				case 'getChildUniverseId':
					return 11n
				case 'getMigrationProxyAddress':
					return zeroAddress
				case 'getRepToken':
					return zeroAddress
				case 'balanceOf':
					return 0n
				default:
					throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}
		}) as ReadClient['readContract'],
	}
}

function createProps(overrides: Partial<ForkAuctionSectionProps> = {}): ForkAuctionSectionProps {
	return {
		accountState: createAccountState(),
		currentStageView: 'auction',
		embedInCard: true,
		forkAuctionActiveAction: undefined,
		forkAuctionDetails: createForkAuctionDetails(),
		forkAuctionError: undefined,
		forkAuctionForm: createForkAuctionForm(),
		forkMigrationReadClient: createForkMigrationReadClient(),
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
		onClaimParentEscalationDeposits: () => undefined,
		onMigrateUnresolvedEscalation: _selectedChildOutcome => undefined,
		onMigrateRepToZoltar: () => undefined,
		onMigrateVault: () => undefined,
		onRefundLosingBids: () => undefined,
		onSelectedStageViewChange: () => undefined,
		onStartTruthAuction: () => undefined,
		onSubmitBid: () => undefined,
		onWithdrawForkedEscalation: (_outcome, _parentDepositIndexes) => undefined,
		securityPools: [createChildPool()],
		selectedStageView: 'migration',
		showHeader: false,
		showSecurityPoolAddressInput: false,
		...overrides,
	}
}

describe('ForkAuctionSection', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('renders the embedded fork workflow navigator and reports stage changes', async () => {
		const onSelectedStageViewChange = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createProps({ onSelectedStageViewChange })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const tablist = documentQueries.getByRole('tablist', { name: 'Fork lifecycle stages' })
		expect(tablist).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Fork Workflow' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Migration Status' })).not.toBeNull()

		const forkTriggeredTab = documentQueries.getByRole('tab', { name: 'Fork Readiness' })
		const migrationTab = documentQueries.getByRole('tab', { name: 'Migration' })
		const auctionTab = documentQueries.getByRole('tab', { name: 'Truth Auction' })
		const settlementTab = documentQueries.getByRole('tab', { name: 'Settlement' })

		expect(documentQueries.queryByText('View stage')).toBeNull()
		expect(documentQueries.queryByText('Current stage')).toBeNull()
		expect(documentQueries.queryByText('This step becomes active once migration is underway.')).toBeNull()
		expect(forkTriggeredTab.querySelector('.fork-workflow-stage-icon')).not.toBeNull()
		expect(migrationTab.className.includes('is-selected')).toBe(true)
		expect(migrationTab.className.includes('is-complete')).toBe(true)
		expect(within(migrationTab).getByText('Viewing')).not.toBeNull()
		expect(auctionTab.getAttribute('aria-current')).toBe('step')
		expect(auctionTab.className.includes('is-current')).toBe(true)
		expect(settlementTab.className.includes('is-upcoming')).toBe(true)
		expect(documentQueries.queryByRole('tab', { name: 'New Security Pools' })).toBeNull()
		const separators = Array.from(document.body.querySelectorAll('.fork-workflow-stage-separator'))
		expect(separators).toHaveLength(3)
		expect(separators[0]?.className.includes('is-complete')).toBe(true)
		expect(separators[1]?.className.includes('is-complete')).toBe(true)
		expect(separators[2]?.className.includes('is-upcoming')).toBe(true)

		fireEvent.click(settlementTab)
		expect(onSelectedStageViewChange).toHaveBeenLastCalledWith('settlement')

		fireEvent.keyDown(forkTriggeredTab, { key: 'ArrowRight' })
		expect(onSelectedStageViewChange).toHaveBeenLastCalledWith('migration')

		fireEvent.keyDown(migrationTab, { key: 'ArrowRight' })
		expect(onSelectedStageViewChange).toHaveBeenLastCalledWith('auction')
	})

	test('shows Viewing on the currently selected migration tab even when migration is also the current stage', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					forkAuctionDetails: createForkAuctionDetails({
						systemState: 'forkMigration',
						truthAuction: undefined,
						truthAuctionStartedAt: 0n,
					}),
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const migrationTab = documentQueries.getByRole('tab', { name: 'Migration' })
		expect(within(migrationTab).getByText('Viewing')).not.toBeNull()
	})

	test('shows the fork trigger timestamp when the system is forking', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentTimestamp: 2_000n,
					selectedStageView: 'fork-triggered',
					universeForkTime: 1_000n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('System is forking')).not.toBeNull()
		expect(documentQueries.getByText('1970-01-01 00:16:40 UTC')).not.toBeNull()
		expect(documentQueries.queryByText('The system is not forking.')).toBeNull()
		expect(documentQueries.queryByText('This required step marks the start of the fork workflow before assets migrate or auctions begin.')).toBeNull()
	})

	test('shows a not-forking message when no fork has been triggered', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					selectedStageView: 'fork-triggered',
					universeForkTime: 0n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('The system is not forking.')).not.toBeNull()
		expect(documentQueries.queryByText('System is forking')).toBeNull()
	})

	test('keeps settlement as the current step while finalized bids are still claimable', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'settlement',
					forkAuctionDetails: createForkAuctionDetails({
						claimingAvailable: true,
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
							hitCap: true,
							maxRepBeingSold: 1n,
							minBidSize: 1n,
							repPurchasableAtBid: undefined,
							timeRemaining: 0n,
							totalRepPurchased: 0n,
							underfunded: false,
							underfundedThreshold: undefined,
							underfundedWinningEth: 0n,
						},
					}),
					selectedStageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('tab', { name: 'Settlement' }).className.includes('is-current')).toBe(true)
		expect(documentQueries.queryByRole('tab', { name: 'New Security Pools' })).toBeNull()
		expect(documentQueries.getByRole('tabpanel', { name: 'Settlement' })).not.toBeNull()
	})

	test('shows the selected outcome field and child-pool link in the settlement child pools section', async () => {
		window.history.replaceState({}, '', 'http://localhost/#/security-pools?simulate=1&simScenario=securitypoolx2&selectedPoolView=reporting&universe=1')
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'settlement',
					selectedStageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Outcome')).not.toBeNull()
		const childPoolLink = documentQueries.getByRole('link', { name: 'Child pool' })
		expect(childPoolLink).not.toBeNull()
		expect(childPoolLink.closest('.fork-workflow-outcome-selector-row')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Child Security Pools' })).not.toBeNull()
		const listedChildPoolLink = documentQueries.getByRole('link', { name: 'Open security pool' })
		for (const link of [childPoolLink, listedChildPoolLink]) {
			const href = link.getAttribute('href') ?? ''
			expect(href).toContain('simulate=1')
			expect(href).toContain('simScenario=securitypoolx2')
			expect(href).toContain('selectedPoolView=reporting')
			expect(href).toContain('universe=11')
		}
	})

	test('shows only the direct parent-deposit claim action in the migration panel', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					forkAuctionDetails: createForkAuctionDetails({
						systemState: 'forkMigration',
						truthAuction: undefined,
						truthAuctionStartedAt: 0n,
					}),
					securityPools: [
						createChildPool({
							systemState: 'forkMigration',
							truthAuctionStartedAt: 0n,
						}),
					],
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Optional: Claim Parent Escalation Deposits' })).not.toBeNull()
		expect(documentQueries.getByText('This fast path pays selected winning parent deposits directly in child REP and marks their carried proofs spent. Unclaimed winners can instead settle from aggregate child backing with a proof.')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Claim Selected Yes Deposits' })).not.toBeNull()
		expect(documentQueries.queryByText('Selected deposits leave the parent pool and reappear on the chosen child universe for later settlement.')).toBeNull()
		expect(documentQueries.queryByText(/migratable escalation deposits/i)).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Migrate All Yes Deposits' })).toBeNull()
		expect(documentQueries.getByText('Open')).not.toBeNull()
	})

	test('shows advanced own-fork diagnostics only when own-fork migration data is available', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					forkAuctionDetails: createForkAuctionDetails({
						forkOwnSecurityPool: true,
						ownForkRepBuckets: {
							vaultRepAtFork: 12n,
							escalationChildRepPerSelectedOutcome: 9n,
							escrowSourceRepAtFork: 18n,
						},
						systemState: 'forkMigration',
						truthAuction: undefined,
						truthAuctionStartedAt: 0n,
					}),
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		let documentQueries = within(document.body)
		expect(documentQueries.getByText('Advanced Diagnostics')).not.toBeNull()
		expect(documentQueries.getByText('Pool REP At Fork')).not.toBeNull()
		expect(documentQueries.getByText('Escalation Child REP per Selected Outcome')).not.toBeNull()
		expect(documentQueries.getByText('Escrow Source REP At Fork')).not.toBeNull()

		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const rerenderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					forkAuctionDetails: createForkAuctionDetails({
						forkOwnSecurityPool: false,
						ownForkRepBuckets: undefined,
						systemState: 'forkMigration',
						truthAuction: undefined,
						truthAuctionStartedAt: 0n,
					}),
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = rerenderedComponent.cleanup

		documentQueries = within(document.body)
		expect(documentQueries.queryByText('Advanced Diagnostics')).toBeNull()
		expect(documentQueries.queryByText('Pool REP At Fork')).toBeNull()
		expect(documentQueries.queryByText('Escalation Child REP per Selected Outcome')).toBeNull()
		expect(documentQueries.queryByText('Escrow Source REP At Fork')).toBeNull()
	})

	test('disables unresolved escalation migration after the migration window closes', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000ab')
		const unresolvedDeposit = createReportingDeposit({
			amount: 12n,
			cumulativeAmount: 18n,
			depositIndex: 4n,
			depositor: walletAddress,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'migration',
					currentTimestamp: 200n,
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 200n,
						migrationEndsAt: 100n,
						systemState: 'forkMigration',
						truthAuction: undefined,
						truthAuctionStartedAt: 0n,
					}),
					reportingDetails: createActiveReportingDetails({
						settlementState: 'migration-required',
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: 12n, deposits: [unresolvedDeposit], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [unresolvedDeposit] },
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						viewerVaultExists: true,
						viewerVaultEscrowedRep: 12n,
						viewerVaultRepDepositShare: 12n,
					}),
					reportingForm: createReportingForm({
						selectedWithdrawDepositIndexesByOutcome: {
							invalid: [],
							yes: [4n],
							no: [],
						},
					}),
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(
			documentQueries.getByText(
				'First migrates this wallet’s unlocked vault ownership, allowance, fees, and collateral to the selected child, then clears its three parent outcome totals in constant-size work. This is not required to fund escalation backing or claim a winning carried proof; inherited losers require no claim transaction.',
			),
		).not.toBeNull()
		const button = documentQueries.getByRole('button', { name: 'Clear Parent Locks for Yes' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected unresolved migration action button')
		expect(button.disabled).toBe(true)
		expect(button.getAttribute('title')).toBe('Migration window has closed for this parent pool.')
	})

	test('keeps an exported escalation entitlement available for another selected child', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000ad')
		const consumedDeposit = createReportingDeposit({
			amount: 12n,
			cumulativeAmount: 18n,
			depositIndex: 4n,
			depositor: walletAddress,
		})
		const onMigrateUnresolvedEscalation = mock((_selectedChildOutcome: 'invalid' | 'yes' | 'no') => undefined)
		const parentPool = createChildPool({
			parent: zeroAddress,
			questionOutcome: 'none',
			securityPoolAddress: PARENT_POOL_ADDRESS,
			systemState: 'forkMigration',
			vaults: [
				{
					escalationEscrowedRep: 0n,
					repDepositShare: 0n,
					securityBondAllowance: 0n,
					unpaidEthFees: 0n,
					vaultAddress: walletAddress,
				},
			],
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'migration',
					currentTimestamp: 50n,
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 50n,
						migrationEndsAt: 100n,
						systemState: 'forkMigration',
						truthAuction: undefined,
						truthAuctionStartedAt: 0n,
					}),
					forkAuctionForm: createForkAuctionForm({ selectedOutcome: 'no' }),
					onMigrateUnresolvedEscalation,
					previewPool: parentPool,
					reportingDetails: createActiveReportingDetails({
						settlementState: 'locked',
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: 12n, deposits: [consumedDeposit], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [consumedDeposit] },
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						viewerEscalationMigrationEntitlement: {
							initialized: true,
							materializedByOutcome: { invalid: false, yes: true, no: false },
							totalCurrentRep: 12n,
						},
						viewerVaultEscrowedRep: 0n,
					}),
					securityPools: [parentPool, createChildPool({ questionOutcome: 'yes' })],
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Parent lock accounting was already cleared. Child proof eligibility is unchanged.')).not.toBeNull()
		expect(documentQueries.queryByText('Current path: Must migrate into the selected child universe')).toBeNull()
		const button = documentQueries.getByRole('button', { name: 'Clear Parent Locks for No' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected unresolved migration action button')
		expect(button.disabled).toBe(false)
		fireEvent.click(button)
		expect(onMigrateUnresolvedEscalation).toHaveBeenLastCalledWith('no')
	})

	test('does not fall back to direct parent-deposit claims after unresolved escalation cleanup expires', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000ae')
		const unresolvedDeposit = createReportingDeposit({
			amount: 12n,
			cumulativeAmount: 18n,
			depositIndex: 4n,
			depositor: walletAddress,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'migration',
					reportingDetails: createActiveReportingDetails({
						settlementState: 'migration-expired',
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: 12n, deposits: [unresolvedDeposit], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [unresolvedDeposit] },
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						viewerVaultExists: true,
						viewerVaultEscrowedRep: 12n,
						viewerVaultRepDepositShare: 12n,
					}),
					reportingForm: createReportingForm({
						selectedWithdrawDepositIndexesByOutcome: {
							invalid: [],
							yes: [4n],
							no: [],
						},
					}),
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('The optional parent-lock cleanup window has closed. Child backing and winning-proof eligibility are unchanged.')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Optional: Clear Parent Escalation Locks' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Optional: Claim Parent Escalation Deposits' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Clear Parent Locks for Yes' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Claim Selected Yes Deposits' })).toBeNull()
	})

	test('disables vault migration after the migration window closes', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000ac')
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'migration',
					currentTimestamp: 200n,
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 200n,
						migrationEndsAt: 100n,
						systemState: 'forkMigration',
						truthAuction: undefined,
						truthAuctionStartedAt: 0n,
					}),
					previewPool: createChildPool({
						vaults: [
							{
								escalationEscrowedRep: 0n,
								repDepositShare: 20n,
								securityBondAllowance: 3n,
								unpaidEthFees: 0n,
								vaultAddress: walletAddress,
							},
						],
					}),
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Migrate Vault To Yes' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected vault migration action button')
		expect(button.disabled).toBe(true)
		expect(button.getAttribute('title')).toBe('Migration window has closed for this parent pool.')
	})

	test('keeps fork-carried settlement disabled until the child pool question finalizes', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000ad')
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'settlement',
					reportingDetails: createActiveReportingDetails({
						questionOutcome: 'none',
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{
								balance: 12n,
								deposits: [],
								importedUserDeposits: [
									{
										amount: 12n,
										cumulativeAmount: 6n,
										depositor: walletAddress,
										parentDepositIndex: 9n,
									},
								],
								key: 'yes',
								label: 'Yes',
								userDeposits: [],
							},
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
					selectedStageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Worth now: Pending final settlement')).not.toBeNull()
		const button = documentQueries.getByRole('button', { name: 'Settle Selected Yes Fork-Carried Deposits' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected fork-carried settlement action button')
		expect(button.disabled).toBe(true)
		expect(button.getAttribute('title')).toBe('Winning fork-carried escalation deposits can be settled after this child pool finalizes.')
	})

	test('keeps fork-carried settlement disabled when the child outcome is known before the pool becomes operational', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000af')
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'settlement',
					reportingDetails: createActiveReportingDetails({
						questionOutcome: 'yes',
						systemState: 'forkTruthAuction',
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{
								balance: 12n,
								deposits: [],
								importedUserDeposits: [
									{
										amount: 12n,
										cumulativeAmount: 6n,
										depositor: walletAddress,
										parentDepositIndex: 9n,
									},
								],
								key: 'yes',
								label: 'Yes',
								userDeposits: [],
							},
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
					selectedStageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Worth now: Pending final settlement')).not.toBeNull()
		const button = documentQueries.getByRole('button', { name: 'Settle Selected Yes Fork-Carried Deposits' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected fork-carried settlement action button')
		expect(button.disabled).toBe(true)
		expect(button.getAttribute('title')).toBe('Winning fork-carried escalation deposits can be settled after this child pool finalizes.')
	})

	test('does not show the empty child-pools notice when a selected child pool is already known', async () => {
		const currentChildPool = createChildPool()
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'settlement',
					previewPool: currentChildPool,
					securityPools: [],
					selectedStageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('link', { name: 'Child pool' })).not.toBeNull()
		expect(documentQueries.queryByText('No child security pools are available yet.')).toBeNull()
	})

	test('uses the current child pool as the selected outcome pool during truth auction', async () => {
		const currentChildPool = createChildPool()
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					forkAuctionDetails: createForkAuctionDetails({
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'yes',
						securityPoolAddress: currentChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f6'),
						truthAuctionStartedAt: 1n,
						universeId: currentChildPool.universeId,
					}),
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('link', { name: 'Child pool' })).not.toBeNull()
		expect(documentQueries.queryByText('Security Pool for Yes universe does not exist.')).toBeNull()
	})

	test('replaces the start action with auction status after the truth auction has started', async () => {
		const startedChildPool = createChildPool({
			systemState: 'forkTruthAuction',
			truthAuctionStartedAt: 10n,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					auctionDetailsOverride: createForkAuctionDetails({
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						securityPoolAddress: startedChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuctionStartedAt: 10n,
						universeId: startedChildPool.universeId,
					}),
					currentStageView: 'auction',
					currentTimestamp: 20n,
					securityPools: [startedChildPool],
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const statusHeading = documentQueries.getByRole('heading', { name: 'Truth Auction Status' })
		const statusHeader = statusHeading.closest('.section-block-header')
		if (!(statusHeader instanceof HTMLElement)) throw new Error('Expected truth auction status header')
		expect(statusHeader.querySelector('.section-block-badge .badge')?.textContent?.trim()).toBe('Started')
		expect(documentQueries.getByText('1970-01-01 00:00:10 UTC')).not.toBeNull()
		expect(documentQueries.queryByText('Inactive')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Start Truth Auction' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Start Truth Auction' })).toBeNull()
		expect(documentQueries.queryByText('Truth auction already started.')).toBeNull()
	})

	test('shows truth auction end time as a timestamp instead of a standalone time-left field', async () => {
		const currentChildPool = createChildPool({
			securityPoolAddress: '0x00000000000000000000000000000000000000f7',
			systemState: 'forkTruthAuction',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					currentTimestamp: 5n,
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 5n,
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'yes',
						securityPoolAddress: currentChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuction: {
							accumulatedEth: 0n,
							auctionEndsAt: 604_801n,
							clearingPrice: 1n,
							clearingTick: 0n,
							ethAtClearingTick: 0n,
							ethRaiseCap: 1n,
							ethRaised: 0n,
							finalized: false,
							hitCap: false,
							maxRepBeingSold: 1n,
							minBidSize: 1n,
							repPurchasableAtBid: undefined,
							timeRemaining: 604_796n,
							totalRepPurchased: 0n,
							underfunded: false,
							underfundedThreshold: undefined,
							underfundedWinningEth: 0n,
						},
						truthAuctionAddress: currentChildPool.truthAuctionAddress,
						truthAuctionStartedAt: 1n,
						universeId: currentChildPool.universeId,
					}),
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Time Left')).toBeNull()
		expect(documentQueries.getByText('Starts')).not.toBeNull()
		expect(documentQueries.getByText('1970-01-01 00:00:01 UTC')).not.toBeNull()
		expect(documentQueries.getByText('Ends')).not.toBeNull()
		expect(documentQueries.getByText('1970-01-08 00:00:01 UTC')).not.toBeNull()
		expect(documentQueries.getByText('(in 6d 23h 59m)')).not.toBeNull()
		const truthAuctionHeading = documentQueries.getByRole('heading', { name: 'Truth Auction' })
		const truthAuctionCard = truthAuctionHeading.closest('.section-block')
		if (!(truthAuctionCard instanceof HTMLElement)) throw new Error('Expected truth auction summary card')
		expect(truthAuctionCard.querySelector('.section-block-badge .badge')?.textContent?.trim()).toBe('Open')
		expect(truthAuctionCard.querySelector('.fork-workflow-summary')).not.toBeNull()
	})

	test('makes the auctioned bond allowance and debt transfer explicit during bidding', async () => {
		const currentChildPool = createChildPool({
			securityPoolAddress: '0x00000000000000000000000000000000000000f7',
			systemState: 'forkTruthAuction',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({
						address: getAddress('0x00000000000000000000000000000000000000aa'),
						ethBalance: 10n ** 18n,
					}),
					currentStageView: 'auction',
					currentTimestamp: 5n,
					forkAuctionDetails: createForkAuctionDetails({
						auctionedSecurityBondAllowance: 7n,
						currentTime: 5n,
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'yes',
						securityPoolAddress: currentChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuction: {
							accumulatedEth: 0n,
							auctionEndsAt: 604_801n,
							clearingPrice: 1n,
							clearingTick: 0n,
							ethAtClearingTick: 0n,
							ethRaiseCap: 1n,
							ethRaised: 0n,
							finalized: false,
							hitCap: false,
							maxRepBeingSold: 1n,
							minBidSize: 1n,
							repPurchasableAtBid: undefined,
							timeRemaining: 604_796n,
							totalRepPurchased: 0n,
							underfunded: false,
							underfundedThreshold: undefined,
							underfundedWinningEth: 0n,
						},
						truthAuctionAddress: currentChildPool.truthAuctionAddress,
						truthAuctionStartedAt: 1n,
						universeId: currentChildPool.universeId,
					}),
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Auctioned Bond Allowance (OI Debt)')).not.toBeNull()
		expect(documentQueries.queryByText('Winning bids buy more than REP.')).toBeNull()
		expect(documentQueries.getByText('Winning settlement can also assign a pro-rata share of the pool security-bond allowance.')).not.toBeNull()
	})

	test('disables bid submission when the entered bid price is an oversized out-of-range value', async () => {
		const currentChildPool = createChildPool({
			securityPoolAddress: '0x00000000000000000000000000000000000000f7',
			systemState: 'forkTruthAuction',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({
						address: getAddress('0x00000000000000000000000000000000000000aa'),
						ethBalance: 10n ** 18n,
					}),
					currentStageView: 'auction',
					currentTimestamp: 5n,
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 5n,
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'yes',
						securityPoolAddress: currentChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuction: {
							accumulatedEth: 0n,
							auctionEndsAt: 604_801n,
							clearingPrice: 1n,
							clearingTick: 0n,
							ethAtClearingTick: 0n,
							ethRaiseCap: 1n,
							ethRaised: 0n,
							finalized: false,
							hitCap: false,
							maxRepBeingSold: 1n,
							minBidSize: 1n,
							repPurchasableAtBid: undefined,
							timeRemaining: 604_796n,
							totalRepPurchased: 0n,
							underfunded: false,
							underfundedThreshold: undefined,
							underfundedWinningEth: 0n,
						},
						truthAuctionAddress: currentChildPool.truthAuctionAddress,
						truthAuctionStartedAt: 1n,
						universeId: currentChildPool.universeId,
					}),
					forkAuctionForm: createForkAuctionForm({
						submitBidAmount: '1',
						submitBidPrice: '9'.repeat(2_048),
					}),
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const submitBidButton = documentQueries.getByRole('button', { name: 'Submit Bid' })
		if (!(submitBidButton instanceof HTMLButtonElement)) throw new Error('Expected Submit Bid button to be a button element')
		expect(submitBidButton.getAttribute('title')).toBe('Bid price is outside the supported auction range.')
		expect(submitBidButton.disabled).toBe(true)
	})

	test('keeps fork-auction actions disabled off mainnet and shows switch-network recovery', async () => {
		const currentChildPool = createChildPool({
			securityPoolAddress: '0x00000000000000000000000000000000000000f7',
			systemState: 'forkTruthAuction',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ chainId: '0xaa36a7', ethBalance: 10n ** 18n }),
					currentStageView: 'auction',
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 5n,
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'yes',
						securityPoolAddress: currentChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuction: {
							accumulatedEth: 0n,
							auctionEndsAt: 604_801n,
							clearingPrice: 1n,
							clearingTick: 0n,
							ethAtClearingTick: 0n,
							ethRaiseCap: 1n,
							ethRaised: 0n,
							finalized: false,
							hitCap: false,
							maxRepBeingSold: 1n,
							minBidSize: 1n,
							repPurchasableAtBid: undefined,
							timeRemaining: 604_796n,
							totalRepPurchased: 0n,
							underfunded: false,
							underfundedThreshold: 0n,
							underfundedWinningEth: 0n,
						},
						truthAuctionAddress: currentChildPool.truthAuctionAddress,
						truthAuctionStartedAt: 1n,
						universeId: currentChildPool.universeId,
					}),
					forkAuctionForm: createForkAuctionForm({
						submitBidAmount: '1',
						submitBidPrice: '1',
					}),
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const submitBidButton = documentQueries.getByRole('button', { name: 'Submit Bid' })
		if (!(submitBidButton instanceof HTMLButtonElement)) throw new Error('Expected Submit Bid button to be a button element')
		expect(submitBidButton.disabled).toBe(true)
		expect(submitBidButton.title).toBe('Switch to Ethereum mainnet.')
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(true)
	})

	test('keeps fork-auction downstream blocker copy hidden off mainnet', async () => {
		const currentChildPool = createChildPool({
			securityPoolAddress: '0x00000000000000000000000000000000000000f7',
			systemState: 'forkTruthAuction',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ chainId: '0xaa36a7', ethBalance: 10n ** 18n }),
					currentStageView: 'auction',
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 5n,
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'yes',
						securityPoolAddress: currentChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuction: {
							accumulatedEth: 0n,
							auctionEndsAt: 604_801n,
							clearingPrice: 1n,
							clearingTick: 0n,
							ethAtClearingTick: 0n,
							ethRaiseCap: 1n,
							ethRaised: 0n,
							finalized: false,
							hitCap: false,
							maxRepBeingSold: 1n,
							minBidSize: 1n,
							repPurchasableAtBid: undefined,
							timeRemaining: 604_796n,
							totalRepPurchased: 0n,
							underfunded: false,
							underfundedThreshold: 0n,
							underfundedWinningEth: 0n,
						},
						truthAuctionAddress: currentChildPool.truthAuctionAddress,
						truthAuctionStartedAt: 1n,
						universeId: currentChildPool.universeId,
					}),
					forkAuctionForm: createForkAuctionForm({
						submitBidAmount: '1',
						submitBidPrice: '9'.repeat(2_048),
					}),
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const submitBidButton = documentQueries.getByRole('button', { name: 'Submit Bid' })
		if (!(submitBidButton instanceof HTMLButtonElement)) throw new Error('Expected Submit Bid button to be a button element')
		expect(submitBidButton.disabled).toBe(true)
		expect(submitBidButton.title).toBe('Switch to Ethereum mainnet.')
	})

	test('shows a missing-universe notice without a creation button', async () => {
		const onCreateChildUniverse = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					forkAuctionDetails: createForkAuctionDetails({
						forkOutcome: 'none',
						migratedRep: 0n,
						systemState: 'poolForked',
						truthAuction: undefined,
						truthAuctionStartedAt: 0n,
					}),
					onCreateChildUniverse,
					securityPools: [],
					selectedStageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('No child security pools are available yet.')).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Create Yes Child Universe' })).toBeNull()
		expect(onCreateChildUniverse).not.toHaveBeenCalled()
	})

	test('does not show a future migration deadline once the selected child is already in truth auction', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					currentTimestamp: 1_000n,
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 1_000n,
						migrationEndsAt: 5_000_000n,
						truthAuctionStartedAt: 0n,
					}),
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('1970-01-01 00:00:01 UTC')).not.toBeNull()
		expect(documentQueries.getByText('(16m ago)')).not.toBeNull()
	})

	test('shows the migration start timestamp in migration status', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					currentTimestamp: 10n,
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 10n,
						migrationEndsAt: 4_838_402n,
						systemState: 'forkMigration',
						truthAuctionStartedAt: 0n,
					}),
					selectedStageView: 'migration',
					universeForkTime: 2n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const migrationStartedLabel = documentQueries.getByText('Migration Started')
		const migrationStartedMetric = migrationStartedLabel.closest('div')
		if (!(migrationStartedMetric instanceof HTMLElement)) throw new Error('Expected migration started metric')
		expect(within(migrationStartedMetric).getByText('1970-01-01 00:00:02 UTC')).not.toBeNull()
		expect(within(migrationStartedMetric).getByText('(less than a minute ago)')).not.toBeNull()
		const migrationHeading = documentQueries.getByRole('heading', { name: 'Migration Status' })
		const migrationCard = migrationHeading.closest('.section-block')
		if (!(migrationCard instanceof HTMLElement)) throw new Error('Expected migration summary card')
		expect(migrationCard.querySelector('.fork-workflow-summary')).not.toBeNull()
		expect(within(migrationCard).getByText('REP At Fork')).not.toBeNull()
		expect(within(migrationCard).getByText('Migrated REP')).not.toBeNull()
		expect(within(migrationCard).getByText('Collateral')).not.toBeNull()
	})

	test('shows a closed migration badge once the truth auction timeline has started', async () => {
		const currentChildPool = createChildPool({
			securityPoolAddress: '0x00000000000000000000000000000000000000f7',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					currentTimestamp: 1_000n,
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 1_000n,
						migrationEndsAt: 5_000_000n,
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'yes',
						securityPoolAddress: currentChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuctionAddress: currentChildPool.truthAuctionAddress,
						truthAuctionStartedAt: 1n,
						universeId: currentChildPool.universeId,
					}),
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Closed')).not.toBeNull()
	})

	test('shows a closed migration badge at the exact migration deadline', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					currentTimestamp: 5_000_000n,
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 5_000_000n,
						migrationEndsAt: 5_000_000n,
						systemState: 'forkMigration',
						truthAuctionStartedAt: 0n,
					}),
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Closed')).not.toBeNull()
	})

	test('shows a not-started migration badge when migration timing is unavailable', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					forkAuctionDetails: createForkAuctionDetails({
						migrationEndsAt: undefined,
						systemState: 'operational',
						truthAuctionStartedAt: 0n,
					}),
					selectedStageView: 'migration',
					universeForkTime: 0n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Not Started')).not.toBeNull()
	})
})
