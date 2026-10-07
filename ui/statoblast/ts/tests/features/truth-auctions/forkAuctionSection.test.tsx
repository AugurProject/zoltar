import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
/// <reference types='bun-types' />

import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { createWalletActions, expectWalletFixDescribesAction } from '@zoltar/ui-core-shared/tests/testUtils/walletActions.js'
import { WalletActionsProvider } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { EscalationDeposit, ForkAuctionDetails, ListedSecurityPool, ReportingDetails, TruthAuctionMetrics } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { formatTruthAuctionTickPriceInput, getTruthAuctionPriceAtTick } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/truthAuctionBook.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { ForkAuctionSection } from '@zoltar/ui-statoblast-shared/features/truth-auctions/components/ForkAuctionSection.js'
import type { ForkAuctionSectionProps } from '@zoltar/ui-statoblast-shared/features/types.js'
import type { AccountState } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { ReportingFormState } from '@zoltar/ui-statoblast-shared/types/app.js'
import { describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { createForkAuctionForm, createForkAuctionSectionProps, createForkChildPool, PARENT_POOL_ADDRESS } from './forkAuctionFixtures.js'

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
		amountAttoRep: 10n,
		cumulativeAmountAttoRep: 10n,
		depositIndex: 0n,
		depositor: zeroAddress,
		...overrides,
	}
}

function createActiveReportingDetails(overrides: Partial<ReportingDetails> = {}): ReportingDetails {
	return {
		bindingCapital: 5n,
		settlementCollateralAttoEth: 0n,
		currentRequiredBond: 1n,
		currentTime: 3n,
		escalationEndTime: 50n,
		escalationGameAddress: getAddress('0x00000000000000000000000000000000000000fa'),
		forkThresholdAttoRep: 100n,
		hasReachedNonDecision: false,
		marketDetails: createMarketDetails(),
		nonDecisionThresholdAttoRep: 100n,
		questionOutcome: 'none',
		securityPoolAddress: PARENT_POOL_ADDRESS,
		settlementState: 'locked',
		sides: [
			{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
		startBondAttoRep: 1n,
		status: 'active',
		systemState: 'operational',
		universeId: 1n,
		parentWithdrawalEnabled: false,
		viewerPoolHeldVaultRepBackingAttoRep: 0n,
		viewerVaultExists: false,
		viewerVaultDisputeStakedAttoRep: 0n,
		viewerVaultRepBackingAttoRep: 0n,
		activationTime: 1n,
		totalCostAttoRep: 1n,
		...overrides,
	}
}

function createForkAuctionDetails(overrides: Partial<ForkAuctionDetails> = {}): ForkAuctionDetails {
	return {
		auctionedUnderwritingLimitAttoEth: 0n,
		claimingAvailable: false,
		settlementCollateralAttoEth: 0n,
		currentTime: 3n,
		hasForkActivity: true,
		forkOutcome: 'yes',
		forkOwnSecurityPool: false,
		marketDetails: createMarketDetails(),
		migratedAttoRep: 1n,
		migrationEndsAt: 100n,
		parentSecurityPoolAddress: zeroAddress,
		questionOutcome: 'yes',
		auctionableAttoRepAtFork: 0n,
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
	return createForkChildPool({ securityPoolAddress: '0x00000000000000000000000000000000000000f1', ...overrides })
}

function createFinalizedTruthAuctionDetails(currentChildPool: ListedSecurityPool): ForkAuctionDetails {
	return createForkAuctionDetails({
		currentTime: 604_802n,
		parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
		questionOutcome: 'yes',
		securityPoolAddress: currentChildPool.securityPoolAddress,
		systemState: 'operational',
		truthAuction: {
			accumulatedBidAttoEth: 5n * 10n ** 18n,
			auctionEndsAt: 604_801n,
			clearingPrice: 1n,
			clearingTick: 0n,
			bidAtClearingTickAttoEth: 0n,
			attoEthRaiseCap: 10n * 10n ** 18n,
			attoEthRaised: 5n * 10n ** 18n,
			finalized: true,
			hitCap: false,
			maxAttoRepBeingSold: 10n * 10n ** 18n,
			minBidSizeAttoEth: 1n,
			attoRepPurchasableAtBid: undefined,
			timeRemaining: 0n,
			totalAttoRepPurchased: 5n * 10n ** 18n,
			underfunded: false,
			finalizationPreview: { attoEthRaised: 5n * 10n ** 18n, attoRepSold: 5n * 10n ** 18n },
			underfundedThreshold: undefined,
			underfundedWinningAttoEth: 0n,
		},
		truthAuctionAddress: currentChildPool.truthAuctionAddress,
		truthAuctionStartedAt: 1n,
		universeId: currentChildPool.universeId,
	})
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
	return createForkAuctionSectionProps(createForkAuctionDetails(), {
		currentStageView: 'auction',
		embedInCard: true,
		forkMigrationReadClient: createForkMigrationReadClient(),
		onSelectedStageViewChange: () => undefined,
		onWithdrawAuctionRefund: () => undefined,
		securityPools: [createChildPool()],
		selectedStageView: 'migration',
		showHeader: false,
		showSecurityPoolAddressInput: false,
		...overrides,
	})
}

installTestRouting()
describe('ForkAuctionSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('shows a loading message instead of a pool prompt while the embedded pool has no fork details yet', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createForkAuctionSectionProps(undefined, { embedInCard: true, showHeader: false, showSecurityPoolAddressInput: false })))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent).toContain('Loading fork details…')
		expect(document.body.textContent).not.toContain('Select a pool to inspect')
	})

	test('renders the embedded fork workflow navigator and reports stage changes', async () => {
		const onSelectedStageViewChange = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createProps({ onSelectedStageViewChange })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const tablist = documentQueries.getByRole('tablist', { name: 'Fork lifecycle stages' })
		expect(tablist).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Fork Workflow' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Migration status' })).not.toBeNull()

		const forkTriggeredTab = documentQueries.getByRole('tab', { name: 'Fork trigger' })
		const migrationTab = documentQueries.getByRole('tab', { name: 'Migration' })
		const auctionTab = documentQueries.getByRole('tab', { name: 'Truth auction' })
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
		expect(documentQueries.queryByRole('tab', { name: 'New Security pools' })).toBeNull()
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
		expect(documentQueries.getByRole('heading', { name: 'Fork not triggered' })).not.toBeNull()
		expect(documentQueries.queryByText('The system is not forking.')).toBeNull()
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
							accumulatedBidAttoEth: 0n,
							auctionEndsAt: 10n,
							clearingPrice: 1n,
							clearingTick: 0n,
							bidAtClearingTickAttoEth: 0n,
							attoEthRaiseCap: 1n,
							attoEthRaised: 0n,
							finalized: true,
							hitCap: true,
							maxAttoRepBeingSold: 1n,
							minBidSizeAttoEth: 1n,
							attoRepPurchasableAtBid: undefined,
							timeRemaining: 0n,
							totalAttoRepPurchased: 0n,
							underfunded: false,
							finalizationPreview: { attoEthRaised: 0n, attoRepSold: 0n },
							underfundedThreshold: undefined,
							underfundedWinningAttoEth: 0n,
						},
					}),
					selectedStageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('tab', { name: 'Settlement' }).className.includes('is-current')).toBe(true)
		expect(documentQueries.queryByRole('tab', { name: 'New Security pools' })).toBeNull()
		expect(documentQueries.getByRole('tabpanel', { name: 'Settlement' })).not.toBeNull()
	})

	test('shows the selected outcome field and child-pool link in the settlement child pools section', async () => {
		window.history.replaceState({}, '', 'http://localhost/#/pools/0x00000000000000000000000000000000000000a1/reporting?simulate=1&simScenario=securitypoolx2&universe=1')
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
		expect(documentQueries.getByRole('heading', { name: 'Child security pools' })).not.toBeNull()
		const listedChildPoolLink = documentQueries.getByRole('link', { name: 'Open security pool' })
		for (const link of [childPoolLink, listedChildPoolLink]) {
			const href = link.getAttribute('href') ?? ''
			expect(href).toContain('simulate=1')
			expect(href).toContain('simScenario=securitypoolx2')
			expect(href).toMatch(/^#\/pools\/0x[0-9a-fA-F]{40}\/reporting\?/)
			expect(href).not.toContain('selectedPoolView=')
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
		expect(documentQueries.getByRole('heading', { name: 'Optional: claim parent deposits' })).not.toBeNull()
		expect(documentQueries.getByText('Claims the selected winning parent deposits directly as REP in the child universe. You can also settle them later in the child pool.')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Claim selected Yes deposits' })).not.toBeNull()
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
							vaultRepAtForkAttoRep: 12n,
							escalationChildRepPerSelectedOutcomeAttoRep: 9n,
							escrowSourceRepAtForkAttoRep: 18n,
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
		expect(documentQueries.getByText('Advanced diagnostics')).not.toBeNull()
		expect(documentQueries.getByText('Pool-held REP at fork')).not.toBeNull()
		expect(documentQueries.getByText('Dispute-staked REP per selected outcome')).not.toBeNull()
		expect(documentQueries.getByText('Dispute-staked REP source at fork')).not.toBeNull()

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
		expect(documentQueries.queryByText('Advanced diagnostics')).toBeNull()
		expect(documentQueries.queryByText('Pool-held REP at fork')).toBeNull()
		expect(documentQueries.queryByText('Dispute-staked REP per selected outcome')).toBeNull()
		expect(documentQueries.queryByText('Dispute-staked REP source at fork')).toBeNull()
	})

	test.each([40n, 99n, 100n, 101n, 200n])('disables unresolved escalation migration without submission reserve at %s', async currentTimestamp => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000ab')
		const unresolvedDeposit = createReportingDeposit({
			amountAttoRep: 12n,
			cumulativeAmountAttoRep: 18n,
			depositIndex: 4n,
			depositor: walletAddress,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'migration',
					currentTimestamp,
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: currentTimestamp,
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
						viewerVaultDisputeStakedAttoRep: 12n,
						viewerVaultRepBackingAttoRep: 12n,
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
		expect(documentQueries.getByText('Optional. Moves your vault to the selected universe and clears your unresolved parent deposits in one step; the move can’t be undone. You don’t need it to claim winning deposits, and losing parent deposits need no transaction.')).not.toBeNull()
		// The contract mechanics stay available under Technical details instead of leading the explanation.
		expect(documentQueries.getByText('Technical details')).not.toBeNull()
		expect(document.body.textContent).toContain('It then clears the three parent outcome totals in constant-size work.')
		// Every unresolved deposit is included automatically, so the list shows no checkboxes that look selectable but cannot change.
		expect(document.body.textContent).toContain('Deposit #4')
		expect(document.body.querySelector('.withdraw-deposit-list input[type="checkbox"]')).toBeNull()
		const button = documentQueries.getByRole('button', { name: 'Clear unresolved deposits for Yes' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected unresolved migration action button')
		expect(button.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Clear unresolved deposits for Yes').reason).toBe(currentTimestamp > 100n ? 'Migration window has closed for this parent pool.' : 'Migration window ends too soon to submit.')
	})

	test('renders unresolved parent escalation-deposit accounting loading with the shared accessible spinner', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000ac')
		const unresolvedDeposit = createReportingDeposit({ depositor: walletAddress })
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'migration',
					forkAuctionDetails: createForkAuctionDetails({
						systemState: 'forkMigration',
						truthAuction: undefined,
						truthAuctionStartedAt: 0n,
					}),
					loadingReportingDetails: true,
					reportingDetails: createActiveReportingDetails({
						settlementState: 'migration-required',
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: 10n, deposits: [unresolvedDeposit], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [unresolvedDeposit] },
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						viewerVaultDisputeStakedAttoRep: 10n,
						viewerVaultExists: true,
						viewerVaultRepBackingAttoRep: 10n,
					}),
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const loadingStatus = within(document.body).getByText('Loading unresolved parent deposits for the connected wallet…')
		expect(loadingStatus.textContent).toContain('Loading unresolved parent deposits for the connected wallet…')
		expect(loadingStatus.getAttribute('role')).toBe('status')
		expect(loadingStatus.querySelector('.spinner')).not.toBeNull()
	})

	test('keeps an exported escalation entitlement available for another selected child', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000ad')
		const consumedDeposit = createReportingDeposit({
			amountAttoRep: 12n,
			cumulativeAmountAttoRep: 18n,
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
					disputeStakedAttoRep: 0n,
					vaultAttoRepBacking: 0n,
					underwritingLimitAttoEth: 0n,
					claimableFeesAttoEth: 0n,
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
						migrationEndsAt: 200n,
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
							totalCurrentAttoRep: 12n,
						},
						viewerVaultDisputeStakedAttoRep: 0n,
					}),
					securityPools: [parentPool, createChildPool({ questionOutcome: 'yes' })],
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Unresolved parent deposits were already cleared. Your winning claims in the child pool are unchanged.')).not.toBeNull()
		expect(documentQueries.queryByText('Current path: Must migrate into the selected child universe')).toBeNull()
		const button = documentQueries.getByRole('button', { name: 'Clear unresolved deposits for No' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected unresolved migration action button')
		expect(button.disabled).toBe(false)
		fireEvent.click(button)
		expect(onMigrateUnresolvedEscalation).toHaveBeenLastCalledWith('no')
	})

	test('does not fall back to direct parent-deposit claims after unresolved escalation cleanup expires', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000ae')
		const unresolvedDeposit = createReportingDeposit({
			amountAttoRep: 12n,
			cumulativeAmountAttoRep: 18n,
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
						viewerVaultDisputeStakedAttoRep: 12n,
						viewerVaultRepBackingAttoRep: 12n,
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
		expect(documentQueries.getByText('The window for the optional cleanup of unresolved parent deposits has closed. Nothing is lost: your child-pool backing and winning claims are unchanged.')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Optional: clear unresolved parent deposits' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Optional: claim parent deposits' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Clear unresolved deposits for Yes' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Claim selected Yes deposits' })).toBeNull()
	})

	test('submits vault migration with the displayed vault amounts for the review', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000ad')
		const onMigrateVault = mock((_vault?: { repAttoRep: bigint; underwritingLimitAttoEth: bigint }) => undefined)
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
					forkMigrationReadClient: {
						readContract: mock(async request => {
							switch (request.functionName) {
								case 'getChildUniverseId':
									return 11n
								case 'getMigrationProxyAddress':
									return zeroAddress
								case 'getRepToken':
									return getAddress('0x00000000000000000000000000000000000000ae')
								case 'balanceOf':
									return 1n
								default:
									throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
							}
						}) as ReadClient['readContract'],
					},
					onMigrateVault,
					previewPool: createChildPool({
						vaults: [
							{
								disputeStakedAttoRep: 0n,
								vaultAttoRepBacking: 20n,
								underwritingLimitAttoEth: 3n,
								claimableFeesAttoEth: 0n,
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
		await waitFor(() => {
			const button = documentQueries.getByRole('button', { name: 'Migrate vault to Yes' })
			if (!(button instanceof HTMLButtonElement)) throw new Error('Expected vault migration action button')
			expect(button.disabled).toBe(false)
		})
		fireEvent.click(documentQueries.getByRole('button', { name: 'Migrate vault to Yes' }))
		expect(onMigrateVault).toHaveBeenCalledWith({ repAttoRep: 20n, underwritingLimitAttoEth: 3n })
	})

	const FORKED_VAULT_ADDRESS = getAddress('0x00000000000000000000000000000000000000ab')
	const POOL_REP_AT_FORK_ATTO_REP = 2_000_000n * 10n ** 18n

	function createSeedStatusReadClient(balances: { childPool: () => bigint; proxy: () => bigint }, onLoad: () => void = () => undefined): Pick<ReadClient, 'readContract'> {
		const proxyAddress = getAddress('0x00000000000000000000000000000000000000a9')
		return {
			readContract: mock(async request => {
				switch (request.functionName) {
					case 'getChildUniverseId':
						onLoad()
						return 11n
					case 'getMigrationProxyAddress':
						return proxyAddress
					case 'getRepToken':
						return getAddress('0x00000000000000000000000000000000000000ae')
					case 'balanceOf':
						return Array.isArray(request.args) && request.args[0] === proxyAddress ? balances.proxy() : balances.childPool()
					default:
						throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
				}
			}) as ReadClient['readContract'],
		}
	}

	function createForkedVaultProps(overrides: Partial<ForkAuctionSectionProps> = {}, vaultOverrides: Partial<ListedSecurityPool['vaults'][number]> = {}) {
		return createProps({
			accountState: createAccountState({ address: FORKED_VAULT_ADDRESS }),
			currentStageView: 'migration',
			currentTimestamp: 50n,
			forkAuctionDetails: createForkAuctionDetails({
				auctionableAttoRepAtFork: POOL_REP_AT_FORK_ATTO_REP,
				currentTime: 50n,
				migrationEndsAt: 100n,
				systemState: 'poolForked',
				truthAuction: undefined,
				truthAuctionStartedAt: 0n,
			}),
			forkMigrationReadClient: createSeedStatusReadClient({ childPool: () => 0n, proxy: () => POOL_REP_AT_FORK_ATTO_REP }),
			previewPool: createChildPool({
				vaults: [
					{
						claimableFeesAttoEth: 0n,
						disputeStakedAttoRep: 0n,
						repBackingUnits: 3n * 10n ** 18n,
						totalPoolHeldRepBalanceAttoRep: 0n,
						totalRepBackingUnits: 4n * 10n ** 18n,
						underwritingLimitAttoEth: 0n,
						vaultAddress: FORKED_VAULT_ADDRESS,
						vaultAttoRepBacking: 0n,
						...vaultOverrides,
					},
				],
			}),
			securityPools: [],
			selectedStageView: 'migration',
			...overrides,
		})
	}

	test('shows and reviews the forked vault share of pool-held REP at fork instead of its emptied current backing', async () => {
		const onMigrateVault = mock((_vault?: { repAttoRep: bigint | undefined; underwritingLimitAttoEth: bigint }) => undefined)
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createForkedVaultProps({ onMigrateVault })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => expect(getTransactionButtonState(document.body, 'Migrate vault to Yes').disabled).toBe(false))
		expect(documentQueries.getByText('1 500 000.00 REP')).not.toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Migrate vault to Yes' }))
		expect(onMigrateVault).toHaveBeenCalledWith({ repAttoRep: 1_500_000n * 10n ** 18n, underwritingLimitAttoEth: 0n })
	})

	test('omits the vault migration REP amount when the vault backing units are unavailable', async () => {
		const onMigrateVault = mock((_vault?: { repAttoRep: bigint | undefined; underwritingLimitAttoEth: bigint }) => undefined)
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createForkedVaultProps({ onMigrateVault }, { repBackingUnits: undefined, totalRepBackingUnits: undefined, underwritingLimitAttoEth: 3n })))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(getTransactionButtonState(document.body, 'Migrate vault to Yes').disabled).toBe(false))
		expect(document.body.textContent).toContain('REP backing—')
		fireEvent.click(within(document.body).getByRole('button', { name: 'Migrate vault to Yes' }))
		expect(onMigrateVault).toHaveBeenCalledWith({ repAttoRep: undefined, underwritingLimitAttoEth: 3n })
	})

	test('states each migration reason once and keeps the confirmed vault migration state while the seed status refreshes', async () => {
		let proxyBalance = POOL_REP_AT_FORK_ATTO_REP
		let seedStatusLoads = 0
		const forkMigrationReadClient = createSeedStatusReadClient({ childPool: () => 0n, proxy: () => proxyBalance }, () => {
			seedStatusLoads += 1
		})
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createForkedVaultProps({ forkMigrationReadClient })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const stagedReason = 'Pool-held REP for the Yes universe is already staged and moves into the child pool during vault migration.'
		await waitFor(() => expect(getTransactionButtonState(document.body, 'Migrate pool to Yes universe').reason).toBe(stagedReason))
		const bodyText = document.body.textContent ?? ''
		expect(bodyText).not.toContain('already been migrated')
		expect(bodyText.split(stagedReason)).toHaveLength(2)
		expect(getTransactionButtonState(document.body, 'Migrate vault to Yes').disabled).toBe(false)

		// The vault migration sweeps the staged REP into a child pool the pool list has not loaded yet, so the refresh reads neither balance.
		proxyBalance = 0n
		const seedStatusLoadsBeforeRefresh = seedStatusLoads
		await act(() => {
			render(h(ForkAuctionSection, createForkedVaultProps({ forkAuctionResult: { action: 'migrateVault', hash: `0x${'2'.repeat(64)}`, securityPoolAddress: PARENT_POOL_ADDRESS, universeId: 1n }, forkMigrationReadClient })), renderedComponent.container)
		})
		await waitFor(() => expect(seedStatusLoads).toBeGreaterThan(seedStatusLoadsBeforeRefresh))
		await new Promise(resolve => setTimeout(resolve, 10))
		await waitFor(() => expect(getTransactionButtonState(document.body, 'Migrate vault to Yes').reason).toBe('Vault migration is already complete for this wallet.'))
		expect(getTransactionButtonState(document.body, 'Migrate pool to Yes universe')).toEqual({ disabled: true, reason: stagedReason })
		expect(document.body.textContent).not.toContain('before moving vault balances')
		expect(document.body.textContent).not.toContain('Already migrated')
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
								disputeStakedAttoRep: 0n,
								vaultAttoRepBacking: 20n,
								underwritingLimitAttoEth: 3n,
								claimableFeesAttoEth: 0n,
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
		const button = documentQueries.getByRole('button', { name: 'Migrate vault to Yes' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected vault migration action button')
		expect(button.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Migrate vault to Yes').reason).toBe('Migration window has closed for this parent pool.')
		expect(documentQueries.getByText('Moves all your vault REP and underwriting commitments to the Yes universe. This can’t be undone or split across outcomes.')).not.toBeNull()
		expect(document.body.textContent).not.toContain('migration power')
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
										amountAttoRep: 12n,
										cumulativeAmountAttoRep: 6n,
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
		const button = documentQueries.getByRole('button', { name: 'Settle selected Yes parent deposits' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected fork-carried settlement action button')
		expect(button.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Settle selected Yes parent deposits').reason).toBe('Winning parent deposits can be settled after this child pool finalizes.')
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
										amountAttoRep: 12n,
										cumulativeAmountAttoRep: 6n,
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
		const button = documentQueries.getByRole('button', { name: 'Settle selected Yes parent deposits' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected fork-carried settlement action button')
		expect(button.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Settle selected Yes parent deposits').reason).toBe('Winning parent deposits can be settled after this child pool finalizes.')
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

	test('shows the current child pool auction outcome as fixed text instead of a selector or a link to itself', async () => {
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
		expect(documentQueries.queryByRole('link', { name: 'Child pool' })).toBeNull()
		expect(document.body.querySelector('.fork-workflow-outcome-selector-row')).toBeNull()
		expect(document.body.querySelector('.fork-workflow-outcome-selector')?.textContent).toBe('Outcome: Yes')
		expect(documentQueries.queryByText('Security pool for Yes universe does not exist.')).toBeNull()
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
		const statusHeading = documentQueries.getByRole('heading', { name: 'Truth auction status' })
		const statusHeader = statusHeading.closest('.section-block-header')
		if (!(statusHeader instanceof HTMLElement)) throw new Error('Expected truth auction status header')
		expect(statusHeader.querySelector('.section-block-badge .badge')?.textContent?.trim()).toBe('Started')
		expect(documentQueries.getByText('1970-01-01 00:00:10 UTC')).not.toBeNull()
		expect(documentQueries.queryByText('Inactive')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Start truth auction' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Start truth auction' })).toBeNull()
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
							accumulatedBidAttoEth: 0n,
							auctionEndsAt: 604_801n,
							clearingPrice: 1n,
							clearingTick: 0n,
							bidAtClearingTickAttoEth: 0n,
							attoEthRaiseCap: 1n,
							attoEthRaised: 0n,
							finalized: false,
							hitCap: false,
							maxAttoRepBeingSold: 1n,
							minBidSizeAttoEth: 1n,
							attoRepPurchasableAtBid: undefined,
							timeRemaining: 604_796n,
							totalAttoRepPurchased: 0n,
							underfunded: false,
							finalizationPreview: { attoEthRaised: 0n, attoRepSold: 0n },
							underfundedThreshold: undefined,
							underfundedWinningAttoEth: 0n,
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
		expect(documentQueries.getByText('Started')).not.toBeNull()
		expect(documentQueries.queryByText('Starts')).toBeNull()
		expect(documentQueries.getByText('1970-01-01 00:00:01 UTC')).not.toBeNull()
		expect(documentQueries.getByText('Ends')).not.toBeNull()
		expect(documentQueries.getByText('1970-01-08 00:00:01 UTC')).not.toBeNull()
		expect(documentQueries.getByText('(in 6d 23h 59m)')).not.toBeNull()
		const truthAuctionHeading = documentQueries.getByRole('heading', { name: 'Truth auction' })
		const truthAuctionCard = truthAuctionHeading.closest('.section-block')
		if (!(truthAuctionCard instanceof HTMLElement)) throw new Error('Expected truth auction summary card')
		expect(truthAuctionCard.querySelector('.section-block-badge .badge')?.textContent?.trim()).toBe('Open')
		expect(truthAuctionCard.querySelector('.fork-workflow-summary')).not.toBeNull()
		expect(within(truthAuctionCard).queryByText('Pending refund')).toBeNull()
		expect(within(truthAuctionCard).getByText('The ETH target has not been reached, so there is no clearing price yet. Once it is reached, a single clearing price decides which bids win.')).not.toBeNull()
	})

	test('keeps refund withdrawal disabled while loading, then shows the credited amount beside an enabled action', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000aa')
		const currentChildPool = createChildPool({
			securityPoolAddress: getAddress('0x00000000000000000000000000000000000000f7'),
			systemState: 'operational',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const pendingRefund = createDeferred<bigint>()
		const onWithdrawAuctionRefund = mock(() => undefined)
		const truthAuctionReadClient: Pick<ReadClient, 'readContract'> = {
			readContract: mock(async request => {
				if (request.functionName === 'pendingEthRefundsAttoEth') return await pendingRefund.promise
				if (request.functionName === 'activeTickCount' || request.functionName === 'getBidderBidCount') return 0n
				throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}) as ReadClient['readContract'],
		}
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'settlement',
					forkAuctionDetails: createFinalizedTruthAuctionDetails(currentChildPool),
					onWithdrawAuctionRefund,
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'settlement',
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const refundHeading = documentQueries.getByRole('heading', { name: 'Refund withdrawal' })
		const refundSection = refundHeading.closest('.section-block')
		if (!(refundSection instanceof HTMLElement)) throw new Error('Expected refund withdrawal section')
		const refundQueries = within(refundSection)
		const withdrawButton = refundQueries.getByRole('button', { name: 'Withdraw refund' })
		expect(withdrawButton.hasAttribute('disabled')).toBe(true)
		expect(refundQueries.getByText('Loading pending refund…')).not.toBeNull()

		pendingRefund.resolve(5n * 10n ** 18n)
		await waitFor(() => {
			expect(withdrawButton.hasAttribute('disabled')).toBe(false)
			expect(refundSection.textContent).toContain('5.00 ETH')
		})
		fireEvent.click(withdrawButton)
		expect(onWithdrawAuctionRefund).toHaveBeenCalledWith(currentChildPool.securityPoolAddress, currentChildPool.universeId)
	})

	test('shows pending-refund read failure recovery and retries before enabling withdrawal', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000aa')
		const currentChildPool = createChildPool({
			securityPoolAddress: getAddress('0x00000000000000000000000000000000000000f7'),
			systemState: 'operational',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		let pendingRefundCalls = 0
		const truthAuctionReadClient: Pick<ReadClient, 'readContract'> = {
			readContract: mock(async request => {
				if (request.functionName === 'pendingEthRefundsAttoEth') {
					pendingRefundCalls += 1
					if (pendingRefundCalls === 1) throw new Error('Refund RPC unavailable')
					return 2n * 10n ** 18n
				}
				if (request.functionName === 'activeTickCount' || request.functionName === 'getBidderBidCount') return 0n
				throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}) as ReadClient['readContract'],
		}
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'settlement',
					forkAuctionDetails: createFinalizedTruthAuctionDetails(currentChildPool),
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'settlement',
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => expect(documentQueries.getByText('Failed to load the pending refund balance.')).not.toBeNull())
		const withdrawButton = documentQueries.getByRole('button', { name: 'Withdraw refund' })
		expect(withdrawButton.hasAttribute('disabled')).toBe(true)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry pending refund' }))
		await waitFor(() => {
			expect(pendingRefundCalls).toBe(2)
			expect(withdrawButton.hasAttribute('disabled')).toBe(false)
			expect(documentQueries.queryByText('Failed to load the pending refund balance.')).toBeNull()
		})
	})

	test('keeps zero-credit withdrawal disabled', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000aa')
		const currentChildPool = createChildPool({
			securityPoolAddress: getAddress('0x00000000000000000000000000000000000000f7'),
			systemState: 'operational',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const createTruthAuctionReadClient = (pendingRefundAttoEth: bigint): Pick<ReadClient, 'readContract'> => ({
			readContract: mock(async request => {
				if (request.functionName === 'pendingEthRefundsAttoEth') return pendingRefundAttoEth
				if (request.functionName === 'activeTickCount' || request.functionName === 'getBidderBidCount') return 0n
				throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}) as ReadClient['readContract'],
		})
		const commonProps = {
			accountState: createAccountState({ address: walletAddress }),
			currentStageView: 'settlement' as const,
			forkAuctionDetails: createFinalizedTruthAuctionDetails(currentChildPool),
			previewPool: currentChildPool,
			securityPools: [currentChildPool],
			selectedStageView: 'settlement' as const,
		}
		const zeroRendered = await renderIntoDocument(h(ForkAuctionSection, createProps({ ...commonProps, truthAuctionReadClient: createTruthAuctionReadClient(0n) })))
		await waitFor(() => {
			const zeroButton = within(document.body).getByRole('button', { name: 'Withdraw refund' })
			expect(zeroButton.hasAttribute('disabled')).toBe(true)
			expect(getTransactionButtonState(document.body, 'Withdraw refund').reason).toBe('No credited refund is available to withdraw.')
		})
		cleanupRenderedComponent = zeroRendered.cleanup
	})

	test('marks an in-progress refund withdrawal pending', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000aa')
		const currentChildPool = createChildPool({
			securityPoolAddress: getAddress('0x00000000000000000000000000000000000000f7'),
			systemState: 'operational',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const truthAuctionReadClient: Pick<ReadClient, 'readContract'> = {
			readContract: mock(async request => {
				if (request.functionName === 'pendingEthRefundsAttoEth') return 5n * 10n ** 18n
				if (request.functionName === 'activeTickCount' || request.functionName === 'getBidderBidCount') return 0n
				throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}) as ReadClient['readContract'],
		}
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: walletAddress }),
					currentStageView: 'settlement',
					forkAuctionActiveAction: 'withdrawAuctionRefund',
					forkAuctionDetails: createFinalizedTruthAuctionDetails(currentChildPool),
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'settlement',
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		await waitFor(() => {
			const pendingButton = within(document.body).getByRole('button', { name: 'Withdrawing refund…' })
			expect(pendingButton.hasAttribute('disabled')).toBe(true)
			expect(pendingButton.getAttribute('aria-busy')).toBe('true')
			expect(pendingButton.textContent).toContain('Withdrawing refund…')
		})
	})

	test('keeps the submit bid form before the current auction bids', async () => {
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
							accumulatedBidAttoEth: 0n,
							auctionEndsAt: 604_801n,
							clearingPrice: 1n,
							clearingTick: 0n,
							bidAtClearingTickAttoEth: 0n,
							attoEthRaiseCap: 1n,
							attoEthRaised: 0n,
							finalized: false,
							hitCap: false,
							maxAttoRepBeingSold: 1n,
							minBidSizeAttoEth: 1n,
							attoRepPurchasableAtBid: undefined,
							timeRemaining: 604_796n,
							totalAttoRepPurchased: 0n,
							underfunded: false,
							finalizationPreview: { attoEthRaised: 0n, attoRepSold: 0n },
							underfundedThreshold: undefined,
							underfundedWinningAttoEth: 0n,
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
		const currentBidsHeading = documentQueries.getByRole('heading', { name: 'Current bids' })
		const myBidsHeading = documentQueries.getByRole('heading', { name: 'My bids' })
		const submitBidHeading = documentQueries.getByRole('heading', { name: 'Submit bid' })
		expect(documentQueries.getByText('Market depth')).not.toBeNull()
		expect(documentQueries.queryByText('Market depth & Bid History')).toBeNull()
		expect(submitBidHeading.compareDocumentPosition(currentBidsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
		expect(myBidsHeading.compareDocumentPosition(currentBidsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
		expect(currentBidsHeading.closest('details')).toBeNull()
	})

	test('shows bid-book failure recovery and repeats the automatic read', async () => {
		const currentChildPool = createChildPool({
			securityPoolAddress: '0x00000000000000000000000000000000000000f7',
			systemState: 'forkTruthAuction',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const retriedTickCount = createDeferred<bigint>()
		let activeTickCountCalls = 0
		const truthAuctionReadClient: Pick<ReadClient, 'readContract'> = {
			readContract: mock(async request => {
				if (request.functionName === 'activeTickCount') {
					activeTickCountCalls += 1
					if (activeTickCountCalls === 1) throw new Error('Bidbook RPC unavailable')
					return await retriedTickCount.promise
				}
				if (request.functionName === 'getActiveTickPage') return []
				throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}) as ReadClient['readContract'],
		}
		const props = createProps({
			accountState: createAccountState({ address: undefined }),
			currentStageView: 'auction',
			currentTimestamp: 5n,
			forkAuctionDetails: createForkAuctionDetails({
				currentTime: 5n,
				parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
				questionOutcome: 'yes',
				securityPoolAddress: currentChildPool.securityPoolAddress,
				systemState: 'forkTruthAuction',
				truthAuction: {
					accumulatedBidAttoEth: 0n,
					auctionEndsAt: 604_801n,
					clearingPrice: 1n,
					clearingTick: 0n,
					bidAtClearingTickAttoEth: 0n,
					attoEthRaiseCap: 1n,
					attoEthRaised: 0n,
					finalized: false,
					hitCap: false,
					maxAttoRepBeingSold: 1n,
					minBidSizeAttoEth: 1n,
					attoRepPurchasableAtBid: undefined,
					timeRemaining: 604_796n,
					totalAttoRepPurchased: 0n,
					underfunded: false,
					finalizationPreview: { attoEthRaised: 0n, attoRepSold: 0n },
					underfundedThreshold: undefined,
					underfundedWinningAttoEth: 0n,
				},
				truthAuctionAddress: currentChildPool.truthAuctionAddress,
				truthAuctionStartedAt: 1n,
				universeId: currentChildPool.universeId,
			}),
			previewPool: currentChildPool,
			securityPools: [currentChildPool],
			selectedStageView: 'auction',
			truthAuctionReadClient,
		})
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, props))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByText('Failed to load truth auction price levels. Reason: Bidbook RPC unavailable.')).not.toBeNull()
		})
		expect(documentQueries.queryByText('This truth auction has no active bids.')).toBeNull()
		fireEvent.click(documentQueries.getByText('Market depth'))
		expect(documentQueries.queryByText('No live price levels are currently active for this auction.')).toBeNull()
		expect(documentQueries.queryByText('No active levels are visible.')).toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry current bids' }))
		await waitFor(() => {
			const retryingButton = documentQueries.getByRole('button', { name: 'Retry current bids' })
			expect(retryingButton.hasAttribute('disabled')).toBe(true)
			expect(retryingButton.textContent).toContain('Retrying truth auction bids…')
			expect(activeTickCountCalls).toBe(2)
		})
	})

	test('makes the auctioned underwriting commitments transfer explicit during bidding', async () => {
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
						ethBalanceAttoEth: 10n ** 18n,
					}),
					currentStageView: 'auction',
					currentTimestamp: 5n,
					forkAuctionDetails: createForkAuctionDetails({
						auctionedUnderwritingLimitAttoEth: 7n,
						currentTime: 5n,
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'yes',
						securityPoolAddress: currentChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuction: {
							accumulatedBidAttoEth: 0n,
							auctionEndsAt: 604_801n,
							clearingPrice: 1n,
							clearingTick: 0n,
							bidAtClearingTickAttoEth: 0n,
							attoEthRaiseCap: 1n,
							attoEthRaised: 0n,
							finalized: false,
							hitCap: false,
							maxAttoRepBeingSold: 1n,
							minBidSizeAttoEth: 1n,
							attoRepPurchasableAtBid: undefined,
							timeRemaining: 604_796n,
							totalAttoRepPurchased: 0n,
							underfunded: false,
							finalizationPreview: { attoEthRaised: 0n, attoRepSold: 0n },
							underfundedThreshold: undefined,
							underfundedWinningAttoEth: 0n,
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
		expect(documentQueries.getByText('Auctioned underwriting commitments')).not.toBeNull()
		expect(documentQueries.getByText('Auctioned underwriting commitments').parentElement?.querySelector('.metric-field-value')?.textContent).toMatch(/ETH/)
		expect(documentQueries.queryByText('Winning bids buy more than REP.')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Transaction review' })).toBeNull()
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
						ethBalanceAttoEth: 10n ** 18n,
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
							accumulatedBidAttoEth: 0n,
							auctionEndsAt: 604_801n,
							clearingPrice: 1n,
							clearingTick: 0n,
							bidAtClearingTickAttoEth: 0n,
							attoEthRaiseCap: 1n,
							attoEthRaised: 0n,
							finalized: false,
							hitCap: false,
							maxAttoRepBeingSold: 1n,
							minBidSizeAttoEth: 1n,
							attoRepPurchasableAtBid: undefined,
							timeRemaining: 604_796n,
							totalAttoRepPurchased: 0n,
							underfunded: false,
							finalizationPreview: { attoEthRaised: 0n, attoRepSold: 0n },
							underfundedThreshold: undefined,
							underfundedWinningAttoEth: 0n,
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
		const submitBidButton = documentQueries.getByRole('button', { name: 'Submit bid' })
		if (!(submitBidButton instanceof HTMLButtonElement)) throw new Error('Expected Submit bid button to be a button element')
		expect(documentQueries.queryByText('You pay')).toBeNull()
		expect(getTransactionButtonState(document.body, 'Submit bid').reason).toStartWith('Bid price must be between ')
		expect(submitBidButton.disabled).toBe(true)
	})

	const createLiveAuctionProps = (accountState: AccountState) => {
		const currentChildPool = createChildPool({
			securityPoolAddress: '0x00000000000000000000000000000000000000f7',
			systemState: 'forkTruthAuction',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		return createProps({
			accountState,
			currentStageView: 'auction',
			forkAuctionDetails: createForkAuctionDetails({
				currentTime: 5n,
				parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
				questionOutcome: 'yes',
				securityPoolAddress: currentChildPool.securityPoolAddress,
				systemState: 'forkTruthAuction',
				truthAuction: {
					accumulatedBidAttoEth: 0n,
					auctionEndsAt: 604_801n,
					clearingPrice: 1n,
					clearingTick: 0n,
					bidAtClearingTickAttoEth: 0n,
					attoEthRaiseCap: 1n,
					attoEthRaised: 0n,
					finalized: false,
					hitCap: false,
					maxAttoRepBeingSold: 1n,
					minBidSizeAttoEth: 1n,
					attoRepPurchasableAtBid: undefined,
					timeRemaining: 604_796n,
					totalAttoRepPurchased: 0n,
					underfunded: false,
					finalizationPreview: { attoEthRaised: 0n, attoRepSold: 0n },
					underfundedThreshold: 0n,
					underfundedWinningAttoEth: 0n,
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
		})
	}

	// The live-auction form bids 1 ETH at 1 ETH per REP, so the submit action names both.
	const LIVE_AUCTION_BID_LABEL = 'Bid 1\u00a0ETH at 1\u00a0ETH per REP'

	test('shows the tick price a bid is submitted at and offers to round it up', async () => {
		const onForkAuctionFormChange = mock((_update: Partial<ForkAuctionSectionProps['forkAuctionForm']>) => undefined)
		const props = createLiveAuctionProps(createAccountState({ ethBalanceAttoEth: 2n * 10n ** 18n }))
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, { ...props, forkAuctionForm: { ...props.forkAuctionForm, submitBidPrice: '1.00005' }, onForkAuctionFormChange }))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		// 1.00005 sits between the 1 and next valid tick prices, so the bid snaps down to 1.
		expect(document.body.textContent).toContain('Will be submitted at 1\u00a0ETH per REP (nearest valid price below).')
		expect(documentQueries.getByRole('button', { name: LIVE_AUCTION_BID_LABEL })).not.toBeNull()
		const roundUpPrice = formatTruthAuctionTickPriceInput(1n)
		fireEvent.click(documentQueries.getByRole('button', { name: `Round up to ${roundUpPrice}` }))
		expect(onForkAuctionFormChange).toHaveBeenCalledWith({ submitBidPrice: roundUpPrice })
	})

	test('shows the bid balance and minimum and fills Max below a gas reserve', async () => {
		const onForkAuctionFormChange = mock((_update: Partial<ForkAuctionSectionProps['forkAuctionForm']>) => undefined)
		const balanceAttoEth = 999_999_989_980_999_999_998_676_937_240n
		const props = createLiveAuctionProps(createAccountState({ ethBalanceAttoEth: balanceAttoEth }))
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, { ...props, onForkAuctionFormChange }))
		cleanupRenderedComponent = renderedComponent.cleanup

		// The hint rounds like other amounts, rounding the balance down, and keeps exact values in the titles.
		expect(document.body.textContent).toContain('Available: ≈ 999\u00a0999\u00a0989\u00a0980.99 ETH · Min bid 0.0000000000000000010 ETH · Max keeps 0.010 ETH for gas')
		expect(document.body.querySelector(`[title="${formatCurrencyBalance(balanceAttoEth)} ETH"]`)).not.toBeNull()
		// An exact tick price needs no rounding notice.
		expect(document.body.textContent).not.toContain('Will be submitted at')
		// Submitting the bid is the form's primary action.
		expect(within(document.body).getByRole('button', { name: LIVE_AUCTION_BID_LABEL }).classList.contains('primary')).toBe(true)
		fireEvent.click(within(document.body).getByRole('button', { name: 'Max' }))
		expect(onForkAuctionFormChange).toHaveBeenCalledWith({ submitBidAmount: formatCurrencyInputBalance(balanceAttoEth - 10n ** 16n) })
	})

	test('keeps fork-auction actions disabled off Sepolia and shows switch-network recovery', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createLiveAuctionProps(createAccountState({ chainId: '0x1', ethBalanceAttoEth: 10n ** 18n }))))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const submitBidButton = documentQueries.getByRole('button', { name: LIVE_AUCTION_BID_LABEL })
		if (!(submitBidButton instanceof HTMLButtonElement)) throw new Error('Expected Submit bid button to be a button element')
		expect(submitBidButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, LIVE_AUCTION_BID_LABEL).reason).toBe('Switch to Sepolia.')
		expect(document.body.textContent?.includes('Switch to Sepolia')).toBe(true)
	})

	for (const [accountState, fixLabel] of [
		[createAccountState({ address: undefined, ethBalanceAttoEth: 10n ** 18n }), 'Connect wallet'],
		[createAccountState({ chainId: '0x1', ethBalanceAttoEth: 10n ** 18n }), 'Switch to Sepolia'],
	] as const)
		test(`offers the ${fixLabel} fix on fork-auction actions the wallet blocks`, async () => {
			const { calls, walletActions } = createWalletActions()
			const renderedComponent = await renderIntoDocument(h(WalletActionsProvider, { walletActions }, h(ForkAuctionSection, createLiveAuctionProps(accountState))))
			cleanupRenderedComponent = renderedComponent.cleanup
			const fix = expectWalletFixDescribesAction(document.body, LIVE_AUCTION_BID_LABEL, fixLabel)
			expect(document.body.textContent).not.toContain('Connect a wallet before using fork and auction actions.')
			fireEvent.click(fix)
			expect(calls).toEqual([fixLabel === 'Connect wallet' ? 'connect' : 'switch'])
		})

	test('keeps fork-auction downstream blocker copy hidden off Sepolia', async () => {
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
					accountState: createAccountState({ chainId: '0x1', ethBalanceAttoEth: 10n ** 18n }),
					currentStageView: 'auction',
					forkAuctionDetails: createForkAuctionDetails({
						currentTime: 5n,
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'yes',
						securityPoolAddress: currentChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuction: {
							accumulatedBidAttoEth: 0n,
							auctionEndsAt: 604_801n,
							clearingPrice: 1n,
							clearingTick: 0n,
							bidAtClearingTickAttoEth: 0n,
							attoEthRaiseCap: 1n,
							attoEthRaised: 0n,
							finalized: false,
							hitCap: false,
							maxAttoRepBeingSold: 1n,
							minBidSizeAttoEth: 1n,
							attoRepPurchasableAtBid: undefined,
							timeRemaining: 604_796n,
							totalAttoRepPurchased: 0n,
							underfunded: false,
							finalizationPreview: { attoEthRaised: 0n, attoRepSold: 0n },
							underfundedThreshold: 0n,
							underfundedWinningAttoEth: 0n,
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
		const submitBidButton = documentQueries.getByRole('button', { name: 'Submit bid' })
		if (!(submitBidButton instanceof HTMLButtonElement)) throw new Error('Expected Submit bid button to be a button element')
		expect(submitBidButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Submit bid').reason).toBe('Switch to Sepolia.')
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
						migratedAttoRep: 0n,
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
		const migrationStartedLabel = documentQueries.getByText('Migration started')
		const migrationStartedMetric = migrationStartedLabel.closest('div')
		if (!(migrationStartedMetric instanceof HTMLElement)) throw new Error('Expected migration started metric')
		expect(within(migrationStartedMetric).getByText('1970-01-01 00:00:02 UTC')).not.toBeNull()
		expect(within(migrationStartedMetric).getByText('(less than a minute ago)')).not.toBeNull()
		const migrationHeading = documentQueries.getByRole('heading', { name: 'Migration status' })
		const migrationCard = migrationHeading.closest('.section-block')
		if (!(migrationCard instanceof HTMLElement)) throw new Error('Expected migration summary card')
		expect(migrationCard.querySelector('.fork-workflow-summary')).not.toBeNull()
		expect(within(migrationCard).getByText('REP at fork')).not.toBeNull()
		expect(within(migrationCard).getByText('REP migrated to Yes')).not.toBeNull()
		expect(within(migrationCard).getByText('Settlement collateral')).not.toBeNull()
	})

	test('reports REP migrated into the selected outcome child pool instead of the parent pool own migrated amount', async () => {
		const migratedToYesAttoRep = 2_012_000n * 10n ** 18n
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					forkAuctionDetails: createForkAuctionDetails({ migratedAttoRep: 0n, systemState: 'forkMigration', truthAuctionStartedAt: 0n }),
					securityPools: [createChildPool({ migratedAttoRep: migratedToYesAttoRep, questionOutcome: 'yes', truthAuctionStartedAt: 0n })],
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const migrationCard = within(document.body).getByRole('heading', { name: 'Migration status' }).closest('.section-block')
		if (!(migrationCard instanceof HTMLElement)) throw new Error('Expected migration summary card')
		const migratedMetric = within(migrationCard).getByText('REP migrated to Yes').closest('.fork-workflow-summary-stat-copy')
		if (!(migratedMetric instanceof HTMLElement)) throw new Error('Expected migrated REP metric')
		expect(migratedMetric.textContent).toContain('2\u00a0012\u00a0000.00')
		expect(migratedMetric.textContent).toContain('REP')
	})

	test('reports no migrated REP for an outcome whose child pool does not exist yet', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					forkAuctionDetails: createForkAuctionDetails({ migratedAttoRep: 5n * 10n ** 18n, systemState: 'forkMigration', truthAuctionStartedAt: 0n }),
					forkAuctionForm: createForkAuctionForm({ selectedOutcome: 'no' }),
					securityPools: [createChildPool({ migratedAttoRep: 7n * 10n ** 18n, questionOutcome: 'yes' })],
					selectedStageView: 'migration',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const migrationCard = within(document.body).getByRole('heading', { name: 'Migration status' }).closest('.section-block')
		if (!(migrationCard instanceof HTMLElement)) throw new Error('Expected migration summary card')
		const migratedMetric = within(migrationCard).getByText('REP migrated to No').closest('.fork-workflow-summary-stat-copy')
		expect(migratedMetric?.textContent).toContain('0.00')
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
		expect(documentQueries.getByText('Not started')).not.toBeNull()
	})

	function createLiveClearingAuctionProps({
		currentTimestamp = 5n,
		finalized = false,
		formOverrides = {},
		hitCap = true,
		onForkAuctionFormChange = () => undefined,
		onSelectedStageViewChange = () => undefined,
		selectedStageView = 'auction',
	}: {
		currentTimestamp?: bigint
		finalized?: boolean
		formOverrides?: Partial<ForkAuctionFormState>
		hitCap?: boolean
		onForkAuctionFormChange?: ForkAuctionSectionProps['onForkAuctionFormChange']
		onSelectedStageViewChange?: (stage: 'fork-triggered' | 'migration' | 'auction' | 'settlement') => void
		selectedStageView?: 'auction' | 'settlement'
	}) {
		const currentChildPool = createChildPool({
			securityPoolAddress: '0x00000000000000000000000000000000000000f7',
			systemState: finalized ? 'operational' : 'forkTruthAuction',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f8'),
			truthAuctionStartedAt: 1n,
		})
		const clearingTick = 10n
		const truthAuction: TruthAuctionMetrics = {
			accumulatedBidAttoEth: 5n * 10n ** 18n,
			auctionEndsAt: 604_801n,
			clearingPrice: getTruthAuctionPriceAtTick(clearingTick),
			clearingTick,
			bidAtClearingTickAttoEth: 5n * 10n ** 18n,
			attoEthRaiseCap: 5n * 10n ** 18n,
			attoEthRaised: 5n * 10n ** 18n,
			finalized,
			hitCap,
			maxAttoRepBeingSold: 100n * 10n ** 18n,
			minBidSizeAttoEth: 1n,
			attoRepPurchasableAtBid: undefined,
			timeRemaining: currentTimestamp >= 604_801n ? 0n : 604_801n - currentTimestamp,
			totalAttoRepPurchased: 4n * 10n ** 18n,
			underfunded: false,
			finalizationPreview: { attoEthRaised: 5n * 10n ** 18n, attoRepSold: 4n * 10n ** 18n },
			underfundedThreshold: undefined,
			underfundedWinningAttoEth: 0n,
		}
		const truthAuctionReadClient: Pick<ReadClient, 'readContract'> = {
			readContract: mock(async request => {
				switch (request.functionName) {
					case 'activeTickCount':
						return 1n
					case 'getActiveTickPage':
						return [{ active: true, currentTotalBidAttoEth: 5n * 10n ** 18n, price: getTruthAuctionPriceAtTick(clearingTick), submissionCount: 1n, tick: clearingTick }]
					case 'getBidderBidCount':
					case 'getBidCountAtTick':
						return 0n
					case 'getBidderBidPage':
					case 'getBidPageAtTick':
						return []
					default:
						throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
				}
			}) as ReadClient['readContract'],
		}
		return createProps({
			accountState: createAccountState({ address: getAddress('0x00000000000000000000000000000000000000aa'), ethBalanceAttoEth: 10n ** 18n }),
			currentStageView: finalized ? 'settlement' : 'auction',
			currentTimestamp,
			forkAuctionDetails: createForkAuctionDetails({
				currentTime: currentTimestamp,
				parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
				questionOutcome: 'yes',
				securityPoolAddress: currentChildPool.securityPoolAddress,
				systemState: finalized ? 'operational' : 'forkTruthAuction',
				truthAuction,
				truthAuctionAddress: currentChildPool.truthAuctionAddress,
				truthAuctionStartedAt: 1n,
				universeId: currentChildPool.universeId,
			}),
			forkAuctionForm: createForkAuctionForm({ securityPoolAddress: currentChildPool.securityPoolAddress, ...formOverrides }),
			onForkAuctionFormChange,
			onSelectedStageViewChange,
			previewPool: currentChildPool,
			securityPools: [currentChildPool],
			selectedStageView,
			truthAuctionReadClient,
		})
	}

	test('keeps the ETH and REP summary constant when loading more price levels', async () => {
		const unit = 10n ** 18n
		const props = createLiveClearingAuctionProps({})
		const auction = props.forkAuctionDetails?.truthAuction
		if (auction === undefined || props.forkAuctionDetails === undefined) throw new Error('Expected live auction details')
		const levels = Array.from({ length: 26 }, (_, index) => ({ active: true, currentTotalBidAttoEth: unit, price: getTruthAuctionPriceAtTick(BigInt(26 - index)), submissionCount: 0n, tick: BigInt(26 - index) }))
		const truthAuctionReadClient = createMockReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 26n
			if (request.functionName === 'getActiveTickPage') {
				const offset = request.args?.[0]
				const count = request.args?.[1]
				if (typeof offset !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected pagination offset and count')
				return levels.slice(Number(offset), Number(offset + count))
			}
			if (request.functionName === 'getBidderBidCount' || request.functionName === 'getBidCountAtTick') return 0n
			if (request.functionName === 'getBidderBidPage' || request.functionName === 'getBidPageAtTick') return []
			throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
		})
		const rendered = await renderIntoDocument(
			h(ForkAuctionSection, {
				...props,
				forkAuctionDetails: {
					...props.forkAuctionDetails,
					truthAuction: { ...auction, attoEthRaiseCap: 26n * unit, bidAtClearingTickAttoEth: 0n, clearingTick: 0n, clearingPrice: unit, finalizationPreview: { attoEthRaised: 26n * unit, attoRepSold: 26n * unit } },
				},
				truthAuctionReadClient,
			}),
		)
		cleanupRenderedComponent = rendered.cleanup
		const assertSummary = () => {
			const totals = Array.from(document.body.querySelectorAll('.truth-auction-progress-copy strong .currency-value'), node => node.getAttribute('title'))
			expect(totals).toEqual([`${formatCurrencyBalance(26n * unit)} ETH`, `${formatCurrencyBalance(26n * unit)} ETH`, `${formatCurrencyBalance(26n * unit)} REP`, `${formatCurrencyBalance(100n * unit)} REP`])
		}
		await waitFor(() => expect(document.body.querySelectorAll('.truth-auction-ladder-row')).toHaveLength(25))
		assertSummary()
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Show more price levels' })))
		await waitFor(() => expect(document.body.querySelectorAll('.truth-auction-ladder-row')).toHaveLength(26))
		assertSummary()
	})

	test('warns that a bid below the live clearing price loses and offers the lowest winning price', async () => {
		const formChanges: Array<Partial<ForkAuctionFormState>> = []
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createLiveClearingAuctionProps({
					formOverrides: { submitBidAmount: '0.1', submitBidPrice: '0.5' },
					onForkAuctionFormChange: update => {
						formChanges.push(update)
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText(/^Current clearing price:/)).not.toBeNull()
		expect(documentQueries.getByText(/This price is below the current clearing price, so the bid would lose and only be refunded\./)).not.toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: /^Use lowest winning price/ }))
		expect(formChanges).toContainEqual({ submitBidPrice: formatTruthAuctionTickPriceInput(11n) })
	})

	test('does not warn when the bid price is above the live clearing price', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createLiveClearingAuctionProps({ formOverrides: { submitBidAmount: '0.1', submitBidPrice: formatCurrencyInputBalance(getTruthAuctionPriceAtTick(11n)) } })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText(/below the current clearing price/)).toBeNull()
		expect(documentQueries.queryByText(/This price equals the clearing price/)).toBeNull()
	})

	test('fills the bid price when a price ladder row is selected', async () => {
		const formChanges: Array<Partial<ForkAuctionFormState>> = []
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createLiveClearingAuctionProps({
					onForkAuctionFormChange: update => {
						formChanges.push(update)
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Market depth').closest('details')?.open).toBe(true)
		await waitFor(() => {
			expect(document.body.querySelector('.truth-auction-ladder-row')).not.toBeNull()
		})
		const ladderRow = document.body.querySelector('.truth-auction-ladder-row')
		if (!(ladderRow instanceof HTMLElement)) throw new Error('Expected a price ladder row')
		fireEvent.click(ladderRow)
		expect(formChanges).toContainEqual({ submitBidPrice: formatTruthAuctionTickPriceInput(10n) })
	})

	test('keeps the auction open while blocking bids within the inclusion reserve', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createLiveClearingAuctionProps({ currentTimestamp: 604_800n })))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const submitBid = documentQueries.getByRole('button', { name: 'Submit bid' })
		expect(submitBid.hasAttribute('disabled')).toBe(true)
		expect(documentQueries.getByText('Truth auction ends too soon to submit a bid.')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Submit bid' })).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Finalize truth auction' })).toBeNull()
		expect(documentQueries.queryByText('Ended')).toBeNull()
	})

	test('replaces the bid form with the finalize step once bidding has ended', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createLiveClearingAuctionProps({ currentTimestamp: 604_900n })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Truth auction has ended')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Finalize truth auction' })).not.toBeNull()
		expect(documentQueries.getByText('Ended')).not.toBeNull()
		expect(documentQueries.queryByText('Higher bids now raise the clearing price, so less REP is sold.')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Submit bid' })).toBeNull()
		expect(documentQueries.queryByText('Market depth')).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'My bids' })).not.toBeNull()
	})

	test('points a finalized auction to the settlement stage', async () => {
		const stageChanges: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createLiveClearingAuctionProps({
					currentTimestamp: 604_900n,
					finalized: true,
					onSelectedStageViewChange: stage => {
						stageChanges.push(stage)
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Open settlement' }))
		expect(stageChanges).toEqual(['settlement'])
	})

	test('drops the settle-bids prompt when the wallet has nothing left to settle', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createLiveClearingAuctionProps({ currentTimestamp: 604_900n, finalized: true, selectedStageView: 'settlement' })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByText('No bids from this wallet were found for this truth auction.')).not.toBeNull()
		})
		expect(documentQueries.queryByRole('heading', { name: 'Settle selected bids' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Refund withdrawal' })).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Open settlement' })).toBeNull()
	})

	test('shows the submitted bid price as REP per ETH before the ETH target is reached', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createLiveClearingAuctionProps({ formOverrides: { submitBidAmount: '0.1', submitBidPrice: '2' }, hitCap: false })))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent).not.toContain('Current clearing price:')
		expect(document.body.textContent).toContain('(\u2248\u00a00.5000\u00a0REP per ETH)')
	})

	test('fixes the outcome to a No child pool own auction even when the form still holds Yes', async () => {
		const noChildPool = createChildPool({
			forkOutcome: 'no',
			questionOutcome: 'no',
			securityPoolAddress: '0x00000000000000000000000000000000000000f9',
			systemState: 'forkTruthAuction',
			truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000fa'),
			truthAuctionStartedAt: 1n,
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					forkAuctionDetails: createForkAuctionDetails({
						forkOutcome: 'no',
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'no',
						securityPoolAddress: noChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuctionAddress: noChildPool.truthAuctionAddress,
						truthAuctionStartedAt: 1n,
						universeId: noChildPool.universeId,
					}),
					forkAuctionForm: createForkAuctionForm({ securityPoolAddress: noChildPool.securityPoolAddress, selectedOutcome: 'yes' }),
					previewPool: noChildPool,
					securityPools: [noChildPool],
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.fork-workflow-outcome-selector')?.textContent).toBe('Outcome: No')
		expect(document.body.querySelector('.fork-workflow-outcome-selector-row')).toBeNull()
		expect(document.body.textContent).not.toContain('universe does not exist')
	})
})
