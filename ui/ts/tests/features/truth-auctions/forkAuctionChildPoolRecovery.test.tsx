/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, waitFor, within } from '../../testUtils/queries'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, type Address, zeroAddress } from '@zoltar/shared/ethereum'
import type { ForkAuctionSectionProps } from '../../../features/types.js'
import type { AccountState, ForkAuctionFormState } from '../../../types/app.js'
import type { ForkAuctionDetails, ListedSecurityPool, MarketDetails } from '../../../types/contracts.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { expectTransactionButtonEnabled } from '../../testUtils/transactionActionButton.js'

const actualContracts = await import('../../../protocol/index.js')
const actualClients = await import('../../../lib/clients.js')

const PARENT_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f0'
const YES_CHILD_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f1'
const YES_TRUTH_AUCTION_ADDRESS: Address = '0x0000000000000000000000000000000000000aa1'
const NO_CHILD_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f2'
const NO_TRUTH_AUCTION_ADDRESS: Address = '0x0000000000000000000000000000000000000aa4'
const STALE_TRUTH_AUCTION_ADDRESS: Address = '0x0000000000000000000000000000000000000aa2'
const REFRESHED_TRUTH_AUCTION_ADDRESS: Address = '0x0000000000000000000000000000000000000aa3'

let recoveredPools: ListedSecurityPool[] = []
let loadAllSecurityPoolsCallOptions: ({ accountAddress?: Address; selectedSecurityPoolAddress?: Address; vaultDetailMode?: 'all' | 'selected' } | undefined)[] = []
let loadForkAuctionDetailsCalls = 0
let childAuctionDetailsFactory: (securityPoolAddress: Address) => ForkAuctionDetails | Promise<ForkAuctionDetails> = securityPoolAddress => createChildAuctionDetails(securityPoolAddress)
let recoveredPoolsFactory: () => ListedSecurityPool[] | Promise<ListedSecurityPool[]> = () => recoveredPools
const loadAllSecurityPoolsMock = mock(async (_client: unknown, options?: { accountAddress?: Address; selectedSecurityPoolAddress?: Address; vaultDetailMode?: 'all' | 'selected' }) => {
	loadAllSecurityPoolsCallOptions.push(options)
	return recoveredPoolsFactory()
})

mock.module('../../../protocol/index.js', () => ({
	...actualContracts,
	loadAllSecurityPools: loadAllSecurityPoolsMock,
	loadForkAuctionDetails: mock(async (_client: unknown, securityPoolAddress: Address) => {
		loadForkAuctionDetailsCalls += 1
		return childAuctionDetailsFactory(securityPoolAddress)
	}),
}))

mock.module('../../../lib/clients.js', () => ({
	...actualClients,
	createConnectedReadClient: mock(() => ({
		readContract: mock(async () => {
			throw new Error('Unexpected readContract call in child-pool recovery test')
		}),
	})),
}))

const { ForkAuctionSection } = await import('../../../features/truth-auctions/components/ForkAuctionSection.js')

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve
	})
	return { promise, resolve }
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

function createParentDetails(): ForkAuctionDetails {
	return {
		auctionedSecurityBondAllowance: 0n,
		claimingAvailable: false,
		completeSetCollateralAmount: 1n,
		currentTime: 250n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: true,
		marketDetails: createMarketDetails(),
		migratedRep: 1n,
		migrationEndsAt: 200n,
		parentSecurityPoolAddress: zeroAddress,
		questionOutcome: 'yes',
		auctionableRepAtFork: 20n,
		securityPoolAddress: PARENT_POOL_ADDRESS,
		systemState: 'forkMigration',
		truthAuction: undefined,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeId: 1n,
	}
}

function createChildPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return {
		completeSetCollateralAmount: 1n,
		currentRetentionRate: 10n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: false,
		initialReportPriorityFeeWeiPerGas: 10_000_000_000n,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		parent: PARENT_POOL_ADDRESS,
		questionOutcome: 'yes',
		questionId: '0x01',
		securityMultiplier: 2n,
		securityPoolAddress: YES_CHILD_POOL_ADDRESS,
		shareTokenSupply: 0n,
		systemState: 'forkMigration',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 0n,
		truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
		truthAuctionStartedAt: 0n,
		universeHasForked: true,
		universeId: 11n,
		vaultCount: 0n,
		vaults: [],
		...overrides,
	}
}

function createChildAuctionDetails(securityPoolAddress: Address): ForkAuctionDetails {
	return {
		auctionedSecurityBondAllowance: 0n,
		claimingAvailable: false,
		completeSetCollateralAmount: 1n,
		currentTime: 250n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: true,
		marketDetails: createMarketDetails(),
		migratedRep: 1n,
		migrationEndsAt: 200n,
		parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
		questionOutcome: 'yes',
		auctionableRepAtFork: 20n,
		securityPoolAddress,
		systemState: 'forkMigration',
		truthAuction: undefined,
		truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
		truthAuctionStartedAt: 0n,
		universeId: 11n,
	}
}

function createStaleChildAuctionDetails(securityPoolAddress: Address): ForkAuctionDetails {
	return {
		...createChildAuctionDetails(securityPoolAddress),
		systemState: 'forkTruthAuction',
		truthAuctionAddress: STALE_TRUTH_AUCTION_ADDRESS,
	}
}

function createStartedChildAuctionDetails(securityPoolAddress: Address, truthAuctionAddress: Address): ForkAuctionDetails {
	return {
		...createChildAuctionDetails(securityPoolAddress),
		systemState: 'forkTruthAuction',
		truthAuction: {
			accumulatedEth: 0n,
			auctionEndsAt: 604_810n,
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
			timeRemaining: 604_800n,
			totalRepPurchased: 0n,
			underfunded: false,
			underfundedThreshold: undefined,
			underfundedWinningEth: 0n,
		},
		truthAuctionAddress,
		truthAuctionStartedAt: 10n,
	}
}

function createProps(overrides: Partial<ForkAuctionSectionProps> = {}): ForkAuctionSectionProps {
	return {
		accountState: createAccountState(),
		auctionDetailsOverride: undefined,
		forkAuctionActiveAction: undefined,
		forkAuctionDetails: createParentDetails(),
		forkAuctionError: undefined,
		forkAuctionForm: createForkAuctionForm(),
		forkAuctionResult: {
			action: 'migrateRepToZoltar',
			hash: '0x00000000000000000000000000000000000000000000000000000000000000f1',
			securityPoolAddress: PARENT_POOL_ADDRESS,
			universeId: 1n,
		},
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
		onStartTruthAuction: () => undefined,
		onSubmitBid: () => undefined,
		onWithdrawForkedEscalation: (_outcome, _parentDepositIndexes) => undefined,
		previewPool: {
			...createChildPool(),
			parent: zeroAddress,
			questionOutcome: 'none',
			securityPoolAddress: PARENT_POOL_ADDRESS,
			truthAuctionAddress: zeroAddress,
			universeId: 1n,
			universeHasForked: false,
		},
		securityPools: [],
		showHeader: true,
		showSecurityPoolAddressInput: true,
		stageView: 'auction',
		...overrides,
	}
}

describe('ForkAuctionSection child pool recovery', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		recoveredPools = []
		loadAllSecurityPoolsCallOptions = []
		loadAllSecurityPoolsMock.mockClear()
		loadForkAuctionDetailsCalls = 0
		childAuctionDetailsFactory = securityPoolAddress => createChildAuctionDetails(securityPoolAddress)
		recoveredPoolsFactory = () => recoveredPools
		cleanupDom = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('recovers a migrated child pool from the registry when the local security-pools list is stale', async () => {
		recoveredPools = [createChildPool()]
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(within(document.body).queryByText('Yes universe does not exist.')).toBeNull()
			expectTransactionButtonEnabled(document.body, 'Start Truth Auction')
		})
		expect(loadAllSecurityPoolsCallOptions).toEqual([
			{
				accountAddress: zeroAddress,
				selectedSecurityPoolAddress: PARENT_POOL_ADDRESS,
				vaultDetailMode: 'selected',
			},
		])
	})

	test('shows child-pool discovery as loading until an empty result is confirmed', async () => {
		const recovery = createDeferred<ListedSecurityPool[]>()
		recoveredPoolsFactory = () => recovery.promise
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			const loadingStatus = within(document.body).getByText('Loading the Yes child pool…')
			expect(loadingStatus.getAttribute('role')).toBe('status')
			expect(loadingStatus.querySelector('.spinner')).not.toBeNull()
			expect(document.body.textContent).not.toContain('does not exist')
		})

		await act(async () => {
			recovery.resolve([])
			await recovery.promise
		})
		await waitFor(() => {
			expect(document.body.textContent).toContain('does not exist')
			expect(within(document.body).queryByText('Loading the Yes child pool…')).toBeNull()
		})
	})

	test('shows recovery guidance and retries when child-universe discovery fails', async () => {
		let recoveryAttempts = 0
		recoveredPoolsFactory = () => {
			recoveryAttempts += 1
			if (recoveryAttempts === 1) throw new Error('Registry RPC unavailable')
			return [createChildPool()]
		}
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		await waitFor(() => {
			expect(documentQueries.getByText('Unable to check whether the Yes child universe exists. Reason: Registry RPC unavailable')).not.toBeNull()
		})
		expect(documentQueries.queryByText('Yes universe does not exist.')).toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Retry child universe' }))
		})
		await waitFor(() => {
			expect(recoveryAttempts).toBe(2)
			expect(documentQueries.queryByText('Unable to check whether the Yes child universe exists. Reason: Registry RPC unavailable')).toBeNull()
			expectTransactionButtonEnabled(document.body, 'Start Truth Auction')
		})
	})

	test('reloads stale recovered child auction details once the child pool is already operational', async () => {
		recoveredPools = [
			createChildPool({
				hasForkActivity: true,
				systemState: 'operational',
				truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
				truthAuctionStartedAt: 10n,
			}),
		]
		childAuctionDetailsFactory = (securityPoolAddress: Address): ForkAuctionDetails => {
			if (loadForkAuctionDetailsCalls === 1) return createStaleChildAuctionDetails(securityPoolAddress)

			return {
				...createChildAuctionDetails(securityPoolAddress),
				systemState: 'operational',
				truthAuctionAddress: REFRESHED_TRUTH_AUCTION_ADDRESS,
				truthAuctionStartedAt: 10n,
			}
		}
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(loadForkAuctionDetailsCalls).toBe(2)
			expect(within(document.body).queryByRole('button', { name: `Copy address ${REFRESHED_TRUTH_AUCTION_ADDRESS}` })).not.toBeNull()
		})

		expect(within(document.body).queryByRole('button', { name: `Copy address ${STALE_TRUTH_AUCTION_ADDRESS}` })).toBeNull()
		expect(within(document.body).queryByRole('button', { name: `Copy address ${YES_TRUTH_AUCTION_ADDRESS}` })).toBeNull()
	})

	test('shows automatic truth auction loading and keeps bid submission disabled while details load', async () => {
		recoveredPools = [
			createChildPool({
				hasForkActivity: true,
				systemState: 'forkTruthAuction',
				truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
				truthAuctionStartedAt: 10n,
			}),
		]
		childAuctionDetailsFactory = () => new Promise(() => undefined)
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(loadForkAuctionDetailsCalls).toBe(1)
			const documentQueries = within(document.body)
			const currentBidsHeading = documentQueries.getByRole('heading', { name: 'Current Bids' })
			const submitBidHeading = documentQueries.getByRole('heading', { name: 'Submit Bid' })
			const submitBidButton = documentQueries.getByRole('button', { name: 'Loading truth auction…' })
			if (!(submitBidButton instanceof HTMLButtonElement)) throw new Error('Expected loading truth auction action to be a button')
			expect(submitBidButton.disabled).toBe(true)
			expect(submitBidHeading.compareDocumentPosition(currentBidsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
			expect(currentBidsHeading.closest('section')?.textContent).toContain('Loading auction bids…')
			const loadingMessages = Array.from(document.body.querySelectorAll('.loading-value'))
			expect(loadingMessages.some(message => message.textContent?.includes('Loading truth auction…') === true)).toBe(true)
			expect(loadingMessages.some(message => message.textContent?.includes('Loading auction bids…') === true)).toBe(true)
			expect(loadingMessages.every(message => message.querySelector('.spinner') !== null)).toBe(true)
		})
		expect(document.body.textContent).not.toContain('Load the truth auction before bidding.')
	})

	test('shows selected-auction detail errors with retry and recovers after a repeated read', async () => {
		recoveredPools = [
			createChildPool({
				hasForkActivity: true,
				systemState: 'forkTruthAuction',
				truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
				truthAuctionStartedAt: 10n,
			}),
		]
		childAuctionDetailsFactory = securityPoolAddress => {
			if (loadForkAuctionDetailsCalls === 1) throw new Error('Child auction RPC unavailable')
			return createChildAuctionDetails(securityPoolAddress)
		}
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByText('Unable to load auction details for the Yes child universe. Reason: Child auction RPC unavailable')).not.toBeNull()
		})
		expect(documentQueries.queryByText('No active prices are currently visible for this auction.')).toBeNull()
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
			await Promise.resolve()
		})
		await waitFor(() => {
			expect(loadForkAuctionDetailsCalls).toBe(2)
			expect(documentQueries.queryByText('Unable to load auction details for the Yes child universe. Reason: Child auction RPC unavailable')).toBeNull()
			expect(documentQueries.queryByRole('button', { name: 'Retrying auction details…' })).toBeNull()
		})
	})

	test('drops stale auction details immediately when switching outcomes', async () => {
		const yesPool = createChildPool({
			hasForkActivity: true,
			systemState: 'forkTruthAuction',
			truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
			truthAuctionStartedAt: 10n,
		})
		const noPool = createChildPool({
			hasForkActivity: true,
			questionOutcome: 'no',
			securityPoolAddress: NO_CHILD_POOL_ADDRESS,
			systemState: 'forkTruthAuction',
			truthAuctionAddress: NO_TRUTH_AUCTION_ADDRESS,
			truthAuctionStartedAt: 10n,
		})
		const noDetails = createDeferred<ForkAuctionDetails>()
		childAuctionDetailsFactory = securityPoolAddress => {
			if (securityPoolAddress === YES_CHILD_POOL_ADDRESS) return createStartedChildAuctionDetails(YES_CHILD_POOL_ADDRESS, YES_TRUTH_AUCTION_ADDRESS)
			return noDetails.promise
		}
		const initialProps = createProps({
			currentStageView: 'auction',
			forkAuctionForm: createForkAuctionForm({ selectedOutcome: 'yes' }),
			securityPools: [yesPool, noPool],
			selectedStageView: 'auction',
		})
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, initialProps))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: `Copy address ${YES_TRUTH_AUCTION_ADDRESS}` })).not.toBeNull()
		})

		await act(() => {
			render(
				h(ForkAuctionSection, {
					...initialProps,
					forkAuctionForm: createForkAuctionForm({ selectedOutcome: 'no' }),
				}),
				renderedComponent.container,
			)
		})
		await waitFor(() => {
			const submitBidButton = documentQueries.getByRole('button', { name: 'Loading truth auction…' })
			expect(submitBidButton.hasAttribute('disabled')).toBe(true)
			expect(documentQueries.queryByRole('button', { name: `Copy address ${YES_TRUTH_AUCTION_ADDRESS}` })).toBeNull()
		})

		await act(async () => {
			noDetails.resolve(createStartedChildAuctionDetails(NO_CHILD_POOL_ADDRESS, NO_TRUTH_AUCTION_ADDRESS))
			await noDetails.promise
		})
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: `Copy address ${NO_TRUTH_AUCTION_ADDRESS}` })).not.toBeNull()
			expect(documentQueries.queryByRole('button', { name: 'Loading truth auction…' })).toBeNull()
		})
	})

	test('drops a recovered child pool immediately while the next outcome is being recovered', async () => {
		const yesPool = createChildPool({
			hasForkActivity: true,
			systemState: 'forkTruthAuction',
			truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
			truthAuctionStartedAt: 10n,
		})
		recoveredPools = [yesPool]
		childAuctionDetailsFactory = securityPoolAddress => createStartedChildAuctionDetails(securityPoolAddress, YES_TRUTH_AUCTION_ADDRESS)
		const initialProps = createProps({
			currentStageView: 'auction',
			forkAuctionForm: createForkAuctionForm({ selectedOutcome: 'yes' }),
			securityPools: [],
			selectedStageView: 'auction',
		})
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, initialProps))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: `Copy address ${YES_TRUTH_AUCTION_ADDRESS}` })).not.toBeNull()
		})

		const noPoolRecovery = createDeferred<ListedSecurityPool[]>()
		recoveredPoolsFactory = () => noPoolRecovery.promise
		await act(() => {
			render(
				h(ForkAuctionSection, {
					...initialProps,
					forkAuctionForm: createForkAuctionForm({ selectedOutcome: 'no' }),
				}),
				renderedComponent.container,
			)
		})

		expect(documentQueries.queryByRole('button', { name: `Copy address ${YES_TRUTH_AUCTION_ADDRESS}` })).toBeNull()
		const submitBidButton = documentQueries.getByRole('button', { name: 'Submit Bid' })
		expect(submitBidButton.hasAttribute('disabled')).toBe(true)

		await act(async () => {
			noPoolRecovery.resolve([])
			await noPoolRecovery.promise
		})
	})

	test('reloads selected child auction details after a selected-pool refresh', async () => {
		recoveredPools = [createChildPool()]
		const secondTruthAuctionAddress: Address = '0x0000000000000000000000000000000000000ab2'
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					selectedPoolRefreshNonce: 0,
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(loadForkAuctionDetailsCalls).toBe(1)
			expect(within(document.body).queryByRole('button', { name: `Copy address ${YES_TRUTH_AUCTION_ADDRESS}` })).not.toBeNull()
		})

		childAuctionDetailsFactory = securityPoolAddress => ({
			...createChildAuctionDetails(securityPoolAddress),
			truthAuctionAddress: securityPoolAddress === YES_CHILD_POOL_ADDRESS ? secondTruthAuctionAddress : YES_TRUTH_AUCTION_ADDRESS,
		})
		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						currentStageView: 'auction',
						selectedPoolRefreshNonce: 1,
						selectedStageView: 'auction',
					}),
				),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(loadForkAuctionDetailsCalls).toBe(2)
			expect(within(document.body).queryByRole('button', { name: `Copy address ${secondTruthAuctionAddress}` })).not.toBeNull()
		})
	})

	test('reloads recovered child pool previews when the connected wallet changes', async () => {
		const firstWallet = getAddress('0x0000000000000000000000000000000000000ba1')
		const secondWallet = getAddress('0x0000000000000000000000000000000000000ba2')
		recoveredPools = [createChildPool()]
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ address: firstWallet }),
					currentStageView: 'auction',
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(loadAllSecurityPoolsCallOptions).toEqual([
				{
					accountAddress: firstWallet,
					selectedSecurityPoolAddress: PARENT_POOL_ADDRESS,
					vaultDetailMode: 'selected',
				},
			])
		})

		await act(() => {
			render(
				h(
					ForkAuctionSection,
					createProps({
						accountState: createAccountState({ address: secondWallet }),
						currentStageView: 'auction',
						selectedStageView: 'auction',
					}),
				),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(loadAllSecurityPoolsCallOptions).toEqual([
				{
					accountAddress: firstWallet,
					selectedSecurityPoolAddress: PARENT_POOL_ADDRESS,
					vaultDetailMode: 'selected',
				},
				{
					accountAddress: secondWallet,
					selectedSecurityPoolAddress: PARENT_POOL_ADDRESS,
					vaultDetailMode: 'selected',
				},
			])
		})
	})
})
