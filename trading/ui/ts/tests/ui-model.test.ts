import { describe, expect, test } from 'bun:test'
import { bigintToSafeNumber, formatBpsMultiplier, formatCapacityOwnership, formatEthPerShare, formatOutcomeAmount, formatShareAmount, formatUnits, parseUnits, parseUnitsOrUndefined } from '../app/format.ts'
import { demoAttoEthToAttoShares, demoAttoSharesToAttoEth, demoMarket, demoWalletBalances, lifecycleLabel, tradingClosedReason } from '../demo/markets.ts'
import { demoPreviewPresentation, quoteDemoEnterPosition, transactionMessage } from '../features/MarketDetail.tsx'
import {
	approvalFailureTransition,
	broadcastUncertainMessage,
	discoveryCommitAllowed,
	failedSubmissionTransition,
	insuredExitLimitMessage,
	liquidityApprovalRequired,
	liquidityOperationAvailable,
	livePairInitialized,
	marketSelectionAfterDiscovery,
	migrationSimulationSummary,
	parseForkOutcomeIndex,
	parseSlippageBps,
	parseTransactionValidityMinutes,
	positionControlsWorkflowLocked,
	securityPoolAddressFromRoute,
	settlementBalanceLabel,
	settlementInputBlocker,
} from '../features/LiveTrading.tsx'
import { liquidityActionAvailability, parseConditionalProbabilityBps, quoteDemoEthLiquidity, quoteDemoRemoval } from '../features/Routes.tsx'
import { roundedProbabilityLabels } from '../components/ProbabilityBar.tsx'
import {
	collateMarketDiscoveryResults,
	createSecurityPoolDeploymentIndex,
	liveBalancesForMarket,
	marketAcceptsNewRisk,
	marketDiscoveryPage,
	marketDiscoveryRanges,
	publicErrorMessage,
	marketNewRiskBlocker,
	mapWithConcurrency,
	maximumAfterSlippage,
	minimumAfterSlippage,
	retainApprovedMaximum,
	retainApprovedMinimum,
	refreshSecurityPoolDeploymentIndex,
	requireTransactionSlippageBps,
	requireTransactionValidityMinutes,
	selectUniverseDeployments,
	settlementAvailability,
	shareBalanceScope,
	type LiveMarket,
} from '../protocol/live.ts'
import { maximumInsuredExit } from '../../../ts/sdk/positions.ts'

describe('standalone trading UI model', () => {
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
		expect(securityPoolAddressFromRoute(`security-pool/${address}`)).toBe(address.toLowerCase())
		expect(securityPoolAddressFromRoute('security-pool/not-an-address')).toBeUndefined()
	})

	test('derives exact lifecycle reasons', () => {
		expect(tradingClosedReason(demoMarket('ended').lifecycle)).toBe('Question ended')
		expect(tradingClosedReason(demoMarket('forked').lifecycle)).toBe('Parent universe forked')
		expect(lifecycleLabel(demoMarket('resolved-invalid').lifecycle)).toBe('Resolved INVALID')
		expect(tradingClosedReason(demoMarket('truth-auction').lifecycle)).toBe('Truth auction in progress')
		expect(demoMarket('truth-auction').securityPool.systemState).toBe('Fork truth auction')
		expect(demoMarket('truth-auction').universe).toBe('Child universe · YES branch')
		expect(demoMarket('truth-auction').pool).not.toBe(demoMarket('baseline').pool)
	})

	test('keeps truth-auction liquidity removal available while create and add are closed', () => {
		expect(liquidityActionAvailability(demoMarket('truth-auction'))).toEqual({ initialize: false, add: false, remove: true })
	})

	test('invalidates new-risk liquidity operations at the exact end boundary while preserving removal', () => {
		const market = { endTime: 2_000n, systemState: 0, awaitingForkContinuation: false, universeForkTime: 0n, questionOutcome: 3, tradingStatus: 0 }
		expect(liquidityOperationAvailable('initialize', market, 1_999n)).toBe(true)
		expect(liquidityOperationAvailable('add', market, 2_000n)).toBe(false)
		expect(liquidityOperationAvailable('initialize', market, 2_001n)).toBe(false)
		expect(liquidityOperationAvailable('remove', market, 2_001n)).toBe(true)
	})

	test('keeps demo liquidity states mutually exclusive', () => {
		expect(liquidityActionAvailability(demoMarket('baseline'))).toEqual({ initialize: false, add: true, remove: true })
		expect(liquidityActionAvailability(demoMarket('missing-pair'))).toEqual({ initialize: true, add: false, remove: false })
		expect(liquidityActionAvailability(demoMarket('uninitialized-pair'))).toEqual({ initialize: true, add: false, remove: false })
		expect(liquidityActionAvailability(demoMarket('ended-missing-pair'))).toEqual({ initialize: false, add: false, remove: false })
		expect(quoteDemoEthLiquidity(demoMarket('missing-pair'), 7_000n).added).toBeUndefined()
	})

	test('parses demo conditional prices as bounded two-decimal fixed point', () => {
		expect(parseConditionalProbabilityBps('70.25')).toEqual({ value: 7_025n, error: undefined })
		expect(parseConditionalProbabilityBps('0').error).toContain('above 0%')
		expect(parseConditionalProbabilityBps('100').error).toContain('below 100%')
		expect(parseConditionalProbabilityBps('70.251').error).toContain('at most two decimal places')
		expect(parseConditionalProbabilityBps('not-a-price').error).toContain('at most two decimal places')
		expect(parseConditionalProbabilityBps('9'.repeat(1_000)).error).toContain('below 100%')
	})

	test('keeps displayed conditional prices complementary after rounding', () => {
		expect(roundedProbabilityLabels(70.25)).toEqual({ yes: '70.3', no: '29.7' })
		expect(roundedProbabilityLabels(50.05)).toEqual({ yes: '50.1', no: '49.9' })
	})

	test('announces nonterminal demo transaction progress', () => {
		expect(transactionMessage('approval')).toContain('approval')
		expect(transactionMessage('pending')).toContain('pending')
	})

	test('explains the actual blocker when a demo quote is unavailable', () => {
		expect(demoPreviewPresentation({ scenario: 'baseline', hasQuote: false, pairExists: false, closedReason: undefined, inputValid: true, capacityAvailable: true })).toEqual({ tone: 'warn', label: 'Pair initialization required', message: 'Create and initialize the pair before previewing a trade.' })
		expect(demoPreviewPresentation({ scenario: 'ended', hasQuote: false, pairExists: true, closedReason: 'Question ended', inputValid: true, capacityAvailable: true })).toEqual({
			tone: 'warn',
			label: 'Trading closed',
			message: 'Trading and added liquidity are unavailable: Question ended. Raw LP removal remains available.',
		})
	})

	test('requires LP approval only after authoritative balances are ready', () => {
		for (const state of ['disconnected', 'loading', 'error'] as const) expect(liquidityApprovalRequired(state, 'remove', 1n, 0n)).toBeFalse()
		expect(liquidityApprovalRequired('ready', 'remove', 1n, 0n)).toBeTrue()
		expect(liquidityApprovalRequired('ready', 'remove', 1n, 1n)).toBeFalse()
		expect(liquidityApprovalRequired('ready', 'add', 1n, 0n)).toBeFalse()
	})

	test('uses the live SecurityPool rate for ETH-funded liquidity previews', () => {
		const market = demoMarket('baseline')
		const { initial, added, addedCompleteSetShares } = quoteDemoEthLiquidity(market, 7_000n)
		if (added === undefined) throw new Error('Initialized demo market must quote added liquidity')
		expect(formatShareAmount(initial.invalidReturned)).toBe('1.0127 shares')
		expect(formatShareAmount(addedCompleteSetShares)).toBe('0.1012 shares')
		expect(added.yesUsed).toBeLessThanOrEqual(addedCompleteSetShares)
		expect(added.noUsed).toBeLessThanOrEqual(addedCompleteSetShares)
	})

	test('parses and formats chain quantities without numbers', () => {
		expect(parseUnits('1.2345')).toBe(1_234_500_000_000_000_000n)
		expect(formatUnits(1_234_500_000_000_000_000n)).toBe('1.2345')
		expect(() => parseUnits('1.0000000000000000001')).toThrow('18 decimal places')
		expect(parseUnitsOrUndefined('70.25', 2)).toBe(7_025n)
		expect(parseUnitsOrUndefined('70.251', 2)).toBeUndefined()
		expect(parseUnitsOrUndefined('../70', 2)).toBeUndefined()
	})

	test('converts to a number only after proving the bigint is safe', () => {
		expect(bigintToSafeNumber(9_007_199_254_740_991n)).toBe(Number.MAX_SAFE_INTEGER)
		expect(() => bigintToSafeNumber(9_007_199_254_740_992n)).toThrow('safe integer range')
	})

	test('formats 18-decimal shares and Statoblast settings for display', () => {
		expect(formatShareAmount(1_234_500_000_000_000_000n)).toBe('1.2345 shares')
		expect(formatOutcomeAmount(10n * 10n ** 18n, 'YES')).toBe('10 YES')
		expect(formatBpsMultiplier(25_000n)).toBe('2.5×')
		expect(formatCapacityOwnership(10_000n * 10n ** 18n, 9_500n * 10n ** 18n)).toBe('10,000 / 9,500 REP')
		expect(formatEthPerShare(12_342_500_000_000_000_000n, 12_500_000_000_000_000_000n)).toBe('0.9874 ETH / share')
		expect(formatUnits(999_999_996_848_000_000n, 18, 12)).toBe('0.999999996848')
		expect(formatUnits(999_999_977_880_000_000n, 18, 12)).toBe('0.99999997788')
	})

	test('converts ETH to share units using the live SecurityPool exchange rate once', () => {
		const market = demoMarket('baseline')
		const shares = demoAttoEthToAttoShares(250_000_000_000_000_000n, market)
		expect(formatShareAmount(shares)).toBe('0.2531 shares')
		expect((shares * market.securityPool.settlementCollateralAttoEth) / market.securityPool.shareTokenSupplyAttoShares).toBeLessThanOrEqual(250_000_000_000_000_000n)
	})

	test('wires the live-rate complete-set amount into the enter quote', () => {
		const quote = quoteDemoEnterPosition(demoMarket('baseline'), 'YES', 250_000_000_000_000_000n)
		expect(formatShareAmount(quote.completeSetShares)).toBe('0.2531 shares')
		expect(quote.completeSetShares).toBeGreaterThan(250_000_000_000_000_000n)
	})

	test('derives exit ETH from the current SecurityPool redemption rate', () => {
		const market = demoMarket('baseline')
		const shares = demoAttoEthToAttoShares(250_000_000_000_000_000n, market)
		expect(demoAttoSharesToAttoEth(shares, market)).toBeLessThanOrEqual(250_000_000_000_000_000n)
		expect(demoAttoSharesToAttoEth(shares * 2n, market)).toBeGreaterThan(demoAttoSharesToAttoEth(shares, market))
	})

	test('uses the authoritative LP supply for removal previews', () => {
		const removed = quoteDemoRemoval(demoMarket('baseline'), 100n * 10n ** 18n)
		expect(formatShareAmount(removed.yesOut)).toBe('100 shares')
		expect(formatShareAmount(removed.noOut)).toBe('233.3335 shares')
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

	test('bounds market discovery into deterministic RPC pages', () => {
		expect(marketDiscoveryRanges(0n)).toEqual([])
		expect(marketDiscoveryRanges(51n)).toEqual([
			{ start: 0n, count: 25n },
			{ start: 25n, count: 25n },
			{ start: 50n, count: 1n },
		])
		expect(() => marketDiscoveryRanges(1n, 0n)).toThrow('Invalid market discovery range')
		expect(marketDiscoveryPage(51n, 25n)).toEqual({ start: 25n, count: 25n, previousStart: 0n, nextStart: 50n })
		expect(marketDiscoveryPage(51n, 99n)).toEqual({ start: 50n, count: 1n, previousStart: 25n, nextStart: undefined })
		expect(marketDiscoveryPage(0n)).toEqual({ start: 0n, count: 0n, previousStart: undefined, nextStart: undefined })
		expect(() => marketDiscoveryPage(1n, -1n)).toThrow('Invalid market discovery page')
	})

	test('enumerates universes while selecting pools from only one universe', () => {
		const deployments = [
			{ universeId: 1n, pool: 'first' },
			{ universeId: 2n, pool: 'child' },
			{ universeId: 1n, pool: 'second' },
		]
		const firstUniverseDeployments = [
			{ universeId: 1n, pool: 'first' },
			{ universeId: 1n, pool: 'second' },
		]
		expect(selectUniverseDeployments(deployments, 1n)).toEqual({ universeIds: [1n, 2n], selectedUniverseId: 1n, selectedDeployments: firstUniverseDeployments })
		expect(selectUniverseDeployments(deployments, 99n)).toEqual({ universeIds: [1n, 2n], selectedUniverseId: 1n, selectedDeployments: firstUniverseDeployments })
		expect(selectUniverseDeployments([], undefined)).toEqual({ universeIds: [], selectedUniverseId: undefined, selectedDeployments: [] })
	})

	test('increments the deployment index without rereading known registry ranges', async () => {
		const index = createSecurityPoolDeploymentIndex<{ universeId: bigint; pool: string }, string>()
		let total = 5n
		let anchor = 'block-1'
		const deployments = Array.from({ length: 7 }, (_value, position) => ({ universeId: position < 3 ? 1n : 2n, pool: `pool-${position}` }))
		const rangeReads: Array<{ start: bigint; count: bigint }> = []
		const loadRange = async (start: bigint, count: bigint, _anchor: string) => {
			rangeReads.push({ start, count })
			return deployments.slice(bigintToSafeNumber(start, 'test range start'), bigintToSafeNumber(start + count, 'test range end'))
		}
		const loadSnapshot = async () => ({ anchor, total })
		const isAnchorCanonical = async () => true
		expect(await refreshSecurityPoolDeploymentIndex(index, 'chain:factory', loadSnapshot, isAnchorCanonical, loadRange, 2n)).toEqual(deployments.slice(0, 5))
		expect(rangeReads).toEqual([
			{ start: 0n, count: 2n },
			{ start: 2n, count: 2n },
			{ start: 4n, count: 1n },
		])
		rangeReads.length = 0
		expect(await refreshSecurityPoolDeploymentIndex(index, 'chain:factory', loadSnapshot, isAnchorCanonical, loadRange, 2n)).toEqual(deployments.slice(0, 5))
		expect(rangeReads).toEqual([])
		rangeReads.length = 0
		total = 7n
		anchor = 'block-2'
		expect(await refreshSecurityPoolDeploymentIndex(index, 'chain:factory', loadSnapshot, isAnchorCanonical, loadRange, 2n)).toEqual(deployments)
		expect(rangeReads).toEqual([{ start: 5n, count: 2n }])
	})

	test('serializes deployment-index waiters without duplicate appends', async () => {
		const index = createSecurityPoolDeploymentIndex<{ universeId: bigint; pool: string }, string>()
		const deployments = Array.from({ length: 5 }, (_value, position) => ({ universeId: 1n, pool: `pool-${position}` }))
		let releaseFirstRange: () => void = () => undefined
		let announceFirstRange: () => void = () => undefined
		const firstRangeStarted = new Promise<void>(resolve => {
			announceFirstRange = resolve
		})
		const firstRangeGate = new Promise<void>(resolve => {
			releaseFirstRange = resolve
		})
		let activeRangeReads = 0
		let maximumActiveRangeReads = 0
		const loadRange = async (start: bigint, count: bigint, _anchor: string) => {
			activeRangeReads += 1
			maximumActiveRangeReads = Math.max(maximumActiveRangeReads, activeRangeReads)
			if (start === 0n) {
				announceFirstRange()
				await firstRangeGate
			}
			await Promise.resolve()
			activeRangeReads -= 1
			return deployments.slice(bigintToSafeNumber(start, 'test range start'), bigintToSafeNumber(start + count, 'test range end'))
		}
		const isAnchorCanonical = async () => true
		const first = refreshSecurityPoolDeploymentIndex(index, 'chain:factory', async () => ({ anchor: 'block-1', total: 2n }), isAnchorCanonical, loadRange, 5n)
		await firstRangeStarted
		const second = refreshSecurityPoolDeploymentIndex(index, 'chain:factory', async () => ({ anchor: 'block-2', total: 4n }), isAnchorCanonical, loadRange, 5n)
		const third = refreshSecurityPoolDeploymentIndex(index, 'chain:factory', async () => ({ anchor: 'block-3', total: 5n }), isAnchorCanonical, loadRange, 5n)
		releaseFirstRange()
		await Promise.all([first, second, third])
		expect(maximumActiveRangeReads).toBe(1)
		expect(index.deployments).toEqual(deployments)
	})

	test('reloads the deployment index after an equal-count registry replacement', async () => {
		const index = createSecurityPoolDeploymentIndex<{ universeId: bigint; pool: string }, string>()
		let deployments = [
			{ universeId: 1n, pool: 'parent' },
			{ universeId: 2n, pool: 'orphaned-child' },
		]
		let canonicalAnchor = 'block-1'
		const loadRange = async (start: bigint, count: bigint, _anchor: string) => deployments.slice(bigintToSafeNumber(start, 'test range start'), bigintToSafeNumber(start + count, 'test range end'))
		const isAnchorCanonical = async (candidate: string) => candidate === canonicalAnchor
		expect(await refreshSecurityPoolDeploymentIndex(index, 'chain:factory', async () => ({ anchor: canonicalAnchor, total: 2n }), isAnchorCanonical, loadRange, 25n)).toEqual(deployments)
		deployments = [
			{ universeId: 3n, pool: 'canonical-parent' },
			{ universeId: 2n, pool: 'orphaned-child' },
		]
		canonicalAnchor = 'block-2'
		expect(await refreshSecurityPoolDeploymentIndex(index, 'chain:factory', async () => ({ anchor: canonicalAnchor, total: 2n }), isAnchorCanonical, loadRange, 25n)).toEqual(deployments)
	})

	test('accepts a canonical registry snapshot when the chain tip advances during loading', async () => {
		const index = createSecurityPoolDeploymentIndex<{ universeId: bigint; pool: string }, string>()
		const deployments = [{ universeId: 1n, pool: 'parent' }]
		let tip = 'block-1'
		const canonicalAnchors = new Set(['block-1', 'block-2'])
		const loadRange = async (start: bigint, count: bigint, _anchor: string) => {
			tip = 'block-2'
			return deployments.slice(bigintToSafeNumber(start, 'test range start'), bigintToSafeNumber(start + count, 'test range end'))
		}
		const result = await refreshSecurityPoolDeploymentIndex(
			index,
			'chain:factory',
			async () => ({ anchor: tip, total: 1n }),
			async anchor => canonicalAnchors.has(anchor),
			loadRange,
		)
		expect(tip).toBe('block-2')
		expect(result).toEqual(deployments)
		expect(index.anchor).toBe('block-1')
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

	test('isolates one failed market read into an explicit unavailable row', () => {
		const pool = `0x${'12'.repeat(20)}` as const
		const shareToken = `0x${'34'.repeat(20)}` as const
		const deployments = [{ securityPool: pool, shareToken, universeId: 7n, questionId: 9n, statoblastSecurityMultiplierBps: 20_000n, initialReportPriorityFeeAttoEthPerGas: 1n }]
		const results = [{ status: 'rejected', reason: new Error(`Contract read failed at ${pool}: share token ${shareToken}, token ID 1793, call arguments unavailable`) }] satisfies PromiseRejectedResult[]
		const [market] = collateMarketDiscoveryResults(deployments, results, 30)
		if (market === undefined) throw new Error('Expected unavailable market row')
		expect(market.pool).toBe(pool)
		expect(market.loadError).toBe('Market reads failed')
		expect(market.loadError).not.toContain(pool)
		expect(market.loadError).not.toContain(shareToken)
		expect(market.loadError).not.toContain('1793')
		expect(marketNewRiskBlocker(market, 0n)).toBe('Market data unavailable')
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
		const scope = shareBalanceScope(demoMarket('max-token-ids'))
		expect(scope.invalidTokenId).toBe((1n << 256n) - 256n)
		expect(scope.yesTokenId).toBe((1n << 256n) - 255n)
		expect(scope.noTokenId).toBe((1n << 256n) - 254n)
	})

	test('never exposes balances under another SecurityPool identity', () => {
		const firstMarket = { pool: `0x${'11'.repeat(20)}`, shareToken: `0x${'22'.repeat(20)}`, universeId: 7n } as const
		const secondMarket = { pool: `0x${'33'.repeat(20)}`, shareToken: `0x${'44'.repeat(20)}`, universeId: 8n } as const
		const firstBalances = { scope: shareBalanceScope(firstMarket), invalid: 1n, yes: 2n, no: 3n, lp: 4n, approved: true, lpAllowance: 5n }
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
		expect(parseForkOutcomeIndex('')).toBeUndefined()
		expect(parseForkOutcomeIndex('-1')).toBeUndefined()
		expect(parseForkOutcomeIndex('12')).toBe(12n)
		expect(migrationSimulationSummary(42n, 'YES', 12n)).toBe('Fork migration simulation ready at block 42: the entire selected YES balance will be copied to child outcome index 12 and locked in the parent universe.')
	})

	test('preserves same-page market context but selects the first pool after navigation', () => {
		const first = `0x${'11'.repeat(20)}` as const
		const selected = `0x${'22'.repeat(20)}` as const
		const markets = [{ pool: first }, { pool: selected }]
		expect(marketSelectionAfterDiscovery(markets, selected, true)).toBe(selected)
		expect(marketSelectionAfterDiscovery(markets, selected, false)).toBe(first)
		expect(marketSelectionAfterDiscovery([{ pool: first }], selected, true)).toBe(first)
	})

	test('explains every settlement input that keeps simulation disabled', () => {
		expect(settlementInputBlocker('redeem-complete-set', true, 5n, undefined, undefined, 'YES', 1n)).toBe('Enter a valid positive complete-set share amount')
		expect(settlementInputBlocker('redeem-complete-set', true, 5n * 10n ** 18n, 6n * 10n ** 18n, undefined, 'YES', 1n)).toContain('complete-set balance of 5 shares')
		expect(settlementInputBlocker('migrate-shares', true, 0n, undefined, undefined, 'YES', 1n)).toContain('explicit non-negative outcome index')
		expect(settlementInputBlocker('migrate-shares', true, 0n, undefined, 0n, 'YES', 0n)).toBe('The selected YES balance is zero')
		expect(settlementInputBlocker('redeem-winning-shares', false, 0n, undefined, undefined, 'NO', 0n)).toContain('unavailable')
	})

	test('never presents unavailable settlement balances as zero', () => {
		expect(settlementBalanceLabel('disconnected', undefined)).toBe('Not loaded')
		expect(settlementBalanceLabel('loading', 0n)).toBe('Loading…')
		expect(settlementBalanceLabel('error', 0n)).toBe('Unavailable')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n)).toBe('5 shares')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, 'YES')).toBe('5 YES')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, 'NO')).toBe('5 NO')
		expect(settlementBalanceLabel('ready', 5n * 10n ** 18n, 'INVALID')).toBe('5 INVALID')
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
		expect(positionControlsWorkflowLocked('idle', undefined)).toBeFalse()
	})

	test('keeps both approval workflows locked after an unconfirmed broadcast', () => {
		const hash = `0x${'77'.repeat(32)}` as const
		for (const label of ['Share-token approval', 'LP-token approval']) {
			const transition = approvalFailureTransition(label, hash, false, new Error('receipt unavailable'), 'Approval failed')
			expect(transition.keepLocked).toBeTrue()
			expect(transition.state).toBe('pending')
			expect(transition.message).toBeUndefined()
			expect(transition.warning).toContain(hash)
			expect(transition.warning).toContain('Do not resubmit')
		}
		expect(approvalFailureTransition('LP-token approval', hash, true, new Error('reverted'), 'Approval failed')).toEqual({ keepLocked: false, state: 'error', message: 'reverted', warning: undefined })
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
		expect(insuredExitLimitMessage(11n * 10n ** 18n, 5n * 10n ** 18n, 10n * 10n ** 18n)).toContain('long-share balance and pair liquidity')
		expect(insuredExitLimitMessage(11n * 10n ** 18n, 4n * 10n ** 18n, 4n * 10n ** 18n)).toContain('INVALID balance covers only 4 complete sets')
	})

	test('derives both demo exits and LP coverage from one wallet fixture', () => {
		const market = demoMarket('baseline')
		const maximumYes = maximumInsuredExit({ longOutcome: 'YES', longBalance: demoWalletBalances.yes, invalidBalance: demoWalletBalances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
		const maximumNo = maximumInsuredExit({ longOutcome: 'NO', longBalance: demoWalletBalances.no, invalidBalance: demoWalletBalances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
		expect(maximumYes).toBe(demoWalletBalances.invalid)
		expect(maximumNo).toBeLessThan(demoWalletBalances.no)
		const yesClaim = (market.yesReserve * demoWalletBalances.lp) / market.lpTotalSupply
		const noClaim = (market.noReserve * demoWalletBalances.lp) / market.lpTotalSupply
		expect(yesClaim).toBe(demoWalletBalances.lp)
		expect(noClaim).toBeGreaterThan(yesClaim)
		expect(demoWalletBalances.invalid).toBeGreaterThan(yesClaim)
	})

	test('keeps every represented outcome balance within demo outstanding supply', () => {
		const market = demoMarket('baseline')
		const supply = market.securityPool.shareTokenSupplyAttoShares
		expect(market.yesReserve).toBeLessThanOrEqual(supply)
		expect(market.noReserve).toBeLessThanOrEqual(supply)
		expect(market.yesReserve + demoWalletBalances.yes).toBeLessThanOrEqual(supply)
		expect(market.noReserve + demoWalletBalances.no).toBeLessThanOrEqual(supply)
		expect(demoWalletBalances.invalid).toBeLessThanOrEqual(supply)
	})
})
