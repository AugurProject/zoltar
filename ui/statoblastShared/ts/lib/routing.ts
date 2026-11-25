import { getAddress, isAddress } from '@zoltar/core-shared/evm/ethereum'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { buildRouteHref, getTopLevelRouteSearch, installRouting, parseRouteHash, type RoutingConfig } from '@zoltar/ui-core-shared/navigation/routing.js'
import { writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import type { PoolTab, StatoblastPage } from '../types/app.js'
export type { PoolTab, StatoblastPage, StatoblastPoolPage, StatoblastQuestionPage } from '../types/app.js'

export const poolTabs = ['capital', 'questions', 'price', 'liquidations', 'fork'] as const satisfies readonly PoolTab[]
export const questionTabs = ['shares', 'reporting', 'claims'] as const

export function designQuestionId(value: string) {
	if (!/^(?:0x[0-9a-f]{1,64}|[0-9]{1,78})$/iu.test(value)) return undefined
	const id = BigInt(value)
	return id < 1n << 256n ? id : undefined
}

export function parseStatoblastPage(hash: string): StatoblastPage {
	const { routeHash, search } = parseRouteHash(hash)
	switch (routeHash) {
		case '':
		case '#/':
			return { kind: 'choose-universe' }
		case '#/watchlist':
			return { kind: 'watchlist' }
		case '#/migrate-rep':
			return { kind: 'migrate-rep' }
		case '#/deploy-pool':
			return { kind: 'deploy-pool' }
		default:
			break
	}
	const [root, kind, address, path, id, view, ...rest] = routeHash.split('/')
	if (root !== '#' || kind !== 'pool' || address === undefined || !isAddress(address) || rest.length !== 0) return { kind: 'not-found' }
	const pool = getAddress(address)
	if (path === 'question' && id !== undefined) {
		const questionId = designQuestionId(id)
		const tab = questionTabs.find(candidate => candidate === view)
		if (questionId !== undefined && tab !== undefined) {
			const action = new URLSearchParams(search).get('action')
			return { kind: 'question', pool, questionId, tab, ...(tab === 'shares' && (action === 'mint' || action === 'redeem') ? { sharesAction: action } : {}) }
		}
	} else if (id === undefined) {
		const tab = path === undefined ? 'capital' : poolTabs.find(candidate => candidate === path)
		if (tab !== undefined) {
			const position = tab === 'liquidations' ? designQuestionId(new URLSearchParams(search).get('position') ?? '') : undefined
			return { kind: 'pool', pool, tab, ...(position !== undefined && position > 0n && position < 1n << 96n ? { positionId: position } : {}) }
		}
	}
	return { kind: 'not-found' }
}

type RouteName = Exclude<StatoblastPage['kind'], 'not-found'>
const routing: RoutingConfig<RouteName> = {
	defaultRoute: 'choose-universe',
	routes: [
		{ name: 'choose-universe', hash: '#/' },
		{ name: 'watchlist', hash: '#/watchlist' },
		{ name: 'migrate-rep', hash: '#/migrate-rep' },
		{ name: 'deploy-pool', hash: '#/deploy-pool' },
		{
			match: hash => {
				const page = parseStatoblastPage(hash)
				return page.kind === 'pool' || page.kind === 'question' ? page.kind : undefined
			},
		},
	],
}

export function installStatoblastRouting() {
	installRouting(routing)
}

export function statoblastPageHash(page: Exclude<StatoblastPage, { kind: 'not-found' }>) {
	if (page.kind === 'choose-universe') return '#/'
	if (page.kind === 'pool') return `#/pool/${page.pool}${page.tab === 'capital' ? '' : `/${page.tab}`}`
	if (page.kind === 'question') return `#/pool/${page.pool}/question/${formatQuestionIdHex(page.questionId)}/${page.tab}`
	return `#/${page.kind}`
}

export function statoblastPageHref(page: Parameters<typeof statoblastPageHash>[0], universeId?: bigint) {
	let search = getTopLevelRouteSearch(page.kind)
	if (universeId !== undefined) search = writeUniverseQueryParam(search, universeId)
	if (page.kind === 'question' && page.tab === 'shares' && page.sharesAction !== undefined) {
		const params = new URLSearchParams(search)
		params.set('action', page.sharesAction)
		search = `?${params}`
	}
	if (page.kind === 'pool' && page.tab === 'liquidations' && page.positionId !== undefined) {
		const params = new URLSearchParams(search)
		params.set('position', page.positionId.toString())
		search = `?${params}`
	}
	return buildRouteHref(statoblastPageHash(page), search)
}
