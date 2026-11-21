import type { Address, Hash, Hex, TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient, WriteClient } from '../../types/contracts.js'
import { testDouble } from './testDouble.js'

export type MockReadClient = Pick<ReadClient, 'readContract'>
type MockLoaderClient = ReadClient
type MockReadContractRequest = Parameters<MockReadClient['readContract']>[0]
type MockReadContractHandler = (request: MockReadContractRequest) => unknown
type MockLoaderMulticallRequest = Parameters<MockLoaderClient['multicall']>[0]
type MockLoaderMulticallHandler = (request: MockLoaderMulticallRequest) => unknown
export type MockWriteClient = Partial<Omit<WriteClient, 'readContract' | 'sendTransaction' | 'waitForTransactionReceipt'>> & {
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
	return { timestamp, transactions: [] }
}

export function createReadContractStub(handler: MockReadContractHandler): ReadClient['readContract'] {
	return testDouble<ReadClient['readContract']>(async (request: MockReadContractRequest) => await handler(request))
}

export function createMulticallStub(handler: MockLoaderMulticallHandler): MockLoaderClient['multicall'] {
	return testDouble<MockLoaderClient['multicall']>(async (request: MockLoaderMulticallRequest) => await handler(request))
}

export function createMockLoaderClient({ getBlock, getLogs = async () => [], multicall, readContract }: { getBlock: () => Promise<{ timestamp: bigint }>; getLogs?: () => Promise<readonly unknown[]>; multicall: MockLoaderMulticallHandler; readContract: MockReadContractHandler }): MockLoaderClient {
	return testDouble<MockLoaderClient>({
		getBlock,
		getBlockNumber: async () => 0n,
		getLogs,
		multicall: createMulticallStub(multicall),
		readContract: createReadContractStub(readContract),
	})
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
	return testDouble<WriteClient>(client)
}
