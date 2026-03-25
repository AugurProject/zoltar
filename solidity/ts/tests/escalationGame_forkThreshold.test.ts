import { test, beforeEach, describe } from 'bun:test'
import { getMockedEthSimulateWindowEthereum, AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import assert from 'node:assert'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { deployOriginSecurityPool, getSecurityPoolAddresses } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { approveAndDepositRep } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { depositToEscalationGame, getSecurityVault, poolOwnershipToRep } from '../testsuite/simulator/utils/contracts/securityPool'
import { getNonDecisionThreshold } from '../testsuite/simulator/utils/contracts/escalationGame'
import { getTotalTheoreticalSupply, getRepTokenAddress } from '../testsuite/simulator/utils/contracts/zoltar'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { peripherals_SecurityPool_SecurityPool } from '../types/contractArtifact'

const DAY = 86400n
const MAX_RETENTION_RATE = 999_999_996_848_000_000n // ≈90% yearly

describe('Escalation Game Fork Threshold Test', () => {
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const genesisUniverse = 0n
	const securityMultiplier = 2n
	const startingRepEthPrice = 10n
	const currentTimestamp = BigInt(Math.floor(Date.now() / 1000))
	const questionEndDate = currentTimestamp + 365n * DAY
	let securityPoolAddresses: {
		securityPool: `0x${ string }`
		escalationGame: `0x${ string }`
	}
	let questionId: bigint

	beforeEach(async () => {
		mockWindow = await getMockedEthSimulateWindowEthereum()
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

		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier, MAX_RETENTION_RATE, startingRepEthPrice)
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
		const initialForkThreshold = initialTotalSupply / 20n
		assert.ok(initialForkThreshold > escalationThreshold, 'initial fork threshold must be greater than escalation threshold')

		// Lower total supply to make actual fork threshold less than escalationThreshold
		const newTotalSupply = initialTotalSupply / 10n // reduce to 10% to get significant ratio
		const slot5 = '0x' + 5n.toString(16).padStart(64, '0')
		await mockWindow.addStateOverrides({
			[repToken]: {
				stateDiff: {
					[slot5]: newTotalSupply,
				},
			},
		})

		const actualForkThreshold = newTotalSupply / 20n
		assert.ok(actualForkThreshold < escalationThreshold, 'actual fork threshold should be lower after override')

		// Advance time to allow the escalation game to finish and outcome to be known
		await mockWindow.advanceTime(10n * DAY)

		// Withdraw via SecurityPool's withdrawFromEscalationGame
		// Get vault ownership before withdrawal
		const vaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const repBefore = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBefore.repDepositShare)
		const txHash = await client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			address: securityPoolAddresses.securityPool,
			functionName: 'withdrawFromEscalationGame',
			args: [QuestionOutcome.Yes, [0n]], // deposit index 0
		})
		await client.waitForTransactionReceipt({ hash: txHash })
		const vaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const repAfter = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultAfter.repDepositShare)

		// Expected amount: depositAmount scaled by the ratio of thresholds
		// Net REP claim should change by `expected - depositAmount`, because the original deposit
		// was already part of the vault's ownership and only locked while the game was active.
		const expected = (depositAmount * actualForkThreshold) / escalationThreshold
		assert.strictEqual(repAfter - repBefore, expected - depositAmount, 'scaled amount mismatch')
	})
})
