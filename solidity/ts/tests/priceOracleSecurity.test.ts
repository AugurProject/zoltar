import { beforeEach, describe, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, encodeFunctionData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import {
	calculateOracleMinimumWethReportAttoEth,
	DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
	DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
	ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
	ORACLE_REPORT_GAS,
	ORACLE_FEE_PERCENTAGE,
	ORACLE_PROTOCOL_FEE,
} from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { manipulatePriceOracle } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { deployContract } from '../testSupport/deployContract'
import { formatStorageSlot, getUintMappingStorageSlot } from '../testSupport/storage'
import { type AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { type WriteClient, createWriteClient } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import assert from '../testSupport/simulator/utils/assert'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveToken, getERC20Balance, getETHBalance } from '../testSupport/simulator/utils/utilities'
import {
	getDefaultInitialReportPrice,
	fundCoordinatorInitialReport,
	getPendingReportId,
	getRequestPriceCostAttoEth,
	getOpenOracleReportMeta,
	getOpenOracleReportStatus,
	loadOpenOracleEventState,
	openOracleSettle,
	requestPrice,
	openOracleSettleWithGasPrice,
	requestPriceWithValue,
	recoverSettledPendingReport,
	getLastPrice,
	getPendingReportMaxSettlementBaseFee,
	getIsPriceValid,
	wrapWeth,
} from '../testSupport/simulator/utils/contracts/statoblast'
import {
	statoblast_SharedPoolReportEscrow_SharedPoolReportEscrow as escrowArtifact,
	ReputationToken_ReputationToken,
	statoblast_WETH9_WETH9,
	test_statoblast_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as rejectingEthReceiverArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_openOracle_OpenOracle_OpenOracle,
} from '../types/contractArtifact'
import { isIgnorableLogDecodeError } from './logDecodeErrors'
import { useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

type TransactionReceiptLogs = Awaited<ReturnType<WriteClient['waitForTransactionReceipt']>>['logs']
const OPEN_ORACLE_GAME_MAPPING_SLOT = 1n
const MAX_OPEN_ORACLE_REPORT_COUNT = (1n << 24n) - 1n
const findPendingReportRecoveredLog = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: feedArtifact.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.find(log => log?.eventName === 'PendingReportRecovered')

const findPriceReportedLog = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: feedArtifact.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.find(log => log?.eventName === 'PriceReported')

const findPriceReportRejectedLog = (logs: TransactionReceiptLogs) =>
	logs
		.map(log => {
			try {
				return decodeEventLog({
					abi: feedArtifact.abi,
					data: log.data,
					topics: log.topics,
				})
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				return undefined
			}
		})
		.find(log => log?.eventName === 'PriceReportRejected')

describe('Shared portfolio oracle security regressions', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	let client: WriteClient
	let mockWindow: AnvilWindowEthereum
	let priceOracle: `0x${string}`
	let priceFeed: `0x${string}`
	beforeEach(async () => {
		client = fixture.owner()
		mockWindow = fixture.base.mockWindow
		priceOracle = fixture.poolFor(fixture.base.questionId).openOraclePriceCoordinator
		priceFeed = await client.readContract({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: priceOracle, functionName: 'priceFeed' })
	})
	const escrowFor = async (reportId: bigint) => (await client.readContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'reportCandidates', args: [reportId] }))[0]
	const getOpenOracleHeldBalance = (holder: `0x${string}`, token: `0x${string}`) => client.readContract({ abi: statoblast_openOracle_OpenOracle_OpenOracle.abi, address: getInfraContractAddresses().openOracle, functionName: 'tokenHolder', args: [holder, token] })
	const executeThroughRejectingReceiver = async (receiver: Address, target: Address, data: Hex, value = 0n) => {
		const hash = await client.writeContract({
			abi: rejectingEthReceiverArtifact.abi,
			address: receiver,
			functionName: 'execute',
			args: [target, data],
			value,
		})
		await client.waitForTransactionReceipt({ hash })
	}

	const settlePendingReportWithFailedCallback = async (pendingReportId: bigint) => {
		const openOracle = getInfraContractAddresses().openOracle
		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
		const eventState = await loadOpenOracleEventState(client, pendingReportId)
		const overriddenPreimage: OpenOracleStatePreimage = {
			...eventState.latest,
			game: { ...eventState.latest.game, callbackGasLimit: 1n },
		}
		const gameSlot = getUintMappingStorageSlot(pendingReportId, OPEN_ORACLE_GAME_MAPPING_SLOT)
		await mockWindow.addStateOverrides({
			[openOracle]: {
				stateDiff: {
					[formatStorageSlot(gameSlot)]: BigInt(hashOpenOracleStatePreimage(overriddenPreimage)),
				},
			},
		})

		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await client.writeContract({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'settle',
			args: [pendingReportId, getOpenOracleGameTuple(overriddenPreimage.game), getOpenOracleHelperTuple(overriddenPreimage.helper)],
		})
	}

	test('oracle settlement rejects a final report that was uneconomic to dispute at its recorded base fee', async () => {
		const requestBaseFeeAttoEthPerGas = 1n * 10n ** 9n
		const finalReportBaseFeeAttoEthPerGas = 100n * 10n ** 9n
		const proposedRepPerEthPrice = 10n ** 18n
		const requestEthCost = 10n ** 18n
		const minimumWethReport = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeAttoEthPerGas: requestBaseFeeAttoEthPerGas,
		})
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const openOracle = getInfraContractAddresses().openOracle

		await wrapWeth(client, minimumWethReport)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		await wrapWeth(counterpartyClient, minimumWethReport * 4n)
		await approveToken(counterpartyClient, WETH_ADDRESS, openOracle)
		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${requestBaseFeeAttoEthPerGas.toString(16)}`],
		})
		const requestHash = await client.writeContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, 0n, requestEthCost],
			value: requestEthCost,
			gasPrice: requestBaseFeeAttoEthPerGas,
		})
		await client.waitForTransactionReceipt({ hash: requestHash })

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatus = await getOpenOracleReportStatus(client, reportId)
		const reportState = (await loadOpenOracleEventState(client, reportId)).latest
		const disputedAmount1 = (reportStatus.currentAmount1 * reportMeta.multiplier) / 100n
		const disputedAmount2 = reportStatus.currentAmount2
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${finalReportBaseFeeAttoEthPerGas.toString(16)}`],
		})
		const disputeHash = await counterpartyClient.writeContract({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'dispute',
			address: openOracle,
			args: [reportId, disputedAmount1, disputedAmount2, counterpartyClient.account.address, false, false, getOpenOracleGameTuple(reportState.game), getOpenOracleHelperTuple(reportState.helper), [0n, 0n, 0n, 0n]],
			gasPrice: finalReportBaseFeeAttoEthPerGas,
		})
		await counterpartyClient.waitForTransactionReceipt({ hash: disputeHash })
		const finalHistoryRecord = await client.readContract({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'disputeHistory',
			address: openOracle,
			args: [reportId, 1n],
		})
		assert.strictEqual(finalHistoryRecord[2], finalReportBaseFeeAttoEthPerGas, 'OpenOracle should record the final report block base fee')

		const finalReportStatus = await getOpenOracleReportStatus(client, reportId)
		await mockWindow.setTime(finalReportStatus.reportTimestamp + reportMeta.settlementTime - 1n)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${requestBaseFeeAttoEthPerGas.toString(16)}`],
		})
		const settlementHash = await openOracleSettleWithGasPrice(client, reportId, requestBaseFeeAttoEthPerGas)
		const settlementReceipt = await client.waitForTransactionReceipt({
			hash: settlementHash,
		})
		const rejectedLog = findPriceReportRejectedLog(settlementReceipt.logs)
		if (rejectedLog === undefined) throw new Error('missing PriceReportRejected log')
		assert.strictEqual(rejectedLog.args.reason, 'Report uneconomic')
		assert.strictEqual(findPriceReportedLog(settlementReceipt.logs), undefined, 'an uneconomic final dispute round must not publish a price')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'an uneconomic final dispute round must leave the price invalid')
	})

	test('oracle settlement reads the last of multiple dispute-history records', async () => {
		const baseFeeAttoEthPerGas = 1n * 10n ** 9n
		const finalDisputeBaseFeeAttoEthPerGas = 100n * 10n ** 9n
		const proposedRepPerEthPrice = 10n ** 18n
		const requestEthCost = 10n ** 18n
		const initialWethReport = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeAttoEthPerGas,
		})
		const counterpartyClient = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const openOracle = getInfraContractAddresses().openOracle

		await wrapWeth(client, initialWethReport * 2n)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		await wrapWeth(counterpartyClient, initialWethReport * 4n)
		await approveToken(counterpartyClient, WETH_ADDRESS, openOracle)
		await approveToken(counterpartyClient, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${baseFeeAttoEthPerGas.toString(16)}`],
		})
		const requestHash = await client.writeContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, 0n, requestEthCost],
			value: requestEthCost,
			gasPrice: baseFeeAttoEthPerGas,
		})
		await client.waitForTransactionReceipt({ hash: requestHash })

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		for (let disputeIndex = 1n; disputeIndex <= 2n; disputeIndex++) {
			const reportState = (await loadOpenOracleEventState(client, reportId)).latest
			const newAmount1 = (reportState.game.currentAmount1 * reportMeta.multiplier) / 100n
			const newAmount2 = (reportState.game.currentAmount2 * reportMeta.multiplier) / 100n
			const disputeBaseFeeAttoEthPerGas = disputeIndex === 2n ? finalDisputeBaseFeeAttoEthPerGas : baseFeeAttoEthPerGas
			await mockWindow.request({
				method: 'anvil_setNextBlockBaseFeePerGas',
				params: [`0x${disputeBaseFeeAttoEthPerGas.toString(16)}`],
			})
			const disputeHash = await counterpartyClient.writeContract({
				abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'dispute',
				address: openOracle,
				args: [reportId, newAmount1, newAmount2, counterpartyClient.account.address, false, false, getOpenOracleGameTuple(reportState.game), getOpenOracleHelperTuple(reportState.helper), [0n, 0n, 0n, 0n]],
				gasPrice: disputeBaseFeeAttoEthPerGas,
			})
			await counterpartyClient.waitForTransactionReceipt({ hash: disputeHash })
			const historyRecord = await client.readContract({
				abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'disputeHistory',
				address: openOracle,
				args: [reportId, disputeIndex],
			})
			assert.strictEqual(historyRecord[0], newAmount1, `history index ${disputeIndex} should preserve the disputed WETH amount`)
			assert.strictEqual(historyRecord[2], disputeBaseFeeAttoEthPerGas, `history index ${disputeIndex} should record its report-block base fee`)
		}

		const finalReportStatus = await getOpenOracleReportStatus(client, reportId)
		await mockWindow.setTime(finalReportStatus.reportTimestamp + reportMeta.settlementTime - 1n)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${baseFeeAttoEthPerGas.toString(16)}`],
		})
		const settlementHash = await openOracleSettleWithGasPrice(client, reportId, baseFeeAttoEthPerGas)
		const settlementReceipt = await client.waitForTransactionReceipt({
			hash: settlementHash,
		})
		const rejectedLog = findPriceReportRejectedLog(settlementReceipt.logs)
		if (rejectedLog === undefined) throw new Error('missing PriceReportRejected log')
		assert.strictEqual(rejectedLog.args.reason, 'Report uneconomic')
		assert.strictEqual(findPriceReportedLog(settlementReceipt.logs), undefined, 'the uniquely expensive final dispute record must drive settlement rejection')
	})

	test('oracle settlement rejects a saturated dispute-history counter', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		await requestPriceWithValue(client, priceOracle, costAttoEth)
		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const eventState = await loadOpenOracleEventState(client, reportId)
		const saturatedPreimage: OpenOracleStatePreimage = {
			...eventState.latest,
			game: {
				...eventState.latest.game,
				numReports: MAX_OPEN_ORACLE_REPORT_COUNT,
			},
		}
		const gameSlot = getUintMappingStorageSlot(reportId, OPEN_ORACLE_GAME_MAPPING_SLOT)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().openOracle]: {
				stateDiff: {
					[formatStorageSlot(gameSlot)]: BigInt(hashOpenOracleStatePreimage(saturatedPreimage)),
				},
			},
		})

		await mockWindow.advanceTime(reportMeta.settlementTime + 1n)
		const settlementHash = await client.writeContract({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			address: getInfraContractAddresses().openOracle,
			functionName: 'settle',
			args: [reportId, getOpenOracleGameTuple(saturatedPreimage.game), getOpenOracleHelperTuple(saturatedPreimage.helper)],
		})
		const settlementReceipt = await client.waitForTransactionReceipt({
			hash: settlementHash,
		})
		const rejectedLog = findPriceReportRejectedLog(settlementReceipt.logs)
		if (rejectedLog === undefined) throw new Error('missing PriceReportRejected log')
		assert.strictEqual(rejectedLog.args.reason, 'Counter saturated', 'saturation should be distinguishable from an uneconomic final report')
		assert.strictEqual(findPriceReportedLog(settlementReceipt.logs), undefined, 'a saturated history counter must not publish a price')
		assert.strictEqual(await getPendingReportId(client, priceOracle), 0n, 'saturated settlement should clear the pending report')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'saturated settlement must leave the cached price invalid')
	})

	test('failed OpenOracle settlement callbacks do not leave the coordinator permanently pending', async () => {
		await fixture.refreshPrice()
		const acceptedPrice = await getLastPrice(client, priceOracle)
		const acceptedTimestamp = await client.readContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'lastSettlementTimestamp' })
		const acceptedExpiry = await client.readContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'priceValidUntil' })
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		await requestPriceWithValue(client, priceOracle, costAttoEth, acceptedPrice * 2n)

		const pendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(pendingReportId > 0n, 'setup should leave a pending oracle report')
		const pendingState = (await loadOpenOracleEventState(client, pendingReportId)).latest
		const sponsorRepBalanceAfterRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const sponsorWethBalanceAttoEthAfterRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)

		await settlePendingReportWithFailedCallback(pendingReportId)

		const pendingReportIdAfterSettlement = await getPendingReportId(client, priceOracle)
		assert.strictEqual(pendingReportIdAfterSettlement, pendingReportId, 'failed callbacks should leave recovery work to the coordinator recovery function')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBalanceAfterRequest, 'failed callback settlement should not return REP before recovery')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBalanceAttoEthAfterRequest, 'failed callback settlement should not return WETH before recovery')
		assert.strictEqual(await getOpenOracleHeldBalance(await escrowFor(pendingReportId), addressString(GENESIS_REPUTATION_TOKEN)), pendingState.game.currentAmount2 + 1n, 'failed callback settlement should credit the coordinator REP balance')
		assert.strictEqual(await getOpenOracleHeldBalance(await escrowFor(pendingReportId), WETH_ADDRESS), pendingState.game.currentAmount1 + 1n, 'failed callback settlement should credit the coordinator WETH balance')

		const recoveryHash = await recoverSettledPendingReport(client, priceOracle)
		const recoveryReceipt = await client.waitForTransactionReceipt({
			hash: recoveryHash,
		})

		const pendingReportIdAfterRecovery = await getPendingReportId(client, priceOracle)
		const pendingMaxSettlementBaseFeeAfterRecovery = await getPendingReportMaxSettlementBaseFee(client, priceOracle)
		const lastPriceAfterRecovery = await getLastPrice(client, priceOracle)
		const lastSettlementTimestampAfterRecovery = await client.readContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(lastPriceAfterRecovery, acceptedPrice, 'recovering funding must not publish the failed candidate price')
		assert.strictEqual(lastSettlementTimestampAfterRecovery, acceptedTimestamp, 'recovery must not refresh the accepted observation')
		assert.strictEqual(await client.readContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'priceValidUntil' }), acceptedExpiry, 'recovery must not extend the accepted expiry')
		const recoveryLog = findPendingReportRecoveredLog(recoveryReceipt.logs)
		if (recoveryLog === undefined) throw new Error('missing PendingReportRecovered log')

		assert.strictEqual(pendingReportIdAfterRecovery, 0n, 'recovery should clear settled reports whose callback failed')
		assert.strictEqual(pendingMaxSettlementBaseFeeAfterRecovery, 0n, 'recovery should clear the stale basefee guard')
		assert.strictEqual(recoveryLog.args.reportId, pendingReportId, 'PendingReportRecovered should identify the recovered report')
		assert.strictEqual(recoveryLog.args.pendingReportId, pendingReportIdAfterRecovery, 'PendingReportRecovered should expose the cleared pending report id')
		assert.strictEqual(recoveryLog.args.pendingReportMaxSettlementBaseFeeAttoEthPerGas, pendingMaxSettlementBaseFeeAfterRecovery, 'PendingReportRecovered should expose the cleared basefee guard')
		assert.strictEqual(recoveryLog.args.lastPrice, lastPriceAfterRecovery, 'PendingReportRecovered should expose the unchanged last price')
		assert.strictEqual(recoveryLog.args.lastSettlementTimestamp, lastSettlementTimestampAfterRecovery, 'PendingReportRecovered should expose the unchanged settlement timestamp')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBalanceAfterRequest + pendingState.game.currentAmount2, 'recovery should return the settled REP amount to the sponsor')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBalanceAttoEthAfterRequest + pendingState.game.currentAmount1, 'recovery should return the settled WETH amount to the sponsor')
		assert.strictEqual(await getOpenOracleHeldBalance(await escrowFor(pendingReportId), addressString(GENESIS_REPUTATION_TOKEN)), 1n, 'recovery should drain the coordinator REP credit to its sentinel')
		assert.strictEqual(await getOpenOracleHeldBalance(await escrowFor(pendingReportId), WETH_ADDRESS), 1n, 'recovery should drain the coordinator WETH credit to its sentinel')

		await requestPriceWithValue(client, priceOracle, costAttoEth)
		const nextPendingReportId = await getPendingReportId(client, priceOracle)
		assert.ok(nextPendingReportId > pendingReportId, 'recovery should allow creating a fresh oracle report')
	})

	test('pending report recovery rejects unsettled reports', async () => {
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		await requestPriceWithValue(client, priceOracle, costAttoEth)

		await assert.rejects(recoverSettledPendingReport(client, priceOracle), /Report not settled/)
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
		const targetPriceErrorForDispute = await client.readContract({
			abi: sizingConfigurationAbi,
			functionName: 'targetPriceErrorForDispute',
			address: priceOracle,
			args: [],
		})
		const openOracleSecurityMultiplierBps = await client.readContract({
			abi: sizingConfigurationAbi,
			functionName: 'openOracleSecurityMultiplierBps',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(targetPriceErrorForDispute, 500000n, 'the initial target price error should be five percent')
		assert.strictEqual(openOracleSecurityMultiplierBps, 100000n, 'the initial Open Oracle Security multiplier should be ten times gas cost')

		const minimumToken1ReportAttoEth = await client.readContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			address: priceOracle,
			args: [],
		})

		assert.strictEqual(minimumToken1ReportAttoEth, calculateOracleMinimumWethReportAttoEth(), 'zero-basefee test chains should retain the configured priority-fee report')
		await requestPrice(client, priceOracle)

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		assert.strictEqual(reportMeta.exactToken1Report, minimumToken1ReportAttoEth, 'the request should snapshot the dynamic WETH requirement')
		assert.strictEqual(reportMeta.token1, WETH_ADDRESS, 'WETH should be the exact token1 report side')
		assert.strictEqual(reportMeta.token2.toLowerCase(), addressString(GENESIS_REPUTATION_TOKEN).toLowerCase(), 'REP should be the price-expressing token2 side')

		const baseFeeAttoEthPerGas = 30n * 10n ** 9n
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${baseFeeAttoEthPerGas.toString(16)}`],
		})
		await mockWindow.request({ method: 'evm_mine', params: [] })
		const sizedForBaseFee = await client.readContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			address: priceOracle,
			args: [],
		})
		assert.strictEqual(
			sizedForBaseFee,
			calculateOracleMinimumWethReportAttoEth({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				baseFeeAttoEthPerGas,
			}),
			'the on-chain WETH calculation should match the shared integer formula',
		)
	})

	test('caller can voluntarily fund initial WETH above the coordinator minimum', async () => {
		const proposedRepPerEthPrice = 10n ** 18n
		const requestedInitialAttoWeth = calculateOracleMinimumWethReportAttoEth() * 2n
		const requestPriceWithMinimumAbi = [
			{
				inputs: [
					{ name: 'proposedRepPerEthPrice', type: 'uint256' },
					{ name: 'requestedInitialAttoWeth', type: 'uint256' },
					{ name: 'bountyAttoEth', type: 'uint256' },
				],
				name: 'requestPrice',
				outputs: [],
				stateMutability: 'payable',
				type: 'function',
			},
		] as const

		await wrapWeth(client, requestedInitialAttoWeth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		const hash = await client.writeContract({
			abi: requestPriceWithMinimumAbi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, requestedInitialAttoWeth, await getRequestPriceCostAttoEth(client, priceOracle)],
			value: await getRequestPriceCostAttoEth(client, priceOracle),
		})
		await client.waitForTransactionReceipt({ hash })

		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatus = await getOpenOracleReportStatus(client, reportId)
		assert.strictEqual(reportMeta.exactToken1Report, requestedInitialAttoWeth, 'OpenOracle should require the larger caller-selected initial WETH amount')
		assert.strictEqual(reportMeta.escalationHalt, requestedInitialAttoWeth * 10n, 'the escalation halt should scale from the actual initial WETH amount')
		assert.strictEqual(reportStatus.currentAmount1, requestedInitialAttoWeth, 'the initial report should contain the caller-selected WETH amount')
		assert.strictEqual(reportStatus.currentAmount2, requestedInitialAttoWeth, 'the coordinator should derive matching REP from the selected WETH amount and proposed price')
	})

	test('coordinator settlement returns the undisputed report liquidity to the sponsor wallet', async () => {
		const proposedRepPerEthPrice = 10n ** 18n
		const requestedInitialAttoWeth = calculateOracleMinimumWethReportAttoEth() * 2n
		await wrapWeth(client, requestedInitialAttoWeth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		const wethBalanceAttoEthBeforeRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		const repBalanceBeforeRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		await requestPriceWithValue(client, priceOracle, await getRequestPriceCostAttoEth(client, priceOracle), proposedRepPerEthPrice, requestedInitialAttoWeth)
		const reportId = await getPendingReportId(client, priceOracle)
		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		const reportStatus = await getOpenOracleReportStatus(client, reportId)
		assert.strictEqual(reportStatus.currentReporter, await escrowFor(reportId), 'each report must own an isolated sponsor escrow')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), wethBalanceAttoEthBeforeRequest - requestedInitialAttoWeth, 'the pending report should hold the sponsored WETH')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), repBalanceBeforeRequest - requestedInitialAttoWeth, 'the pending report should hold the sponsored REP')

		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, reportId)
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), wethBalanceAttoEthBeforeRequest, 'settlement should return the coordinator reporter WETH to the sponsor')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), repBalanceBeforeRequest, 'settlement should return the coordinator reporter REP to the sponsor')
	})

	test('request-block WETH sizing preserves the submitted REP per ETH price after basefee moves', async () => {
		const requestBaseFeeAttoEthPerGas = 45n * 10n ** 9n
		const proposedRepPerEthPrice = 1000n * 10n ** 18n
		const maximumMinimumWethReport = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeAttoEthPerGas: requestBaseFeeAttoEthPerGas,
		})
		await wrapWeth(client, maximumMinimumWethReport)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${requestBaseFeeAttoEthPerGas.toString(16)}`],
		})
		await mockWindow.request({ method: 'evm_mine', params: [] })
		const requestMinimumWethReport = await client.readContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			address: priceOracle,
			args: [],
		})
		const requestHash = await client.writeContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, 0n, await getRequestPriceCostAttoEth(client, priceOracle)],
			value: (await getRequestPriceCostAttoEth(client, priceOracle)) + requestMinimumWethReport,
			gasPrice: requestBaseFeeAttoEthPerGas,
		})
		await client.waitForTransactionReceipt({ hash: requestHash })

		const reportStatus = await getOpenOracleReportStatus(client, await getPendingReportId(client, priceOracle))
		const expectedRepAmount = (reportStatus.currentAmount1 * proposedRepPerEthPrice + 10n ** 18n - 1n) / 10n ** 18n
		assert.strictEqual(reportStatus.currentAmount2, expectedRepAmount, 'the coordinator should derive REP from the proposed price and request-block WETH amount')
	})

	test('requestPrice should refund excess Ether when overpaid', async () => {
		// Test that overpayment is refunded, not kept by contract
		const initialBalance = await getETHBalance(client, client.account.address)
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)
		const overpayment = costAttoEth * 2n
		const minimumWethReport = await client.readContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			address: priceOracle,
			args: [],
		})

		// Call requestPrice with overpayment above the committed bounty
		await requestPriceWithValue(client, priceOracle, overpayment, undefined, 0n, costAttoEth)

		const finalBalance = await getETHBalance(client, client.account.address)

		// The helper wraps a 2x WETH execution buffer before requesting the report.
		// The unused WETH remains with the caller; any native ETH above the committed
		// bounty should still be refunded by the coordinator.
		const expectedEthDecrease = costAttoEth + minimumWethReport * 2n
		assert.strictEqual(initialBalance - finalBalance, expectedEthDecrease, `Caller should spend the ETH bounty plus the buffered WETH funding (${expectedEthDecrease}), but spent ${initialBalance - finalBalance}`)
	})

	test('Sepolia prices expire after one challenge period plus one hour of renewal slack', async () => {
		const originalChainId = await mockWindow.request({ method: 'eth_chainId' })
		try {
			await mockWindow.request({ method: 'anvil_setChainId', params: [11155111] })
			await manipulatePriceOracle(client, mockWindow, priceOracle)
			const settledAt = await client.readContract({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: priceOracle, functionName: 'lastSettlementTimestamp', args: [] })
			await mockWindow.setTime(settledAt + 480n + 3599n)
			assert.strictEqual(await getIsPriceValid(client, priceOracle), true)
			await mockWindow.setTime(settledAt + 480n + 3600n)
			assert.strictEqual(await getIsPriceValid(client, priceOracle), false)
		} finally {
			await mockWindow.request({ method: 'anvil_setChainId', params: [Number(originalChainId)] })
		}
	})

	test('cached prices expire exactly after one challenge period plus five minutes of renewal slack', async () => {
		await manipulatePriceOracle(client, mockWindow, priceOracle)
		const lastSettlementTimestamp = await client.readContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			address: priceOracle,
			functionName: 'lastSettlementTimestamp',
			args: [],
		})
		const priceValidityDeadline = lastSettlementTimestamp + 480n + 5n * 60n

		await mockWindow.setTime(priceValidityDeadline - 1n)
		assert.strictEqual(await getIsPriceValid(client, priceOracle), true, 'the cached price should remain valid one second before expiry')

		await mockWindow.setTime(priceValidityDeadline)
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'the cached price should become stale at the exact expiry timestamp')

		await mockWindow.setTime(priceValidityDeadline + 1n)
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'the cached price should remain stale after expiry')
	})

	test('oracle settlement distinguishes direct coordinator balances from OpenOracle beneficiary credits', async () => {
		const donor = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const donatedWeth = 3n * 10n ** 15n
		const donatedRep = 5n * 10n ** 18n
		const openOracleDonatedWeth = 2n * 10n ** 15n
		const openOracleDonatedRep = 4n * 10n ** 18n
		const openOracle = getInfraContractAddresses().openOracle
		await wrapWeth(donor, donatedWeth)
		const wethDonationHash = await donor.writeContract({
			abi: statoblast_WETH9_WETH9.abi,
			functionName: 'transfer',
			address: WETH_ADDRESS,
			args: [priceOracle, donatedWeth],
		})
		await donor.waitForTransactionReceipt({ hash: wethDonationHash })
		const repDonationHash = await donor.writeContract({
			abi: ReputationToken_ReputationToken.abi,
			functionName: 'transfer',
			address: addressString(GENESIS_REPUTATION_TOKEN),
			args: [priceOracle, donatedRep],
		})
		await donor.waitForTransactionReceipt({ hash: repDonationHash })

		const coordinatorWethSurplus = await getERC20Balance(client, WETH_ADDRESS, priceOracle)
		const coordinatorRepSurplus = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		assert.strictEqual(coordinatorWethSurplus, donatedWeth, 'the coordinator should hold the unsolicited WETH outside OpenOracle')
		assert.strictEqual(coordinatorRepSurplus, donatedRep, 'the coordinator should hold the unsolicited REP outside OpenOracle')

		const proposedRepPerEthPrice = 10n ** 18n
		const requestedInitialAttoWeth = calculateOracleMinimumWethReportAttoEth() * 2n
		await wrapWeth(client, requestedInitialAttoWeth)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)
		const sponsorWethBeforeRequest = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		const sponsorRepBeforeRequest = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		await requestPriceWithValue(client, priceOracle, await getRequestPriceCostAttoEth(client, priceOracle), proposedRepPerEthPrice, requestedInitialAttoWeth)
		const reportId = await getPendingReportId(client, priceOracle)
		const openOracleWethBeforeDonation = await getOpenOracleHeldBalance(await escrowFor(reportId), WETH_ADDRESS)
		const openOracleRepBeforeDonation = await getOpenOracleHeldBalance(await escrowFor(reportId), addressString(GENESIS_REPUTATION_TOKEN))
		assert.strictEqual(openOracleWethBeforeDonation, 1n, 'a pending report should leave only the coordinator WETH sentinel outside the game')
		assert.strictEqual(openOracleRepBeforeDonation, 1n, 'a pending report should leave only the coordinator REP sentinel outside the game')

		await wrapWeth(donor, openOracleDonatedWeth)
		await approveToken(donor, WETH_ADDRESS, openOracle)
		await approveToken(donor, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		for (const [token, amount] of [
			[WETH_ADDRESS, openOracleDonatedWeth],
			[addressString(GENESIS_REPUTATION_TOKEN), openOracleDonatedRep],
		] as const) {
			const depositHash = await donor.writeContract({
				abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'deposit',
				address: openOracle,
				args: [token, amount, await escrowFor(reportId)],
			})
			await donor.waitForTransactionReceipt({ hash: depositHash })
		}
		assert.strictEqual(await getOpenOracleHeldBalance(await escrowFor(reportId), WETH_ADDRESS), openOracleWethBeforeDonation + openOracleDonatedWeth, 'permissionless OpenOracle deposits should credit the coordinator beneficiary balance')
		assert.strictEqual(await getOpenOracleHeldBalance(await escrowFor(reportId), addressString(GENESIS_REPUTATION_TOKEN)), openOracleRepBeforeDonation + openOracleDonatedRep, 'permissionless OpenOracle REP deposits should credit the same coordinator beneficiary balance')

		const reportMeta = await getOpenOracleReportMeta(client, reportId)
		await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)
		await openOracleSettle(client, reportId)

		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, client.account.address), sponsorWethBeforeRequest + openOracleDonatedWeth, 'settlement should send the sponsor every withdrawable WETH credit held internally for the coordinator')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), sponsorRepBeforeRequest + openOracleDonatedRep, 'settlement should send the sponsor every withdrawable REP credit held internally for the coordinator')
		assert.strictEqual(await getOpenOracleHeldBalance(await escrowFor(reportId), WETH_ADDRESS), 1n, 'settlement should drain the coordinator OpenOracle WETH credit to its sentinel')
		assert.strictEqual(await getOpenOracleHeldBalance(await escrowFor(reportId), addressString(GENESIS_REPUTATION_TOKEN)), 1n, 'settlement should drain the coordinator OpenOracle REP credit to its sentinel')
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, priceOracle), coordinatorWethSurplus, 'settlement must not sweep unsolicited coordinator WETH into sponsor proceeds')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle), coordinatorRepSurplus, 'settlement must not sweep unsolicited coordinator REP into sponsor proceeds')
	})

	test('rejecting sponsors roll back bounty refunds, report creation, and token funding', async () => {
		const coordinatorAbi = statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi
		const receiver = await deployContract(
			client,
			encodeDeployData({
				abi: rejectingEthReceiverArtifact.abi,
				bytecode: `0x${rejectingEthReceiverArtifact.evm.bytecode.object}`,
			}),
		)
		const oraclePricePrecision = 10n ** 18n
		const proposedRepPerEthPrice = 1n
		const minimumInitialWeth = await client.readContract({
			abi: coordinatorAbi,
			address: priceOracle,
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		const initialWethReport = minimumInitialWeth + oraclePricePrecision
		const initialRepReport = (initialWethReport * proposedRepPerEthPrice + oraclePricePrecision - 1n) / oraclePricePrecision
		const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracle)

		await executeThroughRejectingReceiver(
			receiver,
			WETH_ADDRESS,
			encodeFunctionData({
				abi: statoblast_WETH9_WETH9.abi,
				functionName: 'deposit',
				args: [],
			}),
			initialWethReport,
		)
		const repTransferHash = await client.writeContract({
			abi: ReputationToken_ReputationToken.abi,
			address: addressString(GENESIS_REPUTATION_TOKEN),
			functionName: 'transfer',
			args: [receiver, initialRepReport],
		})
		await client.waitForTransactionReceipt({ hash: repTransferHash })
		await executeThroughRejectingReceiver(
			receiver,
			WETH_ADDRESS,
			encodeFunctionData({
				abi: statoblast_WETH9_WETH9.abi,
				functionName: 'approve',
				args: [priceOracle, initialWethReport],
			}),
		)
		await executeThroughRejectingReceiver(
			receiver,
			addressString(GENESIS_REPUTATION_TOKEN),
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'approve',
				args: [priceOracle, initialRepReport],
			}),
		)

		const nextReportIdBefore = await client.readContract({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			address: getInfraContractAddresses().openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		const wethBefore = await getERC20Balance(client, WETH_ADDRESS, receiver)
		const repBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), receiver)
		await assert.rejects(
			executeThroughRejectingReceiver(
				receiver,
				priceOracle,
				encodeFunctionData({
					abi: coordinatorAbi,
					functionName: 'requestPrice',
					args: [proposedRepPerEthPrice, initialWethReport, costAttoEth],
				}),
				costAttoEth + 1n,
			),
			/Oracle coordinator failed to refund excess ETH bounty/,
		)
		assert.strictEqual(await getPendingReportId(client, priceOracle), 0n, 'failed direct refund must roll back the pending report')
		assert.strictEqual(
			await client.readContract({
				abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
				address: getInfraContractAddresses().openOracle,
				functionName: 'nextReportId',
				args: [],
			}),
			nextReportIdBefore,
			'failed direct refund must roll back OpenOracle report creation',
		)
		assert.strictEqual(await getERC20Balance(client, WETH_ADDRESS, receiver), wethBefore, 'failed direct refund must restore sponsor WETH')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), receiver), repBefore, 'failed direct refund must restore sponsor REP')
	})
	test('oracle settlement accepts the exact nonzero basefee cap and rejects one attoETH above it', async () => {
		const requestBaseFeeAttoEthPerGas = 1n * 10n ** 9n
		const expectedSettlementBaseFeeCap = ((requestBaseFeeAttoEthPerGas + DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) * ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS) / 10000n
		const minimumWethReport = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeAttoEthPerGas: requestBaseFeeAttoEthPerGas,
		})
		const callbackGasLimit = await client.readContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'getSettlementCallbackGasLimit' })
		const requestEthCost = requestBaseFeeAttoEthPerGas * 4n * (callbackGasLimit + ORACLE_REPORT_GAS) + 101n
		const proposedRepPerEthPrice = 10n ** 18n

		await wrapWeth(client, minimumWethReport * 2n)
		await approveToken(client, WETH_ADDRESS, priceOracle)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), priceOracle)

		const requestAtConfiguredBaseFee = async () => {
			await mockWindow.request({
				method: 'anvil_setNextBlockBaseFeePerGas',
				params: [`0x${requestBaseFeeAttoEthPerGas.toString(16)}`],
			})
			const requestHash = await client.writeContract({
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'requestPrice',
				address: priceOracle,
				args: [proposedRepPerEthPrice, 0n, requestEthCost],
				value: requestEthCost,
				gasPrice: requestBaseFeeAttoEthPerGas,
			})
			await client.waitForTransactionReceipt({ hash: requestHash })
			const reportId = await getPendingReportId(client, priceOracle)
			assert.ok(reportId > 0n, 'nonzero-basefee request should create a pending report')
			assert.strictEqual(await getPendingReportMaxSettlementBaseFee(client, priceOracle), expectedSettlementBaseFeeCap, 'request should snapshot the configured nonzero settlement basefee cap')
			return reportId
		}

		const acceptedReportId = await requestAtConfiguredBaseFee()
		const acceptedReportMeta = await getOpenOracleReportMeta(client, acceptedReportId)
		const initialHistoryRecord = await client.readContract({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'disputeHistory',
			address: getInfraContractAddresses().openOracle,
			args: [acceptedReportId, 0n],
		})
		assert.strictEqual(initialHistoryRecord[0], minimumWethReport, 'the initial report should equal the final-history economic floor')
		assert.strictEqual(initialHistoryRecord[2], requestBaseFeeAttoEthPerGas, 'the exact-floor check should use the initial report block base fee')
		await mockWindow.advanceTime(BigInt(acceptedReportMeta.settlementTime) + 1n)
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${expectedSettlementBaseFeeCap.toString(16)}`],
		})
		const acceptedHash = await openOracleSettleWithGasPrice(client, acceptedReportId, expectedSettlementBaseFeeCap)
		const acceptedReceipt = await client.waitForTransactionReceipt({
			hash: acceptedHash,
		})
		assert.strictEqual(findPriceReportRejectedLog(acceptedReceipt.logs), undefined, 'settlement at the exact basefee cap should not be rejected')
		assert.ok(findPriceReportedLog(acceptedReceipt.logs) !== undefined, 'settlement at the exact basefee cap should report the accepted price')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), true, 'settlement at the exact basefee cap should validate the price')

		await mockWindow.setNextBlockBaseFeePerGasToZero()
		await mockWindow.advanceTime(480n + 5n * 60n + 1n)
		const rejectedReportId = await requestAtConfiguredBaseFee()
		const rejectedReportMeta = await getOpenOracleReportMeta(client, rejectedReportId)
		await mockWindow.advanceTime(BigInt(rejectedReportMeta.settlementTime) + 1n)
		const rejectedSettlementBaseFee = expectedSettlementBaseFeeCap + 1n
		await mockWindow.request({
			method: 'anvil_setNextBlockBaseFeePerGas',
			params: [`0x${rejectedSettlementBaseFee.toString(16)}`],
		})
		const rejectedHash = await openOracleSettleWithGasPrice(client, rejectedReportId, rejectedSettlementBaseFee)
		const rejectedReceipt = await client.waitForTransactionReceipt({
			hash: rejectedHash,
		})
		const rejectedLog = findPriceReportRejectedLog(rejectedReceipt.logs)
		if (rejectedLog === undefined) throw new Error('missing PriceReportRejected log')
		assert.strictEqual(findPriceReportedLog(rejectedReceipt.logs), undefined, 'settlement one attoETH above the basefee cap must not report a price')
		assert.strictEqual(rejectedLog.args.reason, 'Base fee too high', 'settlement one attoETH above the cap should expose the basefee rejection reason')
		assert.strictEqual(await getIsPriceValid(client, priceOracle), false, 'settlement one attoETH above the basefee cap must leave the stale price invalid')
	})

	test('report flags and fixed callback budget match the shared-feed settlement contract', async () => {
		await requestPrice(client, priceOracle)
		const report = (await loadOpenOracleEventState(client, await getPendingReportId(client, priceOracle))).latest.game
		assert.strictEqual(report.flags, 7n, 'timestamp clock, dispute history, and stored game are mandatory')
		assert.strictEqual(report.callbackGasLimit, 4_000_000n, 'callback work is bounded independently of queued user actions')
		assert.strictEqual(report.feePercentage, BigInt(ORACLE_FEE_PERCENTAGE))
		assert.strictEqual(report.protocolFee, BigInt(ORACLE_PROTOCOL_FEE))
	})

	test('adapter setup rejects repeated and unauthorized binding without changing the canonical feed', async () => {
		const target = { abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: priceOracle }
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		await assert.rejects(client.writeContract({ ...target, functionName: 'setSecurityPool', args: [pool] }), /Security pool already set/)
		await assert.rejects(client.writeContract({ ...target, functionName: 'setSharedPriceFeed', args: [priceFeed] }), /Shared feed setup invalid/)
		await assert.rejects(client.writeContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'registerCoordinator', args: [priceOracle] }), /Only security pool factory/)
		assert.strictEqual(await client.readContract({ ...target, functionName: 'securityPool' }), pool)
		assert.strictEqual(await client.readContract({ ...target, functionName: 'priceFeed' }), priceFeed)
	})

	test('funding, report widths, and forged callbacks fail atomically while concurrent candidates remain available', async () => {
		const target = { abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: priceOracle }
		const cost = await getRequestPriceCostAttoEth(client, priceOracle)
		const direct = { abi: feedArtifact.abi, address: priceFeed }
		const minimum = await client.readContract({ ...direct, functionName: 'minimumToken1ReportAttoEth' })
		const nextId = () => client.readContract({ abi: statoblast_openOracle_OpenOracle_OpenOracle.abi, address: getInfraContractAddresses().openOracle, functionName: 'nextReportId' })
		const beforeId = await nextId()
		await assert.rejects(client.writeContract({ ...target, functionName: 'requestPrice', args: [1n, 0n, cost - 1n], value: cost - 1n }), /Oracle bounty too small/)
		await assert.rejects(client.writeContract({ ...target, functionName: 'requestPrice', args: [1n, 0n, cost], value: cost - 1n }), /Not enough ETH for oracle bounty/)
		await assert.rejects(client.writeContract({ ...direct, functionName: 'requestPortfolioPrice', args: [0n, 0n, cost], value: cost }), /Initial oracle price zero/)
		await assert.rejects(recoverSettledPendingReport(client, priceOracle), /No report to recover/)
		await assert.rejects(client.writeContract({ ...direct, functionName: 'requestPortfolioPrice', args: [1n, 1n << 128n, cost], value: cost }), /WETH report exceeds uint128/)
		await assert.rejects(client.writeContract({ ...direct, functionName: 'requestPortfolioPrice', args: [(1n << 128n) * 10n ** 18n, minimum, cost], value: cost }), /REP report exceeds uint128/)
		await assert.rejects(client.writeContract({ ...direct, functionName: 'requestPortfolioPrice', args: [1n, (1n << 128n) / 10n + 1n, cost], value: cost }), /Oracle escalation halt amount exceeds uint128 maximum/)
		assert.strictEqual(await nextId(), beforeId)
		assert.strictEqual(await getPendingReportId(client, priceOracle), 0n)
		await requestPrice(client, priceOracle)
		const firstId = await getPendingReportId(client, priceOracle)
		const escrow = await escrowFor(firstId)
		await assert.rejects(client.writeContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'settleReport', args: [firstId, 1n, 1n] }), /Wrong report escrow/)
		await assert.rejects(client.writeContract({ abi: escrowArtifact.abi, address: escrow, functionName: 'openOracleCallback', args: [firstId, 1n, 1n, 0n, priceOracle, priceOracle] }), /Wrong escrow report/)
		await mockWindow.impersonateAccount(getInfraContractAddresses().openOracle)
		const oracleClient = createWriteClient(mockWindow, BigInt(getInfraContractAddresses().openOracle))
		await assert.rejects(oracleClient.writeContract({ abi: escrowArtifact.abi, address: escrow, functionName: 'openOracleCallback', args: [firstId + 1n, 1n, 1n, 0n, priceOracle, priceOracle] }), /Wrong escrow report/)
		assert.strictEqual(await client.readContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'reportOutcome', args: [firstId] }), 0n)
		await requestPrice(client, priceOracle)
		assert.ok((await getPendingReportId(client, priceOracle)) > firstId, 'one pending report must not block other sponsors')
	})

	test('an overflowing bounty cannot create a report or consume sponsor funding', async () => {
		const bounty = 1n << 96n
		await mockWindow.setBalance(client.account.address, bounty * 2n)
		const nextId = await client.readContract({ abi: statoblast_openOracle_OpenOracle_OpenOracle.abi, address: getInfraContractAddresses().openOracle, functionName: 'nextReportId' })
		const minimum = await client.readContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'minimumToken1ReportAttoEth' })
		await assert.rejects(client.writeContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'requestPortfolioPrice', args: [10n ** 18n, minimum, bounty], value: bounty }), /Oracle settler reward exceeds uint96 maximum/)
		assert.strictEqual(await getPendingReportId(client, priceOracle), 0n)
		assert.strictEqual(await client.readContract({ abi: statoblast_openOracle_OpenOracle_OpenOracle.abi, address: getInfraContractAddresses().openOracle, functionName: 'nextReportId' }), nextId)
	})
	test('the coordinator retains the committed bounty and refunds only the ETH sent above it', async () => {
		const proposedRepPerEthPrice = await getDefaultInitialReportPrice(client, priceOracle)
		await fundCoordinatorInitialReport(client, priceOracle, proposedRepPerEthPrice)
		const bountyAttoEth = 101n + 5n * 10n ** 15n
		const excessAttoEth = 7n * 10n ** 15n
		const balanceBefore = await getETHBalance(client, client.account.address)

		const requestHash = await client.writeContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracle,
			args: [proposedRepPerEthPrice, 0n, bountyAttoEth],
			value: bountyAttoEth + excessAttoEth,
		})
		const requestReceipt = await client.waitForTransactionReceipt({ hash: requestHash })
		assert.strictEqual(requestReceipt.status, 'success', 'an overfunded request should succeed')

		const balanceAfter = await getETHBalance(client, client.account.address)
		if (requestReceipt.effectiveGasPrice === undefined) throw new Error('request receipt is missing its effective gas price')
		const gasAttoEth = requestReceipt.gasUsed * requestReceipt.effectiveGasPrice
		assert.strictEqual(balanceBefore - balanceAfter, bountyAttoEth + gasAttoEth, 'the sponsor should pay exactly the committed bounty plus gas and receive the excess back')
		const reportMeta = await getOpenOracleReportMeta(client, await getPendingReportId(client, priceOracle))
		assert.strictEqual(reportMeta.settlerRewardAttoEth, bountyAttoEth, 'the retained bounty should fund the settler reward without the refunded excess')
	})

	test('direct capital commitments increase the report floor without a per-question synchronization', async () => {
		const exposure = 100n * 10n ** 18n + 1n
		await fixture.prepare(1_000n * 10n ** 18n, exposure)
		const expected = calculateOracleMinimumWethReportAttoEth({ ...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, openInterestAttoEth: exposure })
		assert.strictEqual(await client.readContract({ abi: feedArtifact.abi, address: priceFeed, functionName: 'minimumToken1ReportAttoEth' }), expected)
		await requestPrice(client, priceOracle)
		const report = await getOpenOracleReportMeta(client, await getPendingReportId(client, priceOracle))
		assert.strictEqual(report.exactToken1Report, expected)
		assert.strictEqual(report.escalationHalt, expected * 10n)
	})
	test('a larger committed bounty rewards settlement without relaxing the report basefee safety cap', async () => {
		const bounty = 10n ** 18n
		await requestPriceWithValue(client, priceOracle, bounty)
		const id = await getPendingReportId(client, priceOracle)
		const report = await getOpenOracleReportMeta(client, id)
		assert.strictEqual(report.settlerRewardAttoEth, bounty)
		assert.strictEqual(await getPendingReportMaxSettlementBaseFee(client, priceOracle), (DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS * ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS) / 10_000n)
	})
})
