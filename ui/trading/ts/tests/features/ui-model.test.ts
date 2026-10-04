import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { formatEthAmountPair, formatRoundedUnits } from '../../lib/format.js'
import { parseNonNegativeDecimalInput, tryParseNonNegativeDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { attoSharesToCollateralAttoEth, averagePriceBps, collateralAttoEthToAttoShares, formatCollateralEth, formatCompleteSetQuantity, formatLpQuantity, formatOutcomeQuantity } from '../../lib/shareValue.js'
import { forkMigrationBatchBlocker, forkMigrationBatchWarning, settlementBalanceLabel, settlementBalanceStatus, settlementInputBlocker, settlementUnavailableReason } from '../../features/LiveSettlementModel.js'
import {
	createSecurityPoolDeploymentIndex,
	liveBalancesForMarket,
	marketAcceptsNewRisk,
	publicErrorMessage,
	marketNewRiskBlocker,
	marketSettlementPath,
	mapWithConcurrency,
	refreshSecurityPoolDeploymentIndex,
	registryBlockAnchorIsCanonical,
	settlementAvailability,
	shareBalanceScope,
	type LiveMarket,
	type SettlementOperation,
} from '../../protocol/live.js'
import { maximumAfterSlippage, minimumAfterSlippage, requireTransactionSlippageBps, requireTransactionValidityMinutes, retainApprovedMaximum, retainApprovedMinimum } from '../../protocol/tradeQuote.js'
import { broadcastUncertainMessage, discoveryCommitAllowed, livePairInitialized, positionControlsWorkflowLocked, securityPoolAddressFromRoute } from '../../features/liveTradingControllerHelpers.js'
import { parseSlippagePercent, parseValidityMinutes } from '../../lib/tradeSettings.js'
import { isTradingLookupRoute, tradingListKindFor, tradingRouting } from '../../lib/routing.js'
import { liveLookupRoutePresentation, liveRouteLoadingPresentation, liveWorkflowRoutePresentation } from '../../features/live/routePresentation.js'
import * as liquidityCopy from '../../copy/liquidity.js'
import * as ticketCopy from '../../copy/tradeTicket.js'
import { liquidityOperationAvailable } from '../../features/live/useLiquidityWorkflowController.js'

describe('standalone trading UI model', () => {
	test('keeps the header badge as the only network disclosure on route headers', () => {
		expect(liveWorkflowRoutePresentation('market').description).not.toContain('Browser simulation')
		expect(liveWorkflowRoutePresentation('market').description).not.toContain('Ethereum mainnet')
	})

	test('names the route the user is on while contracts load so the header does not change once they resolve', () => {
		const pool = `0x${'ab'.repeat(20)}`
		expect(liveRouteLoadingPresentation('portfolio')).toEqual({ title: 'Portfolio' })
		expect(liveRouteLoadingPresentation(`security-pool/${pool}`)).toEqual({ description: 'Identity, lifecycle, and capacity of the security pool that backs this market.', title: 'Security pool' })
		expect(liveRouteLoadingPresentation(`market/${pool}`)).toEqual(liveWorkflowRoutePresentation('market'))
		expect(liveRouteLoadingPresentation(`liquidity/${pool}`)).toEqual(liveWorkflowRoutePresentation('liquidity'))
		expect(liveRouteLoadingPresentation('create-market')).toEqual(liveWorkflowRoutePresentation('create-market'))
		expect(liveRouteLoadingPresentation('market')).toEqual(liveLookupRoutePresentation('market'))
	})

	test('names the market list after the Markets tab while an addressed market keeps the singular title', () => {
		expect(liveLookupRoutePresentation('market').title).toBe('Markets')
		expect(liveLookupRoutePresentation('market').description).toBe(liveWorkflowRoutePresentation('market').description)
		expect(liveRouteLoadingPresentation(`market/0x${'ab'.repeat(20)}`).title).toBe('Market')
		expect(liveLookupRoutePresentation('liquidity')).toEqual(liveWorkflowRoutePresentation('liquidity'))
		expect(liveLookupRoutePresentation('create-market')).toEqual(liveWorkflowRoutePresentation('create-market'))
	})

	test('presents liquidity as its own workflow instead of repeating the market header', () => {
		expect(liveWorkflowRoutePresentation('liquidity').title).toBe('Liquidity')
		expect(liveWorkflowRoutePresentation('liquidity').description).not.toBe(liveWorkflowRoutePresentation('market').description)
		expect(liveWorkflowRoutePresentation('market').title).toBe('Market')
		expect(liveWorkflowRoutePresentation('create-market').title).toBe('Create market')
	})

	test('invalidates new-risk liquidity operations at the exact end boundary while preserving removal', () => {
		const market = { endTime: 2_000n, systemState: 0, awaitingForkContinuation: false, universeForkTime: 0n, questionOutcome: 3, tradingStatus: 0 }
		expect(liquidityOperationAvailable('initialize', market, 1_999n)).toBe(true)
		expect(liquidityOperationAvailable('add', market, 2_000n)).toBe(false)
		expect(liquidityOperationAvailable('initialize', market, 2_001n)).toBe(false)
		expect(liquidityOperationAvailable('remove', market, 2_001n)).toBe(true)
	})

	test('defaults to the address lookup and keys each lookup workflow to its own candidate list', () => {
		expect(tradingRouting.resolve('#/')).toBe('market')
		expect(tradingRouting.resolve('')).toBe('market')
		expect(tradingRouting.resolve('#/markets')).toBe('market')
		expect(tradingRouting.resolve('#/security-pools')).toBe('create-market')
		expect(isTradingLookupRoute('market')).toBeTrue()
		expect(isTradingLookupRoute('markets')).toBeFalse()
		expect(isTradingLookupRoute('security-pool/0x1111111111111111111111111111111111111111')).toBeFalse()
		expect(tradingListKindFor('market')).toBe('markets')
		expect(tradingListKindFor('liquidity')).toBe('markets')
		expect(tradingListKindFor('create-market')).toBe('security-pools')
		expect(tradingListKindFor('portfolio')).toBeUndefined()
		expect(tradingListKindFor('market/0x1111111111111111111111111111111111111111')).toBeUndefined()
	})

	test('validates a registry anchor at the current tip without requesting historical blocks', async () => {
		const anchor = { blockNumber: 12n, blockHash: `0x${'12'.repeat(32)}` }
		let historicalReads = 0
		expect(
			await registryBlockAnchorIsCanonical(
				anchor,
				async () => anchor,
				async () => {
					historicalReads += 1
					return anchor
				},
			),
		).toBe(true)
		expect(historicalReads).toBe(0)
	})

	test('accepts an older registry anchor when the deterministic simulator cannot read historical blocks', async () => {
		const anchor = { blockNumber: 12n, blockHash: `0x${'12'.repeat(32)}` }
		expect(await registryBlockAnchorIsCanonical(anchor, async () => ({ blockNumber: 13n, blockHash: `0x${'13'.repeat(32)}` }))).toBe(true)
	})

	test('keeps provider identifiers out of public error copy', () => {
		const pool = `0x${'12'.repeat(20)}`
		const shareToken = `0x${'34'.repeat(20)}`
		const tokenId = '1793'
		const providerError = new Error(`Contract read failed at ${pool}: share token ${shareToken}, token ID ${tokenId}, call arguments unavailable`)
		const message = publicErrorMessage(providerError, 'Balance refresh failed')
		expect(message).toBe('Balance refresh failed.')
		expect(message).not.toContain(pool)
		expect(message).not.toContain(shareToken)
		expect(message).not.toContain(tokenId)
		expect(publicErrorMessage(new Error('RPC temporarily unavailable'), 'Balance refresh failed')).toBe('RPC temporarily unavailable.')
	})
	test('parses only exact security pool detail routes', () => {
		const address = `0x${'AB'.repeat(20)}`
		expect(securityPoolAddressFromRoute(`security-pool/${address}`)).toBe(getAddress(address))
		expect(securityPoolAddressFromRoute('security-pool/not-an-address')).toBeUndefined()
	})

	test('parses and formats chain quantities without numbers', () => {
		expect(parseNonNegativeDecimalInput('2 550 000.25')).toBe(2_550_000_250_000_000_000_000_000n)
		expect(tryParseNonNegativeDecimalInput(' 70\u00a0250.25 ', 2)).toBe(7_025_025n)
		expect(parseNonNegativeDecimalInput('1.2345')).toBe(1_234_500_000_000_000_000n)
		expect(formatTrimmedUnits(1_234_500_000_000_000_000n)).toBe('1.2345')
		expect(() => parseNonNegativeDecimalInput('1.0000000000000000001')).toThrow('18 decimal places')
		expect(() => parseNonNegativeDecimalInput('-1')).toThrow('Enter a valid non-negative amount')
		expect(() => parseNonNegativeDecimalInput('')).toThrow('Enter a valid non-negative amount')
		expect(tryParseNonNegativeDecimalInput('70.25', 2)).toBe(7_025n)
		expect(tryParseNonNegativeDecimalInput('70.251', 2)).toBeUndefined()
		expect(tryParseNonNegativeDecimalInput('../70', 2)).toBeUndefined()
		expect(tryParseNonNegativeDecimalInput('-0.5', 2)).toBeUndefined()
		expect(() => formatTrimmedUnits(1n, -1)).toThrow('Units must be non-negative')
		expect(() => formatTrimmedUnits(1n, 18, -1)).toThrow('Maximum fraction digits must be non-negative')
	})

	test('formats Statoblast settings for display', () => {
		expect(formatEthAmountPair(10_000n * 10n ** 18n, 9_500n * 10n ** 18n)).toBe('10\u00a0000 / 9\u00a0500 ETH')
		expect(formatTrimmedUnits(999_999_996_848_000_000n, 18, 12)).toBe('0.999999996848')
		expect(formatTrimmedUnits(999_999_977_880_000_000n, 18, 12)).toBe('0.99999997788')
		expect(formatRoundedUnits(999_999_996_848_000_000n)).toBe('1')
		expect(formatRoundedUnits(4_999_500_000_000_000n)).toBe('0.005')
		expect(formatRoundedUnits(4_949_999_999_999_999n)).toBe('0.0049')
		expect(formatRoundedUnits(-4_999_500_000_000_000n)).toBe('-0.005')
		expect(formatRoundedUnits(123n, 18, 18)).toBe('0.000000000000000123')
	})

	test('separates fixed share quantities from settlement-collateral values', () => {
		// Quantities use 18 decimal places; only ETH values use the current backing.
		const genesis = { settlementCollateralAttoEth: 0n, shareTokenSupplyAttoShares: 0n }
		expect(attoSharesToCollateralAttoEth(5n * 10n ** 15n, genesis)).toBe(5n * 10n ** 15n)
		expect(collateralAttoEthToAttoShares(5n * 10n ** 15n, genesis)).toBe(5n * 10n ** 15n)
		const rate = { settlementCollateralAttoEth: 9n * 10n ** 18n, shareTokenSupplyAttoShares: 10n * 10n ** 18n }
		expect(attoSharesToCollateralAttoEth(10n ** 18n, rate)).toBe(9n * 10n ** 17n)
		expect(collateralAttoEthToAttoShares(9n * 10n ** 17n, rate)).toBe(10n ** 18n)
		expect(collateralAttoEthToAttoShares(1n, rate)).toBe(1n)
		expect(collateralAttoEthToAttoShares(1n, { settlementCollateralAttoEth: 0n, shareTokenSupplyAttoShares: 1n })).toBeUndefined()
		expect(() => attoSharesToCollateralAttoEth(-1n, rate)).toThrow('cannot be negative')
		expect(formatOutcomeQuantity(10n ** 18n, 'YES')).toBe('1 Yes')
		expect(formatCompleteSetQuantity(10n ** 18n)).toBe('1 complete set')
		// Exactly 0.005 ETH of shares under a rate that no longer divides evenly still reads as 0.005, while limits round down.
		const drifted = { settlementCollateralAttoEth: 9_999_999_999_999_999n, shareTokenSupplyAttoShares: 10n * 10n ** 18n }
		const shares = collateralAttoEthToAttoShares(5n * 10n ** 15n, drifted)
		if (shares === undefined) throw new Error('Drifted rate must convert')
		expect(formatOutcomeQuantity(shares, 'YES')).toBe('5 Yes')
		expect(formatOutcomeQuantity(shares, 'YES', 4, 'down')).toBe('5 Yes')
		expect(formatCollateralEth(shares, drifted, 'down')).toBe('0.0049 ETH')
		expect(formatCollateralEth(shares, drifted)).toBe('0.005 ETH')
		expect(formatCompleteSetQuantity(10n ** 18n)).toBe('1 complete set')
		expect(formatLpQuantity(10n ** 18n)).toBe('1 LP')
		expect(averagePriceBps(6n * 10n ** 17n, 10n ** 18n, rate)).toBe(6_666n)
		expect(averagePriceBps(1n, 0n, rate)).toBeUndefined()
	})

	test('derives displayed transaction bounds with LP-favoring rounding', () => {
		expect(minimumAfterSlippage(10_001n)).toBe(9_950n)
		expect(maximumAfterSlippage(10_001n)).toBe(10_052n)
		expect(minimumAfterSlippage(1_001n, 250n)).toBe(975n)
		expect(maximumAfterSlippage(1_001n, 250n)).toBe(1_027n)
		expect(minimumAfterSlippage(1_000n, 1n)).toBe(999n)
		expect(minimumAfterSlippage(1_000n, 500n)).toBe(950n)
		expect(() => minimumAfterSlippage(1_000n, 501n)).toThrow('between 0.01% and 5%')
		expect(() => minimumAfterSlippage(1_000n, 0n)).toThrow('between 0.01% and 5%')
		expect(requireTransactionSlippageBps(1n)).toBeUndefined()
		expect(requireTransactionSlippageBps(500n)).toBeUndefined()
		expect(() => requireTransactionSlippageBps(501n)).toThrow('between 0.01% and 5%')
		expect(requireTransactionValidityMinutes(1n)).toBeUndefined()
		expect(requireTransactionValidityMinutes(1_440n)).toBeUndefined()
		expect(() => requireTransactionValidityMinutes(0n)).toThrow('between 1 and 1440 minutes')
		expect(() => requireTransactionValidityMinutes(1_441n)).toThrow('between 1 and 1440 minutes')
	})

	test('validates user-configurable transaction protection settings', () => {
		expect(parseSlippagePercent('0.75')).toBe(75n)
		expect(parseSlippagePercent('5')).toBe(500n)
		expect(parseSlippagePercent('5.01')).toBeUndefined()
		expect(parseSlippagePercent('-1')).toBeUndefined()
		// Zero tolerance reverts on any price movement, so the smallest accepted setting is 0.01%.
		expect(parseSlippagePercent('0')).toBeUndefined()
		expect(parseSlippagePercent('0.00')).toBeUndefined()
		expect(parseSlippagePercent('0.01')).toBe(1n)
		expect(parseValidityMinutes('1')).toBe(1n)
		expect(parseValidityMinutes('1440')).toBe(1_440n)
		expect(parseValidityMinutes('0')).toBeUndefined()
		expect(parseValidityMinutes('1441')).toBeUndefined()
		expect(parseValidityMinutes('1.5')).toBeUndefined()
	})

	test('never replaces user-approved bounds with refreshed quote bounds', () => {
		expect(retainApprovedMinimum(100n, 120n, 'long shares')).toBe(100n)
		expect(() => retainApprovedMinimum(100n, 99n, 'long shares')).toThrow('no longer satisfies')
		expect(retainApprovedMaximum(100n, 90n, 'long shares')).toBe(100n)
		expect(() => retainApprovedMaximum(100n, 101n, 'long shares')).toThrow('no longer satisfies')
	})

	test('blocks new risk for every uninitialized lifecycle guard', () => {
		const open = { tradingStatus: undefined, systemState: 0, awaitingForkContinuation: false, universeForkTime: 0n, questionOutcome: 3, endTime: 2_000n } satisfies Pick<LiveMarket, 'tradingStatus' | 'systemState' | 'awaitingForkContinuation' | 'universeForkTime' | 'questionOutcome' | 'endTime'>
		expect(marketAcceptsNewRisk(open, 1_000n)).toBeTrue()
		expect(marketAcceptsNewRisk({ ...open, tradingStatus: 6 }, 1_000n)).toBeTrue()
		expect(marketAcceptsNewRisk({ ...open, awaitingForkContinuation: true }, 1_000n)).toBeFalse()
		expect(marketAcceptsNewRisk({ ...open, universeForkTime: 999n }, 1_000n)).toBeFalse()
		expect(marketAcceptsNewRisk({ ...open, questionOutcome: 1 }, 1_000n)).toBeFalse()
		expect(marketAcceptsNewRisk({ ...open, systemState: 3 }, 1_000n)).toBeFalse()
		expect(marketAcceptsNewRisk(open, 2_000n)).toBeFalse()
		expect(marketNewRiskBlocker({ ...open, tradingStatus: undefined, universeForkTime: 999n }, 1_000n)).toBe('Universe forked')
		expect(marketNewRiskBlocker({ ...open, tradingStatus: undefined, awaitingForkContinuation: true }, 1_000n)).toBe('Awaiting fork continuation')
		expect(marketNewRiskBlocker({ ...open, tradingStatus: undefined, systemState: 3 }, 1_000n)).toBe('Security pool inactive')
		expect(marketNewRiskBlocker({ ...open, tradingStatus: undefined, questionOutcome: 0 }, 1_000n)).toBe('Resolved Invalid')
		expect(marketNewRiskBlocker({ ...open, tradingStatus: undefined }, 2_000n)).toBe('Question ended')
		expect(marketNewRiskBlocker({ ...open, tradingStatus: 0 }, 2_000n)).toBe('Question ended')
	})

	test('caches only the current registry snapshot and rebuilds on a new head', async () => {
		const index = createSecurityPoolDeploymentIndex<string, { blockHash: `0x${string}`; blockNumber: bigint }>()
		let latest = { blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 100n }
		const reads: bigint[] = []
		const loadSnapshot = async (anchor: typeof latest) => {
			reads.push(anchor.blockNumber)
			return [anchor.blockNumber.toString()]
		}
		const refresh = () =>
			refreshSecurityPoolDeploymentIndex(
				index,
				'chain:factory:universe-7',
				async () => latest,
				async () => true,
				loadSnapshot,
			)
		expect(await refresh()).toEqual(['100'])
		expect(await refresh()).toEqual(['100'])
		latest = { ...latest, blockNumber: 105n }
		expect(await refresh()).toEqual(['105'])
		expect(reads).toEqual([100n, 105n])
	})

	test('does not retain orphan registry entries when the discovery anchor is replaced', async () => {
		const index = createSecurityPoolDeploymentIndex<string, { blockHash: `0x${string}`; blockNumber: bigint }>()
		const orphanAnchor = { blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 100n }
		const canonicalAnchor = { blockHash: `0x${'22'.repeat(32)}` as const, blockNumber: 100n }
		let latest = orphanAnchor
		let canonicalHash = canonicalAnchor.blockHash
		await expect(
			refreshSecurityPoolDeploymentIndex(
				index,
				'chain:factory:universe-7',
				async () => latest,
				async anchor => anchor.blockHash === canonicalHash,
				async () => ['orphan'],
			),
		).rejects.toThrow('registry changed during discovery')
		expect(index.deployments).toEqual([])
		expect(index.anchor).toBeUndefined()

		latest = canonicalAnchor
		canonicalHash = canonicalAnchor.blockHash
		expect(
			await refreshSecurityPoolDeploymentIndex(
				index,
				'chain:factory:universe-7',
				async () => latest,
				async anchor => anchor.blockHash === canonicalHash,
				async () => ['canonical'],
			),
		).toEqual(['canonical'])
		expect(index.deployments).toEqual(['canonical'])
		expect(index.anchor).toEqual(canonicalAnchor)
	})

	test('rebuilds a replaced cached head without retaining orphan entries', async () => {
		const index = createSecurityPoolDeploymentIndex<string, { blockHash: `0x${string}`; blockNumber: bigint }>()
		let anchor = { blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 100n }
		await refreshSecurityPoolDeploymentIndex(
			index,
			'key',
			async () => anchor,
			async () => true,
			async () => ['orphan'],
		)
		anchor = { ...anchor, blockHash: `0x${'22'.repeat(32)}` }
		expect(
			await refreshSecurityPoolDeploymentIndex(
				index,
				'key',
				async () => anchor,
				async () => true,
				async () => ['canonical'],
			),
		).toEqual(['canonical'])
	})

	test('bounds asynchronous portfolio work while preserving registry order', async () => {
		let active = 0
		let maximumActive = 0
		const results = await mapWithConcurrency([0, 1, 2, 3, 4], 2, async value => {
			active += 1
			maximumActive = Math.max(maximumActive, active)
			await Bun.sleep((5 - value) * 2)
			active -= 1
			return value * 10
		})
		expect(maximumActive).toBe(2)
		expect(results).toEqual([0, 10, 20, 30, 40])
	})

	test('publishes fixed positions with gaps when reads finish out of order', async () => {
		const first = createDeferred<number>()
		const second = createDeferred<number>()
		const third = createDeferred<number>()
		const progress: (number | undefined)[][] = []
		const pending = mapWithConcurrency(
			[first, second, third],
			3,
			async value => await value.promise,
			rows => progress.push(rows),
		)
		second.resolve(20)
		await Bun.sleep(0)
		expect(progress).toEqual([[undefined, 20, undefined]])
		first.resolve(10)
		await Bun.sleep(0)
		expect(progress).toEqual([
			[undefined, 20, undefined],
			[10, 20, undefined],
		])
		third.resolve(30)
		expect(await pending).toEqual([10, 20, 30])
		expect(progress).toEqual([
			[undefined, 20, undefined],
			[10, 20, undefined],
			[10, 20, 30],
		])
	})

	test('counts undefined mapper results as completed progress', async () => {
		const progress: (number | undefined)[][] = []
		expect(
			await mapWithConcurrency(
				[0, 1],
				1,
				async value => (value === 0 ? undefined : value),
				rows => progress.push(rows),
			),
		).toEqual([undefined, 1])
		expect(progress).toEqual([
			[undefined, undefined],
			[undefined, 1],
		])
	})

	test('scopes portfolio share balances to one exact SecurityPool token namespace', () => {
		const first = shareBalanceScope({ pool: `0x${'11'.repeat(20)}`, shareToken: `0x${'22'.repeat(20)}`, universeId: 7n })
		const second = shareBalanceScope({ pool: `0x${'33'.repeat(20)}`, shareToken: `0x${'44'.repeat(20)}`, universeId: 8n })
		expect(first).toEqual({
			pool: `0x${'11'.repeat(20)}`,
			shareToken: `0x${'22'.repeat(20)}`,
			invalidTokenId: 1_792n,
			yesTokenId: 1_793n,
			noTokenId: 1_794n,
		})
		expect(second.invalidTokenId).not.toBe(first.invalidTokenId)
		expect(second.shareToken).not.toBe(first.shareToken)
		expect(second.pool).not.toBe(first.pool)
	})

	test('keeps maximum universe outcome token IDs within uint256', () => {
		const scope = shareBalanceScope({ pool: `0x${'11'.repeat(20)}`, shareToken: `0x${'22'.repeat(20)}`, universeId: (1n << 248n) - 1n })
		expect(scope.invalidTokenId).toBe((1n << 256n) - 256n)
		expect(scope.yesTokenId).toBe((1n << 256n) - 255n)
		expect(scope.noTokenId).toBe((1n << 256n) - 254n)
	})

	test('never exposes balances under another SecurityPool identity', () => {
		const firstMarket = { pool: `0x${'11'.repeat(20)}`, shareToken: `0x${'22'.repeat(20)}`, universeId: 7n } as const
		const secondMarket = { pool: `0x${'33'.repeat(20)}`, shareToken: `0x${'44'.repeat(20)}`, universeId: 8n } as const
		const firstBalances = { scope: shareBalanceScope(firstMarket), invalid: 1n, yes: 2n, no: 3n, lp: 4n }
		expect(liveBalancesForMarket(firstBalances, firstMarket)).toBe(firstBalances)
		expect(liveBalancesForMarket(firstBalances, secondMarket)).toBeUndefined()
	})

	test('derives bounded settlement actions from lifecycle and aggregate balances', () => {
		const open = { tradingStatus: 6, systemState: 0, awaitingForkContinuation: false, universeForkTime: 0n, questionOutcome: 3, endTime: 2_000n }
		const balances = { invalid: 5n, yes: 7n, no: 6n }
		expect(settlementAvailability(open, balances)).toEqual({ completeSets: 5n, winningBalance: 0n, canRedeemCompleteSets: true, canRedeemWinningShares: false, canMigrateShares: false })
		expect(settlementAvailability({ ...open, questionOutcome: 2 }, balances)).toEqual({ completeSets: 5n, winningBalance: 6n, canRedeemCompleteSets: true, canRedeemWinningShares: true, canMigrateShares: false })
		expect(settlementAvailability({ ...open, universeForkTime: 1n, systemState: 1 }, balances)).toEqual({ completeSets: 5n, winningBalance: 0n, canRedeemCompleteSets: false, canRedeemWinningShares: false, canMigrateShares: true })
	})

	test('allows many ready fork children while requiring missing children to be created singly', () => {
		const ready = { outcomeIndex: 1n, universeId: 11n, label: 'Ready', canonicalPool: `0x${'11'.repeat(20)}` as const }
		const missing = { outcomeIndex: 2n, universeId: 12n, label: 'Missing', canonicalPool: undefined }
		expect(forkMigrationBatchBlocker([ready, { ...ready, outcomeIndex: 3n }])).toBeUndefined()
		expect(forkMigrationBatchBlocker([missing])).toBeUndefined()
		expect(forkMigrationBatchBlocker([ready, missing])).toContain('Migrate into each such child universe separately.')
		expect(forkMigrationBatchWarning([missing, { ...missing, outcomeIndex: 3n }])).toContain('do not select that child universe again for this share')
		expect(forkMigrationBatchWarning([ready, missing])).toContain('Another share can migrate into those child universes together once their security pools are ready')
		expect(forkMigrationBatchWarning([ready, { ...ready, outcomeIndex: 3n }])).toBeUndefined()
	})

	test('explains every settlement input that keeps simulation disabled', () => {
		const unit = { settlementCollateralAttoEth: 10n ** 18n, shareTokenSupplyAttoShares: 10n ** 18n }
		expect(settlementInputBlocker('redeem-complete-set', undefined, 5n, undefined, [], 'YES', 1n, unit)).toBe('Enter an amount greater than zero.')
		expect(settlementInputBlocker('redeem-complete-set', undefined, 5n * 10n ** 18n, 6n * 10n ** 18n, [], 'YES', 1n, unit)).toContain('complete-set balance of 5 ETH')
		expect(settlementInputBlocker('redeem-complete-set', undefined, 5n * 10n ** 18n, 1n, [], 'YES', 1n, { settlementCollateralAttoEth: 5n * 10n ** 17n, shareTokenSupplyAttoShares: 10n ** 18n })).toBe('Amount too small to redeem any ETH.')
		expect(settlementInputBlocker('migrate-shares', undefined, 0n, undefined, [], 'YES', 1n, unit)).toContain('at least one child universe')
		expect(settlementInputBlocker('migrate-shares', undefined, 0n, undefined, [0n], 'YES', 0n, unit)).toBe('Your Yes balance is zero.')
		expect(settlementInputBlocker('redeem-winning-shares', 'The question has not resolved yet.', 0n, undefined, [], 'NO', 0n, unit)).toBe('The question has not resolved yet.')
	})

	test('points a closed market at the settlement step its state actually offers', () => {
		const open = { loadError: undefined, systemState: 0, universeForkTime: 0n, questionOutcome: 3 }
		expect(marketSettlementPath(open)).toBe('redeem-complete-sets')
		expect(marketSettlementPath({ ...open, questionOutcome: 1 })).toBe('redeem-winning-shares')
		expect(marketSettlementPath({ ...open, questionOutcome: 1, universeForkTime: 9n })).toBe('migrate-shares')
		expect(marketSettlementPath({ ...open, systemState: 3 })).toBe('unavailable')
		expect(marketSettlementPath({ ...open, loadError: 'RPC failed.' })).toBe('unavailable')
		expect(ticketCopy.formatTradingEndedDetail('redeem-winning-shares')).toBe('Trading has ended for this market. Use Settlement to redeem.')
		expect(ticketCopy.formatTradingEndedDetail('migrate-shares')).toContain('migrate your shares to a child universe')
		expect(ticketCopy.formatTradingEndedDetail('unavailable')).not.toContain('Use Settlement')
		expect(liquidityCopy.formatRemovalGuidance(undefined)).toContain('sell them on the Trade tab')
		expect(liquidityCopy.formatRemovalGuidance('redeem-complete-sets')).toContain('hold them until the question resolves')
		expect(liquidityCopy.formatRemovalGuidance('redeem-winning-shares')).not.toContain('until the question resolves')
		expect(liquidityCopy.formatRemovalGuidance('migrate-shares')).toContain('migrate them to a child universe')
		expect(liquidityCopy.formatRemovalGuidance('unavailable')).not.toContain('Settlement tab')
	})

	test('names the specific lifecycle or balance reason a settlement action is unavailable', () => {
		const open = { loadError: undefined, systemState: 0, universeForkTime: 0n, questionOutcome: 3 }
		const holdings = { invalid: 5n, yes: 7n, no: 6n }
		const empty = { invalid: 0n, yes: 0n, no: 0n }
		expect(settlementUnavailableReason('redeem-complete-set', open, holdings)).toBeUndefined()
		expect(settlementUnavailableReason('redeem-complete-set', open, empty)).toBe('You hold no complete sets. Redeeming needs equal Yes, No, and Invalid shares.')
		expect(settlementUnavailableReason('redeem-complete-set', open, undefined)).toBe('You hold no complete sets. Redeeming needs equal Yes, No, and Invalid shares.')
		expect(settlementUnavailableReason('redeem-complete-set', { ...open, universeForkTime: 1n }, holdings)).toBe('The universe forked. Migrate your shares to a child universe instead.')
		expect(settlementUnavailableReason('redeem-complete-set', { ...open, systemState: 1 }, holdings)).toBe('The security pool is not operational, so it cannot pay out ETH.')
		expect(settlementUnavailableReason('redeem-winning-shares', open, holdings)).toBe('The question has not resolved yet.')
		expect(settlementUnavailableReason('redeem-winning-shares', { ...open, questionOutcome: 2 }, { ...holdings, no: 0n })).toBe('You hold no No shares to redeem.')
		expect(settlementUnavailableReason('redeem-winning-shares', { ...open, questionOutcome: 2 }, { ...holdings, no: 1n })).toBeUndefined()
		expect(settlementUnavailableReason('migrate-shares', open, holdings)).toBe('The universe has not forked, so there is nothing to migrate.')
		expect(settlementUnavailableReason('migrate-shares', { ...open, universeForkTime: 1n }, empty)).toBe('You hold no Yes, No, or Invalid shares to migrate.')
		expect(settlementUnavailableReason('migrate-shares', { ...open, universeForkTime: 1n }, holdings)).toBeUndefined()
		expect(settlementUnavailableReason('migrate-shares', { ...open, loadError: 'boom' }, holdings)).toBe('Market data is unavailable. Refresh the market.')
	})

	test('settlement reasons agree with the availability flags for every operation and lifecycle', () => {
		const open = { loadError: undefined, systemState: 0, universeForkTime: 0n, questionOutcome: 1 }
		const balances = { invalid: 5n, yes: 7n, no: 6n }
		const fixtures = [
			{ name: 'resolved and operational', market: open, balances },
			{ name: 'forked', market: { ...open, universeForkTime: 1n }, balances },
			{ name: 'forked and non-operational', market: { ...open, universeForkTime: 1n, systemState: 1 }, balances },
			{ name: 'non-operational', market: { ...open, systemState: 1 }, balances },
			{ name: 'unresolved', market: { ...open, questionOutcome: 3 }, balances },
			{ name: 'zero balances', market: open, balances: { invalid: 0n, yes: 0n, no: 0n } },
			{ name: 'zero winning balance', market: open, balances: { ...balances, yes: 0n } },
			{ name: 'balances not loaded', market: open, balances: undefined },
			{ name: 'load error', market: { ...open, loadError: 'boom' }, balances },
			{ name: 'forked load error', market: { ...open, universeForkTime: 1n, loadError: 'boom' }, balances },
		]
		const operations: readonly SettlementOperation[] = ['redeem-complete-set', 'redeem-winning-shares', 'migrate-shares']
		for (const fixture of fixtures) {
			const availability = settlementAvailability(fixture.market, fixture.balances)
			const flags: Readonly<Record<SettlementOperation, boolean>> = { 'redeem-complete-set': availability.canRedeemCompleteSets, 'redeem-winning-shares': availability.canRedeemWinningShares, 'migrate-shares': availability.canMigrateShares }
			for (const operation of operations) {
				expect({ fixture: fixture.name, operation, available: settlementUnavailableReason(operation, fixture.market, fixture.balances) === undefined }).toEqual({ fixture: fixture.name, operation, available: flags[operation] })
			}
		}
	})

	test('never presents unavailable settlement balances as zero', () => {
		const unit = { settlementCollateralAttoEth: 10n ** 18n, shareTokenSupplyAttoShares: 10n ** 18n }
		expect(settlementBalanceLabel('disconnected', undefined, unit)).toBeUndefined()
		expect(settlementBalanceLabel('loading', 0n, unit)).toBeUndefined()
		expect(settlementBalanceLabel('error', 0n, unit)).toBeUndefined()
		expect(settlementBalanceStatus('disconnected', undefined, unit)).toBe('Connect a wallet to see your balance.')
		expect(settlementBalanceStatus('loading', 0n, unit)).toBe('Balance: Loading…')
		expect(settlementBalanceStatus('error', 0n, unit)).toBe('Balance: Unavailable')
		expect(settlementBalanceStatus('ready', 5n * 10n ** 18n, unit, 'YES')).toBe('Balance: 5 Yes')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, unit)).toBe('5 ETH')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, unit, 'YES')).toBe('5 Yes')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, unit, 'NO')).toBe('5 No')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, unit, 'INVALID')).toBe('5 Invalid')
	})

	test('blocks duplicate submission when a broadcast receipt is uncertain', () => {
		const hash = `0x${'55'.repeat(32)}` as const
		const warning = broadcastUncertainMessage('Settlement transaction', hash)
		expect(warning).toBe(`Settlement transaction ${hash} was broadcast, but its receipt could not be confirmed. Do not resubmit. Check this hash in your wallet or configured block explorer, then reload only after its final status is known.`)
		expect(positionControlsWorkflowLocked('error', warning)).toBeTrue()
		expect(positionControlsWorkflowLocked('preparing', undefined)).toBeTrue()
		expect(positionControlsWorkflowLocked('submitting', undefined)).toBeTrue()
		expect(positionControlsWorkflowLocked('idle', undefined)).toBeFalse()
	})

	test('does not let an older discovery response replace an active workflow', () => {
		expect(discoveryCommitAllowed(undefined, true, false)).toBeFalse()
		expect(discoveryCommitAllowed(undefined, false, true)).toBeFalse()
		expect(discoveryCommitAllowed(undefined, false, false)).toBeTrue()
		expect(discoveryCommitAllowed('position', true, false)).toBeTrue()
		expect(discoveryCommitAllowed('position', true, true)).toBeFalse()
		expect(discoveryCommitAllowed('liquidity', true, true)).toBeFalse()
		// A trade's refresh landing on another market whose own trade is running waits like any other refresh.
		expect(discoveryCommitAllowed('position', true, false, false)).toBeFalse()
		expect(discoveryCommitAllowed('position', false, false, false)).toBeTrue()
	})

	test('does not present a created pair as initialized before it has reserves and LP supply', () => {
		const pair = '0x0000000000000000000000000000000000000001' as const
		expect(livePairInitialized({ pair, lpTotalSupply: 0n, yesReserve: 0n, noReserve: 0n, tradingStatus: 6 })).toBeFalse()
		expect(livePairInitialized({ pair, lpTotalSupply: 1n, yesReserve: 1n, noReserve: 1n, tradingStatus: 0 })).toBeTrue()
	})
})
