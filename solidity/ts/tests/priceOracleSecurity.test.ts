import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { decodeEventLog, encodeAbiParameters, encodeDeployData, keccak256, type Address, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import {
	DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
	ORACLE_ABSOLUTE_INCLUSION_PREMIUM_WEI,
	ORACLE_ABSOLUTE_MINIMUM_WETH_REPORT,
	ORACLE_CANDIDATE_PROOF_WINDOW_BLOCKS,
	ORACLE_ECONOMIC_OPPORTUNITY_BLOCK_COUNT,
	ORACLE_GAS_UNITS_FOR_PRICE_FINALIZATION,
	ORACLE_MINIMUM_PRIORITY_FEE_WEI,
	ORACLE_MINIMUM_TOTAL_GAS_PRICE_WEI,
	calculateOracleMinimumWethReport,
} from '@zoltar/shared/oracleInitialReport'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, DAY, WETH_ADDRESS } from '../testSupport/simulator/utils/constants'
import { addressString, dateToBigintSeconds } from '../testSupport/simulator/utils/bigint'
import { approveToken, setupTestAccounts, getERC20Balance, getETHBalance } from '../testSupport/simulator/utils/utilities'
import { approveAndDepositRep } from '../testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { handleOracleReporting } from '../testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, applyLibraries, deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { createQuestion, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { ensureZoltarDeployed } from '../testSupport/simulator/utils/contracts/zoltar'
import {
	OperationType,
	executeStagedOperation,
	getActiveStagedOperationCount,
	getIsPriceValid,
	getOpenOracleReportMeta,
	getOpenOracleReportStatus,
	loadOpenOracleEventState,
	getPendingOperationSlotId,
	getPendingReportId,
	getPendingSettlementOperationCount,
	getRequestPriceEthCost,
	getStagedOperation,
	openOracleSettle,
	recoverSettledPendingReport,
	requestPrice,
	requestPriceIfNeededAndStageOperationWithInitialReportPrice,
	requestPriceIfNeededAndStageOperationWithValue,
	requestPriceWithValue,
	settleAndFinalizeCoordinatorPrice,
	wrapWeth,
} from '../testSupport/simulator/utils/contracts/peripherals'
import { depositRep, getSecurityVault } from '../testSupport/simulator/utils/contracts/securityPool'
import { peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory, peripherals_openOracle_OpenOracle_OpenOracle, peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const OPEN_ORACLE_GAME_MAPPING_SLOT = 1n

type OracleCoordinatorConstructorArgs = [Address, Address, Address, Address, bigint, number, bigint, bigint, bigint, number, number, number, number, number, boolean, boolean, Address, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
type OracleFactoryConstructorArgs = [Address, bigint, number, bigint, bigint, bigint, number, number, number, number, number, boolean, boolean, Address, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]

function encodeOracleCoordinatorDeployData(args: OracleCoordinatorConstructorArgs) {
	return encodeDeployData({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		bytecode: applyLibraries(peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.evm.bytecode.object),
		args,
	})
}

function encodeOracleFactoryDeployData(args: OracleCoordinatorConstructorArgs) {
	const factoryArgs: OracleFactoryConstructorArgs = [args[2], args[4], args[5], args[6], args[7], args[8], args[9], args[10], args[11], args[12], args[13], args[14], args[15], args[16], args[17], args[18], args[19], args[20], args[21], args[22], args[23], args[24], args[25]]
	return encodeDeployData({
		abi: peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.abi,
		bytecode: applyLibraries(peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object),
		args: factoryArgs,
	})
}

function formatStorageSlot(slot: bigint) {
	return `0x${slot.toString(16).padStart(64, '0')}`
}

function getMappingStorageSlot(key: bigint, mappingSlot: bigint) {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [key, mappingSlot])))
}

describe('Price Oracle Refund Security Tests', () => {
	const DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS = 5n * 60n
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const repDeposit = 1000n * 10n ** 18n
	const currentTimestamp = dateToBigintSeconds(new Date())
	const questionEndDate = currentTimestamp + 365n * DAY
	let priceOracle: Address
	let questionId: bigint
	const genesisUniverse = 0n
	const securityMultiplier = 2n
	const EXTRA_INFO = 'test question!'
	let securityPool: Address
	let candidateVerifier: Address
	const ORACLE_REPORT_GAS = 100000n
	const ORACLE_SETTLEMENT_GAS = 1000000
	const ORACLE_SETTLEMENT_TIME = 40 * 12
	const ORACLE_DISPUTE_DELAY = 0
	const ORACLE_PROTOCOL_FEE = 100000
	const ORACLE_FEE_PERCENTAGE = 10000
	const ORACLE_MULTIPLIER = 115
	const ORACLE_TIME_TYPE = true
	const ORACLE_TRACK_DISPUTES = true
	const ORACLE_ESCALATION_HALT_MULTIPLIER_BPS = 100000n
	const ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS = 1000n

	const getOracleCoordinatorConstructorArgs = (): OracleCoordinatorConstructorArgs => [
		getInfraContractAddresses().openOracle,
		addressString(GENESIS_REPUTATION_TOKEN),
		WETH_ADDRESS,
		candidateVerifier,
		ORACLE_REPORT_GAS,
		ORACLE_SETTLEMENT_GAS,
		ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
		ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
		OPEN_ORACLE_SECURITY_MULTIPLIER_BPS,
		ORACLE_SETTLEMENT_TIME,
		ORACLE_DISPUTE_DELAY,
		ORACLE_PROTOCOL_FEE,
		ORACLE_FEE_PERCENTAGE,
		ORACLE_MULTIPLIER,
		ORACLE_TIME_TYPE,
		ORACLE_TRACK_DISPUTES,
		zeroAddress,
		ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
		ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
		ORACLE_MINIMUM_TOTAL_GAS_PRICE_WEI,
		ORACLE_MINIMUM_PRIORITY_FEE_WEI,
		ORACLE_ABSOLUTE_INCLUSION_PREMIUM_WEI,
		ORACLE_ABSOLUTE_MINIMUM_WETH_REPORT,
		ORACLE_ECONOMIC_OPPORTUNITY_BLOCK_COUNT,
		ORACLE_CANDIDATE_PROOF_WINDOW_BLOCKS,
		ORACLE_GAS_UNITS_FOR_PRICE_FINALIZATION,
	]

	const deployContract = async (deploymentData: Hex): Promise<Address> => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (typeof contractAddress !== 'string') throw new Error('deployment address missing')
		return contractAddress
	}

	const settlePendingReportWithFailedCallback = async (pendingReportId: bigint) => {
		const openOracle = getInfraContractAddresses().openOracle
		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		const eventState = await loadOpenOracleEventState(client, pendingReportId)
		const overriddenPreimage: OpenOracleStatePreimage = {
			...eventState.latest,
			game: { ...eventState.latest.game, callbackGasLimit: 1n },
		}
		const gameSlot = getMappingStorageSlot(pendingReportId, OPEN_ORACLE_GAME_MAPPING_SLOT)
		await mockWindow.addStateOverrides({
			[openOracle]: {
				stateDiff: {
					[formatStorageSlot(gameSlot)]: BigInt(hashOpenOracleStatePreimage(overriddenPreimage)),
				},
			},
		})

		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		const settleHash = await client.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'settle',
			args: [pendingReportId, getOpenOracleGameTuple(overriddenPreimage.game), getOpenOracleHelperTuple(overriddenPreimage.helper)],
		})
		await client.waitForTransactionReceipt({ hash: settleHash })
	}

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		// Create the question on-chain first
		const questionData = {
			title: EXTRA_INFO,
			description: '',
			startTime: 0n,
			endTime: questionEndDate,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		await createQuestion(client, questionData, outcomes)
		questionId = getQuestionId(questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier)
		await approveAndDepositRep(client, repDeposit, questionId)
		const addresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
		priceOracle = addresses.priceOracleManagerAndOperatorQueuer
		securityPool = addresses.securityPool
		candidateVerifier = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'candidateVerifier',
			address: priceOracle,
			args: [],
		})
	})

	const settlePendingReportWithPrice = async (forceRepEthPriceTo: bigint) => {
		const pendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'Operation is not queued')
		assert.strictEqual(forceRepEthPriceTo, 10n ** 18n, 'test helper expects the coordinator default initial report price')
		const { settleReceipt } = await settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, pendingReportId)
		return { pendingReportId, settleReceipt }
	}

	test('OpenOracle settlement stages a candidate without activating its price', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, reportId)

		const candidateReportId = await client.readContract({
			abi: [
				{
					inputs: [],
					name: 'candidateReportId',
					outputs: [{ type: 'uint256' }],
					stateMutability: 'view',
					type: 'function',
				},
			] as const,
			address: priceOracle,
			functionName: 'candidateReportId',
			args: [],
		})
		assert.strictEqual(candidateReportId, reportId, 'the settled report should remain pending economic validation')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'settlement alone must not activate the report price')
	})

	test('authenticated final dispute-opportunity headers activate an economically backed candidate', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		assert.ok((await getETHBalance(client, priceOracle)) > 0n, 'the request should retain a finalizer reward')
		await settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, reportId)

		assert.strictEqual(await getIsPriceValid(client, priceOracle), true, 'the historical opportunity proof should activate the candidate')
		assert.strictEqual(await getETHBalance(client, priceOracle), 0n, 'successful finalization should pay the retained reward')
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'candidateReportId', address: priceOracle, args: [] }), 0n, 'the accepted candidate should be cleared')
	})

	test('authenticated high-basefee opportunity headers reject an underfunded candidate', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		assert.ok((await getETHBalance(client, priceOracle)) > 0n, 'the request should retain the outcome submitter reward')
		await settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, reportId, { opportunityBaseFees: [1000n * 10n ** 9n, 1000n * 10n ** 9n, 1000n * 10n ** 9n] })

		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'an underfunded report must remain unusable')
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'candidateReportId', address: priceOracle, args: [] }), 0n, 'a valid but economically insufficient proof should reject rather than strand the candidate')
		assert.strictEqual(await getETHBalance(client, priceOracle), 0n, 'the party proving an economic rejection should receive the prepaid outcome reward')
	})

	test('economically sufficient but stale proofs report expiry instead of insufficient economics', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		const { finalizeReceipt } = await settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, reportId, { delayBeforeFinalizeSeconds: 5n * 60n })
		const finalizedLog = finalizeReceipt.logs
			.filter(log => log.address.toLowerCase() === priceOracle.toLowerCase())
			.map(log => decodeEventLog({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, data: log.data, topics: log.topics }))
			.find(log => log.eventName === 'PriceCandidateFinalized')
		if (finalizedLog === undefined) throw new Error('Finalization did not emit its classified outcome')
		assert.strictEqual(finalizedLog.args.accepted, false)
		assert.strictEqual(finalizedLog.args.rejectionReason, 'Candidate price expired')
	})

	test('tampered execution header RLP cannot finalize a candidate', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		await assert.rejects(settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, reportId, { tamperFirstOpportunityHeader: true }), /does not contain a base fee/i)
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'candidateReportId', address: priceOracle, args: [] }), reportId)
	})

	test('non-consecutive canonical headers cannot finalize a candidate', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		await assert.rejects(settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, reportId, { duplicateFirstOpportunityHeader: true }), /opportunity headers are not consecutive/i)
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'candidateReportId', address: priceOracle, args: [] }), reportId, 'a malformed proof must leave the candidate available for a valid proof')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'a malformed proof must not activate the candidate')
	})

	test('canonical opportunity blocks without dispute gas capacity reject a candidate', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		await settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, reportId, { opportunityGasLimit: ORACLE_GAS_UNITS_FOR_ONE_DISPUTE - 1n })

		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'blocks unable to fit a dispute must not support an accepted price')
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'candidateReportId', address: priceOracle, args: [] }), 0n, 'a conclusive gas-capacity rejection should clear the candidate')
	})

	test('a canonical first closed header that was still contestable cannot finalize a candidate', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		await assert.rejects(settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, reportId, { closedHeaderStillOpen: true }), /closed header was still open to disputes/i)

		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'candidateReportId', address: priceOracle, args: [] }), reportId, 'an invalid closed-boundary proof must preserve the candidate')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'an invalid closed-boundary proof must not activate the candidate')
	})

	test('candidate finalization accepts the exact configured proof-window boundary', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		const reportState = await loadOpenOracleEventState(client, reportId)
		const finalizationBlock = reportState.latest.game.lastReportOppoTime + ORACLE_CANDIDATE_PROOF_WINDOW_BLOCKS
		await settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, reportId, { finalizeAtBlockNumber: finalizationBlock })

		assert.strictEqual(await getIsPriceValid(client, priceOracle), true, 'the exact proof-window boundary should remain finalizable')
	})

	test('candidate finalization rejects one block after the configured proof window', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		const reportState = await loadOpenOracleEventState(client, reportId)
		const lateFinalizationBlock = reportState.latest.game.lastReportOppoTime + ORACLE_CANDIDATE_PROOF_WINDOW_BLOCKS + 1n
		await assert.rejects(settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, reportId, { finalizeAtBlockNumber: lateFinalizationBlock }), /candidate proof window expired/i)

		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'candidateReportId', address: priceOracle, args: [] }), reportId, 'a late proof attempt must preserve the candidate for explicit expiry cleanup')
	})

	test('coordinator dynamically sizes the minimum WETH report side from the current base fee', async () => {
		const sizingConfigurationAbi = [
			{
				inputs: [],
				name: 'targetPriceErrorForDispute',
				outputs: [{ type: 'uint256' }],
				stateMutability: 'view',
				type: 'function',
			},
			{
				inputs: [],
				name: 'openOracleSecurityMultiplierBps',
				outputs: [{ type: 'uint256' }],
				stateMutability: 'view',
				type: 'function',
			},
		] as const
		const targetPriceErrorForDispute = await client.readContract({ abi: sizingConfigurationAbi, functionName: 'targetPriceErrorForDispute', address: priceOracle, args: [] })
		const openOracleSecurityMultiplierBps = await client.readContract({ abi: sizingConfigurationAbi, functionName: 'openOracleSecurityMultiplierBps', address: priceOracle, args: [] })
		assert.strictEqual(targetPriceErrorForDispute, 500000n, 'the initial target price error should be five percent')
		assert.strictEqual(openOracleSecurityMultiplierBps, 100000n, 'the initial Open Oracle Security multiplier should be ten times gas cost')

		const minimumToken1Report = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			address: priceOracle,
			args: [],
		})

		assert.strictEqual(minimumToken1Report, calculateOracleMinimumWethReport(), 'zero-basefee test chains should enforce configured gas-price and inclusion floors')
		await requestPrice(client, priceOracle)

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		assert.strictEqual(reportMeta.exactToken1Report, minimumToken1Report, 'the request should snapshot the dynamic WETH requirement')
		assert.strictEqual(reportMeta.token1, WETH_ADDRESS, 'WETH should be the exact token1 report side')
		assert.strictEqual(reportMeta.token2.toLowerCase(), addressString(GENESIS_REPUTATION_TOKEN).toLowerCase(), 'REP should be the price-expressing token2 side')

		const baseFeeWeiPerGas = 30n * 10n ** 9n
		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${baseFeeWeiPerGas.toString(16)}`] })
		await mockWindow.request({ method: 'evm_mine', params: [] })
		const sizedForBaseFee = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(sizedForBaseFee, calculateOracleMinimumWethReport({ ...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, baseFeeWeiPerGas }), 'the on-chain WETH calculation should match the shared integer formula')
	})

	test('caller can voluntarily fund initial WETH above the coordinator minimum', async () => {
		const proposedRepPerEthPrice = 10n ** 18n
		const requestedInitialWeth = 3n * 10n ** 18n
		const requestPriceWithMinimumAbi = [
			{
				inputs: [
					{ name: 'proposedRepPerEthPrice', type: 'uint256' },
					{ name: 'requestedInitialWeth', type: 'uint256' },
				],
				name: 'requestPrice',
				outputs: [],
				stateMutability: 'payable',
				type: 'function',
			},
		] as const

		await wrapWeth(client, requestedInitialWeth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		const hash = await client.writeContract({
			abi: requestPriceWithMinimumAbi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, requestedInitialWeth],
			value: await getRequestPriceEthCost(client, priceOracle),
		})
		await client.waitForTransactionReceipt({ hash })

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatus = await getOpenOracleReportStatus(client, reportId)
		assert.strictEqual(reportMeta.exactToken1Report, requestedInitialWeth, 'OpenOracle should require the larger caller-selected initial WETH amount')
		assert.strictEqual(reportMeta.escalationHalt, requestedInitialWeth * 10n, 'the escalation halt should scale from the actual initial WETH amount')
		assert.strictEqual(reportStatus.currentAmount1, requestedInitialWeth, 'the initial report should contain the caller-selected WETH amount')
		assert.strictEqual(reportStatus.currentAmount2, requestedInitialWeth, 'the coordinator should derive matching REP from the selected WETH amount and proposed price')
	})

	test('coordinator settlement returns the undisputed report liquidity to the sponsor wallet', async () => {
		const proposedRepPerEthPrice = 10n ** 18n
		const requestedInitialWeth = 3n * 10n ** 18n
		await wrapWeth(client, requestedInitialWeth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		const wethBalanceBeforeRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		const repBalanceBeforeRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		await requestPriceWithValue(client, priceOracle, await getRequestPriceEthCost(client, priceOracle), proposedRepPerEthPrice, requestedInitialWeth)
		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatus = await getOpenOracleReportStatus(client, reportId)
		assert.strictEqual(reportStatus.currentReporter, priceOracle, 'the coordinator should own the initial reporter position until settlement')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), wethBalanceBeforeRequest - requestedInitialWeth, 'the pending report should hold the sponsored WETH')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), repBalanceBeforeRequest - requestedInitialWeth, 'the pending report should hold the sponsored REP')

		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, reportId)
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), wethBalanceBeforeRequest, 'settlement should return the coordinator reporter WETH to the sponsor')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), repBalanceBeforeRequest, 'settlement should return the coordinator reporter REP to the sponsor')
	})

	test('request-block WETH sizing preserves the submitted REP per ETH price after basefee moves', async () => {
		const requestBaseFeeWeiPerGas = 45n * 10n ** 9n
		const proposedRepPerEthPrice = 1000n * 10n ** 18n
		const maximumMinimumWethReport = calculateOracleMinimumWethReport({ ...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, baseFeeWeiPerGas: requestBaseFeeWeiPerGas })
		await wrapWeth(client, maximumMinimumWethReport)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${requestBaseFeeWeiPerGas.toString(16)}`] })
		await mockWindow.request({ method: 'evm_mine', params: [] })
		const requestMinimumWethReport = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			address: priceOracle,
			args: [],
		})
		const requestHash = await client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, 0n],
			value: (await getRequestPriceEthCost(client, priceOracle)) + requestMinimumWethReport,
			gasPrice: requestBaseFeeWeiPerGas,
		})
		await client.waitForTransactionReceipt({ hash: requestHash })

		const reportStatus = await getOpenOracleReportStatus(client, await getPendingReportId(client, priceOracle))
		const expectedRepAmount = (reportStatus.currentAmount1 * proposedRepPerEthPrice + 10n ** 18n - 1n) / 10n ** 18n
		assert.strictEqual(reportStatus.currentAmount2, expectedRepAmount, 'the coordinator should derive REP from the proposed price and request-block WETH amount')
	})

	test('coordinator deployments can tune the target price error and Open Oracle Security multiplier', async () => {
		const tunedTargetPriceError = 1000000n
		const tunedOpenOracleSecurityMultiplierBps = 30000n
		const tunedArgs = getOracleCoordinatorConstructorArgs()
		tunedArgs[7] = tunedTargetPriceError
		tunedArgs[8] = tunedOpenOracleSecurityMultiplierBps
		const tunedCoordinator = await deployContract(encodeOracleCoordinatorDeployData(tunedArgs))

		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'targetPriceErrorForDispute', address: tunedCoordinator, args: [] }), tunedTargetPriceError)
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'openOracleSecurityMultiplierBps', address: tunedCoordinator, args: [] }), tunedOpenOracleSecurityMultiplierBps)

		const baseFeeWeiPerGas = 30n * 10n ** 9n
		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${baseFeeWeiPerGas.toString(16)}`] })
		await mockWindow.request({ method: 'evm_mine', params: [] })
		assert.strictEqual(
			await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'minimumToken1Report', address: tunedCoordinator, args: [] }),
			calculateOracleMinimumWethReport({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				baseFeeWeiPerGas,
				openOracleSecurityMultiplierBps: tunedOpenOracleSecurityMultiplierBps,
				targetPriceErrorForDispute: tunedTargetPriceError,
			}),
		)
	})

	test('coordinator factory reverts on duplicate direct CREATE2 deployment', async () => {
		const factory = await deployContract(encodeOracleFactoryDeployData(getOracleCoordinatorConstructorArgs()))
		const salt = keccak256('0x1234')
		const deploy = async () => {
			const hash = await client.writeContract({
				abi: peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.abi,
				address: factory,
				functionName: 'deployPriceOracleManagerAndOperatorQueuer',
				args: [getInfraContractAddresses().openOracle, addressString(GENESIS_REPUTATION_TOKEN), salt],
			})
			await client.waitForTransactionReceipt({ hash })
		}
		await deploy()
		await assert.rejects(deploy(), /coordinator deployment failed/i)
	})

	test('coordinator factory rejects unsafe oracle risk parameters', async () => {
		const buildArgsWithSizingParameters = (gasUnitsForOneDispute: bigint, targetPriceErrorForDispute: bigint, openOracleSecurityMultiplierBps: bigint, protocolFee: number, feePercentage: number): OracleCoordinatorConstructorArgs => {
			const args = getOracleCoordinatorConstructorArgs()
			args[6] = gasUnitsForOneDispute
			args[7] = targetPriceErrorForDispute
			args[8] = openOracleSecurityMultiplierBps
			args[11] = protocolFee
			args[12] = feePercentage
			return args
		}
		const buildArgsWithRiskParameters = (escalationHaltMultiplierBps: bigint, minLiquidationPriceDistanceBps: bigint): OracleCoordinatorConstructorArgs => {
			const args = getOracleCoordinatorConstructorArgs()
			args[17] = escalationHaltMultiplierBps
			args[18] = minLiquidationPriceDistanceBps
			return args
		}
		const buildArgsWithFinalizationParameter = (index: 14 | 21 | 23, value: boolean | bigint): OracleCoordinatorConstructorArgs => {
			const args = getOracleCoordinatorConstructorArgs()
			if (index === 14 && typeof value === 'boolean') args[index] = value
			else if ((index === 21 || index === 23) && typeof value === 'bigint') args[index] = value
			else throw new Error('invalid finalization test parameter')
			return args
		}
		const invalidRiskParameterCases: Array<{ args: OracleCoordinatorConstructorArgs; message: RegExp }> = [
			{
				args: buildArgsWithSizingParameters(0n, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /dispute gas units must be greater than zero/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, 9999n, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /open oracle security multiplier must be at least one hundred percent/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, 10000001n, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /target price error cannot exceed one hundred percent/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, 490000, 10000),
				message: /oracle fees must be below the target price error/i,
			},
			{
				args: buildArgsWithRiskParameters(0n, ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS),
				message: /escalation halt multiplier must be greater than zero/i,
			},
			{
				args: buildArgsWithRiskParameters(ORACLE_ESCALATION_HALT_MULTIPLIER_BPS, 10001n),
				message: /minimum liquidation price distance cannot exceed one hundred percent/i,
			},
			{
				args: buildArgsWithFinalizationParameter(14, false),
				message: /coordinator requires timestamp-based openoracle games/i,
			},
			{
				args: buildArgsWithFinalizationParameter(21, 0n),
				message: /absolute inclusion premium must be positive/i,
			},
			{
				args: buildArgsWithFinalizationParameter(23, 0n),
				message: /economic opportunity block count is invalid/i,
			},
		]

		for (const invalidCase of invalidRiskParameterCases) {
			await assert.rejects(async () => await deployContract(encodeOracleFactoryDeployData(invalidCase.args)), invalidCase.message)
		}
	})

	test('requestPrice should refund excess Ether when overpaid', async () => {
		// Test that overpayment is refunded, not kept by contract
		const initialBalance = await getETHBalance(client, client.account.address)
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const overpayment = ethCost * 2n
		const minimumWethReport = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			address: priceOracle,
			args: [],
		})

		// Call requestPrice with overpayment
		await requestPriceWithValue(client, priceOracle, overpayment)

		const finalBalance = await getETHBalance(client, client.account.address)

		// The helper wraps a 2x WETH execution buffer before requesting the report.
		// The unused WETH remains with the caller; any extra native ETH value should
		// still be refunded by the coordinator.
		const expectedEthDecrease = ethCost + minimumWethReport * 2n
		assert.strictEqual(initialBalance - finalBalance, expectedEthDecrease, `Caller should spend the ETH bounty plus the buffered WETH funding (${expectedEthDecrease}), but spent ${initialBalance - finalBalance}`)
	})

	test('requestPriceIfNeededAndStageOperation should not drain preexisting contract balance', async () => {
		// This test verifies that pre-existing ETH in the contract is not refunded to the caller
		// (drain vulnerability). It works even when price is invalid (so requestPrice is called internally).

		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const preBalance = ethCost * 3n // some arbitrary pre-existing balance

		// Use the abstracted method to set the contract's ETH balance
		await mockWindow.setBalance(priceOracle, preBalance)

		// Verify initial contract balance
		const balanceBefore = await getETHBalance(client, priceOracle)
		assert.strictEqual(balanceBefore, preBalance, 'Pre-set balance should be set correctly')

		// Call requestPriceIfNeededAndStageOperation with overpayment
		const caller = client.account.address
		const sendValue = ethCost * 2n
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.WithdrawRep, caller, 100n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, sendValue)

		// After the call, the pre-existing balance should remain intact.
		// The contract should have retained ethCost (to pay OpenOracle) and refunded the excess (sendValue - ethCost).
		// Final balance = preBalance (unchanged)
		const balanceAfter = await getETHBalance(client, priceOracle)
		const retainedFinalizerReward = await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'candidateFinalizerReward', address: priceOracle, args: [] })
		assert.strictEqual(balanceAfter, preBalance + retainedFinalizerReward, 'the coordinator should preserve its old balance and retain only the funded finalizer reward')
	})

	test('failed staged operations are consumed after price finalization and execution', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const impossibleAllowance = repDeposit * 10n

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, impossibleAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		const pendingOperationSlotId = await getPendingOperationSlotId(client, priceOracle)
		const stagedOperation = await getStagedOperation(client, priceOracle, 1n)

		assert.strictEqual(pendingOperationSlotId, 0n, 'failed attempted operations should clear the pending slot')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'failed staged operations should be consumed after their first execution attempt')
		assert.strictEqual(stagedOperation[3], impossibleAllowance, 'failed staged operations should retain their record for auditability')

		await assert.rejects(async () => await executeStagedOperation(client, priceOracle, 1n), /staged operation unavailable/i)
	})

	test('requestPrice rejects new requests while the cached price is still valid', async () => {
		await requestPrice(client, priceOracle)
		await settlePendingReportWithPrice(10n ** 18n)
		assert.strictEqual(await getIsPriceValid(client, priceOracle), true, 'test setup should seed a fresh cached oracle price')

		await assert.rejects(async () => await requestPrice(client, priceOracle), /fresh oracle price exists/i)
	})

	test('pending report recovery rejects unsettled reports', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		await requestPriceWithValue(client, priceOracle, ethCost)

		await assert.rejects(recoverSettledPendingReport(client, priceOracle), /ReportNotSettled|reverted/i)
	})

	test('failed callbacks recover into the same economically unvalidated candidate state', async () => {
		await requestPrice(client, priceOracle)
		const reportId = await getPendingReportId(client, priceOracle)
		await settlePendingReportWithFailedCallback(reportId)
		await recoverSettledPendingReport(client, priceOracle)

		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'candidateReportId', address: priceOracle, args: [] }), reportId, 'recovery should stage the finalized OpenOracle report for the same proof gate')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'recovery alone must not activate the price')
	})

	test('empty-vault withdrawals cannot occupy pending oracle settlement slots', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const ethCost = await getRequestPriceEthCost(attackerClient, priceOracle)

		await assert.rejects(async () => await requestPriceIfNeededAndStageOperationWithValue(attackerClient, priceOracle, OperationType.WithdrawRep, attackerClient.account.address, repDeposit, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost), /withdraw amount has no effect/i)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		const pendingSettlementOperationCount = await getPendingSettlementOperationCount(client, priceOracle)
		const activeStagedOperationCount = await getActiveStagedOperationCount(client, priceOracle)
		assert.strictEqual(pendingReportId, 0n, 'zero-effect withdrawal must not request an oracle report')
		assert.strictEqual(pendingSettlementOperationCount, 0n, 'zero-effect withdrawal must not occupy a pending settlement slot')
		assert.strictEqual(activeStagedOperationCount, 0n, 'zero-effect withdrawal must not remain staged')
	})

	test('over-requested withdrawals withdraw the actual available REP', async () => {
		const withdrawalClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const availableRep = repDeposit
		await approveAndDepositRep(withdrawalClient, availableRep, questionId)
		const ethCost = await getRequestPriceEthCost(withdrawalClient, priceOracle)

		const oversizedWithdrawal = availableRep * 10n
		await requestPriceIfNeededAndStageOperationWithValue(withdrawalClient, priceOracle, OperationType.WithdrawRep, withdrawalClient.account.address, oversizedWithdrawal, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await settlePendingReportWithPrice(10n ** 18n)
		await executeStagedOperation(client, priceOracle, 1n)

		const vaultAfterWithdrawal = await getSecurityVault(client, securityPool, withdrawalClient.account.address)
		assert.strictEqual(vaultAfterWithdrawal.repDepositShare, 0n, 'over-requested withdrawal should still withdraw the full vault balance')
	})

	test('liquidations too close to the threshold are rejected even when the oracle price is valid', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const targetAllowance = 75n * 10n ** 18n
		const liquidationAmount = 10n * 10n ** 18n
		const nearThresholdPrice = 7n * 10n ** 18n
		const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		await depositRep(liquidatorClient, securityPool, repDeposit)

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, targetAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		await mockWindow.advanceTime(DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS + 1n)

		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(liquidatorClient, priceOracle, OperationType.Liquidation, client.account.address, liquidationAmount, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, nearThresholdPrice, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, nearThresholdPrice)

		const targetVault = await getSecurityVault(client, securityPool, client.account.address)
		const liquidatorVault = await getSecurityVault(client, securityPool, liquidatorClient.account.address)
		const stagedOperation = await getStagedOperation(client, priceOracle, 2n)

		assert.strictEqual(targetVault.securityBondAllowance, targetAllowance, 'near-threshold liquidations must not reduce the target vault allowance')
		assert.strictEqual(liquidatorVault.securityBondAllowance, 0n, 'near-threshold liquidations must not move debt to the liquidator vault')
		assert.strictEqual(stagedOperation[1], zeroAddress, 'near-threshold liquidation attempts should be consumed as failed staged operations')
	})

	test('staged operations can only be executed once', async () => {
		const ethCost = await getRequestPriceEthCost(client, priceOracle)
		const successfulAllowance = repDeposit / 4n
		const operationId = 1n

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, successfulAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)

		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)

		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'exhausted operation capacity must make the price unusable for another vault operation')
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'isPriceValid', address: priceOracle, args: [] }), true, 'consuming operation security need not erase the fresh timestamp used by resolution checks')
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'availableWethExposure', address: priceOracle, args: [] }), 0n, 'a successful staged operation should consume WETH operation capacity')
		assert.strictEqual(await client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'availableRepExposure', address: priceOracle, args: [] }), 0n, 'a successful staged operation should consume REP operation capacity')
		await assert.rejects(async () => await executeStagedOperation(client, priceOracle, operationId), /staged operation unavailable/i)
	})

	test('staged operation exposure cannot exceed the accepted report correction profit', async () => {
		const proposedRepPerEthPrice = 10n ** 18n
		const minimumWethReport = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			address: priceOracle,
			args: [],
		})
		await wrapWeth(client, minimumWethReport)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		const requestHash = await client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPriceIfNeededAndStageOperation',
			address: priceOracle,
			args: [OperationType.SetSecurityBondsAllowance, client.account.address, minimumWethReport, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, proposedRepPerEthPrice, 0n],
			value: await getRequestPriceEthCost(client, priceOracle),
		})
		await client.waitForTransactionReceipt({ hash: requestHash })

		const reportId = await getPendingReportId(client, priceOracle)
		await settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, reportId)
		await executeStagedOperation(client, priceOracle, 1n)
		assert.strictEqual(await getIsPriceValid(client, priceOracle), true, 'a rejected oversized operation must not consume the accepted price')
		assert.strictEqual((await getStagedOperation(client, priceOracle, 1n))[1], zeroAddress, 'an oversized operation must be consumed so it cannot permanently block another report')
	})

	test('allowance exposure uses execution-time allowance after an earlier queued decrease', async () => {
		const highAllowance = 20n * 10n ** 18n
		const ethCost = await getRequestPriceEthCost(client, priceOracle)

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, highAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		assert.strictEqual((await getSecurityVault(client, securityPool, client.account.address)).securityBondAllowance, highAllowance)

		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, 0n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, ethCost)
		await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, OperationType.SetSecurityBondsAllowance, client.account.address, highAllowance, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n)
		await handleOracleReporting(client, mockWindow, priceOracle, 10n ** 18n)
		assert.strictEqual((await getSecurityVault(client, securityPool, client.account.address)).securityBondAllowance, 0n, 'the first queued operation should lower the allowance')

		await requestPrice(client, priceOracle)
		const replacementReportId = await getPendingReportId(client, priceOracle)
		await settleAndFinalizeCoordinatorPrice(client, mockWindow, priceOracle, replacementReportId)
		await executeStagedOperation(client, priceOracle, 3n)

		assert.strictEqual((await getSecurityVault(client, securityPool, client.account.address)).securityBondAllowance, 0n, 'the stale queued increase must be checked against the current allowance and rejected')
		assert.strictEqual((await getStagedOperation(client, priceOracle, 3n))[1], zeroAddress, 'the rejected stale increase should be consumed')
	})

	test('non-liquidation staged operations require the initiator vault as target', async () => {
		const otherVault = addressString(TEST_ADDRESSES[1])
		const nonLiquidationOperations = [OperationType.WithdrawRep, OperationType.SetSecurityBondsAllowance]

		for (const operation of nonLiquidationOperations) {
			await assert.rejects(async () => await requestPriceIfNeededAndStageOperationWithValue(client, priceOracle, operation, otherVault, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 0n), /self operation target mismatch/i)
		}
	})
})
