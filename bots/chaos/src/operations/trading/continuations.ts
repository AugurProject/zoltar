import { erc1155Abi, twoWayConstantProductPairAbi } from '@zoltar/bot-shared/contracts/abi'
import { decodeFunctionData, getAddress, isAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { shareTokenId } from '../statoblast/planning.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationPlan, PairSnapshot, PoolSnapshot, ShareInventory } from '../types.ts'
import { receiveRequestData } from './pool-state.ts'

/** Runs a calldata decoder or matcher and maps any thrown `Error` to `undefined`; non-`Error` throws still propagate. */
export function undefinedOnError<T>(evaluate: () => T) {
	try {
		return evaluate()
	} catch (error) {
		if (error instanceof Error) return undefined
		throw error
	}
}

export function metadataAddress(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	return typeof value === 'string' && isAddress(value) ? getAddress(value) : undefined
}

export function metadataPositiveAmount(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined
	return BigInt(value)
}

export function metadataOutcome(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	return value === 1 || value === 2 ? value : undefined
}

export function metadataPair(snapshot: EcosystemSnapshot, metadata: OperationPlan['metadata']) {
	const pairAddress = metadataAddress(metadata, 'pair')
	const poolAddress = metadataAddress(metadata, 'pool')
	if (pairAddress === undefined || poolAddress === undefined) return undefined
	return snapshot.pairs.find(candidate => sameAddress(candidate.address, pairAddress) && sameAddress(candidate.pool, poolAddress))
}

function previousAction(context: OperationContinuationContext, id: string, target: Address) {
	const step = context.previousPlan.steps.find(candidate => candidate.id === id)
	return step === undefined || !sameAddress(step.to, target) ? undefined : step
}

/** Matches a decoded ABI argument against an expected address; the argument must itself be a valid address. */
function decodedAddressMatches(value: unknown, expected: Address) {
	return typeof value === 'string' && isAddress(value) && sameAddress(value, expected)
}

function previousPairCallMatches(context: OperationContinuationContext, pair: PairSnapshot, functionName: 'addLiquidity' | 'initialize' | 'removeLiquidity' | 'swapExactInput' | 'swapExactOutput', argsMatch: (args: readonly unknown[]) => boolean) {
	const step = previousAction(context, functionName, pair.address)
	if (step === undefined) return false
	return (
		undefinedOnError(() => {
			const call = decodeFunctionData({ abi: twoWayConstantProductPairAbi, data: step.data })
			return call.functionName === functionName && argsMatch(call.args)
		}) ?? false
	)
}

export function previousDirectActionMatches(snapshot: EcosystemSnapshot, context: OperationContinuationContext, pair: PairSnapshot, method: 'addLiquidity' | 'initialize', shareAmount: bigint, minimumLiquidity: bigint) {
	return previousPairCallMatches(context, pair, method, args => args[0] === shareAmount && args[1] === shareAmount && args[2] === minimumLiquidity && decodedAddressMatches(args[3], snapshot.wallet.address))
}

export function previousSwapActionMatches(snapshot: EcosystemSnapshot, context: OperationContinuationContext, pair: PairSnapshot, mode: 'exact-input' | 'exact-output', yesForNo: boolean, principal: bigint, bound: bigint) {
	return previousPairCallMatches(context, pair, mode === 'exact-input' ? 'swapExactInput' : 'swapExactOutput', args => args[0] === yesForNo && args[1] === principal && args[2] === bound && decodedAddressMatches(args[3], snapshot.wallet.address))
}

export function previousRemoveActionMatches(snapshot: EcosystemSnapshot, context: OperationContinuationContext, pair: PairSnapshot, liquidity: bigint, minimumYes: bigint, minimumNo: bigint) {
	return previousPairCallMatches(context, pair, 'removeLiquidity', args => args[0] === liquidity && args[1] === minimumYes && args[2] === minimumNo && decodedAddressMatches(args[3], snapshot.wallet.address) && args[4] === BigInt(context.previousPlan.deadlineTimestamp ?? '0'))
}

function sameBigintArray(actual: unknown, expected: readonly bigint[]) {
	return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

export function previousReceiveActionMatches(snapshot: EcosystemSnapshot, context: OperationContinuationContext, pool: PoolSnapshot, pair: PairSnapshot, shares: ShareInventory, operation: 0 | 1, longOutcome: 1 | 2 | 3, completeAmount: bigint, maximumLong: bigint, minimumEthAttoEth: bigint) {
	const step = previousAction(context, operation === 0 ? 'exitPosition' : 'redeemCompleteSet', shares.shareToken)
	const deadline = context.previousPlan.deadlineTimestamp
	if (step === undefined || deadline === undefined) return false
	const tokenIds = operation === 0 ? [shareTokenId(shares.universeId, 0), shareTokenId(shares.universeId, longOutcome)] : [0, 1, 2].map(outcome => shareTokenId(shares.universeId, outcome))
	const values = operation === 0 ? [completeAmount, maximumLong] : tokenIds.map(() => completeAmount)
	return (
		undefinedOnError(() => {
			const call = decodeFunctionData({ abi: erc1155Abi, data: step.data })
			return (
				call.functionName === 'safeBatchTransferFrom' &&
				decodedAddressMatches(call.args[0], snapshot.wallet.address) &&
				decodedAddressMatches(call.args[1], snapshot.deployments.tradingRouter) &&
				sameBigintArray(call.args[2], tokenIds) &&
				sameBigintArray(call.args[3], values) &&
				call.args[4] === receiveRequestData(snapshot, pool, pair, shares, operation, longOutcome, completeAmount, maximumLong, minimumEthAttoEth, BigInt(deadline))
			)
		}) ?? false
	)
}
