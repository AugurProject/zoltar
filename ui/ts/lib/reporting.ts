import type { EscalationSide, ReportingDetails, ReportingOutcomeKey } from '../types/contracts.js'
import { assertNever } from './assert.js'

export const ESCALATION_TIME_LENGTH = 4_233_600n

export const REPORTING_OUTCOME_OPTIONS: { key: ReportingOutcomeKey; label: string }[] = [
	{ key: 'invalid', label: 'Invalid' },
	{ key: 'yes', label: 'Yes' },
	{ key: 'no', label: 'No' },
]

export function getReportingOutcomeLabel(outcome: ReportingOutcomeKey | 'none') {
	switch (outcome) {
		case 'invalid':
			return 'Invalid'
		case 'yes':
			return 'Yes'
		case 'no':
			return 'No'
		case 'none':
			return 'Unresolved'
		default:
			return assertNever(outcome)
	}
}

export function getEscalationTimeRemaining(details: ReportingDetails) {
	return details.currentTime >= details.escalationEndTime ? 0n : details.escalationEndTime - details.currentTime
}

export function getEscalationPhase(details: ReportingDetails) {
	switch (true) {
		case details.resolution !== 'none':
			return 'Resolved'
		case details.currentTime < details.startingTime:
			return 'Pending Start'
		case details.currentTime >= details.escalationEndTime:
			return 'Awaiting Resolution'
		default:
			return 'Active'
	}
}

export function getLeadingEscalationOutcome(sides: EscalationSide[]) {
	let leadingSide: EscalationSide | undefined

	for (const side of sides) {
		if (leadingSide === undefined || side.balance > leadingSide.balance) {
			leadingSide = side
		}
	}

	return leadingSide?.key
}

export function calculateEstimatedEscalationReturn(sideBalance: bigint, allBalances: bigint, amount: bigint) {
	if (amount <= 0n) {
		return {
			payout: 0n,
			profit: 0n,
		}
	}

	const projectedWinningStake = sideBalance + amount
	const projectedTotal = allBalances + amount
	const payout = projectedWinningStake === 0n ? 0n : (amount * projectedTotal) / projectedWinningStake

	return {
		payout,
		profit: payout - amount,
	}
}
