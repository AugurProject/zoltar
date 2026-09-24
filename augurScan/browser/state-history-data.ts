import type { EntityHistory, StateEntity, StateTab } from './browser-types.ts'
import { decodeEntityHistory } from './api-decoding.ts'
import { isRecord, type EntityHistoryCoverageValue } from './api-validation.ts'
import { collectCursorCollections, compareCanonicalEventPosition } from './live-update.ts'

export const entityHistoryCollectionKeys = ['snapshots', 'events', 'ammPrices', 'repEthPrices', 'uniswapRepEthPrices', 'openOracleHistory', 'pools', 'forks'] as const

export const createStateHistoryData = (api: (path: string) => Promise<unknown>, getPageUrl: () => URL) => {
	const entityHistoryCollections = (history: EntityHistory): Readonly<Record<(typeof entityHistoryCollectionKeys)[number], readonly unknown[]>> => ({
		snapshots: history.snapshots,
		events: history.events,
		ammPrices: history.ammPrices,
		repEthPrices: history.repEthPrices,
		uniswapRepEthPrices: history.uniswapRepEthPrices,
		openOracleHistory: history.openOracleHistory,
		pools: history.pools,
		forks: history.forks,
	})

	const fetchEntityHistoryPage = async (type: StateTab, item: StateEntity, cursor?: string): Promise<EntityHistory> => {
		const range = new URLSearchParams()
		for (const parameter of ['fromBlock', 'toBlock'] as const) {
			const value = getPageUrl().searchParams.get(parameter)
			if (value !== null) range.set(parameter, value)
		}
		if (cursor !== undefined) range.set('cursor', cursor)
		const suffix = range.size === 0 ? '' : `?${range}`
		if (type === 'pools' && 'pool_address' in item) return decodeEntityHistory(await api(`/api/v1/state/pools/${item.chain_id}/${item.pool_address}${suffix}`))
		if (type === 'vaults' && 'vault_address' in item) return decodeEntityHistory(await api(`/api/v1/state/vaults/${item.chain_id}/${item.pool_address}/${item.vault_address}${suffix}`))
		if (type === 'questions' && 'question_id' in item) return decodeEntityHistory(await api(`/api/v1/state/questions/${item.chain_id}/${item.question_id}${suffix}`))
		if ('universe_id' in item) return decodeEntityHistory(await api(`/api/v1/state/universes/${item.chain_id}/${item.universe_id}${suffix}`))
		throw new Error(`State entity does not match the selected ${type} tab`)
	}

	const fetchEntityHistory = async (type: StateTab, item: StateEntity, throughOffset = 0): Promise<EntityHistory> => {
		let firstPage: EntityHistory | undefined
		let anchor: EntityHistoryCoverageValue | undefined
		const collected = await collectCursorCollections<unknown>(
			async cursor => {
				const page = await fetchEntityHistoryPage(type, item, cursor)
				const coverage = page.coverage
				if (coverage === undefined) throw new Error('State history response is missing coverage metadata')
				if (page.truncated === true && coverage.nextCursor === undefined) throw new Error('State history continuation is malformed')
				if (page.truncated === false && coverage.nextCursor !== undefined) throw new Error('State history completion is malformed')
				if (anchor === undefined) anchor = coverage
				else if (coverage.requestedFromBlock !== anchor.requestedFromBlock || coverage.requestedToBlock !== anchor.requestedToBlock || coverage.indexedFromBlock !== anchor.indexedFromBlock || coverage.indexedThroughBlock !== anchor.indexedThroughBlock || coverage.indexedThroughHash !== anchor.indexedThroughHash)
					throw new Error('State history changed while loading its continuation')
				firstPage ??= page
				return {
					collections: entityHistoryCollections(page),
					offset: coverage.offset,
					...(coverage.nextCursor === undefined ? {} : { nextCursor: coverage.nextCursor }),
				}
			},
			entityHistoryCollectionKeys,
			throughOffset,
		)
		if (firstPage === undefined || anchor === undefined) throw new Error('State history returned no pages')
		const anchoredCoverage = anchor
		const chronological = (records: readonly unknown[]) => records.toSorted((left, right) => (isRecord(left) && isRecord(right) ? compareCanonicalEventPosition(left, right) : 0))
		const collections = Object.fromEntries(entityHistoryCollectionKeys.map(key => [key, chronological(collected.collections[key] ?? [])]))
		const series = Object.fromEntries(entityHistoryCollectionKeys.filter(key => key in anchoredCoverage.series).map(key => [key, collections[key]?.length ?? 0]))
		const decoded = decodeEntityHistory({
			...firstPage,
			...collections,
			truncated: collected.nextCursor !== undefined,
			offset: 0,
			coverage: {
				...anchoredCoverage,
				offset: 0,
				series,
				complete: anchoredCoverage.rangeCovered === true && collected.nextCursor === undefined,
				hasPreviousPages: false,
				...(collected.nextCursor === undefined ? { nextCursor: undefined } : { nextCursor: collected.nextCursor }),
			},
		})
		return { ...decoded, loadedOffset: collected.loadedOffset }
	}

	return { fetchEntityHistory, entityHistoryCollections }
}
