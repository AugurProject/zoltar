import { keccak256, parseTransaction, type Account, type Chain, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { maximumFeePerGas, MAX_PRIORITY_FEE_PER_GAS } from '@zoltar/bot-shared/execution/transaction-submission'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import type { OperatorSettings } from '#config/settings'
import { saveDurableState, recordActivity, type PendingTransactionIntent, type RuntimeState } from '#state/operator-state'

const bump = (fee: bigint) => (fee * 1_125n + 999n) / 1_000n

/** Persist the original and its cancellation together before broadcasting either can win the nonce. */
export async function cancelDroppedIntent(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, state: RuntimeState, intent: PendingTransactionIntent, baseFeePerGas: bigint) {
	if (intent.cancellation === undefined) {
		const original = parseTransaction(intent.serializedTransaction)
		const priority = bump(original.maxPriorityFeePerGas ?? original.gasPrice ?? 0n)
		const tip = priority > MAX_PRIORITY_FEE_PER_GAS ? priority : MAX_PRIORITY_FEE_PER_GAS
		const oldMaximum = bump(original.maxFeePerGas ?? original.gasPrice ?? 0n)
		const currentMaximum = maximumFeePerGas(baseFeePerGas)
		const maximum = oldMaximum > currentMaximum ? oldMaximum : currentMaximum
		const fee = maximum > tip ? maximum : tip
		// Waiting preserves the nonce and journal without repeatedly pausing or
		// exceeding the operator's explicit transaction spend ceiling.
		if (fee * 21_000n > settings.strategy.maximumGasCostAttoEth) {
			const message = `Cancellation exceeds gas budget; waiting: ${intent.label}`
			if (state.activities[0]?.message !== message) {
				recordActivity(state, { kind: intent.kind, hash: intent.hash, status: 'info', message })
				await saveDurableState(settings.runtime.stateFile, state)
			}
			return
		}
		if (wallet.account.signTransaction === undefined) throw new Error('Recovery signer cannot sign cancellation')
		const serializedTransaction = await wallet.account.signTransaction({ chainId: settings.network.chainId, nonce: intent.nonce, gas: 21_000n, maxFeePerGas: fee, maxPriorityFeePerGas: tip, to: intent.sender, value: 0n, data: '0x' })
		const cancellation = { hash: keccak256(serializedTransaction), serializedTransaction }
		const nextIntent = { ...intent, cancellation }
		const pendingTransactions = state.pendingTransactions.map(candidate => (candidate.hash === intent.hash ? nextIntent : candidate))
		const next = { ...state, pendingTransactions, activities: [...state.activities] }
		recordActivity(next, { kind: intent.kind, hash: cancellation.hash, status: 'pending', message: `Cancelling dropped transaction: ${intent.label}` })
		await saveDurableState(settings.runtime.stateFile, next)
		state.activities = next.activities
		intent.cancellation = cancellation
	}
	// A cancellation has no portfolio calldata to disclose. Public propagation
	// prevents an expired private relay envelope from blocking nonce recovery.
	const cancellation = intent.cancellation
	if (cancellation === undefined) return
	const deliveries = await Promise.allSettled([...new Set([settings.connectivity.readRpcUrl, ...settings.connectivity.publicRpcUrls])].map(endpoint => sendRawTransactionToRpc(endpoint, cancellation.serializedTransaction)))
	if (deliveries.every(delivery => delivery.status === 'rejected')) {
		const message = `Cancellation delivery unavailable; retrying: ${intent.label}`
		if (state.activities[0]?.message !== message) {
			recordActivity(state, { kind: intent.kind, hash: cancellation.hash, status: 'info', message })
			await saveDurableState(settings.runtime.stateFile, state)
		}
	}
}
