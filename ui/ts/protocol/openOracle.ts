import { bigintToSafeNumber, decodeEventLog, getAddress, zeroAddress, type Address, type Hex, type TransactionReceipt } from '@zoltar/shared/ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hasOpenOracleFlag, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_STORE_PRICE, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_FLAG_TRACK_DISPUTES, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { ABIS } from '../abis.js'
import { sameAddress } from '../lib/address.js'
import { isIgnorableLogDecodeError } from '../lib/errors.js'
import { resolveOracleOperationEthFunding } from './oracleRequestFunding.js'
import { getOracleManagerPriceValidUntilTimestamp } from './oracleTiming.js'
import { addOpenOracleBountyBuffer, addOpenOracleInitialReportFundingBuffer, getOpenOracleDisputeSwapTokenKey } from './openOracleMath.js'
import { loadOpenOracleInitialReportPrice } from './openOraclePricing.js'
import { getOpenOracleCreateParameterValidationMessage } from './openOracleValidation.js'
import { decodeOracleQueueOperation, encodeOracleQueueOperation } from './oracleQueueOperation.js'
import { getWethAddress } from './uniswapQuoter.js'
import { peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry, peripherals_OpenOracleOperationBountyBoard_OpenOracleOperationBountyBoard, peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, peripherals_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import type {
	LiquidationApprovalDetails,
	OpenOracleActionResult,
	OpenOracleWithdrawableBalances,
	OracleManagerDetails,
	OracleOperationBounty,
	OracleOperationBountyInput,
	OracleOperationBountyState,
	OracleOperationExecutionStatus,
	OracleQueueOperation,
	ReadClient,
	OpenOracleReportSummary,
	OpenOracleReportSummaryPage,
	StagedOracleExecutionResult,
	StagedOracleQueuedResult,
	WriteClient,
} from '../types/contracts.js'
import { getProtocolPageOffset, hasTimestampAndNumber, requireStagedOperationTupleArray } from './helpers.js'
import { type WriteContractClient, readRequiredMulticall, writeContractAndWait, writeContractAndWaitForReceipt } from './core.js'
import { getInfraContractAddresses, getOpenOracleAddress } from './deploymentHelpers.js'
import { loadOpenOracleEventState, loadOpenOracleEventStates } from './openOracleState.js'

type CoordinatorInitialReportClient = Parameters<typeof loadOpenOracleInitialReportPrice>[0]
const OPEN_ORACLE_PRICE_UNITS = 30n
const ACTIVE_STAGED_OPERATION_PREVIEW_LIMIT = 25n
const OPERATION_BOUNTY_PREVIEW_LIMIT = 25n
const COORDINATOR_PRICE_PRECISION = 10n ** 18n
const OPEN_ORACLE_REPORT_MISSING_ERROR_NAME = 'OpenOracleReportMissingError'

type RawOperationBounty = {
	acceptanceDeadline: bigint
	amount: bigint
	creator: Address
	maximumInitialAttoWeth: bigint
	minimumInitialAttoWeth: bigint
	operation: bigint | number
	operationId: bigint
	operator: Address
	reportId: bigint
	rewardAmount: bigint
	rewardToken: Address
	state: bigint | number
	targetVault: Address
	validForSeconds: bigint
}

export function createOpenOracleReportMissingError(reportId: bigint) {
	const error = new Error(`Oracle report #${reportId.toString()} does not exist`)
	error.name = OPEN_ORACLE_REPORT_MISSING_ERROR_NAME
	return error
}

export function isOpenOracleReportMissingError(error: unknown) {
	return error instanceof Error && error.name === OPEN_ORACLE_REPORT_MISSING_ERROR_NAME
}

export function getOpenOracleDisputeSwapToken(game: Pick<OpenOracleStatePreimage['game'], 'currentAmount1' | 'currentAmount2' | 'token1' | 'token2'>, newAmount1: bigint, newAmount2: bigint) {
	return getOpenOracleDisputeSwapTokenKey({
		currentAmount1: game.currentAmount1,
		currentAmount2: game.currentAmount2,
		newAmount1,
		newAmount2,
	}) === 'token2'
		? game.token2
		: game.token1
}

function normalizeOpenOracleTokenMetadata(tokenAddress: Address, decimalsValue: unknown, symbolValue: unknown) {
	let decimals: number | undefined
	if (typeof decimalsValue === 'bigint') decimals = bigintToSafeNumber(decimalsValue, 'Token decimals')
	if (typeof decimalsValue === 'number') decimals = decimalsValue
	const symbol = String(symbolValue).trim()
	if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error(`Token metadata for ${tokenAddress} returned invalid decimals`)
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

function requireUnsignedBigintValue(value: unknown, context: string) {
	if (typeof value === 'bigint' && value >= 0n) return value
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
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

function decodeOperationBountyState(value: bigint | number): OracleOperationBountyState {
	switch (BigInt(value)) {
		case 1n:
			return 'open'
		case 2n:
			return 'assigned'
		case 3n:
			return 'paid'
		case 4n:
			return 'refunded'
		default:
			throw new Error(`Unknown operation bounty state: ${value}`)
	}
}

function decodeOperationExecutionStatus(value: bigint | number): OracleOperationExecutionStatus {
	switch (BigInt(value)) {
		case 0n:
			return 'none'
		case 1n:
			return 'pending'
		case 2n:
			return 'succeeded'
		case 3n:
			return 'failed'
		default:
			throw new Error(`Unknown operation execution status: ${value}`)
	}
}

async function normalizeOperationBounty(client: ReadClient, managerAddress: Address, boardAddress: Address, settlementTime: bigint, bountyId: bigint, bounty: RawOperationBounty): Promise<OracleOperationBounty> {
	let executionStatus: OracleOperationExecutionStatus = 'none'
	let refundAvailableAt: bigint | undefined
	if (bounty.operationId > 0n) {
		const [rawExecutionStatus, stagedOperation] = await Promise.all([
			client.readContract({
				abi: peripherals_OpenOracleOperationBountyBoard_OpenOracleOperationBountyBoard.abi,
				address: boardAddress,
				functionName: 'operationExecutionStatuses',
				args: [bountyId],
			}),
			client.readContract({
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				address: managerAddress,
				functionName: 'stagedOperations',
				args: [bounty.operationId],
			}),
		])
		executionStatus = decodeOperationExecutionStatus(rawExecutionStatus)
		const stagedOperator = getTupleComponent(stagedOperation, 1, 'operator')
		if (executionStatus === 'pending' && stagedOperator !== zeroAddress) {
			refundAvailableAt = requireUnsignedBigintValue(getTupleComponent(stagedOperation, 5, 'queuedAt'), 'staged operation queue time') + settlementTime + requireUnsignedBigintValue(getTupleComponent(stagedOperation, 6, 'validForSeconds'), 'staged operation validity')
		}
	}
	return {
		acceptanceDeadline: bounty.acceptanceDeadline,
		amount: bounty.amount,
		bountyId,
		creator: getAddress(bounty.creator),
		executionStatus,
		maximumInitialAttoWeth: bounty.maximumInitialAttoWeth,
		minimumInitialAttoWeth: bounty.minimumInitialAttoWeth,
		operation: decodeOracleQueueOperation(bounty.operation),
		operationId: bounty.operationId,
		operator: getAddress(bounty.operator),
		reportId: bounty.reportId,
		refundAvailableAt,
		rewardAmount: bounty.rewardAmount,
		rewardToken: getAddress(bounty.rewardToken),
		state: decodeOperationBountyState(bounty.state),
		targetVault: getAddress(bounty.targetVault),
		validForSeconds: bounty.validForSeconds,
	}
}

function requireAddressValue(value: unknown, context: string) {
	if (typeof value === 'string') return getAddress(value)
	throw new Error(`Unexpected ${context} response`)
}

function requireEnumValue(value: unknown, context: string) {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
	throw new Error(`Unexpected ${context} response`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function getTupleComponent(value: unknown, index: number, name: string) {
	if (Array.isArray(value)) return value[index]
	if (isRecord(value)) return value[name] ?? value[index.toString()]
	return undefined
}

function toRawOperationBounty(bounty: unknown): RawOperationBounty {
	if (!Array.isArray(bounty) && !isRecord(bounty)) throw new Error('Unexpected operation bounty response')
	const values = ['creator', 'operator', 'operation', 'targetVault', 'amount', 'validForSeconds', 'rewardToken', 'rewardAmount', 'acceptanceDeadline', 'minimumInitialAttoWeth', 'maximumInitialAttoWeth', 'operationId', 'reportId', 'state'].map((name, index) => getTupleComponent(bounty, index, name))
	return {
		creator: requireAddressValue(values[0], 'operation bounty creator'),
		operator: requireAddressValue(values[1], 'operation bounty operator'),
		operation: requireEnumValue(values[2], 'operation bounty operation'),
		targetVault: requireAddressValue(values[3], 'operation bounty target'),
		amount: requireBigintValue(values[4], 'operation bounty amount'),
		validForSeconds: requireBigintValue(values[5], 'operation bounty validity'),
		rewardToken: requireAddressValue(values[6], 'operation bounty reward token'),
		rewardAmount: requireBigintValue(values[7], 'operation bounty reward'),
		acceptanceDeadline: requireBigintValue(values[8], 'operation bounty acceptance deadline'),
		minimumInitialAttoWeth: requireBigintValue(values[9], 'operation bounty minimum WETH'),
		maximumInitialAttoWeth: requireBigintValue(values[10], 'operation bounty maximum WETH'),
		operationId: requireBigintValue(values[11], 'operation bounty operation id'),
		reportId: requireBigintValue(values[12], 'operation bounty report id'),
		state: requireEnumValue(values[13], 'operation bounty state'),
	}
}

export async function loadOracleOperationBounty(client: ReadClient, managerAddress: Address, boardAddress: Address, bountyId: bigint): Promise<OracleOperationBounty> {
	if (boardAddress === zeroAddress) throw new Error('This oracle coordinator does not have an operation bounty board')
	if (bountyId <= 0n) throw new Error('Operation bounty ID must be positive')
	const nextBountyId = await client.readContract({ abi: peripherals_OpenOracleOperationBountyBoard_OpenOracleOperationBountyBoard.abi, address: boardAddress, functionName: 'nextOperationBountyId', args: [] })
	if (bountyId >= nextBountyId) throw new Error(`Operation bounty #${bountyId} does not exist`)
	const [settlementTime, bounty] = await Promise.all([
		client.readContract({ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: managerAddress, functionName: 'settlementTime', args: [] }),
		client.readContract({ abi: peripherals_OpenOracleOperationBountyBoard_OpenOracleOperationBountyBoard.abi, address: boardAddress, functionName: 'operationBounties', args: [bountyId] }),
	])
	return await normalizeOperationBounty(client, managerAddress, boardAddress, requireUnsignedBigintValue(settlementTime, 'settlement time'), bountyId, toRawOperationBounty(bounty))
}

async function loadOperationBounties(client: ReadClient, managerAddress: Address, boardAddress: Address, settlementTime: bigint): Promise<OracleOperationBounty[]> {
	if (boardAddress === zeroAddress) return []
	const nextBountyId = await client.readContract({ abi: peripherals_OpenOracleOperationBountyBoard_OpenOracleOperationBountyBoard.abi, address: boardAddress, functionName: 'nextOperationBountyId', args: [] })
	if (nextBountyId <= 1n) return []
	const bountyCount = nextBountyId - 1n < OPERATION_BOUNTY_PREVIEW_LIMIT ? nextBountyId - 1n : OPERATION_BOUNTY_PREVIEW_LIMIT
	const startId = nextBountyId - bountyCount
	const [bountyIds, bounties] = await client.readContract({ abi: peripherals_OpenOracleOperationBountyBoard_OpenOracleOperationBountyBoard.abi, address: boardAddress, functionName: 'getOperationBounties', args: [startId, bountyCount] })
	const normalizedBounties = await Promise.all(
		bounties.map(async (bounty, index) => {
			const bountyId = bountyIds[index]
			if (bountyId === undefined) throw new Error('Missing operation bounty id')
			return await normalizeOperationBounty(client, managerAddress, boardAddress, settlementTime, bountyId, toRawOperationBounty(bounty))
		}),
	)
	return normalizedBounties.reverse()
}

export async function loadOracleManagerDetails(client: ReadClient, managerAddress: Address, openOracleAddress?: Address): Promise<OracleManagerDetails> {
	const [
		lastPrice,
		pendingOperationSlotId,
		pendingSettlementOperationIds,
		pendingSettlementQueueCapacity,
		pendingReportId,
		queuedOperationCostAttoEth,
		requestPriceCostAttoEth,
		rawIsPriceValid,
		lastSettlementTimestamp,
		activeStagedOperationCount,
		settlementTime,
		rawOperationBountyBoardAddress,
		rawReputationTokenAddress,
		rawWethAddress,
	] = await readRequiredMulticall(client, [
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
			functionName: 'getQueuedOperationCostAttoEth',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getRequestPriceCostAttoEth',
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
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'settlementTime',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'operationBountyBoard',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'reputationToken',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'weth',
			address: managerAddress,
			args: [],
		},
	])
	const normalizedPendingSettlementOperationIds = requireBigintArray(pendingSettlementOperationIds, 'pending settlement operation ids')
	const normalizedPendingSettlementQueueCapacity = requireBigintValue(pendingSettlementQueueCapacity, 'pending settlement queue capacity')
	const normalizedQueuedOperationEthCost = requireBigintValue(queuedOperationCostAttoEth, 'queued operation ETH cost')
	const normalizedRequestPriceEthCost = requireBigintValue(requestPriceCostAttoEth, 'request price ETH cost')
	const normalizedSettlementTime = requireUnsignedBigintValue(settlementTime, 'settlement time')
	const operationBountyBoardAddress = getAddress(rawOperationBountyBoardAddress)
	const reputationTokenAddress = getAddress(rawReputationTokenAddress)
	const wethAddress = getAddress(rawWethAddress)
	const operationBounties = await loadOperationBounties(client, managerAddress, operationBountyBoardAddress, normalizedSettlementTime)
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
					amount: stagedOperation.operationAmountAttoRepOrAttoEth,
					operator: stagedOperation.operator,
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
			if (stagedOperation.operator !== zeroAddress) {
				pendingOperation = {
					amount: stagedOperation.operationAmountAttoRepOrAttoEth,
					operator: stagedOperation.operator,
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
		operationBounties,
		operationBountyBoardAddress,
		pendingOperation,
		pendingOperationSlotId,
		pendingSettlementOperationIds: normalizedPendingSettlementOperationIds,
		pendingSettlementQueueCapacity: normalizedPendingSettlementQueueCapacity,
		pendingReportId,
		priceValidUntilTimestamp: getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp),
		queuedOperationCostAttoEth: normalizedQueuedOperationEthCost,
		reputationTokenAddress,
		requestPriceCostAttoEth: normalizedRequestPriceEthCost,
		settlementTime: normalizedSettlementTime,
		stagedOperations,
		token1,
		token2,
		wethAddress,
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
		settlerRewardAttoEth: game.settlerRewardAttoEth,
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
		callbackGasLimit: bigintToSafeNumber(game.callbackGasLimit, 'Callback gas limit'),
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
			timeType: hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TIME_TYPE),
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
		ethValueAttoEth: bigint
		feePercentage: number
		multiplier: number
		protocolFee: number
		settlementTime: number
		settlerRewardAttoEth: bigint
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
		ethValueAttoEth: parameters.ethValueAttoEth,
		feePercentage: BigInt(parameters.feePercentage),
		multiplier: BigInt(parameters.multiplier),
		protocolFee: BigInt(parameters.protocolFee),
		settlementTime: BigInt(parameters.settlementTime),
		settlerRewardAttoEth: parameters.settlerRewardAttoEth,
		token1Address: parameters.token1Address,
		token2Address: parameters.token2Address,
	})
	if (validationMessage !== undefined) throw new Error(validationMessage)
	let wethFundingAmountAttoEth = 0n
	if (sameAddress(parameters.token1Address, getWethAddress())) wethFundingAmountAttoEth = parameters.exactToken1Report
	else if (sameAddress(parameters.token2Address, getWethAddress())) wethFundingAmountAttoEth = parameters.initialToken2Amount
	if (wethFundingAmountAttoEth > 0n) {
		const wethBalanceAttoEth = await client.readContract({
			address: getWethAddress(),
			abi: ABIS.mainnet.erc20,
			functionName: 'balanceOf',
			args: [client.account.address],
		})
		if (wethBalanceAttoEth < wethFundingAmountAttoEth) await wrapWeth(client, wethFundingAmountAttoEth - wethBalanceAttoEth)
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
				parameters.settlerRewardAttoEth,
				parameters.token2Address,
				0,
				parameters.disputeDelay,
				parameters.feePercentage,
				parameters.multiplier,
				zeroAddress,
				0,
				parameters.protocolFee,
				bigintToSafeNumber(OPEN_ORACLE_FLAG_TIME_TYPE | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_STORE_PRICE, 'OpenOracle flags'),
			],
			false,
			false,
			[0n, 0n, 0n, 0n],
		],
		value: parameters.ethValueAttoEth,
	}
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'createReportInstance',
		hash,
	} satisfies OpenOracleActionResult
}
async function loadBufferedOracleRequestEthCost(client: WriteClient, managerAddress: Address) {
	const requestPriceCostAttoEth = await client.readContract({
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'getRequestPriceCostAttoEth',
		args: [],
	})
	return addOpenOracleBountyBuffer(requestPriceCostAttoEth)
}

export async function loadOracleManagerQueueOperationEthValue(client: Pick<WriteClient, 'readContract'>, managerAddress: Address) {
	const [lastPrice, pendingSettlementOperationIds, pendingSettlementQueueCapacity, pendingReportId, queuedOperationCostAttoEth, requestPriceCostAttoEth, rawIsPriceValid] = await Promise.all([
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
			functionName: 'getQueuedOperationCostAttoEth',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getRequestPriceCostAttoEth',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'isPriceValid',
			args: [],
		}),
	])
	const normalizedQueuedOperationEthCost = requireBigintValue(queuedOperationCostAttoEth, 'queued operation ETH cost')
	const normalizedRequestPriceEthCost = requireBigintValue(requestPriceCostAttoEth, 'request price ETH cost')
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
		queuedOperationCostAttoEth: normalizedQueuedOperationEthCost,
		requestPriceCostAttoEth: normalizedRequestPriceEthCost,
		token1: undefined,
		token2: undefined,
	}
	const funding = resolveOracleOperationEthFunding({
		managerDetails,
	})
	if (funding === undefined || funding.costAttoEth === 0n) return 0n
	return funding.includeBuffer ? addOpenOracleBountyBuffer(funding.costAttoEth) : funding.costAttoEth
}

async function getCoordinatorInitialReportPrice(client: CoordinatorInitialReportClient, managerAddress: Address, requestedInitialAttoWeth = 0n) {
	const [minimumToken1ReportAttoEth, rawReputationTokenAddress] = await Promise.all([
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
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
	const initialReportAttoWeth = requestedInitialAttoWeth > minimumToken1ReportAttoEth ? requestedInitialAttoWeth : minimumToken1ReportAttoEth
	const quote = await loadOpenOracleInitialReportPrice(client, getWethAddress(), reputationTokenAddress, initialReportAttoWeth)
	const proposedRepPerEthPrice = (quote.token2Amount * COORDINATOR_PRICE_PRECISION) / initialReportAttoWeth
	return proposedRepPerEthPrice > 0n ? proposedRepPerEthPrice : 1n
}

export async function loadCoordinatorInitialReportFundingRequirement(client: CoordinatorInitialReportClient, managerAddress: Address, walletAddress: Address, proposedRepPerEthPrice?: bigint, requestedInitialAttoWeth = 0n) {
	const [rawReputationTokenAddress, currentWethBalanceAttoEth, resolvedInitialReportPrice, minimumToken1ReportAttoEth] = await Promise.all([
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
		proposedRepPerEthPrice ?? getCoordinatorInitialReportPrice(client, managerAddress, requestedInitialAttoWeth),
		client.readContract({
			address: managerAddress,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		}),
	])
	const reputationTokenAddress = getAddress(rawReputationTokenAddress)
	const currentRepBalanceAttoRep = await client.readContract({
		address: reputationTokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		args: [walletAddress],
	})
	const bufferedMinimumToken1Report = addOpenOracleInitialReportFundingBuffer(minimumToken1ReportAttoEth)
	const maximumInitialAttoWeth = requestedInitialAttoWeth > bufferedMinimumToken1Report ? requestedInitialAttoWeth : bufferedMinimumToken1Report
	const initialReportAmount2 = (maximumInitialAttoWeth * resolvedInitialReportPrice + COORDINATOR_PRICE_PRECISION - 1n) / COORDINATOR_PRICE_PRECISION
	return {
		currentRepBalanceAttoRep,
		currentWethBalanceAttoEth,
		initialReportAmount2,
		maximumInitialAttoWeth,
		minimumToken1ReportAttoEth,
		proposedRepPerEthPrice: resolvedInitialReportPrice,
		reputationTokenAddress,
		requestedInitialAttoWeth,
		wethShortfallAttoEth: currentWethBalanceAttoEth >= maximumInitialAttoWeth ? 0n : maximumInitialAttoWeth - currentWethBalanceAttoEth,
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

async function fundCoordinatorInitialReport(client: WriteClient, managerAddress: Address, proposedRepPerEthPrice: bigint, requestedInitialAttoWeth = 0n) {
	const fundingRequirement = await loadCoordinatorInitialReportFundingRequirement(client, managerAddress, client.account.address, proposedRepPerEthPrice, requestedInitialAttoWeth)
	if (fundingRequirement.currentRepBalanceAttoRep < fundingRequirement.initialReportAmount2) throw new Error('Insufficient REP balance for coordinator initial report')
	if (fundingRequirement.wethShortfallAttoEth > 0n) {
		await wrapWeth(client, fundingRequirement.wethShortfallAttoEth)
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
		args: [managerAddress, fundingRequirement.maximumInitialAttoWeth],
	}))
	return fundingRequirement
}

export async function requestOraclePrice(client: WriteClient, managerAddress: Address, proposedRepPerEthPrice?: bigint, requestedInitialAttoWeth = 0n, reviewedRequestValueAttoEth?: bigint) {
	await assertCoordinatorRequestPriceAllowed(client, managerAddress)
	const resolvedInitialReportPrice = proposedRepPerEthPrice ?? (await getCoordinatorInitialReportPrice(client, managerAddress, requestedInitialAttoWeth))
	await fundCoordinatorInitialReport(client, managerAddress, resolvedInitialReportPrice, requestedInitialAttoWeth)
	const callParams = {
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'requestPrice',
		args: [resolvedInitialReportPrice, requestedInitialAttoWeth],
		value: reviewedRequestValueAttoEth ?? (await loadBufferedOracleRequestEthCost(client, managerAddress)),
	}
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'requestPrice',
		hash,
	} satisfies OpenOracleActionResult
}

export async function postOracleOperationBounty(client: WriteClient, managerAddress: Address, bounty: OracleOperationBountyInput) {
	const boardAddress = getAddress(await client.readContract({ address: managerAddress, abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'operationBountyBoard', args: [] }))
	if (boardAddress === zeroAddress) throw new Error('This oracle coordinator does not have an operation bounty board')
	if (sameAddress(bounty.rewardToken, getWethAddress())) {
		const currentWethBalance = await client.readContract({ address: getWethAddress(), abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [client.account.address] })
		if (currentWethBalance < bounty.rewardAmount) await wrapWeth(client, bounty.rewardAmount - currentWethBalance)
	}
	await writeContractAndWait(client, () => ({ address: bounty.rewardToken, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [boardAddress, bounty.rewardAmount] }))
	const hash = await writeContractAndWait(client, () => ({
		address: boardAddress,
		abi: peripherals_OpenOracleOperationBountyBoard_OpenOracleOperationBountyBoard.abi,
		functionName: 'postOperationBounty',
		args: [encodeOracleQueueOperation(bounty.operation), bounty.targetVault, bounty.amount, bounty.validForSeconds, bounty.rewardToken, bounty.rewardAmount, bounty.acceptanceDeadline, bounty.minimumInitialAttoWeth, bounty.maximumInitialAttoWeth],
	}))
	return { action: 'postOperationBounty', hash } satisfies OpenOracleActionResult
}

async function loadOracleOperationBountyAcceptanceSnapshot(client: WriteClient, managerAddress: Address, boardAddress: Address, bountyId: bigint) {
	const [bounty, isPriceValid, pendingReportId, rawPendingReportSponsor, pendingSettlementOperationIds, pendingSettlementQueueCapacity, block] = await Promise.all([
		client.readContract({ address: boardAddress, abi: peripherals_OpenOracleOperationBountyBoard_OpenOracleOperationBountyBoard.abi, functionName: 'operationBounties', args: [bountyId] }),
		client.readContract({ address: managerAddress, abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'isPriceValid', args: [] }),
		client.readContract({ address: managerAddress, abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'pendingReportId', args: [] }),
		client.readContract({ address: managerAddress, abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'pendingReportSponsor', args: [] }),
		client.readContract({ address: managerAddress, abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'getPendingSettlementOperationIds', args: [] }),
		client.readContract({ address: managerAddress, abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'MAX_PENDING_SETTLEMENT_OPERATIONS', args: [] }),
		client.getBlock(),
	])
	if (!hasTimestampAndNumber(block)) throw new Error('Unexpected block response')
	if (bounty[13] !== 1n) throw new Error('Operation bounty is not open')
	if (block.timestamp > bounty[8]) throw new Error('Operation bounty acceptance deadline has passed')
	if (!isPriceValid && BigInt(pendingSettlementOperationIds.length) >= pendingSettlementQueueCapacity) throw new Error('Operation bounty cannot fit in the pending settlement queue')
	return { bounty, isPriceValid, pendingReportId, pendingReportSponsor: getAddress(rawPendingReportSponsor) }
}

function assertOracleOperationBountyInitialAttoWethBounds(initialAttoWeth: bigint, minimumInitialAttoWeth: bigint, maximumInitialAttoWeth: bigint) {
	if (initialAttoWeth < minimumInitialAttoWeth) throw new Error('The current initial report WETH amount is below this bounty’s minimum')
	if (maximumInitialAttoWeth > 0n && initialAttoWeth > maximumInitialAttoWeth) throw new Error('The current initial report WETH amount exceeds this bounty’s maximum')
}

async function loadPendingOpenOracleInitialAttoWeth(client: WriteClient, managerAddress: Address, pendingReportId: bigint) {
	const rawOpenOracleAddress = await client.readContract({ address: managerAddress, abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'openOracle', args: [] })
	const storedGame = await client.readContract({ address: getAddress(rawOpenOracleAddress), abi: peripherals_openOracle_OpenOracle_OpenOracle.abi, functionName: 'storedGame', args: [pendingReportId] })
	return storedGame[0]
}

export async function acceptOracleOperationBounty(client: WriteClient, managerAddress: Address, bountyId: bigint) {
	const boardAddress = getAddress(await client.readContract({ address: managerAddress, abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'operationBountyBoard', args: [] }))
	if (boardAddress === zeroAddress) throw new Error('This oracle coordinator does not have an operation bounty board')
	const initialSnapshot = await loadOracleOperationBountyAcceptanceSnapshot(client, managerAddress, boardAddress, bountyId)
	let proposedRepPerEthPrice = 0n
	let requestedInitialAttoWeth = 0n
	let value = 0n
	if (!initialSnapshot.isPriceValid) {
		if (initialSnapshot.pendingReportId === 0n) {
			requestedInitialAttoWeth = initialSnapshot.bounty[9]
			const fundingRequirement = await loadCoordinatorInitialReportFundingRequirement(client, managerAddress, client.account.address, undefined, requestedInitialAttoWeth)
			const initialReportAttoWeth = requestedInitialAttoWeth > fundingRequirement.minimumToken1ReportAttoEth ? requestedInitialAttoWeth : fundingRequirement.minimumToken1ReportAttoEth
			assertOracleOperationBountyInitialAttoWethBounds(initialReportAttoWeth, initialSnapshot.bounty[9], initialSnapshot.bounty[10])
			proposedRepPerEthPrice = fundingRequirement.proposedRepPerEthPrice
			await fundCoordinatorInitialReport(client, managerAddress, proposedRepPerEthPrice, requestedInitialAttoWeth)
		} else {
			if (!sameAddress(initialSnapshot.pendingReportSponsor, client.account.address)) throw new Error('Only the operator funding the pending OpenOracle report can accept another bounty before settlement')
			assertOracleOperationBountyInitialAttoWethBounds(await loadPendingOpenOracleInitialAttoWeth(client, managerAddress, initialSnapshot.pendingReportId), initialSnapshot.bounty[9], initialSnapshot.bounty[10])
		}
	}
	const finalSnapshot = await loadOracleOperationBountyAcceptanceSnapshot(client, managerAddress, boardAddress, bountyId)
	if (finalSnapshot.isPriceValid !== initialSnapshot.isPriceValid || finalSnapshot.pendingReportId !== initialSnapshot.pendingReportId || !sameAddress(finalSnapshot.pendingReportSponsor, initialSnapshot.pendingReportSponsor)) throw new Error('Oracle bounty acceptance state changed; retry')
	if (!finalSnapshot.isPriceValid) {
		if (finalSnapshot.pendingReportId === 0n) {
			const minimumToken1ReportAttoEth = await client.readContract({ address: managerAddress, abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'minimumToken1ReportAttoEth', args: [] })
			const initialReportAttoWeth = requestedInitialAttoWeth > minimumToken1ReportAttoEth ? requestedInitialAttoWeth : minimumToken1ReportAttoEth
			assertOracleOperationBountyInitialAttoWethBounds(initialReportAttoWeth, finalSnapshot.bounty[9], finalSnapshot.bounty[10])
			value = await loadBufferedOracleRequestEthCost(client, managerAddress)
		} else {
			if (!sameAddress(finalSnapshot.pendingReportSponsor, client.account.address)) throw new Error('Only the operator funding the pending OpenOracle report can accept another bounty before settlement')
			assertOracleOperationBountyInitialAttoWethBounds(await loadPendingOpenOracleInitialAttoWeth(client, managerAddress, finalSnapshot.pendingReportId), finalSnapshot.bounty[9], finalSnapshot.bounty[10])
		}
	}
	const hash = await writeContractAndWait(client, () => ({ address: boardAddress, abi: peripherals_OpenOracleOperationBountyBoard_OpenOracleOperationBountyBoard.abi, functionName: 'acceptOperationBounty', args: [bountyId, proposedRepPerEthPrice, requestedInitialAttoWeth], value }))
	return { action: 'acceptOperationBounty', hash } satisfies OpenOracleActionResult
}

async function settleOracleOperationBounty(client: WriteClient, managerAddress: Address, bountyId: bigint, action: 'claimOperationBounty' | 'refundOperationBounty') {
	const boardAddress = getAddress(await client.readContract({ address: managerAddress, abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'operationBountyBoard', args: [] }))
	if (boardAddress === zeroAddress) throw new Error('This oracle coordinator does not have an operation bounty board')
	const hash = await writeContractAndWait(client, () => ({ address: boardAddress, abi: peripherals_OpenOracleOperationBountyBoard_OpenOracleOperationBountyBoard.abi, functionName: action, args: [bountyId] }))
	return { action, hash } satisfies OpenOracleActionResult
}

export async function claimOracleOperationBounty(client: WriteClient, managerAddress: Address, bountyId: bigint) {
	return await settleOracleOperationBounty(client, managerAddress, bountyId, 'claimOperationBounty')
}

export async function refundOracleOperationBounty(client: WriteClient, managerAddress: Address, bountyId: bigint) {
	return await settleOracleOperationBounty(client, managerAddress, bountyId, 'refundOperationBounty')
}

export async function executeOracleManagerStagedOperation(client: WriteContractClient, managerAddress: Address, operationId: bigint) {
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => ({
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'executeStagedOperation',
		args: [operationId],
		gas: 5_000_000n,
	}))
	const stagedExecution = getStagedOracleExecutionResult(receipt, managerAddress, 'liquidation') ?? getStagedOracleExecutionResult(receipt, managerAddress, 'withdrawRep')
	return {
		action: 'executeStagedOperation',
		hash,
		...(stagedExecution === undefined ? {} : { stagedExecution }),
	} satisfies OpenOracleActionResult
}
export async function wrapWeth(client: WriteClient, amountAttoEth: bigint) {
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
		value: amountAttoEth,
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
	const [rawAttoEth, rawToken1, rawToken2] = await Promise.all([loadBalance(zeroAddress), loadBalance(token1), loadBalance(token2)])
	const availableBalance = (balance: bigint) => (balance > 1n ? balance - 1n : 0n)
	return {
		ethAttoEth: availableBalance(rawAttoEth),
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
	const derivedTokenToSwap = getOpenOracleDisputeSwapToken(state.latest.game, newAmount1, newAmount2)
	if (derivedTokenToSwap.toLowerCase() !== tokenToSwap.toLowerCase()) throw new Error('The dispute price direction does not match the selected swap token.')
	const hash = await writeContractAndWait(client, () => ({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'dispute',
		args: [reportId, newAmount1, newAmount2, client.account.address, false, false, getOpenOracleGameTuple(state.latest.game), getOpenOracleHelperTuple(state.latest.helper), [0n, 0n, 0n, 0n]],
	}))
	return {
		action: 'dispute',
		hash,
	} satisfies OpenOracleActionResult
}
export type LiquidationApprovalParams = {
	securityPool: Address
	receiverVault: Address
	operator: Address
	targetVault: Address
	maxCumulativeDebtAttoEth: bigint
	maxDebtPerLiquidationAttoEth: bigint
	minPostLiquidationHealthFactorBps: bigint
	validAfter: bigint
	validUntil: bigint
	nonce: bigint
}

export async function loadLiquidationApprovalRegistry(client: ReadClient, managerAddress: Address) {
	return await client.readContract({
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'liquidationApprovalRegistry',
		args: [],
	})
}

export async function loadLiquidationApproval(client: ReadClient, managerAddress: Address, approvalId: Hex): Promise<LiquidationApprovalDetails> {
	const registryAddress = await loadLiquidationApprovalRegistry(client, managerAddress)
	const approval = await client.readContract({
		address: registryAddress,
		abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
		functionName: 'getLiquidationApproval',
		args: [approvalId],
	})
	const minimumValidNonce = await client.readContract({
		address: registryAddress,
		abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
		functionName: 'minimumLiquidationApprovalNonce',
		args: [approval.params.receiverVault],
	})
	return { registryAddress, ...approval, minimumValidNonce }
}

export async function setLiquidationApproval(client: WriteClient, registryAddress: Address, params: LiquidationApprovalParams) {
	return await writeContractAndWait(client, () => ({
		address: registryAddress,
		abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
		functionName: 'setLiquidationApproval',
		args: [params],
	}))
}

export async function permitLiquidationApproval(client: WriteClient, registryAddress: Address, params: LiquidationApprovalParams, signature: Hex) {
	return await writeContractAndWait(client, () => ({
		address: registryAddress,
		abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
		functionName: 'permitLiquidationApproval',
		args: [params, signature],
	}))
}

export async function revokeLiquidationApproval(client: WriteClient, registryAddress: Address, approvalId: Hex) {
	return await writeContractAndWait(client, () => ({
		address: registryAddress,
		abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
		functionName: 'revokeLiquidationApproval',
		args: [approvalId],
	}))
}

export async function invalidateLiquidationApprovalNonce(client: WriteClient, registryAddress: Address, newNonce: bigint) {
	return await writeContractAndWait(client, () => ({
		address: registryAddress,
		abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
		functionName: 'invalidateLiquidationApprovalNonce',
		args: [newNonce],
	}))
}

export async function queueSecurityPoolLiquidation(client: WriteClient, managerAddress: Address, targetVault: Address, amount: bigint, validForSeconds: bigint, requestedInitialAttoWeth = 0n, receiverVault: Address = client.account.address, approvalId: Hex = `0x${'00'.repeat(32)}`) {
	const queueOperationValueAttoEth = await loadOracleManagerQueueOperationEthValue(client, managerAddress)
	const proposedRepPerEthPrice = queueOperationValueAttoEth > 0n ? await getCoordinatorInitialReportPrice(client, managerAddress, requestedInitialAttoWeth) : 0n
	if (queueOperationValueAttoEth > 0n) {
		await fundCoordinatorInitialReport(client, managerAddress, proposedRepPerEthPrice, requestedInitialAttoWeth)
	}
	const callParams = {
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'requestPriceIfNeededAndStageLiquidation',
		args: [targetVault, receiverVault, amount, approvalId, validForSeconds, proposedRepPerEthPrice, requestedInitialAttoWeth],
		value: queueOperationValueAttoEth,
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
export async function queueOracleManagerOperation(client: WriteClient, managerAddress: Address, operation: OracleQueueOperation, targetVault: Address, amount: bigint, validForSeconds: bigint, proposedRepPerEthPrice?: bigint, requestedInitialAttoWeth = 0n) {
	const queueOperationValueAttoEth = await loadOracleManagerQueueOperationEthValue(client, managerAddress)
	const resolvedInitialReportPrice = queueOperationValueAttoEth > 0n ? (proposedRepPerEthPrice ?? (await getCoordinatorInitialReportPrice(client, managerAddress, requestedInitialAttoWeth))) : (proposedRepPerEthPrice ?? 0n)
	if (queueOperationValueAttoEth > 0n) {
		await fundCoordinatorInitialReport(client, managerAddress, resolvedInitialReportPrice, requestedInitialAttoWeth)
	}
	const callParams = {
		address: managerAddress,
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'requestPriceIfNeededAndStageOperation',
		args: [encodeOracleQueueOperation(operation), targetVault, amount, validForSeconds, resolvedInitialReportPrice, requestedInitialAttoWeth],
		value: queueOperationValueAttoEth,
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
