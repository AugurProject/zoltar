import { render } from 'preact'
import { SecurityPoolSummaryMetrics } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolSummaryMetrics.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
/// <reference types="bun-types" />

import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, normalizeText, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import type { ListedSecurityPool, SecurityPoolDiscoveryPage } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { readFavoriteEntries, resetLocalEntityStoreForTesting, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { securityPoolDownloadStore, toCachedSecurityPool } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/poolBrowse.js'
import { SecurityPoolsOverviewSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolsOverviewSection.js'
import { deriveHasForkActivity } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/forkAuction.js'
import type { SecurityPoolDiscoveryProps, SecurityPoolsOverviewSectionProps } from '@zoltar/ui-statoblast-shared/features/types.js'
import { describe, expect, mock, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { getGenesisNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

function createSecurityPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	const securityPool: ListedSecurityPool = {
		mintingCapacityAttoEth: 5n * 10n ** 18n,
		settlementCollateralAttoEth: 0n,
		currentRetentionRate: 10n,
		feeEligibleUnderwritingLimitAttoEth: 5n * 10n ** 18n,
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
		totalUnderwritingLimitAttoEth: 5n * 10n ** 18n,
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

/** A registry read that settles without a page, so a test sees only the pools it seeded locally. */
function createIdleDiscovery(overrides: Partial<SecurityPoolDiscoveryProps> = {}): SecurityPoolDiscoveryProps {
	return { contextKey: 'test', error: undefined, loading: false, onLoadPage: async () => undefined, page: undefined, ...overrides }
}

function createProps(overrides: Partial<SecurityPoolsOverviewSectionProps> = {}): SecurityPoolsOverviewSectionProps {
	const securityPools = overrides.securityPools ?? [createSecurityPool()]
	seedDownloadedPools(securityPools)
	return { activeUniverseId: 1n, currentTimestamp: undefined, discovery: createIdleDiscovery(), onSelectSecurityPool: () => undefined, ...overrides, securityPools }
}

type RegistryPageLoad = (pageIndex: number, pageSize: number) => Promise<readonly ListedSecurityPool[]>

/** Serves pages of an in-memory factory registry the way the route's discovery hook does: each page echoes its request key. */
function DiscoveringOverview({ loadRegistryPage, registrySize, ...props }: Omit<SecurityPoolsOverviewSectionProps, 'discovery'> & { loadRegistryPage: RegistryPageLoad; registrySize: number }) {
	const [page, setPage] = useState<SecurityPoolDiscoveryPage | undefined>(undefined)
	const [error, setError] = useState<string | undefined>(undefined)
	const onLoadPage = async (pageIndex: number, pageSize: number, requestKey: string) => {
		setError(undefined)
		try {
			const pools = await loadRegistryPage(pageIndex, pageSize)
			setPage({ pageIndex, pageSize, poolCount: BigInt(registrySize), pools: [...pools], requestKey })
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : 'Registry read failed')
			throw loadError
		}
	}
	return <SecurityPoolsOverviewSection {...props} discovery={createIdleDiscovery({ error, onLoadPage, page })} />
}

function createRegistry(pools: readonly ListedSecurityPool[]): RegistryPageLoad {
	return async (pageIndex, pageSize) => pools.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
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

	test('hides another genesis root zero favorite and restores it when returning to that deployment', async () => {
		const yes = getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, 'yes')
		const no = getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, 'no')
		const restore = installActiveEnvironmentForTesting(createFakeBackend({ profile: yes }))
		try {
			seedDownloadedPools([createSecurityPool({ universeId: 0n })])
			const props = createProps({ activeUniverseId: 0n, securityPools: [] })
			let rendered = await renderIntoDocument(<SecurityPoolsOverviewSection {...props} />)
			cleanupRenderedComponent = rendered.cleanup
			expect(document.querySelectorAll('.pool-directory-row')).toHaveLength(1)

			// Selecting another genesis deployment reloads the app, with browser storage retained.
			await rendered.cleanup()
			installActiveEnvironmentForTesting(createFakeBackend({ profile: no }))
			rendered = await renderIntoDocument(<SecurityPoolsOverviewSection {...props} />)
			cleanupRenderedComponent = rendered.cleanup
			expect(document.querySelectorAll('.pool-directory-row')).toHaveLength(0)

			await rendered.cleanup()
			installActiveEnvironmentForTesting(createFakeBackend({ profile: yes }))
			rendered = await renderIntoDocument(<SecurityPoolsOverviewSection {...props} />)
			cleanupRenderedComponent = rendered.cleanup
			expect(document.querySelectorAll('.pool-directory-row')).toHaveLength(1)
		} finally {
			restore()
		}
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
			expect(row.querySelector('details')?.textContent).toContain('Initial report priority fee')
			const explorer = within(row).getByRole('link', { name: new RegExp(`^View address ${pool.securityPoolAddress}`) })
			expect(explorer.getAttribute('href')).toContain(`/address/${pool.securityPoolAddress}`)
			const link = within(row).getByRole('link', { name: new RegExp(`^Open pool: .*${pool.securityPoolAddress}`) })
			expect(link.getAttribute('href')).toContain(pool.securityPoolAddress)
			fireEvent.click(link)
		}
		expect(selected).toEqual([first.securityPoolAddress, second.securityPoolAddress])
	})

	function getSecurityPoolCard(headingText: string): HTMLElement {
		const normalizedHeadingText = normalizeText(headingText)
		const titleHeading = within(document.body)
			.getAllByRole('heading')
			.find(node => normalizeText(node.textContent ?? '').includes(normalizedHeadingText))
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

	test('labels the pool backing per ETH commitment in REP per ETH', async () => {
		const pool = createSecurityPool({ totalPoolHeldAttoRep: 60n * 10n ** 18n, totalUnderwritingLimitAttoEth: 10n * 10n ** 18n })
		const renderedComponent = await renderIntoDocument(<SecurityPoolSummaryMetrics pool={pool} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const label = within(document.body).getByText('Pool-held REP per committed ETH')
		expect(label.parentElement?.querySelector('.metric-field-value')?.textContent).toBe('6\u00a0REP per ETH')
	})

	test('renders standing ETH commitments separately from REP backing', async () => {
		const pool = createSecurityPool({
			lastOraclePrice: 3n * 10n ** 18n,
			lastOracleSettlementTimestamp: 1n,
			settlementCollateralAttoEth: 5n * 10n ** 18n,
			statoblastSecurityMultiplierBps: 20_000n,
			totalUnderwritingLimitAttoEth: 80n * 10n ** 18n,
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const card = getSecurityPoolCard('Will this resolve?')
		expect(normalizeText(card.textContent ?? '')).toContain('/ 80.00 ETH')
		expect(normalizeText(card.textContent ?? '')).not.toContain('/ ≈ 13.33 ETH')
	})

	test('shows standing commitments when the oracle has never reported', async () => {
		const pool = createSecurityPool({ lastOraclePrice: 0n, lastOracleSettlementTimestamp: 0n })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const card = getSecurityPoolCard('Will this resolve?')
		expect(normalizeText(card.textContent ?? '')).toContain('Oracle price unavailable')
		expect(normalizeText(card.textContent ?? '')).toContain('/ 5.00 ETH')
	})

	test('shows exact small ETH values in browse cards instead of approximate zero', async () => {
		const pool = createSecurityPool({
			lastOraclePrice: 1n,
			settlementCollateralAttoEth: 1_000_000_000_000_000n,
			totalUnderwritingLimitAttoEth: 1n * 10n ** 18n,
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const cardText = normalizeText(getSecurityPoolCard('Will this resolve?').textContent ?? '')
		expect(cardText).toContain('0.001 ETH')
		expect(cardText).not.toContain('≈ 0.00 ETH')
	})

	test('does not present pool-held vault REP backing alone as a pool health gauge when dispute-staked REP changes ordinary coverage', async () => {
		const pool = createSecurityPool({
			statoblastSecurityMultiplierBps: 20_000n,
			totalPoolHeldAttoRep: 16n * 10n ** 18n,
			totalUnderwritingLimitAttoEth: 10n * 10n ** 18n,
			vaultCount: 1n,
			vaults: [
				{
					disputeStakedAttoRep: 4n * 10n ** 18n,
					vaultAttoRepBacking: 16n * 10n ** 18n,
					underwritingLimitAttoEth: 10n * 10n ** 18n,
					claimableFeesAttoEth: 0n,
					vaultAddress: '0x0000000000000000000000000000000000000100',
				},
			],
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
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

	test('shows Fork migration for parent pools with child pools even when the loaded parent outcome is resolved', async () => {
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
		expect(parentCardQueries.getByText('Fork migration')).not.toBeNull()
		expect(parentCardQueries.queryByText('Finalized as Yes')).toBeNull()
	})

	test('shows Fork migration for pools already in fork migration flow', async () => {
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
		expect(badgeTexts).toContain('Fork migration')
	})

	test('describes Fork finalized auction-state guidance without implying the truth auction is already complete', async () => {
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
		const truthAuctionBadge = auctionPoolCardQueries.getByText('Truth auction')
		expect(truthAuctionBadge.getAttribute('aria-label')).toBe('Truth auction')
		expect(truthAuctionBadge.parentElement?.getAttribute('aria-describedby')).toBeNull()
	})

	test('shows Fork finalized for child pools with completed fork history', async () => {
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
		expect(badgeTexts).toContain('Fork finalized')
		const childPoolCard = getSecurityPoolCard(childPoolTitle)
		const childPoolCardQueries = within(childPoolCard)
		const forkFinalizedBadge = childPoolCardQueries.getByText('Fork finalized')
		expect(forkFinalizedBadge.getAttribute('aria-label')).toBe('Fork finalized')
		expect(forkFinalizedBadge.parentElement?.getAttribute('aria-describedby')).toBeNull()
		expect(childPoolCardQueries.queryByText('This parent pool has already gone through a fork lifecycle and now acts as a historical reference point.')).toBeNull()
	})

	test('shows Fork migration instead of Operational for root-universe pools after Zoltar has forked', async () => {
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
		expect(poolCardQueries.getByText('Fork migration')).not.toBeNull()
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
		const searchInput = documentQueries.getByLabelText('Search or paste a pool address')
		expect(searchInput.getAttribute('placeholder')).toBe('Address, question ID, or text')
		expect(documentQueries.queryByText(/pools? match/)).toBeNull()
		const systemStateSelect = documentQueries.getByLabelText('System state')
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
									underwritingLimitAttoEth: 5n,
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
		expect(poolCardQueries.queryByRole('button', { name: 'Liquidate vault' })).toBeNull()
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
									underwritingLimitAttoEth: 1n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000701',
								},
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									underwritingLimitAttoEth: 9n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000702',
								},
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									underwritingLimitAttoEth: 5n,
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
					securityPools: [
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Viewer vault preview pool' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000600',
							vaultCount: 6n,
							vaults: [
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									underwritingLimitAttoEth: 8n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000601',
								},
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									underwritingLimitAttoEth: 7n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000602',
								},
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									underwritingLimitAttoEth: 6n,
									claimableFeesAttoEth: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000603',
								},
								{
									disputeStakedAttoRep: 0n,
									vaultAttoRepBacking: 10n,
									underwritingLimitAttoEth: 1n,
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

	// The caption under each row's capacity meter, such as its remaining capacity.
	function getCapacityCaptions() {
		return [...document.querySelectorAll('.pool-directory-row .pool-capacity-summary .progress-meter-detail')].map(caption => normalizeText(caption.textContent ?? ''))
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
		const input = within(document.body).getByLabelText('Search or paste a pool address')
		if (!(input instanceof window.HTMLInputElement)) throw new Error('Expected search input')
		input.value = value
		await act(() => {
			input.dispatchEvent(new window.Event('input', { bubbles: true }))
		})
	}

	test('opens on saved favorites and loads the first registry page in the background', async () => {
		const onLoadPage = mock(async (_pageIndex: number, _pageSize: number, _requestKey: string) => undefined)
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ discovery: createIdleDiscovery({ onLoadPage }), securityPools: [createNumberedPool(1), createNumberedPool(2)] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getRenderedPoolTitles()).toEqual(['Numbered pool 1', 'Numbered pool 2'])
		expect(within(document.body).getByRole('button', { name: 'Favorites (2)' }).getAttribute('aria-pressed')).toBe('true')
		expect(document.body.textContent).not.toContain('Search this page')
		await waitFor(() => expect(onLoadPage).toHaveBeenCalledTimes(1))
		expect(onLoadPage.mock.calls[0]?.slice(0, 2)).toEqual([0, 10])
	})

	test('excludes unstarred cached pools from the favorites list and search', async () => {
		seedDownloadedPools([createNumberedPool(9)], { favorite: false })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [createNumberedPool(1)] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(getRenderedPoolTitles()).toEqual(['Numbered pool 1'])
		expect(within(document.body).getByRole('button', { name: 'Favorites (1)' }).getAttribute('aria-pressed')).toBe('true')
		expect(within(document.body).getByRole('button', { name: 'Downloaded (2)' }).getAttribute('aria-pressed')).toBe('false')
		await typeSearch('Numbered pool 9')
		expect(getRenderedPoolTitles()).toEqual([])
		expect(within(document.body).getByText('No pools match the current search and filter settings.')).not.toBeNull()
	})

	test('searches favorite pools and filters universes before display', async () => {
		const pools = Array.from({ length: 8 }, (_, index) => createNumberedPool(index + 1))
		seedDownloadedPools([createNumberedPool(9, { marketDetails: createMarketDetails({ title: 'Numbered pool 9 elsewhere' }), universeId: 11n })])
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: pools })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		expect(getRenderedPoolTitles()).toHaveLength(8)
		expect(documentQueries.getByText('1 more in other universes.')).not.toBeNull()

		await typeSearch('numbered pool 8')
		expect(getRenderedPoolTitles()).toEqual(['Numbered pool 8'])
		expect(documentQueries.getByText('1 of 8 pools matches. 1 more in other universes.')).not.toBeNull()

		await typeSearch(pools[6]?.securityPoolAddress.toUpperCase() ?? '')
		expect(getRenderedPoolTitles()).toEqual(['Numbered pool 7'])
	})

	test('sorts favorite pools by remaining capacity, end time, and state', async () => {
		const pools = [
			createNumberedPool(1, { marketDetails: createMarketDetails({ endTime: 300n, title: 'Late large' }), questionOutcome: 'yes', settlementCollateralAttoEth: 0n }),
			createNumberedPool(2, { marketDetails: createMarketDetails({ endTime: 100n, title: 'Soon full' }), settlementCollateralAttoEth: 5n * 10n ** 18n }),
			createNumberedPool(3, { marketDetails: createMarketDetails({ endTime: 200n, title: 'Middle half' }), settlementCollateralAttoEth: 2n * 10n ** 18n }),
		]
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ currentTimestamp: 50n, securityPools: pools })} />)
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
		const pool = createNumberedPool(1, { settlementCollateralAttoEth: 1n * 10n ** 18n, mintingCapacityAttoEth: 4n * 10n ** 18n, totalUnderwritingLimitAttoEth: 4n * 10n ** 18n })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const rowText = normalizeText(document.querySelector('.pool-directory-row .pool-capacity-summary')?.textContent ?? '')
		expect(rowText).toContain('25% used')
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
		await waitFor(() => expect(documentQueries.getByText('No favorite pools yet')).not.toBeNull())
		expect(documentQueries.getByText('Star a downloaded pool, or open one, to keep it here.')).not.toBeNull()
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Show downloaded pools' }))
		})
		expect(getRenderedPoolTitles()).toEqual(['Numbered pool 1'])
		expect(securityPoolDownloadStore.read(getLocalEntityScope('statoblast', 'pool'))).toHaveLength(1)
		expect(readFavoriteEntries(getLocalEntityScope('statoblast', 'pool'))).toEqual([])
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

	test('says minting is paused for a pool whose escalation game has started', async () => {
		const pool = createNumberedPool(1, { ordinaryEscalationGameStarted: true })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const rowText = normalizeText(document.querySelector('.pool-directory-row .pool-capacity-summary')?.textContent ?? '')
		expect(rowText).toContain('/ 5.00 ETH')
		expect(rowText).not.toContain('remaining')
		expect(getCapacityCaptions()[0]).toBe('Minting paused')
	})

	test('does not call minting paused once a pool that ran an escalation game has finalized or forked', async () => {
		// The escalation flag stays set after the game, but finalization or a fork closes minting for good.
		const finalizedPool = createNumberedPool(1, { ordinaryEscalationGameStarted: true, questionOutcome: 'yes' })
		const migratingPool = createNumberedPool(2, { ordinaryEscalationGameStarted: true, systemState: 'forkMigration' })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [finalizedPool, migratingPool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(getCapacityCaptions()).toEqual(['0 ETH remaining', '0 ETH remaining'])
	})

	test('shows no remaining capacity when the complete-set exchange rate is undefined', async () => {
		const pool = createNumberedPool(1, { settlementCollateralAttoEth: 0n, shareTokenSupplyAttoShares: 5n, totalUnderwritingLimitAttoEth: 8n * 10n ** 18n })
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ securityPools: [pool] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(getCapacityCaptions()[0]).toBe('0 ETH remaining')
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

	test('opens on downloaded pools without favorites and offers to open a pasted address none of them matches', async () => {
		seedDownloadedPools([createNumberedPool(5)], { favorite: false })
		const onSelectSecurityPool = mock((..._args: unknown[]) => undefined)
		const address = '0x00000000000000000000000000000000000000Cd'
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...createProps({ onSelectSecurityPool, securityPools: [] })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Show downloaded pools' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Open pool at this address' })).toBeNull()
		await typeSearch(address)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Open pool at this address' }))
		})
		expect(onSelectSecurityPool).toHaveBeenCalledWith(address, 1n)
	})
	test('lists the first registry page on entry when no pools are saved in this browser', async () => {
		const registry = [createNumberedPool(1), createNumberedPool(2), createNumberedPool(3)]
		const loadRegistryPage = mock(createRegistry(registry))
		const renderedComponent = await renderIntoDocument(<DiscoveringOverview activeUniverseId={1n} currentTimestamp={undefined} loadRegistryPage={loadRegistryPage} registrySize={registry.length} securityPools={[]} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(getRenderedPoolTitles()).toEqual(['Numbered pool 1', 'Numbered pool 2', 'Numbered pool 3']))
		expect(loadRegistryPage).toHaveBeenCalledTimes(1)
		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Downloaded (3)' }).getAttribute('aria-pressed')).toBe('true')
		expect(documentQueries.queryByText('No favorite pools yet')).toBeNull()
		// The whole registry fit on one page, so there is nothing more to load.
		expect(documentQueries.queryByRole('button', { name: 'Show more' })).toBeNull()
	})

	test('loads further registry pages only on request and keeps favorites separate', async () => {
		const registry = Array.from({ length: 12 }, (_, index) => createNumberedPool(index + 1))
		seedDownloadedPools([createNumberedPool(40, { marketDetails: createMarketDetails({ title: 'Saved favorite' }) })])
		const loadRegistryPage = mock(createRegistry(registry))
		const renderedComponent = await renderIntoDocument(<DiscoveringOverview activeUniverseId={1n} currentTimestamp={undefined} loadRegistryPage={loadRegistryPage} registrySize={registry.length} securityPools={[]} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		expect(getRenderedPoolTitles()).toEqual(['Saved favorite'])
		await waitFor(() => expect(documentQueries.getByText('10 of 12 pools checked')).not.toBeNull())
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Downloaded (11)' }))
		})
		expect(getRenderedPoolTitles()).toHaveLength(11)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Show more' }))
		})
		await waitFor(() => expect(getRenderedPoolTitles()).toHaveLength(13))
		expect(loadRegistryPage.mock.calls.map(call => call[0])).toEqual([0, 1])
		expect(documentQueries.queryByRole('button', { name: 'Show more' })).toBeNull()
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Favorites (1)' }))
		})
		expect(getRenderedPoolTitles()).toEqual(['Saved favorite'])
	})

	test('offers a retry when the first registry page fails to load', async () => {
		const registry = [createNumberedPool(1)]
		let reads = 0
		const loadRegistryPage = mock(async (pageIndex: number, pageSize: number) => {
			reads += 1
			if (reads === 1) throw new Error('Registry read failed')
			return await createRegistry(registry)(pageIndex, pageSize)
		})
		const renderedComponent = await renderIntoDocument(<DiscoveringOverview activeUniverseId={1n} currentTimestamp={undefined} loadRegistryPage={loadRegistryPage} registrySize={registry.length} securityPools={[]} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		await waitFor(() => expect(documentQueries.getByText('Registry read failed')).not.toBeNull())
		expect(getRenderedPoolTitles()).toEqual([])
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
		})
		await waitFor(() => expect(getRenderedPoolTitles()).toEqual(['Numbered pool 1']))
		expect(documentQueries.queryByText('Registry read failed')).toBeNull()
	})

	test('offers pool creation when the registry has no pools', async () => {
		const onCreatePool = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(<DiscoveringOverview activeUniverseId={1n} currentTimestamp={undefined} loadRegistryPage={createRegistry([])} onCreatePool={onCreatePool} registrySize={0} securityPools={[]} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		await waitFor(() => expect(documentQueries.getByText('No pools yet')).not.toBeNull())
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create pool' }))
		})
		expect(onCreatePool).toHaveBeenCalledTimes(1)
	})

	test('uses restored browser controls and follows history-driven updates', async () => {
		const updates: Array<Partial<NonNullable<SecurityPoolsOverviewSectionProps['browseState']>>> = []
		const props = createProps({
			browseState: { searchText: 'saved query', sortKey: 'endTime', stateFilter: 'ended' },
			onBrowseStateChange: update => updates.push(update),
		})
		const { container, cleanup } = await renderIntoDocument(<SecurityPoolsOverviewSection {...props} />)
		cleanupRenderedComponent = cleanup
		const query = within(document.body)
		expect(query.getByRole('textbox', { name: 'Search or paste a pool address' }).value).toBe('saved query')
		expect(query.getByRole('combobox', { name: 'System state' }).value).toBe('ended')
		expect(query.getByRole('combobox', { name: 'Sort' }).value).toBe('endTime')
		await act(() => fireEvent.input(query.getByRole('textbox', { name: 'Search or paste a pool address' }), { target: { value: 'new query' } }))
		expect(updates).toContainEqual({ searchText: 'new query' })
		await act(() => render(<SecurityPoolsOverviewSection {...props} browseState={{ searchText: '', sortKey: 'recent', stateFilter: 'all' }} />, container))
		expect(query.getByRole('textbox', { name: 'Search or paste a pool address' }).value).toBe('')
		expect(query.getByRole('combobox', { name: 'System state' }).value).toBe('all')
		expect(query.getByRole('combobox', { name: 'Sort' }).value).toBe('recent')
	})
})
