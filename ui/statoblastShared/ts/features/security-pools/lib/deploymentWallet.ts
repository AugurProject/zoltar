import { TransactionLookupNotFoundError, type Address } from '@zoltar/core-shared/evm/ethereum'
import { isObjectRecord } from '@zoltar/core-shared/validation/guards'
import { MissingSecurityPoolDeploymentEventError } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { deployment as copy, openDeploymentPromptWarning, pendingDeploymentTransactionWarning } from '../../../copy/securityPoolTransactions.js'
import { DeploymentHistoryUnavailableError, readDeploymentRecoveryHead, readDeploymentTransaction, recoverQuestionRules, recoverSecurityPoolDeployment } from '../../../protocol/deploymentRecovery.js'
import { securityPoolAddressFromCreationReceipt, securityPoolCreationRequest } from '../../../protocol/securityPool.js'
import { parseDeploymentDraft } from './creation.js'
import type { DeploymentProgress, PendingDeployment } from './deploymentProgress.js'

export function isDefiniteDeploymentRejection(error: unknown) {
	const seen = new Set<object>()
	const containsRejection = (value: unknown): boolean => {
		if (!isObjectRecord(value) || seen.has(value)) return false
		seen.add(value)
		return value['code'] === 4001 || value['code'] === '4001' || containsRejection(value['cause']) || containsRejection(value['error']) || containsRejection(value['data']) || containsRejection(value['originalError'])
	}
	return containsRejection(error)
}

export async function supportsDeploymentNonce(client: Pick<ReadClient, 'getCode'>, address: Address) {
	const code = await client.getCode({ address })
	return code === undefined || code === '0x'
}

async function readDeploymentWalletState(client: ReadClient, address: Address) {
	const head = await readDeploymentRecoveryHead(client)
	if (head?.number === undefined || head.hash === undefined) return undefined
	const confirmed = await client.getTransactionCount({ address, blockNumber: head.number })
	const pending = await client.getTransactionCount({ address, blockTag: 'pending' })
	if ((await client.getBlock({ blockNumber: head.number }))?.hash !== head.hash) return undefined
	return { blockNumber: head.number, confirmed, idle: pending === confirmed }
}

type DeploymentRecovery = ({ kind: 'recovered'; rules?: Address | undefined; pool?: Address | undefined } | { kind: 'waiting'; detail: string } | { kind: 'restart'; detail: string; confirmationWarning: string } | { kind: 'rejected' }) & { transactionNonce?: string | undefined }

export async function readPendingDeploymentRecovery(client: ReadClient, wallet: Address, progress: DeploymentProgress & { pending: PendingDeployment }, profile: NetworkProfile, walletRejected: boolean): Promise<DeploymentRecovery> {
	const { pending } = progress
	const waiting = (detail: string) => ({ kind: 'waiting' as const, detail })
	const restart = (detail: string, confirmationWarning = openDeploymentPromptWarning) => ({ kind: 'restart' as const, detail, confirmationWarning })
	const restartPendingTransaction = () => restart(pendingDeploymentTransactionWarning, pendingDeploymentTransactionWarning)
	const receipt =
		pending.hash === undefined
			? undefined
			: await client.getTransactionReceipt({ hash: pending.hash }).catch((failure: unknown) => {
					if (failure instanceof TransactionLookupNotFoundError && failure.kind === 'receipt') return undefined
					throw failure
				})
	const deploymentConfirmed = receipt?.status === 'success' && pending.replacedWithoutDeployment !== true
	if (deploymentConfirmed) {
		if (pending.step === 'pool') {
			try {
				return { kind: 'recovered', pool: securityPoolAddressFromCreationReceipt(receipt) }
			} catch (error) {
				if (!(error instanceof MissingSecurityPoolDeploymentEventError)) throw error
				// An indirect submission may confirm without this pool's creation receipt.
			}
		} else if (receipt.contractAddress !== undefined && receipt.contractAddress !== null) return { kind: 'recovered', rules: receipt.contractAddress }
	}
	if (!(await supportsDeploymentNonce(client, wallet))) {
		if (receipt === undefined) {
			const transaction = pending.hash === undefined ? undefined : await readDeploymentTransaction(client, pending.hash)
			if (transaction !== undefined) return waiting(copy.walletTransactionPending)
			return pending.hash === undefined ? restart(copy.walletRecoveryUnsupported) : restartPendingTransaction()
		}
		const head = await readDeploymentRecoveryHead(client)
		if (head?.number === undefined || head.hash === undefined) return waiting(copy.receiptCheckFailed)
		if (receipt.blockNumber > head.number || (await client.getBlock({ blockNumber: receipt.blockNumber }))?.hash !== receipt.blockHash) return waiting(copy.receiptPending)
		return restart(deploymentConfirmed ? copy.missingDeploymentTransaction : copy.transactionDidNotDeploy)
	}

	const state = await readDeploymentWalletState(client, wallet)
	if (state === undefined) return waiting(copy.receiptCheckFailed)
	if (receipt !== undefined) {
		if (!state.idle) return waiting(copy.walletFinalityPending)
		if (receipt.blockNumber > state.blockNumber || (await client.getBlock({ blockNumber: receipt.blockNumber }))?.hash !== receipt.blockHash) return waiting(copy.receiptPending)
		return restart(deploymentConfirmed ? copy.missingDeploymentTransaction : copy.transactionDidNotDeploy)
	}

	const transaction = pending.hash === undefined ? undefined : await readDeploymentTransaction(client, pending.hash)
	const transactionNonce = transaction?.from.toLowerCase() === wallet.toLowerCase() ? transaction.nonce.toString() : undefined
	const nonceValue = transactionNonce ?? pending.nonce
	if (nonceValue === undefined) {
		if (!state.idle) return waiting(copy.walletFinalityPending)
		if (pending.hash === undefined) return restart(copy.walletNonceUnavailable)
		return transaction === undefined ? restartPendingTransaction() : waiting(copy.walletTransactionPending)
	}
	const nonce = BigInt(nonceValue)
	const estimatedNonce = transactionNonce === undefined && pending.nonceVerified !== true
	if (walletRejected && pending.hash === undefined && state.idle && state.confirmed <= nonce) return { kind: 'rejected' }
	if (state.confirmed <= nonce) {
		if (!state.idle) return { ...waiting(copy.walletFinalityPending), transactionNonce }
		if (pending.hash === undefined) return { ...waiting(copy.walletSendUncertain), transactionNonce }
		if (transaction === undefined) return { ...waiting(copy.droppedDeploymentTransaction(nonce, estimatedNonce)), transactionNonce }
		return { ...waiting(transactionNonce !== undefined && state.confirmed < nonce ? copy.transactionWaitingForEarlierNonce(nonce) : copy.receiptPending), transactionNonce }
	}

	const draft = parseDeploymentDraft(progress.draft, profile)
	if (draft.creationError !== undefined) throw new Error(draft.creationError)
	if (draft.origin === undefined) return waiting(copy.receiptCheckFailed)
	try {
		if (pending.step === 'rules') {
			const result = await recoverQuestionRules(client, wallet, nonce, progress.draft.admissionMode, draft.origin.universeId, draft.approvedQuestions, estimatedNonce)
			if (result?.rules !== undefined) return { kind: 'recovered', rules: result.rules }
			if (result === undefined) return { ...waiting(state.idle ? copy.receiptCheckFailed : copy.walletFinalityPending), transactionNonce }
			if (result.scanLimitReached && state.idle) return { ...(pending.hash === undefined ? restart(copy.rulesNonceScanLimit) : restartPendingTransaction()), transactionNonce }
		} else {
			if (progress.rules === undefined || draft.horizon === undefined || draft.economics === undefined) return waiting(copy.receiptCheckFailed)
			const request = securityPoolCreationRequest(wallet, draft.origin, draft.horizon, progress.rules, draft.economics)
			const initialFactoryCount = pending.initialFactoryCount === undefined ? undefined : BigInt(pending.initialFactoryCount)
			const result = await recoverSecurityPoolDeployment(client, wallet, nonce, request, initialFactoryCount)
			if (result?.pool !== undefined) return { kind: 'recovered', pool: result.pool }
			if (result === undefined) return { ...waiting(state.idle ? copy.receiptCheckFailed : copy.walletFinalityPending), transactionNonce }
		}
	} catch (error) {
		if (!(error instanceof DeploymentHistoryUnavailableError)) throw error
		if (!state.idle) return { ...waiting(copy.walletFinalityPending), transactionNonce }
		return { ...(pending.hash !== undefined && estimatedNonce ? waiting(copy.historyUnavailable) : restart(copy.historyUnavailable)), transactionNonce }
	}
	if (!state.idle) return { ...waiting(copy.walletFinalityPending), transactionNonce }
	return { ...(pending.hash !== undefined && estimatedNonce ? restartPendingTransaction() : restart(copy.restartAvailable)), transactionNonce }
}
