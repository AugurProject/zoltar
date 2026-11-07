import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { afterEach, expect, test } from 'bun:test'
import { keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { createInjectedBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { transactionErrorMessages } from '@zoltar/ui-core-shared/lib/errors.js'
import { withTransactionReviews } from '@zoltar/ui-statoblast-shared/protocol/reviewedBackend.js'

const account = '0x0000000000000000000000000000000000000001'
const originalPool = '0x0000000000000000000000000000000000000002'
const otherPool = '0x0000000000000000000000000000000000000003'
const serializedTransaction = '0x01'
const hash = keccak256(serializedTransaction)
afterEach(() => transactionSteps.value?.cancel())
const { replaceEnvironment } = installFakeEnvironmentLifecycle({ accountAddress: account, installActiveEnvironment: installActiveEnvironmentForTesting })

for (const method of ['sendTransaction', 'sendRawTransaction', 'writeContract'] as const)
	for (const waitingFor of ['eth_accounts', 'eth_chainId'] as const)
		for (const change of ['selection', 'review', 'controller', 'environment', 'unchanged'] as const)
			test(`provider dispatch rechecks claim context after injected validation (${method}, ${waitingFor}, ${change})`, async () => {
				const reached = createDeferred<void>()
				const resume = createDeferred<void>()
				const scope = new AbortController()
				let selectedPool: string = originalPool
				let prepared = false
				let submissions = 0
				let assertions = 0
				const backend = withTransactionReviews(
					createInjectedBackend({
						profile: SEPOLIA_NETWORK_PROFILE,
						provider: {
							request: async ({ method }) => {
								if (prepared && method === waitingFor) {
									reached.resolve()
									await resume.promise
								}
								if (method === 'eth_accounts') return [account]
								if (method === 'eth_chainId') return SEPOLIA_NETWORK_PROFILE.chainIdHex
								if (method === 'eth_sendTransaction' || method === 'eth_sendRawTransaction') {
									submissions++
									return hash
								}
								throw new Error(`Unexpected provider request: ${method}`)
							},
						},
					}),
				)
				replaceEnvironment(backend)
				const client = backend.createWriteClient(account, {
					reviewSignal: scope.signal,
					onTransactionPrepared: () => {
						prepared = true
					},
					assertBeforeSubmit: () => {
						assertions++
						if (scope.signal.aborted || selectedPool !== originalPool) throw new Error(transactionErrorMessages.reviewCanceled)
					},
				})
				const request = (() => {
					if (method === 'sendRawTransaction') return client.sendRawTransaction({ serializedTransaction })
					if (method === 'writeContract') return client.writeContract({ address: originalPool, abi: [{ type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [], outputs: [] }], functionName: 'claim' })
					return client.sendTransaction({ to: originalPool, value: 0n })
				})().catch(error => error)
				await reached.promise
				if (change === 'selection') selectedPool = otherPool
				else if (change === 'review') scope.abort()
				else if (change === 'controller') {
					transactionSteps.value?.cancel()
					expect(scope.signal.aborted).toBe(false)
				} else if (change === 'environment') replaceEnvironment(backend)
				resume.resolve()
				const result = await request
				if (change === 'unchanged') expect(result).toBe(hash)
				else {
					expect(result).toBeInstanceOf(Error)
					expect(result.message).toBe(change === 'environment' ? 'The network changed. Review the action again.' : transactionErrorMessages.reviewCanceled)
				}
				expect(assertions).toBe(change === 'selection' || change === 'unchanged' ? 1 : 0)
				expect(submissions).toBe(change === 'unchanged' ? 1 : 0)
			})
