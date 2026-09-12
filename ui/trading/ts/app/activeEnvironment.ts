import { initializeActiveEnvironment } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'

const tradingActiveEnvironmentDependencies = {
	appId: 'trading',
} satisfies NonNullable<Parameters<typeof initializeActiveEnvironment>[1]>

export function initializeTradingActiveEnvironment(location: Parameters<typeof initializeActiveEnvironment>[0] = window.location, options: Parameters<typeof initializeActiveEnvironment>[2] = {}) {
	return initializeActiveEnvironment(location, tradingActiveEnvironmentDependencies, options)
}
