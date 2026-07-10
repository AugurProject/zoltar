import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from '../testsuite/simulator/utils/assert'
import { decodeEventLog, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, type Address, zeroAddress } from '@zoltar/shared/ethereum'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { deployUniformPriceDualCapBatchAuction } from '../testsuite/simulator/utils/contracts/auction'
import { ORACLE_EXACT_TOKEN1_REPORT, deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { depositOnOutcome, deployEscalationGame, getEscalationGameOutcomeState } from '../testsuite/simulator/utils/contracts/escalationGame'
import { executeStagedOperation, getEthRaiseCap, getIsPriceValid, getRequestPriceEthCost, getStagedOperation, getStagedOperationCounter, OperationType, requestPriceIfNeededAndStageOperation, requestPriceIfNeededAndStageOperationWithInitialReportAmount2 } from '../testsuite/simulator/utils/contracts/peripherals'
import { approveAndDepositRep, handleOracleReporting, manipulatePriceOracleAndPerformOperation, triggerOwnGameFork } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { depositRep, depositToEscalationGame, getCompleteSetCollateralAmount, getRepToken, getSecurityVault, getTotalSecurityBondAllowance } from '../testsuite/simulator/utils/contracts/securityPool'
import { createChildUniverse, getMigratedRep, getOwnForkRepBuckets, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault } from '../testsuite/simulator/utils/contracts/securityPoolForker'
import { getScalarOutcomeIndex } from '../testsuite/simulator/utils/contracts/scalarOutcome'
import { ensureZoltarDeployed, forkUniverse, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress } from '../testsuite/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { approveToken, contractExists, getChildUniverseId, getERC20Balance, setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/clients'
import {
	peripherals_EscalationGame_EscalationGame,
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	peripherals_factories_ShareTokenFactory_ShareTokenFactory,
	peripherals_tokens_ShareToken_ShareToken,
	test_peripherals_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver,
} from '../types/contractArtifact'
import { isIgnorableLogDecodeError } from './logDecodeErrors'

setDefaultTimeout(TEST_TIMEOUT_MS)

const genesisUniverse = 0n
const securityMultiplier = 2n
const repDeposit = 1000n * 10n ** 18n
const initialEscalationGameDeposit = 1n * 10n ** 18n
const largeEscalationGameDeposit = 100n * 10n ** 18n
const outcomes = ['Yes', 'No']
const PRICE_PRECISION = 10n ** 18n

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
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier)
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

	const deployCompleteSetReentrantReceiver = async (securityPool: Address) => {
		const hash = await client.sendTransaction({
			data: encodeDeployData({
				abi: test_peripherals_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver.abi,
				bytecode: `0x${test_peripherals_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver.evm.bytecode.object}`,
				args: [securityPool],
			}),
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('reentrant receiver deployment missing address')
		return contractAddress
	}

	test('complete-set capacity is enforced across ERC1155 receiver reentrancy', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const capacity = 10n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, capacity)
		const receiver = await deployCompleteSetReentrantReceiver(securityPoolAddresses.securityPool)

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: test_peripherals_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver.abi,
					address: receiver,
					functionName: 'attack',
					args: [6n * 10n ** 18n, 6n * 10n ** 18n],
					value: 12n * 10n ** 18n,
				}),
			),
			/receiver rejected tokens/,
		)
		assert.equal(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n)
	})

	test('vault migration backs migrated child accounting even without prior branch REP migration', async () => {
		const mockWindow = getAnvilWindowEthereum()
		await mockWindow.setTime(questionEndDate + 10n * DAY)
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attacker, repDeposit, questionId)
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		const { vaultRepAtFork } = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)

		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChild = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const migratedRep = await getMigratedRep(client, yesChild.securityPool)
		const childPoolRepBalance = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesChild.securityPool)
		assert.ok(migratedRep > 0n, 'vault migration should credit migrated REP')
		assert.ok(childPoolRepBalance >= migratedRep, 'child pool REP must back migrated vault accounting')
		assert.ok(migratedRep < vaultRepAtFork, 'single-vault migration should leave remaining branch REP unsplit')

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		const toppedUpChildPoolRepBalance = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesChild.securityPool)
		assert.ok(toppedUpChildPoolRepBalance >= vaultRepAtFork, 'bulk migration should top up the remaining branch REP')

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		assert.equal(await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesChild.securityPool), toppedUpChildPoolRepBalance)
	})

	test('escalation deposits can fill final threshold dust below the start bond', async () => {
		const startBond = 10n * 10n ** 18n
		const nonDecisionThreshold = 25n * 10n ** 18n
		const escalationGame = await deployEscalationGame(client, startBond, nonDecisionThreshold)

		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.Yes, nonDecisionThreshold)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, nonDecisionThreshold - 1n)
		await depositOnOutcome(client, escalationGame, client.account.address, QuestionOutcome.No, startBond)

		const noState = await getEscalationGameOutcomeState(client, escalationGame, QuestionOutcome.No)
		const nonDecisionTimestamp = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGame,
			functionName: 'nonDecisionTimestamp',
		})
		assert.equal(noState.balance, nonDecisionThreshold)
		assert.ok(nonDecisionTimestamp > 0n, 'final dust fill should trigger non-decision')
	})

	test('external scalar Zoltar forks allow Placeholder REP migration to the scalar child branch', async () => {
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
		const scalarChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, scalarUniverse, questionId, securityMultiplier)
		assert.ok(await contractExists(client, scalarChildPool.securityPool), 'scalar child security pool should deploy')
	})

	test('child truth-auction address cannot be reserved by an untrusted caller', async () => {
		const yesUniverse = await prepareOwnForkToYes()
		const securityPoolSalt = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }], [securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier]))

		await deployUniformPriceDualCapBatchAuction(client, getInfraContractAddresses().securityPoolForker, securityPoolSalt)

		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesChild = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		assert.ok((await getEthRaiseCap(client, yesChild.truthAuction)) === 0n, 'legitimate child auction should deploy at its reserved address')
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
		const shareTokenSalt = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [securityMultiplier, squattedQuestionId]))
		const expectedAddresses = getSecurityPoolAddresses(zeroAddress, genesisUniverse, squattedQuestionId, securityMultiplier)
		const squatterShareTokenAddress = getCreate2Address({
			bytecode: encodeDeployData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				bytecode: `0x${peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
				args: [attacker.account.address, getZoltarAddress(), squattedQuestionId],
			}),
			from: getInfraContractAddresses().shareTokenFactory,
			salt: shareTokenSalt,
		})

		await createQuestion(client, squattedQuestionData, outcomes)
		await writeContractAndWait(attacker, () =>
			attacker.writeContract({
				abi: peripherals_factories_ShareTokenFactory_ShareTokenFactory.abi,
				address: getInfraContractAddresses().shareTokenFactory,
				functionName: 'deployShareToken',
				args: [shareTokenSalt, squattedQuestionId],
			}),
		)

		assert.notEqual(squatterShareTokenAddress, expectedAddresses.shareToken, 'direct callers should not share the canonical init code')
		assert.ok(await contractExists(client, squatterShareTokenAddress), 'untrusted caller should deploy only its own share token')
		assert.equal(await contractExists(client, expectedAddresses.shareToken), false, 'canonical share token address should remain available')

		await deployOriginSecurityPool(client, genesisUniverse, squattedQuestionId, securityMultiplier)
		assert.ok(await contractExists(client, expectedAddresses.securityPool), 'canonical origin security pool should deploy')
		assert.ok(await contractExists(client, expectedAddresses.shareToken), 'canonical origin share token should deploy')
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

		const forcedInitialReportAmount2 = (ORACLE_EXACT_TOKEN1_REPORT * PRICE_PRECISION) / forcedLiquidationPrice
		await requestPriceIfNeededAndStageOperationWithInitialReportAmount2(
			liquidator,
			securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
			OperationType.SetSecurityBondsAllowance,
			liquidator.account.address,
			1n,
			5n * 60n,
			forcedInitialReportAmount2 > 0n ? forcedInitialReportAmount2 : 1n,
			await getRequestPriceEthCost(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer),
		)
		for (let index = 1; index < 4; index++) {
			await requestPriceIfNeededAndStageOperation(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, liquidator.account.address, BigInt(index + 1))
		}
		await requestPriceIfNeededAndStageOperation(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, targetAllowance)
		const liquidationOperationId = await getStagedOperationCounter(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		await handleOracleReporting(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedLiquidationPrice, liquidator.account.address)
		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 0n)
		const staleExecutionHash = await executeStagedOperation(liquidator, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationOperationId)

		const targetVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const liquidatorVault = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidator.account.address)
		const totalAllowance = await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool)
		const stagedOperation = await getStagedOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, liquidationOperationId)
		const staleExecutionReceipt = await liquidator.waitForTransactionReceipt({ hash: staleExecutionHash })
		const executionLog = staleExecutionReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
		assert.equal(executionLog.args.operation, BigInt(OperationType.Liquidation))
		assert.equal(executionLog.args.success, false)
		assert.equal(executionLog.args.errorMessage, 'stale liquidation')
	})

	test('first escalation deposits reject stale oracle prices while bond allowance is active', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const securityBondAllowance = 100n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityBondAllowance)
		assert.equal(await getIsPriceValid(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), true)

		await mockWindow.setTime(questionEndDate + 1n)
		assert.equal(await getIsPriceValid(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), false)

		await assert.rejects(depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, initialEscalationGameDeposit), /Oracle price is stale/)
	})

	test('large escalation deposits reject stale oracle prices while bond allowance is active', async () => {
		const mockWindow = getAnvilWindowEthereum()
		const securityBondAllowance = 100n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityBondAllowance)
		assert.equal(await getIsPriceValid(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), true)

		await mockWindow.setTime(questionEndDate + 1n)
		assert.equal(await getIsPriceValid(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), false)

		await assert.rejects(depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, largeEscalationGameDeposit), /Oracle price is stale/)
	})
})
