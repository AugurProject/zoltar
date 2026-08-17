import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import type { ComponentChildren } from 'preact'
import type { Hash } from '@zoltar/shared/ethereum'
import { formatCurrencyBalanceWithUnit } from './formatters.js'
import type { TransactionRequestPreview } from './chainBackend.js'
import type { GlobalTransactionPresentation, GlobalTransactionRow, TransactionIntent } from '../types/components.js'

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
	rows,
	source,
	submittedDetail,
	submittedTitle,
	universeId,
}: {
	action: string
	rows?: GlobalTransactionRow[] | undefined
	source: string
	submittedDetail?: TransactionIntent['submittedDetail']
	submittedTitle: TransactionIntent['submittedTitle']
	universeId?: bigint | undefined
}): TransactionIntent {
	return {
		action,
		...(rows === undefined ? {} : { rows }),
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

function formatPreviewArgument(value: unknown, seenObjects: Set<object> = new Set()): string {
	if (typeof value === 'bigint') return value.toString()
	if (value === undefined) return transactionCopy.undefinedValue
	if (value === null) return transactionCopy.nullValue
	if (typeof value === 'object') {
		if (seenObjects.has(value)) return transactionCopy.circularValue
		seenObjects.add(value)
		const formattedValue = Array.isArray(value)
			? `[${value.map(item => formatPreviewArgument(item, seenObjects)).join(', ')}]`
			: `{${Object.entries(value)
					.map(([key, entryValue]) => `${key}: ${formatPreviewArgument(entryValue, seenObjects)}`)
					.join(', ')}}`
		seenObjects.delete(value)
		return formattedValue
	}
	return String(value)
}

function formatRecipient(label: string | undefined, address: string) {
	return label === undefined ? address : `${label} (${address})`
}

function getPreparedTransactionTechnicalRows(preview: TransactionRequestPreview): GlobalTransactionRow[] {
	return [
		...(preview.contractAddress === undefined ? [] : [{ label: transactionCopy.contract, value: formatRecipient(preview.contractLabel, preview.contractAddress) }]),
		...(preview.to === undefined ? [] : [{ label: transactionCopy.to, value: formatRecipient(preview.toLabel, preview.to) }]),
		{ label: transactionCopy.functionLabel, value: preview.functionName },
		...(preview.value === undefined || preview.value === 0n ? [] : [{ label: transactionCopy.ethValue, value: formatCurrencyBalanceWithUnit(preview.value, commonCopy.eth) }]),
		...(preview.args === undefined || preview.args.length === 0 ? [] : [{ label: transactionCopy.argumentListLabel, value: preview.args.map(argument => formatPreviewArgument(argument)).join(', ') }]),
	]
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
		title: intent.submittedTitle,
		tone: 'error',
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
		...(intent.technicalRows === undefined ? {} : { technicalRows: intent.technicalRows }),
		...(intent.universeId === undefined ? {} : { universeId: intent.universeId }),
	})
}
