import { reviewErrors } from '../copy/protocolErrors.js'
import type { ChainBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { createReviewedClient } from './reviewedClient.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { currentStateCheckFailed } from '@zoltar/ui-core-shared/copy/transaction.js'

export function withTransactionReviews<T extends ChainBackend>(backend: T, alwaysReview = false): T {
	// Keep live backend getters for simulation status, balances, and counters.
	const createWriteClient = backend.createWriteClient.bind(backend)
	const walletRequest = <T>(request: Promise<T>) => (alwaysReview ? withTimeout(request, 15_000, currentStateCheckFailed) : request)
	backend.createWriteClient = (account, callbacks) => {
		let assertReviewActive: (() => void) | undefined
		return createReviewedClient(
			createWriteClient(account, {
				...callbacks,
				assertBeforeSubmit: () => {
					if (assertReviewActive === undefined) throw new Error(reviewErrors.reviewNotReady)
					assertReviewActive()
					callbacks?.assertBeforeSubmit?.()
				},
			}),
			async () => {
				const accounts = await walletRequest(backend.getAccounts())
				if (accounts[0]?.toLowerCase() !== account.toLowerCase()) throw new Error(reviewErrors.walletChanged)
				if (BigInt(await walletRequest(backend.getChainId())) !== BigInt(backend.profile.chain.id)) throw new Error(reviewErrors.networkChanged)
			},
			callbacks?.reviewSignal,
			assertActive => {
				assertReviewActive = assertActive
			},
			alwaysReview,
		)
	}
	return backend
}
