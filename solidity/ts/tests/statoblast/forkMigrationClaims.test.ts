import { describe, expect, test } from 'bun:test'
import {
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createCarryProof, SparseNullifierTree } from '../carryProofHelpers'
import { useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Portfolio own-fork reporter claims', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test.each([1, 2])('branch %s pays authenticated wallet claims after the migration deadline without a capital position', async outcome => {
		const owner = fixture.owner()
		const relayer = fixture.other()
		const universe = fixture.base.genesisUniverse
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		const threshold = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getNonDecisionThresholdAttoRep', args: [universe] })
		await approveToken(owner, getRepTokenAddress(universe), pool)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		for (const side of [1, 2]) await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [side, threshold] }))
		const sourceGame = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
		const proof = await createCarryProof(owner, sourceGame, { expectedOutcome: outcome, parentDepositIndex: 0n, sourceNodeId: BigInt(outcome), leafIndex: 0n, merkleMountainRangePeakIndex: 0n, merkleMountainRangeSiblings: [], nullifierSiblings: new SparseNullifierTree().getProof(0n) })
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker }
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'forkZoltarWithOwnEscalationGame', args: [pool] }))
		await expect(owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'withdrawFromEscalationGame', args: [outcome, [0n]] })).rejects.toThrow()
		const controller = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'forkController' })
		await fixture.base.mockWindow.advanceTime(63n * 86_400n)
		const child = getChildUniverseId(universe, outcome)
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'startBranch', args: [universe, BigInt(outcome)] }))
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'finalizeBranch', args: [child] }))
		await writeContractAndWait(relayer, () => relayer.writeContract({ ...forker, functionName: 'preparePortfolioQuestion', args: [pool, child] }))
		for (let side = 0; side < 3; side++) await writeContractAndWait(relayer, () => relayer.writeContract({ ...forker, functionName: 'materializePortfolioQuestion', args: [pool, child] }))
		const childPool = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'getPool', args: [fixture.base.questionId, child] })
		const game = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		const reporters = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'reporterLedger', args: [child] })
		const backing = await owner.readContract({ abi: reporterArtifact.abi, address: reporters, functionName: 'balanceOfGame', args: [game] })
		expect(backing).toBeGreaterThan(threshold)
		expect(backing).toBeLessThan(2n * threshold)
		await fixture.base.mockWindow.advanceTime(100n * 86_400n)
		const childToken = getRepTokenAddress(child)
		const before = await getERC20Balance(owner, childToken, owner.account.address)
		const relayerBefore = await getERC20Balance(relayer, childToken, relayer.account.address)
		await expect(relayer.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'withdrawForkedEscalationDeposits', args: [outcome, [{ ...proof, depositor: relayer.account.address }]] })).rejects.toThrow()
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'withdrawForkedEscalationDeposits', args: [outcome, [proof]] }))
		expect(await getERC20Balance(owner, childToken, owner.account.address)).toBe(before + backing)
		expect(await getERC20Balance(relayer, childToken, relayer.account.address)).toBe(relayerBefore)
		expect(await owner.readContract({ abi: reporterArtifact.abi, address: reporters, functionName: 'balanceOfGame', args: [game] })).toBe(0n)
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(outcome))
		await expect(relayer.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'withdrawForkedEscalationDeposits', args: [outcome, [proof]] })).rejects.toThrow()
	})
})
