import { parseSecurityPoolSelections } from './security-pool-policy.ts'
import type { OperatorSettings } from './settings.ts'

export function updateSupportedSecurityPool(settings: OperatorSettings, value: unknown) {
	if (typeof value !== 'object' || value === null) throw new Error('Security pool selection request must be an object')
	if (Reflect.get(value, 'chainId') !== settings.network.chainId) throw new Error('Security pool selection belongs to a different chain')
	const supported = Reflect.get(value, 'supported')
	if (typeof supported !== 'boolean') throw new Error('Security pool selection requires a supported flag')
	const selection = parseSecurityPoolSelections([{ address: Reflect.get(value, 'address'), universeId: Reflect.get(value, 'universeId') }])[0]
	if (selection === undefined) throw new Error('Security pool selection is missing')
	const remaining = settings.selectedSecurityPools.filter(item => item.address.toLowerCase() !== selection.address.toLowerCase() || item.universeId !== selection.universeId)
	const next = supported ? [...remaining, selection] : remaining
	if (next.length > 16) throw new Error('Select at most 16 security pool/universe scopes')
	return { ...settings, selectedSecurityPools: next }
}
