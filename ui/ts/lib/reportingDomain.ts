import type { EscalationSide, ReportingDetails } from '../types/contracts.js'

export function getEscalationTimeRemaining(details: ReportingDetails) {
	return details.currentTime >= details.escalationEndTime ? 0n : details.escalationEndTime - details.currentTime
}

export function getEscalationPhase(details: ReportingDetails) {
	if (details.resolution !== 'none') return 'Resolved'
	if (details.currentTime < details.startingTime) return 'Pending Start'
	if (details.currentTime >= details.escalationEndTime) return 'Awaiting Resolution'
	return 'Active'
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
