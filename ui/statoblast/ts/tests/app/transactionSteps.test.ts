import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { afterEach, expect, mock, test } from 'bun:test'
import { createWalletClient, custom, publicActions, encodeFunctionData, decodeFunctionData, maxUint256, type Hash, type TransactionReceipt, type ReplacementReason } from '@zoltar/core-shared/evm/ethereum'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createReviewedClient } from '../../app/transactions/reviewedClient.js'
import { withTransactionReviews } from '../../app/transactions/reviewedBackend.js'
import { transactionSteps } from '../../app/transactions/transactionSteps.js'

const account = '0x0000000000000000000000000000000000000001'
const hash: Hash = `0x${'1'.repeat(64)}`

function setup(replacementReason?: ReplacementReason) {
	const sendTransaction = mock(async () => hash)
	const onTransactionPrepared = mock(() => undefined)
	const client = createWalletClient({
		account,
		chain: MAINNET_NETWORK_PROFILE.chain,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected RPC')
			},
		}),
	}).extend(publicActions)
	const replacementHash: Hash = `0x${'2'.repeat(64)}`
	const receipt: TransactionReceipt = { blockHash: hash, blockNumber: 1n, cumulativeGasUsed: 21_000n, from: account, gasUsed: 21_000n, logs: [], status: 'success', transactionHash: replacementHash, transactionIndex: 0n }
	const waitForTransactionReceipt: typeof client.waitForTransactionReceipt = async parameters => {
		if (replacementReason === undefined) throw new Error('Expected a replacement fixture')
		parameters.onReplaced?.({ reason: replacementReason, replacedTransaction: { hash }, transaction: { hash: replacementHash }, transactionReceipt: receipt })
		return receipt
	}
	return { client, receipt, sendTransaction, onTransactionPrepared, replacementHash, reviewed: createReviewedClient({ ...client, sendTransaction, onTransactionPrepared, ...(replacementReason === undefined ? {} : { waitForTransactionReceipt }) }) }
}

async function waitForReview() {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (transactionSteps.value?.steps[transactionSteps.value.activeIndex]?.phase === 'review') return
		await new Promise(resolve => setTimeout(resolve, 1))
	}
	throw new Error('No transaction review appeared')
}

function confirm() {
	const current = transactionSteps.value
	if (current === undefined) throw new Error('No transaction to confirm')
	current.confirm()
}

afterEach(() => transactionSteps.value?.cancel())

test('does not open the wallet until the transaction has its own explicit confirmation', async () => {
	const { reviewed, sendTransaction, onTransactionPrepared } = setup()
	const sending = reviewed.sendTransaction({ to: account, value: 1n })
	await new Promise(resolve => setTimeout(resolve, 10))
	expect(sendTransaction).not.toHaveBeenCalled()
	expect(onTransactionPrepared).not.toHaveBeenCalled()
	confirm()
	await sending
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(onTransactionPrepared).toHaveBeenCalledTimes(1)
})

test('a chained action pauses again after each individual confirmation', async () => {
	const { reviewed, sendTransaction } = setup()
	reviewed.onTransactionPlan?.(Array.from({ length: 4 }, (_, step) => ({ functionName: 'Transfer ETH', to: account, value: BigInt(step) })))
	const action = (async () => {
		for (let step = 0; step < 4; step += 1) await reviewed.sendTransaction({ to: account, value: BigInt(step) })
	})()
	for (let step = 0; step < 4; step += 1) {
		await waitForReview()
		expect(sendTransaction).toHaveBeenCalledTimes(step)
		expect(transactionSteps.value?.steps).toHaveLength(4)
		confirm()
		confirm()
		await new Promise(resolve => setTimeout(resolve, 1))
		expect(sendTransaction).toHaveBeenCalledTimes(step + 1)
	}
	await action
	expect(transactionSteps.value?.steps).toHaveLength(4)
})

test('canceling the next step prevents all remaining transactions', async () => {
	const { reviewed, sendTransaction } = setup()
	reviewed.onTransactionPlan?.([1n, 2n, 3n].map(value => ({ functionName: 'Transfer ETH', to: account, value })))
	const action = (async () => {
		await reviewed.sendTransaction({ to: account, value: 1n })
		await reviewed.sendTransaction({ to: account, value: 2n })
		await reviewed.sendTransaction({ to: account, value: 3n })
	})()
	const rejected = action.catch(error => error)
	await waitForReview()
	confirm()
	await waitForReview()
	transactionSteps.value?.cancel()
	expect(await rejected).toBeInstanceOf(Error)
	expect(sendTransaction).toHaveBeenCalledTimes(1)
})

test('a wallet rejection stops the chain and exposes the error', async () => {
	const { reviewed, sendTransaction } = setup()
	sendTransaction.mockRejectedValueOnce(new Error('User rejected the request'))
	reviewed.onTransactionPlan?.([1n, 2n, 3n].map(value => ({ functionName: 'Transfer ETH', to: account, value })))
	const action = (async () => {
		await reviewed.sendTransaction({ to: account, value: 1n })
		await reviewed.sendTransaction({ to: account, value: 2n })
	})()
	const rejected = action.catch(error => error)
	await waitForReview()
	confirm()
	expect(await rejected).toBeInstanceOf(Error)
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(transactionSteps.value?.steps[0]?.phase).toBe('failed')
})

test('a changed environment cannot submit an old review', async () => {
	const { reviewed, sendTransaction } = setup()
	const sending = reviewed.sendTransaction({ to: account, value: 1n })
	const rejected = sending.catch(error => error)
	await waitForReview()
	resetActiveEnvironmentForTesting()
	confirm()
	expect(await rejected).toBeInstanceOf(Error)
	expect(sendTransaction).not.toHaveBeenCalled()
})

test('duplicate clicks cannot resubmit a pending wallet request', async () => {
	const { reviewed, sendTransaction } = setup()
	const submitted = createDeferred<Hash>()
	sendTransaction.mockImplementationOnce(async () => await submitted.promise)
	const sending = reviewed.sendTransaction({ to: account, value: 1n })
	await waitForReview()
	const confirmStep = transactionSteps.value?.confirm
	confirmStep?.()
	confirmStep?.()
	await new Promise(resolve => setTimeout(resolve, 1))
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(transactionSteps.value?.steps.at(-1)?.phase).toBe('pending')
	submitted.resolve(hash)
	await sending
})

test('blocks a transaction that was not in the upfront plan', async () => {
	const { reviewed, sendTransaction } = setup()
	const first = reviewed.sendTransaction({ to: account, value: 1n })
	await waitForReview()
	confirm()
	await first
	await expect(reviewed.sendTransaction({ to: account, value: 2n })).rejects.toThrow('transaction plan changed')
	expect(sendTransaction).toHaveBeenCalledTimes(1)
})

test('review wrapping preserves live simulation state getters', () => {
	let currentTimestamp = 1n
	const backend = withTransactionReviews({
		...createFakeBackend(),
		get currentTimestamp() {
			return currentTimestamp
		},
	})
	expect(backend.currentTimestamp).toBe(1n)
	currentTimestamp = 2n
	expect(backend.currentTimestamp).toBe(2n)
})

for (const reason of ['repriced', 'cancelled', 'replaced'] as const) {
	test(`tracks the mined replacement hash when a transaction is ${reason}`, async () => {
		const { reviewed, replacementHash } = setup(reason)
		const sending = reviewed.sendTransaction({ to: account, value: 1n })
		await waitForReview()
		confirm()
		await sending
		const receipt = reviewed.waitForTransactionReceipt({ hash })
		if (reason === 'repriced') await receipt
		else await expect(receipt).rejects.toThrow('Remaining steps were not sent')
		expect(transactionSteps.value?.steps[0]?.hash).toBe(replacementHash)
		expect(transactionSteps.value?.steps[0]?.phase).toBe(reason === 'repriced' ? 'confirmed' : 'failed')
	})
}

for (const method of ['sendTransaction', 'writeContract'] as const)
	for (const chosen of [1n, 3n, 9n, maxUint256]) {
		test(`uses the user's selected approval amount ${chosen} through ${method}`, async () => {
			const { client, receipt } = setup()
			let sentData: `0x${string}` | undefined
			const reviewed = createReviewedClient({
				...client,
				waitForTransactionReceipt: async () => receipt,
				writeContract: async parameters => {
					sentData = encodeFunctionData(parameters)
					return hash
				},
				readContract: createReadContractStub(request => {
					if (request.functionName === 'symbol') return 'REP'
					if (request.functionName === 'decimals') return 0
					return 0n
				}),
				sendTransaction: async parameters => {
					sentData = parameters.data
					return hash
				},
			})
			reviewed.onTransactionPlan?.([
				{ functionName: 'approve', contractAddress: account, args: [account, 6n] },
				{ functionName: 'report', contractAddress: account, tokenFunding: [{ tokenAddress: account, amount: 3n }] },
			])
			const data = encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [account, 6n] })
			reviewed.onTransactionPrepared?.({ functionName: 'approve', contractAddress: account, account, args: [account, 6n], chainName: client.chain.name, value: undefined, data })
			const sending = method === 'sendTransaction' ? reviewed.sendTransaction({ to: account, data }) : reviewed.writeContract({ address: account, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [account, 6n] })
			await waitForReview()
			expect(sentData).toBeUndefined()
			expect(transactionSteps.value?.steps[0]?.approval?.requiredAmount).toBe(3n)
			transactionSteps.value?.confirm(chosen)
			await sending
			if (sentData === undefined) throw new Error('Expected approval calldata')
			expect(decodeFunctionData({ abi: ABIS.mainnet.erc20, data: sentData }).args).toEqual([account, chosen])
			if (chosen < 3n) {
				await expect(reviewed.waitForTransactionReceipt({ hash })).rejects.toThrow('below the report requirement')
				expect(transactionSteps.value?.steps[0]?.phase).toBe('confirmed')
				expect(transactionSteps.value?.steps[0]?.error).toContain('below the report requirement')
				expect(transactionSteps.value?.steps[1]?.phase).toBe('upcoming')
			}
		})
	}
