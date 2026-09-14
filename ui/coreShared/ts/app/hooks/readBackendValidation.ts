import type { ChainBackend, ReadBackendStatus } from '../../wallet/chainBackend.js'
import { getErrorMessage } from '../../lib/errors.js'
import { formatTimestampWithRelative } from '../../lib/formatters.js'
export type ChainClock = {
	currentBlockNumber: bigint | undefined
	currentTimestamp: bigint | undefined
}

type ReadBackendValidationResult = {
	readBackendMessage: string | undefined
	validated: boolean
}

function getExpectedReadChainId(backend: ChainBackend) {
	return backend.profile.chain.id
}

function buildReadBackendMismatchMessage(backend: ChainBackend, actualChainId: number) {
	return `Configured read RPC reports chain ${actualChainId.toString()}, but this app requires ${backend.profile.displayName} (${getExpectedReadChainId(backend).toString()}).`
}

export function getReadBackendStatus(backend: ChainBackend): ReadBackendStatus {
	return (
		backend.getReadBackendStatus?.() ?? {
			blockNumber: undefined,
			blockTimestamp: undefined,
			rpcSource: 'default',
			rpcUrl: backend.profile.displayName,
			transportMode: 'provider',
		}
	)
}

export async function validateConfiguredReadBackend(backend: ChainBackend): Promise<ReadBackendValidationResult> {
	try {
		const readClient = backend.createReadClient()
		const readChainId = await readClient.getChainId()
		if (readChainId !== getExpectedReadChainId(backend)) {
			return {
				readBackendMessage: buildReadBackendMismatchMessage(backend, readChainId),
				validated: true,
			}
		}
		const block = await readClient.getBlock()
		const blockNumber = typeof block.number === 'bigint' ? block.number : undefined
		const blockTimestamp = typeof block.timestamp === 'bigint' ? block.timestamp : undefined
		backend.setReadBackendBlock?.({
			number: blockNumber,
			timestamp: blockTimestamp,
		})
		const currentUnixSeconds = BigInt(Math.floor(Date.now() / 1000))
		if (backend.profile.id !== 'simulation' && blockTimestamp !== undefined && currentUnixSeconds > blockTimestamp + READ_BACKEND_STALE_BLOCK_SECONDS) {
			return {
				readBackendMessage: `Configured read RPC is stale. Latest block timestamp is ${formatTimestampWithRelative(blockTimestamp, currentUnixSeconds)}, more than 10 minutes behind local time.`,
				validated: true,
			}
		}
		return {
			readBackendMessage: undefined,
			validated: true,
		}
	} catch (error) {
		throw new Error(getErrorMessage(error, 'Failed to validate the configured read RPC'))
	}
}

const READ_BACKEND_STALE_BLOCK_SECONDS = 10n * 60n

export async function loadBackendChainClock(backend: ChainBackend): Promise<ChainClock> {
	if (backend.isBootstrapped === false)
		return {
			currentBlockNumber: undefined,
			currentTimestamp: undefined,
		}

	const block = await backend.createReadClient().getBlock()
	return {
		currentBlockNumber: typeof block.number === 'bigint' ? block.number : undefined,
		currentTimestamp: typeof block.timestamp === 'bigint' ? block.timestamp : undefined,
	}
}
