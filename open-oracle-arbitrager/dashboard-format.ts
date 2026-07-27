import type { OperatorSnapshot, OpportunitySnapshot, TransactionActivity } from './operator-state.js'
import type { MarketPricePoint } from './market-monitor.js'

const DECIMAL_SCALE = 18

function parseSignedDecimal(value: string) {
	if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`Invalid decimal amount: ${value}`)
	const negative = value.startsWith('-')
	const unsigned = negative ? value.slice(1) : value
	const [whole = '0', fraction = ''] = unsigned.split('.')
	const scaled = BigInt(whole) * 10n ** BigInt(DECIMAL_SCALE) + BigInt(fraction.padEnd(DECIMAL_SCALE, '0'))
	return negative ? -scaled : scaled
}

function decimalFromScaled(value: bigint) {
	const negative = value < 0n
	const unsigned = negative ? -value : value
	const scale = 10n ** BigInt(DECIMAL_SCALE)
	const whole = unsigned / scale
	const fraction = (unsigned % scale).toString().padStart(DECIMAL_SCALE, '0').replace(/0+$/, '')
	const decimal = fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
	return negative ? `-${decimal}` : decimal
}

export function exactAmount(value: string | undefined, symbol: string) {
	return value === undefined ? 'Unavailable' : `${value} ${symbol}`
}

export function countLabel(count: number, singular: string, plural = `${singular}s`) {
	return `${count.toString()} ${count === 1 ? singular : plural}`
}

export function chartPointX(index: number, count: number, width: number) {
	return count === 1 ? width / 2 : (index / (count - 1)) * width
}

function compactDuration(seconds: number) {
	if (seconds < 60) return `${seconds.toString()}s`
	const minutes = Math.floor(seconds / 60)
	const remainder = seconds % 60
	if (minutes < 60) return remainder === 0 ? `${minutes.toString()}m` : `${minutes.toString()}m ${remainder.toString()}s`
	const hours = Math.floor(minutes / 60)
	const remainingMinutes = minutes % 60
	return remainingMinutes === 0 ? `${hours.toString()}h` : `${hours.toString()}h ${remainingMinutes.toString()}m`
}

export function blockAgeLabel(blockTimestamp: string | undefined, nowMilliseconds = Date.now()) {
	if (blockTimestamp === undefined || !/^(?:0|[1-9]\d*)$/.test(blockTimestamp)) return 'timestamp unavailable'
	const timestampMilliseconds = Number(blockTimestamp) * 1_000
	if (!Number.isSafeInteger(timestampMilliseconds) || !Number.isFinite(nowMilliseconds)) return 'timestamp unavailable'
	const differenceSeconds = Math.floor(Math.abs(nowMilliseconds - timestampMilliseconds) / 1_000)
	const label = compactDuration(differenceSeconds)
	return nowMilliseconds >= timestampMilliseconds ? `${label} behind` : `${label} ahead of local clock`
}

export function botStatusLabels(state: Pick<OperatorSnapshot, 'mode' | 'paused' | 'status'> | undefined) {
	if (state === undefined) return { mode: 'Mode —', status: '—' }
	if (state.paused) return { mode: state.mode, status: 'Paused' }
	const statuses: Record<OperatorSnapshot['status'], string> = {
		error: 'Error',
		paused: 'Paused',
		running: 'Running',
		stopped: 'Stopped',
		syncing: 'Syncing',
	}
	return { mode: state.mode, status: statuses[state.status] }
}

export function opportunityDecisionReason(opportunity: Pick<OpportunitySnapshot, 'decision' | 'tokenSymbol'>) {
	const reasons: Record<OpportunitySnapshot['decision'], string> = {
		'dry-run-opportunity': 'All economic guards pass; execution mode is disabled',
		eligible: 'Profit, timing, state, and inventory guards pass',
		'execution-failed': 'Execution raised an error after selection',
		'history-unavailable': 'Confirmed-history durability is unavailable',
		'insufficient-inventory': `Wallet lacks the required WETH or ${opportunity.tokenSymbol}`,
		paused: 'Operator paused execution',
		'risk-limit': 'A restart-time portfolio or daily-loss limit blocks execution',
		selected: 'Highest modeled net profit in this scan',
		'self-report': 'Current wallet is already the reporter',
		'signer-unavailable': 'Execution mode is locked until a local signer is set',
		submitted: 'Signed dispute was accepted for delivery',
		unprofitable: 'Modeled profit is below configured thresholds',
	}
	return reasons[opportunity.decision]
}

export function transactionKindLabel(transaction: Pick<TransactionActivity, 'kind' | 'tokenSymbol'>) {
	return transaction.kind === 'approval-token' ? `approve ${transaction.tokenSymbol ?? 'token'}` : transaction.kind.replaceAll('-', ' ')
}

export function marketPriceChartDescription(points: readonly Pick<MarketPricePoint, 'blockNumber'>[]) {
	return `${countLabel(points.length, 'current-head pool sample')} spanning observed heads at blocks ${points[0]?.blockNumber ?? 'unknown'} through ${points.at(-1)?.blockNumber ?? 'unknown'}. Exact recent values follow the chart in a table.`
}

export function requiredSignerPrivateKey(value: string) {
	const privateKey = value.trim()
	if (privateKey === '') throw new Error('Enter a private key before setting the signer.')
	return privateKey
}

export function signerControlState(parameters: { hasQueuedSigner: boolean; hasWallet: boolean; privateKey: string; requestPending: boolean }) {
	return {
		clearDisabled: parameters.requestPending || (!parameters.hasWallet && !parameters.hasQueuedSigner),
		inputDisabled: parameters.requestPending,
		setDisabled: parameters.requestPending || parameters.privateKey.trim() === '',
	}
}

export function sumSignedDecimals(values: readonly string[]) {
	return decimalFromScaled(values.reduce((total, value) => total + parseSignedDecimal(value), 0n))
}
