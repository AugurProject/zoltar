import type { OperationsDetailRoute } from './browser-types.ts'
import { shortIdentifier } from './identifier-format.ts'

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
		if (parts[0] === 'vault' && parts.length === 3) return { kind: 'vault', identity: parts.slice(1).map(decodeURIComponent) }
		if (parts[0] === 'operations' && parts[1] === 'risk' && parts[2] === 'pool' && parts.length === 4) return { kind: 'pool', identity: [decodeURIComponent(parts[3] ?? '')] }
		if (parts[0] === 'operations' && parts[1] === 'risk' && parts[2] === 'vault' && parts.length === 5) return { kind: 'vault', identity: parts.slice(3).map(decodeURIComponent) }
	} catch (error) {
		if (!(error instanceof URIError)) throw error
		return undefined
	}
	return undefined
}

export const classifyRoute = (pathname: string): ScannerRoute => {
	if (pathname === '/') return 'activity'
	if (pathname === '/system' || new RegExp(`^/(question|universe)/(${address}|[0-9]{1,78})$`).test(pathname)) return 'system'
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
	return `${name}${identity !== undefined && ['address', 'tx', 'block', 'pool', 'vault', 'report', 'auction', 'escalation', 'fork', 'trading', 'question', 'universe'].includes(canonicalKind ?? '') ? ` ${shortIdentifier(identity, 12, 8)}` : ''} · augurScan`
}
