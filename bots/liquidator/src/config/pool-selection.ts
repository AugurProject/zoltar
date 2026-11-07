import { parsePortfolioSelections } from './portfolio-policy.ts'
import type { OperatorSettings } from './settings.ts'

export function updateSupportedPortfolio(settings: OperatorSettings, value: unknown) {
	if (typeof value !== 'object' || value === null) throw new Error('Portfolio selection request must be an object')
	if (Reflect.get(value, 'chainId') !== settings.network.chainId) throw new Error('Portfolio selection belongs to a different chain')
	const supported = Reflect.get(value, 'supported')
	if (typeof supported !== 'boolean') throw new Error('Portfolio selection requires a supported flag')
	const selection = parsePortfolioSelections([{ address: Reflect.get(value, 'address'), universeId: Reflect.get(value, 'universeId') }])[0]
	if (selection === undefined) throw new Error('Portfolio selection is missing')
	const remaining = settings.selectedPortfolios.filter(item => item.address.toLowerCase() !== selection.address.toLowerCase() || item.universeId !== selection.universeId)
	const next = supported ? [...remaining, selection] : remaining
	if (next.length > 16) throw new Error('Select at most 16 portfolio/universe scopes')
	return { ...settings, selectedPortfolios: next }
}
