import { describe, expect, test } from 'bun:test'
import { formatBpsMultiplier, formatEthPerShare, formatShareAmount, formatUnits, parseUnits, parseUnitsOrUndefined } from '../app/format.ts'
import { demoAttoEthToAttoShares, demoAttoSharesToAttoEth, demoMarket, demoWalletBalances, lifecycleLabel, tradingClosedReason } from '../demo/markets.ts'
import { demoPreviewPresentation, quoteDemoEnterPosition, transactionMessage } from '../features/MarketDetail.tsx'
import { insuredExitLimitMessage, liquidityApprovalRequired, livePairInitialized } from '../features/LiveTrading.tsx'
import { liquidityActionAvailability, parseConditionalProbabilityBps, quoteDemoEthLiquidity, quoteDemoRemoval } from '../features/Routes.tsx'
import { roundedProbabilityLabels } from '../components/ProbabilityBar.tsx'
import { marketAcceptsNewRisk, marketNewRiskBlocker, maximumAfterSlippage, minimumAfterSlippage, type LiveMarket } from '../protocol/live.ts'
import { maximumInsuredExit } from '../../../ts/sdk/positions.ts'

describe('standalone trading UI model', () => {
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

	test('formats 18-decimal shares and Statoblast settings for display', () => {
		expect(formatShareAmount(1_234_500_000_000_000_000n)).toBe('1.2345 shares')
		expect(formatBpsMultiplier(25_000n)).toBe('2.5×')
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
