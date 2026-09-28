import { publicFailureReason } from '../execution/preflight-failure.ts'
import { compact, record, stringField } from './public-fields.ts'

export function publicWorkflowStep(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		confirmedAt: stringField(source, 'confirmedAt'),
		failure: typeof source['failure'] === 'string' ? publicFailureReason(source['failure']) : undefined,
		label: stringField(source, 'label'),
		status: stringField(source, 'status'),
		txHash: stringField(source, 'txHash') ?? stringField(source, 'transactionHash') ?? stringField(source, 'hash'),
	})
}
