import { describe, expect, test } from 'bun:test'
import { statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate as claimArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact, Zoltar_Zoltar as zoltarArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Claim checkpoints: immutable portfolio own-fork source', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test('own-fork history freezes immediately because reporter withdrawals use child proofs', async () => {
		const owner = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		const threshold = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getNonDecisionThresholdAttoRep', args: [fixture.base.genesisUniverse] })
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), pool)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		for (const outcome of [1, 2]) await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, threshold] }))
		const game = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
		const frozen = () => owner.readContract({ abi: claimArtifact.abi, address: game, functionName: 'isClaimHistoryFrozen' })
		expect(await frozen()).toBe(false)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'forkZoltarWithOwnEscalationGame', args: [pool] }))
		expect(await frozen()).toBe(true)
		await expect(owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'withdrawFromEscalationGame', args: [1, [0n]] })).rejects.toThrow()
		await fixture.base.mockWindow.advanceTime(56n * 86_400n)
		expect(await frozen()).toBe(true)
	})
})
