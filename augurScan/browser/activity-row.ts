import type { ActivityRecord, LogReference } from './browser-types.ts'
import { short } from './identifier-format.ts'

export const logKeyFor = (log: LogReference): string => `${log.chain_id}:${log.block_hash}:${log.tx_hash}:${log.log_index}`

export interface ActivityRowDeps {
	readonly setLiveRecord: <T extends HTMLElement>(node: T, key: string, value: unknown) => T
	readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	readonly number: (value: string | number | bigint | null | undefined) => string
	readonly isDemo: boolean
	readonly time: (value: string | number | Date | null | undefined) => string
	readonly age: (value: string | number | Date | null | undefined) => string
	readonly exactTimestamp: (value: string | number | Date | null | undefined) => string
	readonly eventDrawerFor: (key: string) => HTMLElement | undefined
	readonly closeEventDrawer: (options: { restoreFocus: boolean; key: string }) => void
	readonly openDetail: (log: ActivityRecord) => Promise<boolean>
}

export const renderActivityRow = (deps: ActivityRowDeps, log: ActivityRecord) => {
	const { setLiveRecord, element, number, isDemo, time, age, exactTimestamp, eventDrawerFor, closeEventDrawer, openDetail } = deps
	const key = logKeyFor(log)
	const row = setLiveRecord(element('article', 'log-row'), key, {
		contractLabel: log.contract_label,
		eventName: log.event_name,
		summary: log.summary,
		origin: log.origin_address,
		functionName: log.function_name,
		actionSummary: log.action_summary,
	})
	const chain = element('span', 'cell chain-block')
	const openCue = element('span', 'row-open-cue', '›')
	openCue.setAttribute('aria-hidden', 'true')
	const blockLink = element('a', '', `#${number(log.block_number)}`)
	blockLink.className = 'address-link activity-target'
	blockLink.href = `/block/${log.block_number}?chainId=${log.chain_id}${isDemo ? '&demo=1' : ''}`
	chain.append(blockLink, openCue)
	const timestamp = element('time', 'cell cell-time', `${time(log.block_timestamp)} · ${age(log.block_timestamp)}`)
	timestamp.dataset.time = log.block_timestamp
	timestamp.dateTime = exactTimestamp(log.block_timestamp)
	timestamp.title = exactTimestamp(log.block_timestamp)
	const contractLink = element('a')
	contractLink.className = 'cell address-link activity-target activity-contract-link'
	contractLink.href = `/address/${log.emitter_address}?chainId=${log.chain_id}${isDemo ? '&demo=1' : ''}`
	contractLink.title = log.contract_label ? `${log.contract_label} · ${log.emitter_address}` : log.emitter_address
	contractLink.replaceChildren(element('span', 'contract-name', log.contract_label || short(log.emitter_address, 10, 8)))
	const event = element('button', 'cell event-name', log.event_name ?? 'Unknown event')
	event.type = 'button'
	event.setAttribute('aria-label', `Toggle ${log.event_name ?? 'unknown event'} log details from block ${log.block_number}`)
	event.setAttribute('aria-expanded', String(eventDrawerFor(key) !== undefined))
	const tx = element('a', '', `${short(log.tx_hash, 7, 5)} · ${log.log_index}`)
	tx.className = 'cell cell-tx activity-target'
	tx.href = `/tx/${log.tx_hash}?chainId=${log.chain_id}${isDemo ? '&demo=1' : ''}`
	const origin = element('a', 'cell cell-origin activity-target', log.origin_address ? short(log.origin_address, 6, 4) : '—')
	if (log.origin_address) origin.href = `/address/${log.origin_address}?chainId=${log.chain_id}${isDemo ? '&demo=1' : ''}`
	const action = element('span', 'cell cell-function', log.function_name === 'deploy' ? (log.action_summary ?? 'Deploy contract') : (log.function_name ?? (log.to_address === null ? 'Deploy contract' : 'Unknown call')))
	action.title = `Transaction action: ${log.function_signature ?? log.action_summary ?? action.textContent ?? ''}`
	row.append(chain, timestamp, contractLink, event, action, tx, origin, element('p', 'activity-summary-text', log.summary))
	row.addEventListener('click', click => {
		if (click.target instanceof Element && click.target.closest('a')) return
		if (eventDrawerFor(key)) closeEventDrawer({ restoreFocus: true, key })
		else void openDetail(log)
	})
	return row
}
