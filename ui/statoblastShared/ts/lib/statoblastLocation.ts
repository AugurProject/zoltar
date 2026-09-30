import { resolveEnumValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import type { PoolBrowseState, PoolSortKey, PoolStateFilter, SelectedVaultView } from '../types/app.js'
import { parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { setOrDeleteSearchParam, updateSearchParams } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'

export const POOLS_ROUTE_HASH = '#/pools'
const LEGACY_SECURITY_POOLS_ROUTE_HASH = '#/security-pools'
const POOLS_PATH_PREFIX = `${POOLS_ROUTE_HASH}/`
const QUESTION_ID_QUERY_PARAM = 'questionId'
const LEGACY_POOL_QUERY_PARAMS = ['securityPool', 'securityPoolsView', 'selectedPoolView'] as const

/** A location inside the Pools route: the address entry, browse list, create and universe views, or one pool page with an optional tab. */
export type PoolsLocation = { view: 'browse' } | { view: 'create' } | { view: 'universes' } | { view: 'operate'; securityPoolAddress: string; tab: string }

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
const RESERVED_POOLS_SEGMENTS = new Set(['browse', 'create', 'operate', 'universes'])

/** Parses `#/pools`, `#/pools/browse`, `#/pools/create`, `#/pools/universes`, and `#/pools/<address>[/<tab>]`; returns `undefined` for any other hash. */
export function parsePoolsRouteHash(routeHash: string): PoolsLocation | undefined {
	if (routeHash === POOLS_ROUTE_HASH || routeHash === POOLS_PATH_PREFIX) return { view: 'browse' }
	if (!routeHash.startsWith(POOLS_PATH_PREFIX)) return undefined
	const segments = routeHash.slice(POOLS_PATH_PREFIX.length).replace(/\/$/, '').split('/').map(decodeSegment)
	if (segments.length > 2 || segments.some(segment => segment === undefined || segment.trim() === '')) return undefined
	const [first = '', tab = ''] = segments.map(segment => segment?.trim() ?? '')
	if (first === 'browse' || first === 'create' || first === 'universes') return tab === '' ? { view: first } : undefined
	// `operate` is the pool page's internal view name, not an address; a hand-written `#/pools/operate` link is unroutable.
	if (RESERVED_POOLS_SEGMENTS.has(first)) return undefined
	return { securityPoolAddress: first, tab, view: 'operate' }
}

export function buildPoolsRouteHash(location: PoolsLocation) {
	switch (location.view) {
		case 'browse':
			return POOLS_ROUTE_HASH
		case 'create':
		case 'universes':
			return `${POOLS_PATH_PREFIX}${location.view}`
		case 'operate': {
			const address = location.securityPoolAddress.trim()
			if (address === '') return POOLS_ROUTE_HASH
			const tab = location.tab.trim()
			return `${POOLS_PATH_PREFIX}${encodeURIComponent(address)}${tab === '' ? '' : `/${encodeURIComponent(tab)}`}`
		}
		default:
			return assertNever(location)
	}
}

/** The pool page hash, or the browse list when no address is given. */
export function buildPoolPageRouteHash(securityPoolAddress: string, tab = '') {
	return buildPoolsRouteHash({ securityPoolAddress, tab, view: 'operate' })
}

/**
 * Maps the legacy `#/security-pools?securityPoolsView=…&securityPool=…&selectedPoolView=…` links onto the path routes so
 * bookmarked pool links and the documented simulator entry points keep opening the same pool, tab, or view.
 */
export function mapLegacyStatoblastHash(hash: string): string | undefined {
	const { routeHash, search } = parseRouteHash(hash)
	if (routeHash !== LEGACY_SECURITY_POOLS_ROUTE_HASH && routeHash !== `${LEGACY_SECURITY_POOLS_ROUTE_HASH}/`) return undefined
	const params = new URLSearchParams(search)
	const view = params.get('securityPoolsView')?.trim() ?? ''
	const securityPoolAddress = params.get('securityPool')?.trim() ?? ''
	const tab = params.get('selectedPoolView')?.trim() ?? ''
	const location: PoolsLocation = (() => {
		if (securityPoolAddress !== '' && view !== 'browse' && view !== 'create' && view !== 'universes') return { securityPoolAddress, tab, view: 'operate' }
		if (view === 'create' || (view === '' && params.has(QUESTION_ID_QUERY_PARAM))) return { view: 'create' }
		if (view === 'universes' || view === 'universe') return { view: 'universes' }
		return { view: 'browse' }
	})()
	const nextSearch = updateSearchParams(search, nextParams => {
		for (const key of LEGACY_POOL_QUERY_PARAMS) nextParams.delete(key)
		if (location.view !== 'create') nextParams.delete(QUESTION_ID_QUERY_PARAM)
	})
	return `${buildPoolsRouteHash(location)}${nextSearch}`
}

/** Clears pool-scoped vault context when navigating to another pool or to the list. */
export function writePoolsLocationSearch(search: string, current: PoolsLocation | undefined, next: PoolsLocation) {
	return updateSearchParams(search, params => {
		if (next.view !== 'create') params.delete('questionId')
		if (next.view !== 'operate' || current?.view !== 'operate' || current.securityPoolAddress.toLowerCase() !== next.securityPoolAddress.toLowerCase()) {
			params.delete('vault')
			params.delete('vaultView')
		}
	})
}

export const STATOBLAST_CONTEXT_QUERY_PARAMS = ['poolsView', 'openOracleReportId', 'openOracleView', 'vault', 'vaultView', 'poolSearch', 'poolSort', 'poolFilter'] as const

export function readPoolBrowseState(search: string): PoolBrowseState {
	const params = new URLSearchParams(search)
	return {
		searchText: params.get('poolSearch') ?? '',
		sortKey: resolveEnumValue<PoolSortKey>(params.get('poolSort') ?? '', 'recent', ['recent', 'remainingCapacity', 'endTime', 'state']),
		stateFilter: resolveEnumValue<PoolStateFilter>(params.get('poolFilter') ?? '', 'all', ['all', 'operational', 'ended', 'poolForked', 'forkMigration', 'forkTruthAuction']),
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
