import type { PortfolioObservation, PortfolioPosition } from '#monitoring/portfolio-monitor'

const UNIT = 10n ** 18n
const BPS = 10_000n

/** Match the authenticated index's unpaid atomic cure that precedes every takeover. */
export function portfolioCureOutcome(observation: PortfolioObservation, position: PortfolioPosition) {
	const { snapshot } = observation
	const price = snapshot.liquidationPrice
	const multiplier = snapshot.securityMultiplierBps
	const minimum = snapshot.economics.minimumCommitmentAttoEth
	const supported = (((position.rep * BPS) / multiplier) * UNIT) / price
	const spare = snapshot.totalCommitmentAttoEth > snapshot.demandAttoEth ? snapshot.totalCommitmentAttoEth - snapshot.demandAttoEth : 0n
	let removed = 0n
	if (supported < position.commitment) {
		// `supported` rounds down, so the deficit rounds up and its removal leaves a fully backed residual.
		const reduction = position.commitment - supported
		const desired = reduction > minimum ? reduction : minimum
		removed = [position.commitment, desired, spare].reduce((smallest, value) => (value < smallest ? value : smallest))
		if (removed < minimum && removed !== position.commitment) removed = 0n
	}
	const commitment = position.commitment - removed
	const retirementFulfilled = removed !== 0n && position.remainingCommitment !== 0n && commitment <= position.remainingCommitment
	const batch = retirementFulfilled ? 0n : position.batch
	const remainingCommitment = retirementFulfilled ? 0n : position.remainingCommitment
	// The cure pays no one, so the target keeps all REP. The index's health test is `remaining <= supported`.
	return { removed, commitment, rep: position.rep, batch, remainingCommitment, healthy: commitment <= supported }
}
