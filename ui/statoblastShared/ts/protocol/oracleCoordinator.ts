import { decodeEventLog, getAddress, zeroAddress, type Address, type Hex, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { isIgnorableLogDecodeError } from '@zoltar/ui-core-shared/lib/errors.js'
import { resolveOracleOperationEthFunding } from './oracleRequestFunding.js'
import { getOracleManagerPriceValidUntilTimestamp } from './oracleTiming.js'
import { addOpenOracleBountyBuffer, addOpenOracleInitialReportFundingBuffer } from './openOracleMath.js'
import { loadOpenOracleInitialReportPrice } from './openOraclePricing.js'
import { decodeOracleQueueOperation, encodeOracleQueueOperation } from './oracleQueueOperation.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import type { OpenOracleActionResult, OracleManagerDetails, OracleQueueOperation, ReadClient, StagedOracleExecutionResult, StagedOracleQueuedResult, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { requireStagedOperationTupleArray } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { type WriteContractClient, readRequiredMulticall, writeContractAndWait, writeContractAndWaitForReceipt } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { loadOpenOracleEventState } from './openOracleState.js'
import { requireBigintArray, requireBigintValue } from './decoders.js'
import { wrapWeth } from './openOracle.js'

type CoordinatorInitialReportClient = Parameters<typeof loadOpenOracleInitialReportPrice>[0]
const ACTIVE_STAGED_OPERATION_PREVIEW_LIMIT = 25n
const COORDINATOR_PRICE_PRECISION = 10n ** 18n

function getStagedOracleExecutionResult(receipt: TransactionReceipt, managerAddress: Address, expectedOperation: OracleQueueOperation): StagedOracleExecutionResult | undefined {
	for (const log of receipt.logs) {
		if (!sameAddress(log.address, managerAddress)) continue
		try {
			const decodedLog = decodeEventLog({
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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

export async function loadOracleManagerDetails(client: ReadClient, managerAddress: Address, openOracleAddress?: Address): Promise<OracleManagerDetails> {
	const [lastPrice, pendingOperationSlotId, pendingSettlementOperationIds, pendingSettlementQueueCapacity, pendingReportId, queuedOperationCostAttoEth, requestPriceCostAttoEth, rawIsPriceValid, lastSettlementTimestamp, activeStagedOperationCount, settlementTime] = await readRequiredMulticall(client, [
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastPrice',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'pendingOperationSlotId',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getPendingSettlementOperationIds',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'MAX_PENDING_SETTLEMENT_OPERATIONS',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'pendingReportId',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getQueuedOperationCostAttoEth',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getRequestPriceCostAttoEth',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'isPriceValid',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getActiveStagedOperationCount',
			address: managerAddress,
			args: [],
		},
		{
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'settlementTime',
			address: managerAddress,
			args: [],
		},
	])
	const normalizedPendingSettlementOperationIds = requireBigintArray(pendingSettlementOperationIds, 'pending settlement operation ids')
	const normalizedPendingSettlementQueueCapacity = requireBigintValue(pendingSettlementQueueCapacity, 'pending settlement queue capacity')
	const normalizedQueuedOperationEthCost = requireBigintValue(queuedOperationCostAttoEth, 'queued operation ETH cost')
	const normalizedRequestPriceEthCost = requireBigintValue(requestPriceCostAttoEth, 'request price ETH cost')
	const resolvedOracleAddress = openOracleAddress ?? getInfraContractAddresses().openOracle
	let callbackStateHash: Hex | undefined
	let exactToken1Report: bigint | undefined
	let pendingOperation: import('@zoltar/ui-core-shared/types/contracts.js').StagedOracleOperation | undefined
	let stagedOperations: import('@zoltar/ui-core-shared/types/contracts.js').StagedOracleOperation[] = []
	let token1: Address | undefined
	let token2: Address | undefined
	if (activeStagedOperationCount > 0n) {
		const previewCount = activeStagedOperationCount < ACTIVE_STAGED_OPERATION_PREVIEW_LIMIT ? activeStagedOperationCount : ACTIVE_STAGED_OPERATION_PREVIEW_LIMIT
		const activeStagedOperationsResponse = await client.readContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
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
		queuedOperationCostAttoEth: normalizedQueuedOperationEthCost,
		requestPriceCostAttoEth: normalizedRequestPriceEthCost,
		settlementTime,
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

async function loadBufferedOracleRequestEthCost(client: WriteClient, managerAddress: Address) {
	const requestPriceCostAttoEth = await client.readContract({
		address: managerAddress,
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'getRequestPriceCostAttoEth',
		args: [],
	})
	return addOpenOracleBountyBuffer(requestPriceCostAttoEth)
}

export async function loadOracleManagerQueueOperationEthValue(client: Pick<WriteClient, 'readContract'>, managerAddress: Address) {
	const [lastPrice, pendingSettlementOperationIds, pendingSettlementQueueCapacity, pendingReportId, queuedOperationCostAttoEth, requestPriceCostAttoEth, rawIsPriceValid] = await Promise.all([
		client.readContract({
			address: managerAddress,
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'lastPrice',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getPendingSettlementOperationIds',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'MAX_PENDING_SETTLEMENT_OPERATIONS',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'pendingReportId',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getQueuedOperationCostAttoEth',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getRequestPriceCostAttoEth',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'isPriceValid',
			args: [],
		}),
		client.readContract({
			address: managerAddress,
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
export async function executeOracleManagerStagedOperation(client: WriteContractClient, managerAddress: Address, operationId: bigint) {
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => ({
		address: managerAddress,
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
export async function queueSecurityPoolLiquidation(client: WriteClient, managerAddress: Address, targetVault: Address, amount: bigint, validForSeconds: bigint, requestedInitialAttoWeth = 0n, receiverVault: Address = client.account.address, approvalId: Hex = `0x${'00'.repeat(32)}`) {
	const queueOperationValueAttoEth = await loadOracleManagerQueueOperationEthValue(client, managerAddress)
	const proposedRepPerEthPrice = queueOperationValueAttoEth > 0n ? await getCoordinatorInitialReportPrice(client, managerAddress, requestedInitialAttoWeth) : 0n
	if (queueOperationValueAttoEth > 0n) {
		await fundCoordinatorInitialReport(client, managerAddress, proposedRepPerEthPrice, requestedInitialAttoWeth)
	}
	const callParams = {
		address: managerAddress,
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
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
