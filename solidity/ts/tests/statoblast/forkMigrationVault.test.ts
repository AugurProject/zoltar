import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: shared fork deadlines and fixed outcomes', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const securityPool = () => ({ abi: securityPoolArtifact.abi, address: fixture.securityPool })
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker })
	const pool = () => fixture.poolFor(fixture.base.questionId).questionLedger
	const controller = async () => ({ abi: forkArtifact.abi, address: await fixture.owner().readContract({ ...securityPool(), functionName: 'forkController' }) })
	const trigger = async (own: boolean) => {
		const owner = fixture.owner()
		await fixture.prepare()
		await fixture.mint()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), pool())
		const amount = own ? await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getNonDecisionThresholdAttoRep', args: [fixture.base.genesisUniverse] }) : 100n * unit
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [1, amount] }))
		if (own) {
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [2, amount] }))
			await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'forkZoltarWithOwnEscalationGame', args: [pool()] }))
		} else {
			const question = { ...fixture.base.questionData, title: 'Unrelated fork boundary' }
			await createQuestion(owner, question, fixture.base.outcomes)
			await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
			await forkUniverse(owner, fixture.base.genesisUniverse, getQuestionId(question, fixture.base.outcomes))
		}
		const protocol = { abi: zoltarArtifact.abi, address: getZoltarAddress() }
		const choice = await owner.readContract({ ...protocol, functionName: 'getForkChoiceDeadline', args: [fixture.base.genesisUniverse] })
		const recap = await owner.readContract({ ...protocol, functionName: 'getForkRecapitalizationDeadline', args: [fixture.base.genesisUniverse] })
		return { choice, recap, branch: await controller() }
	}

	test.each([false, true])('owner choices close exactly at the native cutoff (own: %s)', async own => {
		const owner = fixture.owner()
		const { choice, branch } = await trigger(own)
		await fixture.base.mockWindow.setTime(choice - 2n)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'choose', args: [fixture.base.genesisUniverse, 1n] }))
		expect((await owner.getBlock()).timestamp).toBe(choice - 1n)
		expect([...(await owner.readContract({ ...branch, functionName: 'choices', args: [fixture.base.genesisUniverse, owner.account.address] }))]).toEqual([1n, true])
		const child = getChildUniverseId(fixture.base.genesisUniverse, 1)
		const capital = await owner.readContract({ ...securityPool(), functionName: 'capitalLedger', args: [child] })
		const before = await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerCollateral', args: [owner.account.address] })
		for (const offset of [0n, 1n]) {
			await fixture.base.mockWindow.setTime(choice + offset)
			await expect(fixture.other().simulateContract({ ...branch, functionName: 'choose', args: [fixture.base.genesisUniverse, 2n] })).rejects.toThrow('Fork choice window closed')
		}
		expect(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerCollateral', args: [owner.account.address] })).toEqual(before)
	})

	test.each([false, true])('shared branch activation uses fixed phase boundaries (own: %s)', async own => {
		const owner = fixture.owner()
		const { choice, recap, branch } = await trigger(own)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'choose', args: [fixture.base.genesisUniverse, 1n] }))
		const child = getChildUniverseId(fixture.base.genesisUniverse, 1)
		await fixture.base.mockWindow.setTime(choice - 1n)
		await expect(owner.simulateContract({ ...branch, functionName: 'startBranch', args: [fixture.base.genesisUniverse, 1n] })).rejects.toThrow('Fork choices still open')
		await fixture.base.mockWindow.setTime(choice)
		await owner.simulateContract({ ...branch, functionName: 'startBranch', args: [fixture.base.genesisUniverse, 1n] })
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'startBranch', args: [fixture.base.genesisUniverse, 1n] }))
		await fixture.base.mockWindow.setTime(recap - 1n)
		await expect(owner.simulateContract({ ...branch, functionName: 'finalizeBranch', args: [child] })).rejects.toThrow('Fork activation window still open')
		await fixture.base.mockWindow.setTime(recap)
		await owner.simulateContract({ ...branch, functionName: 'finalizeBranch', args: [child] })
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'finalizeBranch', args: [child] }))
		expect(await owner.readContract({ ...branch, functionName: 'isReady', args: [child] })).toBe(true)
	})

	test.each([false, true])('question materialization stays available long after shared migration (own: %s)', async own => {
		const owner = fixture.owner()
		const { recap, branch } = await trigger(own)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'choose', args: [fixture.base.genesisUniverse, 1n] }))
		const child = getChildUniverseId(fixture.base.genesisUniverse, 1)
		await fixture.base.mockWindow.setTime(recap)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'startBranch', args: [fixture.base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'finalizeBranch', args: [child] }))
		await fixture.base.mockWindow.advanceTime(365n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'prepareSecurityPoolQuestion', args: [pool(), child] }))
		const childPool = await owner.readContract({ ...securityPool(), functionName: 'getQuestionLedger', args: [fixture.base.questionId, child] })
		for (let outcome = 0; outcome < 3; outcome++) {
			expect(await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'systemState' })).toBe(2n)
			await expect(owner.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'depositWalletRepToEscalationGame', args: [1, unit] })).rejects.toThrow(own ? 'Forked' : 'Pool inactive')
			await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'materializeSecurityPoolQuestion', args: [pool(), child] }))
		}
		expect(await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'systemState' })).toBe(0n)
		const childGame = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotOutcomesInitialized' })).toBe(3n)
		const before = await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'getForkCarrySnapshot' })
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'materializeSecurityPoolQuestion', args: [pool(), child] }))
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'getForkCarrySnapshot' })).toEqual(before)
	})

	test('a matching fork fixes the child outcome and a later fork cannot overwrite it', async () => {
		const owner = fixture.owner()
		await fixture.prepare()
		await fixture.mint()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, fixture.base.genesisUniverse, fixture.base.questionId)
		await addRepToMigrationBalance(owner, fixture.base.genesisUniverse, 1_000_000n * unit)
		await splitMigrationRep(owner, fixture.base.genesisUniverse, 1_000_000n * unit, [1n])
		const branch = await controller()
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'choose', args: [fixture.base.genesisUniverse, 1n] }))
		const child = getChildUniverseId(fixture.base.genesisUniverse, 1)
		const firstForkTime = (await getUniverseData(owner, fixture.base.genesisUniverse)).forkTime
		await fixture.base.mockWindow.setTime(firstForkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'startBranch', args: [fixture.base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'finalizeBranch', args: [child] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker(), functionName: 'materializeSecurityPoolQuestion', args: [pool(), child] }))
		const childPool = await owner.readContract({ ...securityPool(), functionName: 'getQuestionLedger', args: [fixture.base.questionId, child] })
		expect([...(await owner.readContract({ ...securityPool(), functionName: 'inheritedFixedOutcome', args: [child, fixture.base.questionId] }))]).toEqual([true, 1n])
		await expect(owner.writeContract({ ...securityPool(), functionName: 'createCompleteSet', args: [child, fixture.base.questionId, unit, owner.account.address, 0n, 2n * unit - unit], value: 0n })).rejects.toThrow()
		await fixture.base.mockWindow.setTime(firstForkTime + 70n * DAY)
		await expect(owner.writeContract({ ...forker(), functionName: 'forkZoltarWithOwnEscalationGame', args: [childPool] })).rejects.toThrow()
		await approveToken(owner, getRepTokenAddress(child), getZoltarAddress())
		await forkUniverse(owner, child, fixture.base.questionId)
		await writeContractAndWait(owner, () => owner.writeContract({ ...branch, functionName: 'prepareBranch', args: [child, 2n] }))
		const grandchild = getChildUniverseId(child, 2)
		expect([...(await owner.readContract({ ...securityPool(), functionName: 'inheritedFixedOutcome', args: [grandchild, fixture.base.questionId] }))]).toEqual([true, 1n])
	})
})
