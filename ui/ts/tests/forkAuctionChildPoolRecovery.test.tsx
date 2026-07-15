/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { waitFor, within } from './testUtils/queries'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, type Address, zeroAddress } from '@zoltar/shared/ethereum'
import type { ForkAuctionSectionProps } from '../types/components.js'
import type { AccountState, ForkAuctionFormState } from '../types/app.js'
import type { ForkAuctionDetails, ListedSecurityPool, MarketDetails } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonEnabled } from './testUtils/transactionActionButton.js'

const actualContracts = await import('../contracts.js')
const actualClients = await import('../lib/clients.js')

const PARENT_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f0'
const YES_CHILD_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f1'
const YES_TRUTH_AUCTION_ADDRESS: Address = '0x0000000000000000000000000000000000000aa1'
const STALE_TRUTH_AUCTION_ADDRESS: Address = '0x0000000000000000000000000000000000000aa2'
const REFRESHED_TRUTH_AUCTION_ADDRESS: Address = '0x0000000000000000000000000000000000000aa3'

let recoveredPools: ListedSecurityPool[] = []
let loadAllSecurityPoolsCallOptions: ({ accountAddress?: Address; selectedSecurityPoolAddress?: Address; vaultDetailMode?: 'all' | 'selected' } | undefined)[] = []
let loadForkAuctionDetailsCalls = 0
let childAuctionDetailsFactory = (securityPoolAddress: Address) => createChildAuctionDetails(securityPoolAddress)
const loadAllSecurityPoolsMock = mock(async (_client: unknown, options?: { accountAddress?: Address; selectedSecurityPoolAddress?: Address; vaultDetailMode?: 'all' | 'selected' }) => {
	loadAllSecurityPoolsCallOptions.push(options)
	return recoveredPools
})

mock.module('../contracts.js', () => ({
	...actualContracts,
	loadAllSecurityPools: loadAllSecurityPoolsMock,
	loadForkAuctionDetails: mock(async (_client: unknown, securityPoolAddress: Address) => {
		loadForkAuctionDetailsCalls += 1
		return childAuctionDetailsFactory(securityPoolAddress)
	}),
}))

mock.module('../lib/clients.js', () => ({
	...actualClients,
	createConnectedReadClient: mock(() => ({
		readContract: mock(async () => {
			throw new Error('Unexpected readContract call in child-pool recovery test')
		}),
	})),
}))

const { ForkAuctionSection } = await import('../components/ForkAuctionSection.js')

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
		onMigrateEscalationDeposits: () => undefined,
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
