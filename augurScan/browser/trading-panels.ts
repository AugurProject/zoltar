import { isRecord, operationRecords, type JsonRecord } from './api-validation.ts'
import { exactUnit, utcDateTime } from './format.ts'
import type { createOperationsComponents } from './operations-components.ts'

type Components = ReturnType<typeof createOperationsComponents>

const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
	enter: 'Enter',
	exit: 'Exit',
	swap: 'Swap for',
	'add-liquidity': 'Add liquidity',
	'remove-liquidity': 'Remove liquidity',
	'mint-complete-sets': 'Mint complete sets',
	'redeem-complete-sets': 'Redeem complete sets',
	settlement: 'Settlement redemption',
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** @internal Exported for presentation unit tests. */
export const tradingActivityTitle = (item: JsonRecord): string => {
	const kind = String(item['kind'] ?? '')
	const label = ACTIVITY_LABELS[kind] ?? 'Trading action'
	const side = text(item['side'])
	return side === undefined ? label : `${label} ${side}`
}

const shareUnit = (item: JsonRecord): string => {
	const kind = String(item['kind'] ?? '')
	const side = text(item['side'])
	if (kind === 'add-liquidity' || kind === 'remove-liquidity') return 'LP tokens'
	if (kind === 'settlement') return 'winning shares'
	if (side !== undefined) return `${side} shares`
	return 'complete sets'
}

/** @internal Exported for presentation unit tests. */
export const tradingActivitySummary = (item: JsonRecord): string => {
	const parts = [exactUnit(text(item['shares']) ?? '0', 18, shareUnit(item))]
	const ethIn = text(item['eth_in_atto_eth'])
	const ethOut = text(item['eth_out_atto_eth'])
	if (ethIn !== undefined && ethIn !== '0') parts.push(`${exactUnit(ethIn, 18, 'ETH')} paid`)
	else if (ethOut !== undefined && ethOut !== '0') parts.push(`${exactUnit(ethOut, 18, 'ETH')} received`)
	else parts.push('No ETH moved')
	const seconds = text(item['timestamp_seconds'])
	if (seconds !== undefined) parts.push(utcDateTime(Number(seconds) * 1000))
	return parts.join(' · ')
}

export const tradingVolumeRows = (summary: JsonRecord, { operationRow, operationCounted }: { readonly operationRow: Components['operationRow']; readonly operationCounted: (value: unknown, singular: string, plural?: string) => string }) => [
	operationRow('24-hour ETH volume', `${exactUnit(text(summary['eth_volume_24h_atto_eth']) ?? '0', 18, 'ETH')} · ${operationCounted(summary['eth_trade_count_24h'], 'enter or exit', 'enters and exits')}`, undefined, undefined),
	operationRow('Seven-day ETH volume', exactUnit(text(summary['eth_volume_7d_atto_eth']) ?? '0', 18, 'ETH'), undefined, undefined),
	operationRow('All-time ETH volume', `${exactUnit(text(summary['eth_volume_atto_eth']) ?? '0', 18, 'ETH')} · ${operationCounted(summary['eth_trade_count'], 'enter or exit', 'enters and exits')}`, undefined, undefined),
]

export const tradingActivityPanel = (activity: unknown, { operationRow, operationsPanel, operationsHref }: { readonly operationRow: Components['operationRow']; readonly operationsPanel: Components['operationsPanel']; readonly operationsHref: (pathname: string) => string }) => {
	const page = isRecord(activity) ? activity : {}
	const items = operationRecords(page['items'])
	return operationsPanel(
		'Recent market activity',
		items.map(item => operationRow(tradingActivityTitle(item), tradingActivitySummary(item), String(item['account'] ?? ''), item['block_number'], operationsHref(`/tx/${String(item['tx_hash'] ?? '')}`))),
		'No trading activity is indexed for this market.',
		{ label: `Enters, exits, liquidity, and redemptions derived from indexed pool, pair, and share events.${page['hasMore'] === true ? ` Latest ${items.length} shown.` : ''}` },
	)
}

const signedEth = (value: unknown): string => {
	const amount = text(value)
	if (amount === undefined) return 'unavailable'
	return `${amount.startsWith('-') || amount === '0' ? '' : '+'}${exactUnit(amount, 18, 'ETH')}`
}

/** @internal Exported for presentation unit tests. */
export const tradingPnlSummary = (item: JsonRecord): string => {
	const valuation = isRecord(item['valuation']) ? item['valuation'] : {}
	const holdings = valuation['status'] === 'available' ? `${exactUnit(text(item['holdings_value_atto_eth']) ?? '0', 18, 'ETH')} exit value` : `holdings value unavailable (${String(valuation['reason'] ?? 'no valuation')})`
	return [
		`${exactUnit(text(item['cost_basis_atto_eth']) ?? '0', 18, 'ETH')} paid in`,
		`${exactUnit(text(item['proceeds_atto_eth']) ?? '0', 18, 'ETH')} received`,
		holdings,
		`realized ${signedEth(item['realized_pnl_atto_eth'])}`,
		`unrealized ${signedEth(item['unrealized_pnl_atto_eth'])}`,
		`net ${signedEth(item['net_pnl_atto_eth'])}`,
	].join(' · ')
}

/** @internal Exported for presentation unit tests. */
export const tradingPnlHoldings = (item: JsonRecord): string => {
	const holdings = `${exactUnit(text(item['invalid_atto_shares']) ?? '0', 18, 'INVALID')} · ${exactUnit(text(item['yes_atto_shares']) ?? '0', 18, 'YES')} · ${exactUnit(text(item['no_atto_shares']) ?? '0', 18, 'NO')} · ${exactUnit(text(item['lp_tokens']) ?? '0', 18, 'LP tokens')}`
	return item['open'] === true ? `Open · ${holdings}` : 'Closed position'
}

export const tradingPnlPanel = (
	pnl: unknown,
	{
		operationRow,
		operationsPanel,
		operationsHref,
		element,
	}: { readonly operationRow: Components['operationRow']; readonly operationsPanel: Components['operationsPanel']; readonly operationsHref: (pathname: string) => string; readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K] },
) => {
	const record = isRecord(pnl) ? pnl : {}
	return operationsPanel(
		'Trading profit and loss',
		operationRecords(record['items']).map(item => {
			const row = operationRow(String(item['question_title'] ?? 'Augur AMM market'), tradingPnlSummary(item), String(item['market_address'] ?? ''), undefined, operationsHref(`/operations/trading/${encodeURIComponent(String(item['market_address'] ?? ''))}`))
			row.querySelector('div')?.append(element('span', '', tradingPnlHoldings(item)))
			return row
		}),
		'No trading positions or ETH flows are indexed for this address.',
		{ label: `${String(record['basis'] ?? 'Indexed trading history')}${record['truncated'] === true ? ' First 250 markets shown.' : ''}` },
	)
}
