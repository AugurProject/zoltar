/**
 * The ledger applies this unpaid cure before quoting a takeover. No REP leaves the target during cure. It measures
 * health at the conservative repair price; `healthy` means the cure alone settles the takeover with no transfer.
 * A fill must restore conservative backing or leave the source below the liquidation price, open to repair:
 * `maximumPartialCommitment` is a search bound; each fill checks its exact post-takeover-reward backing (#1570).
 */
export function securityPoolTakeoverSource(
	snapshot: { timestamp?: bigint; conservativePrice: bigint; liquidationPrice: bigint; securityMultiplierBps: bigint; totalCommitmentAttoEth: bigint; demandAttoEth: bigint; economics: { minimumCommitmentAttoEth: bigint } },
	position: { rep: bigint; commitment: bigint; batch: bigint; remainingCommitment: bigint; liquidationStarted?: bigint; liquidationPenaltyPaid?: bigint; liquidationElapsed?: bigint },
) {
	if (snapshot.conservativePrice <= 0n || snapshot.securityMultiplierBps <= 0n) throw new Error('Takeover requires a valid collateral price and multiplier')
	const minimum = snapshot.economics.minimumCommitmentAttoEth
	const backing = (position.rep * 10_000n) / snapshot.securityMultiplierBps
	const supported = (backing * 10n ** 18n) / snapshot.conservativePrice
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
	const paid = position.liquidationPenaltyPaid ?? 0n
	const vested = ((position.rep + paid) * (elapsed < 3600n ? elapsed : 3600n)) / 3600n
	const healthy = commitment <= supported
	const maximumTakeoverReward = !healthy && vested > paid ? vested - paid : 0n
	const repairSupported = ((((position.rep - maximumTakeoverReward) * 10_000n) / snapshot.securityMultiplierBps) * 10n ** 18n) / snapshot.conservativePrice
	let maximumTakeoverCommitment = commitment > repairSupported ? commitment - repairSupported : 0n
	if (maximumTakeoverCommitment !== 0n && commitment - maximumTakeoverCommitment < minimum) maximumTakeoverCommitment = commitment
	let low = 0n
	let high = maximumTakeoverCommitment > 0n ? maximumTakeoverCommitment - 1n : 0n
	const legalRemainder = commitment > minimum ? commitment - minimum : 0n
	if (high > legalRemainder) high = legalRemainder
	while (low < high) {
		const middle = (low + high + 1n) / 2n
		const takeoverReward = maximumTakeoverCommitment === 0n ? 0n : (maximumTakeoverReward * middle) / maximumTakeoverCommitment
		const postBacking = ((position.rep - takeoverReward) * 10_000n) / snapshot.securityMultiplierBps
		if (snapshot.liquidationPrice > 0n && commitment - middle > (postBacking * 10n ** 18n) / snapshot.liquidationPrice) low = middle
		else high = middle - 1n
	}
	const maximumPartialCommitment = low
	return {
		removed,
		liquidationPrice: snapshot.liquidationPrice,
		conservativePrice: snapshot.conservativePrice,
		securityMultiplierBps: snapshot.securityMultiplierBps,
		maximumPartialCommitment,
		minimumCommitment: minimum,
		maximumTakeoverCommitment,
		maximumTakeoverReward,
		commitment,
		rep: position.rep,
		batch: retirementFulfilled ? 0n : position.batch,
		remainingCommitment: retirementFulfilled ? 0n : position.remainingCommitment,
		healthy,
	}
}

/** Clamp a requested fill to a legal source remainder and allocate only its share of the current takeover reward. */
export function securityPoolTakeoverFill(source: { commitment: bigint; maximumTakeoverCommitment: bigint; maximumTakeoverReward: bigint }, requested: bigint, minimum: bigint) {
	let commitment = requested < source.maximumTakeoverCommitment ? requested : source.maximumTakeoverCommitment
	if (source.commitment - commitment !== 0n && source.commitment - commitment < minimum) commitment = source.commitment > minimum ? source.commitment - minimum : 0n
	const takeoverReward = source.maximumTakeoverCommitment === 0n ? 0n : (source.maximumTakeoverReward * commitment) / source.maximumTakeoverCommitment
	return { commitment, takeoverReward }
}

/** Reject partial fills that would strand the source between liquidation and conservative prices. */
export function securityPoolTakeoverTransfer(
	source: { commitment: bigint; maximumTakeoverCommitment: bigint; maximumTakeoverReward: bigint; maximumPartialCommitment: bigint; minimumCommitment: bigint; rep: bigint; conservativePrice: bigint; liquidationPrice: bigint; securityMultiplierBps: bigint },
	requested: bigint,
) {
	const fill = securityPoolTakeoverFill(source, requested, source.minimumCommitment)
	const backing = (((source.rep - fill.takeoverReward) * 10_000n) / source.securityMultiplierBps) * 10n ** 18n
	const remaining = source.commitment - fill.commitment
	return fill.commitment === source.maximumTakeoverCommitment || remaining <= backing / source.conservativePrice || (source.liquidationPrice > 0n && remaining > backing / source.liquidationPrice) ? fill.commitment : undefined
}
