import type { SQL } from 'bun'
import { feeEconomicsRows, questionFeeStreamRows } from '../repositories/fee-economics.ts'
import { ApiRequestError, integer, json, jsonRecord } from './shared.ts'
import { operationsAsOfFromUrl } from './snapshot.ts'

const SECONDS_PER_YEAR = 365n * 86_400n
const unsigned = (value: unknown): bigint | undefined => (typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : undefined)

/**
 * One universe's fee economics. `earnings_funded_atto_eth` is the part of the purchase fees that funds the
 * underwriters' vesting stream: the services contract funds `fee - premium` on every purchase.
 */
const universeFees = (row: Record<string, unknown>): Record<string, unknown> => {
	const purchaseFees = unsigned(row['purchase_fees_atto_eth'])
	const premiums = unsigned(row['premium_funded_atto_eth'])
	return {
		...row,
		fees: row['fees'] === null ? undefined : jsonRecord(row['fees']),
		earnings_funded_atto_eth: purchaseFees === undefined || premiums === undefined || premiums > purchaseFees ? undefined : (purchaseFees - premiums).toString(),
	}
}

/** Annualize internal claim-unit rates without implying a historical cash-to-unit index. */
const questionStream = (row: Record<string, unknown>): Record<string, unknown> => {
	const rate = unsigned(row['rate_claim_units_per_second'])
	return { ...row, claim_unit_scale: '1000000000', block_number: String(row['block_number']), rate_claim_units_per_year: rate === undefined ? undefined : (rate * SECONDS_PER_YEAR).toString() }
}

/** Fee economics of every universe and the 25 most recently replaced question streams, as embedded in the Operations overview and risk catalog. */
export const feeEconomicsOverview = async (sql: SQL, chainId: number, snapshotBlock: string) => {
	const [universes, streams] = await Promise.all([feeEconomicsRows(sql, chainId, snapshotBlock), questionFeeStreamRows(sql, chainId, snapshotBlock, 25)])
	return { feeEconomics: universes.map(universeFees), questionFeeStreams: streams.map(questionStream) }
}

export const feeEconomicsResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const asOf = await operationsAsOfFromUrl(sql, chainId, url)
	const snapshotBlock = String(asOf['blockNumber'])
	const [universes, streams] = await Promise.all([feeEconomicsRows(sql, chainId, snapshotBlock), questionFeeStreamRows(sql, chainId, snapshotBlock, limit + 1)])
	return json({ chainId, asOf, data: { universes: universes.map(universeFees), questionStreams: { items: streams.slice(0, limit).map(questionStream), limit, truncated: streams.length > limit } } })
}
