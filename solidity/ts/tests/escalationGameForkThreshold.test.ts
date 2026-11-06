import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import { encodeAbiParameters, encodeDeployData, keccak256, type Address } from '@zoltar/core-shared/evm/ethereum'
import { beforeEach, describe, test } from 'bun:test'
import { deployContract } from '../testSupport/deployContract'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'
import assert from '../testSupport/simulator/utils/assert'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, GENESIS_UNIVERSE } from '../testSupport/simulator/utils/constants'
import { getNonDecisionThresholdAttoRep } from '../testSupport/simulator/utils/contracts/escalationGame'
import { withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { approveToken, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import {
	statoblast_EscalationGame_EscalationGame,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier,
	statoblast_SecurityPool_SecurityPool,
	test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool,
	test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar,
	test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness,
	Zoltar_Zoltar,
} from '../types/contractArtifact'

const DAY = 86400n
const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n

describe('Escalation Game Fork Threshold Test', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let questionEndDate: bigint
	let securityPoolAddresses: {
		securityPool: Address
		escalationGame: Address
		openOraclePriceCoordinator: Address
	}
	let questionId: bigint

	const overrideGenesisTheoreticalSupply = async (totalSupply: bigint) => {
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [GENESIS_UNIVERSE, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))
		await mockWindow.addStateOverrides({ [getZoltarAddress()]: { stateDiff: { [universeSupplySlot]: totalSupply } } })
	}

	beforeEach(async () => {
		mockWindow = fixture.base.mockWindow
		client = fixture.owner()
		questionId = fixture.base.questionId
		questionEndDate = fixture.base.questionData.endTime
		securityPoolAddresses = fixture.poolFor(questionId)
		await approveToken(client, getRepTokenAddress(GENESIS_UNIVERSE), securityPoolAddresses.securityPool)
	})
	const depositToEscalationGame = (sender: WriteClient, pool: Address, outcome: QuestionOutcome, amount: bigint) => writeContractAndWait(sender, () => sender.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	const reporterBalance = async () => {
		const ledger = await client.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'reporterLedger', args: [GENESIS_UNIVERSE] })
		return client.readContract({ abi: reporterArtifact.abi, address: ledger, functionName: 'balanceOfGame', args: [securityPoolAddresses.escalationGame] })
	}
	const capitalBalance = (owner = client.account.address) => client.readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'ownerCollateral', args: [owner] })

	test('withdrawal amount scaled by actual fork threshold after decrease', async () => {
		const depositAmount = 100n * 10n ** 18n

		// Advance time past the question's end date to allow escalation game deposit
		await mockWindow.setTime(questionEndDate + 1n)

		// Deploy escalation game and deposit on Yes
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, depositAmount)
		const escalationGameAddress = securityPoolAddresses.escalationGame

		// Get escalation threshold (fixed)
		const escalationThreshold = await getNonDecisionThresholdAttoRep(client, escalationGameAddress)

		// Get current total supply of REP
		const repToken = getRepTokenAddress(GENESIS_UNIVERSE)
		const initialTotalSupply = await getTotalTheoreticalSupply(client, repToken)

		// Ensure initial fork threshold > escalationThreshold (should be twice)
		const initialForkThreshold = initialTotalSupply / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		assert.ok(initialForkThreshold > escalationThreshold, 'initial fork threshold must be greater than escalation threshold')

		// Lower the tracked universe theoretical supply to make actual fork threshold less than escalationThreshold
		const newTotalSupply = initialTotalSupply / 10n // reduce to 10% to get significant ratio
		await overrideGenesisTheoreticalSupply(newTotalSupply)

		const actualForkThreshold = newTotalSupply / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		assert.ok(actualForkThreshold < escalationThreshold, 'actual fork threshold should be lower after override')

		// Advance time to allow the escalation game to finish and outcome to be known
		await mockWindow.advanceTime(10n * DAY)

		// Withdraw via SecurityPool's withdrawFromEscalationGame
		const repBefore = await capitalBalance()
		const walletRepBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					address: securityPoolAddresses.securityPool,
					functionName: 'withdrawFromEscalationGame',
					args: [QuestionOutcome.Yes, [0n]], // deposit index 0
				}),
		)
		const repAfter = await capitalBalance()
		const walletRepAfter = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		assert.deepStrictEqual(repAfter, repBefore, 'reporter settlement must not create underwriting collateral')
		assert.strictEqual(walletRepAfter - walletRepBefore, depositAmount / 5n, 'winning payout should be scaled by the lowered fork threshold after applying the single-sided winner payout schedule')
	})

	test('ordinary settlement freezes a reduced payout before later supply changes', async () => {
		const depositAmount = 100n * 10n ** 18n
		await mockWindow.setTime(questionEndDate + 1n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, depositAmount / 2n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, depositAmount / 2n)
		const initialSupply = await getTotalTheoreticalSupply(client, getRepTokenAddress(GENESIS_UNIVERSE))
		await overrideGenesisTheoreticalSupply(initialSupply / 10n)
		await mockWindow.advanceTime(10n * DAY)
		const before = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		await overrideGenesisTheoreticalSupply(initialSupply)
		await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: securityPoolAddresses.escalationGame, functionName: 'settleOrdinaryGame' }))
		assert.strictEqual(await reporterBalance(), depositAmount / 10n, 'the reserve should cover precisely the remaining frozen claim')
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [1n])
		assert.strictEqual((await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)) - before, depositAmount / 5n, 'supply changes after settlement must neither enlarge nor shrink the reserved payout')
		assert.strictEqual(await reporterBalance(), 0n)
	})

	test('reduced-threshold scaling remains active immediately before and exactly at game end, but not one second after', async () => {
		const proofVerifier = await deployContract(
			client,
			encodeDeployData({
				abi: statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi,
				bytecode: `0x${statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}`,
			}),
		)
		const actualForkThreshold = 25n * 10n ** 18n
		const nonDecisionThresholdAttoRep = 100n * 10n ** 18n
		const winningDeposit = 40n * 10n ** 18n
		const gameEndDate = 10_000_000n
		const zoltar = await deployContract(
			client,
			encodeDeployData({
				abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar.abi,
				bytecode: `0x${test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar.evm.bytecode.object}`,
				args: [actualForkThreshold],
			}),
		)
		const securityPool = await deployContract(
			client,
			encodeDeployData({
				abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool.abi,
				bytecode: `0x${test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool.evm.bytecode.object}`,
				args: [zoltar],
			}),
		)
		const harness = await deployContract(
			client,
			encodeDeployData({
				abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.abi,
				bytecode: `0x${test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.evm.bytecode.object}`,
				args: [securityPool, proofVerifier],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.abi,
				address: harness,
				functionName: 'configureBoundary',
				args: [gameEndDate, nonDecisionThresholdAttoRep, winningDeposit],
			}),
		)

		const expectedScaledPayout = (winningDeposit * actualForkThreshold) / nonDecisionThresholdAttoRep
		for (const boundaryCase of [
			{ expectedPayout: expectedScaledPayout, forkTime: gameEndDate - 1n, name: 'one second before' },
			{ expectedPayout: expectedScaledPayout, forkTime: gameEndDate, name: 'exactly at' },
			{ expectedPayout: winningDeposit, forkTime: gameEndDate + 1n, name: 'one second after' },
		]) {
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar.abi,
					address: zoltar,
					functionName: 'setForkTime',
					args: [boundaryCase.forkTime],
				}),
			)
			const [amountToWithdrawAttoRep, burnAmount] = await client.readContract({
				abi: test_statoblast_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.abi,
				address: harness,
				functionName: 'computeWinningWithdrawal',
				args: [winningDeposit, winningDeposit],
			})
			assert.strictEqual(amountToWithdrawAttoRep, boundaryCase.expectedPayout, `${boundaryCase.name} game end should preserve the documented fork-threshold payout boundary`)
			assert.strictEqual(burnAmount, 0n, 'the single-sided boundary harness should not create a reward haircut')
		}
	})

	test('late unrelated fork migration cannot reprice a finalized winning deposit or create sweepable residual', async () => {
		const depositAmount = 10_000n * 10n ** 18n
		const firstDeposit = (depositAmount * 3n) / 10n
		const secondDeposit = depositAmount - firstDeposit
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		await fixture.deposit(depositAmount, attacker)

		await mockWindow.setTime(questionEndDate + 1n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondDeposit)
		const configuredThreshold = await getNonDecisionThresholdAttoRep(client, securityPoolAddresses.escalationGame)
		await mockWindow.advanceTime(10n * DAY)
		const victimWalletBeforeFirstSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const victimWalletAfterFirstSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(victimWalletAfterFirstSettlement - victimWalletBeforeFirstSettlement, firstDeposit, 'a finalized winner settled before the unrelated fork must receive its frozen principal')

		const forkInitiator = createWriteClient(mockWindow, TEST_ADDRESSES[5])
		const forkQuestionEnd = (await mockWindow.getTime()) + DAY
		const forkQuestionData = makeQuestion('Late unrelated finalized-game fork', forkQuestionEnd)
		const forkQuestionId = getQuestionId(forkQuestionData, ['Yes', 'No'])
		await createQuestion(forkInitiator, forkQuestionData, ['Yes', 'No'])
		await mockWindow.setTime(forkQuestionEnd + 1n)
		await approveToken(forkInitiator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkInitiator, GENESIS_UNIVERSE, forkQuestionId)

		for (let accountIndex = 1; accountIndex < TEST_ADDRESSES.length; accountIndex++) {
			const migratorAddress = TEST_ADDRESSES[accountIndex]
			if (migratorAddress === undefined) throw new Error(`Missing migration test account ${accountIndex}`)
			const migrator = createWriteClient(mockWindow, migratorAddress)
			const migratorBalance = await getERC20Balance(migrator, addressString(GENESIS_REPUTATION_TOKEN), migrator.account.address)
			if (migratorBalance === 0n) continue
			await approveToken(migrator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await addRepToMigrationBalance(migrator, GENESIS_UNIVERSE, migratorBalance)
		}

		const reducedForkThreshold = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: getZoltarAddress(),
			functionName: 'getForkThresholdAttoRep',
			args: [GENESIS_UNIVERSE],
		})
		assert.ok(reducedForkThreshold < configuredThreshold, 'real post-fork migration should reduce the live threshold below the finalized game threshold')

		const victimWalletBeforeSecondSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [1n])
		const victimWalletAfterSecondSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(victimWalletAfterSecondSettlement - victimWalletBeforeSecondSettlement, secondDeposit, 'a remaining finalized winner settled after unrelated migration must receive the same frozen principal')
		assert.strictEqual(await reporterBalance(), 0n, 'late migration must not leave confiscated winner principal in the escalation game')
		await assert.rejects(
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: securityPoolAddresses.escalationGame,
				functionName: 'sweepResidualRepToSecurityPool',
			}),
			/No sweepable REP/,
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: securityPoolAddresses.escalationGame,
				functionName: 'settleOrdinaryGame',
			}),
		)
		assert.strictEqual(await reporterBalance(), 0n, 'idempotent settlement must not invent residual after every winner claims')

		const attackerWalletBefore = await getERC20Balance(attacker, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)
		await writeContractAndWait(attacker, () => attacker.writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'withdrawPrincipal', args: [depositAmount, attacker.account.address] }))
		const attackerWalletAfter = await getERC20Balance(attacker, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)
		assert.strictEqual(attackerWalletAfter - attackerWalletBefore, depositAmount, 'idle underwriting principal must remain separate from reporter payouts')
	})

	test('deploys the escalation game with the tracked Zoltar fork threshold instead of the token supply', async () => {
		const depositAmount = 100n * 10n ** 18n
		const repToken = getRepTokenAddress(GENESIS_UNIVERSE)
		const initialTotalSupply = await getTotalTheoreticalSupply(client, repToken)
		const approximateForkThreshold = initialTotalSupply / 10n / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const oddForkThreshold = approximateForkThreshold % 2n === 0n ? approximateForkThreshold + 1n : approximateForkThreshold
		const overriddenTotalSupply = oddForkThreshold * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const expectedThreshold = (oddForkThreshold + 1n) / 2n

		await overrideGenesisTheoreticalSupply(overriddenTotalSupply)

		await mockWindow.setTime(questionEndDate + 1n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, depositAmount)

		assert.strictEqual(
			await client.readContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: securityPoolAddresses.securityPool,
				functionName: 'initialEscalationGameDepositAttoRep',
				args: [],
			}),
			initialTotalSupply / 10_000_000n,
			'initial escalation deposit should apply the theoretical-supply floor',
		)
		assert.strictEqual(await getNonDecisionThresholdAttoRep(client, securityPoolAddresses.escalationGame), expectedThreshold, 'escalation threshold should follow Zoltar tracked supply')
	})

	test('derives newly registered question parameters from live supply after multiple burns', async () => {
		const initialSupply = await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'getUniverseTheoreticalSupplyAttoRep', args: [GENESIS_UNIVERSE] })
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		let expectedLiveSupply = initialSupply
		for (const burnAmount of [initialSupply / 20n, initialSupply / 25n]) {
			await writeContractAndWait(client, () => client.writeContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'burnRep', args: [GENESIS_UNIVERSE, burnAmount] }))
			expectedLiveSupply -= burnAmount
			assert.strictEqual(await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'getUniverseTheoreticalSupplyAttoRep', args: [GENESIS_UNIVERSE] }), expectedLiveSupply, 'each burn must reduce the authoritative live universe supply exactly once')
		}
		const liveSupply = await client.readContract({ abi: Zoltar_Zoltar.abi, address: getZoltarAddress(), functionName: 'getUniverseTheoreticalSupplyAttoRep', args: [GENESIS_UNIVERSE] })
		assert.strictEqual(liveSupply, expectedLiveSupply, 'the deployed pool must observe the complete burn sequence')
		const nextQuestionData = makeQuestion('Pool after multiple genesis REP burns', questionEndDate + DAY)
		const nextOutcomes = ['Yes', 'No']
		const nextQuestionId = getQuestionId(nextQuestionData, nextOutcomes)
		await createQuestion(client, nextQuestionData, nextOutcomes)
		await fixture.register(nextQuestionId)
		const nextPool = fixture.poolFor(nextQuestionId).securityPool
		const expectedInitialDeposit = liveSupply / 10_000_000n < 10n ** 18n ? 10n ** 18n : liveSupply / 10_000_000n

		assert.strictEqual(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: nextPool, functionName: 'initialEscalationGameDepositAttoRep' }), expectedInitialDeposit, 'initial escalation deposit should use live Zoltar supply')
	})

	test.each([
		{ name: 'even', forkThresholdAttoRep: 100n },
		{ name: 'odd', forkThresholdAttoRep: 101n },
	])('uses ceiling-half non-decision funding boundaries for an $name fork threshold', async ({ forkThresholdAttoRep }) => {
		const overriddenTotalSupply = forkThresholdAttoRep * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		await overrideGenesisTheoreticalSupply(overriddenTotalSupply)

		const nonDecisionThresholdAttoRep = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: getZoltarAddress(),
			functionName: 'getNonDecisionThresholdAttoRep',
			args: [GENESIS_UNIVERSE],
		})
		const expectedThreshold = (forkThresholdAttoRep + 1n) / 2n
		const twoOutcomeTotal = 2n * nonDecisionThresholdAttoRep

		assert.strictEqual(nonDecisionThresholdAttoRep, expectedThreshold, 'non-decision should use ceiling division by two')
		assert.ok(twoOutcomeTotal >= forkThresholdAttoRep, 'two threshold outcomes must always fund the fork threshold')
		assert.ok(2n * (nonDecisionThresholdAttoRep - 1n) < forkThresholdAttoRep, 'one attoREP less on both outcomes must remain below fork funding')
		assert.strictEqual(forkThresholdAttoRep - 1n >= twoOutcomeTotal, false, 'F - 1 total REP must never fund two threshold outcomes')
		assert.strictEqual(forkThresholdAttoRep >= twoOutcomeTotal, forkThresholdAttoRep % 2n === 0n, 'exactly F total REP funds two threshold outcomes only when F is even')
		assert.strictEqual(forkThresholdAttoRep + 1n >= twoOutcomeTotal, true, 'F + 1 total REP must fund two threshold outcomes')
	})
})
