
/*
import test, { beforeEach, describe } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { getDeployments } from '../testsuite/simulator/utils/deployments.js'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { approveToken, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { deployPeripherals, deployZoltarAndCreateMarket, genesisUniverse, questionId, securityMultiplier } from '../testsuite/simulator/utils/peripheralsTestUtils.js'
import { addressString, dateToBigintSeconds } from '../testsuite/simulator/utils/bigint.js'
import { QuestionOutcome } from '../testsuite/simulator/types/types.js'
import { createNewGame, depositToGame, getBalances, getEscalationGame, getStartingTime } from '../testsuite/simulator/utils/EscalationGame.js'
import assert from 'node:assert'
import { getInfraContractAddresses } from '../testsuite/simulator/utils/deployPeripherals.js'

describe('Peripherals Contract Test Suite', () => {
	let mockWindow: MockWindowEthereum

	let client: WriteClient
	const currentTimestamp = dateToBigintSeconds(new Date())
	const testMarket = addressString(0x1n)
	const designatedReporter = addressString(0x2n)
	const startingStake = 1n * 10n ** 18n

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments(genesisUniverse, questionId, securityMultiplier)))
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		//await mockWindow.setStartBLock(mockWindow.getTime)
		await setupTestAccounts(mockWindow)
		await deployZoltarAndCreateMarket(client, currentTimestamp + 365n * DAY)
		await deployPeripherals(client)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getInfraContractAddresses().isonzoFront)
	})

	test('can start a game', async () => {
		await createNewGame(client, testMarket, designatedReporter, QuestionOutcome.Yes, startingStake)
		const escalationGame = await getEscalationGame(client, testMarket)
		console.log(escalationGame)
		assert.strictEqual(BigInt(escalationGame) !== 0n, true, 'escalation game deployed')
		const outcomeBalances = await getBalances(client, escalationGame)
		assert.strictEqual(outcomeBalances.yes, startingStake, 'starting stake was set')
		assert.strictEqual(outcomeBalances.no, 0n, 'no stake at no')
		assert.strictEqual(outcomeBalances.invalid, 0n, 'no stake at invalid')

		const startingTime = await getStartingTime(client, escalationGame)
		assert.strictEqual(startingTime !== 0n, true, 'game was started')
		await depositToGame(client, testMarket, QuestionOutcome.No, 2n * startingStake)
		const outcomeBalancesAfterDeposit = await getBalances(client, escalationGame)
		assert.strictEqual(outcomeBalancesAfterDeposit.yes, startingStake, 'starting stake was set')
		assert.strictEqual(outcomeBalancesAfterDeposit.no, 2n * startingStake, 'no stake at no')
		assert.strictEqual(outcomeBalancesAfterDeposit.invalid, 0n, 'no stake at invalid')
	})
})
*/
