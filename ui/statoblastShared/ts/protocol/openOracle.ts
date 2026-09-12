import { bigintToSafeNumber, zeroAddress, type Address, type Hex, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hasOpenOracleFlag, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_STORE_PRICE, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_FLAG_TRACK_DISPUTES, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getOpenOracleDisputeSwapTokenKey } from './openOracleMath.js'
import { getOpenOracleCreateParameterValidationMessage } from './openOracleValidation.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
import { statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import type { OpenOracleActionResult, OpenOracleWithdrawableBalances, ReadClient, OpenOracleReportSummary, OpenOracleReportSummaryPage, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { getProtocolPageOffset, hasTimestampAndNumber } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { type WriteContractClient, readRequiredMulticall, writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getOpenOracleAddress } from './deploymentHelpers.js'
import { loadOpenOracleEventState, loadOpenOracleEventStates } from './openOracleState.js'
import { requireBigintValue } from './decoders.js'

const OPEN_ORACLE_PRICE_UNITS = 30n
const OPEN_ORACLE_REPORT_MISSING_ERROR_NAME = 'OpenOracleReportMissingError'

function createOpenOracleReportMissingError(reportId: bigint) {
	const error = new Error(`Oracle report #${reportId.toString()} does not exist`)
	error.name = OPEN_ORACLE_REPORT_MISSING_ERROR_NAME
	return error
}

export function isOpenOracleReportMissingError(error: unknown) {
	return error instanceof Error && error.name === OPEN_ORACLE_REPORT_MISSING_ERROR_NAME
}

function getOpenOracleDisputeSwapToken(game: Pick<OpenOracleStatePreimage['game'], 'currentAmount1' | 'currentAmount2' | 'token1' | 'token2'>, newAmount1: bigint, newAmount2: bigint) {
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

function calculateOpenOraclePrice(amount1: bigint, amount2: bigint) {
	return amount2 === 0n ? 0n : (amount1 * 10n ** OPEN_ORACLE_PRICE_UNITS) / amount2
}

export async function loadOpenOracleReportDetails(client: ReadClient, openOracleAddress: Address, reportId: bigint): Promise<import('@zoltar/ui-core-shared/types/contracts.js').OpenOracleReportDetails> {
	const [eventState, stateHash, block] = await Promise.all([
		loadOpenOracleEventState(client, openOracleAddress, reportId).catch(error => {
			if (error instanceof Error && error.message === `Oracle report #${reportId.toString()} does not exist`) throw createOpenOracleReportMissingError(reportId)
			throw error
		}),
		client.readContract({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
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
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
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
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
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
				abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
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
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
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
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
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
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'dispute',
		args: [reportId, newAmount1, newAmount2, client.account.address, false, false, getOpenOracleGameTuple(state.latest.game), getOpenOracleHelperTuple(state.latest.helper), [0n, 0n, 0n, 0n]],
	}))
	return {
		action: 'dispute',
		hash,
	} satisfies OpenOracleActionResult
}
