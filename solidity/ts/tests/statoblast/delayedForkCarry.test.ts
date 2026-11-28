import { describe, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../testSupport/storage'
import {
	statoblast_EscalationGame_EscalationGame,
	statoblast_QuestionLedger_QuestionLedger,
	statoblast_QuestionForker_QuestionForker,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	Zoltar_Zoltar,
} from '../../types/contractArtifact'
import assert from '../../testSupport/simulator/utils/assert'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getEscalationGameOutcomeState } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getAwaitingForkContinuation, getRepToken, getQuestionLedgersEscalationGame, getSystemState } from '../../testSupport/simulator/utils/contracts/questionLedger'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getZoltarAddress, getZoltarForkThreshold } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { createCarryProof } from '../carryProofHelpers'
import { useSecurityPoolFixture } from './securityPoolFixture'

const ATTO_REP_PER_REP = 10n ** 18n

describe('Statoblast: delayed repeated-fork carry', () => {
	const securityPool = useSecurityPoolFixture()
	const fixture = securityPool.base
	const native = () => securityPool.poolFor(fixture.questionId)
	const depositToEscalationGame = async (sender: WriteClient, pool: Address, outcome: QuestionOutcome, amount: bigint) => {
		await approveToken(sender, await getRepToken(sender, pool), pool)
		return writeContractAndWait(sender, () => sender.writeContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	}
	const activateChild = async (source: Address, universe: bigint) => {
		const { client, mockWindow } = fixture
		const controller = await client.readContract({ abi: securityPoolArtifact.abi, address: securityPool.securityPool, functionName: 'forkController' })
		const forkTime = await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'getForkTime', args: [universe] })
		await mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(client, () => client.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'startBranch', args: [universe, 1n] }))
		const child = getChildUniverseId(universe, QuestionOutcome.Yes)
		await writeContractAndWait(client, () => client.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'finalizeBranch', args: [child] }))
		const target = { abi: statoblast_QuestionForker_QuestionForker.abi, address: getInfraContractAddresses().questionForker }
		await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'prepareSecurityPoolQuestion', args: [source, child] }))
		for (let outcome = 0; outcome < 3; outcome++) await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'materializeSecurityPoolQuestion', args: [source, child] }))
		return securityPool.poolFor(fixture.questionId, child, source)
	}

	async function resumePool(pool: Address) {
		const { client } = fixture
		assert.equal(await getSystemState(client, pool), SystemState.Operational)
		assert.equal(await getAwaitingForkContinuation(client, pool), false)
	}

	async function setupInheritedDispute() {
		const { client, mockWindow, questionData, outcomes, genesisUniverse } = fixture
		const questionLedgerAddresses = native()
		const noDepositor = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		await mockWindow.setTime(questionData.endTime + 10000n)
		await depositToEscalationGame(client, questionLedgerAddresses.questionLedger, QuestionOutcome.Yes, 100n * ATTO_REP_PER_REP)
		await depositToEscalationGame(noDepositor, questionLedgerAddresses.questionLedger, QuestionOutcome.No, 80n * ATTO_REP_PER_REP)
		const parentGame = await getQuestionLedgersEscalationGame(client, questionLedgerAddresses.questionLedger)
		const proof = await createCarryProof(client, parentGame, {
			expectedOutcome: QuestionOutcome.No,
			parentDepositIndex: 0n,
			sourceNodeId: 2n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 0n,
			merkleMountainRangeSiblings: [],
		})
		const firstQuestion = { ...questionData, title: 'delayed carry first unrelated fork' }
		await createQuestion(noDepositor, firstQuestion, outcomes)
		await approveToken(noDepositor, await getRepToken(client, questionLedgerAddresses.questionLedger), getZoltarAddress())
		await forkUniverse(noDepositor, genesisUniverse, getQuestionId(firstQuestion, outcomes))
		const universe = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const pool = await activateChild(questionLedgerAddresses.questionLedger, genesisUniverse)
		await resumePool(pool.questionLedger)
		const game = await getQuestionLedgersEscalationGame(client, pool.questionLedger)
		assert.equal((await getEscalationGameOutcomeState(client, game, QuestionOutcome.Yes)).inheritedUnresolvedTotalAttoRep, 100n * ATTO_REP_PER_REP)
		assert.equal((await getEscalationGameOutcomeState(client, game, QuestionOutcome.No)).inheritedUnresolvedTotalAttoRep, 80n * ATTO_REP_PER_REP)
		const deadline = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getEscalationGameEndDate' })
		const secondQuestion = { ...questionData, title: 'delayed carry second unrelated fork' }
		await createQuestion(noDepositor, secondQuestion, outcomes)
		const repToken = await getRepToken(client, pool.questionLedger)
		const forkThreshold = await getZoltarForkThreshold(client, universe)
		// Only fund the unrelated fork initiator; carry principal and backing come from real migrations.
		const balanceSlot = formatStorageSlot(getAddressMappingStorageSlot(noDepositor.account.address, 0n))
		await mockWindow.addStateOverrides({ [repToken]: { stateDiff: { [balanceSlot]: forkThreshold * 2n } } })
		await approveToken(noDepositor, repToken, getZoltarAddress())
		return { noDepositor, pool, game, universe, deadline, proof, secondQuestionId: getQuestionId(secondQuestion, outcomes) }
	}

	for (const { offset, name } of [
		{ offset: -DAY, name: 'a pre-deadline fork preserves the original NO claim through delayed migration and a winner reversal' },
		{ offset: 0n, name: 'a fork exactly at the deadline preserves every outcome through delayed migration' },
		{ offset: -1n, name: 'a fork one second before the deadline preserves child recovery without restarting reporting' },
		{ offset: DAY, name: 'a fork after genuine settlement retires losing inherited principal' },
	]) {
		test(name, async () => {
			const { client, mockWindow } = fixture
			const { noDepositor, pool, game, universe, deadline, proof, secondQuestionId } = await setupInheritedDispute()
			const beforeFork = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getForkCarrySnapshot' })
			const beforeForkRoots = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getForkCarryRoots' })
			// The fixture includes each transaction at latest block time + 1.
			const forkAt = deadline + offset
			await mockWindow.setTime(forkAt - 1n)
			const finalizedBeforeFork = offset === DAY
			assert.equal(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getFinalQuestionResolution' }), BigInt(finalizedBeforeFork ? QuestionOutcome.Yes : QuestionOutcome.None))
			await forkUniverse(noDepositor, universe, secondQuestionId)
			assert.equal(await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'getForkTime', args: [universe] }), forkAt)
			await mockWindow.setTime(forkAt + DAY)
			const delayedSnapshot = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getForkCarrySnapshot' })
			const delayedFinality = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getFinalQuestionResolution' })
			const poolOutcome = await client.readContract({ abi: statoblast_QuestionForker_QuestionForker.abi, address: getInfraContractAddresses().questionForker, functionName: 'getQuestionOutcome', args: [pool.questionLedger] })
			assert.deepStrictEqual(delayedSnapshot[0], beforeFork[0], 'delay must preserve proof commitments')
			assert.deepStrictEqual(delayedSnapshot[1], beforeFork[1], 'delay must preserve leaf counts')

			if (finalizedBeforeFork) {
				assert.equal(delayedFinality, BigInt(QuestionOutcome.Yes), 'a dispute finalized before the fork stays settled')
				assert.equal(poolOutcome, BigInt(QuestionOutcome.Yes))
				assert.equal(delayedSnapshot[2][QuestionOutcome.No], 0n, 'genuinely losing inherited principal must retire')
				assert.equal(delayedSnapshot[2][QuestionOutcome.Yes], 100n * ATTO_REP_PER_REP)
				await assert.rejects(noDepositor.writeContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: pool.questionLedger, functionName: 'withdrawForkedEscalationDeposits', args: [QuestionOutcome.No, [proof]] }), /Not winning outcome/)
				const winningProof = await createCarryProof(client, await getQuestionLedgersEscalationGame(client, native().questionLedger), {
					expectedOutcome: QuestionOutcome.Yes,
					parentDepositIndex: 0n,
					leafIndex: 0n,
					merkleMountainRangePeakIndex: 0n,
					merkleMountainRangeSiblings: [],
				})
				const token = await getRepToken(client, pool.questionLedger)
				const balanceBefore = await getERC20Balance(client, token, client.account.address)
				await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: pool.questionLedger, functionName: 'withdrawForkedEscalationDeposits', args: [QuestionOutcome.Yes, [winningProof]] }))
				assert.ok((await getERC20Balance(client, token, client.account.address)) > balanceBefore, 'genuinely finalized winning claims remain payable after the fork')
				assert.equal((await getEscalationGameOutcomeState(client, game, QuestionOutcome.Yes)).currentCarryTotalAttoRep, 0n)
				return
			}

			const nextUniverse = getChildUniverseId(universe, QuestionOutcome.Yes)
			const nextPool = await activateChild(pool.questionLedger, universe)
			const nextGame = await getQuestionLedgersEscalationGame(client, nextPool.questionLedger)
			const nextRep = await getRepToken(client, nextPool.questionLedger)
			const reporter = await client.readContract({ abi: securityPoolArtifact.abi, address: securityPool.securityPool, functionName: 'reporterLedger', args: [nextUniverse] })
			const migratedBacking = await client.readContract({ abi: reporterArtifact.abi, address: reporter, functionName: 'balanceOfGame', args: [nextGame] })
			const inheritedNo = await getEscalationGameOutcomeState(client, nextGame, QuestionOutcome.No)
			assert.deepStrictEqual(inheritedNo.snapshotCarryRoot, beforeForkRoots[QuestionOutcome.No], 'the original proof commitment must reach the next continuation')
			assert.equal(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'isForkCarryFundingComplete' }), true)
			await resumePool(nextPool.questionLedger)
			const resumedAt = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'forkResumedAt' })
			const responseEnd = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'getEscalationGameEndDate' })
			assert.equal(responseEnd, resumedAt + deadline - forkAt, 'the continuation preserves only its remaining curve time')
			const alreadyFinal = (await mockWindow.getTime()) > responseEnd
			assert.equal(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'getFinalQuestionResolution' }), BigInt(alreadyFinal ? QuestionOutcome.Yes : QuestionOutcome.None))

			const assertPreservedCarry = () => {
				assert.equal(delayedFinality, BigInt(QuestionOutcome.None))
				assert.equal(poolOutcome, BigInt(QuestionOutcome.None))
				assert.deepStrictEqual(delayedSnapshot[2], beforeFork[2], 'every unresolved outcome must survive delayed snapshot export')
				assert.equal(inheritedNo.inheritedUnresolvedTotalAttoRep, alreadyFinal ? 0n : 80n * ATTO_REP_PER_REP, 'only genuine child finality may retire losing inherited principal')
				assert.equal(inheritedNo.balanceAttoRep, 80n * ATTO_REP_PER_REP, 'final stake balances remain available for payout calculations')
				assert.equal(migratedBacking, 180n * ATTO_REP_PER_REP, 'both inherited outcomes must remain backed')
			}
			if (offset >= -1n) {
				assert.equal(alreadyFinal, true)
				await assert.rejects(noDepositor.writeContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: nextPool.questionLedger, functionName: 'withdrawForkedEscalationDeposits', args: [QuestionOutcome.No, [proof]] }), /Not winning outcome/)
				assertPreservedCarry()
				return
			}

			// Fund a new 30 REP deposit without touching game backing or the inherited 80 REP claim.
			await addRepToMigrationBalance(noDepositor, universe, 60n * ATTO_REP_PER_REP)
			await splitMigrationRep(noDepositor, universe, 60n * ATTO_REP_PER_REP, [QuestionOutcome.Yes])
			await approveToken(noDepositor, nextRep, nextPool.questionLedger)
			await depositToEscalationGame(noDepositor, nextPool.questionLedger, QuestionOutcome.No, 30n * ATTO_REP_PER_REP)
			assert.equal((await getEscalationGameOutcomeState(client, nextGame, QuestionOutcome.No)).balanceAttoRep, 110n * ATTO_REP_PER_REP)
			const finalDeadline = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'getEscalationGameEndDate' })
			await mockWindow.setTime(finalDeadline + 1n)
			assert.equal(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'getFinalQuestionResolution' }), BigInt(QuestionOutcome.No))
			assert.equal((await getEscalationGameOutcomeState(client, nextGame, QuestionOutcome.Yes)).currentCarryTotalAttoRep, 0n, 'the new genuine finality must retire the losing YES principal')
			const walletBefore = await getERC20Balance(client, nextRep, noDepositor.account.address)
			await writeContractAndWait(noDepositor, () => noDepositor.writeContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: nextPool.questionLedger, functionName: 'withdrawForkedEscalationDeposits', args: [QuestionOutcome.No, [proof]] }))
			assert.ok((await getERC20Balance(client, nextRep, noDepositor.account.address)) - walletBefore > 80n * ATTO_REP_PER_REP, 'the original carried NO claim must pay principal plus its winning reward')
			await assert.rejects(noDepositor.writeContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: nextPool.questionLedger, functionName: 'withdrawForkedEscalationDeposits', args: [QuestionOutcome.No, [proof]] }), /Deposit settled/)
			assert.equal((await getEscalationGameOutcomeState(client, nextGame, QuestionOutcome.No)).currentCarryTotalAttoRep, 30n * ATTO_REP_PER_REP, 'settling inherited principal must leave the new deposit intact')
			// Keep these checks after settlement so the pre-fix implementation reproduces Carried REP low.
			assertPreservedCarry()
		})
	}
})
