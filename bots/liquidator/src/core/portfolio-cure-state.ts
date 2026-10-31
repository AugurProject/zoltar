import type { PortfolioObservation, PortfolioPosition } from '#monitoring/portfolio-monitor'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'

const UNIT = 10n ** 18n
const BPS = 10_000n
const CURE_REWARD_BPS = 100n

/** Match the authenticated index's atomic cure, including both collateral ceilings. */
export function portfolioCureOutcome(observation: PortfolioObservation, position: PortfolioPosition) {
	const { snapshot } = observation
	const price = snapshot.liquidationPrice
	const multiplier = snapshot.securityMultiplierBps
	const supported = (((position.rep * BPS) / multiplier) * UNIT) / price
	const spare = snapshot.totalCommitmentAttoEth > snapshot.demandAttoEth ? snapshot.totalCommitmentAttoEth - snapshot.demandAttoEth : 0n
	let removed = 0n
	if (supported < position.commitment) {
		const deficit = position.commitment - supported
		const reduction = deficit >= (position.commitment * (BPS - CURE_REWARD_BPS)) / BPS ? position.commitment : ceilDiv(deficit * BPS, BPS - CURE_REWARD_BPS)
		const desired = reduction > snapshot.economics.minimumCommitmentAttoEth ? reduction : snapshot.economics.minimumCommitmentAttoEth
		removed = [position.commitment, desired, spare].reduce((smallest, value) => (value < smallest ? value : smallest))
		if (removed < snapshot.economics.minimumCommitmentAttoEth && removed !== position.commitment) removed = 0n
	}
	const commitment = position.commitment - removed
	const required = ceilDiv(ceilDiv(commitment * price, UNIT) * multiplier, BPS)
	const rewardLimit = (((removed * price) / UNIT) * multiplier) / (BPS * (BPS / CURE_REWARD_BPS))
	const rewardMargin = position.rep > required ? position.rep - required : 0n
	const reward = rewardLimit < rewardMargin ? rewardLimit : rewardMargin
	const rep = position.rep - reward
	const retirementFulfilled = removed !== 0n && position.remainingCommitment !== 0n && commitment <= position.remainingCommitment
	const batch = retirementFulfilled ? 0n : position.batch
	const remainingCommitment = retirementFulfilled ? 0n : position.remainingCommitment
	return { removed, commitment, rep, reward, batch, remainingCommitment, healthy: commitment === 0n || required <= rep }
}
