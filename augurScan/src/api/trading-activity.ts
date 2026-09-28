import type { SQL } from 'bun'
import { accountTradingRows, tradingActivityRows, tradingVolumeRows } from '../repositories/trading-activity.ts'
import { TRADING_PNL_BASIS, type TradingHoldings, type TradingMarketState, tradingExitAvailability, tradingHoldingsValue, tradingProfitAndLoss } from '../trading-pnl.ts'
import { detailPage, paged, protocolCursorFor, protocolCursorForRequest } from './entity-details.ts'

/** Rewrites `activityCursor`/`activityLimit` into the standard detail-page parameters for the activity collection. */
const tradingActivityUrl = (url: URL): URL => {
	const activityUrl = new URL(url)
	activityUrl.searchParams.delete('cursor')
	activityUrl.searchParams.delete('limit')
	const cursor = url.searchParams.get('activityCursor')
	const limit = url.searchParams.get('activityLimit')
	if (cursor !== null) activityUrl.searchParams.set('cursor', cursor)
	activityUrl.searchParams.set('limit', limit ?? '50')
	return activityUrl
}

export const tradingActivityCursor = (url: URL, chainId: number, market: string) => protocolCursorForRequest(tradingActivityUrl(url), chainId, 'trading-activity', market)

export const tradingActivityPage = async (sql: SQL, url: URL, query: { readonly chainId: number; readonly market: string; readonly asOf: Record<string, unknown> }) => {
	const { chainId, market, asOf } = query
	const activityUrl = tradingActivityUrl(url)
	const page = detailPage(activityUrl, chainId, 'trading-activity', market, asOf, tradingActivityCursor(url, chainId, market))
	const rows = await tradingActivityRows(sql, {
		chainId,
		market,
		asOfBlock: String(asOf['blockNumber']),
		cursorBlock: page.cursor?.[9] ?? String(asOf['blockNumber']),
		cursorTx: page.cursor?.[10] ?? `0x${'f'.repeat(64)}`,
		cursorLog: page.cursor?.[11] ?? 2_147_483_647,
		queryLimit: page.queryLimit,
	})
	return paged(rows, page.limit, row => protocolCursorFor(chainId, 'trading-activity', market, asOf, row))
}

export const tradingVolumes = async (sql: SQL, query: { readonly chainId: number; readonly asOf: Record<string, unknown>; readonly markets: readonly string[] }): Promise<ReadonlyMap<string, Record<string, unknown>>> => {
	const rows = await tradingVolumeRows(sql, { chainId: query.chainId, asOfBlock: String(query.asOf['blockNumber']), asOfTimestamp: String(query.asOf['blockTimestamp']), markets: query.markets })
	return new Map(rows.map((row: Record<string, unknown>) => [String(row['pair_address']), Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'pair_address'))]))
}

export const EMPTY_TRADING_VOLUME = { eth_volume_atto_eth: '0', eth_volume_24h_atto_eth: '0', eth_volume_7d_atto_eth: '0', eth_trade_count: 0, eth_trade_count_24h: 0 }

const optionalBigint = (value: unknown): bigint | undefined => (typeof value === 'string' && /^-?\d+$/.test(value) ? BigInt(value) : undefined)
const requiredBigint = (value: unknown): bigint => optionalBigint(value) ?? 0n
const text = (value: bigint | undefined): string | undefined => value?.toString()

// BinaryOutcomes.BinaryOutcome.None: the escalation game has not resolved the question.
const NO_OUTCOME = '3'

/** The value from whichever indexed source, a tagged read or a state event, is at the later block. */
const newerEvidence = (readValue: unknown, readBlock: unknown, eventValue: unknown, eventBlock: unknown): string | undefined => {
	const read = typeof readValue === 'string' ? readValue : undefined
	const event = typeof eventValue === 'string' ? eventValue : undefined
	if (event === undefined) return read
	if (read === undefined) return event
	return requiredBigint(eventBlock) > requiredBigint(readBlock) ? event : read
}

const holdingsValuation = (holdings: TradingHoldings, exitOpen: boolean, market: TradingMarketState) => {
	if (Object.values(holdings).every(balance => balance === 0n)) return { valueAttoEth: 0n, completeSetsRedeemed: 0n, insuredExitSets: 0n, unvalued: holdings }
	return exitOpen ? tradingHoldingsValue(holdings, market) : undefined
}

const missingValuationReason = (holdings: TradingHoldings) => (Object.values(holdings).some(balance => balance < 0n) ? 'Indexed transfer history is incomplete for this account' : 'No indexed complete-set exchange rate for this pool')

export const accountTradingPnl = async (sql: SQL, query: { readonly chainId: number; readonly asOfBlock: string; readonly asOfTimestamp: string; readonly account: string }) => {
	const rows = await accountTradingRows(sql, { chainId: query.chainId, asOfBlock: query.asOfBlock, account: query.account })
	const items = rows.slice(0, 250).map((row: Record<string, unknown>) => {
		const holdings = { invalidShares: requiredBigint(row['invalid_atto_shares']), yesShares: requiredBigint(row['yes_atto_shares']), noShares: requiredBigint(row['no_atto_shares']), lpTokens: requiredBigint(row['lp_tokens']) }
		const yesReserve = optionalBigint(row['yes_reserve'])
		const noReserve = optionalBigint(row['no_reserve'])
		const collateral = optionalBigint(row['settlement_collateral_atto_eth'])
		const supply = optionalBigint(row['share_supply_atto_shares'])
		const questionEndTime = optionalBigint(row['question_end_time'])
		const systemState = newerEvidence(row['pool_system_state'], row['pool_read_block'], row['system_state_event'], row['system_state_event_block'])
		const exit = tradingExitAvailability({
			asOfTimestamp: requiredBigint(query.asOfTimestamp),
			...(questionEndTime === undefined ? {} : { questionEndTime }),
			...(systemState === undefined ? {} : { systemState }),
			awaitingForkContinuation: newerEvidence(row['pool_awaiting_fork_continuation'], row['pool_read_block'], row['awaiting_fork_continuation_event'], row['awaiting_fork_continuation_event_block']) === 'true',
			resolved: row['pool_escalation_resolved'] === 'true' || (typeof row['final_question_resolution'] === 'string' && row['final_question_resolution'] !== NO_OUTCOME),
			universeForked: row['universe_forked'] === true,
			settlementObserved: row['settlement_observed'] === true,
		})
		const marketState = {
			...(yesReserve === undefined || noReserve === undefined ? {} : { reserves: { yes: yesReserve, no: noReserve } }),
			feeBps: requiredBigint(row['fee_bps']),
			lpTotalSupply: requiredBigint(row['lp_total_supply']),
			...(collateral === undefined || supply === undefined ? {} : { completeSetRate: { settlementCollateralAttoEth: collateral, shareSupplyAttoShares: supply } }),
		}
		const valuation = holdingsValuation(holdings, exit.open, marketState)
		const pnl = tradingProfitAndLoss(requiredBigint(row['cost_basis_atto_eth']), requiredBigint(row['proceeds_atto_eth']), holdings, valuation?.valueAttoEth)
		return {
			market_address: row['pair_address'],
			pool_address: row['pool_address'],
			question_title: row['question_title'],
			action_count: row['action_count'],
			invalid_atto_shares: row['invalid_atto_shares'],
			yes_atto_shares: row['yes_atto_shares'],
			no_atto_shares: row['no_atto_shares'],
			lp_tokens: row['lp_tokens'],
			cost_basis_atto_eth: pnl.costBasisAttoEth.toString(),
			proceeds_atto_eth: pnl.proceedsAttoEth.toString(),
			holdings_value_atto_eth: text(pnl.holdingsValueAttoEth),
			realized_pnl_atto_eth: pnl.realizedAttoEth.toString(),
			unrealized_pnl_atto_eth: text(pnl.unrealizedAttoEth),
			net_pnl_atto_eth: text(pnl.netAttoEth),
			open: pnl.open,
			valuation:
				valuation === undefined
					? { status: 'unavailable', reason: exit.open ? missingValuationReason(holdings) : exit.reason }
					: {
							status: 'available',
							partial: Object.values(valuation.unvalued).some(balance => balance > 0n),
							complete_sets_redeemed_atto_shares: valuation.completeSetsRedeemed.toString(),
							insured_exit_sets_atto_shares: valuation.insuredExitSets.toString(),
							unvalued_invalid_atto_shares: valuation.unvalued.invalidShares.toString(),
							unvalued_yes_atto_shares: valuation.unvalued.yesShares.toString(),
							unvalued_no_atto_shares: valuation.unvalued.noShares.toString(),
							unvalued_lp_tokens: valuation.unvalued.lpTokens.toString(),
							reserve_block: row['reserve_block'] ?? undefined,
							settlement_collateral_block: row['settlement_collateral_block'] ?? undefined,
							share_supply_block: row['share_supply_block'] ?? undefined,
						},
		}
	})
	return { items, truncated: rows.length > 250, basis: TRADING_PNL_BASIS }
}
