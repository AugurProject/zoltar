import type { OperationsDetailRoute } from './browser-types.ts'
import { protocolIdHex, shortIdentifier } from './identifier-format.ts'

const address = '0x[0-9a-fA-F]{40}'
const hash = '0x[0-9a-fA-F]{64}'
const operationsSections = new Set(['reports', 'escalations', 'forks', 'risk', 'auctions', 'trading', 'timeline', 'integrity'])

export type ScannerRoute = 'activity' | 'system' | 'operations' | 'contracts' | 'richlist' | 'address' | 'explorer' | 'not-found'

export const parseOperationsDetailRoute = (pathname: string): OperationsDetailRoute | undefined => {
	const parts = pathname.split('/').filter(Boolean)
	try {
		if ((parts[0] === 'report' || (parts[0] === 'operations' && parts[1] === 'report')) && parts.length === (parts[0] === 'report' ? 3 : 4)) return { kind: 'report', identity: parts.slice(-2).map(decodeURIComponent) }
		const kind = parts[0] === 'operations' ? parts[1] : parts[0]
		const expected = parts[0] === 'operations' ? 3 : 2
		if ((kind === 'auction' || kind === 'escalation' || kind === 'fork' || kind === 'trading') && parts.length === expected) return { kind, identity: [decodeURIComponent(parts.at(-1) ?? '')] }
		if (parts[0] === 'pool' && parts.length === 2) return { kind: 'pool', identity: [decodeURIComponent(parts[1] ?? '')] }
		if (parts[0] === 'operations' && parts[1] === 'risk' && parts[2] === 'pool' && parts.length === 4) return { kind: 'pool', identity: [decodeURIComponent(parts[3] ?? '')] }
		// A capital position is identified by its universe ledger and its owner.
		if (parts[0] === 'capital' && parts.length === 3) return { kind: 'capital', identity: parts.slice(1).map(decodeURIComponent) }
		if (parts[0] === 'operations' && parts[1] === 'risk' && parts[2] === 'capital' && parts.length === 5) return { kind: 'capital', identity: parts.slice(3).map(decodeURIComponent) }
	} catch (error) {
		if (!(error instanceof URIError)) throw error
		return undefined
	}
	return undefined
}

/**
 * A question or universe ID from its route segment as the decimal the catalog API requires.
 * Accepts the decimal form and the 0x-prefixed uint256 hex form the detail pages display; undefined for anything else.
 */
export const systemRouteIdentity = (segment: string): string | undefined => {
	if (/^[0-9]{1,78}$/.test(segment)) return BigInt(segment) < 2n ** 256n ? BigInt(segment).toString() : undefined
	return /^0x[0-9a-fA-F]{1,64}$/.test(segment) ? BigInt(segment).toString() : undefined
}

export const classifyRoute = (pathname: string): ScannerRoute => {
	if (pathname === '/') return 'activity'
	if (pathname === '/system' || (/^\/(question|universe)\/[^/]+$/.test(pathname) && systemRouteIdentity(pathname.split('/')[2] ?? '') !== undefined)) return 'system'
	if (pathname === '/operations' || (pathname.startsWith('/operations/') && ((operationsSections.has(pathname.split('/')[2] ?? '') && pathname.split('/').length === 3) || parseOperationsDetailRoute(pathname) !== undefined)) || parseOperationsDetailRoute(pathname) !== undefined) return 'operations'
	if (pathname === '/contracts') return 'contracts'
	if (pathname === '/richlist') return 'richlist'
	if (pathname === '/address' || new RegExp(`^/address/${address}$`).test(pathname)) return 'address'
	if (new RegExp(`^/tx/${hash}$`).test(pathname) || /^\/block\/\d{1,19}$/.test(pathname)) return 'explorer'
	return 'not-found'
}

export const canonicalOperationsPath = (pathname: string): string => {
	const detail = parseOperationsDetailRoute(pathname)
	if (detail === undefined || !pathname.startsWith('/operations/')) return pathname
	const encoded = detail.identity.map(encodeURIComponent).join('/')
	return `/${detail.kind}/${encoded}`
}

export const routeTitle = (pathname: string): string => {
	const route = classifyRoute(pathname)
	if (route === 'not-found') return 'Page not found · augurScan'
	const names: Record<ScannerRoute, string> = { activity: 'Activity', system: 'System state', operations: 'Operations', contracts: 'Contracts', richlist: 'Rich list', address: 'Address', explorer: pathname.startsWith('/tx/') ? 'Transaction' : 'Block', 'not-found': 'Page not found' }
	const canonicalKind = pathname.split('/')[1]
	let name = names[route]
	if (route === 'system' && canonicalKind === 'question') name = 'Question'
	else if (route === 'system' && canonicalKind === 'universe') name = 'Universe'
	else if (route === 'operations' && !pathname.startsWith('/operations')) name = `${canonicalKind?.slice(0, 1).toUpperCase()}${canonicalKind?.slice(1)}`
	const identity = pathname.split('/').filter(Boolean).at(-1)
	return `${name}${identity !== undefined && ['address', 'tx', 'block', 'pool', 'capital', 'report', 'auction', 'escalation', 'fork', 'trading', 'question', 'universe'].includes(canonicalKind ?? '') ? ` ${shortIdentifier(canonicalKind === 'question' ? protocolIdHex(identity) : identity, 12, 8)}` : ''} · augurScan`
}

const timelineContextParameters = ['q', 'entityType', 'event', 'address', 'fromBlock', 'toBlock', 'canonical']

/** Identifies the data a route shows: the chain, the path, and the query parameters that select a different result set. */
export const routeDataContext = (chainId: string, url: URL): string => {
	const { pathname } = url
	let parameters: readonly string[] = []
	if (pathname === '/operations/timeline') parameters = timelineContextParameters
	else if (pathname.startsWith('/operations/risk') || pathname.startsWith('/pool/') || pathname.startsWith('/capital/')) parameters = ['atBlock']
	const selected = parameters.flatMap(name => {
		const value = url.searchParams.get(name)
		return value === null || value === '' ? [] : [`${name}=${encodeURIComponent(value)}`]
	})
	return `${chainId}:${pathname}${selected.length === 0 ? '' : `?${selected.join('&')}`}`
}

// Parameters that select content within one route (details, tabs, and filters); they never follow the user to another route.
const routeScopedParameters = ['log', 'account', 'contract', 'entity', 'tab', 'fromBlock', 'toBlock', 'event', 'address', 'q', 'entityType', 'canonical', 'atBlock']

// Preferences that only one route reads; they follow the user only back to that route.
const routePreferenceParameters: Readonly<Record<string, string>> = { sort: '/richlist', view: '/richlist' }

/** Builds the destination of a navigation link: the link's own URL plus the current page-wide parameters (network, demo flags, preferences). */
export const navigationTarget = (linkUrl: URL, currentUrl: URL): URL => {
	const target = new URL(linkUrl)
	for (const name of routeScopedParameters) target.searchParams.delete(name)
	for (const [name, value] of currentUrl.searchParams) {
		const preferenceRoute = routePreferenceParameters[name]
		if (preferenceRoute !== undefined && preferenceRoute !== target.pathname) continue
		if (!target.searchParams.has(name) && !routeScopedParameters.includes(name)) target.searchParams.set(name, value)
	}
	return target
}

/**
 * The destination of a section link (the desktop tabs and the narrow-screen picker): the section already shown keeps the
 * current view, including a historical `atBlock`, and any other section is a fresh {@link navigationTarget}.
 */
export const sectionLinkTarget = (linkUrl: URL, currentUrl: URL): URL => {
	if (linkUrl.pathname !== currentUrl.pathname) return navigationTarget(linkUrl, currentUrl)
	const target = new URL(currentUrl)
	target.hash = ''
	return target
}

// Selected records and block numbers name positions on one chain; they mean something else, or nothing, on another.
const chainRecordParameters = ['log', 'entity', 'account', 'contract']
const chainBlockParameters = ['atBlock', 'fromBlock', 'toBlock']

/** The current URL after the selected network changed: every record, and unless kept every block number, of the previous chain is dropped. */
export const networkSwitchUrl = (currentUrl: URL, { keepBlockNumbers = false }: { readonly keepBlockNumbers?: boolean } = {}): URL => {
	const target = new URL(currentUrl)
	for (const name of keepBlockNumbers ? chainRecordParameters : [...chainRecordParameters, ...chainBlockParameters]) target.searchParams.delete(name)
	return target
}
