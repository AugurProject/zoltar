import { initializeActiveEnvironment } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'

export const tradingActiveEnvironmentDependencies = {
	appId: 'trading',
} satisfies NonNullable<Parameters<typeof initializeActiveEnvironment>[1]>

export async function initializeTradingActiveEnvironment(location: Parameters<typeof initializeActiveEnvironment>[0] = window.location, options: Parameters<typeof initializeActiveEnvironment>[2] = {}) {
	const backend = await initializeActiveEnvironment(location, tradingActiveEnvironmentDependencies, options)
	await backend.waitUntilReady?.()
	return backend
}
