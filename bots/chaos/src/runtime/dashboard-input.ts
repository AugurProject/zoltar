import type { Hex } from '@zoltar/bot-shared/ethereum'
import { configurationRevisionConflict } from '../config/settings.ts'

export function expectedRevision(value: unknown, current: string) {
	if (typeof value !== 'string' || value !== current) throw configurationRevisionConflict()
	return value
}

export function transactionHash(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
		throw new Error(`${label} must be a 32-byte transaction hash`)
	}
	return value as Hex
}

export function dashboardRecord(value: unknown, label: string) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be a JSON object`)
	return Object.fromEntries(Object.entries(value))
}

export function exactDashboardKeys(value: Record<string, unknown>, required: readonly string[], label: string) {
	const allowed = new Set(required)
	const missing = required.find(key => !(key in value))
	const unexpected = Object.keys(value).find(key => !allowed.has(key))
	if (missing !== undefined) throw new Error(`${label} is missing ${missing}`)
	if (unexpected !== undefined) throw new Error(`${label} contains unsupported field ${unexpected}`)
}
