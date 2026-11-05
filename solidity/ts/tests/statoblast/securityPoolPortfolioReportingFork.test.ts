import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
} from '../../types/contractArtifact'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: native fork reporter registration', () => {
	const fixture = useSecurityPoolPortfolioFixture({})
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const sourcePool = () => fixture.poolFor(fixture.base.questionId).securityPool
	const prepareReport = async () => {
		await fixture.prepare()
		await fixture.deposit(1_000n * unit, fixture.other())
		await fixture.authorize(200n * unit, fixture.other())
		await fixture.mint()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		await approveToken(fixture.other(), getRepTokenAddress(fixture.base.genesisUniverse), sourcePool())
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const game = await fixture.owner().readContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'escalationGame' })
		return game
	}
	const activateUnrelatedFork = async (chosen: boolean, carryOutcomes = 3) => {
		const { base } = fixture
		const owner = fixture.owner()
		const other = fixture.other()
		const question = { ...base.questionData, title: 'Unrelated fork during reporting' }
		await createQuestion(owner, question, base.outcomes)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, base.genesisUniverse, getQuestionId(question, base.outcomes))
		const coordinator = await owner.readContract({ ...portfolio(), functionName: 'forkController' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, chosen ? 1n : 2n] }))
		await writeContractAndWait(other, () => other.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, 2n] }))
		const forkTime = (await getUniverseData(owner, base.genesisUniverse)).forkTime
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		const child = getChildUniverseId(base.genesisUniverse, 1)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'finalizeBranch', args: [child] }))
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker }
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'preparePortfolioQuestion', args: [sourcePool(), child] }))
		const childPool = await owner.readContract({ ...portfolio(), functionName: 'getPool', args: [base.questionId, child] })
		for (let outcome = 0; outcome < carryOutcomes; outcome++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'materializePortfolioQuestion', args: [sourcePool(), child] }))
		return { child, childPool }
	}
	test('an outsider cannot register an unfinished child game and overwrite its live reporter source', async () => {
		const sourceGame = await prepareReport()
		const { child, childPool } = await activateUnrelatedFork(true, 1)
		const owner = fixture.owner()
		const other = fixture.other()
		const childGame = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotOutcomesInitialized' })).toBe(1n)
		await expect(other.writeContract({ ...portfolio(), functionName: 'registerReporterGame', args: [childGame] })).rejects.toThrow('Reporter fork snapshot incomplete')
		expect(await owner.readContract({ ...portfolio(), functionName: 'sourceGame', args: [child, fixture.base.questionId] })).toBe(sourceGame)
		for (let outcome = 1; outcome < 3; outcome++) await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'materializePortfolioQuestion', args: [sourcePool(), child] }))
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotInitialized' })).toBe(true)
		expect(await owner.readContract({ ...portfolio(), functionName: 'sourceGame', args: [child, fixture.base.questionId] })).toBe(childGame)
	})
})
