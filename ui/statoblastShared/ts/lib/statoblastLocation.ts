import { resolveEnumValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import type { PoolBrowseState, PoolSortKey, PoolStateFilter, SelectedVaultView } from '../types/app.js'
import { setOrDeleteSearchParam, updateSearchParams } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'

export const POOLS_ROUTE_HASH = '#/pools'
const POOLS_PATH_PREFIX = `${POOLS_ROUTE_HASH}/`

/** A location inside the Pools route: the address entry, browse list and universe views, or one pool page without per-pool tabs. */
export type PoolsLocation = { view: 'browse' } | { view: 'universes' } | { view: 'migrate' } | { view: 'operate'; questionLedgerAddress: string }

function decodeSegment(segment: string) {
	try {
		return decodeURIComponent(segment)
	} catch (error) {
		// A malformed percent escape makes the path unroutable rather than failing the whole app.
		if (error instanceof URIError) return undefined
		throw error
	}
}

/** Path segments that name a list view (or the pool page itself) and are never read as a pool address. */
const RESERVED_POOLS_SEGMENTS = new Set(['browse', 'create', 'operate', 'universes', 'migrate'])

/** Parses `#/pools`, `#/pools/browse`, `#/pools/universes`, and `#/pools/<address>`; returns `undefined` for any other hash. */
export function parsePoolsRouteHash(routeHash: string): PoolsLocation | undefined {
	if (routeHash === POOLS_ROUTE_HASH || routeHash === POOLS_PATH_PREFIX) return { view: 'browse' }
	if (!routeHash.startsWith(POOLS_PATH_PREFIX)) return undefined
	const segments = routeHash.slice(POOLS_PATH_PREFIX.length).replace(/\/$/, '').split('/').map(decodeSegment)
	if (segments.length > 1 || segments.some(segment => segment === undefined || segment.trim() === '')) return undefined
	const [first = ''] = segments.map(segment => segment?.trim() ?? '')
	if (first === 'browse' || first === 'universes' || first === 'migrate') return { view: first }
	// `operate` is the pool page's internal view name, not an address; a hand-written `#/pools/operate` link is unroutable.
	if (RESERVED_POOLS_SEGMENTS.has(first)) return undefined
	return { questionLedgerAddress: first, view: 'operate' }
}

export function buildPoolsRouteHash(location: PoolsLocation) {
	switch (location.view) {
		case 'browse':
			return POOLS_ROUTE_HASH
		case 'universes':
		case 'migrate':
			return `${POOLS_PATH_PREFIX}${location.view}`
		case 'operate': {
			const address = location.questionLedgerAddress.trim()
			if (address === '') return POOLS_ROUTE_HASH
			return `${POOLS_PATH_PREFIX}${encodeURIComponent(address)}`
		}
		default:
			return assertNever(location)
	}
}

/** Clears pool-scoped vault context when navigating to another pool or to the list. */
export function writePoolsLocationSearch(search: string, current: PoolsLocation | undefined, next: PoolsLocation) {
	return updateSearchParams(search, params => {
		if (next.view !== 'operate' || current?.view !== 'operate' || current.questionLedgerAddress.toLowerCase() !== next.questionLedgerAddress.toLowerCase()) {
			params.delete('vault')
			params.delete('vaultView')
		}
	})
}

export const STATOBLAST_CONTEXT_QUERY_PARAMS = ['poolsView', 'openOracleReportId', 'vault', 'vaultView', 'poolSearch', 'poolSort', 'poolFilter'] as const

export function readPoolBrowseState(search: string): PoolBrowseState {
	const params = new URLSearchParams(search)
	return {
		searchText: params.get('poolSearch') ?? '',
		sortKey: resolveEnumValue<PoolSortKey>(params.get('poolSort') ?? '', 'recent', ['recent', 'remainingCapacity', 'endTime', 'state']),
		stateFilter: resolveEnumValue<PoolStateFilter>(params.get('poolFilter') ?? '', 'all', ['all', 'operational', 'ended', 'forkMigration']),
	}
}

export function writePoolBrowseState(search: string, update: Partial<PoolBrowseState>) {
	return updateSearchParams(search, params => {
		if (update.searchText !== undefined) {
			if (update.searchText === '') params.delete('poolSearch')
			else params.set('poolSearch', update.searchText)
		}
		if (update.sortKey !== undefined) setOrDeleteSearchParam(params, 'poolSort', update.sortKey === 'recent' ? undefined : update.sortKey)
		if (update.stateFilter !== undefined) setOrDeleteSearchParam(params, 'poolFilter', update.stateFilter === 'all' ? undefined : update.stateFilter)
	})
}

export function readVaultSelection(search: string) {
	const params = new URLSearchParams(search)
	const address = params.get('vault')?.trim()
	const view = resolveEnumValue<SelectedVaultView | ''>(params.get('vaultView') ?? '', '', ['browse-vaults', 'selected-vault', 'vault-by-address'])
	const vaultAddress = view !== 'selected-vault' && address !== undefined && isHexAddressInput(address) ? address : undefined
	const defaultView: SelectedVaultView | undefined = vaultAddress === undefined ? undefined : 'vault-by-address'
	return {
		vaultAddress,
		vaultView: view === '' ? defaultView : view,
	}
}
