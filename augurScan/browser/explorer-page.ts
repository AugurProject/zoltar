import { callTraceRows } from './call-trace.ts'
import { isRecord } from './api-validation.ts'
import { exactNumber, exactUnit, utcDateTime } from './format.ts'
import { short } from './identifier-format.ts'

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value?: string): HTMLElementTagNameMap[K] => {
	const result = document.createElement(tag)
	result.className = className
	if (value !== undefined) result.textContent = value
	return result
}

const link = (label: string, href: string): HTMLAnchorElement => {
	const anchor = node('a', 'address-link', label)
	const destination = new URL(href, location.origin)
	if (destination.origin === location.origin && new URL(location.href).searchParams.get('demo') === '1') destination.searchParams.set('demo', '1')
	anchor.href = destination.href
	return anchor
}

const field = (label: string, value: string | HTMLElement): HTMLElement => {
	const card = node('div', 'static-field')
	card.append(node('span', '', label), typeof value === 'string' ? node('code', '', value) : value)
	return card
}

const string = (record: Record<string, unknown>, key: string): string => String(record[key] ?? '—')

const activeRequests = new WeakMap<HTMLElement, number>()

export const renderExplorerPage = async (path: string, chainId: string, api: (path: string) => Promise<unknown>, live = false): Promise<boolean> => {
	const content = document.querySelector<HTMLElement>('#explorer-content')
	if (content === null) return false
	const requestId = (activeRequests.get(content) ?? 0) + 1
	activeRequests.set(content, requestId)
	const isCurrent = () => {
		const current = new URL(location.href)
		return activeRequests.get(content) === requestId && current.pathname === path && current.searchParams.get('chainId') === chainId
	}
	if (live) content.setAttribute('aria-busy', 'true')
	else content.replaceChildren(node('p', 'system-status', 'Loading indexed evidence…'))
	const parts = path.split('/').filter(Boolean)
	const kind = parts[0]
	const identity = parts[1]
	if ((kind !== 'tx' && kind !== 'block') || identity === undefined || parts.length !== 2) {
		content.replaceChildren(node('h2', '', 'Page not found'), link('Back to activity', '/'))
		content.removeAttribute('aria-busy')
		return false
	}
	try {
		const endpoint = kind === 'tx' ? 'transactions' : 'blocks'
		const result = await api(`/api/v1/${endpoint}/${encodeURIComponent(chainId)}/${encodeURIComponent(identity)}`)
		if (!isRecord(result)) throw new Error('Evidence response is malformed')
		const record = result[kind === 'tx' ? 'transaction' : 'block']
		if (!isRecord(record)) throw new Error('Evidence record is malformed')
		if (!isCurrent()) return false
		const title = kind === 'tx' ? `Transaction ${short(identity, 12, 8)}` : `Block #${exactNumber(string(record, 'number'))}`
		document.title = `${title} · augurScan`
		const heading = node('header', 'section-heading')
		heading.append(node('h2', '', title))
		const explorer = link('View in Etherscan ↗', `${string(record, 'explorer_base_url').replace(/\/$/, '')}/${kind === 'tx' ? 'tx' : 'block'}/${identity}`)
		explorer.target = '_blank'
		explorer.rel = 'noreferrer'
		const summary = node('div', 'static-grid')
		if (kind === 'tx') {
			summary.append(
				field('Hash', string(record, 'hash')),
				field('Block', link(`#${exactNumber(string(record, 'block_number'))}`, `/block/${record['block_number']}?chainId=${chainId}`)),
				field('Time', utcDateTime(string(record, 'block_timestamp'))),
				field('Action', string(record, 'action_summary') === '—' ? string(record, 'function_name') : string(record, 'action_summary')),
				field('From', link(string(record, 'from_address'), `/address/${record['from_address']}?chainId=${chainId}`)),
				field('To', record['to_address'] === null ? 'Contract deployment' : link(string(record, 'to_address'), `/address/${record['to_address']}?chainId=${chainId}`)),
				field('Status', string(record, 'status')),
				field('Transaction value', exactUnit(string(record, 'value'), 18, 'ETH')),
				field('Gas used', exactNumber(string(record, 'gas_used'))),
			)
		} else {
			summary.append(field('Hash', string(record, 'hash')), field('Time', utcDateTime(string(record, 'timestamp'))), field('Parent', string(record, 'parent_hash')), field('Finalized', record['finalized'] === true ? 'Yes' : 'No'))
		}
		if (kind === 'tx') {
			const receipt = isRecord(record['receipt']) ? record['receipt'] : {}
			const traces = node('section', 'static-card')
			traces.append(node('h3', '', 'Calls and ETH value flows'))
			const calls = callTraceRows(receipt['callTrace'])
			for (const call of calls) traces.append(node('p', 'data-note', call))
			if (calls.length === 0) traces.append(node('p', 'data-note', 'Call traces unavailable for this transaction. Transaction value is an attempted value for reverted transactions.'))
			summary.append(traces)
		}
		const rows = result[kind === 'tx' ? 'logs' : 'transactions']
		const section = node('section', 'static-card')
		let sectionTitle = 'Transactions'
		if (kind === 'tx') sectionTitle = 'Decoded logs'
		else if (result['hasMore'] === true) sectionTitle = `First ${exactNumber(rows instanceof Array ? rows.length : 0)} transactions`
		section.append(node('h3', '', sectionTitle))
		if (kind === 'block' && result['hasMore'] === true) section.append(node('p', 'data-note', 'More indexed transactions exist in this block.'))
		if (!Array.isArray(rows) || rows.length === 0) section.append(node('p', 'data-note', 'No indexed evidence in this block.'))
		else
			for (const row of rows) {
				if (!isRecord(row)) continue
				const article = node('div', 'explorer-evidence-row')
				if (kind === 'tx') {
					article.append(node('strong', '', string(row, 'summary') === '—' ? string(row, 'event_name') : string(row, 'summary')))
					article.append(link(`Log #${exactNumber(string(row, 'log_index'))} · ${string(row, 'event_name')}`, `/?chainId=${chainId}&log=${chainId}:${row['block_hash']}:${row['tx_hash']}:${row['log_index']}`))
				} else {
					article.append(node('strong', '', string(row, 'action_summary') === '—' ? string(row, 'function_name') : string(row, 'action_summary')))
					article.append(link(short(string(row, 'hash'), 12, 8), `/tx/${row['hash']}?chainId=${chainId}`))
				}
				section.append(article)
			}
		content.replaceChildren(heading, explorer, summary, section)
		content.removeAttribute('aria-busy')
		return true
	} catch (error) {
		if (!isCurrent()) return false
		if (live) {
			content.querySelector('.explorer-refresh-error')?.remove()
			content.append(node('p', 'system-status error explorer-refresh-error', 'Could not refresh indexed evidence. The prior evidence remains visible.'))
		} else {
			const retry = node('button', 'state-retry explorer-retry', 'Retry')
			retry.type = 'button'
			retry.addEventListener('click', () => void renderExplorerPage(path, chainId, api))
			content.replaceChildren(node('h2', '', error instanceof Error && error.status === 404 ? 'Page not found' : 'Evidence unavailable'), node('p', 'system-status error', error instanceof Error ? error.message : String(error)), retry, link('Back to activity', '/'))
		}
		content.removeAttribute('aria-busy')
		return false
	}
}
