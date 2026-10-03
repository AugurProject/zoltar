import { createCompleteSet, depositRepToVault, getRepToken } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getTotalTheoreticalSupply } from '../../testSupport/simulator/utils/contracts/zoltar'
import { migrateRepToZoltar, migrateVault } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getQuestionEndDate } from '../../testSupport/simulator/utils/contracts/statoblast'
import { getInfraContractAddresses, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { triggerOwnGameFork, setVaultCapacityFixture } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { getChildUniverseId, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'
import { strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import assert from '../../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { decodeEventLog, getAddress, keccak256, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { useStatoblastReceiveGuardsFixture } from './fixture'

describe('Statoblast: receive guards', () => {
	const fixture = useStatoblastReceiveGuardsFixture()

	const { repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, testInternalSenderBalance, sendEthAndWait } = fixture

	const expectUnauthorizedEthSendToReject = async (to: Address, value: bigint, expectedReason: RegExp) => {
		const { mockWindow, client } = fixture
		const unauthorizedSender = createWriteClient(mockWindow, TEST_ADDRESSES[6])
		await mockWindow.setBalance(unauthorizedSender.account.address, testInternalSenderBalance)
		const targetBalanceBefore = await getETHBalance(client, to)
		await assert.rejects(
			writeContractAndWait(unauthorizedSender, () => unauthorizedSender.sendTransaction({ to, value })),
			expectedReason,
		)
		strictEqualTypeSafe(await getETHBalance(client, to), targetBalanceBefore, 'Rejected ETH send must preserve the target balance')
	}

	test('coordinator deployment emits its liquidation approval registry wiring', async () => {
		const { client, securityPoolAddresses } = fixture
		const coordinator = securityPoolAddresses.openOraclePriceCoordinator
		const registry = await client.readContract({ address: coordinator, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'liquidationApprovalRegistry' })
		const topic = keccak256(new TextEncoder().encode('LiquidationApprovalRegistrySet(address)'))
		const logs = (await client.getLogs({ address: coordinator, fromBlock: 0n, toBlock: await client.getBlockNumber() })).filter(log => log.topics[0] === topic)
		strictEqualTypeSafe(logs.length, 1, 'Registry wiring emits once')
		const log = logs[0]
		if (log === undefined) throw new Error('Registry wiring event missing')
		const event = decodeEventLog({ abi: parseAbi(['event LiquidationApprovalRegistrySet(address indexed registry)']), data: log.data, topics: log.topics })
		assert.deepStrictEqual(event.args, { registry: getAddress(registry) })
	})

	test('authorized ETH receipt emits the sender and received amount', async () => {
		const { mockWindow, client, securityPoolAddresses } = fixture
		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const poolAddress = securityPoolAddresses.securityPool
		await mockWindow.setBalance(forkerAddress, testInternalSenderBalance)
		await mockWindow.impersonateAccount(forkerAddress)
		const fromBlock = await client.getBlockNumber()
		await sendEthAndWait(forkerAddress, poolAddress, 1000n)
		const logs = await client.getLogs({ address: poolAddress, fromBlock: fromBlock + 1n, toBlock: await client.getBlockNumber() })
		strictEqualTypeSafe(logs.length, 1, 'ETH receipt emits once')
		const log = logs[0]
		if (log === undefined) throw new Error('ETH receipt event missing')
		const event = decodeEventLog({ abi: parseAbi(['event EthReceived(address indexed sender, uint256 amountAttoEth)']), data: log.data, topics: log.topics })
		assert.deepStrictEqual(event.args, { sender: getAddress(forkerAddress), amountAttoEth: 1000n })
		strictEqualTypeSafe(await getETHBalance(client, poolAddress), 1000n, 'Received ETH remains in pool')
	})

	test('SecurityPool receive restricts unauthorized senders', async () => {
		const { mockWindow, client, securityPoolAddresses, questionId } = fixture
		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const poolAddress = securityPoolAddresses.securityPool

		// Ensure forker has ETH to send
		await mockWindow.setBalance(forkerAddress, testInternalSenderBalance)

		// 1. Unauthorized sender should revert
		await expectUnauthorizedEthSendToReject(poolAddress, 1000n, /Bad ETH sender/)

		// 2. Authorized sender: securityPoolForker
		await mockWindow.impersonateAccount(forkerAddress)
		await sendEthAndWait(forkerAddress, poolAddress, 1000n)
		const balance = await getETHBalance(client, poolAddress)
		strictEqualTypeSafe(balance, 1000n, 'Pool balance after forker send')

		// 3. Set up child pool scenario to test additional senders
		const endTime = await getQuestionEndDate(client, questionId)
		const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
		await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const openInterestAmount = 10n * 10n ** 18n
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		// Fork and migrate
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		// Get child addresses
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const childAddresses = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const childPoolAddress = childAddresses.securityPool
		const truthAuctionAddress = childAddresses.truthAuction

		// Ensure ETH for testing
		await mockWindow.setBalance(truthAuctionAddress, testInternalSenderBalance)
		await mockWindow.setBalance(forkerAddress, testInternalSenderBalance)

		// 4. Unauthorized to child pool reverts
		await expectUnauthorizedEthSendToReject(childPoolAddress, 100n, /Bad ETH sender/)

		// Record initial child balance
		const initialChildBal = await getETHBalance(client, childPoolAddress)
		const fromBlock = await client.getBlockNumber()

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

		// 7. The parent pool is also an authorized child-pool sender.
		await mockWindow.impersonateAccount(poolAddress)
		await sendEthAndWait(poolAddress, childPoolAddress, 100n)
		const receiveTopic = keccak256(new TextEncoder().encode('EthReceived(address,uint256)'))
		const logs = (await client.getLogs({ address: childPoolAddress, fromBlock: fromBlock + 1n, toBlock: await client.getBlockNumber() })).filter(log => log.topics[0] === receiveTopic)
		const events = logs.map(log => decodeEventLog({ abi: parseAbi(['event EthReceived(address indexed sender, uint256 amountAttoEth)']), data: log.data, topics: log.topics }).args)
		assert.deepStrictEqual(events, [
			{ sender: getAddress(forkerAddress), amountAttoEth: 2000n },
			{ sender: getAddress(truthAuctionAddress), amountAttoEth: 3000n },
			{ sender: getAddress(poolAddress), amountAttoEth: 100n },
		])
		strictEqualTypeSafe(await getETHBalance(client, childPoolAddress), initialChildBal + 5100n, 'Child balance includes parent transfer')
	})

	test('SecurityPoolForker receive restricts unauthorized senders', async () => {
		const { mockWindow, client, securityPoolAddresses, questionId } = fixture
		const forkerAddress = getInfraContractAddresses().securityPoolForker

		// Setup to create a child pool so truthAuction is registered
		const endTime = await getQuestionEndDate(client, questionId)
		const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
		await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const openInterestAmount = 10n * 10n ** 18n
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const childAddresses = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const truthAuctionAddress = childAddresses.truthAuction

		// Ensure auction has ETH to send
		await mockWindow.setBalance(truthAuctionAddress, testInternalSenderBalance)

		// 1. Unauthorized sender to forker should revert
		await expectUnauthorizedEthSendToReject(forkerAddress, 100n, /execution reverted/)

		// 2. Authorized sender: truthAuction
		const initialForkerBal = await getETHBalance(client, forkerAddress)
		await mockWindow.impersonateAccount(truthAuctionAddress)
		await sendEthAndWait(truthAuctionAddress, forkerAddress, 2000n)
		const newForkerBal = await getETHBalance(client, forkerAddress)
		strictEqualTypeSafe(newForkerBal - initialForkerBal, 2000n, 'Forker balance increase from truthAuction')
	})
})
