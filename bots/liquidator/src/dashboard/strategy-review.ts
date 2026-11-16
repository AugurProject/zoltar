import type { Configuration } from './api-validation.ts'
import { parseDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'
import { formatAmount } from '@zoltar/bot-shared/dashboard/amount'
import { parsePortfolioPolicy, type serializePortfolioPolicy } from '../config/portfolio-policy.ts'

export type StrategyUpdate = {
	maximumGasCostEth: string
	walletReserveRep: string
	portfolioPolicy: ReturnType<typeof serializePortfolioPolicy>
}

const amountFields = [
	['maximumGasCostEth', 'Maximum gas cost (ETH)', 'ETH'],
	['walletReserveRep', 'Wallet REP reserve', 'REP'],
	['maximumPrincipalRep', 'Principal per portfolio (REP)', 'REP'],
	['maximumTotalPrincipalRep', 'Total managed principal (REP)', 'REP'],
	['maximumCommitmentEth', 'Commitment per portfolio (ETH)', 'ETH'],
	['maximumOwnFundingRep', 'Own funding per takeover (REP)', 'REP'],
	['minimumNetRewardEth', 'Minimum net reward (ETH)', 'ETH'],
	['walletReserveEth', 'Wallet ETH reserve', 'ETH'],
] as const
const integerFields = [
	['targetHealthFactorBps', 'Target health', 'bps'],
	['maximumPositionsPerScan', 'Positions per scan', 'positions'],
	['stalledRetirementSeconds', 'Stalled retirement', 'seconds'],
] as const

export function validateStrategyReview(next: StrategyUpdate) {
	parseDecimalAmount(next.maximumGasCostEth, 'Maximum gas cost (ETH)')
	parseDecimalAmount(next.walletReserveRep, 'Wallet REP reserve')
	parsePortfolioPolicy(next.portfolioPolicy)
}

export function strategyReviewRows(saved: Configuration, next: StrategyUpdate) {
	const beforeValues: Record<string, string | number | boolean> = { ...saved.strategy, ...saved.portfolioPolicy }
	const { portfolioPolicy, ...common } = next
	return Object.entries({ ...common, ...portfolioPolicy }).flatMap(([name, after]) => {
		const before = beforeValues[name]
		if (String(before) === String(after)) return []
		const amount = amountFields.find(field => field[0] === name)
		if (amount !== undefined) return [{ label: amount[1], before: before === undefined ? '—' : formatAmount(String(before), amount[2]), after: formatAmount(String(after), amount[2]) }]
		const integerField = integerFields.find(field => field[0] === name)
		if (integerField !== undefined) return [{ label: integerField[1], before: `${before ?? '—'} ${integerField[2]}`, after: `${after} ${integerField[2]}` }]
		return [{ label: name === 'allowFundedTakeovers' ? 'Funded takeovers and earnings claims' : name, before: before === true ? 'Enabled' : 'Disabled', after: after === true ? 'Enabled' : 'Disabled' }]
	})
}
