import { type Address, type TransactionReceipt } from '@zoltar/shared/ethereum'
import { sortBigIntsAscending } from '@zoltar/shared/bigInt'
import { assertNever } from '../lib/assert.js'
import { peripherals_SecurityPool_SecurityPool, peripherals_tokens_ShareToken_ShareToken } from '../contractArtifact.js'
import type { ReadClient, ReportingOutcomeKey, TradingActionResult, TradingDetails, TradingShareBalances, WriteClient } from '../types/contracts.js'
import { getMinBigintValue, isBigintTriple } from './helpers.js'
import { type WriteContractClient, readRequiredMulticall, writeContractAndWait } from './core.js'
import { readSecurityPoolUniverseId } from './securityPoolActions.js'

type ReadWriteContractClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = Pick<ReadClient, 'readContract'> & WriteContractClient<TReceipt>
type SecurityPoolMintCapacity = {
	completeSetCollateralAmount: bigint
	shareTokenSupply: bigint
	totalRepDeposit: bigint
	totalSecurityBondAllowance: bigint
}
export async function loadSecurityPoolMintCapacity(client: Pick<ReadClient, 'multicall'>, securityPoolAddress: Address): Promise<SecurityPoolMintCapacity> {
	const [completeSetCollateralAmount, shareTokenSupply, totalRepDeposit, totalSecurityBondAllowance] = await readRequiredMulticall(client, [
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'completeSetCollateralAmount',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'shareTokenSupply',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getTotalRepBalance',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'totalSecurityBondAllowance',
			address: securityPoolAddress,
			args: [],
		},
	])
	return {
		completeSetCollateralAmount,
		shareTokenSupply,
		totalRepDeposit,
		totalSecurityBondAllowance,
	}
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
