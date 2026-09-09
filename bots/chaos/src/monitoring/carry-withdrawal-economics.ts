export function computeWinningEconomics(parameters: { actualForkThresholdAttoRep: bigint; bindingCapitalAttoRep: bigint; cumulativeAmountAttoRep: bigint; depositAmountAttoRep: bigint; nonDecisionThresholdAttoRep: bigint; winningOutcomeBalanceAttoRep: bigint }) {
	if (parameters.cumulativeAmountAttoRep < parameters.depositAmountAttoRep) throw new Error('Retained carry cumulative amount is below its deposit amount')
	if (parameters.nonDecisionThresholdAttoRep === 0n) throw new Error('Carry winning economics has a zero non-decision threshold')
	const depositStartAttoRep = parameters.cumulativeAmountAttoRep - parameters.depositAmountAttoRep
	const rewardEligibleCapAttoRep = parameters.bindingCapitalAttoRep + parameters.bindingCapitalAttoRep / 2n
	const rewardEligiblePrincipalAttoRep = parameters.winningOutcomeBalanceAttoRep < rewardEligibleCapAttoRep ? parameters.winningOutcomeBalanceAttoRep : rewardEligibleCapAttoRep
	let amountToWithdrawAttoRep = parameters.depositAmountAttoRep
	let burnAmountAttoRep = 0n
	if (rewardEligiblePrincipalAttoRep !== 0n) {
		const eligibleEndAttoRep = parameters.cumulativeAmountAttoRep < rewardEligibleCapAttoRep ? parameters.cumulativeAmountAttoRep : rewardEligibleCapAttoRep
		let rewardEligibleDepositAttoRep = eligibleEndAttoRep > depositStartAttoRep ? eligibleEndAttoRep - depositStartAttoRep : 0n
		if (rewardEligibleDepositAttoRep > parameters.depositAmountAttoRep) rewardEligibleDepositAttoRep = parameters.depositAmountAttoRep
		const bonusAttoRep = (rewardEligibleDepositAttoRep * ((parameters.bindingCapitalAttoRep * 3n) / 5n)) / rewardEligiblePrincipalAttoRep
		burnAmountAttoRep = (rewardEligibleDepositAttoRep * ((parameters.bindingCapitalAttoRep * 2n) / 5n)) / rewardEligiblePrincipalAttoRep
		amountToWithdrawAttoRep += bonusAttoRep
	}
	if (parameters.actualForkThresholdAttoRep < parameters.nonDecisionThresholdAttoRep) {
		amountToWithdrawAttoRep = (amountToWithdrawAttoRep * parameters.actualForkThresholdAttoRep) / parameters.nonDecisionThresholdAttoRep
	}
	return { amountToWithdrawAttoRep, burnAmountAttoRep }
}
