import type { ChainBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { createReviewedClient } from './reviewedClient.js'

export function withTransactionReviews<T extends ChainBackend>(backend: T): T {
	// Keep live backend getters for simulation status, balances, and counters.
	const createWriteClient = backend.createWriteClient.bind(backend)
	backend.createWriteClient = (account, callbacks) =>
		createReviewedClient(createWriteClient(account, callbacks), async () => {
			const accounts = await backend.getAccounts()
			if (accounts[0]?.toLowerCase() !== account.toLowerCase()) throw new Error('The wallet changed. Review the action again.')
			if (BigInt(await backend.getChainId()) !== BigInt(backend.profile.chain.id)) throw new Error('The network changed. Review the action again.')
		})
	return backend
}
