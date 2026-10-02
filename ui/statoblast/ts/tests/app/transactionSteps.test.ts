import { createCompleteSetInSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { requestOraclePrice, queueOracleManagerOperation, queueSecurityPoolLiquidation } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createBlockWithTimestamp, createMockLoaderClient, createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { afterEach, expect, mock, test } from 'bun:test'
import { createWalletClient, custom, publicActions, encodeFunctionData, decodeFunctionData, maxUint256, type Hash, type TransactionReceipt, type ReplacementReason } from '@zoltar/core-shared/evm/ethereum'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { withTransactionReviews } from '@zoltar/ui-statoblast-shared/protocol/reviewedBackend.js'
import { runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFailed, markTransactionFinished, markTransactionRequested } from '@zoltar/ui-core-shared/transactions/transactionTray.js'
import { registerTransactionReviewScope, registerTransactionPreparationScope } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
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

async function waitForTransactionStep(index: number) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (transactionSteps.value?.steps[index]?.phase === 'review') {
			return
		}
		await new Promise(resolve => setTimeout(resolve, 1))
	}
	throw new Error(`Transaction step ${index} was not ready`)
}

async function clickTransactionStep(index: number, amount?: bigint) {
	await waitForTransactionStep(index)
	transactionSteps.value?.confirmStep(index, amount)
}

async function waitForStarted() {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (transactionSteps.value?.steps[transactionSteps.value.activeIndex] !== undefined) return
		await new Promise(resolve => setTimeout(resolve, 1))
	}
	throw new Error('No transaction started')
}

function confirm() {
	const current = transactionSteps.value
	if (current === undefined) throw new Error('No transaction to confirm')
	current.confirm()
}

afterEach(() => transactionSteps.value?.cancel())

test('opens the wallet directly without an app confirmation', async () => {
	const { reviewed, sendTransaction, onTransactionPrepared } = setup()
	const sending = reviewed.sendTransaction({ to: account, value: 1n })
	await new Promise(resolve => setTimeout(resolve, 10))
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(transactionSteps.value?.showReviewDialog).toBe(false)
	await sending
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(onTransactionPrepared).toHaveBeenCalledTimes(1)
})

test('a wallet-only pool action starts the wallet request without a page confirmation', async () => {
	const { client, sendTransaction } = setup()
	const walletRequest = createDeferred<Hash>()
	sendTransaction.mockImplementationOnce(async () => await walletRequest.promise)
	const backend = withTransactionReviews({ ...createFakeBackend({ accountAddress: account }), createWriteClient: () => ({ ...client, sendTransaction }) })
	const reviewed = backend.createWriteClient(account, {})
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'aggregate3', contractAddress: account, args: [[]], data: '0x1234', value: 1n })
	const sending = reviewed.sendTransaction({ to: account, data: '0x1234', value: 1n })
	await new Promise(resolve => setTimeout(resolve, 10))
	try {
		expect(transactionSteps.value?.steps[0]?.phase).toBe('wallet')
		expect(sendTransaction).toHaveBeenCalledTimes(1)
	} finally {
		walletRequest.resolve(hash)
		transactionSteps.value?.cancel()
		await sending.catch(() => undefined)
	}
})

test('reporting requires a separate button click for the deposit and report', async () => {
	const { client, receipt, sendTransaction } = setup()
	const reviewed = createReviewedClient({ ...client, sendTransaction, waitForTransactionReceipt: async parameters => ({ ...receipt, transactionHash: parameters.hash }) })
	const steps = ['depositRepToVault', 'depositToEscalationGame'].map(functionName => ({ functionName, contractAddress: account, args: [1n, 1n], data: '0x1234' as const }))
	reviewed.onTransactionPlan?.(steps)
	const action = (async () => {
		for (const step of steps) {
			reviewed.onTransactionPrepared?.({ ...step, account, chainName: client.chain.name, value: undefined })
			const submittedHash = await reviewed.sendTransaction({ to: account, data: step.data })
			await reviewed.waitForTransactionReceipt({ hash: submittedHash })
		}
	})()
	const settled = action.catch(error => error)
	try {
		await waitForStarted()
		expect(sendTransaction).not.toHaveBeenCalled()
		expect(transactionSteps.value?.showReviewDialog).toBe(true)
		confirm()
		await new Promise(resolve => setTimeout(resolve, 10))
		expect(sendTransaction).toHaveBeenCalledTimes(1)
		expect(transactionSteps.value?.steps.map(step => step.phase)).toEqual(['confirmed', 'review'])
		confirm()
		expect(await settled).toBeUndefined()
		expect(sendTransaction).toHaveBeenCalledTimes(2)
	} finally {
		transactionSteps.value?.cancel()
		await settled
	}
})

test('wallet-only steps cannot skip an unconfirmed deposit', () => {
	const controller = createTransactionStepController()
	const step = { title: 'Deposit REP', description: undefined, contractAddress: account, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: undefined }
	controller.setPlan([step, step])
	expect(() => controller.startWithoutReview(1)).toThrow()
	controller.startWithoutReview(0)
	expect(() => controller.startWithoutReview(1)).toThrow()
	controller.submitted(hash)
	controller.receipt(hash, 'reverted')
	expect(() => controller.startWithoutReview(1)).toThrow()
})

test('a wallet-only pool action reports a wallet rejection without waiting for a page confirmation', async () => {
	const { client, sendTransaction } = setup()
	sendTransaction.mockRejectedValueOnce(new Error('User rejected the request'))
	const backend = withTransactionReviews({ ...createFakeBackend({ accountAddress: account }), createWriteClient: () => ({ ...client, sendTransaction }) })
	const reviewed = backend.createWriteClient(account, {})
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'aggregate3', contractAddress: account, args: [[]], data: '0x1234', value: 1n })
	await expect(reviewed.sendTransaction({ to: account, data: '0x1234', value: 1n })).rejects.toThrow('User rejected the request')
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(transactionSteps.value?.steps[0]?.phase).toBe('failed')
})

test('a direct token approval sends its selected amount without app review', async () => {
	const { client, sendTransaction } = setup()
	const reviewed = createReviewedClient({ ...client, sendTransaction, readContract: createReadContractStub(request => (request.functionName === 'symbol' ? 'REP' : 18)) })
	const data = encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [account, 7n] })
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'approve', contractAddress: account, args: [account, 7n], data, value: 0n })
	await reviewed.sendTransaction({ to: account, data, value: 0n })
	expect(sendTransaction).toHaveBeenCalledWith({ to: account, data, value: 0n })
	expect(transactionSteps.value?.showReviewDialog).toBe(false)
})

test('wallet-only mode refuses calldata that differs from its prepared transaction', async () => {
	const { client, sendTransaction } = setup()
	const reviewed = createReviewedClient({ ...client, sendTransaction })
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'aggregate3', contractAddress: account, args: [[]], data: '0x1234', value: undefined })
	await expect(reviewed.sendTransaction({ to: account, data: '0x095ea7b3' })).rejects.toThrow('The prepared transaction changed.')
	expect(sendTransaction).not.toHaveBeenCalled()
})

/** Sends a prepared transaction directly and returns its status step. */
async function sendPreparedTransaction(prepared: Omit<Parameters<NonNullable<ReturnType<typeof setup>['reviewed']['onTransactionPrepared']>>[0], 'account' | 'chainName' | 'data' | 'value'>) {
	const { reviewed, client } = setup()
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, data: '0x', value: undefined, ...prepared })
	const sending = reviewed.sendTransaction({ to: account, data: '0x' })
	await waitForStarted()
	await sending
	return transactionSteps.value?.steps[0]
}

test('titles transaction status from the prepared transaction labels instead of the contract function name', async () => {
	const reviewTitle = 'Create question and security pool'
	const reviewDescription = 'Creates the binary question and deploys its security pool in one transaction.'
	const step = await sendPreparedTransaction({ functionName: 'aggregate3', contractAddress: account, args: [[]], reviewTitle, reviewDescription })
	expect(step?.title).toBe(reviewTitle)
	expect(step?.description).toBe(reviewDescription)
	expect(step?.contractAddress).toBe(account)
})

for (const [functionName, title, args] of [
	['depositToEscalationGame', 'Report No · 2\u00a0REP', [2n, 2n * 10n ** 18n]],
	['depositWalletRepToEscalationGame', 'Report No · 2\u00a0REP', [2n, 2n * 10n ** 18n]],
	['depositRepOnOutcome', 'Report No · 2\u00a0REP', [2n, 2n * 10n ** 18n]],
	['settle', 'Settle report #7', [7n]],
	['withdrawFromEscalationGame', 'Settle escalation deposits', []],
	['report', 'Create oracle report', []],
	['withdrawTo', 'Withdraw oracle balance', []],
] satisfies Array<[string, string, bigint[]]>) {
	test(`uses explicit reporting copy for ${functionName}`, async () => {
		const step = await sendPreparedTransaction({ functionName, contractAddress: account, args })
		expect(step?.title).toBe(title)
		if (functionName === 'depositToEscalationGame') expect(step?.paidFrom).toBe('Pool vault REP')
		if (functionName === 'depositWalletRepToEscalationGame') expect(step?.paidFrom).toBe('Wallet REP')
	})
}

test('keeps explicit dispute copy when its planned guard prevents broadcasting', async () => {
	const { reviewed, client, sendTransaction } = setup()
	reviewed.onTransactionPlan?.([
		{
			functionName: 'dispute',
			contractAddress: account,
			validateBeforeSubmit: async () => {
				throw new Error('Missing oracle dispute details. Review the action again.')
			},
		},
	])
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'dispute', contractAddress: account, args: [], data: '0x', value: undefined })
	await expect(reviewed.sendTransaction({ to: account, data: '0x' })).rejects.toThrow('Missing oracle dispute details')
	expect(transactionSteps.value?.steps[0]?.title).toBe('Dispute report')
	expect(sendTransaction).not.toHaveBeenCalled()
})

test('leaves the description empty for an unlabeled contract function instead of narrating the submission', async () => {
	const step = await sendPreparedTransaction({ functionName: 'depositRepToVault', contractAddress: account, contractLabel: 'Zoltar', args: [1n] })
	expect(step?.title).toBe('Deposit REP to vault')
	expect(step?.description).toBeUndefined()
})

test('keeps already readable plan step names unchanged', async () => {
	const { reviewed, client } = setup()
	const functionName = 'Deploy contract through deterministic proxy'
	reviewed.onTransactionPlan?.([{ functionName, to: account, value: 0n }])
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName, to: account, args: undefined, data: '0x', value: 0n })
	const sending = reviewed.sendTransaction({ to: account, data: '0x', value: 0n })
	await waitForStarted()
	expect(transactionSteps.value?.steps[0]?.title).toBe(functionName)
	await sending
})

test('describes an unlabeled Multicall3 batch instead of exposing aggregate3', async () => {
	const step = await sendPreparedTransaction({ functionName: 'aggregate3', contractAddress: account, args: [[]] })
	expect(step?.title).toBe('Batched transaction')
	expect(step?.description).toBe('Run several contract calls in one transaction.')
})

test('a chained action waits for receipts and a separate click for each wallet request', async () => {
	const { client, sendTransaction, receipt } = setup()
	const mined = createDeferred<TransactionReceipt>()
	const reviewed = createReviewedClient({ ...client, sendTransaction, waitForTransactionReceipt: async () => await mined.promise })
	reviewed.onTransactionPlan?.([1n, 2n].map(value => ({ functionName: 'Transfer ETH', to: account, value })))
	const action = (async () => {
		await reviewed.sendTransaction({ to: account, value: 1n })
		await reviewed.waitForTransactionReceipt({ hash })
		await reviewed.sendTransaction({ to: account, value: 2n })
	})()
	await clickTransactionStep(0)
	await new Promise(resolve => setTimeout(resolve, 10))
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(transactionSteps.value?.steps.map(step => step.phase)).toEqual(['pending', 'upcoming'])
	mined.resolve({ ...receipt, transactionHash: hash })
	await clickTransactionStep(1)
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	await action
	expect(sendTransaction).toHaveBeenCalledTimes(2)
	expect(transactionSteps.value?.showReviewDialog).toBe(true)
})

test('rejecting a later wallet request prevents remaining transactions', async () => {
	const { client, sendTransaction, receipt } = setup()
	sendTransaction.mockResolvedValueOnce(hash).mockRejectedValueOnce(new Error('User rejected the request'))
	const reviewed = createReviewedClient({ ...client, sendTransaction, waitForTransactionReceipt: async () => ({ ...receipt, transactionHash: hash }) })
	reviewed.onTransactionPlan?.([1n, 2n, 3n].map(value => ({ functionName: 'Transfer ETH', to: account, value })))
	const action = (async () => {
		for (const value of [1n, 2n, 3n]) {
			await reviewed.sendTransaction({ to: account, value })
			await reviewed.waitForTransactionReceipt({ hash })
		}
	})()
	const rejected = action.catch(error => error)
	await clickTransactionStep(0)
	await clickTransactionStep(1)
	expect((await rejected).message).toContain('User rejected')
	expect(sendTransaction).toHaveBeenCalledTimes(2)
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
	await clickTransactionStep(0)
	expect(await rejected).toBeInstanceOf(Error)
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(transactionSteps.value?.steps[0]?.phase).toBe('failed')
})

test('a changed environment cannot submit during preparation', async () => {
	const { client, sendTransaction } = setup()
	const ready = createDeferred<void>()
	const resume = createDeferred<void>()
	const reviewed = createReviewedClient({ ...client, sendTransaction }, async () => {
		ready.resolve()
		await resume.promise
	})
	const rejected = reviewed.sendTransaction({ to: account, value: 1n }).catch(error => error)
	await ready.promise
	resetActiveEnvironmentForTesting()
	resume.resolve()
	expect(await rejected).toBeInstanceOf(Error)
	expect(sendTransaction).not.toHaveBeenCalled()
})

test('redundant confirmation callbacks cannot resubmit a pending wallet request', async () => {
	const { reviewed, sendTransaction } = setup()
	const submitted = createDeferred<Hash>()
	sendTransaction.mockImplementationOnce(async () => await submitted.promise)
	const sending = reviewed.sendTransaction({ to: account, value: 1n })
	await waitForStarted()
	const confirmStep = transactionSteps.value?.confirm
	confirmStep?.()
	confirmStep?.()
	await new Promise(resolve => setTimeout(resolve, 1))
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(transactionSteps.value?.steps.at(-1)?.phase).toBe('wallet')
	submitted.resolve(hash)
	await sending
})

test('blocks a transaction that was not in the upfront plan', async () => {
	const { reviewed, sendTransaction } = setup()
	const first = reviewed.sendTransaction({ to: account, value: 1n })
	await waitForStarted()
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
		await waitForStarted()
		await sending
		const receipt = reviewed.waitForTransactionReceipt({ hash })
		if (reason === 'repriced') await receipt
		else await expect(receipt).rejects.toThrow('Transaction canceled or replaced.')
		expect(transactionSteps.value?.steps[0]?.hash).toBe(replacementHash)
		expect(transactionSteps.value?.steps[0]?.phase).toBe(reason === 'repriced' ? 'confirmed' : 'failed')
	})
}

for (const method of ['sendTransaction', 'writeContract'] as const) {
	test.each([3n, 5n, maxUint256])(`funding approval preserves the selected amount through ${method}: %s`, async selectedAmount => {
		const { client, receipt } = setup()
		let sentData: `0x${string}` | undefined
		const reviewed = createReviewedClient({
			...client,
			waitForTransactionReceipt: async () => ({ ...receipt, transactionHash: hash }),
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
		await clickTransactionStep(0, selectedAmount)
		await sending
		if (sentData === undefined) throw new Error('Expected approval calldata')
		expect(decodeFunctionData({ abi: ABIS.mainnet.erc20, data: sentData }).args).toEqual([account, selectedAmount])
		expect(transactionSteps.value?.showReviewDialog).toBe(true)
		await reviewed.waitForTransactionReceipt({ hash })
		expect(transactionSteps.value?.steps[0]?.phase).toBe('confirmed')
	})
}

test('funding runs in order and skips satisfied requirements before the final transaction', async () => {
	const { client, sendTransaction, receipt } = setup()
	const reviewed = createReviewedClient({ ...client, sendTransaction, waitForTransactionReceipt: async () => ({ ...receipt, transactionHash: hash }) })
	reviewed.onTransactionPlan?.([1n, 2n, 3n].map(value => ({ functionName: 'Transfer ETH', to: account, value })))
	if (reviewed.runFundingTransaction === undefined) throw new Error('Funding unavailable')
	const funding = reviewed.runFundingTransaction([1], async index => {
		expect(index).toBe(1)
		await reviewed.sendTransaction({ to: account, value: 2n })
		await reviewed.waitForTransactionReceipt({ hash })
	})
	await clickTransactionStep(1)
	expect(await funding).toBe(true)
	expect(() => reviewed.onTransactionPlan?.([])).toThrow('Cannot change a transaction plan')
	expect(
		await reviewed.runFundingTransaction([], async () => {
			throw new Error('Nothing to send')
		}),
	).toBe(false)
	expect(transactionSteps.value?.steps[0]?.phase).toBe('skipped')
	const final = reviewed.sendTransaction({ to: account, value: 3n })
	await clickTransactionStep(2)
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
	await clickTransactionStep(0)
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
		await waitForStarted()
		expect(await sending).toBeInstanceOf(Error)
		expect(sendTransaction).not.toHaveBeenCalled()
		expect(transactionSteps.value?.steps[0]?.failure?.message).toContain('Funding requirements changed')
	})

function createCoordinatorFundingReads(readAllowance: (token: string) => bigint, minimum = () => 3n, baseFee = () => 0n) {
	return createMockLoaderClient({
		getBlock: async () => ({ timestamp: 0n, number: 1n, baseFeePerGas: baseFee() }),
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
				case 'gasUnitsForOneDispute':
					return 1n
				case 'initialReportPriorityFeeAttoEthPerGas':
					return 1n
				case 'targetPriceErrorForDispute':
					return 10_000_000n
				case 'openOracleSecurityMultiplierBps':
					return 10_000n
				case 'protocolFee':
					return 0
				case 'feePercentage':
					return 0
				case 'securityPool':
					return account
				case 'settlementCollateralAttoEth':
					return (minimum() - 2n) * 100n
				case 'balanceOf':
					return 1000n
				case 'allowance':
					return readAllowance(request.address)
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
}

for (const operation of ['requestPrice', 'setVaultUnderwritingLimit', 'withdrawRep', 'liquidation'] as const) {
	test(`${operation} exposes separate funding buttons and never advances the wallet automatically`, async () => {
		const { client, receipt } = setup()
		const needsWrap = operation === 'setVaultUnderwritingLimit'
		let wethBalanceAttoEth = needsWrap ? 0n : 1000n
		const allowances = new Map<string, bigint>()
		const reads = createCoordinatorFundingReads(token => allowances.get(token) ?? 0n)
		let submissionCount = 0
		const sendTransaction = mock(async (parameters: Parameters<typeof client.sendTransaction>[0]) => {
			if (parameters.data === '0xd0e30db0') wethBalanceAttoEth = 1000n
			if (parameters.data !== undefined && parameters.to !== undefined && parameters.data.startsWith('0x095ea7b3')) {
				const decoded = decodeFunctionData({ abi: ABIS.mainnet.erc20, data: parameters.data })
				if (decoded.functionName === 'approve') allowances.set(parameters.to, decoded.args[1])
			}
			submissionCount += 1
			return `0x${submissionCount.toString(16).padStart(64, '0')}` satisfies Hash
		})
		const reviewed = createReviewedClient({
			...client,
			...reads,
			readContract: createReadContractStub(request => {
				if (request.functionName === 'balanceOf' && request.address !== account) return wethBalanceAttoEth
				if (request.functionName === 'lastPrice') return 0n
				if (request.functionName === 'getPendingSettlementOperationIds') return []
				if (request.functionName === 'MAX_PENDING_SETTLEMENT_OPERATIONS') return 4n
				if (request.functionName === 'getQueuedOperationCostAttoEth') return 2n
				return reads.readContract(request)
			}),
			getGasPrice: async () => 1n,
			estimateGas: async () => 100000n,
			getBalance: async () => 1000n,
			sendTransaction,
			waitForTransactionReceipt: async parameters => ({ ...receipt, transactionHash: parameters.hash }),
		})
		const submit = async () => {
			if (operation === 'requestPrice') return await requestOraclePrice(reviewed, account, 10n ** 18n, 0n, 122n)
			if (operation === 'liquidation') return await queueSecurityPoolLiquidation(reviewed, account, account, 1n, 60n, 0n, account, undefined, 10n ** 18n)
			return await queueOracleManagerOperation(reviewed, account, operation, account, 1n, 60n, 10n ** 18n)
		}
		const action = submit().catch(error => error)
		try {
			const transactionCount = needsWrap ? 4 : 3
			for (let index = 0; index < transactionCount; index += 1) {
				await waitForTransactionStep(index)
				expect(sendTransaction).toHaveBeenCalledTimes(index)
				expect(transactionSteps.value?.showReviewDialog).toBe(true)
				if (needsWrap && index === 0) expect(transactionSteps.value?.steps[index]?.title).toBe('Wrap ETH into WETH')
				else if (index < transactionCount - 1) expect(transactionSteps.value?.steps[index]?.approval).toBeDefined()
				transactionSteps.value?.confirmStep(index)
			}
			expect(await action).not.toBeInstanceOf(Error)
			expect(sendTransaction).toHaveBeenCalledTimes(transactionCount)
		} finally {
			transactionSteps.value?.cancel()
			await action
		}
	})
}

for (const change of ['minimum', 'fee', 'lower-minimum', 'sufficient-allowance'] as const)
	test(`refreshes coordinator ${change} during preparation before opening the wallet`, async () => {
		const { client, sendTransaction, receipt } = setup()
		let minimum = 3n
		let allowance = 3n
		let baseFeePerGas = 0n
		const reads = createCoordinatorFundingReads(
			() => allowance,
			() => minimum,
			() => baseFeePerGas,
		)
		const ready = createDeferred<void>()
		const resume = createDeferred<void>()
		let validations = 0
		const reviewed = createReviewedClient({ ...client, ...reads, getGasPrice: async () => 1n, estimateGas: async () => 100000n, getBalance: async () => 1000n, sendTransaction, waitForTransactionReceipt: async () => receipt }, async () => {
			validations += 1
			if (validations === 3) {
				ready.resolve()
				await resume.promise
			}
		})
		const action = requestOraclePrice(reviewed, account, 10n ** 18n, 0n, 122n).catch(error => error)
		await clickTransactionStep(2)
		await ready.promise
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
		resume.resolve()
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
	await waitForStarted()
	delayed.resolve()
	expect(await result).toBe('canceled')
	expect(transactionSteps.value?.steps[0]?.ethValueAttoEth).toBe(2n)
	await sending
	expect(sendTransaction).not.toHaveBeenCalled()
	expect(independent.sendTransaction).toHaveBeenCalledTimes(1)
})

test('aborting a review during pre-submit validation prevents submission', async () => {
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
	await waitForStarted()
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

for (const functionName of ['requestPrice', 'requestPriceIfNeededAndStageOperation', 'requestPriceIfNeededAndStageLiquidation'])
	for (const outcome of ['success', 'reverted'] as const) {
		test(`simulates ${functionName} with fees from the connected wallet before submission: ${outcome}`, async () => {
			const { client, sendTransaction } = setup()
			const estimateGas = mock(async () => {
				if (outcome === 'reverted') throw new Error('Oracle price request is already pending')
				return 100001n
			})
			const reviewed = createReviewedClient({ ...client, sendTransaction, estimateGas, getGasPrice: async () => 2_540_635_026n })
			reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName, contractAddress: account, args: [1n, 0n], data: '0x1234', value: 2n })
			const result = reviewed.sendTransaction({ to: account, data: '0x1234', value: 2n }).catch(error => error)
			await waitForStarted()
			const value = await result
			expect(estimateGas).toHaveBeenCalledWith({ account: client.account, to: account, data: '0x1234', value: 2n, gasPrice: 2_540_635_026n })
			if (outcome === 'reverted') {
				expect(value).toBeInstanceOf(Error)
				expect(sendTransaction).not.toHaveBeenCalled()
				expect(transactionSteps.value?.steps[0]?.failure?.message).toContain('already pending')
			} else {
				expect(value).toBe(hash)
				expect(sendTransaction).toHaveBeenCalledWith({ to: account, data: '0x1234', value: 2n, gas: 150002n })
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
	expect(transactionSteps.value?.steps[0]?.failure?.message).toBe('Transaction reverted.')
})

test.each([undefined, 90000n, 200000n])('submits a fee-aware buffered contract gas estimate without reducing an explicit limit: %s', async gas => {
	const { client } = setup()
	const writeContract = mock(async () => hash)
	const estimateGas = mock(async () => 100001n)
	const reviewed = createReviewedClient({ ...client, writeContract, estimateGas, getGasPrice: async () => 2n })
	const parameters = {
		address: account,
		abi: [{ type: 'function', name: 'requestPrice', stateMutability: 'payable', inputs: [{ name: 'price', type: 'uint256' }], outputs: [] }],
		functionName: 'requestPrice',
		args: [1n],
		value: 2n,
		gas,
	} as const
	expect(await reviewed.writeContract(parameters)).toBe(hash)
	expect(estimateGas).toHaveBeenCalledWith({ account: client.account, to: account, data: encodeFunctionData(parameters), value: 2n, gasPrice: 2n })
	expect(writeContract).toHaveBeenCalledWith({ ...parameters, gas: gas === 200000n ? gas : 150002n })
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
		await waitForStarted()
		await sending
		if (diagnostic === 'out-of-gas') await expect(reviewed.waitForTransactionReceipt({ hash })).rejects.toThrow('full gas limit')
		else await reviewed.waitForTransactionReceipt({ hash })
		expect(transactionSteps.value?.steps[0]?.hash).toBe(hash)
		expect(transactionSteps.value?.steps[0]?.failure?.message).toBe(diagnostic === 'out-of-gas' ? 'Transaction failed after using its full gas limit. Open the transaction details before retrying.' : 'Transaction reverted.')
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
			getGasPrice: async () => 1n,
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
	await waitForStarted()
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
		const resume = createDeferred<void>()
		const ready = createDeferred<void>()
		let checks = 0
		const reviewed = createReviewedClient(
			{ ...client, sendTransaction },
			async () => {
				if (++checks === 2) {
					ready.resolve()
					await resume.promise
				}
			},
			explicit ? independent.signal : undefined,
		)
		try {
			const sending = reviewed.sendTransaction({ to: account, value: 1n }).then(
				() => 'sent',
				() => 'canceled',
			)
			await ready.promise
			expect(transactionSteps.value?.reviewSignal).toBe(explicit ? independent.signal : modal.signal)
			modal.abort()
			unregister()
			resume.resolve()
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
	await waitForStarted()
	try {
		expect(transactionSteps.value?.steps[0]?.amount).toBe('Max\u00a0REP')
	} finally {
		await sending
	}
})

for (const phase of ['before-send', 'validation', 'metadata', 'funding', 'after-confirmation'] as const) {
	test(`closing the initiating scope during ${phase} clears the action without reporting failure`, async () => {
		const { client, sendTransaction } = setup()
		const restore = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: account }))
		const scope = new AbortController()
		const unregister = registerTransactionReviewScope(scope.signal)
		const reached = createDeferred<void>()
		const resume = createDeferred<void>()
		const pause = async () => {
			reached.resolve()
			await resume.promise
		}
		let validationCount = 0
		const reviewed = createReviewedClient(
			{
				...client,
				sendTransaction,
				readContract: createReadContractStub(async request => {
					if (request.functionName === 'symbol') {
						await pause()
						return 'REP'
					}
					return 18
				}),
			},
			async () => {
				validationCount += 1
				if ((phase === 'validation' || phase === 'funding') && validationCount === 1) await pause()
				if (phase === 'after-confirmation' && validationCount === 2) await pause()
			},
		)
		let tray = createInitialTransactionTrayState()
		const canceled = mock(() => undefined)
		const failed = mock(() => undefined)
		const inlineError = mock((message: string | undefined) => message)
		try {
			if (phase === 'before-send') scope.abort()
			const sending = runWriteAction(
				{
					accountAddress: account,
					missingWalletMessage: 'Connect wallet',
					onTransactionRequested: () => {
						tray = markTransactionRequested(tray, { action: 'approve', source: 'statoblast', submittedTitle: 'Approving REP', submittedDetail: 'Approval submitted.' })
					},
					onTransactionCanceled: () => {
						tray = markTransactionCanceled(tray)
					},
					onTransactionFinished: () => {
						tray = markTransactionFinished(tray)
					},
					onTransactionFailed: message => {
						failed()
						tray = markTransactionFailed(tray, { kind: 'error', message })
					},
					onWriteCanceled: canceled,
					setErrorMessage: inlineError,
					refreshState: async () => undefined,
				},
				async () => {
					if (phase === 'metadata') return { hash: await reviewed.writeContract({ address: account, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [account, 1n] }) }
					if (phase === 'funding') {
						reviewed.onTransactionPlan?.([{ functionName: 'Transfer ETH', to: account, value: 1n }])
						await reviewed.runFundingTransaction?.([0], async () => {
							await reviewed.sendTransaction({ to: account, value: 1n })
						})
						return undefined
					}
					return { hash: await reviewed.sendTransaction({ to: account, value: 1n }) }
				},
				'Failed to send transaction',
			)
			if (phase === 'after-confirmation') {
				await waitForStarted()
			}
			if (phase !== 'before-send') {
				await reached.promise
				scope.abort()
				resume.resolve()
			}
			await sending
			expect(canceled).toHaveBeenCalledTimes(1)
			expect(failed).not.toHaveBeenCalled()
			expect(inlineError.mock.calls).toEqual(phase === 'before-send' ? [] : [[undefined]])
			expect(sendTransaction).not.toHaveBeenCalled()
			expect(transactionSteps.value).toBeUndefined()
			expect(tray.active).toBeUndefined()
			expect(tray.entries).toEqual([])
			expect(tray.entries.length).toBe(0)
		} finally {
			resume.resolve()
			scope.abort()
			unregister()
			restore()
		}
	})
}

for (const ownership of ['closed', 'open', 'standalone'] as const) {
	test(`keeps ${ownership} action ownership when another modal opens before client creation`, async () => {
		const { client, sendTransaction, receipt } = setup()
		const backend = withTransactionReviews({ ...createFakeBackend({ accountAddress: account }), createWriteClient: () => ({ ...client, sendTransaction, waitForTransactionReceipt: async () => receipt }) })
		const restore = installActiveEnvironmentForTesting(backend)
		const owner = new AbortController()
		const other = new AbortController()
		const unregisterOwner = ownership === 'standalone' ? () => undefined : registerTransactionReviewScope(owner.signal)
		let unregisterOther = () => undefined
		const reached = createDeferred<void>()
		const resume = createDeferred<void>()
		const canceled = mock(() => undefined)
		const failed = mock(() => undefined)
		try {
			const sending = runWriteAction(
				{
					accountAddress: account,
					missingWalletMessage: 'Connect wallet',
					onTransactionRequested: () => undefined,
					onTransactionFinished: () => undefined,
					onWriteCanceled: canceled,
					onTransactionFailed: failed,
					setErrorMessage: () => undefined,
					refreshState: async () => undefined,
				},
				async (walletAddress, context) => {
					reached.resolve()
					await resume.promise
					const reviewed = backend.createWriteClient(walletAddress, { reviewSignal: context.reviewSignal })
					const submittedHash = await reviewed.sendTransaction({ to: account, value: 1n })
					await reviewed.waitForTransactionReceipt({ hash: submittedHash })
					return { hash: submittedHash }
				},
				'Failed to send transaction',
			)
			await reached.promise
			if (ownership === 'closed') {
				owner.abort()
				unregisterOwner()
			}
			unregisterOther = registerTransactionReviewScope(other.signal)
			resume.resolve()
			if (ownership !== 'closed') {
				await waitForStarted()
				expect(transactionSteps.value?.reviewSignal).not.toBe(other.signal)
				if (ownership === 'open') expect(transactionSteps.value?.reviewSignal).toBe(owner.signal)
				other.abort()
			}
			await sending
			expect(sendTransaction).toHaveBeenCalledTimes(ownership === 'closed' ? 0 : 1)
			expect(canceled).toHaveBeenCalledTimes(ownership === 'closed' ? 1 : 0)
			expect(failed).not.toHaveBeenCalled()
			if (ownership === 'closed') expect(transactionSteps.value).toBeUndefined()
			else expect(transactionSteps.value?.steps[0]?.phase).toBe('confirmed')
		} finally {
			resume.resolve()
			owner.abort()
			other.abort()
			unregisterOwner()
			unregisterOther()
			restore()
		}
	})
}

test.each([2n, 3n])('refreshes allowance and sends only required coordinator approvals: %s', async initialAllowance => {
	const { client, receipt } = setup()
	let allowance = initialAllowance
	let allowanceReads = 0
	const reads = createCoordinatorFundingReads(token => {
		if (token !== account) return 1000n
		allowanceReads += 1
		return allowance
	})
	const sendTransaction = mock(async () => {
		allowance = 4n
		return hash
	})
	const prepare = () => requestOraclePrice(createReviewedClient({ ...client, ...reads, getGasPrice: async () => 1n, estimateGas: async () => 100000n, getBalance: async () => 1000n, sendTransaction, waitForTransactionReceipt: async () => ({ ...receipt, transactionHash: hash }) }), account, 10n ** 18n, 0n, 122n)
	const first = prepare()
	if (initialAllowance < 3n) await clickTransactionStep(1)
	await clickTransactionStep(2)
	await first
	expect(sendTransaction).toHaveBeenCalledTimes(initialAllowance < 3n ? 2 : 1)
	const previousReads = allowanceReads
	transactionSteps.value?.cancel()
	sendTransaction.mockClear()
	const second = prepare()
	await clickTransactionStep(2)
	await second
	expect(allowanceReads).toBeGreaterThan(previousReads)
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(transactionSteps.value?.steps.slice(0, 2).map(step => step.phase)).toEqual(['skipped', 'skipped'])
	expect(transactionSteps.value?.showReviewDialog).toBe(true)
})

test('broadcasts a prepared raw deployment transaction without app confirmation', async () => {
	const { client } = setup()
	const sendRawTransaction = mock(async () => hash)
	const reviewed = createReviewedClient({ ...client, sendRawTransaction })
	reviewed.onTransactionPrepared?.({ account, chainName: client.chain.name, functionName: 'Broadcast deterministic proxy deployer transaction', args: undefined, data: '0x1234', value: undefined })
	await reviewed.sendRawTransaction({ serializedTransaction: '0x1234' })
	expect(sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: '0x1234' })
	expect(transactionSteps.value?.showReviewDialog).toBe(false)
})

test('minting complete sets sends the transaction directly and tracks its receipt', async () => {
	const { client, receipt, sendTransaction } = setup()
	const reviewed = createReviewedClient({
		...client,
		sendTransaction,
		estimateGas: async () => 100000n,
		getBalance: async () => 10n ** 18n,
		getBlock: async () => createBlockWithTimestamp(1n),
		readContract: createReadContractStub(request => {
			if (request.functionName === 'escalationGame') return '0x0000000000000000000000000000000000000000'
			if (request.functionName === 'universeId') return 0n
			if (request.functionName === 'openOraclePriceCoordinator') return account
			if (request.functionName === 'lastSettlementTimestamp') return 1n
			if (request.functionName === 'getCurrentMintingCapacityAttoEth') return 10n ** 18n
			throw new Error(`Unexpected read: ${request.functionName}`)
		}),
		waitForTransactionReceipt: async () => ({ ...receipt, transactionHash: hash }),
	})
	expect(await createCompleteSetInSecurityPool(reviewed, account, 10n ** 18n)).toEqual({ action: 'createCompleteSet', hash, securityPoolAddress: account, universeId: 0n })
	expect(sendTransaction).toHaveBeenCalledTimes(1)
	expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ value: 10n ** 18n }))
	expect(transactionSteps.value?.showReviewDialog).toBe(false)
	expect(transactionSteps.value?.steps[0]?.phase).toBe('confirmed')
})

for (const change of ['fresh price', 'pending request', 'queue fee'] as const) {
	test(`blocks oracle ${change} after application review`, async () => {
		const { client, sendTransaction, receipt } = setup()
		const reads = createCoordinatorFundingReads(() => 1000n)
		let changed = false
		const scope = new AbortController()
		const unregister = registerTransactionPreparationScope(scope.signal)
		const reviewed = createReviewedClient(
			{
				...client,
				...reads,
				sendTransaction,
				readContract: createReadContractStub(request => {
					if (request.functionName === 'isPriceValid') return change === 'queue fee' ? !changed : changed && change === 'fresh price'
					if (request.functionName === 'pendingReportId') return changed && change === 'pending request' ? 1n : 0n
					if (request.functionName === 'lastSettlementTimestamp') return 1n
					if (request.functionName === 'lastPrice') return 10n ** 18n
					if (request.functionName === 'getPendingSettlementOperationIds') return []
					if (request.functionName === 'MAX_PENDING_SETTLEMENT_OPERATIONS') return 4n
					if (request.functionName === 'getQueuedOperationCostAttoEth') return 2n
					return reads.readContract(request)
				}),
				getGasPrice: async () => 1n,
				estimateGas: async () => 100000n,
				getBalance: async () => 1000n,
				waitForTransactionReceipt: async () => receipt,
			},
			undefined,
			scope.signal,
		)
		try {
			const action = (change === 'queue fee' ? queueOracleManagerOperation(reviewed, account, 'withdrawRep', account, 1n, 60n, 10n ** 18n) : requestOraclePrice(reviewed, account, 10n ** 18n, 0n, 122n)).catch(error => error)
			for (let attempt = 0; attempt < 100 && transactionSteps.value?.steps.at(-1)?.phase !== 'review'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 1))
			expect(transactionSteps.value?.steps.at(-1)?.phase).toBe('review')
			changed = true
			confirm()
			expect(await action).toBeInstanceOf(Error)
			expect(sendTransaction).not.toHaveBeenCalled()
		} finally {
			scope.abort()
			unregister()
		}
	})
}
