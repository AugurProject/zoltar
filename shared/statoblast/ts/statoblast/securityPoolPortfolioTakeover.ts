/** The ledger applies this unpaid cure before quoting a takeover. No REP leaves the target during cure. */
export function portfolioTakeoverSource(
	snapshot: { timestamp?: bigint; conservativePrice: bigint; liquidationPrice: bigint; securityMultiplierBps: bigint; totalCommitmentAttoEth: bigint; demandAttoEth: bigint; economics: { minimumCommitmentAttoEth: bigint } },
	position: { rep: bigint; commitment: bigint; batch: bigint; remainingCommitment: bigint; liquidationStarted?: bigint; liquidationAwarded?: bigint; liquidationElapsed?: bigint },
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
	const started = position.liquidationStarted ?? 0n
	const elapsed = position.liquidationElapsed ?? (started === 0n || snapshot.timestamp === undefined || snapshot.timestamp <= started ? 0n : snapshot.timestamp - started)
	const paid = position.liquidationAwarded ?? 0n
	const vested = ((position.rep + paid) * (elapsed < 3600n ? elapsed : 3600n)) / 3600n
	const maximumTakeoverAward = vested > paid ? vested - paid : 0n
	const repairSupported = ((((position.rep - maximumTakeoverAward) * 10_000n) / snapshot.securityMultiplierBps) * 10n ** 18n) / snapshot.conservativePrice
	let maximumTakeoverCommitment = commitment > repairSupported ? commitment - repairSupported : 0n
	if (maximumTakeoverCommitment !== 0n && commitment - maximumTakeoverCommitment < minimum) maximumTakeoverCommitment = commitment
	return { removed, maximumTakeoverCommitment, maximumTakeoverAward, commitment, rep: position.rep, batch: retirementFulfilled ? 0n : position.batch, remainingCommitment: retirementFulfilled ? 0n : position.remainingCommitment, healthy: commitment <= supported }
}

/** Clamp a requested fill to a legal source remainder and allocate only its share of the current bonus. */
export function portfolioTakeoverFill(source: { commitment: bigint; maximumTakeoverCommitment: bigint; maximumTakeoverAward: bigint }, requested: bigint, minimum: bigint) {
	let commitment = requested < source.maximumTakeoverCommitment ? requested : source.maximumTakeoverCommitment
	if (source.commitment - commitment !== 0n && source.commitment - commitment < minimum) commitment = source.commitment > minimum ? source.commitment - minimum : 0n
	const award = source.maximumTakeoverCommitment === 0n ? 0n : (source.maximumTakeoverAward * commitment) / source.maximumTakeoverCommitment
	return { commitment, award }
}
