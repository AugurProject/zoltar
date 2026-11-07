import type { Address, Hex, TransactionLog } from '@zoltar/core-shared/evm/ethereum'
import {
	decodeOpenOracleStatePreimage,
	getOpenOracleGameTuple,
	getOpenOracleHelperTuple,
	hasOpenOracleFlag,
	OPEN_ORACLE_FLAG_TIME_TYPE,
	OPEN_ORACLE_FLAG_TRACK_DISPUTES,
	OPEN_ORACLE_REPORT_DISPUTED_TOPIC,
	OPEN_ORACLE_REPORT_SETTLED_TOPIC,
	OPEN_ORACLE_REPORT_SUBMITTED_TOPIC,
	type OpenOracleStatePreimage,
} from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
import { WETH_ADDRESS } from '../constants'
import { statoblast_openOracle_OpenOracle_OpenOracle, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_tokens_ShareToken_ShareToken } from '../../../../types/contractArtifact'
import { QuestionOutcome } from '../../types/types'
import { getInfraContractAddresses } from './deployStatoblast'
import { HIGH_GAS_SIMULATOR_WRITE_GAS } from '../constants'
import { requireAddress } from '../utilities'
const PRICE_PRECISION = 10n ** 18n
const ERC20_APPROVE_ABI = [
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ name: '', type: 'bool' }],
	},
	{
		type: 'function',
		name: 'balanceOf',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }],
	},
] as const

const getCoordinatorMinimumToken1Report = async (client: ReadClient, openOraclePriceCoordinator: Address) =>
	await client.readContract({
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'minimumToken1ReportAttoEth',
		address: openOraclePriceCoordinator,
		args: [],
	})

export const getDefaultInitialReportPrice = async (client: ReadClient, openOraclePriceCoordinator: Address) => {
	const lastPrice = await getLastPrice(client, openOraclePriceCoordinator)
	return lastPrice > 0n ? lastPrice : PRICE_PRECISION
}

export const fundCoordinatorInitialReport = async (client: WriteClient, openOraclePriceCoordinator: Address, proposedRepPerEthPrice: bigint, requestedInitialAttoWeth = 0n) => {
	const [minimumToken1ReportAttoEth, rawReputationTokenAddress] = await Promise.all([
		getCoordinatorMinimumToken1Report(client, openOraclePriceCoordinator),
		client.readContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'reputationToken',
			address: openOraclePriceCoordinator,
			args: [],
		}),
	])
	const reputationTokenAddress = requireAddress(rawReputationTokenAddress, 'Oracle coordinator reputation token')
	const bufferedMinimumToken1Report = minimumToken1ReportAttoEth * 2n
	const maximumInitialAttoWeth = requestedInitialAttoWeth > bufferedMinimumToken1Report ? requestedInitialAttoWeth : bufferedMinimumToken1Report
	const maximumAmount2 = (maximumInitialAttoWeth * proposedRepPerEthPrice + PRICE_PRECISION - 1n) / PRICE_PRECISION
	const wethBalanceAttoEth: bigint = await client.readContract({
		abi: ERC20_APPROVE_ABI,
		functionName: 'balanceOf',
		address: WETH_ADDRESS,
		args: [client.account.address],
	})
	if (wethBalanceAttoEth < maximumInitialAttoWeth) {
		await wrapWeth(client, maximumInitialAttoWeth - wethBalanceAttoEth)
	}
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: ERC20_APPROVE_ABI,
			functionName: 'approve',
			address: WETH_ADDRESS,
			args: [openOraclePriceCoordinator, maximumInitialAttoWeth],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: ERC20_APPROVE_ABI,
			functionName: 'approve',
			address: reputationTokenAddress,
			args: [openOraclePriceCoordinator, maximumAmount2],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
	return { maximumAmount2, maximumInitialAttoWeth, minimumToken1ReportAttoEth, proposedRepPerEthPrice, requestedInitialAttoWeth }
}

export const requestPrice = async (client: WriteClient, openOraclePriceCoordinator: Address) => {
	const costAttoEth = await getRequestPriceCostAttoEth(client, openOraclePriceCoordinator)
	return await requestPriceWithValue(client, openOraclePriceCoordinator, costAttoEth, await getDefaultInitialReportPrice(client, openOraclePriceCoordinator))
}

export const requestPriceWithValue = async (client: WriteClient, openOraclePriceCoordinator: Address, value: bigint, proposedRepPerEthPrice?: bigint, requestedInitialAttoWeth = 0n, bountyAttoEth = value) => {
	const resolvedInitialReportPrice = proposedRepPerEthPrice ?? (await getDefaultInitialReportPrice(client, openOraclePriceCoordinator))
	await fundCoordinatorInitialReport(client, openOraclePriceCoordinator, resolvedInitialReportPrice, requestedInitialAttoWeth)
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: openOraclePriceCoordinator,
			args: [resolvedInitialReportPrice, requestedInitialAttoWeth, bountyAttoEth],
			value,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
}

export const recoverSettledPendingReport = async (client: WriteClient, openOraclePriceCoordinator: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'recoverSettledPendingReport',
			address: openOraclePriceCoordinator,
			args: [],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const getPendingReportId = async (client: ReadClient, openOraclePriceCoordinator: Address) =>
	await client.readContract({
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'pendingReportId',
		address: openOraclePriceCoordinator,
		args: [],
	})

export const getPendingReportMaxSettlementBaseFee = async (client: ReadClient, openOraclePriceCoordinator: Address) =>
	await client.readContract({
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'pendingReportMaxSettlementBaseFeeAttoEthPerGas',
		address: openOraclePriceCoordinator,
		args: [],
	})

export const getIsPriceValid = async (client: ReadClient, openOraclePriceCoordinator: Address) =>
	await client.readContract({
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'isPriceValid',
		address: openOraclePriceCoordinator,
		args: [],
	})

interface ExtraReportData {
	stateHash: Hex
	callbackContract: Address
	numReports: number
	callbackGasLimit: number
	protocolFeeRecipient: Address
	trackDisputes: boolean
}

interface ReportStatus {
	currentAmount1: bigint
	currentAmount2: bigint
	currentReporter: Address
	reportTimestamp: bigint
	settlementTimestamp: bigint
	initialReporter: Address
	lastReportOppoTime: bigint
}

type OpenOracleEventState = {
	initial: OpenOracleStatePreimage
	latest: OpenOracleStatePreimage
	reportCount: number
	settlementBlockNumber: bigint | undefined
}

function compareOpenOracleLogs(left: TransactionLog, right: TransactionLog) {
	const leftBlock = left.blockNumber ?? -1n
	const rightBlock = right.blockNumber ?? -1n
	if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1
	const leftIndex = left.logIndex ?? -1n
	const rightIndex = right.logIndex ?? -1n
	if (leftIndex === rightIndex) return 0
	return leftIndex < rightIndex ? -1 : 1
}

export const loadOpenOracleEventState = async (client: ReadClient, reportId: bigint): Promise<OpenOracleEventState> => {
	const address = getInfraContractAddresses().openOracle
	const logs = await client.getLogs({ address, fromBlock: 0n })
	let state: OpenOracleEventState | undefined
	for (const log of [...logs].sort(compareOpenOracleLogs)) {
		const signature = log.topics[0]?.toLowerCase()
		const reportIdTopic = log.topics[1]
		if (reportIdTopic === undefined || BigInt(reportIdTopic) !== reportId) continue
		if (signature === OPEN_ORACLE_REPORT_SUBMITTED_TOPIC.toLowerCase() || signature === OPEN_ORACLE_REPORT_DISPUTED_TOPIC.toLowerCase()) {
			const preimage = decodeOpenOracleStatePreimage(log.data, reportId)
			state = state === undefined ? { initial: preimage, latest: preimage, reportCount: 1, settlementBlockNumber: undefined } : { ...state, latest: preimage, reportCount: state.reportCount + 1 }
		} else if (signature === OPEN_ORACLE_REPORT_SETTLED_TOPIC.toLowerCase() && state !== undefined) {
			state.settlementBlockNumber = log.blockNumber ?? undefined
		}
	}
	if (state === undefined) throw new Error(`OpenOracle report ${reportId.toString()} does not exist`)
	if (state.settlementBlockNumber !== undefined) {
		const block = await client.getBlock({ blockNumber: state.settlementBlockNumber })
		const settlementTimestamp = hasOpenOracleFlag(state.latest.game, OPEN_ORACLE_FLAG_TIME_TYPE) ? block.timestamp : state.settlementBlockNumber
		state.latest = { ...state.latest, game: { ...state.latest.game, settlementTimestamp } }
	}
	return state
}

export const getOpenOracleExtraData = async (client: ReadClient, extraDataId: bigint): Promise<ExtraReportData> => {
	const state = await loadOpenOracleEventState(client, extraDataId)
	const stateHash = await client.readContract({
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'oracleGame',
		address: getInfraContractAddresses().openOracle,
		args: [extraDataId],
	})
	return {
		stateHash,
		callbackContract: state.latest.game.callbackContract,
		numReports: state.reportCount,
		callbackGasLimit: Number.parseInt(state.latest.game.callbackGasLimit.toString(), 10),
		protocolFeeRecipient: state.latest.game.protocolFeeRecipient,
		trackDisputes: hasOpenOracleFlag(state.latest.game, OPEN_ORACLE_FLAG_TRACK_DISPUTES),
	}
}

export const getOpenOracleReportStatus = async (client: ReadClient, reportId: bigint): Promise<ReportStatus> => {
	const state = await loadOpenOracleEventState(client, reportId)
	return {
		currentAmount1: state.latest.game.currentAmount1,
		currentAmount2: state.latest.game.currentAmount2,
		currentReporter: state.latest.game.currentReporter,
		reportTimestamp: state.latest.game.reportTimestamp,
		settlementTimestamp: state.latest.game.settlementTimestamp,
		initialReporter: state.initial.game.currentReporter,
		lastReportOppoTime: state.latest.game.lastReportOppoTime,
	}
}

export const openOracleSettle = async (client: WriteClient, reportId: bigint) => {
	const state = await loadOpenOracleEventState(client, reportId)
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'settle',
			address: getInfraContractAddresses().openOracle,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
			args: [reportId, getOpenOracleGameTuple(state.latest.game), getOpenOracleHelperTuple(state.latest.helper)],
		}),
	)
}

export const openOracleSettleWithGasPrice = async (client: WriteClient, reportId: bigint, gasPrice: bigint) => {
	const state = await loadOpenOracleEventState(client, reportId)
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'settle',
			address: getInfraContractAddresses().openOracle,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
			gasPrice,
			args: [reportId, getOpenOracleGameTuple(state.latest.game), getOpenOracleHelperTuple(state.latest.helper)],
		}),
	)
}

export const getRequestPriceCostAttoEth = async (client: ReadClient, openOraclePriceCoordinator: Address) =>
	await client.readContract({
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'getRequestPriceCostAttoEth',
		address: openOraclePriceCoordinator,
		args: [],
	})

export const wrapWeth = async (client: WriteClient, amount: bigint) => {
	const wethAbi = [
		{
			type: 'function',
			name: 'deposit',
			stateMutability: 'payable',
			inputs: [],
			outputs: [],
		},
	]
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: wethAbi,
			address: WETH_ADDRESS,
			functionName: 'deposit',
			value: amount,
		}),
	)
}

interface ReportMeta {
	exactToken1Report: bigint
	escalationHalt: bigint
	fee: bigint
	settlerRewardAttoEth: bigint
	token1: Address
	settlementTime: bigint
	token2: Address
	timeType: boolean
	feePercentage: bigint
	protocolFee: bigint
	multiplier: bigint
	disputeDelay: bigint
}

export const getOpenOracleReportMeta = async (client: ReadClient, reportId: bigint): Promise<ReportMeta> => {
	const state = await loadOpenOracleEventState(client, reportId)
	const game = state.latest.game
	return {
		exactToken1Report: state.initial.game.currentAmount1,
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
	}
}

export const getLastPrice = async (client: ReadClient, openOraclePriceCoordinator: Address) =>
	await client.readContract({
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'lastPrice',
		address: openOraclePriceCoordinator,
		args: [],
	})

export const balanceOfShares = async (client: ReadClient, shareTokenAddress: Address, universeId: bigint, account: Address) =>
	await client.readContract({
		abi: statoblast_tokens_ShareToken_ShareToken.abi,
		functionName: 'balanceOfShares',
		address: shareTokenAddress,
		args: [universeId, account],
	})

const getTokenId = (universeId: bigint, outcome: QuestionOutcome) => {
	const universeMask = (1n << 248n) - 1n
	return ((universeId & universeMask) << 8n) | (BigInt(outcome) & 255n)
}

export const migrateShares = async (client: WriteClient, shareTokenAddress: Address, fromUniverseId: bigint, outcome: QuestionOutcome, targetOutcomeIndexes: (number | bigint)[]) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_tokens_ShareToken_ShareToken.abi,
			functionName: 'migrate',
			address: shareTokenAddress,
			args: [getTokenId(fromUniverseId, outcome), targetOutcomeIndexes.map(value => BigInt(value))],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
