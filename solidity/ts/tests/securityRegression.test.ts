import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from 'node:assert/strict'
import { decodeEventLog, encodeAbiParameters, keccak256, zeroAddress } from 'viem'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { getEthRaiseCap, OperationType, requestPriceIfNeededAndStageOperation } from '../testsuite/simulator/utils/contracts/peripherals'
import { approveAndDepositRep, handleOracleReporting, manipulatePriceOracleAndPerformOperation, triggerOwnGameFork } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { depositRep, getRepToken, getSecurityVault, getTotalSecurityBondAllowance } from '../testsuite/simulator/utils/contracts/securityPool'
import { createChildUniverse, getSecurityPoolForkerForkData, migrateRepToZoltar } from '../testsuite/simulator/utils/contracts/securityPoolForker'
import { ensureZoltarDeployed, getTotalTheoreticalSupply } from '../testsuite/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { getChildUniverseId, getERC20Balance, setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import { peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory } from '../types/contractArtifact'
import { isIgnorableLogDecodeError } from './logDecodeErrors'

setDefaultTimeout(TEST_TIMEOUT_MS)

const genesisUniverse = 0n
const securityMultiplier = 2n
const maxRetentionRate = 999_999_996_848_000_000n
const repDeposit = 1000n * 10n ** 18n
const outcomes = ['Yes', 'No']

describe('security regression coverage', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let questionId: bigint
	let questionEndDate: bigint
	let securityPoolAddresses: ReturnType<typeof getSecurityPoolAddresses>

	const initializeBaseline = async () => {
		const mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)

		const now = await mockWindow.getTime()
		questionEndDate = now + 365n * DAY
		const questionData = {
			title: `audit-remediation-${now}`,
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
		return getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
	}

	test('child truth-auction address cannot be reserved by an untrusted caller', async () => {
		const yesUniverse = await prepareOwnForkToYes()
		const securityPoolSalt = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }], [securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier]))

		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.abi,
				address: getInfraContractAddresses().uniformPriceDualCapBatchAuctionFactory,
				functionName: 'deployUniformPriceDualCapBatchAuction',
				args: [getInfraContractAddresses().securityPoolForker, securityPoolSalt],
			}),
		)

		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesChild = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		assert.ok((await getEthRaiseCap(client, yesChild.truthAuction)) === 0n, 'legitimate child auction should deploy at its reserved address')
	})

	test('stale liquidation is consumed without executing after target state changes', async () => {
		const mockWindow = getAnvilWindowEthereum()
		await mockWindow.setTime(questionEndDate + 10n * DAY)
		const targetAllowance = repDeposit / 4n
		const forcedLiquidationPrice = 10n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, targetAllowance)

		const liquidator = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(liquidator, repDeposit * 10n, questionId)
		await mockWindow.advanceTime(2n * 60n * 60n)

		for (let index = 0; index < 4; index++) {
			await requestPriceIfNeededAndStageOperation(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, liquidator.account.address, BigInt(index + 1))
		}
		await requestPriceIfNeededAndStageOperation(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, targetAllowance)
		const liquidationOperationId = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
			functionName: 'stagedOperationCounter',
			args: [],
		})

		await handleOracleReporting(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedLiquidationPrice)
		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 0n)
		const staleExecutionHash = await writeContractAndWait(liquidator, () =>
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
		const stagedOperation = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			address: securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
			functionName: 'stagedOperations',
			args: [liquidationOperationId],
		})
		const staleExecutionReceipt = await liquidator.waitForTransactionReceipt({ hash: staleExecutionHash })
		const executionLog = staleExecutionReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ExecutedStagedOperation')
		if (executionLog === undefined) throw new Error('missing ExecutedStagedOperation event')

		assert.equal(targetVault.securityBondAllowance, 0n)
		assert.equal(liquidatorVault.securityBondAllowance, 0n)
		assert.equal(totalAllowance, 0n)
		assert.equal(stagedOperation[1], zeroAddress)
		assert.equal(executionLog.args.operationId, liquidationOperationId)
		assert.equal(executionLog.args.operation, OperationType.Liquidation)
		assert.equal(executionLog.args.success, false)
		assert.equal(executionLog.args.errorMessage, 'stale liquidation')
	})

	test('own-fork locks excess parent REP into the migration balance', async () => {
		const yesUniverse = await prepareOwnForkToYes()
		const migrationProxyAddress = await client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'getMigrationProxyAddress',
			args: [securityPoolAddresses.securityPool],
		})
		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		const parentRepBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), migrationProxyAddress)

		assert.equal(parentRepBalance, 0n)
		assert.ok(forkData.auctionableRepAtFork > 0n, 'own-fork migration balance should include non-burned parent REP')
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesChild = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		assert.ok((await getEthRaiseCap(client, yesChild.truthAuction)) === 0n, 'own-fork child auction should deploy normally')
	})
})
