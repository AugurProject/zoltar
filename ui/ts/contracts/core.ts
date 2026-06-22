import { encodeFunctionData, RpcError, type Abi, type Account, type Address, type ContractFunctionParameters, type Hash, type MulticallReturnType, type TransactionReceipt } from 'viem'
import { getMulticall3Address } from './deploymentHelpers.js'
import type { ReadClient, WriteClient } from '../types/contracts.js'
import type { TransactionRequestPreview } from '../lib/chainBackend.js'

export type ContractRevertReasonParams = {
	account?: Account | Address | undefined | null
	abi: Abi | readonly unknown[]
	address: Address
	args?: readonly unknown[]
	functionName: string
	gas?: bigint
	value?: bigint
}

type ContractCallClient = {
	call?: WriteClient['call']
}

export type WriteContractClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = Pick<WriteClient, 'sendTransaction'> &
	ContractCallClient & {
		chain?: WriteClient['chain']
		onTransactionPrepared?: ((preview: TransactionRequestPreview) => void) | undefined
		waitForTransactionReceipt: (...args: Parameters<WriteClient['waitForTransactionReceipt']>) => Promise<TReceipt>
	}

export async function readRequiredMulticall<const TContracts extends readonly unknown[]>(client: Pick<ReadClient, 'multicall'>, contracts: TContracts): Promise<MulticallReturnType<TContracts, false>> {
	return (await client.multicall({
		allowFailure: false,
		contracts: contracts as readonly ContractFunctionParameters[],
		multicallAddress: getMulticall3Address(),
	})) as MulticallReturnType<TContracts, false>
}

export async function readOptionalMulticall<const TContracts extends readonly unknown[]>(client: Pick<ReadClient, 'multicall'>, contracts: TContracts): Promise<MulticallReturnType<TContracts, true>> {
	return (await client.multicall({
		allowFailure: true,
		contracts: contracts as readonly ContractFunctionParameters[],
		multicallAddress: getMulticall3Address(),
	})) as MulticallReturnType<TContracts, true>
}

async function getContractRevertReason<TCallParams extends ContractRevertReasonParams>(client: ContractCallClient, params: TCallParams) {
	if (client.call === undefined) return undefined
	try {
		const data = encodeFunctionData({
			abi: params.abi,
			functionName: params.functionName,
			args: params.args,
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

function getOriginalErrorMessage(error: unknown) {
	if (error instanceof RpcError) return error.shortMessage ?? error.message ?? (error.cause instanceof Error ? error.cause.message : undefined)
	if (error instanceof Error) return error.message
	return undefined
}

export async function writeContractAndWait<TCallParams extends ContractRevertReasonParams, TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, getCallParams: () => TCallParams) {
	const { hash } = await writeContractAndWaitForReceipt(client, getCallParams)
	return hash
}

export async function writeContractAndWaitForReceipt<TCallParams extends ContractRevertReasonParams, TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, getCallParams: () => TCallParams): Promise<{ hash: Hash; receipt: TReceipt }> {
	const callParams = getCallParams()
	const data = encodeFunctionData({
		abi: callParams.abi,
		functionName: callParams.functionName,
		args: callParams.args,
	})
	const account = callParams.account ?? undefined
	let hash: Hash
	try {
		client.onTransactionPrepared?.({
			account,
			args: callParams.args,
			chainName: client.chain?.name,
			contractAddress: callParams.address,
			functionName: callParams.functionName,
			value: callParams.value,
		})
		hash = await client.sendTransaction({
			account,
			data,
			gas: callParams.gas,
			to: callParams.address,
			value: callParams.value,
		})
	} catch (error) {
		const reason = await getContractRevertReason(client, callParams)
		throw new Error(reason ?? getOriginalErrorMessage(error) ?? 'Transaction reverted')
	}
	const receipt = await client.waitForTransactionReceipt({ hash })
	if (receipt.status === 'reverted') {
		const reason = await getContractRevertReason(client, callParams)
		throw new Error(reason ?? 'Transaction reverted')
	}
	return { hash, receipt }
}
