import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from 'node:assert/strict'
import { zeroAddress } from 'viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { addressString, dateToBigintSeconds } from '../testsuite/simulator/utils/bigint'
import { approveToken, getChildUniverseId, getETHBalance, setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { approveAndDepositRep, handleOracleReporting, manipulatePriceOracleAndPerformOperation } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { createQuestion, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { ensureZoltarDeployed, forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress } from '../testsuite/simulator/utils/contracts/zoltar'
import { getEthRaiseCap, getLastPrice, getQuestionEndDate, OperationType, participateAuction, requestPriceIfNeededAndStageOperation } from '../testsuite/simulator/utils/contracts/peripherals'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import { SystemState } from '../testsuite/simulator/types/peripheralTypes'
import { finalizeTruthAuction, getMigratedRep, getSecurityPoolForkerForkData, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault, startTruthAuction } from '../testsuite/simulator/utils/contracts/securityPoolForker'
import { createCompleteSet, depositRep, getCompleteSetCollateralAmount, getPoolOwnershipDenominator, getSecurityVault, getSystemState, getTotalRepBalance, getTotalSecurityBondAllowance } from '../testsuite/simulator/utils/contracts/securityPool'
import { getEthRaised } from '../testsuite/simulator/utils/contracts/auction'
import { peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('audit finding proof-of-concept tests', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let securityPoolAddresses: ReturnType<typeof getSecurityPoolAddresses>
	let questionId: bigint
	const genesisUniverse = 0n
	const outcomes = ['Yes', 'No']
	const securityMultiplier = 2n
	const repDeposit = 1000n * 10n ** 18n
	const pricePrecision = 10n ** 18n
	const maxRetentionRate = 999_999_996_848_000_000n

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)

		const now = dateToBigintSeconds(new Date())
		const questionData = {
			title: 'audit poc question',
			description: '',
			startTime: 0n,
			endTime: now + 365n * DAY,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		await createQuestion(client, questionData, outcomes)
		questionId = getQuestionId(questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier, maxRetentionRate)
		await approveAndDepositRep(client, repDeposit, questionId)
		securityPoolAddresses = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, securityMultiplier)
	})

	const triggerExternalForkForSecurityPool = async () => {
		const forkingClient = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		const forkSourceQuestionData = {
			title: `audit external fork source ${await mockWindow.getTime()}`,
			description: '',
			startTime: 0n,
			endTime: (await mockWindow.getTime()) + DAY,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(forkingClient, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		await approveToken(forkingClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkingClient, genesisUniverse, forkSourceQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
	}

	test('H-01 regression: finalized truth-auction ETH is forwarded to the child pool', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepTokenAddress(genesisUniverse))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		const passiveVault = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveVault, repDeposit, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerExternalForkForSecurityPool()
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'setup should start a child truth auction')

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		assert.ok(expectedEthToBuy > 0n, 'setup should leave ETH to buy in the truth auction')
		assert.strictEqual(await getEthRaiseCap(client, yesSecurityPool.truthAuction), expectedEthToBuy, 'truth-auction cap should match setup')

		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

		const forker = getInfraContractAddresses().securityPoolForker
		const forkerBalanceBefore = await getETHBalance(client, forker)
		const childBalanceBefore = await getETHBalance(client, yesSecurityPool.securityPool)
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		const auctionRaised = await getEthRaised(client, yesSecurityPool.truthAuction)
		assert.ok(auctionRaised > 0n, 'auction should raise ETH')
		assert.strictEqual(await getETHBalance(client, forker), forkerBalanceBefore, 'forker should not retain finalized truth-auction ETH')
		assert.strictEqual(await getETHBalance(client, yesSecurityPool.securityPool), childBalanceBefore + auctionRaised, 'child pool should receive finalized truth-auction ETH')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), childBalanceBefore + auctionRaised, 'child collateral accounting should include finalized truth-auction ETH')
	})

	test('M-01 PoC: target-controlled stale liquidation failure is consumed', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const targetAllowance = repDeposit / 4n
		const forcedPrice = pricePrecision * 10n
		const manager = securityPoolAddresses.priceOracleManagerAndOperatorQueuer

		await manipulatePriceOracleAndPerformOperation(client, mockWindow, manager, OperationType.SetSecurityBondsAllowance, client.account.address, targetAllowance)
		assert.ok(await getLastPrice(client, manager), 'setup should establish an initial valid price')

		const liquidator = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const capacityVault = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await approveToken(liquidator, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		await approveToken(capacityVault, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		await depositRep(liquidator, securityPoolAddresses.securityPool, repDeposit * 10n)
		await depositRep(capacityVault, securityPoolAddresses.securityPool, repDeposit * 10n)

		await mockWindow.advanceTime(2n * 60n * 60n)
		await requestPriceIfNeededAndStageOperation(capacityVault, manager, OperationType.SetSecurityBondsAllowance, capacityVault.account.address, targetAllowance)
		await requestPriceIfNeededAndStageOperation(liquidator, manager, OperationType.Liquidation, client.account.address, targetAllowance)
		const activeOperations = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: manager,
			functionName: 'getActiveStagedOperations',
			args: [0n, 10n],
		})
		const liquidationOperationIndex = activeOperations[1].findIndex(operation => operation.operation === OperationType.Liquidation && operation.targetVault === client.account.address)
		assert.notStrictEqual(liquidationOperationIndex, -1, 'setup should stage a manual liquidation operation')
		const liquidationOperationId = activeOperations[0][liquidationOperationIndex]
		assert.notStrictEqual(liquidationOperationId, undefined, 'setup should expose the liquidation operation id')

		const targetVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const snapshotTotalRep = await getTotalRepBalance(client, securityPoolAddresses.securityPool)
		const snapshotDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		assert.ok(targetVaultBefore.securityBondAllowance > 0n, 'target should have allowance at snapshot')
		assert.ok(snapshotTotalRep > 0n && snapshotDenominator > 0n, 'snapshot should have pool accounting')

		await handleOracleReporting(liquidator, mockWindow, manager, forcedPrice)
		assert.strictEqual(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), targetAllowance + targetAllowance, 'pending slot should set capacity allowance')

		await requestPriceIfNeededAndStageOperation(client, manager, OperationType.SetSecurityBondsAllowance, client.account.address, 0n)
		await requestPriceIfNeededAndStageOperation(client, manager, OperationType.WithdrawRep, client.account.address, repDeposit)

		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
				address: manager,
				functionName: 'executeStagedOperation',
				args: [liquidationOperationId],
			}),
		)

		const stagedOperation = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: manager,
			functionName: 'stagedOperations',
			args: [liquidationOperationId],
		})
		assert.strictEqual(stagedOperation[1], zeroAddress, 'PoC confirms stale target-controlled liquidation failure was consumed')
	})
})
