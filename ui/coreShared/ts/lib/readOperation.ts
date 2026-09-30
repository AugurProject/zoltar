import type { PublicClient } from '@zoltar/core-shared/evm/ethereum'

export type ReadOperation = {
	read<T>(load: () => Promise<T>): Promise<T>
}

/** A deadline for lack of progress, rather than the combined duration of a chain of successful reads. */
export async function runReadOperation<T>(load: (operation: ReadOperation) => Promise<T>, { timeoutMilliseconds = 30_000, isCurrent = () => true }: { timeoutMilliseconds?: number; isCurrent?: () => boolean } = {}) {
	let active = true
	let timer: ReturnType<typeof setTimeout> | undefined
	let rejectTimeout: (reason: Error) => void = () => undefined
	const timeoutError = new Error('RPC read timed out. Retry loading data.')
	const deadline = new Promise<never>((_resolve, reject) => {
		rejectTimeout = reject
	})
	const resetDeadline = () => {
		clearTimeout(timer)
		timer = setTimeout(() => {
			active = false
			rejectTimeout(timeoutError)
		}, timeoutMilliseconds)
	}
	const assertActive = () => {
		if (!active) throw timeoutError
		if (!isCurrent()) throw new Error('Read superseded by a changed selection or environment')
	}
	const operation: ReadOperation = {
		async read(load) {
			assertActive()
			const result = await Promise.race([load(), deadline])
			assertActive()
			resetDeadline()
			return result
		},
	}
	resetDeadline()
	try {
		return await Promise.race([load(operation), deadline])
	} finally {
		active = false
		clearTimeout(timer)
	}
}

/** Keep the original client (including simulated reads), and report progress at each read boundary. */
export function readOperationClient(client: PublicClient, operation: ReadOperation): PublicClient {
	return {
		...client,
		readContract: async parameters => await operation.read(() => client.readContract(parameters)),
		multicall: async parameters => await operation.read(() => client.multicall(parameters)),
		getBlock: async parameters => await operation.read(() => client.getBlock(parameters)),
		getBlockNumber: async () => await operation.read(() => client.getBlockNumber()),
		getChainId: async () => await operation.read(() => client.getChainId()),
		getBalance: async parameters => await operation.read(() => client.getBalance(parameters)),
		getCode: async parameters => await operation.read(() => client.getCode(parameters)),
	}
}
