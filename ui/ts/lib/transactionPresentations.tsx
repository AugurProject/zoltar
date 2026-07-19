import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import type { ComponentChildren } from 'preact'
import type { Account, Hash } from '@zoltar/shared/ethereum'
import { formatCurrencyBalance } from './formatters.js'
import type { TransactionRequestPreview } from './chainBackend.js'
import type { GlobalTransactionPresentation, GlobalTransactionRow, TransactionIntent } from '../types/components.js'

export function buildPresentation({ detail, hash, rows, title, tone }: { detail?: GlobalTransactionPresentation['detail']; hash: Hash; rows?: GlobalTransactionRow[]; title: GlobalTransactionPresentation['title']; tone: GlobalTransactionPresentation['tone'] }): GlobalTransactionPresentation {
	return {
		dismissKey: hash,
		hash,
		...(detail === undefined ? {} : { detail }),
		...(rows === undefined ? {} : { rows }),
		title,
		tone,
	}
}

function buildHashlessPresentation({ detail, dismissKey, rows, title, tone }: { detail: ComponentChildren; dismissKey: string; rows?: GlobalTransactionRow[]; title: GlobalTransactionPresentation['title']; tone: GlobalTransactionPresentation['tone'] }): GlobalTransactionPresentation {
	return {
		detail,
		dismissKey,
		title,
		tone,
		...(rows === undefined ? {} : { rows }),
	}
}

export function buildIntent({ action, rows, source, submittedDetail, submittedTitle }: { action: string; rows?: GlobalTransactionRow[]; source: string; submittedDetail?: TransactionIntent['submittedDetail']; submittedTitle: TransactionIntent['submittedTitle'] }): TransactionIntent {
	return {
		action,
		...(rows === undefined ? {} : { rows }),
		source,
		...(submittedDetail === undefined ? {} : { submittedDetail }),
		submittedTitle,
	}
}

export function withWarning(base: GlobalTransactionPresentation, detail: string): GlobalTransactionPresentation {
	return {
		...base,
		detail,
		tone: 'warning',
	}
}

function getPreviewAccountAddress(account: Account | string | undefined) {
	if (account === undefined) return undefined
	return typeof account === 'string' ? account : account.address
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

function formatPreviewData(data: string) {
	const byteLength = Math.max(0, (data.length - 2) / 2)
	if (data.length <= 74) return data
	return transactionCopy.formatValueTruncatedValueBytes(data.slice(0, 66), byteLength.toString())
}

function getPreparedTransactionRows(intent: TransactionIntent, preview: TransactionRequestPreview): GlobalTransactionRow[] {
	const senderAddress = getPreviewAccountAddress(preview.account)
	return [
		...(intent.rows ?? []),
		...(senderAddress === undefined ? [] : [{ label: transactionCopy.sender, value: senderAddress }]),
		...(preview.chainName === undefined ? [] : [{ label: transactionCopy.chain, value: preview.chainName }]),
		...(preview.contractAddress === undefined ? [] : [{ label: transactionCopy.contract, value: preview.contractAddress }]),
		...(preview.to === undefined ? [] : [{ label: transactionCopy.to, value: preview.to }]),
		{ label: transactionCopy.functionLabel, value: preview.functionName },
		...(preview.value === undefined || preview.value === 0n ? [] : [{ label: transactionCopy.ethValue, value: `${formatCurrencyBalance(preview.value)} ${commonCopy.eth}` }]),
		...(preview.data === undefined ? [] : [{ label: preview.dataLabel ?? transactionCopy.calldata, value: formatPreviewData(preview.data) }]),
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
		})

	return buildHashlessPresentation({
		detail: transactionCopy.walletConfirmationInstruction,
		dismissKey,
		title: intent.submittedTitle,
		tone: 'awaiting-wallet',
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
	})
}

export function createPreparedWalletPresentation(intent: TransactionIntent, preview: TransactionRequestPreview, dismissKey: string): GlobalTransactionPresentation {
	const requiresWalletConfirmation = preview.requiresWalletConfirmation ?? intent.requiresWalletConfirmation ?? true
	return buildHashlessPresentation({
		detail: requiresWalletConfirmation ? transactionCopy.walletConfirmationReviewDetail : transactionCopy.simulationSubmissionReviewDetail,
		dismissKey,
		rows: getPreparedTransactionRows(intent, preview),
		title: intent.submittedTitle,
		tone: requiresWalletConfirmation ? 'awaiting-wallet' : 'preparing',
	})
}

export function createTransactionFailurePresentation(intent: TransactionIntent, message: string, dismissKey: string) {
	return buildHashlessPresentation({
		detail: message,
		dismissKey,
		title: intent.submittedTitle,
		tone: 'error',
		...(intent.rows === undefined ? {} : { rows: intent.rows }),
	})
}
