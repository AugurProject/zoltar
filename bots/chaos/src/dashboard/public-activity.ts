import { publicFailureReason } from '../execution/preflight-failure.ts'
import { compact, record, stringField } from './public-fields.ts'

export function publicActivity(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		at: stringField(source, 'at'),
		details: typeof source['details'] === 'string' ? publicFailureReason(source['details']) : undefined,
		ecosystem: stringField(source, 'ecosystem'),
		label: stringField(source, 'label') ?? stringField(source, 'message'),
		operationId: stringField(source, 'operationId'),
		status: stringField(source, 'status'),
		summary: typeof source['summary'] === 'string' ? publicFailureReason(source['summary']) : undefined,
		txHash: stringField(source, 'txHash') ?? stringField(source, 'hash'),
	})
}
