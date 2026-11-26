import { TransactionLookupNotFoundError, type Address } from '@zoltar/core-shared/evm/ethereum'
import { isObjectRecord } from '@zoltar/core-shared/validation/guards'
import { MissingSecurityPoolDeploymentEventError } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { deployment as copy } from '../../../copy/securityPoolTransactions.js'
import { DeploymentHistoryUnavailableError, readDeploymentNonce, readDeploymentRecoveryHead, recoverQuestionRules, recoverSecurityPoolDeployment } from '../../../protocol/deploymentRecovery.js'
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

type DeploymentRecovery = ({ kind: 'recovered'; rules?: Address | undefined; pool?: Address | undefined } | { kind: 'restart' | 'waiting'; detail: string } | { kind: 'rejected' }) & { transactionNonce?: string | undefined }

export async function readPendingDeploymentRecovery(client: ReadClient, wallet: Address, progress: DeploymentProgress & { pending: PendingDeployment }, profile: NetworkProfile, walletRejected: boolean): Promise<DeploymentRecovery> {
	const { pending } = progress
	const waiting = (detail: string) => ({ kind: 'waiting' as const, detail })
	const restart = (detail: string) => ({ kind: 'restart' as const, detail })
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
	if (!(await supportsDeploymentNonce(client, wallet))) return restart(copy.walletRecoveryUnsupported)

	const state = await readDeploymentWalletState(client, wallet)
	if (state === undefined) return waiting(copy.receiptCheckFailed)
	if (receipt !== undefined) {
		if (!state.idle) return waiting(copy.walletFinalityPending)
		if (receipt.blockNumber > state.blockNumber || (await client.getBlock({ blockNumber: receipt.blockNumber }))?.hash !== receipt.blockHash) return waiting(copy.receiptPending)
		return restart(deploymentConfirmed ? copy.missingDeploymentTransaction : copy.transactionDidNotDeploy)
	}

	const transactionNonce = pending.hash === undefined ? undefined : await readDeploymentNonce(client, wallet, pending.hash)
	const nonceValue = transactionNonce ?? (pending.hash === undefined || pending.nonceVerified === true ? pending.nonce : undefined)
	if (nonceValue === undefined) {
		if (!state.idle) return waiting(copy.walletFinalityPending)
		return restart(pending.hash === undefined ? copy.walletNonceUnavailable : copy.missingDeploymentTransaction)
	}
	const nonce = BigInt(nonceValue)
	if (walletRejected && pending.hash === undefined && state.idle && state.confirmed === nonce) return { kind: 'rejected' }
	if (state.confirmed <= nonce) {
		if (!state.idle) return { ...waiting(copy.walletFinalityPending), transactionNonce }
		if (pending.hash === undefined) return { ...waiting(copy.walletSendUncertain), transactionNonce }
		return { ...waiting(transactionNonce === undefined ? copy.droppedDeploymentTransaction(nonce) : copy.receiptPending), transactionNonce }
	}

	const draft = parseDeploymentDraft(progress.draft, profile)
	if (draft.creationError !== undefined) throw new Error(draft.creationError)
	if (draft.origin === undefined) return waiting(copy.receiptCheckFailed)
	try {
		if (pending.step === 'rules') {
			const result = await recoverQuestionRules(client, wallet, nonce, progress.draft.admissionMode, draft.origin.universeId, draft.approvedQuestions, pending.hash === undefined)
			if (result?.rules !== undefined) return { kind: 'recovered', rules: result.rules }
			if (result === undefined) return { ...waiting(state.idle ? copy.receiptCheckFailed : copy.walletFinalityPending), transactionNonce }
			if (result.scanLimitReached && state.idle) return { ...restart(copy.rulesNonceScanLimit), transactionNonce }
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
		return { ...(state.idle ? restart(copy.historyUnavailable) : waiting(copy.walletFinalityPending)), transactionNonce }
	}
	return { ...(state.idle ? restart(copy.restartAvailable) : waiting(copy.walletFinalityPending)), transactionNonce }
}
