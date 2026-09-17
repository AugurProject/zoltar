import { compact, record, stringField } from './public-fields.ts'

export function publicActivity(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		at: stringField(source, 'at'),
		details: stringField(source, 'details'),
		ecosystem: stringField(source, 'ecosystem'),
		label: stringField(source, 'label') ?? stringField(source, 'message'),
		operationId: stringField(source, 'operationId'),
		status: stringField(source, 'status'),
		summary: stringField(source, 'summary'),
		txHash: stringField(source, 'txHash') ?? stringField(source, 'hash'),
	})
}
