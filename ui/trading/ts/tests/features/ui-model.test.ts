import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { bigintToSafeNumber, formatBpsMultiplier, formatCapacityOwnership, formatRoundedUnits, formatUnits, parseUnits, parseUnitsOrUndefined } from '../../lib/format.js'
import { attoSharesToCollateralAttoEth, averagePriceBps, collateralAttoEthToAttoShares, formatCollateralEth, formatCompleteSetValue, formatLpValue, formatOutcomeValue } from '../../lib/shareValue.js'
import { forkMigrationBatchBlocker, forkMigrationBatchWarning, insuredExitLimitMessage, migrationSimulationSummary, settlementBalanceLabel, settlementInputBlocker } from '../../features/LiveSettlementModel.js'
import { createSecurityPoolDeploymentIndex, liveBalancesForMarket, marketAcceptsNewRisk, publicErrorMessage, marketNewRiskBlocker, mapWithConcurrency, refreshSecurityPoolDeploymentEventIndex, registryBlockAnchorIsCanonical, settlementAvailability, shareBalanceScope, type LiveMarket } from '../../protocol/live.js'
import { maximumAfterSlippage, minimumAfterSlippage, requireTransactionSlippageBps, requireTransactionValidityMinutes, retainApprovedMaximum, retainApprovedMinimum } from '../../protocol/tradeQuote.js'
import { broadcastUncertainMessage, discoveryCommitAllowed, failedSubmissionTransition, livePairInitialized, parseSlippageBps, parseTransactionValidityMinutes, positionControlsWorkflowLocked, securityPoolAddressFromRoute } from '../../features/liveTradingControllerHelpers.js'
import { isTradingBrowseRoute, isTradingLookupRoute, tradingBrowseRouteFor, tradingRouting } from '../../lib/routing.js'
import { liveWorkflowRoutePresentation, portfolioRouteSubtitle } from '../../features/live/routePresentation.js'
import { liquidityOperationAvailable } from '../../features/live/useLiquidityWorkflowController.js'

describe('standalone trading UI model', () => {
	test('keeps the shared simulation banner as the only Browser Simulation disclosure', () => {
		expect(liveWorkflowRoutePresentation('markets', 'Browser Simulation', true).description).toBeUndefined()
		expect(liveWorkflowRoutePresentation('markets', 'Ethereum Mainnet', false).description).toBe('Ethereum Mainnet')
		expect(portfolioRouteSubtitle('Browser Simulation', true)).toBeUndefined()
		expect(portfolioRouteSubtitle('Ethereum Mainnet', false)).toBe('Ethereum Mainnet')
	})

	test('presents liquidity as its own workflow instead of repeating the market header', () => {
		expect(liveWorkflowRoutePresentation('liquidity', 'Browser Simulation', true)).toEqual({
			description: undefined,
			title: 'Liquidity',
		})
		expect(liveWorkflowRoutePresentation('market', 'Ethereum Mainnet', false)).toEqual({
			description: 'Ethereum Mainnet',
			title: 'Market',
		})
		expect(liveWorkflowRoutePresentation('create-market', 'Ethereum Mainnet', false).title).toBe('Create new market')
	})

	test('invalidates new-risk liquidity operations at the exact end boundary while preserving removal', () => {
		const market = { endTime: 2_000n, systemState: 0, awaitingForkContinuation: false, universeForkTime: 0n, questionOutcome: 3, tradingStatus: 0 }
		expect(liquidityOperationAvailable('initialize', market, 1_999n)).toBe(true)
		expect(liquidityOperationAvailable('add', market, 2_000n)).toBe(false)
		expect(liquidityOperationAvailable('initialize', market, 2_001n)).toBe(false)
		expect(liquidityOperationAvailable('remove', market, 2_001n)).toBe(true)
	})

	test('defaults to the address lookup and pairs each lookup workflow with its own browse route', () => {
		expect(tradingRouting.resolve('#/')).toBe('market')
		expect(tradingRouting.resolve('')).toBe('market')
		expect(tradingRouting.resolve('#/markets')).toBe('markets')
		expect(tradingRouting.resolve('#/security-pools')).toBe('security-pools')
		expect(isTradingLookupRoute('market')).toBeTrue()
		expect(isTradingLookupRoute('markets')).toBeFalse()
		expect(isTradingBrowseRoute('security-pools')).toBeTrue()
		expect(isTradingBrowseRoute('security-pool/0x1111111111111111111111111111111111111111')).toBeFalse()
		expect(tradingBrowseRouteFor('market')).toBe('markets')
		expect(tradingBrowseRouteFor('liquidity')).toBe('markets')
		expect(tradingBrowseRouteFor('create-market')).toBe('security-pools')
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
		expect(message).toBe('Balance refresh failed')
		expect(message).not.toContain(pool)
		expect(message).not.toContain(shareToken)
		expect(message).not.toContain(tokenId)
		expect(publicErrorMessage(new Error('RPC temporarily unavailable'), 'Balance refresh failed')).toBe('RPC temporarily unavailable')
	})
	test('parses only exact security pool detail routes', () => {
		const address = `0x${'AB'.repeat(20)}`
		expect(securityPoolAddressFromRoute(`security-pool/${address}`)).toBe(getAddress(address))
		expect(securityPoolAddressFromRoute('security-pool/not-an-address')).toBeUndefined()
	})

	test('parses and formats chain quantities without numbers', () => {
		expect(parseUnits('2 550 000.25')).toBe(2_550_000_250_000_000_000_000_000n)
		expect(parseUnitsOrUndefined(' 70\u00a0250.25 ', 2)).toBe(7_025_025n)
		expect(parseUnits('1.2345')).toBe(1_234_500_000_000_000_000n)
		expect(formatUnits(1_234_500_000_000_000_000n)).toBe('1.2345')
		expect(() => parseUnits('1.0000000000000000001')).toThrow('18 decimal places')
		expect(parseUnitsOrUndefined('70.25', 2)).toBe(7_025n)
		expect(parseUnitsOrUndefined('70.251', 2)).toBeUndefined()
		expect(parseUnitsOrUndefined('../70', 2)).toBeUndefined()
		expect(() => formatUnits(1n, -1)).toThrow('Decimals must be a nonnegative safe integer')
		expect(() => formatUnits(1n, 18, -1)).toThrow('Maximum fraction digits must be a nonnegative safe integer')
	})

	test('converts to a number only after proving the bigint is safe', () => {
		expect(bigintToSafeNumber(9_007_199_254_740_991n)).toBe(Number.MAX_SAFE_INTEGER)
		expect(() => bigintToSafeNumber(9_007_199_254_740_992n)).toThrow('safe integer range')
	})

	test('formats Statoblast settings for display', () => {
		expect(formatBpsMultiplier(25_000n)).toBe('2.5×')
		expect(formatCapacityOwnership(10_000n * 10n ** 18n, 9_500n * 10n ** 18n)).toBe('10,000 / 9,500 REP')
		expect(formatUnits(999_999_996_848_000_000n, 18, 12)).toBe('0.999999996848')
		expect(formatUnits(999_999_977_880_000_000n, 18, 12)).toBe('0.99999997788')
		expect(formatRoundedUnits(999_999_996_848_000_000n)).toBe('1')
		expect(formatRoundedUnits(4_999_500_000_000_000n)).toBe('0.005')
		expect(formatRoundedUnits(4_949_999_999_999_999n)).toBe('0.0049')
		expect(formatRoundedUnits(-4_999_500_000_000_000n)).toBe('-0.005')
		expect(formatRoundedUnits(123n, 18, 18)).toBe('0.000000000000000123')
	})

	test('presents share amounts as their settlement-collateral value at the pool rate', () => {
		// The pool mints 10^18 attoShares per attoETH at genesis, so raw share counts are unreadable without the rate.
		const genesis = { settlementCollateralAttoEth: 0n, shareTokenSupplyAttoShares: 0n }
		expect(attoSharesToCollateralAttoEth(5n * 10n ** 33n, genesis)).toBe(5n * 10n ** 15n)
		expect(collateralAttoEthToAttoShares(5n * 10n ** 15n, genesis)).toBe(5n * 10n ** 33n)
		const rate = { settlementCollateralAttoEth: 9n * 10n ** 18n, shareTokenSupplyAttoShares: 10n * 10n ** 36n }
		expect(attoSharesToCollateralAttoEth(10n ** 36n, rate)).toBe(9n * 10n ** 17n)
		expect(collateralAttoEthToAttoShares(9n * 10n ** 17n, rate)).toBe(10n ** 36n)
		expect(collateralAttoEthToAttoShares(1n, rate)).toBe(1_111_111_111_111_111_111n)
		expect(collateralAttoEthToAttoShares(1n, { settlementCollateralAttoEth: 0n, shareTokenSupplyAttoShares: 1n })).toBeUndefined()
		expect(() => attoSharesToCollateralAttoEth(-1n, rate)).toThrow('cannot be negative')
		expect(formatOutcomeValue(10n ** 36n, 'YES', rate)).toBe('0.9 YES')
		expect(formatCompleteSetValue(10n ** 36n, rate)).toBe('0.9 complete sets')
		// Exactly 0.005 ETH of shares under a rate that no longer divides evenly still reads as 0.005, while limits round down.
		const drifted = { settlementCollateralAttoEth: 9_999_999_999_999_999n, shareTokenSupplyAttoShares: 10n * 10n ** 36n }
		const shares = collateralAttoEthToAttoShares(5n * 10n ** 15n, drifted)
		if (shares === undefined) throw new Error('Drifted rate must convert')
		expect(formatOutcomeValue(shares, 'YES', drifted)).toBe('0.005 YES')
		expect(formatOutcomeValue(shares, 'YES', drifted, 4, 'down')).toBe('0.0049 YES')
		expect(formatCollateralEth(shares, drifted, 'down')).toBe('0.0049 ETH')
		expect(formatCollateralEth(shares, drifted)).toBe('0.005 ETH')
		expect(formatCompleteSetValue(10n ** 36n, { settlementCollateralAttoEth: 10n ** 18n, shareTokenSupplyAttoShares: 10n ** 36n })).toBe('1 complete set')
		expect(formatLpValue(10n ** 36n, rate)).toBe('0.9 LP')
		expect(averagePriceBps(6n * 10n ** 17n, 10n ** 36n, rate)).toBe(6_666n)
		expect(averagePriceBps(1n, 0n, rate)).toBeUndefined()
	})

	test('derives displayed transaction bounds with LP-favoring rounding', () => {
		expect(minimumAfterSlippage(10_001n)).toBe(9_950n)
		expect(maximumAfterSlippage(10_001n)).toBe(10_052n)
		expect(minimumAfterSlippage(1_001n, 250n)).toBe(975n)
		expect(maximumAfterSlippage(1_001n, 250n)).toBe(1_027n)
		expect(minimumAfterSlippage(1_000n, 0n)).toBe(1_000n)
		expect(minimumAfterSlippage(1_000n, 500n)).toBe(950n)
		expect(() => minimumAfterSlippage(1_000n, 501n)).toThrow('between 0% and 5%')
		expect(requireTransactionSlippageBps(0n)).toBeUndefined()
		expect(requireTransactionSlippageBps(500n)).toBeUndefined()
		expect(() => requireTransactionSlippageBps(501n)).toThrow('between 0% and 5%')
		expect(requireTransactionValidityMinutes(1n)).toBeUndefined()
		expect(requireTransactionValidityMinutes(1_440n)).toBeUndefined()
		expect(() => requireTransactionValidityMinutes(0n)).toThrow('between 1 and 1440 minutes')
		expect(() => requireTransactionValidityMinutes(1_441n)).toThrow('between 1 and 1440 minutes')
	})

	test('validates user-configurable transaction protection settings', () => {
		expect(parseSlippageBps('0.75')).toBe(75n)
		expect(parseSlippageBps('5')).toBe(500n)
		expect(parseSlippageBps('5.01')).toBeUndefined()
		expect(parseSlippageBps('-1')).toBeUndefined()
		expect(parseTransactionValidityMinutes('1')).toBe(1n)
		expect(parseTransactionValidityMinutes('1440')).toBe(1_440n)
		expect(parseTransactionValidityMinutes('0')).toBeUndefined()
		expect(parseTransactionValidityMinutes('1441')).toBeUndefined()
		expect(parseTransactionValidityMinutes('1.5')).toBeUndefined()
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
		expect(marketNewRiskBlocker({ ...open, tradingStatus: undefined, systemState: 3 }, 1_000n)).toBe('Pool inactive')
		expect(marketNewRiskBlocker({ ...open, tradingStatus: undefined, questionOutcome: 0 }, 1_000n)).toBe('Resolved INVALID')
		expect(marketNewRiskBlocker({ ...open, tradingStatus: undefined }, 2_000n)).toBe('Question ended')
		expect(marketNewRiskBlocker({ ...open, tradingStatus: 0 }, 2_000n)).toBe('Question ended')
	})

	test('increments a selected-universe event index without rescanning historical blocks', async () => {
		const index = createSecurityPoolDeploymentIndex<string, { blockHash: `0x${string}`; blockNumber: bigint }>()
		let latest = { blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 100n }
		const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = []
		const loadEvents = async (fromBlock: bigint, toBlock: bigint) => {
			ranges.push({ fromBlock, toBlock })
			return [`${fromBlock.toString()}-${toBlock.toString()}`]
		}
		const canonical = async () => true
		expect(await refreshSecurityPoolDeploymentEventIndex(index, 'chain:factory:universe-7', async () => latest, canonical, loadEvents)).toEqual(['0-100'])
		latest = { blockHash: `0x${'22'.repeat(32)}` as const, blockNumber: 105n }
		expect(await refreshSecurityPoolDeploymentEventIndex(index, 'chain:factory:universe-7', async () => latest, canonical, loadEvents)).toEqual(['0-100', '101-105'])
		expect(ranges).toEqual([
			{ fromBlock: 0n, toBlock: 100n },
			{ fromBlock: 101n, toBlock: 105n },
		])
	})

	test('chunks a selected-universe genesis rebuild within the bounded log range', async () => {
		const index = createSecurityPoolDeploymentIndex<string, { blockHash: `0x${string}`; blockNumber: bigint }>()
		const latest = { blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 20_000n }
		const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = []
		const result = await refreshSecurityPoolDeploymentEventIndex(
			index,
			'chain:factory:universe-7',
			async () => latest,
			async () => true,
			async (fromBlock, toBlock) => {
				ranges.push({ fromBlock, toBlock })
				if (toBlock - fromBlock + 1n > 10_000n) throw new Error('block range is too large')
				return [`${fromBlock.toString()}-${toBlock.toString()}`]
			},
		)
		expect(result).toEqual(['0-9999', '10000-19999', '20000-20000'])
		expect(ranges).toEqual([
			{ fromBlock: 0n, toBlock: 9_999n },
			{ fromBlock: 10_000n, toBlock: 19_999n },
			{ fromBlock: 20_000n, toBlock: 20_000n },
		])
	})

	test('does not retain orphan deployment events when the discovery anchor is replaced', async () => {
		const index = createSecurityPoolDeploymentIndex<string, { blockHash: `0x${string}`; blockNumber: bigint }>()
		const orphanAnchor = { blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 100n }
		const canonicalAnchor = { blockHash: `0x${'22'.repeat(32)}` as const, blockNumber: 100n }
		let latest = orphanAnchor
		let canonicalHash = canonicalAnchor.blockHash
		await expect(
			refreshSecurityPoolDeploymentEventIndex(
				index,
				'chain:factory:universe-7',
				async () => latest,
				async anchor => anchor.blockHash === canonicalHash,
				async () => ['orphan'],
			),
		).rejects.toThrow('deployment events changed during discovery')
		expect(index.deployments).toEqual([])
		expect(index.anchor).toBeUndefined()

		latest = canonicalAnchor
		canonicalHash = canonicalAnchor.blockHash
		expect(
			await refreshSecurityPoolDeploymentEventIndex(
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

	test('rebuilds when the retained deployment anchor is replaced during an incremental event read', async () => {
		const index = createSecurityPoolDeploymentIndex<string, { blockHash: `0x${string}`; blockNumber: bigint }>()
		const retainedAnchor = { blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 100n }
		const latestAnchor = { blockHash: `0x${'22'.repeat(32)}` as const, blockNumber: 101n }
		await refreshSecurityPoolDeploymentEventIndex(
			index,
			'chain:factory:universe-7',
			async () => retainedAnchor,
			async () => true,
			async () => ['orphan'],
		)

		let retainedAnchorCanonical = true
		const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = []
		const result = await refreshSecurityPoolDeploymentEventIndex(
			index,
			'chain:factory:universe-7',
			async () => latestAnchor,
			async anchor => anchor.blockHash !== retainedAnchor.blockHash || retainedAnchorCanonical,
			async (fromBlock, toBlock) => {
				ranges.push({ fromBlock, toBlock })
				if (fromBlock === 101n) {
					retainedAnchorCanonical = false
					return ['incremental-on-replacement']
				}
				return ['canonical-rebuild']
			},
		)

		expect(result).toEqual(['canonical-rebuild'])
		expect(index.deployments).toEqual(['canonical-rebuild'])
		expect(index.anchor).toEqual(latestAnchor)
		expect(ranges).toEqual([
			{ fromBlock: 101n, toBlock: 101n },
			{ fromBlock: 0n, toBlock: 101n },
		])
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

	test('requires an explicit fork branch and names the irreversible consequence', () => {
		expect(migrationSimulationSummary(42n, 'YES', 12n)).toBe('Fork migration simulation ready at block 42: the entire selected YES balance will be copied into 12 selected child branches and locked in the parent universe.')
	})

	test('allows many ready fork children while requiring missing children to be created singly', () => {
		const ready = { outcomeIndex: 1n, universeId: 11n, label: 'Ready', canonicalPool: `0x${'11'.repeat(20)}` as const }
		const missing = { outcomeIndex: 2n, universeId: 12n, label: 'Missing', canonicalPool: undefined }
		expect(forkMigrationBatchBlocker([ready, { ...ready, outcomeIndex: 3n }])).toBeUndefined()
		expect(forkMigrationBatchBlocker([missing])).toBeUndefined()
		expect(forkMigrationBatchBlocker([ready, missing])).toContain('separately for the current source share')
		expect(forkMigrationBatchWarning([missing, { ...missing, outcomeIndex: 3n }])).toContain('do not select that same source-child pair again')
		expect(forkMigrationBatchWarning([ready, missing])).toContain('A different source share may batch those children once their pools are ready')
		expect(forkMigrationBatchWarning([ready, { ...ready, outcomeIndex: 3n }])).toBeUndefined()
	})

	test('explains every settlement input that keeps simulation disabled', () => {
		const unit = { settlementCollateralAttoEth: 10n ** 18n, shareTokenSupplyAttoShares: 10n ** 18n }
		expect(settlementInputBlocker('redeem-complete-set', true, 5n, undefined, [], 'YES', 1n, unit)).toBe('Enter a valid positive complete-set value')
		expect(settlementInputBlocker('redeem-complete-set', true, 5n * 10n ** 18n, 6n * 10n ** 18n, [], 'YES', 1n, unit)).toContain('complete-set balance of 5 ETH')
		expect(settlementInputBlocker('redeem-complete-set', true, 5n * 10n ** 36n, 10n ** 17n, [], 'YES', 1n, { settlementCollateralAttoEth: 10n ** 18n, shareTokenSupplyAttoShares: 10n ** 36n })).toBe('Amount too small to redeem any ETH')
		expect(settlementInputBlocker('migrate-shares', true, 0n, undefined, [], 'YES', 1n, unit)).toContain('at least one child branch')
		expect(settlementInputBlocker('migrate-shares', true, 0n, undefined, [0n], 'YES', 0n, unit)).toBe('The selected YES balance is zero')
		expect(settlementInputBlocker('redeem-winning-shares', false, 0n, undefined, [], 'NO', 0n, unit)).toContain('unavailable')
	})

	test('never presents unavailable settlement balances as zero', () => {
		const unit = { settlementCollateralAttoEth: 10n ** 18n, shareTokenSupplyAttoShares: 10n ** 18n }
		expect(settlementBalanceLabel('disconnected', undefined, unit)).toBe('Not loaded')
		expect(settlementBalanceLabel('loading', 0n, unit)).toBe('Loading…')
		expect(settlementBalanceLabel('error', 0n, unit)).toBe('Unavailable')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, unit)).toBe('5 ETH')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, unit, 'YES')).toBe('5 YES')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, unit, 'NO')).toBe('5 NO')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, unit, 'INVALID')).toBe('5 INVALID')
	})

	test('discards failed submission quotes so every workflow can simulate again', () => {
		expect(failedSubmissionTransition(new Error('Quote is stale'), 'Transaction failed')).toEqual({ quote: undefined, state: 'error', message: 'Quote is stale' })
		expect(failedSubmissionTransition('wallet rejected', 'Transaction failed')).toEqual({ quote: undefined, state: 'error', message: 'Transaction failed' })
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
	})

	test('does not present a created pair as initialized before it has reserves and LP supply', () => {
		const pair = '0x0000000000000000000000000000000000000001' as const
		expect(livePairInitialized({ pair, lpTotalSupply: 0n, yesReserve: 0n, noReserve: 0n, tradingStatus: 6 })).toBeFalse()
		expect(livePairInitialized({ pair, lpTotalSupply: 1n, yesReserve: 1n, noReserve: 1n, tradingStatus: 0 })).toBeTrue()
	})

	test('attributes insured-exit limits to INVALID only when INVALID is insufficient', () => {
		const unit = { settlementCollateralAttoEth: 10n ** 18n, shareTokenSupplyAttoShares: 10n ** 18n }
		expect(insuredExitLimitMessage(11n * 10n ** 18n, 5n * 10n ** 18n, 10n * 10n ** 18n, unit)).toContain('insured exit of at most 5 ETH')
		expect(insuredExitLimitMessage(11n * 10n ** 18n, 4n * 10n ** 18n, 4n * 10n ** 18n, unit)).toContain('INVALID balance covers only 4 ETH of complete sets')
	})
})
