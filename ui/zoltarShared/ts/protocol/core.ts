import { errorChain } from '@zoltar/core-shared/errors/errorChain'
import { hasErrorCode, hasErrorMessage, isTransactionReviewCancellation, isWalletRejection } from '@zoltar/ui-core-shared/lib/errors.js'
import { encodeFunctionData, RpcError, type Abi, type Account, type Address, type ContractFunctionParameters, type Hash, type MulticallReturnType, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { createTransactionFailureError } from '@zoltar/ui-core-shared/transactions/transactionLifecycle.js'
import { getMulticall3Address } from './zoltarDeploymentHelpers.js'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { TransactionRequestPreview } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/transactions/transactionReceipt.js'
import { getContractLabel } from './contractLabels.js'

export { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/transactions/transactionReceipt.js'

type ContractLabelResolver = (abi: readonly unknown[], functionName: string) => string | undefined

let appContractLabelResolver: ContractLabelResolver | undefined

export function installAppContractLabelResolver(resolver: ContractLabelResolver) {
	appContractLabelResolver = resolver
}

function resolveContractLabel(abi: readonly unknown[], functionName: string) {
	return appContractLabelResolver?.(abi, functionName) ?? getContractLabel(abi, functionName)
}

type ContractRevertReasonParams = {
	account?: Account | Address | undefined | null
	abi: Abi | readonly unknown[]
	address: Address
	args?: readonly unknown[]
	contractLabel?: string
	functionName: string
	gas?: bigint
	reviewAmount?: string
	reviewDescription?: string
	reviewTitle?: string
	value?: bigint
}

type ContractCallClient = {
	call?: WriteClient['call']
}

export type WriteContractClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = Pick<WriteClient, 'sendTransaction'> &
	ContractCallClient & {
		chain?: WriteClient['chain']
		onTransactionPlan?: WriteClient['onTransactionPlan']
		onTransactionPrepared?: ((preview: TransactionRequestPreview) => void) | undefined
		onTransactionSubmitted?: ((hash: Hash) => void) | undefined
		requiresWalletConfirmation?: boolean | undefined
		waitForTransactionReceipt: (...args: Parameters<WriteClient['waitForTransactionReceipt']>) => Promise<TReceipt>
	}

export async function readRequiredMulticall<const TContracts extends readonly unknown[]>(client: Pick<ReadClient, 'multicall'>, contracts: TContracts, blockNumber?: bigint): Promise<MulticallReturnType<TContracts, false>> {
	return (await client.multicall({
		allowFailure: false,
		blockNumber,
		contracts: contracts as readonly ContractFunctionParameters[],
		multicallAddress: getMulticall3Address(),
	})) as MulticallReturnType<TContracts, false>
}

export async function readOptionalMulticall<const TContracts extends readonly unknown[]>(client: Pick<ReadClient, 'multicall'>, contracts: TContracts, blockNumber?: bigint): Promise<MulticallReturnType<TContracts, true>> {
	return (await client.multicall({
		allowFailure: true,
		blockNumber,
		contracts: contracts as readonly ContractFunctionParameters[],
		multicallAddress: getMulticall3Address(),
	})) as MulticallReturnType<TContracts, true>
}

async function getContractRevertReason<TCallParams extends ContractRevertReasonParams>(client: ContractCallClient, params: TCallParams) {
	if (client.call === undefined) return undefined
	try {
		const data = encodeFunctionData({
			abi: params.abi,
			...(params.args === undefined ? {} : { args: params.args }),
			functionName: params.functionName,
		})
		const account = params.account ?? undefined
		await client.call({
			account,
			data,
			gas: params.gas,
			to: params.address,
			value: params.value,
		})
		return undefined
	} catch (error) {
		if (error instanceof RpcError) return error.shortMessage ?? error.message ?? (error.cause instanceof Error ? error.cause.message : undefined)
		if (error instanceof Error) return error.message
		return undefined
	}
}

function isSubmissionRevert(error: unknown) {
	if (isWalletRejection(error) || isTransactionReviewCancellation(error)) return false
	for (const cause of errorChain(error)) {
		if (hasErrorCode(cause) && cause.code === 3) return true
		if (hasErrorMessage(cause) && /\b(?:execution|transaction|call) reverted\b/i.test(cause.message)) return true
	}
	return false
}

export async function writeContractAndWait<TCallParams extends ContractRevertReasonParams, TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, getCallParams: () => TCallParams) {
	const { hash } = await writeContractAndWaitForReceipt(client, getCallParams)
	return hash
}

export async function writeContractAndWaitForReceipt<TCallParams extends ContractRevertReasonParams, TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, getCallParams: () => TCallParams): Promise<{ hash: Hash; receipt: TReceipt }> {
	const callParams = getCallParams()
	const data = encodeFunctionData({
		abi: callParams.abi,
		...(callParams.args === undefined ? {} : { args: callParams.args }),
		functionName: callParams.functionName,
	})
	const account = callParams.account ?? undefined
	client.onTransactionPrepared?.({
		account,
		args: callParams.args,
		chainName: client.chain?.name,
		contractAddress: callParams.address,
		contractLabel: callParams.contractLabel ?? resolveContractLabel(callParams.abi, callParams.functionName),
		data,
		functionName: callParams.functionName,
		requiresWalletConfirmation: client.requiresWalletConfirmation,
		reviewDescription: callParams.reviewDescription,
		reviewAmount: callParams.reviewAmount,
		reviewTitle: callParams.reviewTitle,
		value: callParams.value,
	})
	let hash: Hash
	try {
		hash = await client.sendTransaction({
			account,
			data,
			gas: callParams.gas,
			to: callParams.address,
			value: callParams.value,
		})
	} catch (error) {
		if (!isSubmissionRevert(error)) throw error
		const reason = await getContractRevertReason(client, callParams)
		if (reason === undefined) throw error
		throw new Error(reason, { cause: error })
	}
	const { hash: resolvedHash, receipt } = await waitForSubmittedTransactionReceipt(client, hash, { allowRevertedReceipt: true })
	if (receipt.status === 'reverted') {
		const reason = await getContractRevertReason(client, callParams)
		throw createTransactionFailureError('reverted', reason ?? 'Transaction reverted')
	}
	return { hash: resolvedHash, receipt }
}
