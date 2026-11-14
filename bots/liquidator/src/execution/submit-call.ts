import { estimateExecutionGas, PREFLIGHT_BALANCE } from './gas-estimate.ts'
import { simulateWithRevalidation } from './simulation.ts'
import { createPublicClient, createWalletClient, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { MAX_PRIORITY_FEE_PER_GAS, maximumFeePerGas, paddedTransactionGas, prepareSignedTransaction, submitSignedTransaction, transactionMaxBlockNumber } from '@zoltar/bot-shared/execution/transaction-submission'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { quorumPendingNonce, settledQuorumValue, sharedQuorumReadTargets } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { OperatorSettings } from '#config/settings'
import { recordActivity, saveDurableState, type PendingTransactionIntent, type RuntimeState } from '#state/operator-state'
import { resolveFinalizedReceipt } from '#execution/receipt-transition'
import { finalizedReceiptWithQuorum } from '#execution/recovery'
import { assertExecutionActive, assertGasCostLimitForBaseFee, assertOperatorNotStopping, requireFinalizedTransactionReceipt } from '#execution/execution-safety'

type WriteClient = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

type Call = {
	reportSponsorship?: PendingTransactionIntent['reportSponsorship']
	reportOperations?: PendingTransactionIntent['reportOperations']
	portfolioFunding?: PendingTransactionIntent['portfolioFunding']
	portfolioInstruction?: PendingTransactionIntent['portfolioInstruction']
	data: Hex
	gas: bigint | 'estimate'
	gasBudgetExceeded?: (() => never) | undefined
	label: string
	lastValidBlockNumber?: bigint | undefined
	preSubmit?: (() => Promise<unknown> | unknown) | undefined
	revalidateSimulationRevert?: (() => Promise<unknown>) | undefined
	receiptExpectation?: PendingTransactionIntent['receiptExpectation'] | undefined
	to: Address
	value?: bigint | undefined
}

function executionReadClients(wallet: WriteClient, settings: OperatorSettings, pool: RpcPool) {
	return [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(endpoint => ({ client: createWalletClient({ account: wallet.account, chain: wallet.chain, transport: pool.transportFor(endpoint) }), endpoint }))
}

export async function submitCall(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, call: Call, kind: PendingTransactionIntent['kind']) {
	assertExecutionActive(state)
	const account = wallet.account
	if (account.signTransaction === undefined || account.signMessage === undefined) {
		throw new Error('Execution signer cannot sign transactions')
	}
	const pinned = await sharedQuorumReadTargets(executionReadClients(wallet, settings, pool), settings.connectivity.rpcQuorum)
	const block = await settledQuorumValue(
		`${call.label} signing block`,
		pinned.readers.map(async ({ client, endpoint }) => {
			const candidate = await client.getBlock({ blockNumber: pinned.blockNumber })
			return { endpoint, value: { baseFeePerGas: candidate.baseFeePerGas, hash: candidate.hash, number: candidate.number } }
		}),
		settings.connectivity.rpcQuorum,
	)
	if (block.number === undefined || block.baseFeePerGas === undefined || block.hash === undefined) {
		throw new Error('Latest block is missing number, hash or base fee')
	}
	const validateCanonicalBlock = async () => {
		const canonicalHash = await settledQuorumValue(
			`${call.label} simulation block`,
			pinned.readers.map(async ({ client, endpoint }) => ({ endpoint, value: (await client.getBlock({ blockNumber: pinned.blockNumber })).hash })),
			settings.connectivity.rpcQuorum,
		)
		if (canonicalHash !== block.hash) throw new Error('Simulation block changed before portfolio revalidation')
	}
	const revalidateRevert =
		call.revalidateSimulationRevert === undefined
			? undefined
			: async () => {
					await validateCanonicalBlock()
					await call.revalidateSimulationRevert?.()
				}
	assertExecutionActive(state)
	// Match the EIP-1559 envelope used by prepareSignedTransaction so contracts
	// that reimburse tx.gasprice see the same effective fee during preflight.
	const fees = { maxFeePerGas: maximumFeePerGas(block.baseFeePerGas, transactionMaxBlockNumber(block.number, call.lastValidBlockNumber) - block.number), maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS }
	// Estimate before enforcing the configured spend ceiling. RPC affordability
	// must not turn an over-budget opportunity into an ambiguous contract revert.
	const gas = call.gas === 'estimate' ? await estimateExecutionGas(pinned.readers, { account, data: call.data, to: call.to, value: call.value, blockNumber: pinned.blockNumber, balanceOverride: PREFLIGHT_BALANCE, ...fees }, settings.connectivity.rpcQuorum, validateCanonicalBlock, revalidateRevert) : call.gas
	if (maximumFeePerGas(block.baseFeePerGas) * paddedTransactionGas(gas) > settings.strategy.maximumGasCostAttoEth) call.gasBudgetExceeded?.()
	assertGasCostLimitForBaseFee(gas, block.baseFeePerGas, settings.strategy.maximumGasCostAttoEth, call.label)
	await simulateWithRevalidation(
		`${call.label} simulation`,
		pinned.readers.map(async ({ client, endpoint }) => ({ endpoint, value: await client.call({ account, data: call.data, gas: call.gas === 'estimate' ? paddedTransactionGas(gas) : gas, to: call.to, value: call.value, blockNumber: pinned.blockNumber, ...fees }) })),
		settings.connectivity.rpcQuorum,
		revalidateRevert,
	)
	assertExecutionActive(state)
	recordActivity(state, {
		details: `to=${call.to} data=${call.data} value=${(call.value ?? 0n).toString()}`,
		kind,
		message: `Preparing: ${call.label}`,
		status: 'info',
	})
	await saveDurableState(settings.runtime.stateFile, state)
	const nonce = await agreedPendingNonce(wallet, settings, account.address, pool)
	assertExecutionActive(state)
	const signed = await prepareSignedTransaction({
		baseFeePerGas: block.baseFeePerGas,
		blockNumber: block.number,
		chainId: settings.network.chainId,
		data: call.data,
		from: account.address,
		gasEstimate: gas,
		lastValidBlockNumber: call.lastValidBlockNumber,
		nonce,
		signTransaction: account.signTransaction,
		to: call.to,
		value: call.value,
	})
	await call.preSubmit?.()
	state.pendingTransactions.push({
		reportSponsorship: call.reportSponsorship,
		reportOperations: call.reportOperations,
		portfolioFunding: call.portfolioFunding,
		portfolioInstruction: call.portfolioInstruction,
		hash: signed.hash,
		kind,
		label: call.label,
		lastValidBlockNumber: signed.lastValidBlockNumber,
		maxBlockNumber: signed.maxBlockNumber,
		mode: settings.submission.mode,
		nonce: signed.transaction.nonce,
		receiptExpectation: call.receiptExpectation ?? { type: 'transaction' },
		requiresMarketEvidence: call.preSubmit !== undefined,
		sender: account.address,
		serializedTransaction: signed.serializedTransaction,
		submissionBlock: block.number,
	})
	recordActivity(state, {
		hash: signed.hash,
		kind,
		message: `Signed intent persisted: ${call.label}`,
		status: 'pending',
	})
	await saveDurableState(settings.runtime.stateFile, state)
	try {
		assertExecutionActive(state)
		await call.preSubmit?.()
		assertExecutionActive(state)
	} catch (error) {
		state.pendingTransactions = state.pendingTransactions.filter(intent => intent.hash.toLowerCase() !== signed.hash.toLowerCase())
		recordActivity(state, {
			hash: signed.hash,
			kind,
			message: `Persisted intent abandoned after final market check: ${call.label}`,
			status: 'failed',
		})
		await saveDurableState(settings.runtime.stateFile, state)
		throw error
	}
	await submitSignedTransaction({
		address: account.address,
		hash: signed.hash,
		maxBlockNumber: signed.maxBlockNumber,
		publicRpcUrls: settings.connectivity.publicRpcUrls,
		publicSubmit: sendRawTransactionToRpc,
		serializedTransaction: signed.serializedTransaction,
		settings: settings.submission,
		signMessage: account.signMessage,
	})
	const hash: Hex = signed.hash
	const receiptDeadline = Date.now() + 180_000
	for (;;) {
		try {
			await wallet.waitForTransactionReceipt({
				hash,
				pollingInterval: Math.min(settings.runtime.pollMilliseconds, 5_000),
				timeout: Math.min(settings.runtime.pollMilliseconds, 5_000),
			})
			break
		} catch (error) {
			assertOperatorNotStopping(state)
			if (Date.now() >= receiptDeadline) throw error
		}
	}
	const receiptResult = await finalizedReceiptWithQuorum(settings, wallet, hash, pool)
	const receipt = requireFinalizedTransactionReceipt(call.label, hash, receiptResult)
	const intent = state.pendingTransactions.find(pending => pending.hash.toLowerCase() === hash.toLowerCase())
	if (intent === undefined) throw new Error('Submitted transaction is missing its pending intent')
	await resolveFinalizedReceipt(settings.runtime.stateFile, state, intent, receipt)
	return receipt.transactionHash
}

async function agreedPendingNonce(wallet: WriteClient, settings: OperatorSettings, address: Address, pool: RpcPool) {
	const readers = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(endpoint => ({ client: createPublicClient({ chain: wallet.chain, transport: pool.transportFor(endpoint) }), endpoint }))
	return quorumPendingNonce('pending signer nonce', readers, address, settings.connectivity.rpcQuorum)
}
