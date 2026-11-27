import * as transactionCopy from '../copy/transaction.js'
import type { ComponentChildren } from 'preact'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import type { TransactionRequestPreview } from '../wallet/chainBackend.js'
import type { GlobalTransactionPresentation, GlobalTransactionRow, TransactionIntent } from '../types/components.js'
import { AddressValue } from '../components/AddressValue.js'
import { getPreparedTransactionTechnicalRows } from './transactionPreviewRows.js'

export type PoolUniverseTransactionContext = {
	questionLedgerAddress?: string | undefined
	universeId?: bigint | undefined
}

export function getPoolUniverseTransactionRows(context: PoolUniverseTransactionContext | undefined): GlobalTransactionRow[] | undefined {
	if (context === undefined) return undefined
	return context.questionLedgerAddress === undefined || context.questionLedgerAddress.trim() === '' ? [] : [{ identityKey: 'security-pool', label: transactionCopy.questionLedger, value: <AddressValue address={context.questionLedgerAddress} /> }]
}

export function buildPresentation({
	detail,
	hash,
	rows,
	title,
	tone,
	universeId,
}: {
	detail?: GlobalTransactionPresentation['detail']
	hash: Hash
	rows?: GlobalTransactionRow[] | undefined
	title: GlobalTransactionPresentation['title']
	tone: GlobalTransactionPresentation['tone']
	universeId?: bigint | undefined
}): GlobalTransactionPresentation {
	return {
		dismissKey: hash,
		hash,
		...(detail === undefined ? {} : { detail }),
		...(rows === undefined ? {} : { rows }),
		title,
		tone,
		...(universeId === undefined ? {} : { universeId }),
	}
}

function buildHashlessPresentation({
	detail,
	dismissKey,
	rows,
	technicalRows,
	title,
	tone,
	universeId,
}: {
	detail: ComponentChildren
	dismissKey: string
	rows?: GlobalTransactionRow[]
	technicalRows?: GlobalTransactionRow[]
	title: GlobalTransactionPresentation['title']
	tone: GlobalTransactionPresentation['tone']
	universeId?: bigint | undefined
}): GlobalTransactionPresentation {
	return {
		detail,
		dismissKey,
		title,
		tone,
		...(rows === undefined ? {} : { rows }),
		...(technicalRows === undefined ? {} : { technicalRows }),
		...(universeId === undefined ? {} : { universeId }),
	}
}

export function buildIntent({
	action,
	failedTitle,
	rows,
	scope,
	source,
	submittedDetail,
	submittedTitle,
	universeId,
}: {
	action: string
	failedTitle?: TransactionIntent['failedTitle']
	rows?: GlobalTransactionRow[] | undefined
	scope?: TransactionIntent['scope']
	source: string
	submittedDetail?: TransactionIntent['submittedDetail']
	submittedTitle: TransactionIntent['submittedTitle']
	universeId?: bigint | undefined
}): TransactionIntent {
	return {
		action,
		...(failedTitle === undefined ? {} : { failedTitle }),
		...(rows === undefined ? {} : { rows }),
		...(scope === undefined || scope.length === 0 ? {} : { scope }),
		source,
		...(submittedDetail === undefined ? {} : { submittedDetail }),
		submittedTitle,
		...(universeId === undefined ? {} : { universeId }),
	}
}

export function withWarning(base: GlobalTransactionPresentation, detail: string): GlobalTransactionPresentation {
	return {
		...base,
		detail,
		tone: 'warning',
	}
}

export function createAwaitingWalletPresentation(intent: TransactionIntent, dismissKey: string) {
	if (intent.requiresWalletConfirmation === false)
		return buildHashlessPresentation({
			detail: transactionCopy.simulationSubmissionDetail,
			dismissKey,
			title: intent.submittedTitle,
			tone: 'preparing',
			...(intent.rows === undefined ? {} : { rows: intent.rows }),
			...(intent.universeId === undefined ? {} : { universeId: intent.universeId }),
		})

	return buildHashlessPresentation({
		detail: transactionCopy.walletConfirmationInstruction,
		dismissKey,
		title: intent.submittedTitle,
		tone: 'awaiting-wallet',
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
		...(intent.universeId === undefined ? {} : { universeId: intent.universeId }),
	})
}

export function createPreparedWalletPresentation(intent: TransactionIntent, preview: TransactionRequestPreview, dismissKey: string): GlobalTransactionPresentation {
	const requiresWalletConfirmation = preview.requiresWalletConfirmation ?? intent.requiresWalletConfirmation ?? true
	return buildHashlessPresentation({
		detail: requiresWalletConfirmation ? transactionCopy.walletConfirmationReviewDetail : transactionCopy.simulationSubmissionReviewDetail,
		dismissKey,
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
		technicalRows: getPreparedTransactionTechnicalRows(preview),
		title: intent.submittedTitle,
		tone: requiresWalletConfirmation ? 'awaiting-wallet' : 'preparing',
		...(intent.universeId === undefined ? {} : { universeId: intent.universeId }),
	})
}

export function createTransactionFailurePresentation(intent: TransactionIntent, message: string, dismissKey: string) {
	return buildHashlessPresentation({
		detail: message,
		dismissKey,
		title: intent.failedTitle ?? intent.submittedTitle,
		tone: 'error',
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
		...(intent.technicalRows === undefined ? {} : { technicalRows: intent.technicalRows }),
		...(intent.universeId === undefined ? {} : { universeId: intent.universeId }),
	})
}
