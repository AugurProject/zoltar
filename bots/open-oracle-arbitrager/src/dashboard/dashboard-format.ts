import type { OpportunitySnapshot, PublicOperatorSnapshot, PublicTransactionActivity } from '#state/operator-state'
import type { MarketPricePoint } from '#monitoring/market-monitor'

const DECIMAL_SCALE = 18

export function persistedConnectivity(value: unknown): { connectivity: { publicRpcUrls: string[]; readRpcUrl: string }; network: 'mainnet' | 'sepolia' } | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const network = Reflect.get(value, 'network')
	const connectivity = Reflect.get(value, 'connectivity')
	if ((network !== 'mainnet' && network !== 'sepolia') || typeof connectivity !== 'object' || connectivity === null || Array.isArray(connectivity)) return undefined
	const readRpcUrl = Reflect.get(connectivity, 'readRpcUrl')
	const publicRpcUrls = Reflect.get(connectivity, 'publicRpcUrls')
	if (typeof readRpcUrl !== 'string' || !Array.isArray(publicRpcUrls) || publicRpcUrls.some(url => typeof url !== 'string')) return undefined
	return { connectivity: { publicRpcUrls: publicRpcUrls.map(String), readRpcUrl }, network }
}

export function connectivityControlsDisabled(connected: boolean, requestPending: boolean) {
	return !connected || requestPending
}

export function pauseControlState(state: { connected: boolean; networkConfigured: boolean; paused: boolean; snapshotAvailable: boolean }) {
	const resumeAvailable = state.connected && state.networkConfigured
	return {
		confirmDisabled: !resumeAvailable,
		pauseDisabled: !state.snapshotAvailable || (state.paused && !resumeAvailable),
	}
}

export function networkTargetStatus(activeNetwork: 'mainnet' | 'sepolia' | undefined, savedNetwork: 'mainnet' | 'sepolia' | undefined) {
	return activeNetwork === undefined || savedNetwork === undefined || activeNetwork === savedNetwork ? undefined : `Saved for restart: ${savedNetwork}. The active process remains on ${activeNetwork}.`
}

export function singleFlight<T>(operation: () => Promise<T>) {
	let inFlight: Promise<T> | undefined
	let rerunRequested = false
	return () => {
		if (inFlight !== undefined) {
			rerunRequested = true
			return inFlight
		}
		inFlight = (async () => {
			rerunRequested = false
			let result = await operation()
			while (rerunRequested) {
				rerunRequested = false
				result = await operation()
			}
			return result
		})().finally(() => {
			inFlight = undefined
		})
		return inFlight
	}
}

export async function requestWithTimeout<T>(request: (signal: AbortSignal) => Promise<T>, timeoutMilliseconds: number, timeoutMessage = 'Dashboard state request timed out') {
	const controller = new AbortController()
	let timeout: ReturnType<typeof setTimeout> | undefined
	const deadline = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => {
			controller.abort()
			reject(new Error(timeoutMessage))
		}, timeoutMilliseconds)
	})
	try {
		return await Promise.race([request(controller.signal), deadline])
	} finally {
		if (timeout !== undefined) clearTimeout(timeout)
	}
}

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

export function venueLabel(venue: OpportunitySnapshot['venue']) {
	if (venue === 'uniswap-v2') return 'Uniswap V2'
	if (venue === 'uniswap-v3') return 'Uniswap V3'
	if (venue === 'uniswap-v4') return 'Uniswap V4'
	return 'Unknown'
}

export function marketPoolStrategyUse(tokenExecutable: boolean, venue: string) {
	if (!tokenExecutable) return 'Monitoring only'
	if (venue === 'Uniswap V2') return 'Optional execution route'
	return venue === 'Uniswap V3' ? 'Execution route' : 'Monitoring only'
}

export function chartPointX(index: number, count: number, width: number) {
	return count === 1 ? width / 2 : (index / (count - 1)) * width
}

export function chartTimeTickIndexes(sampleTimes: readonly number[], compact: boolean, plotWidth: number, minimumSpacing = 120) {
	if (sampleTimes.length === 0) return []
	const lastIndex = sampleTimes.length - 1
	const firstTime = sampleTimes[0]
	const lastTime = sampleTimes[lastIndex]
	if (firstTime === undefined || lastTime === undefined || firstTime === lastTime) return [0]
	if (compact || lastIndex === 1) return [0, lastIndex]
	const middleIndex = Math.floor(lastIndex / 2)
	const middleTime = sampleTimes[middleIndex]
	if (middleTime === undefined) return [0, lastIndex]
	const timeRange = lastTime - firstTime
	const middleX = ((middleTime - firstTime) / timeRange) * plotWidth
	if (middleX < minimumSpacing || plotWidth - middleX < minimumSpacing) return [0, lastIndex]
	return [0, middleIndex, lastIndex]
}

export function selectedTokenPriceHistory(points: readonly MarketPricePoint[], token: string) {
	return points.filter(point => point.token.toLowerCase() === token.toLowerCase())
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

export function botStatusLabels(state: Pick<PublicOperatorSnapshot, 'mode' | 'paused' | 'status'> | undefined) {
	if (state === undefined) return { mode: 'Mode —', status: '—' }
	if (state.paused) return { mode: state.mode, status: 'Paused' }
	const statuses: Record<PublicOperatorSnapshot['status'], string> = {
		'connectivity-degraded': 'Connectivity degraded',
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
		'market-risk': 'The executable DEX price is not confirmed by reliable centralized-market price and depth',
		paused: 'Operator paused execution',
		'risk-limit': 'A concurrent-position, position-notional, total-locked-capital, or UTC-day gas-spend limit blocks execution',
		selected: 'Highest modeled net profit in this scan',
		'self-report': 'Current wallet is already the reporter',
		'signer-unavailable': 'Execution mode is locked until a local signer is set',
		submitted: 'Signed dispute was accepted for delivery',
		unprofitable: 'Modeled profit is below configured thresholds',
	}
	return reasons[opportunity.decision]
}

export function transactionKindLabel(transaction: Pick<PublicTransactionActivity, 'kind' | 'tokenSymbol'>) {
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
