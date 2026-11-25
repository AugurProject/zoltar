import { exactUnit } from './format.ts'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

export const callTraceRows = (trace: unknown, nativeSymbol: string, depth = 0, ancestorReverted = false): readonly string[] => {
	if (!isPlainRecord(trace)) return []
	const reverted = ancestorReverted || typeof trace['error'] === 'string'
	const value = exactUnit(typeof trace['value'] === 'string' && /^0x[\da-f]+$/i.test(trace['value']) ? BigInt(trace['value']) : 0n, 18, nativeSymbol)
	const type = String(trace['type'] ?? 'CALL')
	const valueLabel = type.toUpperCase() === 'DELEGATECALL' || type.toUpperCase() === 'CALLCODE' ? `Call context: ${value} (no transfer)` : value
	const row = `${depth === 0 ? 'Transaction' : `Internal call (depth ${depth})`} · ${type} · ${String(trace['from'] ?? 'Unknown')} → ${String(trace['to'] ?? 'Creation')} · ${valueLabel}${reverted ? ` · Reverted: ${String(trace['error'] ?? 'ancestor reverted')} (value not transferred)` : ''}`
	return [row, ...(Array.isArray(trace['calls']) ? trace['calls'].flatMap(call => callTraceRows(call, nativeSymbol, depth + 1, reverted)) : [])]
}
