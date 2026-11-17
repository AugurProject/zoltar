import { describe, expect, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact, test_statoblast_ForkerSourceSpoof_ForkerSourceSpoof as spoofArtifact } from '../types/contractArtifact'
import { deployContract } from '../testSupport/deployContract'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { redeemShares } from '../testSupport/simulator/utils/contracts/securityPool'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress, splitMigrationRep, addRepToMigrationBalance } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { approveToken, getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

// Audit regression: the forker is the privileged caller of every pool. It must not
// resolve the pool it acts on through a factory that the caller's source pool names.
describe('audit: the forker rejects a child pool resolved through a spoofed source', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const pool = () => ({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool })
	const forker = () => ({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker })
	const systemState = () => fixture.owner().readContract({ ...pool(), functionName: 'systemState' })

	const forkOn = async (universe: bigint, title: string) => {
		const owner = fixture.owner()
		const question = { ...fixture.base.questionData, title, endTime: (await fixture.base.mockWindow.getTime()) - 1n }
		await createQuestion(owner, question, fixture.base.outcomes)
		await approveToken(owner, getRepTokenAddress(universe), getZoltarAddress())
		await forkUniverse(owner, universe, getQuestionId(question, fixture.base.outcomes))
	}

	test('a finalized parent question stays redeemable when an attacker names it as a child', async () => {
		const owner = fixture.owner()
		const trader = fixture.other()
		const genesis = fixture.base.genesisUniverse
		await fixture.prepare(1_000n * unit, 10n * unit)
		await fixture.mint(8n * unit)
		// The question resolves Yes before any fork.
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(trader, getRepTokenAddress(genesis), pool().address)
		await writeContractAndWait(trader, () => trader.writeContract({ ...pool(), functionName: 'depositWalletRepToEscalationGame', args: [QuestionOutcome.Yes, 100n * unit] }))
		const game = { abi: gameArtifact.abi, address: await owner.readContract({ ...pool(), functionName: 'escalationGame' }) }
		await fixture.base.mockWindow.setTime((await owner.readContract({ ...game, functionName: 'getEscalationGameEndDate' })) + 60n)
		expect(await owner.readContract({ ...game, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(QuestionOutcome.Yes))

		// Genesis forks on an unrelated question, then its child forks too.
		await forkOn(genesis, 'Audit unrelated genesis fork')
		await addRepToMigrationBalance(owner, genesis, 1_000_000n * unit)
		await splitMigrationRep(owner, genesis, 1_000_000n * unit, [1n])
		const child = getChildUniverseId(genesis, 1)
		await fixture.base.mockWindow.setTime((await getUniverseData(owner, genesis)).forkTime + 71n * DAY)
		await forkOn(child, 'Audit unrelated child fork')

		// A finalized question cannot enter fork mode, so its winners can always redeem.
		await expect(owner.writeContract({ ...forker(), functionName: 'initiateSecurityPoolFork', args: [pool().address] })).rejects.toThrow('Question finalized before fork')
		expect(await systemState()).toBe(0n)

		const spoof = await deployContract(owner, encodeDeployData({ abi: spoofArtifact.abi, bytecode: `0x${spoofArtifact.evm.bytecode.object}`, args: [child, pool().address] }))
		// Genesis is an ancestor of the spoof's claimed universe, never a descendant, so the forker refuses before deploying.
		await expect(owner.writeContract({ ...forker(), functionName: 'preparePortfolioQuestion', args: [spoof, genesis] })).rejects.toThrow('Target universe does not descend from source')
		await expect(owner.writeContract({ ...forker(), functionName: 'materializePortfolioQuestion', args: [spoof, genesis] })).rejects.toThrow('Target universe does not descend from source')
		expect(await systemState()).toBe(0n)
		await redeemShares(trader, pool().address)
	})
})
