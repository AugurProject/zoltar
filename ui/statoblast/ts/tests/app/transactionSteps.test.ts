import { requestOraclePrice } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createMockLoaderClient, createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { afterEach, expect, mock, test } from 'bun:test'
import { createWalletClient, custom, publicActions, encodeFunctionData, decodeFunctionData, maxUint256, type Hash, type TransactionReceipt, type ReplacementReason } from '@zoltar/core-shared/evm/ethereum'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { withTransactionReviews } from '@zoltar/ui-statoblast-shared/protocol/reviewedBackend.js'
import { registerTransactionReviewScope } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
import { createTransactionStepController, transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'

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

test('titles the review from the prepared transaction labels instead of the contract function name', async () => {
	const { reviewed, client } = setup()
	const reviewTitle = 'Create question and security pool'
	const reviewDescription = 'Creates the binary question and deploys its security pool in one transaction.'
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'aggregate3', contractAddress: account, args: [[]], data: '0x', value: undefined, reviewTitle, reviewDescription })
	const sending = reviewed.sendTransaction({ to: account, data: '0x' })
	await waitForReview()
	expect(transactionSteps.value?.steps[0]?.title).toBe(reviewTitle)
	expect(transactionSteps.value?.steps[0]?.description).toBe(reviewDescription)
	expect(transactionSteps.value?.steps[0]?.contractAddress).toBe(account)
	confirm()
	await sending
})

test('leaves the description empty for an unlabeled contract function instead of narrating the submission', async () => {
	const { reviewed, client } = setup()
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'depositRepToVault', contractAddress: account, contractLabel: 'Zoltar', args: [1n], data: '0x', value: undefined })
	const sending = reviewed.sendTransaction({ to: account, data: '0x' })
	await waitForReview()
	expect(transactionSteps.value?.steps[0]?.title).toBe('Deposit REP To Vault')
	expect(transactionSteps.value?.steps[0]?.description).toBeUndefined()
	confirm()
	await sending
})

test('keeps already readable plan step names unchanged', async () => {
	const { reviewed, client } = setup()
	const functionName = 'Deploy contract through deterministic proxy'
	reviewed.onTransactionPlan?.([{ functionName, to: account, value: 0n }])
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName, to: account, args: undefined, data: '0x', value: 0n })
	const sending = reviewed.sendTransaction({ to: account, data: '0x', value: 0n })
	await waitForReview()
	expect(transactionSteps.value?.steps[0]?.title).toBe(functionName)
	confirm()
	await sending
})

test('describes an unlabeled Multicall3 batch instead of exposing aggregate3', async () => {
	const { reviewed, client } = setup()
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'aggregate3', contractAddress: account, args: [[]], data: '0x', value: undefined })
	const sending = reviewed.sendTransaction({ to: account, data: '0x' })
	await waitForReview()
	expect(transactionSteps.value?.steps[0]?.title).toBe('Batched transaction')
	expect(transactionSteps.value?.steps[0]?.description).toBe('Run several contract calls in one transaction.')
	confirm()
	await sending
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
		else await expect(receipt).rejects.toThrow('Transaction canceled or replaced.')
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

test('funding approvals can be chosen independently and satisfied requirements are skipped', async () => {
	const { reviewed, sendTransaction } = setup()
	reviewed.onTransactionPlan?.([1n, 2n, 3n].map(value => ({ functionName: 'Transfer ETH', to: account, value })))
	if (reviewed.runFundingTransaction === undefined) throw new Error('Funding selection is unavailable')
	const selecting = reviewed.runFundingTransaction([0, 1], async index => {
		expect(index).toBe(1)
		await reviewed.sendTransaction({ to: account, value: 2n })
	})
	await waitForReview()
	expect(transactionSteps.value?.steps.slice(0, 2).map(step => step.phase)).toEqual(['review', 'review'])
	expect(() => reviewed.onTransactionPlan?.([])).toThrow('Cannot change a transaction plan')
	transactionSteps.value?.confirmStep(1)
	expect(await selecting).toBe(true)
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	await reviewed.runFundingTransaction([], async () => {
		throw new Error('Nothing to send')
	})
	expect(transactionSteps.value?.steps[0]?.phase).toBe('skipped')
	const final = reviewed.sendTransaction({ to: account, value: 3n })
	await waitForReview()
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	confirm()
	await final
	expect(sendTransaction).toHaveBeenCalledTimes(2)
})

test('a funding preparation failure unlocks cancellation and sends no transaction', async () => {
	const { reviewed, sendTransaction } = setup()
	reviewed.onTransactionPlan?.([1n, 2n].map(value => ({ functionName: 'Transfer ETH', to: account, value })))
	const running = reviewed.runFundingTransaction?.([0], async () => {
		throw new Error('Insufficient balance')
	})
	const rejected = running?.catch(error => error)
	await waitForReview()
	confirm()
	expect(await rejected).toBeInstanceOf(Error)
	expect(transactionSteps.value?.steps[0]?.phase).toBe('failed')
	expect(sendTransaction).not.toHaveBeenCalled()
})

for (const missing of ['balanceOf', 'allowance'] as const)
	test(`rechecks ${missing} after the final click before sending the report`, async () => {
		const { client, sendTransaction } = setup()
		const reviewed = createReviewedClient({
			...client,
			sendTransaction,
			readContract: createReadContractStub(request => {
				if (request.functionName === 'symbol') return 'REP'
				if (request.functionName === 'decimals') return 18
				return request.functionName === missing ? 0n : 10n
			}),
		})
		reviewed.onTransactionPlan?.([{ functionName: 'Transfer ETH', to: account, contractAddress: account, value: 0n, tokenFunding: [{ tokenAddress: account, amount: 3n }] }])
		const sending = reviewed.sendTransaction({ to: account, value: 0n }).catch(error => error)
		await waitForReview()
		confirm()
		expect(await sending).toBeInstanceOf(Error)
		expect(sendTransaction).not.toHaveBeenCalled()
		expect(transactionSteps.value?.steps[0]?.error).toContain('Funding requirements changed')
	})

for (const change of ['minimum', 'fee', 'lower-minimum', 'sufficient-allowance'] as const)
	test(`refreshes coordinator ${change} after review before opening the wallet`, async () => {
		const { client, sendTransaction, receipt } = setup()
		let minimum = 3n
		let allowance = 3n
		let baseFeePerGas = 0n
		const reads = createMockLoaderClient({
			getBlock: async () => ({ timestamp: 0n, number: 1n, baseFeePerGas }),
			multicall: async () => {
				throw new Error('Unexpected multicall')
			},
			readContract: async request => {
				switch (request.functionName) {
					case 'isPriceValid':
						return false
					case 'pendingReportId':
						return 0n
					case 'reputationToken':
						return account
					case 'minimumToken1ReportAttoEth':
						return minimum
					case 'balanceOf':
						return 1000n
					case 'allowance':
						return allowance
					case 'symbol':
						return 'REP'
					case 'decimals':
						return 18
					case 'getSettlementCallbackGasLimit':
						return 10
					case 'gasConsumedOpenOracleReportPrice':
						return 20n
					default:
						throw new Error(`Unexpected read: ${request.functionName}`)
				}
			},
		})
		const reviewed = createReviewedClient({ ...client, ...reads, estimateGas: async () => 100000n, getBalance: async () => 1000n, sendTransaction, waitForTransactionReceipt: async () => receipt })
		const action = requestOraclePrice(reviewed, account, 10n ** 18n, 0n, 122n).catch(error => error)
		await waitForReview()
		expect(transactionSteps.value?.steps).toHaveLength(3)
		for (const step of transactionSteps.value?.steps.slice(0, 2) ?? []) {
			expect(step.phase).toBe('skipped')
			expect(step.approval?.requiredAmount).toBe(3n)
			expect(step.approval?.approvedAmount).toBe(3n)
		}
		if (change === 'minimum') minimum = 4n
		if (change === 'fee') baseFeePerGas = 2n
		if (change === 'lower-minimum') {
			minimum = 2n
			allowance = 2n
		}
		if (change === 'sufficient-allowance') {
			minimum = 4n
			allowance = 4n
		}
		confirm()
		if (change === 'lower-minimum' || change === 'sufficient-allowance') {
			expect(await action).toEqual({ action: 'requestPrice', hash })
			expect(sendTransaction).toHaveBeenCalledTimes(1)
		} else {
			expect(await action).toBeInstanceOf(Error)
			expect(sendTransaction).not.toHaveBeenCalled()
			expect(transactionSteps.value?.steps.at(-1)?.phase).toBe('failed')
		}
	})

test('an aborted preparation cannot replace or cancel an independent review', async () => {
	const { client, sendTransaction } = setup()
	const delayed = createDeferred<void>()
	const cancellation = new AbortController()
	const obsolete = createReviewedClient({ ...client, sendTransaction }, async () => await delayed.promise, cancellation.signal)
	const result = obsolete.sendTransaction({ to: account, value: 1n }).then(
		() => 'sent',
		() => 'canceled',
	)
	await Promise.resolve()
	cancellation.abort()
	const independent = setup()
	const sending = independent.reviewed.sendTransaction({ to: account, value: 2n })
	await waitForReview()
	delayed.resolve()
	expect(await result).toBe('canceled')
	expect(transactionSteps.value?.steps[0]?.ethValueAttoEth).toBe(2n)
	confirm()
	await sending
	expect(sendTransaction).not.toHaveBeenCalled()
	expect(independent.sendTransaction).toHaveBeenCalledTimes(1)
})

test('aborting a review during post-confirmation validation prevents submission', async () => {
	const { client, sendTransaction } = setup()
	const delayed = createDeferred<void>()
	const validating = createDeferred<void>()
	const cancellation = new AbortController()
	let checks = 0
	const reviewed = createReviewedClient(
		{ ...client, sendTransaction },
		async () => {
			checks += 1
			if (checks === 2) {
				validating.resolve()
				await delayed.promise
			}
		},
		cancellation.signal,
	)
	const result = reviewed.sendTransaction({ to: account, value: 1n }).then(
		() => 'sent',
		() => 'canceled',
	)
	await waitForReview()
	confirm()
	await validating.promise
	cancellation.abort()
	delayed.resolve()
	expect(await result).toBe('canceled')
	expect(sendTransaction).not.toHaveBeenCalled()
	expect(transactionSteps.value).toBeUndefined()
})

test('the reviewed backend forwards review cancellation to its client', async () => {
	const cancellation = new AbortController()
	const { client: baseClient, sendTransaction } = setup()
	const backend = withTransactionReviews({ ...createFakeBackend({ accountAddress: account }), createWriteClient: () => ({ ...baseClient, sendTransaction }) })
	const client = backend.createWriteClient(account, { reviewSignal: cancellation.signal })
	cancellation.abort()
	await expect(client.sendTransaction({ to: account, value: 1n })).rejects.toThrow()
	expect(transactionSteps.value).toBeUndefined()
})

for (const outcome of ['success', 'reverted'] as const) {
	test(`simulates the final price request from the connected wallet before submission: ${outcome}`, async () => {
		const { client, sendTransaction } = setup()
		const estimateGas = mock(async () => {
			if (outcome === 'reverted') throw new Error('Oracle price request is already pending')
			return 100001n
		})
		const reviewed = createReviewedClient({ ...client, sendTransaction, estimateGas })
		reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'requestPrice', contractAddress: account, args: [1n, 0n], data: '0x1234', value: 2n })
		const result = reviewed.sendTransaction({ to: account, data: '0x1234', value: 2n }).catch(error => error)
		await waitForReview()
		expect(estimateGas).not.toHaveBeenCalled()
		confirm()
		const value = await result
		expect(estimateGas).toHaveBeenCalledWith({ account: client.account, to: account, data: '0x1234', value: 2n })
		if (outcome === 'reverted') {
			expect(value).toBeInstanceOf(Error)
			expect(sendTransaction).not.toHaveBeenCalled()
			expect(transactionSteps.value?.steps[0]?.error).toContain('already pending')
		} else {
			expect(value).toBe(hash)
			expect(sendTransaction).toHaveBeenCalledWith({ to: account, data: '0x1234', value: 2n })
			expect(sendTransaction).toHaveBeenCalledTimes(1)
		}
	})
}

test('a reverted final transaction does not claim there are remaining steps', async () => {
	const controller = createTransactionStepController()
	controller.setPlan([{ title: 'Request price', description: '', contractAddress: account, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }])
	const review = controller.review()
	confirm()
	await review
	controller.submitted(hash)
	controller.receipt(hash, 'reverted')
	expect(transactionSteps.value?.steps[0]?.error).toBe('Transaction reverted.')
})

for (const diagnostic of ['out-of-gas', 'unavailable'] as const) {
	test(`retains the failed transaction hash with ${diagnostic} receipt diagnostics`, async () => {
		const { client, sendTransaction, receipt } = setup()
		const reviewed = createReviewedClient({
			...client,
			sendTransaction,
			waitForTransactionReceipt: async () => ({ ...receipt, status: 'reverted' }),
			getTransaction: async () => {
				if (diagnostic === 'unavailable') throw new Error('RPC unavailable')
				return { hash, from: account, to: account, gas: receipt.gasUsed, input: '0x', nonce: 0n, value: 0n }
			},
		})
		const sending = reviewed.sendTransaction({ to: account, value: 1n })
		await waitForReview()
		confirm()
		await sending
		if (diagnostic === 'out-of-gas') await expect(reviewed.waitForTransactionReceipt({ hash })).rejects.toThrow('full gas limit')
		else await reviewed.waitForTransactionReceipt({ hash })
		expect(transactionSteps.value?.steps[0]?.hash).toBe(hash)
		expect(transactionSteps.value?.steps[0]?.error).toBe(diagnostic === 'out-of-gas' ? 'Transaction failed after using its full gas limit. Open the transaction details before retrying.' : 'Transaction reverted.')
	})
}

test('canceling while the price request gas estimate is pending prevents submission', async () => {
	const { client, sendTransaction } = setup()
	const estimated = createDeferred<bigint>()
	const estimating = createDeferred<void>()
	const cancellation = new AbortController()
	const reviewed = createReviewedClient(
		{
			...client,
			sendTransaction,
			estimateGas: async () => {
				estimating.resolve()
				return await estimated.promise
			},
		},
		undefined,
		cancellation.signal,
	)
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'requestPrice', contractAddress: account, args: [1n, 0n], data: '0x1234', value: 2n })
	const result = reviewed.sendTransaction({ to: account, data: '0x1234', value: 2n }).catch(error => error)
	await waitForReview()
	confirm()
	await estimating.promise
	cancellation.abort()
	estimated.resolve(100000n)
	expect(await result).toBeInstanceOf(Error)
	expect(sendTransaction).not.toHaveBeenCalled()
})

for (const explicit of [false, true]) {
	test(`captures the initiating modal scope without overriding explicit ownership: ${explicit}`, async () => {
		const modal = new AbortController()
		const independent = new AbortController()
		const unregister = registerTransactionReviewScope(modal.signal)
		const { client, sendTransaction } = setup()
		const reviewed = createReviewedClient({ ...client, sendTransaction }, undefined, explicit ? independent.signal : undefined)
		try {
			const sending = reviewed.sendTransaction({ to: account, value: 1n }).then(
				() => 'sent',
				() => 'canceled',
			)
			await waitForReview()
			expect(transactionSteps.value?.reviewSignal).toBe(explicit ? independent.signal : modal.signal)
			modal.abort()
			unregister()
			if (explicit) confirm()
			expect(await sending).toBe(explicit ? 'sent' : 'canceled')
			expect(sendTransaction).toHaveBeenCalledTimes(explicit ? 1 : 0)
		} finally {
			unregister()
			independent.abort()
		}
	})
}

test('describes a standalone unlimited approval as Max REP', async () => {
	const { client } = setup()
	const reviewed = createReviewedClient({ ...client, readContract: createReadContractStub(request => (request.functionName === 'symbol' ? 'REP' : 18)), sendTransaction: async () => hash })
	const data = encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [account, maxUint256] })
	reviewed.onTransactionPrepared?.({ functionName: 'approve', contractAddress: account, account, args: [account, maxUint256], chainName: client.chain.name, value: undefined, data })
	const sending = reviewed.sendTransaction({ to: account, data })
	await waitForReview()
	try {
		expect(transactionSteps.value?.steps[0]?.amount).toBe('Max REP')
	} finally {
		confirm()
		await sending
	}
})
