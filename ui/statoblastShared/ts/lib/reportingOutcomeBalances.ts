import type { EscalationSide } from '../types/contracts.js'

export function getStrictLeadingEscalationOutcome(sides: readonly Pick<EscalationSide, 'key' | 'balance'>[]) {
	if (sides.length === 0) return undefined
	const maximum = sides.reduce((largest, side) => (side.balance > largest ? side.balance : largest), 0n)
	if (maximum === 0n) return 'invalid'
	const leaders = sides.filter(side => side.balance === maximum)
	return leaders.length === 1 ? leaders[0]?.key : undefined
}

/** A fork needs two sides at the non-decision threshold, so the second-largest side measures how close the game is to forking. */
export function getSecondLargestEscalationBalance(sides: readonly { balance: bigint | undefined }[]) {
	const [, secondLargest] = sides
		.map(side => side.balance ?? 0n)
		.sort((left, right) => {
			if (left > right) return -1
			return left < right ? 1 : 0
		})
	return secondLargest ?? 0n
}
