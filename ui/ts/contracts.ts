import { decodeEventLog, parseAbiItem, zeroAddress, type Address, type ContractFunctionParameters, type Hash, type Hex, type TransactionReceipt } from 'viem'
import { ABIS } from './abis.js'
import { sortBigIntsAscending } from './shared/bigInt.js'
import { assertNever } from './lib/assert.js'
import { getOracleManagerPriceValidUntilTimestamp } from './lib/securityVault.js'
import { addOpenOracleBountyBuffer } from './lib/openOracle.js'
import { getWethAddress } from './lib/uniswapQuoter.js'
import {
	Zoltar_Zoltar,
	peripherals_EscalationGame_EscalationGame,
	peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator,
	peripherals_SecurityPool_SecurityPool,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_openOracle_OpenOracle_OpenOracle,
	peripherals_tokens_ShareToken_ShareToken,
} from './contractArtifact.js'
import type {
	DeploymentStepId,
	EscalationDeposit,
	EscalationSide,
	ForkAuctionAction,
	ForkAuctionActionResult,
	ForkAuctionDetails,
	ListedSecurityPool,
	OpenOracleActionResult,
	OracleManagerDetails,
	OracleQueueOperation,
	ReadClient,
	OpenOracleReportSummary,
	OpenOracleReportSummaryPage,
	ReportingActionResult,
	ReportingDetails,
	ReportingOutcomeKey,
	SecurityPoolVaultSummary,
	StagedOracleExecutionResult,
	SecurityVaultActionResult,
	TradingActionResult,
	TradingDetails,
	TradingShareBalances,
	TruthAuctionMetrics,
	WriteClient,
	ZoltarChildUniverseActionResult,
	ZoltarForkActionResult,
	ZoltarMigrationActionResult,
} from './types/contracts.js'
import {
	getEscalationSideLabel,
	getMinBigintValue,
	getQuestionIdHex,
	getReportingOutcomeKey,
	getReportingOutcomeValue,
	getSecurityPoolSystemState,
	hasTimestamp,
	hasTimestampAndNumber,
	isBigintTriple,
	isEscalationDepositPage,
	requireOpenOracleExtraDataTuple,
	requireOpenOracleReportMetaTuple,
	requireOpenOracleReportMetaTupleArray,
	requireOpenOracleReportStatusTuple,
	requireOpenOracleReportStatusTupleArray,
	requireSecurityVaultTupleArray,
	toUint8Array,
} from './contracts/helpers.js'
import { type ContractRevertReasonParams, readRequiredMulticall, writeContractAndWait, writeContractAndWaitForReceipt } from './contracts/core.js'
import { getInfraContractAddresses, getOpenOracleAddress } from './contracts/deploymentHelpers.js'
export { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Allowance, loadErc20Balance } from './contracts/deployment.js'
import { getDeploymentSteps } from './contracts/deployment.js'
export { createSecurityPool, loadSecurityVaultDetails, originSecurityPoolExists } from './contracts/securityPools.js'
export { createMarket, loadAllZoltarQuestions, loadMarketDetails, loadZoltarQuestionCount, loadZoltarUniverseSummary } from './contracts/zoltar.js'
import { loadMarketDetails } from './contracts/zoltar.js'
export { readOptionalMulticall } from './contracts/core.js'

export { getMulticall3Address, getOpenOracleAddress, getZoltarAddress } from './contracts/deploymentHelpers.js'
const LIQUIDATION_OPERATION_TYPE = 0
const MIGRATION_TIME_LENGTH = 4_838_400n
const TRUTH_AUCTION_TIME_LENGTH = 604_800n
const QUESTION_OUTCOME_ABI = [parseAbiItem('function getQuestionOutcome(address securityPool) view returns (uint8 outcome)')]

const CONTRACT_PAGE_SIZE = 30n

type ForkDataTuple = readonly [bigint, Address, bigint, bigint, bigint, boolean, number]
type AuctionClearingTuple = readonly [boolean, bigint, bigint, bigint]

type SecurityPoolDeploymentQueryResult = {
	completeSetCollateralAmount: bigint
	currentRetentionRate: bigint
	parent: Address
	priceOracleManagerAndOperatorQueuer: Address
	questionId: bigint
	securityMultiplier: bigint
	securityPool: Address
	shareToken: Address
	truthAuction: Address
	universeId: bigint
}

function getOracleQueueOperationFromEventOperation(operation: bigint) {
	switch (operation) {
		case 0n:
			return 'liquidation'
		case 1n:
			return 'withdrawRep'
		case 2n:
			return 'setSecurityBondsAllowance'
		default:
			throw new Error(`Unexpected staged oracle operation: ${operation.toString()}`)
	}
}

function getStagedOracleExecutionResult(receipt: TransactionReceipt, expectedOperation: OracleQueueOperation): StagedOracleExecutionResult | undefined {
	for (const log of receipt.logs) {
		try {
			const decodedLog = decodeEventLog({
				abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decodedLog.eventName !== 'ExecutedStagedOperation') continue
			const operation = getOracleQueueOperationFromEventOperation(BigInt(decodedLog.args.operation))
			if (operation !== expectedOperation) continue
			const errorMessage = decodedLog.args.errorMessage.trim() === '' ? undefined : decodedLog.args.errorMessage
			return {
				errorMessage,
				operation,
				operationId: decodedLog.args.operationId,
				success: decodedLog.args.success,
			} satisfies StagedOracleExecutionResult
		} catch {
			continue
		}
	}
	return undefined
}
async function readSecurityPoolUniverseId(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address) {
	return await client.readContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'universeId',
		args: [],
	})
}

function getDeploymentStep(id: DeploymentStepId) {
	const step = getDeploymentSteps().find(candidate => candidate.id === id)
	if (step === undefined) throw new Error(`Unknown deployment step: ${id}`)
	return step
}

async function loadEscalationDeposits(client: ReadClient, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<EscalationDeposit[]> {
	let currentIndex = 0n
	const deposits: EscalationDeposit[] = []

	while (true) {
		const page = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: escalationGameAddress,
			functionName: 'getDepositsByOutcome',
			args: [getReportingOutcomeValue(outcome), currentIndex, CONTRACT_PAGE_SIZE],
		})
		if (!isEscalationDepositPage(page)) throw new Error('Unexpected escalation deposits response')

		const normalizedPage = page
			.map((deposit, index) => ({
				amount: deposit.amount,
				cumulativeAmount: deposit.cumulativeAmount,
				depositIndex: currentIndex + BigInt(index),
				depositor: deposit.depositor,
			}))
			.filter(deposit => deposit.depositor !== zeroAddress)

		deposits.push(...normalizedPage)
		if (BigInt(normalizedPage.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	}

	return deposits
}

async function loadViewerReportingVaultState(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined) {
	if (accountAddress === undefined) {
		return {
			viewerVaultAvailableEscalationRep: undefined,
			viewerVaultExists: false,
			viewerVaultLockedRepInEscalationGame: undefined,
			viewerVaultRepDepositShare: undefined,
		}
	}

	const viewerVaultTuple = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'securityVaults',
		address: securityPoolAddress,
		args: [accountAddress],
	})
	const viewerVaultTuples = requireSecurityVaultTupleArray([viewerVaultTuple], 'viewer security vault tuple')
	const [viewerPoolOwnership, viewerSecurityBondAllowance, viewerUnpaidEthFees, viewerFeeIndex, viewerLockedRepInEscalationGame] = viewerVaultTuples[0] ?? []
	if (typeof viewerPoolOwnership !== 'bigint' || typeof viewerSecurityBondAllowance !== 'bigint' || typeof viewerUnpaidEthFees !== 'bigint' || typeof viewerFeeIndex !== 'bigint' || typeof viewerLockedRepInEscalationGame !== 'bigint') {
		throw new Error('Unexpected viewer security vault tuple response')
	}

	const viewerVaultRepDepositShare =
		viewerPoolOwnership === 0n
			? 0n
			: await client.readContract({
					abi: peripherals_SecurityPool_SecurityPool.abi,
					functionName: 'poolOwnershipToRep',
					address: securityPoolAddress,
					args: [viewerPoolOwnership],
				})
	const viewerVaultExists = viewerPoolOwnership !== 0n || viewerSecurityBondAllowance !== 0n || viewerUnpaidEthFees !== 0n || viewerFeeIndex !== 0n || viewerLockedRepInEscalationGame !== 0n
	const viewerVaultAvailableEscalationRep = viewerVaultRepDepositShare > viewerLockedRepInEscalationGame ? viewerVaultRepDepositShare - viewerLockedRepInEscalationGame : 0n

	return {
		viewerVaultAvailableEscalationRep,
		viewerVaultExists,
		viewerVaultLockedRepInEscalationGame: viewerLockedRepInEscalationGame,
		viewerVaultRepDepositShare,
	}
}

export async function loadReportingDetails(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<ReportingDetails> {
	const [questionId, escalationGameAddress, completeSetCollateralAmount, universeId, zoltarAddress, initialEscalationGameDeposit] = await readRequiredMulticall(client, [
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'questionId',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'completeSetCollateralAmount',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'universeId',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'zoltar',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'initialEscalationGameDeposit',
			address: securityPoolAddress,
			args: [],
		},
	])
	const [marketDetails, block, escalationGameCode, viewerVaultState, forkThreshold] = await Promise.all([
		loadMarketDetails(client, questionId),
		client.getBlock(),
		escalationGameAddress === zeroAddress ? Promise.resolve('0x' as const) : client.getCode({ address: escalationGameAddress }),
		loadViewerReportingVaultState(client, securityPoolAddress, accountAddress),
		client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: zoltarAddress,
			functionName: 'getForkThreshold',
			args: [universeId],
		}),
	])
	if (!hasTimestamp(block)) throw new Error('Unexpected block response')
	if (escalationGameAddress === zeroAddress || escalationGameCode === undefined || escalationGameCode === '0x') {
		return {
			completeSetCollateralAmount,
			currentTime: block.timestamp,
			marketDetails,
			nonDecisionThreshold: forkThreshold / 2n,
			questionOutcome: 'none',
			resolution: 'none',
			securityPoolAddress,
			startBond: initialEscalationGameDeposit,
			status: 'not-started',
			universeId,
			withdrawalEnabled: false,
			withdrawalState: 'not-finalized',
			...viewerVaultState,
		}
	}

	const [startBond, nonDecisionThreshold, startingTime, totalCost, bindingCapital, balances, resolution, escalationEndTime, questionOutcome, universeForkTime, hasReachedNonDecision] = await readRequiredMulticall(client, [
		{
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'startBond',
			address: escalationGameAddress,
			args: [],
		},
		{
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'nonDecisionThreshold',
			address: escalationGameAddress,
			args: [],
		},
		{
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'startingTime',
			address: escalationGameAddress,
			args: [],
		},
		{
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCost',
			address: escalationGameAddress,
			args: [],
		},
		{
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getBindingCapital',
			address: escalationGameAddress,
			args: [],
		},
		{
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getBalances',
			address: escalationGameAddress,
			args: [],
		},
		{
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getQuestionResolution',
			address: escalationGameAddress,
			args: [],
		},
		{
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getEscalationGameEndDate',
			address: escalationGameAddress,
			args: [],
		},
		{
			abi: QUESTION_OUTCOME_ABI,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		},
		{
			abi: Zoltar_Zoltar.abi,
			functionName: 'getForkTime',
			address: getInfraContractAddresses().zoltar,
			args: [universeId],
		},
		{
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'hasReachedNonDecision',
			address: escalationGameAddress,
			args: [],
		},
	])
	if (!isBigintTriple(balances)) throw new Error('Unexpected escalation balances response')
	const [invalidDeposits, yesDeposits, noDeposits] = await Promise.all([loadEscalationDeposits(client, escalationGameAddress, 'invalid'), loadEscalationDeposits(client, escalationGameAddress, 'yes'), loadEscalationDeposits(client, escalationGameAddress, 'no')])

	const sides: EscalationSide[] = [
		{ balance: balances[0] ?? 0n, deposits: invalidDeposits, key: 'invalid', label: getEscalationSideLabel('invalid'), userDeposits: accountAddress === undefined ? [] : invalidDeposits.filter(deposit => deposit.depositor === accountAddress) },
		{ balance: balances[1] ?? 0n, deposits: yesDeposits, key: 'yes', label: getEscalationSideLabel('yes'), userDeposits: accountAddress === undefined ? [] : yesDeposits.filter(deposit => deposit.depositor === accountAddress) },
		{ balance: balances[2] ?? 0n, deposits: noDeposits, key: 'no', label: getEscalationSideLabel('no'), userDeposits: accountAddress === undefined ? [] : noDeposits.filter(deposit => deposit.depositor === accountAddress) },
	]
	const normalizedQuestionOutcome = getReportingOutcomeKey(questionOutcome)
	const withdrawalState = normalizedQuestionOutcome !== 'none' ? 'resolved' : universeForkTime > 0n && hasReachedNonDecision === false ? 'canceled-by-external-fork' : 'not-finalized'

	return {
		bindingCapital,
		completeSetCollateralAmount,
		currentRequiredBond: totalCost === 0n ? startBond : totalCost,
		currentTime: block.timestamp,
		escalationEndTime,
		escalationGameAddress,
		marketDetails,
		nonDecisionThreshold,
		questionOutcome: normalizedQuestionOutcome,
		resolution: getReportingOutcomeKey(resolution),
		securityPoolAddress,
		sides,
		startBond,
		status: 'active',
		startingTime,
		totalCost,
		universeId,
		withdrawalEnabled: withdrawalState !== 'not-finalized',
		withdrawalState,
		...viewerVaultState,
	}
}

async function getSecurityPoolVaultCount(client: ReadClient, securityPoolAddress: Address) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getVaultCount',
		address: securityPoolAddress,
		args: [],
	})
}

async function getSecurityPoolVaults(client: ReadClient, securityPoolAddress: Address, startIndex: bigint, count: bigint) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getVaults',
		address: securityPoolAddress,
		args: [startIndex, count],
	})
}

async function loadSecurityPoolVaultSummaries(client: ReadClient, securityPoolAddress: Address): Promise<{ vaultCount: bigint; vaults: SecurityPoolVaultSummary[] }> {
	const vaultCount = await getSecurityPoolVaultCount(client, securityPoolAddress)
	const vaultAddresses = vaultCount === 0n ? [] : await getSecurityPoolVaults(client, securityPoolAddress, 0n, vaultCount)
	if (vaultAddresses.length === 0) return { vaultCount, vaults: [] }

	const vaultDataContracts: ContractFunctionParameters[] = vaultAddresses.map(vaultAddress => ({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'securityVaults',
		address: securityPoolAddress,
		args: [vaultAddress],
	}))
	const vaultDataResults = await readRequiredMulticall(client, vaultDataContracts)
	const vaultData = requireSecurityVaultTupleArray(vaultDataResults, 'security vault tuple')
	const poolOwnershipContracts: { contract: ContractFunctionParameters; index: number }[] = []
	for (const [index, currentVaultData] of vaultData.entries()) {
		const poolOwnership = currentVaultData[0]
		if (poolOwnership === undefined || poolOwnership === 0n) continue
		poolOwnershipContracts.push({
			index,
			contract: {
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'poolOwnershipToRep',
				address: securityPoolAddress,
				args: [poolOwnership],
			},
		})
	}
	const repDeposits = new Map<number, bigint>()
	if (poolOwnershipContracts.length > 0) {
		const repDepositResults = await readRequiredMulticall(
			client,
			poolOwnershipContracts.map(current => current.contract),
		)
		for (const [resultIndex, repDepositShare] of repDepositResults.entries()) {
			const poolOwnershipContract = poolOwnershipContracts[resultIndex]
			if (poolOwnershipContract === undefined) throw new Error('Unexpected pool ownership contract result')
			if (typeof repDepositShare !== 'bigint') throw new Error('Unexpected rep deposit result')
			repDeposits.set(poolOwnershipContract.index, repDepositShare)
		}
	}

	const vaults = vaultAddresses.map((vaultAddress, index) => {
		const currentVaultData = vaultData[index]
		if (currentVaultData === undefined) throw new Error('Unexpected vault data response')
		const [, securityBondAllowance, unpaidEthFees, , lockedRepInEscalationGame] = currentVaultData
		return {
			lockedRepInEscalationGame,
			repDepositShare: repDeposits.get(index) ?? 0n,
			securityBondAllowance,
			unpaidEthFees,
			vaultAddress,
		} satisfies SecurityPoolVaultSummary
	})
	return { vaultCount, vaults }
}

export async function approveErc20<Action extends SecurityVaultActionResult['action'] | OpenOracleActionResult['action'] | ZoltarForkActionResult['action']>(client: WriteClient, tokenAddress: Address, spenderAddress: Address, amount: bigint, action: Action) {
	const hash = await writeContractAndWait(client, () => ({
		address: tokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [spenderAddress, amount],
	}))
	return { action, hash }
}

export async function depositRepToSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositRep',
		args: [amount],
	}))
	return {
		action: 'depositRep',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function updateSecurityVaultFees(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'updateVaultFees',
		args: [vaultAddress],
	}))
	return {
		action: 'updateVaultFees',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function redeemSecurityVaultFees(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemFees',
		args: [vaultAddress],
	}))
	return {
		action: 'redeemFees',
		hash,
	} satisfies SecurityVaultActionResult
}

export async function loadOracleManagerDetails(client: ReadClient, managerAddress: Address, openOracleAddress?: Address): Promise<OracleManagerDetails> {
	const [lastPrice, pendingOperationSlotId, pendingReportId, requestPriceEthCost, rawIsPriceValid, lastSettlementTimestamp] = await readRequiredMulticall(client, [
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'lastPrice',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'pendingOperationSlotId',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'pendingReportId',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'getRequestPriceEthCost',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'isPriceValid',
			address: managerAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'lastSettlementTimestamp',
			address: managerAddress,
			args: [],
		},
	])

	const resolvedOracleAddress = openOracleAddress ?? getInfraContractAddresses().openOracle

	let callbackStateHash: Hex | undefined
	let exactToken1Report: bigint | undefined
	let pendingOperation: import('./types/contracts.js').StagedOracleOperation | undefined
	let token1: Address | undefined
	let token2: Address | undefined

	if (pendingOperationSlotId > 0n) {
		const stagedOperation = await client.readContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'getPendingOperationSlot',
			address: managerAddress,
			args: [],
		})

		if (stagedOperation.amount > 0n) {
			pendingOperation = {
				amount: stagedOperation.amount,
				initiatorVault: stagedOperation.initiatorVault,
				operation: resolveOracleQueueOperation(stagedOperation.operation),
				operationId: pendingOperationSlotId,
				targetVault: stagedOperation.targetVault,
			}
		}
	}

	if (pendingReportId > 0n) {
		const [extraData, reportMeta] = await readRequiredMulticall(client, [
			{
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'extraData',
				address: resolvedOracleAddress,
				args: [pendingReportId],
			},
			{
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'reportMeta',
				address: resolvedOracleAddress,
				args: [pendingReportId],
			},
		])

		callbackStateHash = extraData[0]
		exactToken1Report = reportMeta[0]
		token1 = reportMeta[4]
		token2 = reportMeta[6]
	}

	return {
		callbackStateHash,
		exactToken1Report,
		isPriceValid: lastSettlementTimestamp > 0n && rawIsPriceValid,
		lastPrice,
		lastSettlementTimestamp,
		managerAddress,
		openOracleAddress: resolvedOracleAddress,
		pendingOperation,
		pendingOperationSlotId,
		pendingReportId,
		priceValidUntilTimestamp: getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp),
		requestPriceEthCost,
		token1,
		token2,
	}
}

function resolveOracleQueueOperation(operation: bigint | number): OracleQueueOperation {
	switch (Number(operation)) {
		case 0:
			return 'liquidation'
		case 1:
			return 'withdrawRep'
		case 2:
			return 'setSecurityBondsAllowance'
		default:
			throw new Error(`Unknown oracle operation: ${operation}`)
	}
}

export async function loadOpenOracleReportDetails(client: ReadClient, openOracleAddress: Address, reportId: bigint): Promise<import('./types/contracts.js').OpenOracleReportDetails> {
	const [[meta, status, extra], block] = await Promise.all([
		readRequiredMulticall(client, [
			{
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'reportMeta',
				address: openOracleAddress,
				args: [reportId],
			},
			{
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'reportStatus',
				address: openOracleAddress,
				args: [reportId],
			},
			{
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'extraData',
				address: openOracleAddress,
				args: [reportId],
			},
		]),
		client.getBlock(),
	])
	const reportMeta = requireOpenOracleReportMetaTuple(meta, 'open oracle report meta')
	const reportStatus = requireOpenOracleReportStatusTuple(status, 'open oracle report status')
	const reportExtra = requireOpenOracleExtraDataTuple(extra, 'open oracle report extra')
	if (!hasTimestampAndNumber(block)) throw new Error('Unexpected block response')
	if (reportMeta[4] === zeroAddress) throw new Error(`Oracle report #${reportId.toString()} does not exist`)
	const [token1Decimals, token2Decimals, token1Symbol, token2Symbol] = await readRequiredMulticall(client, [
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'decimals',
			address: reportMeta[4],
			args: [],
		},
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'decimals',
			address: reportMeta[6],
			args: [],
		},
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'symbol',
			address: reportMeta[4],
			args: [],
		},
		{
			abi: ABIS.mainnet.erc20,
			functionName: 'symbol',
			address: reportMeta[6],
			args: [],
		},
	])

	return {
		reportId,
		openOracleAddress,
		currentTime: block.timestamp,
		currentBlockNumber: block.number,
		exactToken1Report: reportMeta[0],
		escalationHalt: reportMeta[1],
		fee: reportMeta[2],
		settlerReward: reportMeta[3],
		token1: reportMeta[4],
		settlementTime: BigInt(reportMeta[5]),
		token2: reportMeta[6],
		timeType: reportMeta[7],
		feePercentage: BigInt(reportMeta[8]),
		protocolFee: BigInt(reportMeta[9]),
		multiplier: BigInt(reportMeta[10]),
		disputeDelay: BigInt(reportMeta[11]),
		currentAmount1: reportStatus[0],
		currentAmount2: reportStatus[1],
		price: reportStatus[2],
		currentReporter: reportStatus[3],
		reportTimestamp: BigInt(reportStatus[4]),
		settlementTimestamp: BigInt(reportStatus[5]),
		initialReporter: reportStatus[6],
		disputeOccurred: reportStatus[8],
		isDistributed: reportStatus[9],
		stateHash: reportExtra[0],
		callbackContract: reportExtra[1],
		numReports: BigInt(reportExtra[2]),
		callbackGasLimit: Number(reportExtra[3]),
		callbackSelector: reportExtra[4],
		protocolFeeRecipient: reportExtra[5],
		trackDisputes: reportExtra[6],
		keepFee: reportExtra[7],
		feeToken: reportExtra[8],
		lastReportOppoTime: BigInt(reportStatus[7]),
		token1Decimals: Number(token1Decimals),
		token2Decimals: Number(token2Decimals),
		token1Symbol: String(token1Symbol),
		token2Symbol: String(token2Symbol),
	}
}

export async function loadOpenOracleReportSummaries(client: ReadClient, pageIndex: number, pageSize: number): Promise<OpenOracleReportSummaryPage> {
	if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error('Page index must be a non-negative integer')
	if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('Page size must be a positive integer')

	const openOracleAddress = getOpenOracleAddress()
	const nextReportId = await client.readContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'nextReportId',
		address: openOracleAddress,
		args: [],
	})
	const reportCount = nextReportId > 0n ? nextReportId - 1n : 0n

	if (reportCount === 0n) {
		return {
			nextReportId,
			pageIndex,
			pageSize,
			reportCount,
			reports: [],
		}
	}

	const pageSizeBigInt = BigInt(pageSize)
	const pageIndexBigInt = BigInt(pageIndex)
	const pageEndId = reportCount - pageIndexBigInt * pageSizeBigInt

	if (pageEndId <= 0n) {
		return {
			nextReportId,
			pageIndex,
			pageSize,
			reportCount,
			reports: [],
		}
	}

	const pageStartId = pageEndId > pageSizeBigInt ? pageEndId - pageSizeBigInt + 1n : 1n
	const reportIds: bigint[] = []
	for (let reportId = pageEndId; reportId >= pageStartId; reportId--) {
		reportIds.push(reportId)
		if (reportId === pageStartId) break
	}
	const [metaResults, statusResults] = await Promise.all([
		readRequiredMulticall(
			client,
			reportIds.map(reportId => ({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'reportMeta',
				address: openOracleAddress,
				args: [reportId],
			})),
		),
		readRequiredMulticall(
			client,
			reportIds.map(reportId => ({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'reportStatus',
				address: openOracleAddress,
				args: [reportId],
			})),
		),
	])
	const metas = requireOpenOracleReportMetaTupleArray(metaResults, 'open oracle report metas')
	const statuses = requireOpenOracleReportStatusTupleArray(statusResults, 'open oracle report statuses')
	const tokenAddresses = new Set<Address>()
	for (const meta of metas) {
		if (meta[4] !== zeroAddress) tokenAddresses.add(meta[4])
		if (meta[6] !== zeroAddress) tokenAddresses.add(meta[6])
	}
	const uniqueTokenAddresses = [...tokenAddresses]
	const tokenMetadata = new Map<Address, { decimals: number; symbol: string }>()
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
			tokenMetadata.set(tokenAddress, {
				decimals: Number(decimals),
				symbol: String(symbol),
			})
		}
	}

	const reports = reportIds.map((reportId, index) => {
		const meta = metas[index]
		const status = statuses[index]
		if (meta === undefined || status === undefined) throw new Error('Unexpected oracle report summary response')
		const token1Metadata = tokenMetadata.get(meta[4])
		const token2Metadata = tokenMetadata.get(meta[6])
		if (token1Metadata === undefined || token2Metadata === undefined) throw new Error('Unexpected oracle token metadata response')
		return {
			currentAmount1: status[0],
			currentAmount2: status[1],
			currentReporter: status[3],
			disputeOccurred: status[8],
			exactToken1Report: meta[0],
			isDistributed: status[9],
			price: status[2],
			reportId,
			reportTimestamp: BigInt(status[4]),
			settlementTimestamp: BigInt(status[5]),
			token1: meta[4],
			token2: meta[6],
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
		if (!Number.isSafeInteger(value)) {
			throw new Error(`${label} exceeds the maximum safe integer range`)
		}
	}

	assertSafeInteger(parameters.disputeDelay, 'Dispute delay')
	assertSafeInteger(parameters.feePercentage, 'Fee percentage')
	assertSafeInteger(parameters.multiplier, 'Multiplier')
	assertSafeInteger(parameters.protocolFee, 'Protocol fee')
	assertSafeInteger(parameters.settlementTime, 'Settlement time')

	const callParams = {
		address: getOpenOracleAddress(),
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'createReportInstance',
		args: [parameters.token1Address, parameters.token2Address, parameters.exactToken1Report, parameters.feePercentage, parameters.multiplier, parameters.settlementTime, parameters.escalationHalt, parameters.disputeDelay, parameters.protocolFee, parameters.settlerReward],
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
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'getRequestPriceEthCost',
		args: [],
	})

	return addOpenOracleBountyBuffer(requestPriceEthCost)
}

export async function requestOraclePrice(client: WriteClient, managerAddress: Address) {
	const callParams = {
		address: managerAddress,
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'requestPrice',
		args: [],
		value: await loadBufferedOracleRequestEthCost(client, managerAddress),
	}
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'requestPrice',
		hash,
	} satisfies OpenOracleActionResult
}

export async function executeOracleManagerStagedOperation(client: WriteClient, managerAddress: Address, operationId: bigint) {
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => ({
		address: managerAddress,
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'executeStagedOperation',
		args: [operationId],
	}))
	const stagedExecution = getStagedOracleExecutionResult(receipt, 'liquidation') ?? getStagedOracleExecutionResult(receipt, 'withdrawRep') ?? getStagedOracleExecutionResult(receipt, 'setSecurityBondsAllowance')
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

export async function submitInitialOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint, amount1: bigint, amount2: bigint, stateHash: Hex) {
	const hash = await writeContractAndWait(client, () => ({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'submitInitialReport',
		args: [reportId, amount1, amount2, stateHash],
	}))
	return {
		action: 'submitInitialReport',
		hash,
	} satisfies OpenOracleActionResult
}

export async function settleOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'settle',
		gas: 5_000_000n,
		args: [reportId],
	}))
	return {
		action: 'settle',
		hash,
	} satisfies OpenOracleActionResult
}

export async function disputeOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint, tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint, amt2Expected: bigint, stateHash: Hex) {
	const hash = await writeContractAndWait(client, () => ({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'disputeAndSwap',
		args: [reportId, tokenToSwap, newAmount1, newAmount2, amt2Expected, stateHash],
	}))
	return {
		action: 'dispute',
		hash,
	} satisfies OpenOracleActionResult
}

export async function loadForkAuctionDetails(client: ReadClient, securityPoolAddress: Address): Promise<ForkAuctionDetails> {
	const [[questionId, parentSecurityPoolAddress, universeId, systemStateValue, truthAuctionAddress, completeSetCollateralAmount, forkData, questionOutcome], block] = await Promise.all([
		readRequiredMulticall(client, [
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'questionId',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'parent',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'universeId',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'systemState',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'truthAuction',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'completeSetCollateralAmount',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'forkData',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			},
			{
				abi: QUESTION_OUTCOME_ABI,
				functionName: 'getQuestionOutcome',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			},
		]),
		client.getBlock(),
	])
	if (!hasTimestamp(block)) throw new Error('Unexpected block response')
	const marketDetails = await loadMarketDetails(client, questionId)
	const forkDataTuple: ForkDataTuple = forkData
	const [repAtFork, , truthAuctionStartedAt, migratedRep, auctionedSecurityBondAllowance, forkOwnSecurityPool, forkOutcomeIndex] = forkDataTuple
	const systemState = getSecurityPoolSystemState(systemStateValue)
	const universeForkTime =
		truthAuctionStartedAt > 0n
			? undefined
			: (
					await readRequiredMulticall(client, [
						{
							abi: Zoltar_Zoltar.abi,
							functionName: 'getForkTime',
							address: getInfraContractAddresses().zoltar,
							args: [universeId],
						},
					])
				)[0]
	const migrationEndsAt = truthAuctionStartedAt > 0n || universeForkTime === undefined ? undefined : universeForkTime + MIGRATION_TIME_LENGTH

	let truthAuction: TruthAuctionMetrics | undefined
	if (truthAuctionAddress !== zeroAddress && truthAuctionStartedAt > 0n) {
		const [computeClearingResult, ethRaiseCap, ethRaised, finalized, maxRepBeingSold, minBidSize, totalRepPurchased, underfunded] = await readRequiredMulticall(client, [
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'computeClearing',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'ethRaiseCap',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'ethRaised',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'finalized',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'maxRepBeingSold',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'minBidSize',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'totalRepPurchased',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'underfunded',
				address: truthAuctionAddress,
				args: [],
			},
		])
		const computeClearingTuple: AuctionClearingTuple = computeClearingResult
		const [hitCap, clearingTick, accumulatedEth, ethAtClearingTick] = computeClearingTuple
		const clearingPrice =
			clearingTick === 0n && accumulatedEth === 0n
				? undefined
				: await client.readContract({
						abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
						functionName: 'tickToPrice',
						address: truthAuctionAddress,
						args: [clearingTick],
					})

		truthAuction = {
			accumulatedEth,
			auctionEndsAt: truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH,
			clearingPrice,
			clearingTick,
			ethAtClearingTick,
			ethRaiseCap,
			ethRaised,
			finalized,
			hitCap,
			maxRepBeingSold,
			minBidSize,
			repPurchasableAtBid: clearingPrice === undefined || clearingPrice === 0n ? undefined : (ethRaiseCap * 10n ** 18n) / clearingPrice,
			timeRemaining: finalized ? 0n : block.timestamp >= truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH ? 0n : truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH - block.timestamp,
			totalRepPurchased,
			underfunded,
		}
	}

	return {
		auctionedSecurityBondAllowance,
		claimingAvailable: systemState === 'operational' && truthAuctionAddress !== zeroAddress,
		completeSetCollateralAmount,
		currentTime: block.timestamp,
		forkOutcome: getReportingOutcomeKey(forkOutcomeIndex),
		forkOwnSecurityPool,
		marketDetails,
		migratedRep,
		migrationEndsAt,
		parentSecurityPoolAddress,
		questionOutcome: getReportingOutcomeKey(questionOutcome),
		repAtFork,
		securityPoolAddress,
		systemState,
		truthAuction,
		truthAuctionAddress,
		truthAuctionStartedAt,
		universeId,
	}
}

async function executeForkAuctionAction(client: WriteClient, action: ForkAuctionAction, securityPoolAddress: Address, universeId: bigint, request: () => Promise<Hash>) {
	const hash = await request()
	await client.waitForTransactionReceipt({ hash })
	return {
		action,
		hash,
		securityPoolAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}

export async function forkZoltarWithOwnEscalation(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'forkWithOwnEscalation',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'forkZoltarWithOwnEscalationGame',
				args: [securityPoolAddress],
			})),
	)
}

export async function initiateSecurityPoolFork(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'initiateFork',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'initiateSecurityPoolFork',
				args: [securityPoolAddress],
			})),
	)
}

export async function createChildUniverseFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	return await executeForkAuctionAction(
		client,
		'createChildUniverse',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'createChildUniverse',
				args: [securityPoolAddress, getReportingOutcomeValue(outcome)],
			})),
	)
}

export async function createZoltarChildUniverse(client: WriteClient, universeId: bigint, outcomeIndex: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getDeploymentStep('zoltar').address,
		abi: Zoltar_Zoltar.abi,
		functionName: 'deployChild',
		args: [universeId, outcomeIndex],
	}))
	return {
		action: 'createChildUniverse',
		hash,
		outcomeIndex,
		universeId,
	} satisfies ZoltarChildUniverseActionResult
}

async function executeZoltarMigrationAction<TCallParams extends ContractRevertReasonParams>(client: WriteClient, action: ZoltarMigrationActionResult['action'], universeId: bigint, amount: bigint, outcomeIndexes: bigint[], callParams: TCallParams) {
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action,
		amount,
		hash,
		outcomeIndexes,
		universeId,
	} satisfies ZoltarMigrationActionResult
}

export async function prepareRepForMigrationInZoltar(client: WriteClient, universeId: bigint, amount: bigint) {
	const callParams = {
		address: getDeploymentStep('zoltar').address,
		abi: Zoltar_Zoltar.abi,
		functionName: 'addRepToMigrationBalance',
		args: [universeId, amount],
	}
	return await executeZoltarMigrationAction(client, 'addRepToMigrationBalance', universeId, amount, [], callParams)
}

export async function migrateInternalRepInZoltar(client: WriteClient, universeId: bigint, amount: bigint, outcomeIndexes: bigint[]) {
	const callParams = {
		address: getDeploymentStep('zoltar').address,
		abi: Zoltar_Zoltar.abi,
		functionName: 'splitMigrationRep',
		args: [universeId, amount, outcomeIndexes],
	}
	return await executeZoltarMigrationAction(client, 'splitMigrationRep', universeId, amount, outcomeIndexes, callParams)
}

export async function migrateRepToZoltarFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcomes: ReportingOutcomeKey[]) {
	return await executeForkAuctionAction(
		client,
		'migrateRepToZoltar',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateRepToZoltar',
				args: [securityPoolAddress, outcomes.map(outcome => BigInt(getReportingOutcomeValue(outcome)))],
			})),
	)
}

export async function migrateSecurityVault(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	return await executeForkAuctionAction(
		client,
		'migrateVault',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateVault',
				args: [securityPoolAddress, getReportingOutcomeValue(outcome)],
			})),
	)
}

export async function migrateEscalationDeposits(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) {
	return await executeForkAuctionAction(
		client,
		'migrateEscalationDeposits',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateFromEscalationGame',
				args: [securityPoolAddress, vaultAddress, getReportingOutcomeValue(outcome), toUint8Array(depositIndexes)],
			})),
	)
}

export async function startTruthAuctionForSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'startTruthAuction',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'startTruthAuction',
				args: [securityPoolAddress],
			})),
	)
}

export async function submitTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, amount: bigint) {
	return await executeForkAuctionAction(client, 'submitBid', securityPoolAddress, universeId, async () => {
		const callParams = {
			address: truthAuctionAddress,
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'submitBid',
			args: [tick],
			value: amount,
		}
		return await writeContractAndWait(client, () => callParams)
	})
}

export async function refundTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, bidIndex: bigint) {
	return await executeForkAuctionAction(
		client,
		'refundLosingBids',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: truthAuctionAddress,
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'refundLosingBids',
				args: [[{ tick, bidIndex }]],
			})),
	)
}

export async function finalizeSecurityPoolTruthAuction(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'finalizeTruthAuction',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'finalizeTruthAuction',
				args: [securityPoolAddress],
			})),
	)
}

export async function claimSecurityPoolAuctionProceeds(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, tick: bigint, bidIndex: bigint) {
	return await executeForkAuctionAction(
		client,
		'claimAuctionProceeds',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'claimAuctionProceeds',
				args: [securityPoolAddress, vaultAddress, [{ tick, bidIndex }]],
			})),
	)
}

export async function loadAllSecurityPools(client: ReadClient): Promise<ListedSecurityPool[]> {
	const deploymentCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
	})

	const deployments: readonly SecurityPoolDeploymentQueryResult[] =
		deploymentCount === 0n
			? []
			: await client.readContract({
					address: getInfraContractAddresses().securityPoolFactory,
					abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
					functionName: 'securityPoolDeploymentsRange',
					args: [0n, deploymentCount],
				})

	return await Promise.all(
		deployments.map(async deployment => {
			const { parent, priceOracleManagerAndOperatorQueuer: managerAddress, questionId, securityMultiplier, securityPool: securityPoolAddress, truthAuction: truthAuctionAddress, universeId } = deployment
			const [[completeSetCollateralAmount, currentRetentionRate, forkData, lastOraclePrice, lastSettlementTimestamp, questionOutcome, systemState, totalSecurityBondAllowance, universeForkTime], marketDetails] = await Promise.all([
				readRequiredMulticall(client, [
					{
						abi: peripherals_SecurityPool_SecurityPool.abi,
						functionName: 'completeSetCollateralAmount',
						address: securityPoolAddress,
						args: [],
					},
					{
						abi: peripherals_SecurityPool_SecurityPool.abi,
						functionName: 'currentRetentionRate',
						address: securityPoolAddress,
						args: [],
					},
					{
						abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
						functionName: 'forkData',
						address: getInfraContractAddresses().securityPoolForker,
						args: [securityPoolAddress],
					},
					{
						abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
						functionName: 'lastPrice',
						address: managerAddress,
						args: [],
					},
					{
						abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
						functionName: 'lastSettlementTimestamp',
						address: managerAddress,
						args: [],
					},
					{
						abi: QUESTION_OUTCOME_ABI,
						functionName: 'getQuestionOutcome',
						address: getInfraContractAddresses().securityPoolForker,
						args: [securityPoolAddress],
					},
					{
						abi: peripherals_SecurityPool_SecurityPool.abi,
						functionName: 'systemState',
						address: securityPoolAddress,
						args: [],
					},
					{
						abi: peripherals_SecurityPool_SecurityPool.abi,
						functionName: 'totalSecurityBondAllowance',
						address: securityPoolAddress,
						args: [],
					},
					{
						abi: Zoltar_Zoltar.abi,
						functionName: 'getForkTime',
						address: getInfraContractAddresses().zoltar,
						args: [universeId],
					},
				]),
				loadMarketDetails(client, questionId),
			])
			const forkDataTuple: ForkDataTuple = forkData
			const [, , truthAuctionStartedAt, migratedRep, , forkOwnSecurityPool, forkOutcomeIndex] = forkDataTuple

			const { vaultCount, vaults } = await loadSecurityPoolVaultSummaries(client, securityPoolAddress)
			const totalRepDeposit = vaults.reduce((sum, vault) => sum + vault.repDepositShare, 0n)
			return {
				completeSetCollateralAmount,
				currentRetentionRate,
				forkOutcome: getReportingOutcomeKey(forkOutcomeIndex),
				forkOwnSecurityPool,
				lastOraclePrice: lastSettlementTimestamp > 0n ? lastOraclePrice : undefined,
				lastOracleSettlementTimestamp: lastSettlementTimestamp,
				managerAddress,
				marketDetails,
				migratedRep,
				parent,
				questionOutcome: getReportingOutcomeKey(questionOutcome),
				questionId: getQuestionIdHex(questionId),
				securityMultiplier,
				securityPoolAddress,
				systemState: getSecurityPoolSystemState(systemState),
				totalRepDeposit,
				totalSecurityBondAllowance,
				truthAuctionAddress,
				truthAuctionStartedAt,
				universeHasForked: universeForkTime > 0n,
				universeId,
				vaultCount,
				vaults,
			}
		}),
	)
}

export async function loadTradingDetails(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<TradingDetails> {
	if (accountAddress === undefined) {
		const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
		return {
			maxRedeemableCompleteSets: undefined,
			shareBalances: undefined,
			universeId,
		}
	}

	const [universeId, shareTokenAddress] = await readRequiredMulticall(client, [
		{
			address: securityPoolAddress,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'universeId',
			args: [],
		},
		{
			address: securityPoolAddress,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'shareToken',
			args: [],
		},
	])

	const shareBalancesResult = await client.readContract({
		address: shareTokenAddress,
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'balanceOfShares',
		args: [universeId, accountAddress],
	})

	if (!isBigintTriple(shareBalancesResult)) throw new Error('Unexpected trading share balances response')

	const shareBalances: TradingShareBalances = {
		invalid: shareBalancesResult[0],
		no: shareBalancesResult[2],
		yes: shareBalancesResult[1],
	}

	return {
		maxRedeemableCompleteSets: getMinBigintValue([shareBalances.invalid, shareBalances.yes, shareBalances.no]),
		shareBalances,
		universeId,
	}
}

export async function queueSecurityPoolLiquidation(client: WriteClient, managerAddress: Address, targetVault: Address, amount: bigint) {
	const callParams = {
		address: managerAddress,
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'requestPriceIfNeededAndStageOperation',
		args: [LIQUIDATION_OPERATION_TYPE, targetVault, amount],
		value: await loadBufferedOracleRequestEthCost(client, managerAddress),
	}
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => callParams)
	const stagedExecution = getStagedOracleExecutionResult(receipt, 'liquidation')
	return {
		hash,
		...(stagedExecution === undefined ? {} : { stagedExecution }),
	}
}

function getOracleOperationType(operation: OracleQueueOperation) {
	switch (operation) {
		case 'liquidation':
			return 0
		case 'withdrawRep':
			return 1
		case 'setSecurityBondsAllowance':
			return 2
		default:
			return assertNever(operation)
	}
}

function getShareMigrationOutcomeValue(outcome: ReportingOutcomeKey) {
	switch (outcome) {
		case 'invalid':
			return 0n
		case 'yes':
			return 1n
		case 'no':
			return 2n
		default:
			return assertNever(outcome)
	}
}

function getShareTokenId(universeId: bigint, outcome: ReportingOutcomeKey) {
	const universeMask = (1n << 248n) - 1n
	return ((universeId & universeMask) << 8n) | (getShareMigrationOutcomeValue(outcome) & 255n)
}

export async function queueOracleManagerOperation(client: WriteClient, managerAddress: Address, operation: OracleQueueOperation, targetVault: Address, amount: bigint) {
	const callParams = {
		address: managerAddress,
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'requestPriceIfNeededAndStageOperation',
		args: [getOracleOperationType(operation), targetVault, amount],
		value: await loadBufferedOracleRequestEthCost(client, managerAddress),
	}
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => callParams)
	const stagedExecution = getStagedOracleExecutionResult(receipt, operation)
	return {
		action: 'queueOperation',
		hash,
		...(stagedExecution === undefined ? {} : { stagedExecution }),
	} satisfies OpenOracleActionResult
}

export async function redeemSharesInSecurityPool(client: WriteClient, securityPoolAddress: Address) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemShares',
		args: [],
	}))
	return {
		action: 'redeemShares',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}

export async function migrateSharesFromUniverse(client: WriteClient, securityPoolAddress: Address, shareOutcome: ReportingOutcomeKey, targetOutcomeIndexes: bigint[]) {
	const sortedTargetOutcomeIndexes = sortBigIntsAscending(targetOutcomeIndexes)
	const [universeId, shareTokenAddress] = await Promise.all([
		readSecurityPoolUniverseId(client, securityPoolAddress),
		client.readContract({
			address: securityPoolAddress,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'shareToken',
			args: [],
		}),
	])
	const hash = await writeContractAndWait(client, () => ({
		address: shareTokenAddress,
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'migrate',
		args: [getShareTokenId(universeId, shareOutcome), sortedTargetOutcomeIndexes],
	}))
	return {
		action: 'migrateShares',
		hash,
		securityPoolAddress,
		shareOutcome,
		targetOutcomeIndexes: sortedTargetOutcomeIndexes,
		universeId,
	} satisfies TradingActionResult
}

export async function forkUniverseDirectly(client: WriteClient, universeId: bigint, questionId: bigint, securityPoolAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: getInfraContractAddresses().zoltar,
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		args: [universeId, questionId],
	}))
	return {
		action: 'forkUniverse',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}

export async function forkZoltarUniverse(client: WriteClient, universeId: bigint, questionId: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getInfraContractAddresses().zoltar,
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		args: [universeId, questionId],
	}))
	return {
		action: 'forkZoltar',
		hash,
		questionId: getQuestionIdHex(questionId),
		universeId,
	} satisfies ZoltarForkActionResult
}

export async function withdrawTruthAuctionBids(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, withdrawFor: Address, tick: bigint, bidIndex: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: truthAuctionAddress,
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'withdrawBids',
		args: [withdrawFor, [{ tick, bidIndex }]],
	}))
	return {
		action: 'withdrawBids',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}

export async function createCompleteSetInSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const callParams = {
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'createCompleteSet',
		args: [],
		value: amount,
	}
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'createCompleteSet',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}

export async function redeemCompleteSetInSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemCompleteSet',
		args: [amount],
	}))
	return {
		action: 'redeemCompleteSet',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}

export async function reportOutcomeInSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amount: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositToEscalationGame',
		args: [getReportingOutcomeValue(outcome), amount],
	}))
	return {
		action: 'reportOutcome',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}

export async function withdrawEscalationFromSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'withdrawFromEscalationGame',
		args: [getReportingOutcomeValue(outcome), depositIndexes],
	}))
	return {
		action: 'withdrawEscalation',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}
