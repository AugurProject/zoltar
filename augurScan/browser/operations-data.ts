import type { OperationsDetailRoute, PagedOperationsCatalogSection } from './browser-types.ts'
import { decodeOperationsResponseValue, isJsonRecord, operationRecords, operationsSnapshotIdentity, operationsCatalogRecords, operationsRiskPagination, operationsRiskRecords, type JsonRecord, type OperationsResponse } from './api-validation.ts'
import { canonicalPageLimit, collectCanonicalPages, collectCursorCollections } from './canonical-pagination.ts'
import { operationsCatalogRecordKey, operationsDetailRecordKey } from './operations-presentation.ts'

export const operationsRiskHistoryKeys = ['stateSnapshots', 'accountingSnapshots', 'lifecycleEvents'] as const
export const operationsHistoryOffset = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined)

export const createOperationsData = (api: (path: string) => Promise<unknown>, requiredChainId: () => string, getPageUrl: () => URL) => {
	const decodeOperationsResponse = decodeOperationsResponseValue
	const operationsCatalogEndpoint = (section: PagedOperationsCatalogSection, cursor?: string, limit = 100): string => {
		const query = new URLSearchParams({ chainId: requiredChainId(), limit: String(limit) })
		if (section === 'timeline')
			for (const parameter of ['q', 'entityType', 'event', 'address', 'fromBlock', 'toBlock', 'canonical'] as const) {
				const value = getPageUrl().searchParams.get(parameter)
				if (value !== null && value !== '') query.set(parameter, value)
			}
		if (cursor !== undefined) query.set('cursor', cursor)
		return `/api/v1/state/${section}?${query.toString()}`
	}

	const operationsRiskCatalogEndpoint = (poolCursor?: string, limit = 100): string => {
		const query = new URLSearchParams({ chainId: requiredChainId(), limit: String(limit) })
		const atBlock = getPageUrl().searchParams.get('atBlock')
		if (atBlock !== null && atBlock !== '') query.set('atBlock', atBlock)
		if (poolCursor !== undefined) query.set('poolCursor', poolCursor)
		return `/api/v1/state/risk?${query.toString()}`
	}

	const catalogOperationsResponse = (response: OperationsResponse, section: PagedOperationsCatalogSection, items: readonly JsonRecord[]): OperationsResponse => ({
		...response,
		data: { ...response.data, [section]: items, _catalogPage: response.data },
	})

	const riskCatalogOperationsResponse = (response: OperationsResponse, pools: readonly JsonRecord[]): OperationsResponse => ({
		...response,
		data: {
			risk: { ...response.data, pools },
			_riskCatalogPage: response.data,
			totals: {
				pools: isJsonRecord(response.data['pagination']) && typeof response.data['pagination']['poolTotal'] === 'number' ? response.data['pagination']['poolTotal'] : pools.length,
			},
		},
	})

	const OPERATIONS_DETAIL_RESOURCES: Record<OperationsDetailRoute['kind'], string> = {
		auction: 'auctions',
		capital: 'capital',
		escalation: 'escalations',
		fork: 'forks',
		pool: 'risk/pools',
		report: 'reports',
		trading: 'trading',
	}

	const operationsDetailEndpoint = (route: OperationsDetailRoute, cursor?: string, limit = 100, decisionCursor?: string, decisionLimit = 100): string => {
		const chainId = encodeURIComponent(requiredChainId())
		const identity = route.identity.map(encodeURIComponent).join('/')
		const resource = OPERATIONS_DETAIL_RESOURCES[route.kind]
		const query = new URLSearchParams({ limit: String(limit) })
		const atBlock = getPageUrl().searchParams.get('atBlock')
		if ((route.kind === 'pool' || route.kind === 'capital') && atBlock !== null && atBlock !== '') query.set('atBlock', atBlock)
		if (cursor !== undefined) query.set('cursor', cursor)
		if (route.kind === 'report' || route.kind === 'trading') {
			const prefix = route.kind === 'trading' ? 'activity' : 'decision'
			query.set(`${prefix}Limit`, String(decisionLimit))
			if (decisionCursor !== undefined) query.set(`${prefix}Cursor`, decisionCursor)
		}
		return `/api/v1/state/${resource}/${chainId}/${identity}?${query.toString()}`
	}

	const detailPageRecord = (data: JsonRecord, key: string): JsonRecord => (isJsonRecord(data[key]) ? data[key] : {})

	const loadOperationsCatalog = async (section: PagedOperationsCatalogSection, retainedCount: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		const snapshot = await collectCanonicalPages(
			async (cursor?: string, limit = 100) => {
				const response = decodeOperationsResponse(await api(operationsCatalogEndpoint(section, cursor, limit)))
				if (first !== undefined && operationsSnapshotIdentity(first) !== operationsSnapshotIdentity(response)) throw new Error('Indexed evidence changed while older evidence was loading; retry from the latest available block')
				first ??= response
				last = response
				return {
					items: operationsCatalogRecords(section, response.data['items'], true),
					...(response.data['hasMore'] === true && typeof response.data['nextCursor'] === 'string' ? { nextCursor: response.data['nextCursor'] } : {}),
				}
			},
			retainedCount,
			item => operationsCatalogRecordKey(section, item),
		)
		if (first === undefined || last === undefined) throw new Error('Operations catalog returned no page')
		return catalogOperationsResponse(
			{
				...first,
				data: { ...last.data, hasMore: snapshot.nextCursor !== undefined, ...(snapshot.nextCursor === undefined ? {} : { nextCursor: snapshot.nextCursor }) },
			},
			section,
			snapshot.items,
		)
	}

	const loadOperationsRiskCatalog = async (poolTargetCount: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		let snapshotIdentity: string | undefined
		const snapshot = await collectCanonicalPages(
			async (cursor?: string, limit = 100) => {
				const response = decodeOperationsResponse(await api(operationsRiskCatalogEndpoint(cursor, limit)))
				const responseIdentity = operationsSnapshotIdentity(response)
				if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity) throw new Error('Risk catalog changed while older evidence was loading; retry from the latest available block')
				snapshotIdentity ??= responseIdentity
				first ??= response
				last = response
				const pagination = operationsRiskPagination(response.data['pagination'], true)
				return {
					items: operationsRiskRecords(response.data['pools'], true),
					...(pagination['poolHasMore'] === true && typeof pagination['poolNextCursor'] === 'string' ? { nextCursor: pagination['poolNextCursor'] } : {}),
				}
			},
			poolTargetCount,
			item => String(item['pool_address'] ?? ''),
		)
		if (first === undefined || last === undefined) throw new Error('Risk catalog returned no page')
		const pagination = isJsonRecord(last.data['pagination']) ? last.data['pagination'] : {}
		const { poolNextCursor: _replacedCursor, ...paginationWithoutCursor } = pagination
		return riskCatalogOperationsResponse(
			{
				...first,
				data: {
					...last.data,
					pagination: { ...paginationWithoutCursor, poolHasMore: snapshot.nextCursor !== undefined, ...(snapshot.nextCursor === undefined ? {} : { poolNextCursor: snapshot.nextCursor }) },
				},
			},
			snapshot.items,
		)
	}

	const loadOperationsRiskDetail = async (route: OperationsDetailRoute, throughOffset: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		let snapshotIdentity: string | undefined
		const collected = await collectCursorCollections(
			async cursor => {
				const response = decodeOperationsResponse(await api(operationsDetailEndpoint(route, cursor, 100)))
				const responseIdentity = operationsSnapshotIdentity(response)
				if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity) throw new Error('Risk history changed while older evidence was loading; retry from the latest available block')
				snapshotIdentity ??= responseIdentity
				first ??= response
				last = response
				const history = detailPageRecord(response.data, 'history')
				const offset = operationsHistoryOffset(history['offset'])
				const nextCursor = history['nextCursor']
				if (offset === undefined) throw new Error('Risk history page offset is malformed')
				if (history['truncated'] === true && typeof nextCursor !== 'string') throw new Error('Risk history continuation is malformed')
				if (history['truncated'] !== true && nextCursor !== undefined) throw new Error('Risk history completion is malformed')
				return {
					collections: {
						stateSnapshots: operationRecords(history['stateSnapshots']),
						accountingSnapshots: operationRecords(history['accountingSnapshots']),
						lifecycleEvents: operationRecords(history['lifecycleEvents']),
						liquidations: operationRecords(history['liquidations']),
					},
					offset,
					...(history['truncated'] === true && typeof nextCursor === 'string' ? { nextCursor } : {}),
				}
			},
			operationsRiskHistoryKeys,
			throughOffset,
		)
		if (first === undefined || last === undefined) throw new Error('Risk detail returned no page')
		const lastHistory = detailPageRecord(last.data, 'history')
		return {
			...first,
			data: {
				...first.data,
				history: {
					...lastHistory,
					...collected.collections,
					offset: 0,
					loadedOffset: collected.loadedOffset,
					truncated: collected.nextCursor !== undefined,
					...(collected.nextCursor === undefined ? {} : { nextCursor: collected.nextCursor }),
				},
			},
		}
	}

	const loadOperationsPairedDetail = async (route: OperationsDetailRoute, roundTargetCount: number, decisionTargetCount: number): Promise<OperationsResponse> => {
		const primaryKey = route.kind === 'trading' ? 'events' : 'rounds'
		const secondaryKey = route.kind === 'trading' ? 'activity' : 'coordinatorDecisions'
		const primaryLimit = canonicalPageLimit(roundTargetCount, 0, 100)
		const secondaryLimit = canonicalPageLimit(decisionTargetCount, 0, 100)
		const first = decodeOperationsResponse(await api(operationsDetailEndpoint(route, undefined, primaryLimit, undefined, secondaryLimit)))
		const firstIdentity = operationsSnapshotIdentity(first)
		const collect = async (key: string, targetCount: number, continuationEndpoint: (cursor: string, limit: number) => string) => {
			let lastPage = detailPageRecord(first.data, key)
			const collected = await collectCanonicalPages(
				async (cursor, limit = 100) => {
					if (cursor !== undefined) {
						const response = decodeOperationsResponse(await api(continuationEndpoint(cursor, limit)))
						if (operationsSnapshotIdentity(response) !== firstIdentity) throw new Error('Indexed evidence changed while older evidence was loading; retry from the latest available block')
						lastPage = detailPageRecord(response.data, key)
					}
					return {
						items: operationRecords(lastPage['items']),
						...(lastPage['hasMore'] === true && typeof lastPage['nextCursor'] === 'string' ? { nextCursor: lastPage['nextCursor'] } : {}),
					}
				},
				targetCount,
				operationsDetailRecordKey,
			)
			return {
				...lastPage,
				items: collected.items,
				hasMore: collected.nextCursor !== undefined,
				...(collected.nextCursor === undefined ? {} : { nextCursor: collected.nextCursor }),
			}
		}
		const [rounds, decisions] = await Promise.all([collect(primaryKey, roundTargetCount, (cursor, limit) => operationsDetailEndpoint(route, cursor, limit, undefined, 1)), collect(secondaryKey, decisionTargetCount, (cursor, limit) => operationsDetailEndpoint(route, undefined, 1, cursor, limit))])
		return {
			...first,
			data: {
				...first.data,
				[primaryKey]: rounds,
				[secondaryKey]: decisions,
			},
		}
	}

	const loadOperationsDetail = async (route: OperationsDetailRoute, retainedCount: number, riskHistoryThroughOffset = 0, decisionTargetCount = 0, activityTargetCount = 0): Promise<OperationsResponse> => {
		if (route.kind === 'pool') return await loadOperationsRiskDetail(route, riskHistoryThroughOffset)
		if (route.kind === 'report') return await loadOperationsPairedDetail(route, retainedCount, decisionTargetCount)
		if (route.kind === 'trading') return await loadOperationsPairedDetail(route, retainedCount, activityTargetCount)
		const pageKey = 'events'
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		const snapshot = await collectCanonicalPages(
			async (cursor?: string, limit = 100) => {
				const response = decodeOperationsResponse(await api(operationsDetailEndpoint(route, cursor, limit)))
				if (first !== undefined && operationsSnapshotIdentity(first) !== operationsSnapshotIdentity(response)) throw new Error('Indexed evidence changed while older evidence was loading; retry from the latest available block')
				first ??= response
				last = response
				const page = detailPageRecord(response.data, pageKey)
				return {
					items: operationRecords(page['items']),
					...(page['hasMore'] === true && typeof page['nextCursor'] === 'string' ? { nextCursor: page['nextCursor'] } : {}),
				}
			},
			retainedCount,
			operationsDetailRecordKey,
		)
		if (first === undefined || last === undefined) throw new Error('Operations detail returned no page')
		const lastPage = detailPageRecord(last.data, pageKey)
		return {
			...first,
			data: {
				...first.data,
				...(route.kind === 'escalation' ? { deposits: snapshot.items.filter(item => item['event_name'] === 'LocalDepositAppended'), claims: snapshot.items.filter(item => item['event_name'] === 'ClaimDeposit') } : {}),
				[pageKey]: {
					...lastPage,
					items: snapshot.items,
					hasMore: snapshot.nextCursor !== undefined,
					...(snapshot.nextCursor === undefined ? {} : { nextCursor: snapshot.nextCursor }),
				},
			},
		}
	}

	return { loadOperationsCatalog, loadOperationsRiskCatalog, loadOperationsDetail }
}
