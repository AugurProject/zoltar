import type { SQL } from 'bun'
import { blockEvidence, searchItems, searchNetworkIds, transactionEvidence } from '../repositories/search.ts'
import { ApiRequestError, integer, json, routeInteger } from './shared.ts'

const hashPattern = /^0x[0-9a-f]{64}$/i

export const searchResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const query = url.searchParams.get('q')?.trim() ?? ''
	if (query.length === 0 || query.length > 128) throw new ApiRequestError('q must contain 1 to 128 characters')
	const limit = Math.min(Math.max(integer(url.searchParams.get('limit'), 'limit') ?? 10, 1), 25)
	const chainIds = chainId === undefined ? await searchNetworkIds(sql) : [chainId]
	const matches = await Promise.all(chainIds.map(id => searchItems(sql, id, query, limit)))
	return json({ items: matches.flat().slice(0, limit), query, chainId })
}

export const transactionResponse = async (sql: SQL, parts: readonly string[]): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const hash = parts[1]?.toLowerCase()
	if (parts.length !== 2 || chainId === undefined || hash === undefined || !hashPattern.test(hash)) return json({ error: 'Invalid transaction identifier' }, 400)
	const evidence = await transactionEvidence(sql, chainId, hash)
	return evidence === undefined ? json({ error: 'Transaction not found' }, 404) : json(evidence)
}

export const blockResponse = async (sql: SQL, parts: readonly string[]): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const number = parts[1]
	if (parts.length !== 2 || chainId === undefined || number === undefined || !/^\d{1,19}$/.test(number) || BigInt(number) > 9_223_372_036_854_775_807n) return json({ error: 'Invalid block identifier' }, 400)
	const evidence = await blockEvidence(sql, chainId, number)
	return evidence === undefined ? json({ error: 'Block not found' }, 404) : json(evidence)
}
