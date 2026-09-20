import type { PublicOperatorSnapshot, PublicTransactionActivity } from '#state/operator-state'
import { countOpportunities, type EvaluatedOpportunitySnapshot, type OpportunityDecision, type OpportunitySnapshot, type SkippedOpportunitySnapshot } from '#state/opportunity-snapshot'
import type { MarketPricePoint } from '#monitoring/market-monitor'
import type { RewardWithdrawalDecision, SettlementCandidateSnapshot, SettlementDecision, SettlementSnapshot } from '#state/settlement-store'

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
	return activeNetwork === undefined || savedNetwork === undefined || activeNetwork === savedNetwork ? undefined : `Applying ${savedNetwork}; the last snapshot was ${activeNetwork}.`
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

export function amount(value: string | undefined, symbol: string) {
	if (value === undefined) return 'Unavailable'
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return `${value} ${symbol}`
	return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(numeric)} ${symbol}`
}

export function isConfigurationEnvelope(value: unknown): value is { configuration: unknown; revision: string } {
	return typeof value === 'object' && value !== null && 'configuration' in value && 'revision' in value && typeof value.revision === 'string'
}

export function configurationNetwork(configuration: unknown) {
	const network = typeof configuration === 'object' && configuration !== null && !Array.isArray(configuration) ? Reflect.get(configuration, 'network') : undefined
	return network === 'mainnet' || network === 'sepolia' ? network : undefined
}

export function countLabel(count: number, singular: string, plural = `${singular}s`) {
	return `${count.toString()} ${count === 1 ? singular : plural}`
}

export function opportunityCountLabel(opportunities: readonly Pick<OpportunitySnapshot, 'decision'>[]) {
	const counts = countOpportunities(opportunities)
	const evaluated = `${counts.evaluated.toString()} evaluated`
	return counts.skipped === 0 ? evaluated : `${evaluated} · ${counts.skipped.toString()} skipped`
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

type PollRetryTiming = Pick<PublicOperatorSnapshot, 'lastError' | 'lastPollFailureAt' | 'lastRetryAt' | 'nextRetryAt' | 'retryInProgress'>

export function pollRetryStatus(timing: PollRetryTiming, nowMilliseconds = Date.now()) {
	if (timing.lastError === undefined) return undefined
	if (timing.retryInProgress === true && timing.lastRetryAt !== undefined) {
		return {
			label: 'Retrying now',
			state: 'retrying' as const,
		}
	}
	if (timing.nextRetryAt !== undefined) {
		const retryMilliseconds = Date.parse(timing.nextRetryAt)
		if (Number.isFinite(retryMilliseconds)) {
			if (retryMilliseconds <= nowMilliseconds) {
				return {
					label: 'Retry due',
					state: 'due' as const,
				}
			}
			const remaining = compactDuration(Math.max(1, Math.ceil((retryMilliseconds - nowMilliseconds) / 1_000)))
			return {
				label: `Retry in ${remaining}`,
				state: 'scheduled' as const,
			}
		}
	}
	return undefined
}

export function blockAgeLabel(blockTimestamp: string | undefined, nowMilliseconds = Date.now()) {
	if (blockTimestamp === undefined || !/^(?:0|[1-9]\d*)$/.test(blockTimestamp)) return 'timestamp unavailable'
	const timestampMilliseconds = Number(blockTimestamp) * 1_000
	if (!Number.isSafeInteger(timestampMilliseconds) || !Number.isFinite(nowMilliseconds)) return 'timestamp unavailable'
	const differenceSeconds = Math.floor(Math.abs(nowMilliseconds - timestampMilliseconds) / 1_000)
	const label = compactDuration(differenceSeconds)
	return nowMilliseconds >= timestampMilliseconds ? `seen ${label} ago` : `${label} ahead of local clock`
}

export function botStatusLabels(state: Pick<PublicOperatorSnapshot, 'mode' | 'paused' | 'status' | 'marketAvailability'> | undefined) {
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
	if (state.status === 'error' && state.marketAvailability?.kind === 'missing-deployment') return { mode: state.mode, status: 'Not deployed' }
	if (state.status === 'running' && state.marketAvailability?.kind === 'no-execution-pools') return { mode: state.mode, status: 'No execution pools' }
	return { mode: state.mode, status: statuses[state.status] }
}

/** Skipped reports carry the concrete gate that declined them; evaluated decisions map to a fixed explanation. */
export function opportunityDecisionReason(opportunity: Pick<EvaluatedOpportunitySnapshot, 'decision' | 'tokenSymbol'> | Pick<SkippedOpportunitySnapshot, 'decision' | 'reason'>) {
	if (opportunity.decision === 'skipped') return opportunity.reason
	const reasons: Record<OpportunityDecision, string> = {
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

export function settlementDecisionReason(decision: SettlementDecision) {
	const reasons: Record<SettlementDecision, string> = {
		disabled: 'Third-party settlement is disabled under Settings › Settlement',
		'dry-run-settlement': 'Reward covers gas and the minimum net; execution mode is disabled',
		eligible: 'Reward covers gas and the minimum net',
		'execution-failed': 'The settle transaction was skipped or reverted; see the operations log',
		'gas-price-cap': 'Projected gas price exceeds the configured cap',
		'history-unavailable': 'Position recovery has not completed, so the daily gas budget is incomplete',
		'in-flight': 'A settlement transaction for this report is already pending',
		paused: 'Operator paused execution',
		'risk-limit': 'The UTC-day gas-spend limit leaves no room for this settlement',
		'signer-unavailable': 'Execution mode is locked until a local signer is set',
		settled: 'Settled in this scan',
		unprofitable: 'Reward does not cover projected gas plus the minimum net',
	}
	return reasons[decision]
}

/** Settled and failed rows stay visible for the scan but no longer wait, so the heading counts the rest. */
export function settlementQueueCountLabel(queue: readonly Pick<SettlementCandidateSnapshot, 'decision'>[]) {
	return `${queue.filter(candidate => candidate.decision !== 'settled' && candidate.decision !== 'execution-failed').length.toString()} awaiting settlement`
}

export function rewardWithdrawalLabel(settlements: Pick<SettlementSnapshot, 'settings' | 'unclaimedRewardEth' | 'withdrawalDecision'>) {
	if (settlements.unclaimedRewardEth === undefined) return 'Requires a local signer'
	const reasons: Record<RewardWithdrawalDecision, string> = {
		'below-threshold': `withdraws at ${settlements.settings.rewardWithdrawThresholdEth} ETH`,
		disabled: 'withdrawal disabled under Settings › Settlement',
		'dry-run': 'withdrawal waits for execution mode',
		due: 'withdrawal due',
		'gas-price-cap': 'withdrawal waits for gas below the cap',
		'history-unavailable': 'withdrawal waits for position recovery',
		'in-flight': 'withdrawal pending',
		paused: 'withdrawal paused',
		'risk-limit': 'withdrawal waits for the UTC-day gas budget',
		'signer-unavailable': 'withdrawal waits for a local signer',
		unavailable: `withdraws at ${settlements.settings.rewardWithdrawThresholdEth} ETH`,
	}
	return `${exactAmount(settlements.unclaimedRewardEth, 'ETH')} · ${reasons[settlements.withdrawalDecision]}`
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

export function statePollingFailureMessage(error: unknown) {
	if (error instanceof SyntaxError) return 'The state server returned an unreadable response. Automatic retry remains active; check the dashboard server if the next attempt also fails.'
	const message = error instanceof Error ? error.message : String(error)
	return message.startsWith('The bot tried to ') ? `${message} Use Refresh to retry now.` : `The bot tried to load the latest operator state for the dashboard, but it failed: ${message}. Automatic retry remains active; use Refresh to retry now.`
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

export function marketAvailabilityPresentation(notice: PublicOperatorSnapshot['marketAvailability']) {
	if (notice === undefined) return undefined
	if (notice.kind === 'no-execution-pools') return { title: 'No execution pools', detail: 'No pool candidates were found for the enabled Uniswap versions. Market checks continue automatically.' }
	const names = [...new Set(notice.contracts.map(contract => contract.name))].join(', ')
	return { title: 'Deployment unavailable', detail: `${names}: no contract at the configured ${notice.contracts.length === 1 ? 'address' : 'addresses'} on chain ${notice.chainId.toString()}. Availability is checked automatically.` }
}
