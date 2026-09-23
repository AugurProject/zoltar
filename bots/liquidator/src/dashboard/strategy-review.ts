import type { Configuration } from './api-validation.ts'
import { integer, parseDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'

const amountFields = [
	['minimumLiquidationDebtEth', 'Minimum liquidation debt (ETH)'],
	['maximumLiquidationDebtEth', 'Maximum liquidation debt (ETH)'],
	['minimumRewardValueEth', 'Minimum reward (ETH)'],
	['maximumGasCostEth', 'Maximum gas cost (ETH)'],
	['maximumOracleRequestCostEth', 'Maximum oracle cost (ETH)'],
	['fallbackRepPerEthPrice', 'Fallback REP / ETH price'],
	['walletReserveRep', 'Wallet REP reserve'],
	['maximumPerPoolRep', 'REP per pool limit'],
	['maximumTotalDeployedRep', 'Total deployed REP limit'],
	['minimumRepWithdrawalRep', 'Minimum REP withdrawal'],
	['redeemFeesAboveEth', 'Redeem fees above (ETH)'],
] as const

const integerFields = [
	['stalePriceFundingBufferBps', 'Stale-price funding buffer (bps)', 10_000, 1_000_000],
	['stagedOperationValidForSeconds', 'Staged timeout (seconds)', 1, 300],
	['vaultTopUpHealthBps', 'Top-up health (bps)', 10_000, 1_000_000],
	['vaultTargetHealthBps', 'Target health (bps)', 10_001, 1_000_000],
	['vaultWithdrawHealthBps', 'Withdrawal health (bps)', 10_001, 1_000_000],
] as const

/** Match the server's amount, range, and policy checks before asking for confirmation. */
export function validateStrategyReview(saved: Configuration, next: Record<string, string | number | boolean>) {
	const amounts = new Map<string, bigint>()
	for (const [name, label] of amountFields) {
		const value = next[name]
		if (saved.strategy[name] === undefined && value === '') continue
		amounts.set(name, parseDecimalAmount(value, label))
	}
	const integers = new Map<string, number>()
	for (const [name, label, minimum, maximum] of integerFields) {
		const value = next[name]
		if (saved.strategy[name] === undefined && value === '') continue
		integers.set(name, integer(value, label, minimum, maximum))
	}
	integer(next['logLookbackBlocks'], 'Latest log window (blocks)', 1, 256)
	const minimumDebt = amounts.get('minimumLiquidationDebtEth')
	const maximumDebt = amounts.get('maximumLiquidationDebtEth')
	if (minimumDebt !== undefined && maximumDebt !== undefined && minimumDebt > maximumDebt) throw new Error('Minimum liquidation debt cannot exceed the maximum')
	const topUp = integers.get('vaultTopUpHealthBps')
	const target = integers.get('vaultTargetHealthBps')
	const withdraw = integers.get('vaultWithdrawHealthBps')
	if (topUp !== undefined && target !== undefined && topUp > target) throw new Error('Top-up health must not exceed target health')
	if (target !== undefined && withdraw !== undefined && target >= withdraw) throw new Error('Withdrawal health must exceed target health')
	const perPool = amounts.get('maximumPerPoolRep')
	const total = amounts.get('maximumTotalDeployedRep')
	if (perPool !== undefined && total !== undefined && perPool > total) throw new Error('Per-pool REP limit cannot exceed the total deployed REP limit')
}

/** Runtime log controls share the strategy form, but their saved values live outside strategy. */
export function strategyReviewRows(saved: Configuration, next: Record<string, string | number | boolean>) {
	return Object.entries(next).flatMap(([name, after]) => {
		let before = saved.strategy[name]
		if (name === 'logLookbackBlocks') before = saved.runtime.logLookbackBlocks
		if (name === 'historicalLogRecovery') before = saved.runtime.historicalLogRecovery
		if (String(before) === String(after)) return []
		if (name === 'logLookbackBlocks') return [{ label: 'log lookback blocks', before: `${before} blocks`, after: `${after} blocks` }]
		if (name === 'historicalLogRecovery') return [{ label: 'historical log recovery', before: before === true ? 'Enabled' : 'Disabled', after: after === true ? 'Enabled' : 'Disabled' }]
		return [{ label: name.replace(/([A-Z])/g, ' $1').toLowerCase(), before: String(before ?? '—'), after: String(after) }]
	})
}
