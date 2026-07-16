import type { Address, Hash, Hex, TransactionReceipt } from '@zoltar/shared/ethereum'
import type { ReadClient, WriteClient } from '../../types/contracts.js'

export type MockReadClient = Pick<ReadClient, 'readContract'>
export type MockLoaderClient = ReadClient
export type MockReadContractRequest = Parameters<MockReadClient['readContract']>[0]
export type MockReadContractHandler = (request: MockReadContractRequest) => Promise<unknown>
export type MockLoaderMulticallRequest = Parameters<MockLoaderClient['multicall']>[0]
export type MockLoaderMulticallHandler = (request: MockLoaderMulticallRequest) => Promise<unknown>
export type MockWriteClient = {
	readContract: ReadClient['readContract']
	sendTransaction: WriteClient['sendTransaction']
	waitForTransactionReceipt: (_request: { hash: Hash }) => Promise<Pick<TransactionReceipt, 'status'>>
}

export function getContractFunctionName(contract: unknown) {
	if (typeof contract !== 'object' || contract === null || !('functionName' in contract)) throw new Error('Unexpected multicall contract')
	const functionName = contract.functionName
	if (typeof functionName !== 'string') throw new Error('Unexpected multicall contract')
	return functionName
}

export function createBlockWithTimestamp(timestamp: bigint) {
	return { timestamp }
}

export function createReadContractStub(handler: MockReadContractHandler): ReadClient['readContract'] {
	return async request => (await handler(request as unknown as MockReadContractRequest)) as never
}

export function createMulticallStub(handler: MockLoaderMulticallHandler): MockLoaderClient['multicall'] {
	return async request => (await handler(request as MockLoaderMulticallRequest)) as never
}

export function createMockLoaderClient({ getBlock, multicall, readContract }: { getBlock: () => Promise<{ timestamp: bigint }>; multicall: MockLoaderMulticallHandler; readContract: MockReadContractHandler }): MockLoaderClient {
	return {
		getBlock,
		multicall: createMulticallStub(multicall),
		readContract: createReadContractStub(readContract),
	} as unknown as MockLoaderClient
}

export function createMockReadClient(readContract: MockReadContractHandler): MockReadClient {
	return { readContract: createReadContractStub(readContract) }
}

export const mockTransactionHash = '0x00000000000000000000000000000000000000000000000000000000000000c3' satisfies Hash

export function createMockWriteClient(
	onSendTransaction: (request: { data?: Hex | undefined; gas?: bigint | undefined; to?: Address | null | undefined; value?: bigint | undefined }) => void,
	readContract: MockReadContractHandler = async request => {
		throw new Error(`Unexpected readContract function: ${request.functionName}`)
	},
): MockWriteClient {
	return {
		readContract: createReadContractStub(readContract),
		sendTransaction: async request => {
			onSendTransaction(request)
			return mockTransactionHash
		},
		waitForTransactionReceipt: async () => ({ status: 'success' }),
	}
}

export function asWriteClient(client: MockWriteClient): WriteClient {
	return client as unknown as WriteClient
}
