import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
/// <reference types="bun-types" />

import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import type { ListedSecurityPool, SecurityPoolBrowsePage, SecurityPoolPage } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWalletScopedAccountAddress } from '@zoltar/ui-core-shared/wallet/network.js'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { readFavoriteEntries, resetLocalEntityStoreForTesting, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { securityPoolDownloadStore, toCachedSecurityPool } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/poolBrowse.js'
import { SecurityPoolsOverviewSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolsOverviewSection.js'
import { deriveHasForkActivity } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/forkAuction.js'
import type { SecurityPoolsOverviewSectionProps } from '@zoltar/ui-zoltar-shared/features/types.js'
import type { AccountState } from '@zoltar/ui-zoltar-shared/types/app.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0xaa36a7',
		ethBalanceAttoEth: 0n,
		wethBalanceAttoEth: 0n,
		...overrides,
	}
}

function createSecurityPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	const securityPool: ListedSecurityPool = {
		settlementCollateralAttoEth: 0n,
		currentRetentionRate: 10n,
		feeEligibleCapacityOwnershipAttoRep: 5n * 10n ** 18n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
		lastOraclePrice: 10n ** 18n,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedAttoRep: 0n,
		hasForkContinuationEscalationGame: false,
		ordinaryEscalationGameStarted: false,
		parent: zeroAddress,
		questionOutcome: 'none',
		questionId: '0x01',
		statoblastSecurityMultiplierBps: 20_000n,
		securityPoolAddress: zeroAddress,
		shareTokenSupplyAttoShares: 0n,
		systemState: 'operational',
		totalPoolHeldAttoRep: 0n,
		totalCapacityOwnershipAttoRep: 5n * 10n ** 18n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		hasLoadedVaults: true,
		vaultCount: 0n,
		vaults: [],
		...overrides,
	}
	return {
		...securityPool,
		hasForkActivity: overrides.hasForkActivity ?? deriveHasForkActivity(securityPool),
	}
}

type SecurityPoolsOverviewSectionTestOverrides = Omit<Partial<SecurityPoolsOverviewSectionProps>, 'securityPoolPage'> & {
	securityPoolPage?: SecurityPoolPage | SecurityPoolBrowsePage | undefined
}

function getSecurityPoolPageRequestKey(page: SecurityPoolPage | SecurityPoolBrowsePage): string | undefined {
	return 'requestKey' in page ? page.requestKey : undefined
}

/** Browsing reads the local cache, so a rendered pool list starts from pools already downloaded and (by default) favorited. */
function seedDownloadedPools(pools: readonly ListedSecurityPool[], { favorite = true }: { favorite?: boolean } = {}) {
	if (pools.length === 0) return
	const scope = getLocalEntityScope('statoblast', 'pool')
	securityPoolDownloadStore.record(
		scope,
		pools.map(pool => ({ data: toCachedSecurityPool(pool), id: pool.securityPoolAddress })),
	)
	if (!favorite) return
	for (const pool of [...pools].reverse()) setEntityFavorite(scope, pool.securityPoolAddress, true)
}

function createProps(overrides: SecurityPoolsOverviewSectionTestOverrides = {}): SecurityPoolsOverviewSectionProps {
	const accountState = overrides.accountState ?? createAccountState()
	const defaultPools = [createSecurityPool()]
	const securityPools = overrides.securityPools ?? defaultPools
	const environmentRefreshKey = overrides.environmentRefreshKey ?? 0
	const scopedAccountAddress = getWalletScopedAccountAddress(accountState.address, accountState.chainId)
	const accountRequestKey = scopedAccountAddress?.toLowerCase() ?? 'no-account'
	const defaultPage: SecurityPoolBrowsePage = {
		pageIndex: 0,
		pageSize: 6,
		poolCount: BigInt(securityPools.length),
		pools: securityPools,
		requestKey: `${environmentRefreshKey}:0:6:${accountRequestKey}`,
	}
	const hasSecurityPoolPageOverride = Object.hasOwn(overrides, 'securityPoolPage')
	const overrideSecurityPoolPage = hasSecurityPoolPageOverride ? overrides.securityPoolPage : defaultPage
	const securityPoolPage =
		overrideSecurityPoolPage === undefined
			? undefined
			: {
					...overrideSecurityPoolPage,
					requestKey: getSecurityPoolPageRequestKey(overrideSecurityPoolPage) ?? `${environmentRefreshKey}:${overrideSecurityPoolPage.pageIndex.toString()}:${overrideSecurityPoolPage.pageSize.toString()}:${accountRequestKey}`,
				}
	seedDownloadedPools(securityPools)
	return {
		accountState,
		activeUniverseId: 1n,
		loadingSecurityPoolPage: false,
		onLoadSecurityPoolPage: () => undefined,
		onSelectSecurityPool: () => undefined,
		repPerEthPrice: undefined,
		securityPoolOverviewError: undefined,
		...overrides,
		environmentRefreshKey,
		securityPoolPage,
		securityPools,
	}
}

installTestRouting()
describe('SecurityPoolsOverviewSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			resetLocalEntityStoreForTesting()
		},
		beforeTest: () => {
			resetLocalEntityStoreForTesting()
		},
	})

	test('distinguishes same-title pools and opens the selected address', async () => {
		const first = createSecurityPool()
		const second = createSecurityPool({ securityPoolAddress: getAddress('0x0000000000000000000000000000000000000002'), statoblastSecurityMultiplierBps: 30000n })
		const selected: string[] = []
		cleanupRenderedComponent = (await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [first, second], onSelectSecurityPool: address => selected.push(address) })} />)).cleanup
		const rows = [...document.querySelectorAll('.pool-directory-row')]
		expect(rows).toHaveLength(2)
		for (const [index, pool] of [first, second].entries()) {
			const row = rows[index]
			if (!(row instanceof HTMLElement)) throw new Error('Expected pool row')
			expect(within(row).getByRole('button', { name: 'Copy address ' + pool.securityPoolAddress })).not.toBeNull()
			expect(row.textContent).toContain(index === 0 ? '2×' : '3×')
			expect(row.querySelector('details')?.textContent).toContain('Initial Report Priority Fee')
			const link = within(row).getByRole('link', { name: new RegExp(pool.securityPoolAddress) })
			expect(link.getAttribute('href')).toContain(pool.securityPoolAddress)
			fireEvent.click(link)
		}
		expect(selected).toEqual([first.securityPoolAddress, second.securityPoolAddress])
	})

	function getSecurityPoolCard(headingText: string): HTMLElement {
		const normalizedHeadingText = headingText.trim().replace(/\s+/g, ' ')
		const titleHeading = within(document.body)
			.getAllByRole('heading')
			.find(node => {
				const normalizedNodeText = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
				return normalizedNodeText.includes(normalizedHeadingText)
			})
		if (titleHeading === undefined) {
			throw new Error(`Expected security pool card heading for "${headingText}"`)
		}
		const poolCard = titleHeading.closest('.pool-directory-row')
		if (!(poolCard instanceof HTMLElement)) {
			throw new Error(`Expected security pool card for "${headingText}"`)
		}
		return poolCard
	}

	test('keeps question identifiers in a closed disclosure while linking to the pool', async () => {
		const questionId = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const pool = createSecurityPool({ marketDetails: createMarketDetails({ questionId }), questionId })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const identifier = within(document.body).getByRole('button', { name: `Copy identifier ${questionId}` })
		const disclosure = identifier.closest('details')
		expect(disclosure !== null).toBe(true)
		expect(disclosure?.open).toBe(false)
		expect(
			within(document.body)
				.getByRole('link', { name: /Open pool/ })
				.getAttribute('href'),
		).toContain(pool.securityPoolAddress)
	})

	test('renders oracle-priced ETH minting capacity separately from REP ownership', async () => {
		const pool = createSecurityPool({
			lastOraclePrice: 3n * 10n ** 18n,
			lastOracleSettlementTimestamp: 1n,
			settlementCollateralAttoEth: 5n * 10n ** 18n,
			statoblastSecurityMultiplierBps: 20_000n,
			totalCapacityOwnershipAttoRep: 80n * 10n ** 18n,
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const card = getSecurityPoolCard('Will this resolve?')
		expect((card.textContent ?? '').replace(/\s+/g, ' ')).toContain('/ ≈ 13.33 ETH')
		expect((card.textContent ?? '').replace(/\s+/g, ' ')).not.toContain('/ ≈ 80.00 ETH')
	})

	test('does not price capacity from a never-reported Open Oracle value', async () => {
		const pool = createSecurityPool({ lastOraclePrice: 0n, lastOracleSettlementTimestamp: 0n })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const card = getSecurityPoolCard('Will this resolve?')
		expect((card.textContent ?? '').replace(/\s+/g, ' ')).toContain('Oracle price unavailable')
		expect((card.textContent ?? '').replace(/\s+/g, ' ')).toContain('/ Unavailable')
	})

	test('shows exact small ETH values in browse cards instead of approximate zero', async () => {
		const pool = createSecurityPool({
			lastOraclePrice: 1n,
			settlementCollateralAttoEth: 1_000_000_000_000_000n,
			totalCapacityOwnershipAttoRep: 1n * 10n ** 18n,
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const cardText = (getSecurityPoolCard('Will this resolve?').textContent ?? '').replace(/\s+/g, ' ')
		expect(cardText).toContain('0.001 ETH')
		expect(cardText).not.toContain('≈ 0.00 ETH')
	})

	test('does not present pool-held vault REP backing alone as a pool health gauge when dispute-staked REP changes ordinary coverage', async () => {
		const pool = createSecurityPool({
			statoblastSecurityMultiplierBps: 20_000n,
			totalPoolHeldAttoRep: 16n * 10n ** 18n,
			totalCapacityOwnershipAttoRep: 10n * 10n ** 18n,
			vaultCount: 1n,
			vaults: [
				{
					disputeStakedAttoRep: 4n * 10n ** 18n,
					vaultAttoRepBacking: 16n * 10n ** 18n,
					capacityOwnershipAttoRep: 10n * 10n ** 18n,
					claimableFeesAttoEth: 0n,
					vaultAddress: '0x0000000000000000000000000000000000000100',
				},
			],
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ repPerEthPrice: 10n ** 18n, securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Pool collateralization')).toBeNull()
		expect(documentQueries.queryByText('Below target')).toBeNull()
	})

	test('gives same-titled pool actions distinct accessible names', async () => {
		const firstAddress = '0x0000000000000000000000000000000000000100'
		const secondAddress = '0x0000000000000000000000000000000000000101'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [createSecurityPool({ securityPoolAddress: firstAddress }), createSecurityPool({ securityPoolAddress: secondAddress })],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByRole('link', { name: `Open pool: Will this resolve? (${firstAddress})` })).not.toBeNull()
		expect(within(document.body).getByRole('link', { name: `Open pool: Will this resolve? (${secondAddress})` })).not.toBeNull()
	})

	test('preserves the pool universe when opening a child-universe pool', async () => {
		const pool = createSecurityPool({
			securityPoolAddress: '0x0000000000000000000000000000000000000101',
			universeId: 11n,
		})
		const onSelectSecurityPool = mock((..._args: unknown[]) => undefined)
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ activeUniverseId: 11n, onSelectSecurityPool, securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('link', { name: 'Open pool: Will this resolve? (0x0000000000000000000000000000000000000101)' }))
		})

		expect(onSelectSecurityPool).toHaveBeenCalledWith(pool.securityPoolAddress, 11n)
	})

	test('keeps pool-list load errors inline instead of opening liquidation', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPoolOverviewError: 'Failed to load security pools',
					securityPoolPage: undefined,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('alert').textContent).toContain('Failed to load security pools')
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 0))
		})
		expect(document.body.textContent).not.toContain('Loading security pools')
		expect(documentQueries.queryByRole('dialog', { name: 'Liquidate Vault' })).toBeNull()
	})

	test('shows Finalized as Yes for resolved operational pools', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							questionOutcome: 'yes',
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const badgeTexts = Array.from(document.body.querySelectorAll('.pool-directory-row .badge')).map(element => element.textContent?.trim() ?? '')
		expect(badgeTexts).toContain('Finalized as Yes')
	})

	test('shows Fork Migration for parent pools with child pools even when the loaded parent outcome is resolved', async () => {
		const parentPoolTitle = 'Parent pool'
		const parentPool = createSecurityPool({
			hasForkActivity: false,
			marketDetails: createMarketDetails({ title: 'Parent pool' }),
			questionOutcome: 'yes',
			securityPoolAddress: '0x0000000000000000000000000000000000000100',
			universeHasForked: true,
		})
		const childPool = createSecurityPool({
			marketDetails: createMarketDetails({ title: 'Child pool' }),
			parent: parentPool.securityPoolAddress,
			questionOutcome: 'yes',
			securityPoolAddress: '0x0000000000000000000000000000000000000101',
		})
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [parentPool, childPool],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const parentCard = getSecurityPoolCard(parentPoolTitle)
		const parentCardQueries = within(parentCard)
		expect(parentCardQueries.getByText('Fork Migration')).not.toBeNull()
		expect(parentCardQueries.queryByText('Finalized as Yes')).toBeNull()
	})

	test('shows Fork Migration for pools already in fork migration flow', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							forkOutcome: 'yes',
							migratedAttoRep: 1n,
							systemState: 'poolForked',
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const badgeTexts = Array.from(document.body.querySelectorAll('.pool-directory-row .badge')).map(element => element.textContent?.trim() ?? '')
		expect(badgeTexts).toContain('Fork Migration')
	})

	test('describes Fork Finalized auction-state guidance without implying the truth auction is already complete', async () => {
		const auctionPoolTitle = 'Truth auction pool'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							forkOutcome: 'yes',
							hasForkActivity: true,
							marketDetails: createMarketDetails({ title: auctionPoolTitle }),
							migratedAttoRep: 1n,
							parent: '0x0000000000000000000000000000000000000100',
							systemState: 'forkTruthAuction',
							truthAuctionAddress: '0x0000000000000000000000000000000000000001',
							truthAuctionStartedAt: 10n,
							universeHasForked: true,
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const auctionPoolCard = getSecurityPoolCard(auctionPoolTitle)
		const auctionPoolCardQueries = within(auctionPoolCard)
		expect(auctionPoolCardQueries.queryByText('Migration has moved into the truth-auction phase, where bidding and settlement determine the child-universe recovery path.')).toBeNull()
		expect(auctionPoolCardQueries.queryByText('Migration has moved into the truth-auction phase, where the child universe is finalized.')).toBeNull()
		const truthAuctionBadge = auctionPoolCardQueries.getByText('Truth Auction')
		expect(truthAuctionBadge.getAttribute('aria-label')).toBe('Truth Auction')
		expect(truthAuctionBadge.parentElement?.getAttribute('aria-describedby')).toBeNull()
	})

	test('shows Fork Finalized for child pools with completed fork history', async () => {
		const childPoolTitle = 'Finalized child pool'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							forkOutcome: 'yes',
							hasForkActivity: true,
							marketDetails: createMarketDetails({ title: childPoolTitle }),
							migratedAttoRep: 1n,
							parent: '0x0000000000000000000000000000000000000100',
							systemState: 'operational',
							truthAuctionAddress: '0x0000000000000000000000000000000000000001',
							truthAuctionStartedAt: 10n,
							universeHasForked: true,
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const badgeTexts = Array.from(document.body.querySelectorAll('.pool-directory-row .badge')).map(element => element.textContent?.trim() ?? '')
		expect(badgeTexts).toContain('Fork Finalized')
		const childPoolCard = getSecurityPoolCard(childPoolTitle)
		const childPoolCardQueries = within(childPoolCard)
		const forkFinalizedBadge = childPoolCardQueries.getByText('Fork Finalized')
		expect(forkFinalizedBadge.getAttribute('aria-label')).toBe('Fork Finalized')
		expect(forkFinalizedBadge.parentElement?.getAttribute('aria-describedby')).toBeNull()
		expect(childPoolCardQueries.queryByText('This parent pool has already gone through a fork lifecycle and now acts as a historical reference point.')).toBeNull()
	})

	test('shows Fork Migration instead of Operational for root-universe pools after Zoltar has forked', async () => {
		const rootPoolTitle = 'Forked root-universe pool'

		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							hasForkActivity: false,
							marketDetails: createMarketDetails({ title: 'Forked root-universe pool' }),
							questionOutcome: 'none',
							systemState: 'operational',
							universeHasForked: true,
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const poolCard = getSecurityPoolCard(rootPoolTitle)
		const poolCardQueries = within(poolCard)
		expect(poolCardQueries.getByText('Fork Migration')).not.toBeNull()
		expect(poolCardQueries.queryByText('Operational')).toBeNull()
	})

	test('filters the pool list by the derived Ended state', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Operational pool' }),
							questionOutcome: 'none',
							securityPoolAddress: '0x0000000000000000000000000000000000000001',
						}),
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Ended pool' }),
							questionOutcome: 'yes',
							securityPoolAddress: '0x0000000000000000000000000000000000000002',
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const searchInput = documentQueries.getByLabelText('Search downloaded pools')
		expect(searchInput.getAttribute('placeholder')).toBe('Address, question ID, or text')
		expect(documentQueries.queryByText(/pools? match/)).toBeNull()
		const systemStateSelect = documentQueries.getByLabelText('System State')
		if (!(systemStateSelect instanceof window.HTMLSelectElement)) throw new Error('Expected system state filter')
		systemStateSelect.value = 'ended'
		await act(() => {
			systemStateSelect.dispatchEvent(new window.Event('change', { bubbles: true }))
		})

		expect(documentQueries.queryByText('Operational pool')).toBeNull()
		expect(documentQueries.getAllByText('Ended pool').length).toBeGreaterThan(0)
		expect(documentQueries.getByText('1 of 2 pools matches.')).not.toBeNull()
	})

	test('shows only the aggregate vault count when browse mode has not loaded vault details yet', async () => {
		const deferredPoolTitle = 'Deferred vault pool'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							hasLoadedVaults: false,
							marketDetails: createMarketDetails({ title: 'Deferred vault pool' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000200',
							vaultCount: 2n,
							vaults: [],
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const poolCard = getSecurityPoolCard(deferredPoolTitle)
		const poolCardQueries = within(poolCard)
		expect(poolCardQueries.queryByText('Preview deferred')).toBeNull()
		expect(poolCardQueries.queryByText('2 vaults are registered. Open the pool to load individual vault details.')).toBeNull()
		expect(poolCardQueries.queryByText('Vault preview unavailable.')).toBeNull()
		expect(poolCardQueries.queryByText('No known vaults in this pool.')).toBeNull()
		expect(poolCardQueries.getByText('2 vaults')).not.toBeNull()
		expect(documentQueries.queryByText('Known Vault Registry')).toBeNull()
		expect(documentQueries.queryByRole('option', { name: 'Has known vaults' })).toBeNull()
		expect(documentQueries.queryByRole('option', { name: 'No known vaults' })).toBeNull()
	})

	test('keeps browse pool cards focused on pool-level information', async () => {
		const previewPoolTitle = 'Pool with preview vaults'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							managerAddress: '0x0000000000000000000000000000000000000502',
							marketDetails: createMarketDetails({ title: 'Pool with preview vaults' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000500',
							vaultCount: 5n,
							vaults: [
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									capacityOwnershipAttoRep: 5n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000501',
								},
							],
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const poolCard = getSecurityPoolCard(previewPoolTitle)
		const poolCardQueries = within(poolCard)
		expect(poolCardQueries.queryByRole('link', { name: '0x1' })).toBeNull()
		expect(poolCardQueries.queryByRole('button', { name: 'Copy address 0x0000000000000000000000000000000000000501' })).toBeNull()
		expect(poolCardQueries.queryByRole('button', { name: 'Review liquidation' })).toBeNull()
		expect(poolCard.querySelector('.security-pool-browse-vault-row')).toBeNull()
		const browseSection = poolCard.closest('.section-block')
		if (!(browseSection instanceof HTMLElement)) throw new Error('Expected browse section')
		expect(browseSection.classList.contains('plain')).toBe(true)
		expect(browseSection.classList.contains('surface')).toBe(false)
	})

	test('does not render loader-provided vault previews inside pool cards', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Ordered vault preview pool' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000700',
							vaultCount: 3n,
							vaults: [
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									capacityOwnershipAttoRep: 1n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000701',
								},
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									capacityOwnershipAttoRep: 9n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000702',
								},
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									capacityOwnershipAttoRep: 5n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000703',
								},
							],
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const poolCard = getSecurityPoolCard('Ordered vault preview pool')
		const previewRows = Array.from(poolCard.querySelectorAll('.security-pool-browse-vault-row'))
		expect(previewRows).toHaveLength(0)
		for (const vaultAddress of ['0x0000000000000000000000000000000000000701', '0x0000000000000000000000000000000000000702', '0x0000000000000000000000000000000000000703']) {
			expect(within(poolCard).queryByRole('button', { name: `Copy address ${vaultAddress}` })).toBeNull()
		}
	})

	test('keeps connected-wallet vault details out of browse pool cards', async () => {
		const viewerVaultAddress = '0x0000000000000000000000000000000000000604'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					accountState: createAccountState({ address: viewerVaultAddress }),
					securityPools: [
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Viewer vault preview pool' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000600',
							vaultCount: 6n,
							vaults: [
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									capacityOwnershipAttoRep: 8n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000601',
								},
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									capacityOwnershipAttoRep: 7n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000602',
								},
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									capacityOwnershipAttoRep: 6n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000603',
								},
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									capacityOwnershipAttoRep: 1n,
									claimableFeesAttoEth: 0n,
									vaultAddress: viewerVaultAddress,
								},
							],
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const poolCard = getSecurityPoolCard('Viewer vault preview pool')
		const poolCardQueries = within(poolCard)
		expect(poolCardQueries.queryByRole('button', { name: `Copy address ${viewerVaultAddress}` })).toBeNull()
		expect(poolCard.querySelector('.security-pool-browse-vault-row')).toBeNull()
	})

	function createNumberedPool(index: number, overrides: Partial<ListedSecurityPool> = {}) {
		return createSecurityPool({
			marketDetails: createMarketDetails({ title: `Numbered pool ${index.toString()}` }),
			securityPoolAddress: getAddress(`0x${index.toString(16).padStart(40, '0')}`),
			...overrides,
		})
	}

	function getRenderedPoolTitles() {
		return [...document.querySelectorAll('.pool-directory-row h3')].map(heading => heading.textContent)
	}

	async function selectOption(label: string, value: string) {
		const select = within(document.body).getByLabelText(label)
		if (!(select instanceof window.HTMLSelectElement)) throw new Error(`Expected ${label} select`)
		select.value = value
		await act(() => {
			select.dispatchEvent(new window.Event('change', { bubbles: true }))
		})
	}

	async function typeSearch(value: string) {
		const input = within(document.body).getByLabelText('Search downloaded pools')
		if (!(input instanceof window.HTMLInputElement)) throw new Error('Expected search input')
		input.value = value
		await act(() => {
			input.dispatchEvent(new window.Event('input', { bubbles: true }))
		})
	}

	test('lists favorite pools from the local cache without scanning the chain', async () => {
		const onLoadSecurityPoolPage = mock((..._args: unknown[]) => undefined)
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ onLoadSecurityPoolPage, securityPoolPage: undefined, securityPools: [createNumberedPool(1), createNumberedPool(2)] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getRenderedPoolTitles()).toEqual(['Numbered pool 1', 'Numbered pool 2'])
		expect(within(document.body).getByRole('button', { name: 'Favorites (2)' }).getAttribute('aria-pressed')).toBe('true')
		expect(document.body.textContent).not.toContain('Search this page')
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 0))
		})
		expect(onLoadSecurityPoolPage).not.toHaveBeenCalled()
	})

	test('scans one registry page per request and adds the results to the downloaded pools', async () => {
		const requests: Array<{ pageIndex: number; pageSize: number; requestKey: string }> = []
		const props = createProps({
			onLoadSecurityPoolPage: (pageIndex, pageSize, requestKey) => {
				requests.push({ pageIndex, pageSize, requestKey })
			},
			securityPoolPage: undefined,
			securityPools: [],
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...props} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		expect(documentQueries.getByText('No favorite pools yet')).not.toBeNull()

		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover pools' }))
			await Promise.resolve()
		})
		expect(requests.map(request => [request.pageIndex, request.pageSize])).toEqual([[0, 6]])
		const firstRequest = requests[0]
		if (firstRequest === undefined) throw new Error('Expected a page request')
		const firstPage = Array.from({ length: 6 }, (_, index) => createNumberedPool(index + 1))
		await act(() => {
			render(<SecurityPoolsOverviewSection {...props} securityPoolPage={{ pageIndex: 0, pageSize: 6, poolCount: 8n, pools: firstPage, requestKey: firstRequest.requestKey }} />, renderedComponent.container)
		})

		expect(documentQueries.getByRole('button', { name: 'Downloaded (6)' }).getAttribute('aria-pressed')).toBe('true')
		expect(documentQueries.getByRole('button', { name: 'Favorites (0)' })).not.toBeNull()
		expect(getRenderedPoolTitles()).toHaveLength(6)
		expect(documentQueries.getByText('6 of 8 pools scanned')).not.toBeNull()
		expect(readFavoriteEntries(getLocalEntityScope('statoblast', 'pool'))).toEqual([])

		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover more' }))
			await Promise.resolve()
		})
		const secondRequest = requests[1]
		if (secondRequest === undefined) throw new Error('Expected a second page request')
		expect([secondRequest.pageIndex, secondRequest.pageSize]).toEqual([1, 6])
		await act(() => {
			render(<SecurityPoolsOverviewSection {...props} securityPoolPage={{ pageIndex: 1, pageSize: 6, poolCount: 8n, pools: [createNumberedPool(7), createNumberedPool(8)], requestKey: secondRequest.requestKey }} />, renderedComponent.container)
		})
		expect(getRenderedPoolTitles()).toHaveLength(8)
		expect(documentQueries.queryByText(/pools scanned/)).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Scan again' })).not.toBeNull()
	})

	test('ignores a page that answers a different request', async () => {
		const props = createProps({ securityPoolPage: undefined, securityPools: [] })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...props} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		await act(async () => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Discover pools' }))
			await Promise.resolve()
		})
		await act(() => {
			render(<SecurityPoolsOverviewSection {...props} securityPoolPage={{ pageIndex: 0, pageSize: 6, poolCount: 1n, pools: [createNumberedPool(1)], requestKey: 'stale-request' }} />, renderedComponent.container)
		})
		expect(getRenderedPoolTitles()).toEqual([])
		expect(within(document.body).getByRole('button', { name: 'Downloaded (0)' })).not.toBeNull()
	})

	test('searches every downloaded pool and filters universes before display', async () => {
		const pools = Array.from({ length: 8 }, (_, index) => createNumberedPool(index + 1))
		seedDownloadedPools([createNumberedPool(9, { marketDetails: createMarketDetails({ title: 'Numbered pool 9 elsewhere' }), universeId: 11n })], { favorite: false })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: pools })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Downloaded (9)' }))
		})
		expect(getRenderedPoolTitles()).toHaveLength(8)
		expect(documentQueries.getByText('1 saved in other universes.')).not.toBeNull()

		await typeSearch('numbered pool 8')
		expect(getRenderedPoolTitles()).toEqual(['Numbered pool 8'])
		expect(documentQueries.getByText('1 of 8 pools matches. 1 saved in other universes.')).not.toBeNull()

		await typeSearch(pools[6]?.securityPoolAddress.toUpperCase() ?? '')
		expect(getRenderedPoolTitles()).toEqual(['Numbered pool 7'])
	})

	test('sorts downloaded pools by remaining capacity, end time, and state', async () => {
		const pools = [
			createNumberedPool(1, { marketDetails: createMarketDetails({ endTime: 300n, title: 'Late large' }), questionOutcome: 'yes', settlementCollateralAttoEth: 0n }),
			createNumberedPool(2, { marketDetails: createMarketDetails({ endTime: 100n, title: 'Soon full' }), settlementCollateralAttoEth: 5n * 10n ** 18n }),
			createNumberedPool(3, { marketDetails: createMarketDetails({ endTime: 200n, title: 'Middle half' }), settlementCollateralAttoEth: 2n * 10n ** 18n }),
		]
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ currentTimestamp: 50n, repPerEthPrice: 10n ** 18n, securityPools: pools, uiPriceOracle: 'uniswap' })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(getRenderedPoolTitles()).toEqual(['Late large', 'Soon full', 'Middle half'])

		await selectOption('Sort', 'remainingCapacity')
		expect(getRenderedPoolTitles()).toEqual(['Late large', 'Middle half', 'Soon full'])
		await selectOption('Sort', 'endTime')
		expect(getRenderedPoolTitles()).toEqual(['Soon full', 'Middle half', 'Late large'])
		await selectOption('Sort', 'state')
		expect(getRenderedPoolTitles()).toEqual(['Soon full', 'Middle half', 'Late large'])
	})

	test('shows open interest against capacity with the used share on each row', async () => {
		const pool = createNumberedPool(1, { settlementCollateralAttoEth: 1n * 10n ** 18n, totalCapacityOwnershipAttoRep: 8n * 10n ** 18n })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ repPerEthPrice: 10n ** 18n, securityPools: [pool], uiPriceOracle: 'uniswap' })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const rowText = (document.querySelector('.pool-directory-row .pool-capacity-summary.is-prominent')?.textContent ?? '').replace(/\s+/g, ' ')
		expect(rowText).toContain('25.0% used')
		expect(rowText).toContain('3.00 ETH remaining')
	})

	test('removes a pool from favorites with its star and keeps it downloaded', async () => {
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [createNumberedPool(1)] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const star = documentQueries.getByRole('button', { name: 'Favorite: Numbered pool 1' })
		expect(star.getAttribute('aria-pressed')).toBe('true')
		await act(() => {
			fireEvent.click(star)
		})
		expect(getRenderedPoolTitles()).toEqual([])
		expect(documentQueries.getByText('No favorite pools yet')).not.toBeNull()
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Show downloaded pools' }))
		})
		expect(getRenderedPoolTitles()).toEqual(['Numbered pool 1'])
		expect(documentQueries.getByRole('button', { name: 'Favorite: Numbered pool 1' }).getAttribute('aria-pressed')).toBe('false')
	})

	test('offers to open a pasted pool address that is not downloaded', async () => {
		const onSelectSecurityPool = mock((..._args: unknown[]) => undefined)
		const address = '0x00000000000000000000000000000000000000Ab'
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ activeUniverseId: 1n, onSelectSecurityPool, securityPools: [] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		await typeSearch(address)
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Open pool at this address' }))
		})
		expect(onSelectSecurityPool).toHaveBeenCalledWith(address, 1n)
	})

	test('opens a pasted downloaded pool from another universe in its own universe', async () => {
		const pool = createNumberedPool(6, { universeId: 11n })
		seedDownloadedPools([pool])
		const onSelectSecurityPool = mock((..._args: unknown[]) => undefined)
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ onSelectSecurityPool, securityPools: [createNumberedPool(1)] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		await typeSearch(pool.securityPoolAddress)
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Open pool at this address' }))
		})
		expect(onSelectSecurityPool).toHaveBeenCalledWith(pool.securityPoolAddress, 11n)
	})

	test('shows no remaining capacity when the complete-set exchange rate is undefined', async () => {
		const pool = createNumberedPool(1, { settlementCollateralAttoEth: 0n, shareTokenSupplyAttoShares: 5n, totalCapacityOwnershipAttoRep: 8n * 10n ** 18n })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ repPerEthPrice: 10n ** 18n, securityPools: [pool], uiPriceOracle: 'uniswap' })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const rowText = (document.querySelector('.pool-directory-row .pool-capacity-summary.is-prominent')?.textContent ?? '').replace(/\s+/g, ' ')
		expect(rowText).toContain('0 ETH remaining')
	})

	test('offers to open a pasted address that is downloaded but not listed in the active collection', async () => {
		const pool = createNumberedPool(5)
		seedDownloadedPools([pool], { favorite: false })
		const onSelectSecurityPool = mock((..._args: unknown[]) => undefined)
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ onSelectSecurityPool, securityPools: [createNumberedPool(1)] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		await typeSearch(pool.securityPoolAddress)
		expect(getRenderedPoolTitles()).toEqual([])
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Open pool at this address' }))
		})
		expect(onSelectSecurityPool).toHaveBeenCalledWith(pool.securityPoolAddress, 1n)
	})

	test('offers to open a pasted address from the empty favorites state when only downloads exist', async () => {
		seedDownloadedPools([createNumberedPool(5)], { favorite: false })
		const onSelectSecurityPool = mock((..._args: unknown[]) => undefined)
		const address = '0x00000000000000000000000000000000000000Cd'
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ onSelectSecurityPool, securityPools: [] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Show downloaded pools' })).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Open pool at this address' })).toBeNull()
		await typeSearch(address)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Open pool at this address' }))
		})
		expect(onSelectSecurityPool).toHaveBeenCalledWith(address, 1n)
	})

	test('offers pool creation when a scan finds no pools', async () => {
		let createSecurityPoolClicks = 0
		let requestKey: string | undefined
		const props = createProps({
			onCreateSecurityPool: () => {
				createSecurityPoolClicks += 1
			},
			onLoadSecurityPoolPage: (_pageIndex, _pageSize, key) => {
				requestKey = key
			},
			securityPoolPage: undefined,
			securityPools: [],
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...props} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Create security pool' })).toBeNull()
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover pools' }))
			await Promise.resolve()
		})
		await act(() => {
			render(<SecurityPoolsOverviewSection {...props} securityPoolPage={{ pageIndex: 0, pageSize: 6, poolCount: 0n, pools: [], requestKey: requestKey ?? '' }} />, renderedComponent.container)
		})
		expect(documentQueries.getByText('No security pools', { selector: '.empty-state-title' })).not.toBeNull()
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create security pool' }))
		})
		expect(createSecurityPoolClicks).toBe(1)
	})

	test('retries the last scan request after a load error', async () => {
		const requestedPages: number[] = []
		const retryPageLoad = createDeferred<void>()
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					onLoadSecurityPoolPage: pageIndex => {
						requestedPages.push(pageIndex)
						return retryPageLoad.promise
					},
					securityPoolOverviewError: 'Failed to load security pools.',
					securityPoolPage: undefined,
					securityPools: [],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
		})
		expect(requestedPages).toEqual([0])
		expect(documentQueries.getByRole('button', { name: 'Retrying security pools…' }).hasAttribute('disabled')).toBe(true)
		retryPageLoad.resolve()
		await act(async () => {
			await retryPageLoad.promise
		})
		await waitFor(() => {
			expect(documentQueries.getByRole('button', { name: 'Retry' })).not.toBeNull()
		})
	})

	test('restarts the scan when the environment or account changes', async () => {
		const requests: Array<{ pageIndex: number; requestKey: string }> = []
		const props = createProps({
			onLoadSecurityPoolPage: (pageIndex, _pageSize, requestKey) => {
				requests.push({ pageIndex, requestKey })
			},
			securityPoolPage: undefined,
			securityPools: [],
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...props} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover pools' }))
			await Promise.resolve()
		})
		const firstRequest = requests[0]
		if (firstRequest === undefined) throw new Error('Expected a page request')
		await act(() => {
			render(<SecurityPoolsOverviewSection {...props} securityPoolPage={{ pageIndex: 0, pageSize: 6, poolCount: 12n, pools: [createNumberedPool(1)], requestKey: firstRequest.requestKey }} />, renderedComponent.container)
		})
		expect(documentQueries.getByRole('button', { name: 'Discover more' })).not.toBeNull()

		await act(() => {
			render(<SecurityPoolsOverviewSection {...props} environmentRefreshKey={1} securityPoolPage={{ pageIndex: 0, pageSize: 6, poolCount: 12n, pools: [createNumberedPool(1)], requestKey: firstRequest.requestKey }} />, renderedComponent.container)
		})
		expect(documentQueries.getByRole('button', { name: 'Discover pools' })).not.toBeNull()
		expect(getRenderedPoolTitles()).toEqual(['Numbered pool 1'])
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover pools' }))
			await Promise.resolve()
		})
		expect(requests.map(request => request.pageIndex)).toEqual([0, 0])
		expect(requests[1]?.requestKey).not.toBe(firstRequest.requestKey)
	})
})
