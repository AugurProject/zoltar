import type { SQL } from 'bun'
import { openOracleNativeCustody } from '../repositories/open-oracle-custody.ts'
import { ApiRequestError, addressHistoryCursorFor, evmAddress, integer, json, parseAddressHistoryCursor } from './shared.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'

export const openOracleCustodyResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (chainId === undefined || address === undefined) throw new ApiRequestError('chainId and address are required')
	const limit = Math.min(100, Math.max(1, integer(url.searchParams.get('limit'), 'limit') ?? 50))
	const cursor = parseAddressHistoryCursor(url.searchParams.get('cursor'), 'open-oracle-custody')
	if (cursor && (cursor[2] !== chainId || cursor[3] !== address)) throw new ApiRequestError('cursor does not match the requested account')
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor ? [{ parts: cursor, offset: 4 }] : [])
	const snapshotBlock = String(asOf['blockNumber'])
	const rows = await openOracleNativeCustody(sql, { chainId, address, snapshotBlock, limit, cursorBlock: cursor?.[11], cursorIndex: cursor?.[12] })
	const total = Number(rows[0]?.['snapshot_total'] ?? cursor?.[10] ?? 0)
	const items = rows.slice(0, limit).map(({ trace_output, tx_value, snapshot_total: _total, ...row }) => {
		// A successful withdrawal can send less than requested, including zero. Its ABI return word is the exact amount sent.
		if (row['function_name'] === 'deposit') return { ...row, direction: 'deposit', amount_wei: tx_value, amount_basis: 'transaction-value' }
		const traced = typeof trace_output === 'string' && /^0x[0-9a-f]{64}$/i.test(trace_output) ? BigInt(trace_output).toString() : undefined
		return { ...row, direction: 'withdrawal', amount_wei: traced ?? null, amount_basis: traced === undefined ? 'unavailable' : 'trace-return' }
	})
	const lastRow = items.at(-1)
	const nextCursor = rows.length > limit && lastRow ? addressHistoryCursorFor('open-oracle-custody', chainId, address, snapshotBlock, String(asOf['blockHash']), asOf, total, lastRow) : undefined
	return json({ asOf, total, limit, items, nextCursor })
}
