/** The ledger applies this unpaid cure before quoting a takeover. No REP leaves the target during cure. */
export function portfolioTakeoverSource(
	snapshot: { conservativePrice: bigint; liquidationPrice: bigint; securityMultiplierBps: bigint; totalCommitmentAttoEth: bigint; demandAttoEth: bigint; economics: { minimumCommitmentAttoEth: bigint } },
	position: { rep: bigint; commitment: bigint; batch: bigint; remainingCommitment: bigint },
) {
	if (snapshot.liquidationPrice <= 0n || snapshot.securityMultiplierBps <= 0n) throw new Error('Takeover requires a valid collateral price and multiplier')
	const minimum = snapshot.economics.minimumCommitmentAttoEth
	const supported = (((position.rep * 10_000n) / snapshot.securityMultiplierBps) * 10n ** 18n) / snapshot.liquidationPrice
	const spare = snapshot.totalCommitmentAttoEth > snapshot.demandAttoEth ? snapshot.totalCommitmentAttoEth - snapshot.demandAttoEth : 0n
	let removed = 0n
	if (supported < position.commitment) {
		const reduction = position.commitment - supported
		const desired = reduction > minimum ? reduction : minimum
		removed = [position.commitment, desired, spare].reduce((smallest, value) => (value < smallest ? value : smallest))
		if (removed < minimum && removed !== position.commitment) removed = 0n
		// What the cure leaves stays the owner's live commitment, so it is at least the minimum:
		// the whole commitment goes when spare allows, and otherwise the cut shrinks.
		const rest = position.commitment - removed
		if (rest !== 0n && rest < minimum) {
			if (removed >= minimum && position.commitment <= spare) removed = position.commitment
			else removed = removed >= 2n * minimum - rest ? removed - (minimum - rest) : 0n
		}
	}
	if (position.rep !== 0n && removed === position.commitment) removed = 0n
	const commitment = position.commitment - removed
	const retirementFulfilled = removed !== 0n && position.remainingCommitment !== 0n && commitment <= position.remainingCommitment
	const repairSupported = (((position.rep * 10_000n) / snapshot.securityMultiplierBps) * 10n ** 18n) / snapshot.conservativePrice
	const retained = repairSupported > minimum ? repairSupported : minimum
	const maximumTakeoverCommitment = commitment > retained ? commitment - retained : 0n
	return { removed, maximumTakeoverCommitment, commitment, rep: position.rep, batch: retirementFulfilled ? 0n : position.batch, remainingCommitment: retirementFulfilled ? 0n : position.remainingCommitment, healthy: commitment <= supported }
}
