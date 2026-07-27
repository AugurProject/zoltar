import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { approveToken, getERC20Balance, setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import assert from '../testSupport/simulator/utils/assert'
import { ensureInfraDeployed } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { deployOriginSecurityPool, getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { approveAndDepositRep } from '../testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { depositToEscalationGame, getSecurityVault, poolOwnershipToRep, redeemRep, withdrawFromEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'
import { getNonDecisionThreshold } from '../testSupport/simulator/utils/contracts/escalationGame'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { addressString } from '../testSupport/simulator/utils/bigint'
import {
	peripherals_EscalationGame_EscalationGame,
	peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier,
	peripherals_SecurityPool_SecurityPool,
	test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool,
	test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar,
	test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness,
	Zoltar_Zoltar,
} from '../types/contractArtifact'
import { GENESIS_REPUTATION_TOKEN } from '../testSupport/simulator/utils/constants'

const DAY = 86400n
const ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT = 2n

setDefaultTimeout(TEST_TIMEOUT_MS)

const getUserRepClaim = async (client: WriteClient, securityPoolAddress: Address) => {
	const vault = await getSecurityVault(client, securityPoolAddress, client.account.address)
	return await poolOwnershipToRep(client, securityPoolAddress, vault.repDepositShare)
}

describe('Escalation Game Fork Threshold Test', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const genesisUniverse = 0n
	const securityMultiplier = 2n
	const currentTimestamp = BigInt(Math.floor(Date.now() / 1000))
	const questionEndDate = currentTimestamp + 365n * DAY
	let securityPoolAddresses: {
		securityPool: Address
		escalationGame: Address
	}
	let questionId: bigint

	const deployContract = async (deploymentData: Hex): Promise<Address> => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('deployment address missing')
		return contractAddress
	}

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)

		const questionData = {
			title: 'Test',
			description: '',
			startTime: 0n,
			endTime: questionEndDate,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		questionId = getQuestionId(questionData, outcomes)
		await createQuestion(client, questionData, outcomes)

		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier)
		await approveAndDepositRep(client, 1000n * 10n ** 18n, questionId)

		securityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
	})

	test('withdrawal amount scaled by actual fork threshold after decrease', async () => {
		const depositAmount = 1n * 10n ** 18n // 1 ether

		// Advance time past the question's end date to allow escalation game deposit
		await mockWindow.setTime(questionEndDate + 1n)

		// Deploy escalation game and deposit on Yes
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, depositAmount)
		const escalationGameAddress = securityPoolAddresses.escalationGame

		// Get escalation threshold (fixed)
		const escalationThreshold = await getNonDecisionThreshold(client, escalationGameAddress)

		// Get current total supply of REP
		const repToken = getRepTokenAddress(genesisUniverse)
		const initialTotalSupply = await getTotalTheoreticalSupply(client, repToken)

		// Ensure initial fork threshold > escalationThreshold (should be twice)
		const initialForkThreshold = initialTotalSupply / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		assert.ok(initialForkThreshold > escalationThreshold, 'initial fork threshold must be greater than escalation threshold')

		// Lower the tracked universe theoretical supply to make actual fork threshold less than escalationThreshold
		const newTotalSupply = initialTotalSupply / 10n // reduce to 10% to get significant ratio
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))
		await mockWindow.addStateOverrides({
			[getZoltarAddress()]: {
				stateDiff: {
					[universeSupplySlot]: newTotalSupply,
				},
			},
		})

		const actualForkThreshold = newTotalSupply / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		assert.ok(actualForkThreshold < escalationThreshold, 'actual fork threshold should be lower after override')

		// Advance time to allow the escalation game to finish and outcome to be known
		await mockWindow.advanceTime(10n * DAY)

		// Withdraw via SecurityPool's withdrawFromEscalationGame
		const repBefore = await getUserRepClaim(client, securityPoolAddresses.securityPool)
		const walletRepBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_SecurityPool_SecurityPool.abi,
					address: securityPoolAddresses.securityPool,
					functionName: 'withdrawFromEscalationGame',
					args: [QuestionOutcome.Yes, [0n]], // deposit index 0
				}),
		)
		const repAfter = await getUserRepClaim(client, securityPoolAddresses.securityPool)
		const walletRepAfter = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		assert.strictEqual(repAfter, repBefore, 'settlement should not re-mint vault claim under escrow custody')
		assert.strictEqual(walletRepAfter - walletRepBefore, depositAmount / 5n, 'winning payout should be scaled by the lowered fork threshold after applying the single-sided winner payout schedule')
	})

	test('reduced-threshold scaling remains active immediately before and exactly at game end, but not one second after', async () => {
		const proofVerifier = await deployContract(
			encodeDeployData({
				abi: peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.abi,
				bytecode: `0x${peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}`,
			}),
		)
		const actualForkThreshold = 25n * 10n ** 18n
		const nonDecisionThreshold = 100n * 10n ** 18n
		const winningDeposit = 40n * 10n ** 18n
		const gameEndDate = 10_000_000n
		const zoltar = await deployContract(
			encodeDeployData({
				abi: test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar.abi,
				bytecode: `0x${test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar.evm.bytecode.object}`,
				args: [actualForkThreshold],
			}),
		)
		const securityPool = await deployContract(
			encodeDeployData({
				abi: test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool.abi,
				bytecode: `0x${test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool.evm.bytecode.object}`,
				args: [zoltar],
			}),
		)
		const harness = await deployContract(
			encodeDeployData({
				abi: test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.abi,
				bytecode: `0x${test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.evm.bytecode.object}`,
				args: [securityPool, proofVerifier],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.abi,
				address: harness,
				functionName: 'configureBoundary',
				args: [gameEndDate, nonDecisionThreshold, winningDeposit],
			}),
		)

		const expectedScaledPayout = (winningDeposit * actualForkThreshold) / nonDecisionThreshold
		for (const boundaryCase of [
			{ expectedPayout: expectedScaledPayout, forkTime: gameEndDate - 1n, name: 'one second before' },
			{ expectedPayout: expectedScaledPayout, forkTime: gameEndDate, name: 'exactly at' },
			{ expectedPayout: winningDeposit, forkTime: gameEndDate + 1n, name: 'one second after' },
		]) {
			await writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar.abi,
					address: zoltar,
					functionName: 'setForkTime',
					args: [boundaryCase.forkTime],
				}),
			)
			const [amountToWithdraw, burnAmount] = await client.readContract({
				abi: test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.abi,
				address: harness,
				functionName: 'computeWinningWithdrawal',
				args: [winningDeposit, winningDeposit],
			})
			assert.strictEqual(amountToWithdraw, boundaryCase.expectedPayout, `${boundaryCase.name} game end should preserve the documented fork-threshold payout boundary`)
			assert.strictEqual(burnAmount, 0n, 'the single-sided boundary harness should not create a reward haircut')
		}
	})

	test('late unrelated fork migration cannot reprice a finalized winning deposit or create sweepable residual', async () => {
		const depositAmount = 1000n * 10n ** 18n
		const firstDeposit = depositAmount / 2n
		const secondDeposit = depositAmount - firstDeposit
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attacker, depositAmount, questionId)

		await mockWindow.setTime(questionEndDate + 1n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondDeposit)
		const configuredThreshold = await getNonDecisionThreshold(client, securityPoolAddresses.escalationGame)
		await mockWindow.advanceTime(10n * DAY)
		const victimWalletBeforeFirstSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const victimWalletAfterFirstSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(victimWalletAfterFirstSettlement - victimWalletBeforeFirstSettlement, firstDeposit, 'a finalized winner settled before the unrelated fork must receive its frozen principal')

		const forkInitiator = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		const forkQuestionEnd = (await mockWindow.getTime()) + DAY
		const forkQuestionData = {
			title: 'Late unrelated finalized-game fork',
			description: '',
			startTime: 0n,
			endTime: forkQuestionEnd,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const forkQuestionId = getQuestionId(forkQuestionData, ['Yes', 'No'])
		await createQuestion(forkInitiator, forkQuestionData, ['Yes', 'No'])
		await mockWindow.setTime(forkQuestionEnd + 1n)
		await approveToken(forkInitiator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkInitiator, genesisUniverse, forkQuestionId)

		for (let accountIndex = 1; accountIndex < TEST_ADDRESSES.length; accountIndex++) {
			const migratorAddress = TEST_ADDRESSES[accountIndex]
			if (migratorAddress === undefined) throw new Error(`Missing migration test account ${accountIndex}`)
			const migrator = createWriteClient(mockWindow, migratorAddress, 0)
			const migratorBalance = await getERC20Balance(migrator, addressString(GENESIS_REPUTATION_TOKEN), migrator.account.address)
			if (migratorBalance === 0n) continue
			await approveToken(migrator, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await addRepToMigrationBalance(migrator, genesisUniverse, migratorBalance)
		}

		const reducedForkThreshold = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: getZoltarAddress(),
			functionName: 'getForkThreshold',
			args: [genesisUniverse],
		})
		assert.ok(reducedForkThreshold < configuredThreshold, 'real post-fork migration should reduce the live threshold below the finalized game threshold')

		const victimWalletBeforeSecondSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await withdrawFromEscalationGame(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [1n])
		const victimWalletAfterSecondSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		assert.strictEqual(victimWalletAfterSecondSettlement - victimWalletBeforeSecondSettlement, secondDeposit, 'a remaining finalized winner settled after unrelated migration must receive the same frozen principal')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.escalationGame), 0n, 'late migration must not leave confiscated winner principal in the escalation game')
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: securityPoolAddresses.escalationGame,
				functionName: 'sweepResidualRepToSecurityPool',
				args: [],
			}),
			/No sweepable REP/,
		)

		const attackerWalletBefore = await getERC20Balance(attacker, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)
		await redeemRep(attacker, securityPoolAddresses.securityPool, attacker.account.address)
		const attackerWalletAfter = await getERC20Balance(attacker, addressString(GENESIS_REPUTATION_TOKEN), attacker.account.address)
		assert.strictEqual(attackerWalletAfter - attackerWalletBefore, depositAmount, 'remaining pool ownership must redeem only its original REP, not a winner haircut')
	})

	test('deploys the escalation game with the tracked Zoltar fork threshold instead of the token supply', async () => {
		const depositAmount = 1n * 10n ** 18n
		const repToken = getRepTokenAddress(genesisUniverse)
		const initialTotalSupply = await getTotalTheoreticalSupply(client, repToken)
		const approximateForkThreshold = initialTotalSupply / 10n / DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const oddForkThreshold = approximateForkThreshold % 2n === 0n ? approximateForkThreshold + 1n : approximateForkThreshold
		const overriddenTotalSupply = oddForkThreshold * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const expectedThreshold = (oddForkThreshold + 1n) / 2n
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))

		await mockWindow.addStateOverrides({
			[getZoltarAddress()]: {
				stateDiff: {
					[universeSupplySlot]: overriddenTotalSupply,
				},
			},
		})

		await mockWindow.setTime(questionEndDate + 1n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, depositAmount)

		assert.strictEqual(
			await client.readContract({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				address: securityPoolAddresses.securityPool,
				functionName: 'initialEscalationGameDeposit',
				args: [],
			}),
			DEFAULT_PROTOCOL_CONFIG.initialEscalationGameDeposit,
			'initial escalation deposit should match deployment config',
		)
		assert.strictEqual(await getNonDecisionThreshold(client, securityPoolAddresses.escalationGame), expectedThreshold, 'escalation threshold should follow Zoltar tracked supply')
	})

	test.each([
		{ name: 'even', forkThreshold: 100n },
		{ name: 'odd', forkThreshold: 101n },
	])('uses ceiling-half non-decision funding boundaries for an $name fork threshold', async ({ forkThreshold }) => {
		const overriddenTotalSupply = forkThreshold * DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor
		const universeSupplySlot = keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [genesisUniverse, ZOLTAR_UNIVERSE_THEORETICAL_SUPPLIES_SLOT]))
		await mockWindow.addStateOverrides({
			[getZoltarAddress()]: {
				stateDiff: {
					[universeSupplySlot]: overriddenTotalSupply,
				},
			},
		})

		const nonDecisionThreshold = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: getZoltarAddress(),
			functionName: 'getNonDecisionThreshold',
			args: [genesisUniverse],
		})
		const expectedThreshold = (forkThreshold + 1n) / 2n
		const twoOutcomeTotal = 2n * nonDecisionThreshold

		assert.strictEqual(nonDecisionThreshold, expectedThreshold, 'non-decision should use ceiling division by two')
		assert.ok(twoOutcomeTotal >= forkThreshold, 'two threshold outcomes must always fund the fork threshold')
		assert.ok(2n * (nonDecisionThreshold - 1n) < forkThreshold, 'one wei less on both outcomes must remain below fork funding')
		assert.strictEqual(forkThreshold - 1n >= twoOutcomeTotal, false, 'F - 1 total REP must never fund two threshold outcomes')
		assert.strictEqual(forkThreshold >= twoOutcomeTotal, forkThreshold % 2n === 0n, 'exactly F total REP funds two threshold outcomes only when F is even')
		assert.strictEqual(forkThreshold + 1n >= twoOutcomeTotal, true, 'F + 1 total REP must fund two threshold outcomes')
	})
})
