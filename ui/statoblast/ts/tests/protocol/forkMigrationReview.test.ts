import { expect, test } from 'bun:test'
import { createWalletClient, custom, publicActions, getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { createBlockWithTimestamp, createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { registerTransactionPreparationScope } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { migrateVaultWithUnresolvedEscalation } from '@zoltar/ui-statoblast-shared/protocol/forks.js'

const address = getAddress('0x0000000000000000000000000000000000000001')
const hash = `0x${'1'.repeat(64)}` as const
const deadline = 4_838_401n

for (const phase of ['initial', 'review', 'estimate'] as const) {
	for (const remaining of [-1n, 0n, 1n, 60n, 61n]) {
		test(`unresolved migration reserves submission time ${phase} (${remaining})`, async () => {
			let timestamp = phase === 'initial' ? deadline - remaining : 1n
			let submitted = 0
			const wallet = createWalletClient({
				account: address,
				chain: MAINNET_NETWORK_PROFILE.chain,
				transport: custom({
					request: async () => {
						throw new Error('Unexpected RPC')
					},
				}),
			}).extend(publicActions)
			const scope = new AbortController()
			const unregister = registerTransactionPreparationScope(scope.signal)
			const reviewed = createReviewedClient(
				{
					...wallet,
					sendTransaction: async () => {
						submitted += 1
						return hash
					},
					waitForTransactionReceipt: async () => ({ blockHash: hash, blockNumber: 1n, cumulativeGasUsed: 21000n, from: address, gasUsed: 21000n, logs: [], status: 'success', transactionHash: hash, transactionIndex: 0n }),
					getBlock: async () => createBlockWithTimestamp(timestamp),
					estimateGas: async () => {
						if (phase === 'estimate') timestamp = deadline - remaining
						return 100000n
					},
					readContract: createReadContractStub(request => {
						if (request.functionName === 'forkData') return [0n, zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, false, true, 0n, 1n]
						throw new Error(`Unexpected read ${request.functionName}`)
					}),
				},
				undefined,
				scope.signal,
			)
			try {
				let finished = false
				const action = migrateVaultWithUnresolvedEscalation(reviewed, address, address, 1n, 'yes')
					.catch(error => error)
					.finally(() => {
						finished = true
					})
				for (let attempt = 0; attempt < 100 && !finished && transactionSteps.value?.steps.at(-1)?.phase !== 'review'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 1))
				if (phase !== 'initial' || remaining > 60n) expect(transactionSteps.value?.steps.at(-1)?.phase).toBe('review')
				if (phase === 'review') timestamp = deadline - remaining
				transactionSteps.value?.confirm()
				const result = await action
				if (remaining > 60n) {
					expect(result).toHaveProperty('hash', hash)
					expect(submitted).toBe(1)
				} else {
					expect(result).toBeInstanceOf(Error)
					expect(submitted).toBe(0)
				}
			} finally {
				scope.abort()
				unregister()
				transactionSteps.value?.cancel()
			}
		})
	}
}
