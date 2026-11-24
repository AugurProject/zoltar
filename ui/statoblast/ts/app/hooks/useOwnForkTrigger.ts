import * as copy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { getAddress, isAddress, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { buildWriteActionConfig, runWriteAction, type WriteActionContext } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { approveOwnForkAdmission, forkWithOwnEscalationGame, loadOwnForkAdmission, type OwnForkAdmission } from '@zoltar/ui-statoblast-shared/protocol/reporting.js'
import type { ForkAdmissionApproval } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import type { WriteOperationsParameters } from '@zoltar/ui-statoblast-shared/types/app.js'

type WalletCallbacks = Parameters<typeof createWalletWriteClient>[1]

export type UseOwnForkTriggerDependencies = {
	approveOwnForkAdmission: (accountAddress: Address, callbacks: WalletCallbacks, questionLedgerAddress: Address, amountAttoRep: bigint) => Promise<Hash>
	forkWithOwnEscalationGame: (accountAddress: Address, callbacks: WalletCallbacks, questionLedgerAddress: Address) => Promise<Hash>
	loadOwnForkAdmission: (questionLedgerAddress: Address, accountAddress: Address | undefined) => Promise<OwnForkAdmission>
}

const defaultDependencies: UseOwnForkTriggerDependencies = {
	approveOwnForkAdmission: async (accountAddress, callbacks, questionLedgerAddress, amountAttoRep) => await approveOwnForkAdmission(createWalletWriteClient(accountAddress, callbacks), questionLedgerAddress, amountAttoRep),
	forkWithOwnEscalationGame: async (accountAddress, callbacks, questionLedgerAddress) => await forkWithOwnEscalationGame(createWalletWriteClient(accountAddress, callbacks), questionLedgerAddress),
	loadOwnForkAdmission: async (questionLedgerAddress, accountAddress) => await loadOwnForkAdmission(createConnectedReadClient(), questionLedgerAddress, accountAddress),
}

type UseOwnForkTriggerParameters = {
	/** True while the question can still trigger its own fork, so its admission approval applies. */
	active: boolean
	onForked: (hash: Hash) => Promise<void>
	parameters: WriteOperationsParameters
	question: { questionLedgerAddress: string; universeId: bigint } | undefined
	refreshKey: number
}

/**
 * Own-question fork: the admission approval and the fork are separate transactions on separate buttons.
 * The shortfall and allowance load as soon as the fork applies, and the fork stays blocked until the allowance covers it.
 */
export function useOwnForkTrigger({ active, onForked, parameters, question, refreshKey }: UseOwnForkTriggerParameters, dependencies: UseOwnForkTriggerDependencies = defaultDependencies) {
	const admission = useSignal<{ key: string; value: OwnForkAdmission } | undefined>(undefined)
	const admissionError = useSignal<string | undefined>(undefined)
	const admissionLoading = useSignal(false)
	const actionError = useSignal<{ key: string; message: string } | undefined>(undefined)
	const approvePending = useSignal(false)
	const forkPending = useSignal(false)
	const reloadCount = useSignal(0)
	const poolAddress = question !== undefined && isAddress(question.questionLedgerAddress) ? getAddress(question.questionLedgerAddress) : undefined
	const admissionKey = `${poolAddress ?? ''}:${parameters.accountAddress ?? ''}`
	const admissionKeyRef = useRef(admissionKey)
	admissionKeyRef.current = admissionKey
	useEffect(() => {
		actionError.value = undefined
	}, [admissionKey, actionError])
	const forkActionError = {
		get value() {
			return actionError.value?.key === admissionKey ? actionError.value.message : undefined
		},
		set value(message: string | undefined) {
			if (admissionKeyRef.current === admissionKey) actionError.value = message === undefined ? undefined : { key: admissionKey, message }
		},
	}
	useEffect(() => {
		if (!active || poolAddress === undefined) return
		let current = true
		admissionLoading.value = true
		admissionError.value = undefined
		void dependencies
			.loadOwnForkAdmission(poolAddress, parameters.accountAddress)
			.then(value => {
				if (current) admission.value = { key: admissionKey, value }
			})
			.catch((error: unknown) => {
				if (current) admissionError.value = getErrorMessage(error, 'Unable to load the fork admission REP.')
			})
			.finally(() => {
				if (current) admissionLoading.value = false
			})
		return () => {
			current = false
		}
	}, [active, admissionKey, refreshKey, reloadCount.value])
	const currentAdmission = admission.value?.key === admissionKey ? admission.value.value : undefined
	const loading = admissionLoading.value || (active && poolAddress !== undefined && currentAdmission === undefined && admissionError.value === undefined)
	const writeCallbacks = (context: WriteActionContext): WalletCallbacks => ({ reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
	const writeParameters = { ...parameters, onTransactionCanceled: parameters.onTransactionCanceled, onTransactionFailed: parameters.onTransactionFailed, onTransactionPrepared: parameters.onTransactionPrepared }
	const approve = async (amountAttoRep: bigint | undefined) => {
		if (approvePending.value || forkPending.value || question === undefined || poolAddress === undefined || amountAttoRep === undefined) return
		const { universeId } = question
		approvePending.value = true
		try {
			await runWriteAction(
				buildWriteActionConfig(writeParameters, forkActionError, commonCopy.formatConnectWalletBefore('approving fork admission REP'), { action: 'approveForkAdmission', source: 'Question reporting', submittedTitle: copy.approveForkAdmission, universeId }),
				async (account, context) => ({ hash: await dependencies.approveOwnForkAdmission(account, writeCallbacks(context), poolAddress, amountAttoRep) }),
				'Unable to approve fork admission REP.',
				result => {
					reloadCount.value += 1
					parameters.onTransactionPresented({ hash: result.hash, title: copy.forkAdmissionApproved, tone: 'success', showStatusDialog: false, universeId })
				},
			)
		} finally {
			approvePending.value = false
		}
	}
	const triggerFork = async () => {
		if (forkPending.value || approvePending.value || question === undefined || poolAddress === undefined) return
		const { universeId } = question
		forkPending.value = true
		try {
			await runWriteAction(
				buildWriteActionConfig(writeParameters, forkActionError, commonCopy.formatConnectWalletBefore('triggering a universe fork'), { action: 'forkQuestion', source: 'Question reporting', submittedTitle: copy.triggerUniverseFork, universeId }),
				// The protocol call rereads the shortfall and allowance before sending, since REP supply can grow after this view loaded.
				async (account, context) => ({ hash: await dependencies.forkWithOwnEscalationGame(account, writeCallbacks(context), poolAddress) }),
				'Unable to trigger the universe fork.',
				async result => {
					await onForked(result.hash)
				},
			)
		} finally {
			forkPending.value = false
			if (admissionKeyRef.current === admissionKey) reloadCount.value += 1
		}
	}
	const approvalRequired = currentAdmission !== undefined && currentAdmission.shortfallAttoRep > 0n && parameters.accountAddress !== undefined && (currentAdmission.allowanceAttoRep ?? 0n) < currentAdmission.shortfallAttoRep
	let triggerForkAvailability: ActionAvailability | undefined
	if (loading) triggerForkAvailability = { disabled: true, loading: true, reason: copy.checkingForkAdmission }
	else if (admissionError.value !== undefined) triggerForkAvailability = { disabled: true, reason: admissionError.value }
	else if (approvalRequired) triggerForkAvailability = { disabled: true, reason: copy.forkAdmissionApprovalRequired }
	const approval: ForkAdmissionApproval = {
		allowanceError: admissionError.value,
		approvedAmount: currentAdmission?.allowanceAttoRep,
		loading,
		onApprove: amountAttoRep => void approve(amountAttoRep),
		pending: approvePending.value,
		recommendedAmount: currentAdmission?.recommendedApprovalAttoRep,
		requiredAmount: currentAdmission?.shortfallAttoRep,
	}
	return { approval, error: forkActionError.value, forkPending: forkPending.value, triggerFork, triggerForkAvailability }
}
