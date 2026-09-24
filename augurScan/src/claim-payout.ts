// Mirrors EscalationGameProofVerifier.computeAllocatedWinningWithdrawal. Preserve
// each Solidity division: combining them changes one-atto rounding and haircuts.
export const allocatedWinningPayout = (input: { principal: bigint; rewardAmount: bigint; rewardCumulative: bigint; binding: bigint; winningBalance: bigint; forkThreshold: bigint; nonDecisionThreshold: bigint }) => {
	const { principal, rewardAmount, rewardCumulative, binding, winningBalance, forkThreshold, nonDecisionThreshold } = input
	if (Object.values(input).some(value => value < 0n) || rewardCumulative < rewardAmount) throw new Error('Invalid payout interval')
	const cap = binding + binding / 2n
	const eligiblePrincipal = winningBalance < cap ? winningBalance : cap
	let payout = principal
	let burn = 0n
	if (eligiblePrincipal > 0n) {
		const start = rewardCumulative - rewardAmount
		const end = rewardCumulative < cap ? rewardCumulative : cap
		const overlap = end > start ? end - start : 0n
		const eligible = overlap < rewardAmount ? overlap : rewardAmount
		payout += (eligible * ((binding * 3n) / 5n)) / eligiblePrincipal
		burn = (eligible * ((binding * 2n) / 5n)) / eligiblePrincipal
	}
	if (forkThreshold < nonDecisionThreshold) payout = (payout * forkThreshold) / nonDecisionThreshold
	return { payout, burn }
}
