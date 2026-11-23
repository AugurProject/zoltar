/**
 * The ledger applies this unpaid cure before quoting a takeover. No REP leaves the target during cure. It measures
 * health at the conservative repair price; `healthy` means the cure alone settles the takeover with no transfer.
 * A partial transfer must leave the source still below the liquidation price, so it stays open to repair:
 * `maximumPartialCommitment` is the largest such transfer, and only the full repair may exceed it (#1570).
 */
export function securityPoolTakeoverSource(
	snapshot: { conservativePrice: bigint; liquidationPrice: bigint; securityMultiplierBps: bigint; totalCommitmentAttoEth: bigint; demandAttoEth: bigint; economics: { minimumCommitmentAttoEth: bigint } },
	position: { rep: bigint; commitment: bigint; batch: bigint; remainingCommitment: bigint },
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
	const retained = supported > minimum ? supported : minimum
	const maximumTakeoverCommitment = commitment > retained ? commitment - retained : 0n
	const supportedAtLiquidation = snapshot.liquidationPrice > 0n ? (backing * 10n ** 18n) / snapshot.liquidationPrice : 0n
	const belowLiquidation = commitment > supportedAtLiquidation + 1n ? commitment - supportedAtLiquidation - 1n : 0n
	const maximumPartialCommitment = belowLiquidation < maximumTakeoverCommitment ? belowLiquidation : maximumTakeoverCommitment
	return { removed, maximumTakeoverCommitment, maximumPartialCommitment, commitment, rep: position.rep, batch: retirementFulfilled ? 0n : position.batch, remainingCommitment: retirementFulfilled ? 0n : position.remainingCommitment, healthy: removed !== 0n && (commitment <= supported || commitment <= minimum) }
}

/** The commitment a takeover request transfers, or `undefined` when the ledger would reject it for leaving the source between the two prices. */
export function securityPoolTakeoverTransfer(source: { maximumTakeoverCommitment: bigint; maximumPartialCommitment: bigint }, requested: bigint) {
	const transferred = requested < source.maximumTakeoverCommitment ? requested : source.maximumTakeoverCommitment
	return transferred === source.maximumTakeoverCommitment || transferred <= source.maximumPartialCommitment ? transferred : undefined
}
