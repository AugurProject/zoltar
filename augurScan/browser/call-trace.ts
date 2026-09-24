import { isRecord } from './api-validation.ts'
import { exactUnit } from './format.ts'

export const callTraceRows = (trace: unknown, depth = 0, ancestorReverted = false): readonly string[] => {
	if (!isRecord(trace)) return []
	const reverted = ancestorReverted || typeof trace['error'] === 'string'
	const value = typeof trace['value'] === 'string' && /^0x[\da-f]+$/i.test(trace['value']) ? exactUnit(BigInt(trace['value']), 18, 'ETH') : '0 ETH'
	const row = `${depth === 0 ? 'Transaction' : `Internal call (depth ${depth})`} · ${String(trace['type'] ?? 'CALL')} · ${String(trace['from'] ?? 'Unknown')} → ${String(trace['to'] ?? 'Creation')} · ${value}${reverted ? ` · Reverted: ${String(trace['error'] ?? 'ancestor reverted')} (value not transferred)` : ''}`
	return [row, ...(Array.isArray(trace['calls']) ? trace['calls'].flatMap(call => callTraceRows(call, depth + 1, reverted)) : [])]
}
