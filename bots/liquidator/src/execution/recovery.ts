import { createPublicClient, parseTransaction, type Account, type Chain, type Hex, type Transport, type WalletClient, createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { observeReceiptWithQuorum } from '@zoltar/bot-shared/execution/receipt-quorum'
import type { OperatorSettings } from '#config/settings'
import { PRIVATE_INTENT_FINALITY_BLOCKS } from '#core/cycle-control'
import { initialRuntimeState, assertIntentSender, saveDurableState } from '#state/operator-state'
import { resolveFinalizedReceipt } from '#execution/receipt-transition'

function recoveryReaders(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, pool: ReturnType<typeof createRpcEndpointPool>) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	return {
		clients: endpoints.map(endpoint => ({
			client: createPublicClient({
				chain: wallet.chain,
				transport: pool.transportFor(endpoint),
			}),
			endpoint,
		})),
		endpoints,
	}
}

export async function finalizedReceiptWithQuorum(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, hash: Hex, pool = createRpcEndpointPool([settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls])) {
	const readers = recoveryReaders(settings, wallet, pool)
	const receipt = await observeReceiptWithQuorum(readers.clients, hash, settings.connectivity.rpcQuorum)
	if (receipt === undefined) return { observed: false as const, receipt: undefined }
	if (
		!(await confirmCanonicalReceiptFinality(
			readers.clients.map(reader => reader.client),
			readers.endpoints,
			`transaction ${hash}`,
			receipt,
			PRIVATE_INTENT_FINALITY_BLOCKS,
			undefined,
			settings.connectivity.rpcQuorum,
		))
	)
		return { observed: true as const, receipt: undefined }
	return { observed: true as const, receipt }
}

export async function recoverPendingTransactions(
	settings: OperatorSettings,
	wallet: WalletClient<Transport, Chain, Account>,
	state: ReturnType<typeof initialRuntimeState>,
	pool = createRpcEndpointPool([settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]),
	isStopping: () => boolean = () => false,
) {
	for (const intent of [...state.pendingTransactions]) {
		if (isStopping()) return true
		assertIntentSender(intent.sender, wallet.account.address)
		if (parseTransaction(intent.serializedTransaction).chainId !== BigInt(settings.network.chainId)) {
			throw new Error(`Pending transaction ${intent.hash} was signed for a different chain`)
		}
		const { clients } = recoveryReaders(settings, wallet, pool)
		const receiptResult = await finalizedReceiptWithQuorum(settings, wallet, intent.hash, pool)
		const receipt = receiptResult.receipt
		if (receipt !== undefined) {
			await resolveFinalizedReceipt(settings.runtime.stateFile, state, intent, receipt)
			continue
		}
		if (receiptResult.observed) return true
		const requireReconciliation = async (reason: string): Promise<never> => {
			intent.reconciliationReason = `${reason}; inspect the transaction and reconcile its receipt or replace signer nonce ${intent.nonce.toString()} before resuming`
			await saveDurableState(settings.runtime.stateFile, state)
			throw new Error(`Transaction ${intent.hash}: ${intent.reconciliationReason}`)
		}
		const nonce = await settledQuorumValue(
			`canonical signer nonce for ${intent.hash}`,
			clients.map(async ({ client, endpoint }) => ({
				endpoint,
				value: await client.getTransactionCount({
					address: intent.sender,
					blockTag: 'latest',
				}),
			})),
			settings.connectivity.rpcQuorum,
		)
		if (nonce > intent.nonce) {
			await requireReconciliation('The signer nonce was consumed without a receipt for this transaction; manual reconciliation is required')
		}
		// Portfolio takeovers and earnings claims both require fresh profitability
		// checks. A relay expiry cannot invalidate a signed transaction or free its nonce.
		await requireReconciliation('Fresh portfolio and market evidence is required; automatic replay is disabled')
	}
	return false
}
