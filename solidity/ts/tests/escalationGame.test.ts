import { test, beforeEach, describe } from 'bun:test'
import { getMockedEthSimulateWindowEthereum, AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { contractExists, setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import assert from 'node:assert'
import { deployEscalationGame, depositOnOutcome, getBalances, getStartingTime } from '../testsuite/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { peripherals_EscalationGame_EscalationGame } from '../types/contractArtifact'

describe('Escalation Game Test Suite', () => {
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const reportBond = 1n * 10n ** 18n
	const nonDecisionThreshold = 1000n * 10n ** 18n

	beforeEach(async () => {
		mockWindow = await getMockedEthSimulateWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
	})

	test('can start a game', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		assert.ok(await contractExists(client, escalationGame), 'game was deployed')
		const outcomeBalances = await getBalances(client, escalationGame)
		assert.strictEqual(outcomeBalances.yes, 0n, 'yes stake')
		assert.strictEqual(outcomeBalances.no, 0n, 'no stake')
		assert.strictEqual(outcomeBalances.invalid, 0n, 'invalid stake')

		const startingTime = await getStartingTime(client, escalationGame)
		assert.strictEqual(startingTime !== 0n, true, 'game was started')
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, reportBond)
		const outcomeBalancesAfterDeposit = await getBalances(client, escalationGame)
		assert.strictEqual(outcomeBalancesAfterDeposit.yes, 0n, 'yes stake')
		assert.strictEqual(outcomeBalancesAfterDeposit.no, reportBond, 'no stake')
		assert.strictEqual(outcomeBalancesAfterDeposit.invalid, 0n, 'invalid stake')
	})

	test('depositOnOutcome reverts when outcome is None', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.None, reportBond))
	})

	test('depositOnOutcome reverts when outcome is out of enum range', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		// Values > 3 are outside enum (0=Invalid,1=Yes,2=No,3=None)
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, 4 as unknown as QuestionOutcome, reportBond))
		await assert.rejects(depositOnOutcome(client, escalationGame, client.account.address, 255 as unknown as QuestionOutcome, reportBond))
	})

	test('claimDepositForWinning reverts when outcome is None', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, reportBond)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'claimDepositForWinning',
				args: [0n, QuestionOutcome.None],
			}),
		)
	})

	test('claimDepositForWinning reverts when outcome is out of enum range', async () => {
		const escalationGame = await deployEscalationGame(client, reportBond, nonDecisionThreshold)
		await assert.rejects(
			client.writeContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: escalationGame,
				functionName: 'claimDepositForWinning',
				args: [0n, 4],
			}),
		)
	})
})
