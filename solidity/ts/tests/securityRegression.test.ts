import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { decodeEventLog, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, type Address, zeroAddress } from '@zoltar/shared/ethereum'
import { QuestionOutcome } from '../testSupport/simulator/types/types'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { deployUniformPriceDualCapBatchAuction } from '../testSupport/simulator/utils/contracts/auction'
import { deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { depositOnOutcome, deployEscalationGame, getEscalationGameOutcomeState } from '../testSupport/simulator/utils/contracts/escalationGame'
import {
	executeStagedOperation,
	getEthRaiseCapAttoEth,
	getIsPriceValid,
	getRequestPriceCostAttoEth,
	getStagedOperation,
	getStagedOperationCounter,
	OperationType,
	requestPriceIfNeededAndStageOperation,
	requestPriceIfNeededAndStageOperationWithInitialReportPrice,
} from '../testSupport/simulator/utils/contracts/statoblast'
import { approveAndDepositRepToVault, handleOracleReporting, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation, triggerOwnGameFork } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { createCompleteSet, depositRepToVault, depositToEscalationGame, getSettlementCollateralAttoEth, getRepToken, getSecurityVault, getTotalCapacityOwnershipAttoRep } from '../testSupport/simulator/utils/contracts/securityPool'
import { createChildUniverse, getMigratedAttoRep, getOwnForkRepBuckets, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault } from '../testSupport/simulator/utils/contracts/securityPoolForker'
import { getScalarOutcomeIndex } from '../testSupport/simulator/utils/contracts/scalarOutcome'
import { ensureZoltarDeployed, forkUniverse, getRepTokenAddress, getTotalTheoreticalSupplyAttoRep, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { approveToken, contractExists, getChildUniverseId, getERC20Balance, setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import {
	statoblast_EscalationGame_EscalationGame,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_SecurityPool_SecurityPool,
	statoblast_factories_ShareTokenFactory_ShareTokenFactory,
	statoblast_tokens_ShareToken_ShareToken,
	test_statoblast_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver,
} from '../types/contractArtifact'
import { isIgnorableLogDecodeError } from './logDecodeErrors'

setDefaultTimeout(TEST_TIMEOUT_MS)

const genesisUniverse = 0n
const statoblastSecurityMultiplierBps = 20_000n
const repDeposit = 7000n * 10n ** 18n
const initialEscalationGameDepositAttoRep = 70n * 10n ** 18n
const largeEscalationGameDeposit = 100n * 10n ** 18n
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
		await deployOriginSecurityPool(client, genesisUniverse, questionId, statoblastSecurityMultiplierBps)
		await approveAndDepositRepToVault(client, repDeposit, questionId)
		securityPoolAddresses = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, statoblastSecurityMultiplierBps)
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
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, repToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
		await mockWindow.setTime(questionEndDate + 10n * DAY)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		return getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
	}

	const deployCompleteSetReentrantReceiver = async (securityPool: Address) => {
		const hash = await client.sendTransaction({
			data: encodeDeployData({
				abi: test_statoblast_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver.abi,
				bytecode: `0x${test_statoblast_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver.evm.bytecode.object}`,
				args: [securityPool],
			}),
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('reentrant receiver deployment missing address')
		return contractAddress
	}

	test('complete-set minting rejects an expired cached REP price', async () => {
		const mockWindow = getAnvilWindowEthereum()
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, 30n * 10n ** 18n)
		await mockWindow.advanceTime(5n * 60n)

		await assert.rejects(createCompleteSet(client, securityPoolAddresses.securityPool, 1n, true), /Stale price/)
	})

	test('nested complete-set checkpoints fold in callback log order', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const initialValue = 6n * 10n ** 18n
		const reentrantValue = 6n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, 30n * 10n ** 18n)
		const receiver = await deployCompleteSetReentrantReceiver(securityPoolAddresses.securityPool)
		assert.equal(
			await client.readContract({
				abi: statoblast_tokens_ShareToken_ShareToken.abi,
				address: securityPoolAddresses.shareToken,
				functionName: 'isAuthorized',
				args: [securityPoolAddresses.securityPool],
			}),
			true,
			'security pool must remain authorized to mint shares',
		)
		const attackHash = await writeContractAndWait(client, () =>
			client.writeContract({
				abi: test_statoblast_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver.abi,
				address: receiver,
				functionName: 'attack',
				args: [initialValue, reentrantValue],
				value: initialValue + reentrantValue,
				gas: 15_000_000n,
			}),
		)
		const attackReceipt = await client.waitForTransactionReceipt({ hash: attackHash })
		const completeSetLogs = attackReceipt.logs
			.filter(log => log.address.toLowerCase() === securityPoolAddresses.securityPool.toLowerCase())
			.map(log => {
				try {
					return decodeEventLog({
						abi: statoblast_SecurityPool_SecurityPool.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.filter(log => log?.eventName === 'CompleteSetCreated')
		assert.equal(completeSetLogs.length, 2)
		const outerLog = completeSetLogs[0]
		const nestedLog = completeSetLogs[1]
		if (outerLog?.eventName !== 'CompleteSetCreated' || nestedLog?.eventName !== 'CompleteSetCreated') {
			throw new Error('complete-set checkpoint missing')
		}
		assert.equal(outerLog.args.creator, receiver)
		assert.equal(outerLog.args.settlementCollateralProvidedAttoEth, initialValue)
		assert.equal(outerLog.args.resultingSettlementCollateralAttoEth, initialValue)
		assert.equal(nestedLog.args.creator, receiver)
		assert.equal(nestedLog.args.settlementCollateralProvidedAttoEth, reentrantValue)
		assert.equal(nestedLog.args.resultingSettlementCollateralAttoEth, initialValue + reentrantValue)
		assert.equal(nestedLog.args.resultingSettlementCollateralAttoEth, await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool))
	})

	test('complete-set capacity is enforced across ERC1155 receiver reentrancy', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const capacity = 20n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, capacity)
		const receiver = await deployCompleteSetReentrantReceiver(securityPoolAddresses.securityPool)
		const blockBeforeAttack = await client.getBlockNumber()

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_statoblast_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver.abi,
					address: receiver,
					functionName: 'attack',
					args: [6n * 10n ** 18n, 6n * 10n ** 18n],
					value: 12n * 10n ** 18n,
					gas: 15_000_000n,
				}),
			),
			/receiver rejected tokens/,
		)
		assert.equal(await getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool), 0n)
		assert.deepStrictEqual(
			await client.getLogs({
				address: securityPoolAddresses.securityPool,
				fromBlock: blockBeforeAttack + 1n,
			}),
			[],
			'reverted nested creation must not leave durable pool events',
		)
	})

	test('vault migration backs migrated child accounting even without prior branch REP migration', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(attacker, repDeposit, questionId)
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, repToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
		await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
		await mockWindow.setTime(questionEndDate + 10n * DAY)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, 0n)
		await manipulatePriceOracleAndPerformOperation(attacker, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, attacker.account.address, 0n)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		const { vaultRepAtForkAttoRep } = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)

		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChild = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		const migratedAttoRep = await getMigratedAttoRep(client, yesChild.securityPool)
		const childPoolRepBalance = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesChild.securityPool)
		assert.ok(migratedAttoRep > 0n, 'vault migration should credit migrated REP')
		assert.ok(childPoolRepBalance >= migratedAttoRep, 'child pool-held REP must back migrated vault accounting')
		assert.ok(migratedAttoRep < vaultRepAtForkAttoRep, 'single-vault migration should leave remaining branch REP unsplit')

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		const toppedUpChildPoolRepBalance = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesChild.securityPool)
		assert.ok(toppedUpChildPoolRepBalance >= vaultRepAtForkAttoRep, 'bulk migration should top up the remaining branch REP')

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		assert.equal(await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesChild.securityPool), toppedUpChildPoolRepBalance)
	})

	test('escalation deposits can fill final threshold dust below the start bond', async () => {
		const startBondAttoRep = 10n * 10n ** 18n
		const nonDecisionThresholdAttoRep = 25n * 10n ** 18n
		const escalationGame = await deployEscalationGame(client, startBondAttoRep, nonDecisionThresholdAttoRep)

		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, nonDecisionThresholdAttoRep)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, nonDecisionThresholdAttoRep - 1n)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, startBondAttoRep)

		const noState = await getEscalationGameOutcomeState(client, escalationGame, QuestionOutcome.No)
		const nonDecisionTimestamp = await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'nonDecisionTimestamp',
		})
		assert.equal(noState.balanceAttoRep, nonDecisionThresholdAttoRep)
		assert.ok(nonDecisionTimestamp > 0n, 'final dust fill should trigger non-decision')
	})

	test('external scalar Zoltar forks allow Statoblast REP migration to the scalar child branch', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const scalarQuestionData = {
			title: `external scalar fork ${await mockWindow.getTime()}`,
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 100n,
			displayValueMin: 0n,
			displayValueMax: 100n * 10n ** 18n,
			answerUnit: 'points',
		}
		await createQuestion(client, scalarQuestionData, [])
		const scalarQuestionId = getQuestionId(scalarQuestionData, [])
		const scalarOutcomeIndex = getScalarOutcomeIndex(scalarQuestionData, 42n)

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, scalarQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [scalarOutcomeIndex])
		await createChildUniverse(client, securityPoolAddresses.securityPool, scalarOutcomeIndex)
		const scalarUniverse = getChildUniverseId(genesisUniverse, scalarOutcomeIndex)
		const scalarChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, scalarUniverse, questionId, statoblastSecurityMultiplierBps)
		assert.ok(await contractExists(client, scalarChildPool.securityPool), 'scalar child security pool should deploy')
	})

	test('child truth-auction address cannot be reserved by an untrusted caller', async () => {
		const yesUniverse = await prepareOwnForkToYes()
		const securityPoolSalt = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }], [securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps]))

		await deployUniformPriceDualCapBatchAuction(client, getInfraContractAddresses().securityPoolForker, securityPoolSalt)

		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesChild = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, statoblastSecurityMultiplierBps)
		assert.ok((await getEthRaiseCapAttoEth(client, yesChild.truthAuction)) === 0n, 'legitimate child auction should deploy at its reserved address')
	})

	test('origin share-token address cannot be reserved by an untrusted caller', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const now = await mockWindow.getTime()
		const squattedQuestionData = {
			title: `share token salt squatting ${now}`,
			description: '',
			startTime: 0n,
			endTime: now + 365n * DAY,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const squattedQuestionId = getQuestionId(squattedQuestionData, outcomes)
		const shareTokenSalt = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint248' }], [squattedQuestionId, statoblastSecurityMultiplierBps, genesisUniverse]))
		const expectedAddresses = getSecurityPoolAddresses(zeroAddress, genesisUniverse, squattedQuestionId, statoblastSecurityMultiplierBps)
		const squatterShareTokenAddress = getCreate2Address({
			bytecode: encodeDeployData({
				abi: statoblast_tokens_ShareToken_ShareToken.abi,
				bytecode: `0x${statoblast_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
				args: [attacker.account.address, getZoltarAddress(), squattedQuestionId],
			}),
			from: getInfraContractAddresses().shareTokenFactory,
			salt: shareTokenSalt,
		})

		await createQuestion(client, squattedQuestionData, outcomes)
		await writeContractAndWait(attacker, () =>
			attacker.writeContract({
				abi: statoblast_factories_ShareTokenFactory_ShareTokenFactory.abi,
				address: getInfraContractAddresses().shareTokenFactory,
				functionName: 'deployShareToken',
				args: [shareTokenSalt, squattedQuestionId],
			}),
		)

		assert.notEqual(squatterShareTokenAddress, expectedAddresses.shareToken, 'direct callers should not share the canonical init code')
		assert.ok(await contractExists(client, squatterShareTokenAddress), 'untrusted caller should deploy only its own share token')
		assert.equal(await contractExists(client, expectedAddresses.shareToken), false, 'canonical share token address should remain available')

		await deployOriginSecurityPool(client, genesisUniverse, squattedQuestionId, statoblastSecurityMultiplierBps)
		assert.ok(await contractExists(client, expectedAddresses.securityPool), 'canonical origin security pool should deploy')
		assert.ok(await contractExists(client, expectedAddresses.shareToken), 'canonical origin share token should deploy')
	})

	test('stale liquidation is consumed without executing after target state changes', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const liquidator = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRepToVault(liquidator, repDeposit * 10n, questionId)
		await mockWindow.setTime(questionEndDate + 10n * DAY)
		const targetCapacityOwnershipAttoRep = repDeposit / 4n
		const forcedLiquidationPrice = 10n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, targetCapacityOwnershipAttoRep)

		await mockWindow.advanceTime(2n * 60n * 60n)

		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(
			liquidator,
			securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
			OperationType.WithdrawRep,
			liquidator.account.address,
			1n * 10n ** 18n,
			5n * 60n,
			forcedLiquidationPrice,
			await getRequestPriceCostAttoEth(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer),
		)
		for (let index = 1; index < 4; index++) {
			await requestPriceIfNeededAndStageOperation(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, liquidator.account.address, BigInt(index + 1) * 10n ** 18n)
		}
		await requestPriceIfNeededAndStageOperation(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, targetCapacityOwnershipAttoRep)
		const liquidationOperationId = await getStagedOperationCounter(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		await handleOracleReporting(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedLiquidationPrice)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, initialEscalationGameDepositAttoRep)
		const expectedTargetCapacityOwnershipAttoRep = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).capacityOwnershipAttoRep
		const expectedLiquidatorCapacityOwnershipAttoRep = (await getSecurityVault(client, securityPoolAddresses.securityPool, liquidator.account.address)).capacityOwnershipAttoRep
		const expectedTotalCapacityOwnershipAttoRep = await getTotalCapacityOwnershipAttoRep(client, securityPoolAddresses.securityPool)
		const staleExecutionHash = await executeStagedOperation(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationOperationId)

		const targetVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const liquidatorVault = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidator.account.address)
		const totalCapacityOwnershipAttoRep = await getTotalCapacityOwnershipAttoRep(client, securityPoolAddresses.securityPool)
		const stagedOperation = await getStagedOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationOperationId)
		const staleExecutionReceipt = await liquidator.waitForTransactionReceipt({ hash: staleExecutionHash })
		const executionLog = staleExecutionReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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

		assert.equal(targetVault.capacityOwnershipAttoRep, expectedTargetCapacityOwnershipAttoRep)
		assert.equal(liquidatorVault.capacityOwnershipAttoRep, expectedLiquidatorCapacityOwnershipAttoRep)
		assert.equal(totalCapacityOwnershipAttoRep, expectedTotalCapacityOwnershipAttoRep)
		assert.equal(stagedOperation[1], zeroAddress)
		assert.equal(executionLog.args.operationId, liquidationOperationId)
		assert.equal(executionLog.args.operation, BigInt(OperationType.Liquidation))
		assert.equal(executionLog.args.success, false)
		assert.equal(executionLog.args.errorMessage, 'stale liquidation')
	})

	test('first escalation deposits reject stale oracle prices while capacity ownership is active', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const capacityOwnershipAttoRep = 100n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, capacityOwnershipAttoRep)
		assert.equal(await getIsPriceValid(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), true)

		await mockWindow.setTime(questionEndDate + 1n)
		assert.equal(await getIsPriceValid(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), false)

		await assert.rejects(depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, initialEscalationGameDepositAttoRep), /Oracle price is stale|Stale price/)
	})

	test('large escalation deposits reject stale oracle prices while capacity ownership is active', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const capacityOwnershipAttoRep = 100n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.PriceRefresh, client.account.address, capacityOwnershipAttoRep)
		assert.equal(await getIsPriceValid(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), true)

		await mockWindow.setTime(questionEndDate + 1n)
		assert.equal(await getIsPriceValid(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), false)

		await assert.rejects(depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, largeEscalationGameDeposit), /Oracle price is stale|Stale price/)
	})
})
