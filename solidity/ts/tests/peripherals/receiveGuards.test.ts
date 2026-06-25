import { beforeEach, describe, test } from 'bun:test'
import type { Address } from 'viem'
import { writeContractAndWait } from '../../testsuite/simulator/utils/viem'
import { usePeripheralsReceiveGuardsFixture, type PeripheralsReceiveGuardsFixture } from './fixture'

describe('Peripherals: receive guards', () => {
	const fixture = usePeripheralsReceiveGuardsFixture()
	const assert: PeripheralsReceiveGuardsFixture['assert'] = fixture.assert
	const strictEqualTypeSafe: PeripheralsReceiveGuardsFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe
	const {
		createWriteClient,
		TEST_ADDRESSES,
		getChildUniverseId,
		getETHBalance,
		manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		getQuestionEndDate,
		OperationType,
		QuestionOutcome,
		migrateRepToZoltar,
		migrateVault,
		getTotalTheoreticalSupply,
		createCompleteSet,
		depositRep,
		getRepToken,
		repDeposit,
		genesisUniverse,
		securityMultiplier,
		testInternalSenderBalance,
		sendEthAndWait,
	} = fixture

	let mockWindow: PeripheralsReceiveGuardsFixture['mockWindow']
	let client: PeripheralsReceiveGuardsFixture['client']
	let securityPoolAddresses: PeripheralsReceiveGuardsFixture['securityPoolAddresses']
	let questionId: PeripheralsReceiveGuardsFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionId = fixture.questionId
	})

	const expectUnauthorizedEthSendToReject = async (to: Address, value: bigint) => {
		const unauthorizedSender = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await mockWindow.setBalance(unauthorizedSender.account.address, testInternalSenderBalance)
		await assert.rejects(writeContractAndWait(unauthorizedSender, () => unauthorizedSender.sendTransaction({ to, value })))
	}

	test('SecurityPool receive restricts unauthorized senders', async () => {
		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const poolAddress = securityPoolAddresses.securityPool

		// Ensure forker has ETH to send
		await mockWindow.setBalance(forkerAddress, testInternalSenderBalance)

		// 1. Unauthorized sender should revert
		await expectUnauthorizedEthSendToReject(poolAddress, 1000n)

		// 2. Authorized sender: securityPoolForker
		await mockWindow.impersonateAccount(forkerAddress)
		await sendEthAndWait(forkerAddress, poolAddress, 1000n)
		const balance = await getETHBalance(client, poolAddress)
		strictEqualTypeSafe(balance, 1000n, 'Pool balance after forker send')

		// 3. Set up child pool scenario to test additional senders
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const openInterestAmount = 10n * 10n ** 18n
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		// Fork and migrate
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		// Get child addresses
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const childAddresses = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childPoolAddress = childAddresses.securityPool
		const truthAuctionAddress = childAddresses.truthAuction

		// Ensure ETH for testing
		await mockWindow.setBalance(truthAuctionAddress, testInternalSenderBalance)
		await mockWindow.setBalance(forkerAddress, testInternalSenderBalance)

		// 4. Unauthorized to child pool reverts
		await expectUnauthorizedEthSendToReject(childPoolAddress, 100n)

		// Record initial child balance
		const initialChildBal = await getETHBalance(client, childPoolAddress)

		// 5. Send from forker to child
		await mockWindow.impersonateAccount(forkerAddress)
		await sendEthAndWait(forkerAddress, childPoolAddress, 2000n)
		const afterForkerBal = await getETHBalance(client, childPoolAddress)
		strictEqualTypeSafe(afterForkerBal - initialChildBal, 2000n, 'Child balance increase from forker')

		// 6. Send from truthAuction to child
		await mockWindow.impersonateAccount(truthAuctionAddress)
		await sendEthAndWait(truthAuctionAddress, childPoolAddress, 3000n)
		const afterAuctionBal = await getETHBalance(client, childPoolAddress)
		strictEqualTypeSafe(afterAuctionBal - initialChildBal, 5000n, 'Child balance total increase from both')
	})

	test('SecurityPoolForker receive restricts unauthorized senders', async () => {
		const forkerAddress = getInfraContractAddresses().securityPoolForker

		// Setup to create a child pool so truthAuction is registered
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const openInterestAmount = 10n * 10n ** 18n
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const childAddresses = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const truthAuctionAddress = childAddresses.truthAuction

		// Ensure auction has ETH to send
		await mockWindow.setBalance(truthAuctionAddress, testInternalSenderBalance)

		// 1. Unauthorized sender to forker should revert
		await expectUnauthorizedEthSendToReject(forkerAddress, 100n)

		// 2. Authorized sender: truthAuction
		const initialForkerBal = await getETHBalance(client, forkerAddress)
		await mockWindow.impersonateAccount(truthAuctionAddress)
		await sendEthAndWait(truthAuctionAddress, forkerAddress, 2000n)
		const newForkerBal = await getETHBalance(client, forkerAddress)
		strictEqualTypeSafe(newForkerBal - initialForkerBal, 2000n, 'Forker balance increase from truthAuction')
	})
})
