import type { ChainBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { createReviewedClient } from './reviewedClient.js'

export function withTransactionReviews<T extends ChainBackend>(backend: T): T {
	// Keep live backend getters for simulation status, balances, and counters.
	const createWriteClient = backend.createWriteClient.bind(backend)
	backend.createWriteClient = (account, callbacks) => {
		let assertReviewActive: (() => void) | undefined
		return createReviewedClient(
			createWriteClient(account, {
				...callbacks,
				assertBeforeSubmit: () => {
					if (assertReviewActive === undefined) throw new Error('Transaction review is not initialized.')
					assertReviewActive()
					callbacks?.assertBeforeSubmit?.()
				},
			}),
			async () => {
				const accounts = await backend.getAccounts()
				if (accounts[0]?.toLowerCase() !== account.toLowerCase()) throw new Error('The wallet changed. Review the action again.')
				if (BigInt(await backend.getChainId()) !== BigInt(backend.profile.chain.id)) throw new Error('The network changed. Review the action again.')
			},
			callbacks?.reviewSignal,
			assertActive => {
				assertReviewActive = assertActive
			},
		)
	}
	return backend
}
