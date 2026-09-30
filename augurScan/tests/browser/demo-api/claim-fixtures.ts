export const createDemoClaimFixtures = (claimState: string | null) => {
	const claimPosition = {
		depositor: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
		outcome: '1',
		deposit_index: '4',
		kind: 'inherited',
		status: claimState === 'pending' ? 'pending' : 'claimable',
		principal_atto_rep: '2000000000000000000',
		source_principal_atto_rep: '1800000000000000000',
		retained_principal_atto_rep: '1200000000000000000',
		auction_haircut_atto_rep: '600000000000000000',
		reward_amount_atto_rep: '1200000000000000000',
		reward_cumulative_atto_rep: '5000000000000000000',
		...(claimState === 'pending' ? {} : { payout_atto_rep: '1440000000000000000', burn_atto_rep: '160000000000000000' }),
		proof: {
			depositor: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
			amountAttoRep: String(2000000000000000000n),
			cumulativeAmountAttoRep: String(5000000000000000000n),
			parentDepositIndex: '4',
			sourceNodeId: '5',
			leafIndex: '4',
			merkleMountainRangePeakIndex: '0',
			merkleMountainRangeSiblings: ['0x' + '12'.repeat(32)],
			nullifierSiblings: Array.from({ length: 64 }, () => '0x' + '00'.repeat(32)),
		},
	}
	const claimEvidence = claimState === 'unavailable' ? { status: 'unavailable', reason: 'Historical proof state is unavailable on this provider' } : { status: 'available', positions: [claimPosition], truncated: false }
	return { claimPosition, claimEvidence }
}
