import { type Address, type TransactionReceipt } from '@zoltar/shared/ethereum'
import { sortBigIntsAscending } from '@zoltar/shared/bigInt'
import { assertNever } from '../lib/assert.js'
import { peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, peripherals_SecurityPool_SecurityPool, peripherals_tokens_ShareToken_ShareToken, ZoltarQuestionData_ZoltarQuestionData } from '../contractArtifact.js'
import type { ReadClient, ReportingOutcomeKey, TradingActionResult, TradingDetails, TradingShareBalances, WriteClient } from '../types/contracts.js'
import { getMinBigintValue, isBigintTriple } from './helpers.js'
import { type WriteContractClient, readRequiredMulticall, writeContractAndWait } from './core.js'
import { readSecurityPoolUniverseId } from './securityPoolActions.js'

type ReadWriteContractClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = Pick<ReadClient, 'readContract'> & WriteContractClient<TReceipt>
type SecurityPoolMintCapacity = {
	currentRetentionRate?: bigint
	currentTimestamp?: bigint
	feeEndTimestamp?: bigint
	feeIndexRemainder?: bigint
	lastUpdatedFeeAccumulator?: bigint
	settlementCollateralAttoEth: bigint
	feeEligibleCapacityOwnershipAttoRep: bigint
	mintingCapacityAttoEth: bigint
	shareTokenSupplyAttoShares: bigint
	totalPoolHeldAttoRep: bigint
	totalCapacityOwnershipAttoRep: bigint
	isPriceValid: boolean
	totalFeesOwedRemainder?: bigint
}
export async function loadSecurityPoolMintCapacity(client: Pick<ReadClient, 'getBlock' | 'multicall'>, securityPoolAddress: Address): Promise<SecurityPoolMintCapacity> {
	const [poolAccountingSnapshot, shareTokenSupplyAttoShares, totalPoolHeldAttoRep, mintingCapacityAttoEth, priceOracleManagerAndOperatorQueuer, currentRetentionRate, questionData, questionId] = await readRequiredMulticall(client, [
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getPoolAccountingSnapshot',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'shareTokenSupplyAttoShares',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getTotalPoolHeldAttoRep',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getCurrentMintingCapacityAttoEth',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'priceOracleManagerAndOperatorQueuer',
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
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'questionData',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'questionId',
			address: securityPoolAddress,
			args: [],
		},
	])
	const [priceValidity, questionEnd, currentBlock] = await Promise.all([
		readRequiredMulticall(client, [{ abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'isPriceValid', address: priceOracleManagerAndOperatorQueuer, args: [] }]),
		readRequiredMulticall(client, [{ abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getQuestionEndDate', address: questionData, args: [questionId] }]),
		client.getBlock(),
	])
	const [isPriceValid] = priceValidity
	const [feeEndTimestamp] = questionEnd
	return {
		currentRetentionRate,
		currentTimestamp: currentBlock.timestamp,
		feeEndTimestamp,
		feeIndexRemainder: poolAccountingSnapshot.feeIndexRemainder,
		lastUpdatedFeeAccumulator: poolAccountingSnapshot.lastUpdatedFeeAccumulator,
		settlementCollateralAttoEth: poolAccountingSnapshot.settlementCollateralAttoEth,
		feeEligibleCapacityOwnershipAttoRep: poolAccountingSnapshot.feeEligibleCapacityOwnershipAttoRep,
		mintingCapacityAttoEth,
		shareTokenSupplyAttoShares,
		totalPoolHeldAttoRep,
		totalCapacityOwnershipAttoRep: poolAccountingSnapshot.totalCapacityOwnershipAttoRep,
		isPriceValid,
		totalFeesOwedRemainder: poolAccountingSnapshot.totalFeesOwedRemainder,
	}
}
export async function loadTradingDetails(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<TradingDetails> {
	if (accountAddress === undefined) {
		const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
		return {
			maxRedeemableCompleteSetsAttoShares: undefined,
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
		invalidAttoShares: shareBalancesResult[0],
		noAttoShares: shareBalancesResult[2],
		yesAttoShares: shareBalancesResult[1],
	}
	return {
		maxRedeemableCompleteSetsAttoShares: getMinBigintValue([shareBalances.invalidAttoShares, shareBalances.yesAttoShares, shareBalances.noAttoShares]),
		shareBalances,
		universeId,
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
export async function migrateSharesFromUniverse<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: ReadWriteContractClient<TReceipt>, securityPoolAddress: Address, shareOutcome: ReportingOutcomeKey, targetOutcomeIndexes: bigint[]) {
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
