import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
/// <reference types='bun-types' />

import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installModuleMocks } from '@zoltar/ui-core-shared/tests/testUtils/moduleMocks.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { ForkAuctionDetails, ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionSectionProps } from '@zoltar/ui-statoblast-shared/features/types.js'
import { describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { createForkAuctionForm, createForkAuctionSectionProps, createForkChildPool, PARENT_POOL_ADDRESS } from './forkAuctionFixtures.js'

const moduleMocks = installModuleMocks(specifier => import.meta.resolve(specifier))

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
const loadAllSecurityPoolsMock = mock(async (_client: unknown, parent: Address, accountAddress?: Address) => {
	loadAllSecurityPoolsCallOptions.push({ ...(accountAddress === undefined ? {} : { accountAddress }), selectedSecurityPoolAddress: parent, vaultDetailMode: 'selected' })
	return recoveredPoolsFactory()
})

await moduleMocks.mockModule('@zoltar/ui-statoblast-shared/protocol/securityPools.js', () => ({
	loadSecurityPoolChildren: loadAllSecurityPoolsMock,
}))

await moduleMocks.mockModule('@zoltar/ui-statoblast-shared/protocol/forks.js', () => ({
	loadForkAuctionDetails: mock(async (_client: unknown, securityPoolAddress: Address) => {
		loadForkAuctionDetailsCalls += 1
		return childAuctionDetailsFactory(securityPoolAddress)
	}),
}))

await moduleMocks.mockModule('@zoltar/ui-core-shared/wallet/clients.js', () => ({
	createConnectedReadClient: mock(() => ({
		readContract: mock(async () => {
			throw new Error('Unexpected readContract call in child-pool recovery test')
		}),
	})),
}))

const { ForkAuctionSection } = await import('@zoltar/ui-statoblast-shared/features/truth-auctions/components/ForkAuctionSection.js')

function createChildAuctionDetails(securityPoolAddress: Address, overrides: Partial<ForkAuctionDetails> = {}): ForkAuctionDetails {
	return {
		auctionedUnderwritingLimitAttoEth: 0n,
		claimingAvailable: false,
		settlementCollateralAttoEth: 1n,
		currentTime: 250n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: true,
		marketDetails: createMarketDetails(),
		migratedAttoRep: 1n,
		migrationEndsAt: 200n,
		parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
		questionOutcome: 'yes',
		auctionableAttoRepAtFork: 20n,
		securityPoolAddress,
		systemState: 'forkMigration',
		truthAuction: undefined,
		truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
		truthAuctionStartedAt: 0n,
		universeId: 11n,
		...overrides,
	}
}

/** The YES child pool as the registry lists it right after migration, before its truth auction starts. */
function createChildPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return createForkChildPool({
		forkOutcome: 'none',
		hasForkActivity: false,
		migratedAttoRep: 0n,
		securityPoolAddress: YES_CHILD_POOL_ADDRESS,
		settlementCollateralAttoEth: 1n,
		systemState: 'forkMigration',
		truthAuctionAddress: YES_TRUTH_AUCTION_ADDRESS,
		truthAuctionStartedAt: 0n,
		...overrides,
	})
}

/** A child pool whose truth auction has started, so the section loads its auction details. */
function createAuctionChildPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return createChildPool({ hasForkActivity: true, systemState: 'forkTruthAuction', truthAuctionStartedAt: 10n, ...overrides })
}

function createStartedChildAuctionDetails(securityPoolAddress: Address, truthAuctionAddress: Address): ForkAuctionDetails {
	return createChildAuctionDetails(securityPoolAddress, {
		systemState: 'forkTruthAuction',
		truthAuction: {
			accumulatedBidAttoEth: 0n,
			auctionEndsAt: 604_810n,
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
			timeRemaining: 604_800n,
			totalAttoRepPurchased: 0n,
			underfunded: false,
			underfundedThreshold: undefined,
			underfundedWinningAttoEth: 0n,
		},
		truthAuctionAddress,
		truthAuctionStartedAt: 10n,
	})
}

const AUCTION_STAGE_PROPS = { currentStageView: 'auction', selectedStageView: 'auction' } as const

function createProps(overrides: Partial<ForkAuctionSectionProps> = {}): ForkAuctionSectionProps {
	return createForkAuctionSectionProps(createChildAuctionDetails(PARENT_POOL_ADDRESS, { parentSecurityPoolAddress: zeroAddress, truthAuctionAddress: zeroAddress, universeId: 1n }), {
		auctionDetailsOverride: undefined,
		forkAuctionResult: {
			action: 'migrateRepToZoltar',
			hash: '0x00000000000000000000000000000000000000000000000000000000000000f1',
			securityPoolAddress: PARENT_POOL_ADDRESS,
			universeId: 1n,
		},
		previewPool: createChildPool({
			parent: zeroAddress,
			questionOutcome: 'none',
			securityPoolAddress: PARENT_POOL_ADDRESS,
			truthAuctionAddress: zeroAddress,
			universeId: 1n,
			universeHasForked: false,
		}),
		showHeader: true,
		showSecurityPoolAddressInput: true,
		stageView: 'auction',
		...overrides,
	})
}

installTestRouting()
describe('ForkAuctionSection child pool recovery', () => {
	let rendered: Awaited<ReturnType<typeof renderIntoDocument>> | undefined
	let renderedProps: ForkAuctionSectionProps | undefined

	installDomTestLifecycle({
		beforeTest: () => {
			recoveredPools = []
			loadAllSecurityPoolsCallOptions = []
			loadAllSecurityPoolsMock.mockClear()
			loadForkAuctionDetailsCalls = 0
			childAuctionDetailsFactory = securityPoolAddress => createChildAuctionDetails(securityPoolAddress)
			recoveredPoolsFactory = () => recoveredPools
		},
		afterTest: async () => {
			await rendered?.cleanup()
			rendered = undefined
			renderedProps = undefined
		},
	})

	async function renderSection(overrides: Partial<ForkAuctionSectionProps> = {}) {
		renderedProps = createProps(overrides)
		rendered = await renderIntoDocument(h(ForkAuctionSection, renderedProps))
	}

	/** Rerenders with only the given props changed, keeping every other prop's identity. */
	async function rerenderSection(overrides: Partial<ForkAuctionSectionProps>) {
		const container = rendered?.container
		if (container === undefined || renderedProps === undefined) throw new Error('Expected the fork auction section to be rendered')
		const nextProps = { ...renderedProps, ...overrides }
		renderedProps = nextProps
		await act(() => {
			render(h(ForkAuctionSection, nextProps), container)
		})
	}

	/** Flushes pending effects inside `waitFor`, whose polling alone does not run queued Preact updates. */
	async function waitForFlushed(assertion: () => void) {
		await waitFor(async () => {
			await act(async () => {
				await Promise.resolve()
			})
			assertion()
		})
	}

	const expectCopyAddressButton = (address: Address, present: boolean) => {
		const button = within(document.body).queryByRole('button', { name: `Copy address ${address}` })
		if (present) expect(button).not.toBeNull()
		else expect(button).toBeNull()
	}

	const recoveryCall = (accountAddress: Address): (typeof loadAllSecurityPoolsCallOptions)[number] => ({ accountAddress, selectedSecurityPoolAddress: PARENT_POOL_ADDRESS, vaultDetailMode: 'selected' })

	test('recovers a migrated child pool from the registry when the local security-pools list is stale', async () => {
		recoveredPools = [createChildPool()]
		await renderSection()

		await waitFor(() => {
			expect(within(document.body).queryByText('Yes universe does not exist.')).toBeNull()
			expectTransactionButtonEnabled(document.body, 'Start truth auction')
		})
		expect(loadAllSecurityPoolsCallOptions).toEqual([recoveryCall(zeroAddress)])
	})

	test('shows child-pool discovery as loading until an empty result is confirmed', async () => {
		const recovery = createDeferred<ListedSecurityPool[]>()
		recoveredPoolsFactory = () => recovery.promise
		await renderSection(AUCTION_STAGE_PROPS)

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
		await renderSection()
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
			expectTransactionButtonEnabled(document.body, 'Start truth auction')
		})
	})

	test('reloads stale recovered child auction details once the child pool is already operational', async () => {
		recoveredPools = [createAuctionChildPool({ systemState: 'operational' })]
		childAuctionDetailsFactory = (securityPoolAddress: Address): ForkAuctionDetails => {
			if (loadForkAuctionDetailsCalls === 1) return createChildAuctionDetails(securityPoolAddress, { systemState: 'forkTruthAuction', truthAuctionAddress: STALE_TRUTH_AUCTION_ADDRESS })
			return createChildAuctionDetails(securityPoolAddress, { systemState: 'operational', truthAuctionAddress: REFRESHED_TRUTH_AUCTION_ADDRESS, truthAuctionStartedAt: 10n })
		}
		await renderSection(AUCTION_STAGE_PROPS)

		await waitForFlushed(() => {
			expect(loadForkAuctionDetailsCalls).toBe(2)
			expectCopyAddressButton(REFRESHED_TRUTH_AUCTION_ADDRESS, true)
		})

		expectCopyAddressButton(STALE_TRUTH_AUCTION_ADDRESS, false)
		expectCopyAddressButton(YES_TRUTH_AUCTION_ADDRESS, false)
	})

	test('shows automatic truth auction loading and keeps bid submission disabled while details load', async () => {
		recoveredPools = [createAuctionChildPool()]
		childAuctionDetailsFactory = () => new Promise(() => undefined)
		await renderSection(AUCTION_STAGE_PROPS)

		await waitFor(() => {
			expect(loadForkAuctionDetailsCalls).toBe(1)
			const documentQueries = within(document.body)
			const currentBidsHeading = documentQueries.getByRole('heading', { name: 'Current bids' })
			const submitBidHeading = documentQueries.getByRole('heading', { name: 'Submit bid' })
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
		recoveredPools = [createAuctionChildPool()]
		childAuctionDetailsFactory = securityPoolAddress => {
			if (loadForkAuctionDetailsCalls === 1) throw new Error('Child auction RPC unavailable')
			return createChildAuctionDetails(securityPoolAddress)
		}
		await renderSection(AUCTION_STAGE_PROPS)

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByText('Unable to load auction details for the Yes child universe. Reason: Child auction RPC unavailable')).not.toBeNull()
		})
		expect(documentQueries.queryByText('No active prices are currently visible for this auction.')).toBeNull()
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
			await Promise.resolve()
		})
		await waitForFlushed(() => {
			expect(loadForkAuctionDetailsCalls).toBe(2)
			expect(documentQueries.queryByText('Unable to load auction details for the Yes child universe. Reason: Child auction RPC unavailable')).toBeNull()
			expect(documentQueries.queryByRole('button', { name: 'Retrying auction details…' })).toBeNull()
		})
	})

	test('drops stale auction details immediately when switching outcomes', async () => {
		const yesPool = createAuctionChildPool()
		const noPool = createAuctionChildPool({ questionOutcome: 'no', securityPoolAddress: NO_CHILD_POOL_ADDRESS, truthAuctionAddress: NO_TRUTH_AUCTION_ADDRESS })
		const noDetails = createDeferred<ForkAuctionDetails>()
		childAuctionDetailsFactory = securityPoolAddress => {
			if (securityPoolAddress === YES_CHILD_POOL_ADDRESS) return createStartedChildAuctionDetails(YES_CHILD_POOL_ADDRESS, YES_TRUTH_AUCTION_ADDRESS)
			return noDetails.promise
		}
		await renderSection({ ...AUCTION_STAGE_PROPS, forkAuctionForm: createForkAuctionForm({ selectedOutcome: 'yes' }), securityPools: [yesPool, noPool] })

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Submit bid' })).not.toBeNull()
		})

		await rerenderSection({ forkAuctionForm: createForkAuctionForm({ selectedOutcome: 'no' }) })
		await waitFor(() => {
			const submitBidButton = documentQueries.getByRole('button', { name: 'Loading truth auction…' })
			expect(submitBidButton.hasAttribute('disabled')).toBe(true)
		})

		await act(async () => {
			noDetails.resolve(createStartedChildAuctionDetails(NO_CHILD_POOL_ADDRESS, NO_TRUTH_AUCTION_ADDRESS))
			await noDetails.promise
		})
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Submit bid' })).not.toBeNull()
			expect(documentQueries.queryByRole('button', { name: 'Loading truth auction…' })).toBeNull()
		})
	})

	test('drops a recovered child pool immediately while the next outcome is being recovered', async () => {
		recoveredPools = [createAuctionChildPool()]
		childAuctionDetailsFactory = securityPoolAddress => createStartedChildAuctionDetails(securityPoolAddress, YES_TRUTH_AUCTION_ADDRESS)
		await renderSection({ ...AUCTION_STAGE_PROPS, forkAuctionForm: createForkAuctionForm({ selectedOutcome: 'yes' }) })
		const documentQueries = within(document.body)

		await waitForFlushed(() => {
			expectCopyAddressButton(YES_TRUTH_AUCTION_ADDRESS, true)
		})

		const noPoolRecovery = createDeferred<ListedSecurityPool[]>()
		recoveredPoolsFactory = () => noPoolRecovery.promise
		await rerenderSection({ forkAuctionForm: createForkAuctionForm({ selectedOutcome: 'no' }) })

		expectCopyAddressButton(YES_TRUTH_AUCTION_ADDRESS, false)
		const submitBidButton = documentQueries.getByRole('button', { name: 'Submit bid' })
		expect(submitBidButton.hasAttribute('disabled')).toBe(true)

		await act(async () => {
			noPoolRecovery.resolve([])
			await noPoolRecovery.promise
		})
	})

	test('reloads selected child auction details after a selected-pool refresh', async () => {
		recoveredPools = [createChildPool()]
		const secondTruthAuctionAddress: Address = '0x0000000000000000000000000000000000000ab2'
		await renderSection({ ...AUCTION_STAGE_PROPS, selectedPoolRefreshNonce: 0 })

		await waitFor(() => {
			expect(loadForkAuctionDetailsCalls).toBe(1)
			expectCopyAddressButton(YES_TRUTH_AUCTION_ADDRESS, true)
		})

		childAuctionDetailsFactory = securityPoolAddress => createChildAuctionDetails(securityPoolAddress, { truthAuctionAddress: securityPoolAddress === YES_CHILD_POOL_ADDRESS ? secondTruthAuctionAddress : YES_TRUTH_AUCTION_ADDRESS })
		await rerenderSection({ selectedPoolRefreshNonce: 1 })

		await waitForFlushed(() => {
			expect(loadForkAuctionDetailsCalls).toBe(2)
			expectCopyAddressButton(secondTruthAuctionAddress, true)
		})
	})

	test('reloads recovered child pool previews when the connected wallet changes', async () => {
		const firstWallet = getAddress('0x0000000000000000000000000000000000000ba1')
		const secondWallet = getAddress('0x0000000000000000000000000000000000000ba2')
		recoveredPools = [createChildPool()]
		await renderSection({ ...AUCTION_STAGE_PROPS, accountState: createAccountState({ address: firstWallet }) })

		await waitFor(() => {
			expect(loadAllSecurityPoolsCallOptions).toEqual([recoveryCall(firstWallet)])
		})

		await rerenderSection({ accountState: createAccountState({ address: secondWallet }) })

		await waitFor(() => {
			expect(loadAllSecurityPoolsCallOptions).toEqual([recoveryCall(firstWallet), recoveryCall(secondWallet)])
		})
	})
})
