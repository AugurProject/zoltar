import type { Address } from '@zoltar/shared/evm/ethereum'
import { getActiveBackend } from '../lib/activeEnvironment.js'
import type { CreateWriteClientCallbacks } from './chainBackend.js'
export type { ReadClient, WriteClient } from './chainBackend.js'
export { normalizeAccount } from './chainBackend.js'

export function createConnectedReadClient() {
	return getActiveBackend().createReadClient()
}

export function createWalletWriteClient(accountAddress: Address, callbacks: CreateWriteClientCallbacks = {}) {
	return getActiveBackend().createWriteClient(accountAddress, callbacks)
}
