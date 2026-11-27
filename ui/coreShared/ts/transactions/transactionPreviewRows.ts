import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import { formatCurrencyBalanceWithUnit } from '../lib/formatters.js'
import type { TransactionRequestPreview } from '../wallet/chainBackend.js'
import type { GlobalTransactionRow } from '../types/components.js'

/** Turns a camelCase contract action into a sentence-case title that keeps token symbols and product names. */
export function humanizeTransactionAction(action: string) {
	return action
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.replace(/^./, value => value.toUpperCase())
		.replaceAll(/\brep\b/gi, commonCopy.rep)
		.replaceAll(/\beth\b/gi, commonCopy.eth)
		.replaceAll(/\bweth\b/gi, commonCopy.weth)
		.replaceAll(/\bzoltar\b/gi, 'Zoltar')
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

export function getPreparedTransactionTechnicalRows(preview: TransactionRequestPreview): GlobalTransactionRow[] {
	return [
		...(preview.contractAddress === undefined ? [] : [{ label: transactionCopy.contract, value: formatRecipient(preview.contractLabel, preview.contractAddress) }]),
		...(preview.to === undefined ? [] : [{ label: transactionCopy.to, value: formatRecipient(preview.toLabel, preview.to) }]),
		{ label: transactionCopy.functionLabel, value: preview.functionName },
		...(preview.value === undefined || preview.value === 0n ? [] : [{ label: transactionCopy.ethValue, value: formatCurrencyBalanceWithUnit(preview.value, commonCopy.eth) }]),
		...(preview.args === undefined || preview.args.length === 0 ? [] : [{ label: transactionCopy.argumentListLabel, value: preview.args.map(argument => formatPreviewArgument(argument)).join(', ') }]),
	]
}
