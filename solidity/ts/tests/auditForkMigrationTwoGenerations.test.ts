import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as coordinatorArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as premiumArtifact,
	statoblast_SecurityPoolServices_SecurityPoolServices as servicesArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
} from '../types/contractArtifact'
import { DAY } from '../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// Two questions carried through two generations of forks with lazily created pools.
// Q1: contested in the origin, becomes final in the never-materialized child A before A forks.
// Q2: trading, never touched in A, carried to the grandchild A1.
describe('audit: multi-question security pool across two universe forks', () => {
	const fixture = useSecurityPoolFixture()
	const unrelatedQuestion = async (title: string) => {
		const { base } = fixture
		const data = { ...base.questionData, title, endTime: (await base.mockWindow.getTime()) - 1n }
		await createQuestion(fixture.owner(), data, base.outcomes)
		return getQuestionId(data, base.outcomes)
	}

	test('lazy second-generation migration, recovery and collateral conservation', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const trader = fixture.other()
		const p = { abi: securityPoolArtifact.abi, address: fixture.securityPool }
		const q1 = base.questionId
		const q2 = fixture.secondQuestionId
		const U0 = base.genesisUniverse
		await fixture.prepare()
		await fixture.deposit(1_000n * unit, trader)
		await fixture.authorize(200n * unit, trader)
		await fixture.mint(10n * unit, q1)
		await fixture.mint(10n * unit, q2)
		const collateral = await owner.readContract({ ...p, functionName: 'collateralToken' })
		const engine = await owner.readContract({ ...p, functionName: 'settlement' })
		const services = await owner.readContract({ ...p, functionName: 'services' })
		const book = { abi: bookArtifact.abi, address: await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' }) }
		const coordinator = { abi: coordinatorArtifact.abi, address: await owner.readContract({ ...p, functionName: 'forkController' }) }
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker }
		const cash = (holder: Address) => getERC20Balance(owner, collateral, holder)
		const bookId = (universe: bigint) => owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [universe] })
		const totals = async (universe: bigint) => owner.readContract({ ...book, functionName: 'totals', args: [await bookId(universe)] })
		const question = async (universe: bigint, id: bigint) => owner.readContract({ ...book, functionName: 'question', args: [await bookId(universe), id] })
		const premiumBook = { abi: premiumArtifact.abi, address: await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'premiumLedger' }) }
		const source1 = fixture.poolFor(q1).questionLedger
		const source2 = fixture.poolFor(q2).questionLedger
		const shares1 = { abi: shareArtifact.abi, address: fixture.poolFor(q1).shareToken }
		const shares2 = { abi: shareArtifact.abi, address: fixture.poolFor(q2).shareToken }

		// Q1 reporting starts in the origin: Yes 100, No 70.
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(U0), source1)
		for (const [outcome, amount] of [
			[1, 100n * unit],
			[2, 70n * unit],
		] as const)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: source1, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		const game0 = await owner.readContract({ abi: poolArtifact.abi, address: source1, functionName: 'escalationGame' })
		const end0 = await owner.readContract({ abi: gameArtifact.abi, address: game0, functionName: 'getEscalationGameEndDate' })

		// First fork (unrelated question) while Q1 is contested and Q2 is trading.
		await approveToken(owner, getRepTokenAddress(U0), getZoltarAddress())
		await forkUniverse(owner, U0, await unrelatedQuestion('Audit first unrelated fork'))
		await addRepToMigrationBalance(owner, U0, 1_000_000n * unit)
		await splitMigrationRep(owner, U0, 1_000_000n * unit, [1n])
		const fork1 = (await getUniverseData(owner, U0)).forkTime
		expect(fork1).toBeLessThan(end0)
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'choose', args: [U0, 1n] }))
		const sealed0 = await totals(U0)
		const A = getChildUniverseId(U0, 1)
		const W = fork1 + 63n * DAY
		await base.mockWindow.setTime(W)
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'startBranch', args: [U0, 1n], gas: 16_777_216n }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'finalizeBranch', args: [A] }))

		// Nobody touches Q1 or Q2 in A. A forks long after Q1's inherited deadline elapsed.
		await base.mockWindow.setTime(W + 70n * DAY)
		await approveToken(owner, getRepTokenAddress(A), getZoltarAddress())
		await forkUniverse(owner, A, await unrelatedQuestion('Audit second unrelated fork'))
		const fork2 = (await getUniverseData(owner, A)).forkTime
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'choose', args: [A, 1n] }))
		// Q1 became final in A without ever being materialized there.
		const [, q1FrozenA] = await question(A, q1)
		expect(q1FrozenA).not.toBe(0n)
		const A1 = getChildUniverseId(A, 1)
		await base.mockWindow.setTime(fork2 + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'startBranch', args: [A, 1n], gas: 16_777_216n }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'finalizeBranch', args: [A1] }))

		// ---- Q2 (trading, no game): origin -> A -> A1 with no pool in A ----
		// Anyone can create the grandchild pool straight from the origin pool (skipping A).
		await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'prepareSecurityPoolQuestion', args: [source2, A1] }))
		const pool2A1 = await owner.readContract({ ...p, functionName: 'getQuestionLedger', args: [q2, A1] })
		expect((await owner.readContract({ abi: poolArtifact.abi, address: pool2A1, functionName: 'parent' })).toLowerCase()).toBe(source2.toLowerCase())
		// The intermediate pool can still be prepared explicitly and tokens migrated through it.
		await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'prepareSecurityPoolQuestion', args: [source2, A] }))
		for (const outcome of [0n, 1n, 2n]) await writeContractAndWait(trader, () => trader.writeContract({ ...shares2, functionName: 'migrate', args: [U0 * 256n + outcome, [1n]] }))
		for (const outcome of [0n, 1n, 2n]) await writeContractAndWait(trader, () => trader.writeContract({ ...shares2, functionName: 'migrate', args: [A * 256n + outcome, [1n]] }))
		await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'materializeSecurityPoolQuestion', args: [source2, A1] }))
		const balanceA1 = await trader.readContract({ ...shares2, functionName: 'balanceOfShares', args: [A1, trader.account.address] })
		expect(balanceA1[0]).toBe(10n * unit)
		const quoteA1 = await owner.readContract({ ...p, functionName: 'quoteQuestionSettlement', args: [pool2A1, 10n * unit] })
		let before = await cash(trader.account.address)
		await writeContractAndWait(trader, () => trader.writeContract({ abi: poolArtifact.abi, address: pool2A1, functionName: 'redeemCompleteSet', args: [10n * unit, 0n] }))
		const q2FromA1 = (await cash(trader.account.address)) - before
		expect(q2FromA1).toBe(quoteA1)
		// Recovery of unassigned cash at both generations.
		const originRecovery = await trader.simulateContract({ ...coordinator, functionName: 'recoverUnchosenCash', args: [U0, q2, 10n * unit] })
		before = await cash(trader.account.address)
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'recoverUnchosenCash', args: [U0, q2, 10n * unit] }))
		const q2FromU0 = (await cash(trader.account.address)) - before
		expect(originRecovery.result).toBe(q2FromU0)
		before = await cash(trader.account.address)
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'recoverUnchosenCash', args: [A, q2, 10n * unit] }))
		const q2FromA = (await cash(trader.account.address)) - before

		// ---- Q1 (final in the forked, never materialized A) ----
		await writeContractAndWait(trader, () => trader.writeContract({ ...shares1, functionName: 'migrate', args: [U0 * 256n + 1n, [1n]] }))
		for (let step = 0; step < 3; step++) await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'materializeSecurityPoolQuestion', args: [source1, A] }))
		const pool1A = await owner.readContract({ ...p, functionName: 'getQuestionLedger', args: [q1, A] })
		expect(Number(await owner.readContract({ abi: poolArtifact.abi, address: pool1A, functionName: 'systemState' }))).toBe(0)
		await expect(trader.simulateContract({ ...shares1, functionName: 'migrate', args: [A * 256n + 1n, [1n]] })).rejects.toThrow('ShareToken question finalized before fork')
		before = await cash(trader.account.address)
		await writeContractAndWait(trader, () => trader.writeContract({ abi: poolArtifact.abi, address: pool1A, functionName: 'redeemShares', args: [0n] }))
		const q1FromA = (await cash(trader.account.address)) - before
		before = await cash(trader.account.address)
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'recoverUnchosenCash', args: [U0, q1, 10n * unit] }))
		const q1FromU0 = (await cash(trader.account.address)) - before
		await expect(trader.simulateContract({ ...coordinator, functionName: 'recoverUnchosenCash', args: [A, q1, 10n * unit] })).rejects.toThrow()

		const engineAfter = await cash(engine)
		const coordinatorCash = await cash(coordinator.address)
		const servicesCash = await cash(services)
		const premiumTotal = await owner.readContract({ ...premiumBook, functionName: 'totalCash' })
		// Every attoETH of sealed origin settlement cash is either paid to the holder or still accounted.
		const pendingFees = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'pendingServiceFees' })
		expect(engineAfter).toBeGreaterThanOrEqual(pendingFees)
		expect(engineAfter - pendingFees).toBeLessThanOrEqual(8n)
		expect(coordinatorCash).toBeLessThanOrEqual(8n)
		expect(q2FromA1 + q2FromU0 + q2FromA + q1FromA + q1FromU0).toBeGreaterThanOrEqual(sealed0[0] - 16n)
		expect(servicesCash).toBeGreaterThanOrEqual(premiumTotal)
	})

	test('shares migrate through a pool that was prepared but not materialized before its universe forked', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const trader = fixture.other()
		const p = { abi: securityPoolArtifact.abi, address: fixture.securityPool }
		const q2 = fixture.secondQuestionId
		const U0 = base.genesisUniverse
		await fixture.prepare()
		await fixture.mint(10n * unit, q2)
		const coordinator = { abi: coordinatorArtifact.abi, address: await owner.readContract({ ...p, functionName: 'forkController' }) }
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker }
		const source2 = fixture.poolFor(q2).questionLedger
		const shares2 = { abi: shareArtifact.abi, address: fixture.poolFor(q2).shareToken }
		await approveToken(owner, getRepTokenAddress(U0), getZoltarAddress())
		await forkUniverse(owner, U0, await unrelatedQuestion('Audit prepared-pool first fork'))
		await addRepToMigrationBalance(owner, U0, 1_000_000n * unit)
		await splitMigrationRep(owner, U0, 1_000_000n * unit, [1n])
		const fork1 = (await getUniverseData(owner, U0)).forkTime
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'choose', args: [U0, 1n] }))
		const A = getChildUniverseId(U0, 1)
		await base.mockWindow.setTime(fork1 + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'startBranch', args: [U0, 1n], gas: 16_777_216n }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'finalizeBranch', args: [A] }))
		// Optional first-use preparation only: the pool stays in ForkMigration.
		await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'prepareSecurityPoolQuestion', args: [source2, A] }))
		const poolA = await owner.readContract({ ...p, functionName: 'getQuestionLedger', args: [q2, A] })
		await writeContractAndWait(trader, () => trader.writeContract({ ...shares2, functionName: 'migrate', args: [U0 * 256n + 1n, [1n]] }))
		const stateBefore = Number(await owner.readContract({ abi: poolArtifact.abi, address: poolA, functionName: 'systemState' }))
		await base.mockWindow.setTime(fork1 + 63n * DAY + 30n * DAY)
		await approveToken(owner, getRepTokenAddress(A), getZoltarAddress())
		await forkUniverse(owner, A, await unrelatedQuestion('Audit prepared-pool second fork'))
		const fork2 = (await getUniverseData(owner, A)).forkTime
		await base.mockWindow.setTime(fork2 + 63n * DAY)
		expect(stateBefore).toBe(2)
		// A live question still cannot activate in the forked universe ...
		await expect(trader.simulateContract({ ...forker, functionName: 'materializeSecurityPoolQuestion', args: [source2, A] })).rejects.toThrow('Only finalized questions can activate in a forked universe')
		// ... but once the branch custody exists, migration itself puts the prepared ledger
		// into fork mode. Each branch step fits one transaction and none is per question.
		const A1 = getChildUniverseId(A, 1)
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'freeze', args: [A], gas: 16_777_216n }))
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'prepareBranch', args: [A, 1n], gas: 16_777_216n }))
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'startBranch', args: [A, 1n], gas: 16_777_216n }))
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'finalizeBranch', args: [A1], gas: 16_777_216n }))
		await writeContractAndWait(trader, () => trader.writeContract({ ...shares2, functionName: 'migrate', args: [A * 256n + 1n, [1n]], gas: 16_777_216n }))
		expect(Number(await owner.readContract({ abi: poolArtifact.abi, address: poolA, functionName: 'systemState' }))).toBe(1)
		expect(await trader.readContract({ ...shares2, functionName: 'balanceOf', args: [trader.account.address, A1 * 256n + 1n] })).toBe(10n * unit)
	})
})
