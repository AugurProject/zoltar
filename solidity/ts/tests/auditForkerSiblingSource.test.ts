import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
} from '../types/contractArtifact'
import { DAY } from '../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

const GAS = 16_777_216n

// #1322: U0 forks into A (outcome 1) and B (outcome 2); A forks again into A1.
// A pool of A is not an ancestor of B, so it cannot become the parent of B's ledger.
// Once a ledger exists, any canonical ancestor names the same completion.
describe('audit: a portfolio question ledger descends only from an ancestor universe', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const unrelatedQuestion = async (title: string) => {
		const { base } = fixture
		const data = { ...base.questionData, title, endTime: (await base.mockWindow.getTime()) - 1n }
		await createQuestion(fixture.owner(), data, base.outcomes)
		return getQuestionId(data, base.outcomes)
	}

	test('sibling source is refused and a prepared ledger completes from any ancestor source', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const trader = fixture.other()
		const p = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const q2 = fixture.secondQuestionId
		const U0 = base.genesisUniverse
		await fixture.prepare()
		await fixture.mint(10n * unit, q2)
		const coordinator = { abi: coordinatorArtifact.abi, address: await owner.readContract({ ...p, functionName: 'forkController' }) }
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker }
		const originPool = fixture.poolFor(q2).securityPool
		const state = async (pool: `0x${string}`) => Number(await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'systemState' }))
		const parentOf = async (pool: `0x${string}`) => (await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'parent' })).toLowerCase()

		// First fork. Both branches are prepared and activated.
		await approveToken(owner, getRepTokenAddress(U0), getZoltarAddress())
		await forkUniverse(owner, U0, await unrelatedQuestion('Sibling source first fork'))
		await addRepToMigrationBalance(owner, U0, 1_000_000n * unit)
		await splitMigrationRep(owner, U0, 1_000_000n * unit, [1n])
		const fork1 = (await getUniverseData(owner, U0)).forkTime
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'choose', args: [U0, 1n], gas: GAS }))
		const A = getChildUniverseId(U0, 1)
		const B = getChildUniverseId(U0, 2)
		await base.mockWindow.setTime(fork1 + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'startBranch', args: [U0, 1n], gas: GAS }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'finalizeBranch', args: [A], gas: GAS }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'prepareBranch', args: [U0, 2n], gas: GAS }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'startBranch', args: [U0, 2n], gas: GAS }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'finalizeBranch', args: [B], gas: GAS }))

		// The question is prepared in A only (ForkMigration), never in B.
		await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'preparePortfolioQuestion', args: [originPool, A], gas: GAS }))
		const poolA = await owner.readContract({ ...p, functionName: 'getPool', args: [q2, A] })
		expect(await parentOf(poolA)).toBe(originPool.toLowerCase())

		// A forks; its child A1 is activated in the portfolio. B is untouched.
		await base.mockWindow.setTime(fork1 + 63n * DAY + 30n * DAY)
		await approveToken(owner, getRepTokenAddress(A), getZoltarAddress())
		await forkUniverse(owner, A, await unrelatedQuestion('Sibling source second fork'))
		const fork2 = (await getUniverseData(owner, A)).forkTime
		expect((await getUniverseData(owner, B)).forkTime).toBe(0n)
		await base.mockWindow.setTime(fork2 + 63n * DAY)
		const A1 = getChildUniverseId(A, 1)
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'freeze', args: [A], gas: GAS }))
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'prepareBranch', args: [A, 1n], gas: GAS }))
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'startBranch', args: [A, 1n], gas: GAS }))
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'finalizeBranch', args: [A1], gas: GAS }))

		// A's pool cannot seed B's ledger: B is A's sibling, not its descendant.
		for (const functionName of ['preparePortfolioQuestion', 'materializePortfolioQuestion'] as const) await expect(trader.simulateContract({ ...forker, functionName, args: [poolA, B], gas: GAS })).rejects.toThrow('Target universe does not descend from source')
		// The source an interface derives (origin pool) still deploys and activates B's ledger.
		await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'materializePortfolioQuestion', args: [originPool, B], gas: GAS }))
		const poolB = await owner.readContract({ ...p, functionName: 'getPool', args: [q2, B] })
		expect(await parentOf(poolB)).toBe(originPool.toLowerCase())
		expect(await state(poolB)).toBe(0)

		// A1's ledger is prepared from the intermediate pool. A call naming the origin pool,
		// as the interface does without a recorded reporter game, completes it.
		await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'preparePortfolioQuestion', args: [poolA, A1], gas: GAS }))
		const poolA1 = await owner.readContract({ ...p, functionName: 'getPool', args: [q2, A1] })
		expect(await parentOf(poolA1)).toBe(poolA.toLowerCase())
		expect(await state(poolA1)).toBe(2)
		await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'preparePortfolioQuestion', args: [originPool, A1], gas: GAS }))
		await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'materializePortfolioQuestion', args: [originPool, A1], gas: GAS }))
		expect(await state(poolA1)).toBe(0)
		expect(await parentOf(poolA1)).toBe(poolA.toLowerCase())
	})
})
