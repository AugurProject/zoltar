import { type Hex, bigintToSafeNumber, keccak256 } from '@zoltar/bot-shared/ethereum'

export function childPayouts(numTicks: bigint, numberOfOutcomes: bigint) {
	if (numberOfOutcomes < 2n || numberOfOutcomes > 32n) throw new Error(`Unsupported Augur outcome count: ${numberOfOutcomes.toString()}`)
	const count = bigintToSafeNumber(numberOfOutcomes, 'Augur outcome count')
	return Array.from({ length: count }, (_, winner) => Array.from({ length: count }, (_, index) => (index === winner ? numTicks : 0n)))
}

export function payoutDistributionHash(payout: readonly bigint[]) {
	const packed = payout.map(value => value.toString(16).padStart(64, '0')).join('')
	return keccak256(`0x${packed}` as Hex)
}
