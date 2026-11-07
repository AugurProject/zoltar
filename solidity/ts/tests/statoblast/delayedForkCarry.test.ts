import { describe, test } from 'bun:test'
import { type Address } from '@zoltar/core-shared/evm/ethereum'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../testSupport/storage'
import {
	statoblast_EscalationGame_EscalationGame,
	statoblast_SecurityPool_SecurityPool,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	Zoltar_Zoltar,
} from '../../types/contractArtifact'
import assert from '../../testSupport/simulator/utils/assert'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getEscalationGameOutcomeState } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { getAwaitingForkContinuation, getRepToken, getSecurityPoolsEscalationGame, getSystemState } from '../../testSupport/simulator/utils/contracts/securityPool'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getZoltarAddress, getZoltarForkThreshold } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { createCarryProof, SparseNullifierTree } from '../carryProofHelpers'
import { useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

const ATTO_REP_PER_REP = 10n ** 18n

describe('Statoblast: delayed repeated-fork carry', () => {
	const portfolio = useSecurityPoolPortfolioFixture()
	const fixture = portfolio.base
	const native = () => portfolio.poolFor(fixture.questionId)
	const depositToEscalationGame = async (sender: WriteClient, pool: Address, outcome: QuestionOutcome, amount: bigint) => {
		await approveToken(sender, await getRepToken(sender, pool), pool)
		return writeContractAndWait(sender, () => sender.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	}
	const activateChild = async (source: Address, universe: bigint) => {
		const { client, mockWindow } = fixture
		const controller = await client.readContract({ abi: portfolioArtifact.abi, address: portfolio.portfolio, functionName: 'forkController' })
		const forkTime = await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'getForkTime', args: [universe] })
		await mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(client, () => client.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'startBranch', args: [universe, 1n] }))
		const child = getChildUniverseId(universe, QuestionOutcome.Yes)
		await writeContractAndWait(client, () => client.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'finalizeBranch', args: [child] }))
		const target = { abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi, address: getInfraContractAddresses().securityPoolForker }
		await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'preparePortfolioQuestion', args: [source, child] }))
		for (let outcome = 0; outcome < 3; outcome++) await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'materializePortfolioQuestion', args: [source, child] }))
		return portfolio.poolFor(fixture.questionId, child, source)
	}

	async function resumePool(pool: Address) {
		const { client } = fixture
		assert.equal(await getSystemState(client, pool), SystemState.Operational)
		assert.equal(await getAwaitingForkContinuation(client, pool), false)
	}

	async function setupInheritedDispute() {
		const { client, mockWindow, questionData, outcomes, genesisUniverse } = fixture
		const securityPoolAddresses = native()
		const noDepositor = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		await mockWindow.setTime(questionData.endTime + 10000n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, 100n * ATTO_REP_PER_REP)
		await depositToEscalationGame(noDepositor, securityPoolAddresses.securityPool, QuestionOutcome.No, 80n * ATTO_REP_PER_REP)
		const parentGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const proof = await createCarryProof(client, parentGame, {
			expectedOutcome: QuestionOutcome.No,
			parentDepositIndex: 0n,
			sourceNodeId: 2n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 0n,
			merkleMountainRangeSiblings: [],
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
		})
		const firstQuestion = { ...questionData, title: 'delayed carry first unrelated fork' }
		await createQuestion(noDepositor, firstQuestion, outcomes)
		await approveToken(noDepositor, await getRepToken(client, securityPoolAddresses.securityPool), getZoltarAddress())
		await forkUniverse(noDepositor, genesisUniverse, getQuestionId(firstQuestion, outcomes))
		const universe = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const pool = await activateChild(securityPoolAddresses.securityPool, genesisUniverse)
		await resumePool(pool.securityPool)
		const game = await getSecurityPoolsEscalationGame(client, pool.securityPool)
		assert.equal((await getEscalationGameOutcomeState(client, game, QuestionOutcome.Yes)).inheritedUnresolvedTotalAttoRep, 100n * ATTO_REP_PER_REP)
		assert.equal((await getEscalationGameOutcomeState(client, game, QuestionOutcome.No)).inheritedUnresolvedTotalAttoRep, 80n * ATTO_REP_PER_REP)
		const deadline = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getEscalationGameEndDate' })
		const resumedAt = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'forkResumedAt' })
		const inheritedElapsed = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'forkElapsedAtStart' })
		const estimatedElapsed = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'computeTimeSinceStartFromAttritionCostAttoRep', args: [80n * ATTO_REP_PER_REP] })
		const curveEstimate = resumedAt + (estimatedElapsed > inheritedElapsed ? estimatedElapsed - inheritedElapsed : 0n)
		const estimatedDeadline = curveEstimate > resumedAt + 3n * DAY ? curveEstimate : resumedAt + 3n * DAY
		const secondQuestion = { ...questionData, title: 'delayed carry second unrelated fork' }
		await createQuestion(noDepositor, secondQuestion, outcomes)
		const repToken = await getRepToken(client, pool.securityPool)
		const forkThreshold = await getZoltarForkThreshold(client, universe)
		// Only fund the unrelated fork initiator; carry principal and backing come from real migrations.
		const balanceSlot = formatStorageSlot(getAddressMappingStorageSlot(noDepositor.account.address, 0n))
		await mockWindow.addStateOverrides({ [repToken]: { stateDiff: { [balanceSlot]: forkThreshold * 2n } } })
		await approveToken(noDepositor, repToken, getZoltarAddress())
		return { noDepositor, pool, game, universe, deadline, estimatedDeadline, proof, secondQuestionId: getQuestionId(secondQuestion, outcomes) }
	}

	for (const { offset, name } of [
		{ offset: -DAY, name: 'a pre-deadline fork preserves the original NO claim through delayed migration and a winner reversal' },
		{ offset: 0n, name: 'a fork exactly at the deadline preserves every outcome through delayed migration' },
		{ offset: 1n, name: 'a fork in the logarithmic estimate rounding gap preserves child recovery and winning claims' },
		{ offset: DAY, name: 'a fork after genuine settlement retires losing inherited principal' },
	]) {
		test(name, async () => {
			const { client, mockWindow } = fixture
			const { noDepositor, pool, game, universe, deadline, estimatedDeadline, proof, secondQuestionId } = await setupInheritedDispute()
			const beforeFork = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getForkCarrySnapshot' })
			// The fixture includes each transaction at latest block time + 1.
			const forkAt = (offset === 1n ? estimatedDeadline : deadline) + offset
			await mockWindow.setTime(forkAt - 1n)
			const finalizedBeforeFork = offset === DAY
			assert.equal(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getFinalQuestionResolution' }), BigInt(finalizedBeforeFork ? QuestionOutcome.Yes : QuestionOutcome.None))
			await forkUniverse(noDepositor, universe, secondQuestionId)
			assert.equal(await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'getForkTime', args: [universe] }), forkAt)
			await mockWindow.setTime(forkAt + DAY)
			const delayedSnapshot = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getForkCarrySnapshot' })
			const delayedFinality = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: game, functionName: 'getFinalQuestionResolution' })
			const poolOutcome = await client.readContract({ abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'getQuestionOutcome', args: [pool.securityPool] })
			assert.deepStrictEqual(delayedSnapshot[0], beforeFork[0], 'delay must preserve proof commitments')
			assert.deepStrictEqual(delayedSnapshot[1], beforeFork[1], 'delay must preserve leaf counts')
			assert.deepStrictEqual(delayedSnapshot[3], beforeFork[3], 'delay must not consume claims')

			if (finalizedBeforeFork) {
				assert.equal(delayedFinality, BigInt(QuestionOutcome.Yes), 'a dispute finalized before the fork stays settled')
				assert.equal(poolOutcome, BigInt(QuestionOutcome.Yes))
				assert.equal(delayedSnapshot[2][QuestionOutcome.No], 0n, 'genuinely losing inherited principal must retire')
				assert.equal(delayedSnapshot[2][QuestionOutcome.Yes], 100n * ATTO_REP_PER_REP)
				await assert.rejects(noDepositor.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool.securityPool, functionName: 'withdrawForkedEscalationDeposits', args: [QuestionOutcome.No, [proof]] }), /Not winning outcome/)
				const winningProof = await createCarryProof(client, await getSecurityPoolsEscalationGame(client, native().securityPool), {
					expectedOutcome: QuestionOutcome.Yes,
					parentDepositIndex: 0n,
					leafIndex: 0n,
					merkleMountainRangePeakIndex: 0n,
					merkleMountainRangeSiblings: [],
					nullifierSiblings: new SparseNullifierTree().getProof(0n),
				})
				const token = await getRepToken(client, pool.securityPool)
				const balanceBefore = await getERC20Balance(client, token, client.account.address)
				await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool.securityPool, functionName: 'withdrawForkedEscalationDeposits', args: [QuestionOutcome.Yes, [winningProof]] }))
				assert.ok((await getERC20Balance(client, token, client.account.address)) > balanceBefore, 'genuinely finalized winning claims remain payable after the fork')
				assert.equal((await getEscalationGameOutcomeState(client, game, QuestionOutcome.Yes)).currentCarryTotalAttoRep, 0n)
				return
			}

			const nextUniverse = getChildUniverseId(universe, QuestionOutcome.Yes)
			const nextPool = await activateChild(pool.securityPool, universe)
			const nextGame = await getSecurityPoolsEscalationGame(client, nextPool.securityPool)
			const nextRep = await getRepToken(client, nextPool.securityPool)
			const reporter = await client.readContract({ abi: portfolioArtifact.abi, address: portfolio.portfolio, functionName: 'reporterLedger', args: [nextUniverse] })
			const migratedBacking = await client.readContract({ abi: reporterArtifact.abi, address: reporter, functionName: 'balanceOfGame', args: [nextGame] })
			const inheritedNo = await getEscalationGameOutcomeState(client, nextGame, QuestionOutcome.No)
			assert.deepStrictEqual(inheritedNo.snapshotPeaks, beforeFork[0][QuestionOutcome.No], 'the original proof commitment must reach the next continuation')
			assert.equal(inheritedNo.currentNullifierRoot, beforeFork[3][QuestionOutcome.No])
			assert.equal(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'isForkCarryFundingComplete' }), true)
			await resumePool(nextPool.securityPool)
			const resumedAt = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'forkResumedAt' })
			const responseEnd = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'getEscalationGameEndDate' })
			assert.ok(responseEnd >= resumedAt + 3n * DAY, 'the next continuation must receive a fresh response period')
			assert.equal(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'getFinalQuestionResolution' }), BigInt(QuestionOutcome.None))

			const assertPreservedCarry = () => {
				assert.equal(delayedFinality, BigInt(QuestionOutcome.None))
				assert.equal(poolOutcome, BigInt(QuestionOutcome.None))
				assert.deepStrictEqual(delayedSnapshot[2], beforeFork[2], 'every unresolved outcome must survive delayed snapshot export')
				assert.equal(inheritedNo.inheritedUnresolvedTotalAttoRep, 80n * ATTO_REP_PER_REP)
				assert.equal(inheritedNo.balanceAttoRep, 80n * ATTO_REP_PER_REP)
				assert.equal(migratedBacking, 180n * ATTO_REP_PER_REP, 'both inherited outcomes must remain backed')
			}
			if (offset === 0n) {
				assertPreservedCarry()
				return
			}

			// Fund a new 30 REP deposit without touching game backing or the inherited 80 REP claim.
			await addRepToMigrationBalance(noDepositor, universe, 60n * ATTO_REP_PER_REP)
			await splitMigrationRep(noDepositor, universe, 60n * ATTO_REP_PER_REP, [QuestionOutcome.Yes])
			await approveToken(noDepositor, nextRep, nextPool.securityPool)
			await depositToEscalationGame(noDepositor, nextPool.securityPool, QuestionOutcome.No, 30n * ATTO_REP_PER_REP)
			assert.equal((await getEscalationGameOutcomeState(client, nextGame, QuestionOutcome.No)).balanceAttoRep, 110n * ATTO_REP_PER_REP)
			const finalDeadline = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'getEscalationGameEndDate' })
			await mockWindow.setTime(finalDeadline + 1n)
			assert.equal(await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: nextGame, functionName: 'getFinalQuestionResolution' }), BigInt(QuestionOutcome.No))
			assert.equal((await getEscalationGameOutcomeState(client, nextGame, QuestionOutcome.Yes)).currentCarryTotalAttoRep, 0n, 'the new genuine finality must retire the losing YES principal')
			const walletBefore = await getERC20Balance(client, nextRep, noDepositor.account.address)
			await writeContractAndWait(noDepositor, () => noDepositor.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: nextPool.securityPool, functionName: 'withdrawForkedEscalationDeposits', args: [QuestionOutcome.No, [proof]] }))
			assert.ok((await getERC20Balance(client, nextRep, noDepositor.account.address)) - walletBefore > 80n * ATTO_REP_PER_REP, 'the original carried NO claim must pay principal plus its winning reward')
			const consumedNullifiers = new SparseNullifierTree()
			consumedNullifiers.consume(proof.parentDepositIndex)
			assert.equal((await getEscalationGameOutcomeState(client, nextGame, QuestionOutcome.No)).currentNullifierRoot, consumedNullifiers.root)
			await assert.rejects(noDepositor.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: nextPool.securityPool, functionName: 'withdrawForkedEscalationDeposits', args: [QuestionOutcome.No, [proof]] }), /Deposit settled|Bad nullifier proof/)
			assert.equal((await getEscalationGameOutcomeState(client, nextGame, QuestionOutcome.No)).currentCarryTotalAttoRep, 30n * ATTO_REP_PER_REP, 'settling inherited principal must leave the new deposit intact')
			// Keep these checks after settlement so the pre-fix implementation reproduces Carried REP low.
			assertPreservedCarry()
		})
	}
})
