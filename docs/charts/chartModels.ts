import { computeEscalationBindingCapitalAttoRep, computeEscalationTimeSinceStartFromAttritionCostAttoRep, ESCALATION_TIME_LENGTH, hasReachedNonDecision, type EscalationBalanceTuple, type EscalationOutcomeKey, projectEscalationDeposit } from '../../shared/statoblast/ts/escalationGame/escalationMath'

export const quantitativeChartIds = ['fig-statoblast-escalation-cost-curve', 'fig-zoltar-fork-threshold-decay'] as const

type QuantitativeChartId = (typeof quantitativeChartIds)[number]

export const quantitativeChartAxisLabels: Record<QuantitativeChartId, { x: string; y: string }> = {
	'fig-statoblast-escalation-cost-curve': { x: 'Days since game start (days)', y: 'Required support (REP)' },
	'fig-zoltar-fork-threshold-decay': { x: 'Fork generation (count)', y: 'Theoretical REP supply (% of genesis)' },
}

export function calculateResolutionModel(input: { invalidBalance: number; noBalance: number; runningCost: number; yesBalance: number }): { atCost: number; result: 'Invalid' | 'No' | 'None' | 'Yes' } {
	const balances = [input.invalidBalance, input.yesBalance, input.noBalance]
	const atCost = balances.filter(balance => balance >= input.runningCost).length
	const allZero = balances.every(balance => balance === 0)
	const maxBalance = Math.max(...balances)
	const tiedMaximumCount = balances.filter(balance => balance === maxBalance).length
	if (atCost >= 2 || (maxBalance > 0 && tiedMaximumCount >= 2)) return { atCost, result: 'None' }
	if (allZero) return { atCost, result: 'Invalid' }
	if (input.invalidBalance > input.yesBalance && input.invalidBalance > input.noBalance) return { atCost, result: 'Invalid' }
	if (input.yesBalance > input.invalidBalance && input.yesBalance > input.noBalance) return { atCost, result: 'Yes' }
	if (input.noBalance > input.invalidBalance && input.noBalance > input.yesBalance) return { atCost, result: 'No' }
	return { atCost, result: 'None' }
}

export const ESCALATION_ACTIVATION_DELAY_DAYS = 3
export const ESCALATION_TIME_LENGTH_DAYS = Number.parseInt(ESCALATION_TIME_LENGTH.toString(), 10) / 86_400
export const ESCALATION_TIME_LENGTH_SECONDS = ESCALATION_TIME_LENGTH

const ATTO_REP = 10n ** 18n

function attoRepToNumber(value: bigint) {
	const sign = value < 0n ? '-' : ''
	const magnitude = value < 0n ? -value : value
	const integer = magnitude / ATTO_REP
	const fractional = (magnitude % ATTO_REP).toString().padStart(18, '0')
	return Number.parseFloat(`${sign}${integer.toString()}.${fractional}`)
}

function toAttoRep(value: number) {
	return BigInt(Math.round(value * 1_000_000)) * 1_000_000_000_000n
}

export function computeCanonicalEscalationBindingCapital(startBondRep: number, nonDecisionThresholdRep: number, elapsedDays: number) {
	const elapsedSeconds = BigInt(Math.round(Math.max(0, elapsedDays - ESCALATION_ACTIVATION_DELAY_DAYS) * 86_400))
	return attoRepToNumber(computeEscalationBindingCapitalAttoRep(toAttoRep(startBondRep), toAttoRep(nonDecisionThresholdRep), elapsedSeconds))
}

export function computeCanonicalEscalationDeadlineDays(startBondRep: number, nonDecisionThresholdRep: number, bindingCapitalRep: number) {
	const startBondAttoRep = toAttoRep(startBondRep)
	const thresholdAttoRep = toAttoRep(nonDecisionThresholdRep)
	const bindingCapitalAttoRep = toAttoRep(bindingCapitalRep)
	if (bindingCapitalAttoRep <= startBondAttoRep) return ESCALATION_ACTIVATION_DELAY_DAYS
	if (bindingCapitalAttoRep >= thresholdAttoRep) return ESCALATION_ACTIVATION_DELAY_DAYS + ESCALATION_TIME_LENGTH_DAYS
	const elapsedSeconds = computeEscalationTimeSinceStartFromAttritionCostAttoRep(startBondAttoRep, thresholdAttoRep, bindingCapitalAttoRep)
	return ESCALATION_ACTIVATION_DELAY_DAYS + Number.parseInt(elapsedSeconds.toString(), 10) / 86_400
}

export function projectDocumentationEscalationDeposit(input: { amountRep: number; balances: EscalationBalanceTuple; nonDecisionThresholdRep: number; outcome: EscalationOutcomeKey; startBondRep: number }) {
	return projectEscalationDeposit({
		amountAttoRep: toAttoRep(input.amountRep),
		balancesAttoRep: input.balances,
		nonDecisionThresholdAttoRep: toAttoRep(input.nonDecisionThresholdRep),
		outcome: input.outcome,
		startBondAttoRep: toAttoRep(input.startBondRep),
	})
}

export function calculateEscalationDepositModel(input: { invalidBalance: number; noBalance: number; nonDecisionThreshold: number; proposedDeposit: number; repeatDeposit: boolean; startBond: number; yesBalance: number }) {
	const threshold = Math.max(input.nonDecisionThreshold, 1)
	const thresholdAttoRep = toAttoRep(threshold)
	const enteredStartBondAttoRep = toAttoRep(input.startBond)
	const effectiveStartBondAttoRep = !input.repeatDeposit && enteredStartBondAttoRep >= thresholdAttoRep ? thresholdAttoRep - 1n : enteredStartBondAttoRep
	const invalidStoredParameters = input.repeatDeposit && (enteredStartBondAttoRep <= 0n || enteredStartBondAttoRep >= thresholdAttoRep)
	const projection = projectEscalationDeposit({ amountAttoRep: toAttoRep(input.proposedDeposit), balancesAttoRep: [toAttoRep(input.invalidBalance), toAttoRep(input.yesBalance), toAttoRep(input.noBalance)], nonDecisionThresholdAttoRep: thresholdAttoRep, outcome: 'no', startBondAttoRep: effectiveStartBondAttoRep })
	const previewReverts = invalidStoredParameters || hasReachedNonDecision([toAttoRep(input.invalidBalance), toAttoRep(input.yesBalance), toAttoRep(input.noBalance)], thresholdAttoRep) || projection === undefined
	const acceptedAttoRep = previewReverts ? 0n : projection.acceptedAmountAttoRep
	const accepted = attoRepToNumber(acceptedAttoRep)
	return { accepted, acceptedAttoRep, effectiveStartBondAttoRep, noAfter: input.noBalance + accepted, noAfterAttoRep: toAttoRep(input.noBalance) + acceptedAttoRep, previewReverts, threshold, tieAdjusted: projection?.tieAdjusted ?? false }
}

export type ForkThresholdPoint = {
	forkThresholdRep: number
	generation: number
	theoreticalSupply: number
}

export function calculateForkThresholdSeries(generationCount: number, genesisTheoreticalSupply = 100): ForkThresholdPoint[] {
	return Array.from({ length: Math.max(0, generationCount) }, (_, generation) => {
		const theoreticalSupply = genesisTheoreticalSupply * 0.99 ** generation
		return {
			forkThresholdRep: theoreticalSupply / 20,
			generation,
			theoreticalSupply,
		}
	})
}
