import { createPublicClient, custom, encodeFunctionData, getAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { WriteClient } from '../wallet/chainBackend.js'
import type { createSimulationProfile } from '../wallet/networkProfile.js'
import { createSimulationChain, type SimulationChain } from './simulationChain.js'
import type { TevmLikeClient } from './clock.js'
import { applyDumpedAccountState, applyDumpedStorageState, requireSuccessfulDumpState, requireSuccessfulLoadState } from './dumpedState.js'

type MemoryClientLike = TevmLikeClient
export type TemporarySimulationAccountCopy = {
	address: Address
	mode: 'full' | 'storage'
}
export type SimulationSendTransactionRequest = {
	account?: unknown
	data?: Hex | undefined
	gas?: bigint | undefined
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
	nonce?: bigint | number | undefined
	to?: Address | null | undefined
	value?: bigint | undefined
}

function normalizeRpcBigInt(value: unknown) {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number') return BigInt(value)
	if (typeof value === 'string') return BigInt(value)
	return undefined
}
function normalizeRpcAddress(value: unknown) {
	if (typeof value !== 'string') return undefined
	return getAddress(value)
}
export function normalizeRpcTransactionRequest(value: Record<string, unknown>): SimulationSendTransactionRequest {
	return {
		account: (() => {
			if ('account' in value) return value['account']
			if ('from' in value) return value['from']

			return undefined
		})(),
		data: typeof value['data'] === 'string' ? (value['data'] as Hex) : undefined,
		gas: normalizeRpcBigInt(value['gas']),
		gasPrice: normalizeRpcBigInt(value['gasPrice']),
		maxFeePerGas: normalizeRpcBigInt(value['maxFeePerGas']),
		maxPriorityFeePerGas: normalizeRpcBigInt(value['maxPriorityFeePerGas']),
		nonce: normalizeRpcBigInt(value['nonce']),
		to: value['to'] === null ? null : normalizeRpcAddress(value['to']),
		value: normalizeRpcBigInt(value['value']),
	}
}
export function isMissingTransactionReceiptError(error: unknown) {
	if (!(error instanceof Error)) return false
	return error.message.includes('Transaction receipt with hash') && error.message.includes('could not be found')
}
export function normalizeRequestedAccount(value: unknown, fallbackAccount: Address) {
	if (typeof value === 'string') return getAddress(value)
	if (typeof value === 'object' && value !== null && 'address' in value) {
		const address = value.address
		if (typeof address === 'string') return getAddress(address)
	}
	return fallbackAccount
}
export function normalizeNonce(value: bigint | number | undefined) {
	if (value === undefined) return undefined
	return typeof value === 'bigint' ? value : BigInt(value)
}
export async function submitSimulationTransaction(chain: SimulationChain, from: Address, { data, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value }: SimulationSendTransactionRequest, label: string) {
	const blockGasLimit = (await chain.memoryClient.getBlock()).gasLimit
	return await chain.sendTransaction({ data: data ?? '0x', from, gas: gas ?? blockGasLimit, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce: normalizeNonce(nonce), to, value }, label)
}
export function clampDelayMilliseconds(value: number) {
	if (!Number.isFinite(value) || value <= 0) return 0
	return Math.min(Math.trunc(value), 30000)
}
export async function delayMilliseconds(milliseconds: number) {
	if (milliseconds <= 0) return
	await new Promise(resolve => {
		setTimeout(resolve, milliseconds)
	})
}
const createMemoryBackedWriteClient = (profile: ReturnType<typeof createSimulationProfile>, { accountAddress, chainInstance }: { accountAddress: Address; chainInstance: SimulationChain }): WriteClient => {
	const readClient = createPublicClient({
		chain: profile.chain,
		transport: custom({
			request: async parameters => await chainInstance.request(parameters),
		}),
	})
	const sendTransaction = async (request: SimulationSendTransactionRequest) => {
		const senderAddress = normalizeRequestedAccount(request.account, accountAddress)
		await chainInstance.memoryClient.impersonateAccount({ address: senderAddress })
		return await submitSimulationTransaction(chainInstance, senderAddress, request, 'temporary simulation transaction')
	}
	const writeContract: WriteClient['writeContract'] = async parameters =>
		await sendTransaction({
			account: parameters.account,
			data: encodeFunctionData(parameters as Parameters<typeof encodeFunctionData>[0]),
			gas: parameters.gas,
			maxFeePerGas: parameters.maxFeePerGas,
			maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
			to: parameters.address,
			value: parameters.value,
		})

	return {
		account: accountAddress,
		getCode: async (parameters: Parameters<typeof readClient.getCode>[0]) => await readClient.getCode(parameters),
		readContract: async (parameters: Parameters<typeof readClient.readContract>[0]) => await readClient.readContract(parameters),
		sendTransaction,
		waitForTransactionReceipt: async (parameters: Parameters<typeof readClient.getTransactionReceipt>[0]) => await readClient.getTransactionReceipt({ hash: parameters.hash }),
		writeContract,
	} as never
}
// One locked unit on the chain current when the change starts, so nothing lands on the copied accounts between the
// dump and the write-back and a reset meanwhile cannot redirect the write-back; the temporary chain carries its own lock.
export const applyTemporarySimulationAccountChanges = async (
	profile: ReturnType<typeof createSimulationProfile>,
	{
		accountsToCopy,
		chain: activeChain,
		mutate,
	}: {
		accountsToCopy: readonly TemporarySimulationAccountCopy[]
		chain: SimulationChain
		mutate: (context: { createWriteClient: (accountAddress: Address) => WriteClient; memoryClient: MemoryClientLike }) => Promise<void>
	},
) =>
	await activeChain.withLock(async () => {
		const baseSnapshot = await requireSuccessfulDumpState(activeChain.memoryClient)
		const temporaryChain = await createSimulationChain(profile)
		await requireSuccessfulLoadState(temporaryChain.memoryClient, baseSnapshot)
		await mutate({
			createWriteClient: accountAddress =>
				createMemoryBackedWriteClient(profile, {
					accountAddress,
					chainInstance: temporaryChain,
				}),
			memoryClient: temporaryChain.memoryClient,
		})
		const mutatedSnapshot = await requireSuccessfulDumpState(temporaryChain.memoryClient)
		for (const { address, mode } of accountsToCopy) {
			if (mode === 'storage') {
				await applyDumpedStorageState(activeChain.memoryClient, address, mutatedSnapshot)
				continue
			}
			await applyDumpedAccountState(activeChain.memoryClient, address, mutatedSnapshot)
		}
	})

type TevmBlock = Awaited<ReturnType<MemoryClientLike['getBlock']>>

function getRequiredBlockNumber(block: TevmBlock) {
	if (block.number === undefined || block.number === null) throw new Error('Simulation block number was unavailable')
	return block.number
}
export async function getSimulationChainState(memoryClient: MemoryClientLike) {
	const block = await memoryClient.getBlock()
	return {
		blockNumber: getRequiredBlockNumber(block),
		currentTimestamp: block.timestamp,
	}
}
