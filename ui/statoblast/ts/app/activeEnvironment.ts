import { initializeActiveEnvironment } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'

export const statoblastActiveEnvironmentDependencies = {
	appId: 'statoblast',
} satisfies NonNullable<Parameters<typeof initializeActiveEnvironment>[1]>

export function initializeStatoblastActiveEnvironment(location: Parameters<typeof initializeActiveEnvironment>[0] = window.location, options: Parameters<typeof initializeActiveEnvironment>[2] = {}) {
	return initializeActiveEnvironment(location, statoblastActiveEnvironmentDependencies, options)
}
