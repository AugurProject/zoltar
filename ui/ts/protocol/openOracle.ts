import { decodeEventLog, getAddress, zeroAddress, type Address, type Hex, type TransactionReceipt } from '@zoltar/shared/ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hasOpenOracleFlag, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_STORE_PRICE, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_FLAG_TRACK_DISPUTES, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { ABIS } from '../abis.js'
import { sameAddress } from '../lib/address.js'
import { isIgnorableLogDecodeError } from '../lib/errors.js'
import { resolveOracleOperationEthFunding } from './oracleRequestFunding.js'
import { getOracleManagerPriceValidUntilTimestamp } from './oracleTiming.js'
import { addOpenOracleBountyBuffer, addOpenOracleInitialReportFundingBuffer } from './openOracleMath.js'
import { loadOpenOracleInitialReportPrice } from './openOraclePricing.js'
import { getOpenOracleCreateParameterValidationMessage } from './openOracleValidation.js'
import { decodeOracleQueueOperation, encodeOracleQueueOperation } from './oracleQueueOperation.js'
import { getWethAddress } from './uniswapQuoter.js'
import { peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, peripherals_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import type { OpenOracleActionResult, OpenOracleWithdrawableBalances, OracleManagerDetails, OracleQueueOperation, ReadClient, OpenOracleReportSummary, OpenOracleReportSummaryPage, StagedOracleExecutionResult, StagedOracleQueuedResult, WriteClient } from '../types/contracts.js'
import { getProtocolPageOffset, hasTimestampAndNumber, requireStagedOperationTupleArray } from './helpers.js'
import { type WriteContractClient, readRequiredMulticall, writeContractAndWait, writeContractAndWaitForReceipt } from './core.js'
import { getInfraContractAddresses, getOpenOracleAddress } from './deploymentHelpers.js'
import { loadOpenOracleEventState, loadOpenOracleEventStates } from './openOracleState.js'

type CoordinatorInitialReportClient = Parameters<typeof loadOpenOracleInitialReportPrice>[0]
const OPEN_ORACLE_PRICE_UNITS = 30n
const ACTIVE_STAGED_OPERATION_PREVIEW_LIMIT = 25n
const COORDINATOR_PRICE_PRECISION = 10n ** 18n
const OPEN_ORACLE_REPORT_MISSING_ERROR_NAME = 'OpenOracleReportMissingError'

export function createOpenOracleReportMissingError(reportId: bigint) {
	const error = new Error(`Oracle report #${reportId.toString()} does not exist`)
	error.name = OPEN_ORACLE_REPORT_MISSING_ERROR_NAME
	return error
}

export function isOpenOracleReportMissingError(error: unknown) {
	return error instanceof Error && error.name === OPEN_ORACLE_REPORT_MISSING_ERROR_NAME
}

function normalizeOpenOracleTokenMetadata(tokenAddress: Address, decimalsValue: unknown, symbolValue: unknown) {
	const decimals = Number(decimalsValue)
	const symbol = String(symbolValue).trim()
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error(`Token metadata for ${tokenAddress} returned invalid decimals`)
	if (symbol === '') throw new Error(`Token metadata for ${tokenAddress} returned an empty symbol`)
	if (sameAddress(tokenAddress, getWethAddress()) && (decimals !== 18 || symbol !== 'WETH')) throw new Error(`WETH metadata is invalid for ${tokenAddress}`)
	return { decimals, symbol }
}

function getStagedOracleExecutionResult(receipt: TransactionReceipt, managerAddress: Address, expectedOperation: OracleQueueOperation): StagedOracleExecutionResult | undefined {
	for (const log of receipt.logs) {
		if (!sameAddress(log.address, managerAddress)) continue
		try {
			const decodedLog = decodeEventLog({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decodedLog.eventName !== 'ExecutedStagedOperation') continue
			const operation = decodeOracleQueueOperation(BigInt(decodedLog.args.operation))
			if (operation !== expectedOperation) continue
			const errorMessage = decodedLog.args.errorMessage.trim() === '' ? undefined : decodedLog.args.errorMessage
			return {
				errorMessage,
				operation,
				operationId: decodedLog.args.operationId,
				success: decodedLog.args.success,
			} satisfies StagedOracleExecutionResult
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			continue
		}
	}
	return undefined
}

function getStagedOracleQueuedResult(receipt: TransactionReceipt, managerAddress: Address, expectedOperation: OracleQueueOperation): StagedOracleQueuedResult | undefined {
	for (const log of receipt.logs) {
		if (!sameAddress(log.address, managerAddress)) continue
		try {
			const decodedLog = decodeEventLog({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decodedLog.eventName !== 'StagedOperationQueued') continue
			const operation = decodeOracleQueueOperation(BigInt(decodedLog.args.operation))
			if (operation !== expectedOperation) continue
			return {
				isPendingSlot: decodedLog.args.isPendingSlot,
				operation,
				operationId: decodedLog.args.operationId,
			} satisfies StagedOracleQueuedResult
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			continue
		}
	}
	return undefined
}

function requireBigintValue(value: unknown, context: string) {
	if (typeof value === 'bigint') return value
	throw new Error(`Unexpected ${context} response`)
}

function requireBigintArray(value: unknown, context: string) {
	if (!Array.isArray(value)) throw new Error(`Unexpected ${context} response`)
	const result: bigint[] = []
	for (const item of value) {
		if (typeof item !== 'bigint') throw new Error(`Unexpected ${context} response`)
		result.push(item)
	}
	return result
}

export async function loadOracleManagerDetails(client: ReadClient, managerAddress: Address, openOracleAddress?: Address): Promise<OracleManagerDetails> {
	const [lastPrice, pendingOperationSlotId, pendingSettlementOperationIds, pendingSettlementQueueCapacity, pendingReportId, queuedOperationEthCost, requestPriceEthCost, rawIsPriceValid, lastSettlementTimestamp, activeStagedOperationCount] = await readRequiredMulticall(client, [
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastPrice',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'pendingOperationSlotId',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getPendingSettlementOperationIds',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'MAX_PENDING_SETTLEMENT_OPERATIONS',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'pendingReportId',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getQueuedOperationEthCost',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getRequestPriceEthCost',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'isPriceValid',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getActiveStagedOperationCount',
			address: managerAddress,
			args: [],
		},
	])
	const normalizedPendingSettlementOperationIds = requireBigintArray(pendingSettlementOperationIds, 'pending settlement operation ids')
	const normalizedPendingSettlementQueueCapacity = requireBigintValue(pendingSettlementQueueCapacity, 'pending settlement queue capacity')
	const normalizedQueuedOperationEthCost = requireBigintValue(queuedOperationEthCost, 'queued operation ETH cost')
	const normalizedRequestPriceEthCost = requireBigintValue(requestPriceEthCost, 'request price ETH cost')
	const resolvedOracleAddress = openOracleAddress ?? getInfraContractAddresses().openOracle
	let callbackStateHash: Hex | undefined
	let exactToken1Report: bigint | undefined
	let pendingOperation: import('../types/contracts.js').StagedOracleOperation | undefined
	let stagedOperations: import('../types/contracts.js').StagedOracleOperation[] = []
	let token1: Address | undefined
	let token2: Address | undefined
	if (activeStagedOperationCount > 0n) {
		const previewCount = activeStagedOperationCount < ACTIVE_STAGED_OPERATION_PREVIEW_LIMIT ? activeStagedOperationCount : ACTIVE_STAGED_OPERATION_PREVIEW_LIMIT
		const activeStagedOperationsResponse = await client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getActiveStagedOperations',
			address: managerAddress,
			args: [0n, previewCount],
		})
		if (!Array.isArray(activeStagedOperationsResponse) || activeStagedOperationsResponse.length !== 2) throw new Error('Unexpected active staged operations response')
		const [operationIdsRaw, activeOperationsRaw] = activeStagedOperationsResponse
		const operationIds = requireBigintArray(operationIdsRaw, 'active staged operation ids')
		const activeOperations = requireStagedOperationTupleArray(activeOperationsRaw, 'active staged operations')
		stagedOperations = operationIds
			.map((operationId: bigint, index: number) => {
				const stagedOperation = activeOperations[index]
				if (stagedOperation === undefined) throw new Error('Missing staged operation details')
				return {
					amount: stagedOperation.amount,
					initiatorVault: stagedOperation.initiatorVault,
					operation: decodeOracleQueueOperation(stagedOperation.operation),
					operationId,
					targetVault: stagedOperation.targetVault,
				}
			})
			.sort(compareStagedOperationIdsDescending)
		pendingOperation = stagedOperations.find(operation => operation.operationId === pendingOperationSlotId)
		if (pendingOperation === undefined && pendingOperationSlotId > 0n) {
			const stagedOperation = await client.readContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'getPendingOperationSlot',
				address: managerAddress,
				args: [],
			})
			if (stagedOperation.initiatorVault !== zeroAddress) {
				pendingOperation = {
					amount: stagedOperation.amount,
					initiatorVault: stagedOperation.initiatorVault,
					operation: decodeOracleQueueOperation(stagedOperation.operation),
					operationId: pendingOperationSlotId,
					targetVault: stagedOperation.targetVault,
				}
				if (!stagedOperations.some(operation => operation.operationId === pendingOperationSlotId)) {
					stagedOperations = [pendingOperation, ...stagedOperations].sort(compareStagedOperationIdsDescending)
				}
			}
		}
	}
	if (pendingReportId > 0n) {
		const eventState = await loadOpenOracleEventState(client, resolvedOracleAddress, pendingReportId)
		callbackStateHash = await client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'oracleGame',
			address: resolvedOracleAddress,
			args: [pendingReportId],
		})
		exactToken1Report = eventState.initial.game.currentAmount1
		token1 = eventState.latest.game.token1
		token2 = eventState.latest.game.token2
	}
	return {
		activeStagedOperationCount,
		callbackStateHash,
		exactToken1Report,
		isPriceValid: lastSettlementTimestamp > 0n && rawIsPriceValid,
		lastPrice,
		lastSettlementTimestamp,
		managerAddress,
		openOracleAddress: resolvedOracleAddress,
		pendingOperation,
		pendingOperationSlotId,
		pendingSettlementOperationIds: normalizedPendingSettlementOperationIds,
		pendingSettlementQueueCapacity: normalizedPendingSettlementQueueCapacity,
		pendingReportId,
		priceValidUntilTimestamp: getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp),
		queuedOperationEthCost: normalizedQueuedOperationEthCost,
		requestPriceEthCost: normalizedRequestPriceEthCost,
		stagedOperations,
		token1,
		token2,
	}
}
function compareStagedOperationIdsDescending(left: { operationId: bigint }, right: { operationId: bigint }) {
	if (left.operationId > right.operationId) return -1
	if (left.operationId < right.operationId) return 1
	return 0
}

function calculateOpenOraclePrice(amount1: bigint, amount2: bigint) {
	return amount2 === 0n ? 0n : (amount1 * 10n ** OPEN_ORACLE_PRICE_UNITS) / amount2
}

export async function loadOpenOracleReportDetails(client: ReadClient, openOracleAddress: Address, reportId: bigint): Promise<import('../types/contracts.js').OpenOracleReportDetails> {
	const [eventState, stateHash, block] = await Promise.all([
		loadOpenOracleEventState(client, openOracleAddress, reportId).catch(error => {
			if (error instanceof Error && error.message === `Oracle report #${reportId.toString()} does not exist`) throw createOpenOracleReportMissingError(reportId)
			throw error
		}),
		client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'oracleGame',
			address: openOracleAddress,
			args: [reportId],
		}),
		client.getBlock(),
	])
	if (!hasTimestampAndNumber(block)) throw new Error('Unexpected block response')
	const { game } = eventState.latest
	const initialGame = eventState.initial.game
	const expectedStateHash = hashOpenOracleStatePreimage(eventState.latest)
	if (stateHash.toLowerCase() !== expectedStateHash.toLowerCase()) throw new Error(`OpenOracle report #${reportId.toString()} event state does not match its on-chain state hash`)
	const [token1Decimals, token2Decimals, token1Symbol, token2Symbol] = await readRequiredMulticall(client, [
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'decimals',
			address: game.token1,
			args: [],
		},
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'decimals',
			address: game.token2,
			args: [],
		},
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'symbol',
			address: game.token1,
			args: [],
		},
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'symbol',
			address: game.token2,
			args: [],
		},
	])
	const token1Metadata = normalizeOpenOracleTokenMetadata(game.token1, token1Decimals, token1Symbol)
	const token2Metadata = normalizeOpenOracleTokenMetadata(game.token2, token2Decimals, token2Symbol)
	return {
		reportId,
		openOracleAddress,
		currentTime: block.timestamp,
		currentBlockNumber: block.number,
		exactToken1Report: initialGame.currentAmount1,
		escalationHalt: game.escalationHalt,
		fee: 0n,
		settlerReward: game.settlerReward,
		token1: game.token1,
		settlementTime: game.settlementTime,
		token2: game.token2,
		timeType: hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TIME_TYPE),
		feePercentage: game.feePercentage,
		protocolFee: game.protocolFee,
		multiplier: game.multiplier,
		disputeDelay: game.disputeDelay,
		currentAmount1: game.currentAmount1,
		currentAmount2: game.currentAmount2,
		price: calculateOpenOraclePrice(game.currentAmount1, game.currentAmount2),
		currentReporter: game.currentReporter,
		reportTimestamp: game.reportTimestamp,
		settlementTimestamp: game.settlementTimestamp,
		initialReporter: initialGame.currentReporter,
		disputeOccurred: eventState.reportCount > 1n,
		isDistributed: eventState.settled,
		stateHash,
		callbackContract: game.callbackContract,
		numReports: eventState.reportCount,
		callbackGasLimit: Number(game.callbackGasLimit),
		protocolFeeRecipient: game.protocolFeeRecipient,
		trackDisputes: hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TRACK_DISPUTES),
		lastReportOppoTime: game.lastReportOppoTime,
		token1Decimals: token1Metadata.decimals,
		token2Decimals: token2Metadata.decimals,
		token1Symbol: token1Metadata.symbol,
		token2Symbol: token2Metadata.symbol,
	}
}
export async function loadOpenOracleReportSummaries(client: ReadClient, pageIndex: number, pageSize: number): Promise<OpenOracleReportSummaryPage> {
	const pageOffset = getProtocolPageOffset(pageIndex, pageSize)
	const openOracleAddress = getOpenOracleAddress()
	const nextReportId = await client.readContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'nextReportId',
		address: openOracleAddress,
		args: [],
	})
	const reportCount = nextReportId > 0n ? nextReportId - 1n : 0n
	if (reportCount === 0n)
		return {
			nextReportId,
			pageIndex,
			pageSize,
			reportCount,
			reports: [],
		}
	const pageSizeBigInt = BigInt(pageSize)
	const pageEndId = reportCount - pageOffset
	if (pageEndId <= 0n)
		return {
			nextReportId,
			pageIndex,
			pageSize,
			reportCount,
			reports: [],
		}
	const pageStartId = pageEndId > pageSizeBigInt ? pageEndId - pageSizeBigInt + 1n : 1n
	const reportIds: bigint[] = []
	for (let reportId = pageEndId; reportId >= pageStartId; reportId--) {
		reportIds.push(reportId)
		if (reportId === pageStartId) break
	}
	const eventStates = await loadOpenOracleEventStates(client, openOracleAddress, new Set(reportIds))
	const tokenAddresses = new Set<Address>()
	for (const reportId of reportIds) {
		const state = eventStates.get(reportId)
		if (state === undefined) throw new Error(`Oracle report #${reportId.toString()} does not exist`)
		tokenAddresses.add(state.latest.game.token1)
		tokenAddresses.add(state.latest.game.token2)
	}
	const uniqueTokenAddresses = [...tokenAddresses]
	const tokenMetadata = new Map<
		Address,
		{
			decimals: number
			symbol: string
		}
	>()
	if (uniqueTokenAddresses.length > 0) {
		const tokenDecimals = await readRequiredMulticall(
			client,
			uniqueTokenAddresses.map(tokenAddress => ({
				abi: ABIS.mainnet.erc20,
				functionName: 'decimals',
				address: tokenAddress,
				args: [],
			})),
		)
		const tokenSymbols = await readRequiredMulticall(
			client,
			uniqueTokenAddresses.map(tokenAddress => ({
				abi: ABIS.mainnet.erc20,
				functionName: 'symbol',
				address: tokenAddress,
				args: [],
			})),
		)
		for (const [index, tokenAddress] of uniqueTokenAddresses.entries()) {
			const decimals = tokenDecimals[index]
			const symbol = tokenSymbols[index]
			if (decimals === undefined || symbol === undefined) throw new Error('Unexpected token metadata response')
			tokenMetadata.set(tokenAddress, normalizeOpenOracleTokenMetadata(tokenAddress, decimals, symbol))
		}
	}
	const reports = reportIds.map(reportId => {
		const state = eventStates.get(reportId)
		if (state === undefined) throw new Error('Unexpected oracle report summary response')
		const game = state.latest.game
		const token1Metadata = tokenMetadata.get(game.token1)
		const token2Metadata = tokenMetadata.get(game.token2)
		if (token1Metadata === undefined || token2Metadata === undefined) throw new Error('Unexpected oracle token metadata response')
		return {
			currentAmount1: game.currentAmount1,
			currentAmount2: game.currentAmount2,
			currentReporter: game.currentReporter,
			disputeOccurred: state.reportCount > 1n,
			exactToken1Report: state.initial.game.currentAmount1,
			isDistributed: state.settled,
			price: calculateOpenOraclePrice(game.currentAmount1, game.currentAmount2),
			reportId,
			reportTimestamp: game.reportTimestamp,
			settlementTimestamp: game.settlementTimestamp,
			token1: game.token1,
			token2: game.token2,
			token1Decimals: token1Metadata.decimals,
			token2Decimals: token2Metadata.decimals,
			token1Symbol: token1Metadata.symbol,
			token2Symbol: token2Metadata.symbol,
		} satisfies OpenOracleReportSummary
	})
	return {
		nextReportId,
		pageIndex,
		pageSize,
		reportCount,
		reports,
	}
}
export async function createOpenOracleReportInstance(
	client: WriteClient,
	parameters: {
		disputeDelay: number
		escalationHalt: bigint
		exactToken1Report: bigint
		initialToken2Amount: bigint
		ethValue: bigint
		feePercentage: number
		multiplier: number
		protocolFee: number
		settlementTime: number
		settlerReward: bigint
		token1Address: Address
		token2Address: Address
	},
) {
	const assertSafeInteger = (value: number, label: string) => {
		if (!Number.isSafeInteger(value)) throw new Error(`${label} exceeds the maximum safe integer range`)
	}
	assertSafeInteger(parameters.disputeDelay, 'Dispute delay')
	assertSafeInteger(parameters.feePercentage, 'Fee percentage')
	assertSafeInteger(parameters.multiplier, 'Multiplier')
	assertSafeInteger(parameters.protocolFee, 'Protocol fee')
	assertSafeInteger(parameters.settlementTime, 'Settlement time')
	const validationMessage = getOpenOracleCreateParameterValidationMessage({
		disputeDelay: BigInt(parameters.disputeDelay),
		escalationHalt: parameters.escalationHalt,
		exactToken1Report: parameters.exactToken1Report,
		initialToken2Amount: parameters.initialToken2Amount,
		ethValue: parameters.ethValue,
		feePercentage: BigInt(parameters.feePercentage),
		multiplier: BigInt(parameters.multiplier),
		protocolFee: BigInt(parameters.protocolFee),
		settlementTime: BigInt(parameters.settlementTime),
		settlerReward: parameters.settlerReward,
		token1Address: parameters.token1Address,
		token2Address: parameters.token2Address,
	})
	if (validationMessage !== undefined) throw new Error(validationMessage)
	let wethFundingAmount = 0n
	if (sameAddress(parameters.token1Address, getWethAddress())) wethFundingAmount = parameters.exactToken1Report
	else if (sameAddress(parameters.token2Address, getWethAddress())) wethFundingAmount = parameters.initialToken2Amount
	if (wethFundingAmount > 0n) {
		const wethBalance = await client.readContract({
			address: getWethAddress(),
			abi: ABIS.mainnet.erc20,
			functionName: 'balanceOf',
			args: [client.account.address],
		})
		if (wethBalance < wethFundingAmount) await wrapWeth(client, wethFundingAmount - wethBalance)
	}
	await writeContractAndWait(client, () => ({
		address: parameters.token1Address,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [getOpenOracleAddress(), parameters.exactToken1Report],
	}))
	await writeContractAndWait(client, () => ({
		address: parameters.token2Address,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [getOpenOracleAddress(), parameters.initialToken2Amount],
	}))
	const callParams = {
		address: getOpenOracleAddress(),
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'report',
		args: [
			[
				parameters.exactToken1Report,
				parameters.initialToken2Amount,
				client.account.address,
				0n,
				0n,
				parameters.token1Address,
				0n,
				BigInt(parameters.settlementTime),
				parameters.escalationHalt,
				client.account.address,
				parameters.settlerReward,
				parameters.token2Address,
				0,
				parameters.disputeDelay,
				parameters.feePercentage,
				parameters.multiplier,
				zeroAddress,
				0,
				parameters.protocolFee,
				Number(OPEN_ORACLE_FLAG_TIME_TYPE | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_STORE_PRICE),
			],
			false,
			false,
			[0n, 0n, 0n, 0n],
		],
		value: parameters.ethValue,
	}
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'createReportInstance',
		hash,
	} satisfies OpenOracleActionResult
}
async function loadBufferedOracleRequestEthCost(client: WriteClient, managerAddress: Address) {
	const requestPriceEthCost = await client.readContract({
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'getRequestPriceEthCost',
		args: [],
	})
	return addOpenOracleBountyBuffer(requestPriceEthCost)
}

export async function loadOracleManagerQueueOperationEthValue(client: Pick<WriteClient, 'readContract'>, managerAddress: Address) {
	const [lastPrice, pendingSettlementOperationIds, pendingSettlementQueueCapacity, pendingReportId, queuedOperationEthCost, requestPriceEthCost, rawIsPriceValid] = await Promise.all([
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastPrice',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getPendingSettlementOperationIds',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'MAX_PENDING_SETTLEMENT_OPERATIONS',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'pendingReportId',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getQueuedOperationEthCost',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getRequestPriceEthCost',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'isPriceValid',
			args: [],
		}),
	])
	const normalizedQueuedOperationEthCost = requireBigintValue(queuedOperationEthCost, 'queued operation ETH cost')
	const normalizedRequestPriceEthCost = requireBigintValue(requestPriceEthCost, 'request price ETH cost')
	const managerDetails: OracleManagerDetails = {
		callbackStateHash: undefined,
		exactToken1Report: undefined,
		isPriceValid: rawIsPriceValid,
		lastPrice,
		lastSettlementTimestamp: 0n,
		managerAddress,
		openOracleAddress: getInfraContractAddresses().openOracle,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingSettlementOperationIds: [...pendingSettlementOperationIds],
		pendingSettlementQueueCapacity,
		pendingReportId,
		priceValidUntilTimestamp: undefined,
		queuedOperationEthCost: normalizedQueuedOperationEthCost,
		requestPriceEthCost: normalizedRequestPriceEthCost,
		token1: undefined,
		token2: undefined,
	}
	const funding = resolveOracleOperationEthFunding({
		managerDetails,
	})
	if (funding === undefined || funding.ethCost === 0n) return 0n
	return funding.includeBuffer ? addOpenOracleBountyBuffer(funding.ethCost) : funding.ethCost
}

async function getCoordinatorInitialReportPrice(client: CoordinatorInitialReportClient, managerAddress: Address) {
	const [minimumToken1Report, lastPrice, rawReputationTokenAddress] = await Promise.all([
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastPrice',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'reputationToken',
			args: [],
		}),
	])
	const reputationTokenAddress = getAddress(rawReputationTokenAddress)
	if (lastPrice === 0n) {
		const quote = await loadOpenOracleInitialReportPrice(client, getWethAddress(), reputationTokenAddress, minimumToken1Report)
		const proposedRepPerEthPrice = (quote.token2Amount * COORDINATOR_PRICE_PRECISION) / minimumToken1Report
		return proposedRepPerEthPrice > 0n ? proposedRepPerEthPrice : 1n
	}
	return lastPrice
}

export async function loadCoordinatorInitialReportFundingRequirement(client: CoordinatorInitialReportClient, managerAddress: Address, walletAddress: Address, proposedRepPerEthPrice?: bigint, requestedInitialWeth = 0n) {
	const [rawReputationTokenAddress, currentWethBalance, resolvedInitialReportPrice, minimumToken1Report] = await Promise.all([
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'reputationToken',
			args: [],
		}),
		client.readContract({
			address: getWethAddress(),
			abi: ABIS.mainnet.erc20,
			functionName: 'balanceOf',
			args: [walletAddress],
		}),
		proposedRepPerEthPrice ?? getCoordinatorInitialReportPrice(client, managerAddress),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1Report',
			args: [],
		}),
	])
	const reputationTokenAddress = getAddress(rawReputationTokenAddress)
	const currentRepBalance = await client.readContract({
		address: reputationTokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		args: [walletAddress],
	})
	const bufferedMinimumToken1Report = addOpenOracleInitialReportFundingBuffer(minimumToken1Report)
	const maximumInitialWeth = requestedInitialWeth > bufferedMinimumToken1Report ? requestedInitialWeth : bufferedMinimumToken1Report
	const initialReportAmount2 = (maximumInitialWeth * resolvedInitialReportPrice + COORDINATOR_PRICE_PRECISION - 1n) / COORDINATOR_PRICE_PRECISION
	return {
		currentRepBalance,
		currentWethBalance,
		initialReportAmount2,
		maximumInitialWeth,
		minimumToken1Report,
		proposedRepPerEthPrice: resolvedInitialReportPrice,
		reputationTokenAddress,
		requestedInitialWeth,
		wethShortfall: currentWethBalance >= maximumInitialWeth ? 0n : maximumInitialWeth - currentWethBalance,
	}
}

async function assertCoordinatorRequestPriceAllowed(client: Pick<WriteClient, 'readContract'>, managerAddress: Address) {
	const [isPriceValid, pendingReportId] = await Promise.all([
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'isPriceValid',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'pendingReportId',
			args: [],
		}),
	])
	if (isPriceValid) throw new Error('A fresh oracle price is already available')
	if (pendingReportId > 0n) throw new Error('Oracle price request is already pending')
}

async function fundCoordinatorInitialReport(client: WriteClient, managerAddress: Address, proposedRepPerEthPrice: bigint, requestedInitialWeth = 0n) {
	const fundingRequirement = await loadCoordinatorInitialReportFundingRequirement(client, managerAddress, client.account.address, proposedRepPerEthPrice, requestedInitialWeth)
	if (fundingRequirement.currentRepBalance < fundingRequirement.initialReportAmount2) throw new Error('Insufficient REP balance for coordinator initial report')
	if (fundingRequirement.wethShortfall > 0n) {
		await wrapWeth(client, fundingRequirement.wethShortfall)
	}
	await writeContractAndWait(client, () => ({
		address: fundingRequirement.reputationTokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [managerAddress, fundingRequirement.initialReportAmount2],
	}))
	await writeContractAndWait(client, () => ({
		address: getWethAddress(),
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [managerAddress, fundingRequirement.maximumInitialWeth],
	}))
	return fundingRequirement
}

export async function requestOraclePrice(client: WriteClient, managerAddress: Address, proposedRepPerEthPrice?: bigint, requestedInitialWeth = 0n, reviewedRequestEthValue?: bigint) {
	await assertCoordinatorRequestPriceAllowed(client, managerAddress)
	const resolvedInitialReportPrice = proposedRepPerEthPrice ?? (await getCoordinatorInitialReportPrice(client, managerAddress))
	await fundCoordinatorInitialReport(client, managerAddress, resolvedInitialReportPrice, requestedInitialWeth)
	const callParams = {
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'requestPrice',
		args: [resolvedInitialReportPrice, requestedInitialWeth],
		value: reviewedRequestEthValue ?? (await loadBufferedOracleRequestEthCost(client, managerAddress)),
	}
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'requestPrice',
		hash,
	} satisfies OpenOracleActionResult
}
export async function executeOracleManagerStagedOperation(client: WriteContractClient, managerAddress: Address, operationId: bigint) {
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => ({
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'executeStagedOperation',
		args: [operationId],
		gas: 5_000_000n,
	}))
	const stagedExecution = getStagedOracleExecutionResult(receipt, managerAddress, 'liquidation') ?? getStagedOracleExecutionResult(receipt, managerAddress, 'withdrawRep') ?? getStagedOracleExecutionResult(receipt, managerAddress, 'setSecurityBondsAllowance')
	return {
		action: 'executeStagedOperation',
		hash,
		...(stagedExecution === undefined ? {} : { stagedExecution }),
	} satisfies OpenOracleActionResult
}
export async function wrapWeth(client: WriteClient, amount: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getWethAddress(),
		abi: [
			{
				type: 'function',
				name: 'deposit',
				stateMutability: 'payable',
				inputs: [],
				outputs: [],
			},
		],
		functionName: 'deposit',
		value: amount,
	}))
	return {
		action: 'wrapWeth',
		hash,
	} satisfies OpenOracleActionResult
}
export async function loadOpenOracleWithdrawableBalances(client: Pick<ReadClient, 'readContract'>, openOracleAddress: Address, holder: Address, token1: Address, token2: Address): Promise<OpenOracleWithdrawableBalances> {
	const loadBalance = async (token: Address) =>
		requireBigintValue(
			await client.readContract({
				address: openOracleAddress,
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'tokenHolder',
				args: [holder, token],
			}),
			'Open Oracle token holder balance',
		)
	const [rawEth, rawToken1, rawToken2] = await Promise.all([loadBalance(zeroAddress), loadBalance(token1), loadBalance(token2)])
	const availableBalance = (balance: bigint) => (balance > 1n ? balance - 1n : 0n)
	return {
		eth: availableBalance(rawEth),
		token1: availableBalance(rawToken1),
		token2: availableBalance(rawToken2),
	}
}
export async function withdrawOpenOracleBalance<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, openOracleAddress: Address, token: Address, amount: bigint, recipient: Address): Promise<OpenOracleActionResult> {
	const hash = await writeContractAndWait(client, () => ({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'withdrawTo',
		args: [token, amount, recipient],
	}))
	return {
		action: 'withdrawBalance',
		hash,
	}
}
export async function settleOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint): Promise<OpenOracleActionResult>
export async function settleOracleReport<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, openOracleAddress: Address, reportId: bigint, preimage: OpenOracleStatePreimage): Promise<OpenOracleActionResult>
export async function settleOracleReport<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt> & Partial<Pick<ReadClient, 'getBlock' | 'getLogs'> & Pick<WriteClient, 'account'>>, openOracleAddress: Address, reportId: bigint, preimage?: OpenOracleStatePreimage) {
	let resolvedPreimage = preimage
	if (resolvedPreimage === undefined) {
		const { getBlock, getLogs } = client
		if (getBlock === undefined || getLogs === undefined) throw new Error('OpenOracle settlement requires a client that can load report events')
		resolvedPreimage = (await loadOpenOracleEventState({ getBlock, getLogs }, openOracleAddress, reportId)).latest
	}
	const hash = await writeContractAndWait(client, () => ({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'settle',
		gas: 5000000n,
		args: [reportId, getOpenOracleGameTuple(resolvedPreimage.game), getOpenOracleHelperTuple(resolvedPreimage.helper)],
	}))
	return {
		action: 'settle',
		hash,
	} satisfies OpenOracleActionResult
}
export async function disputeOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint, tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint, _amt2Expected: bigint, stateHash: Hex) {
	const state = await loadOpenOracleEventState(client, openOracleAddress, reportId)
	const currentStateHash = hashOpenOracleStatePreimage(state.latest)
	if (currentStateHash.toLowerCase() !== stateHash.toLowerCase()) throw new Error('This report changed on-chain while the dispute was being prepared. Retry to use the latest state.')
	const hash = await writeContractAndWait(client, () => ({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'dispute',
		args: [reportId, tokenToSwap, newAmount1, newAmount2, client.account.address, false, false, getOpenOracleGameTuple(state.latest.game), getOpenOracleHelperTuple(state.latest.helper), [0n, 0n, 0n, 0n]],
	}))
	return {
		action: 'dispute',
		hash,
	} satisfies OpenOracleActionResult
}
export async function queueSecurityPoolLiquidation(client: WriteClient, managerAddress: Address, targetVault: Address, amount: bigint, validForSeconds: bigint, requestedInitialWeth = 0n) {
	const queueOperationEthValue = await loadOracleManagerQueueOperationEthValue(client, managerAddress)
	const proposedRepPerEthPrice = queueOperationEthValue > 0n ? await getCoordinatorInitialReportPrice(client, managerAddress) : 0n
	if (queueOperationEthValue > 0n) {
		await fundCoordinatorInitialReport(client, managerAddress, proposedRepPerEthPrice, requestedInitialWeth)
	}
	const callParams = {
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'requestPriceIfNeededAndStageOperation',
		args: [encodeOracleQueueOperation('liquidation'), targetVault, amount, validForSeconds, proposedRepPerEthPrice, requestedInitialWeth],
		value: queueOperationEthValue,
	}
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => callParams)
	const queuedOperation = getStagedOracleQueuedResult(receipt, managerAddress, 'liquidation')
	const stagedExecution = getStagedOracleExecutionResult(receipt, managerAddress, 'liquidation')
	return {
		hash,
		...(queuedOperation === undefined ? {} : { queuedOperation }),
		...(stagedExecution === undefined ? {} : { stagedExecution }),
	}
}
export async function queueOracleManagerOperation(client: WriteClient, managerAddress: Address, operation: OracleQueueOperation, targetVault: Address, amount: bigint, validForSeconds: bigint, proposedRepPerEthPrice?: bigint, requestedInitialWeth = 0n) {
	const queueOperationEthValue = await loadOracleManagerQueueOperationEthValue(client, managerAddress)
	const resolvedInitialReportPrice = queueOperationEthValue > 0n ? (proposedRepPerEthPrice ?? (await getCoordinatorInitialReportPrice(client, managerAddress))) : (proposedRepPerEthPrice ?? 0n)
	if (queueOperationEthValue > 0n) {
		await fundCoordinatorInitialReport(client, managerAddress, resolvedInitialReportPrice, requestedInitialWeth)
	}
	const callParams = {
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'requestPriceIfNeededAndStageOperation',
		args: [encodeOracleQueueOperation(operation), targetVault, amount, validForSeconds, resolvedInitialReportPrice, requestedInitialWeth],
		value: queueOperationEthValue,
	}
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => callParams)
	const queuedOperation = getStagedOracleQueuedResult(receipt, managerAddress, operation)
	const stagedExecution = getStagedOracleExecutionResult(receipt, managerAddress, operation)
	return {
		action: 'queueOperation',
		hash,
		...(queuedOperation === undefined ? {} : { queuedOperation }),
		...(stagedExecution === undefined ? {} : { stagedExecution }),
	} satisfies OpenOracleActionResult
}
