import { createInjectedBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { createSimulationBackend } from '@zoltar/ui-core-shared/simulation/tevmBackend.js'
import { withTransactionReviews } from '@zoltar/ui-statoblast-shared/protocol/reviewedBackend.js'
import { initializeActiveEnvironment } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'

const statoblastActiveEnvironmentDependencies = {
	appId: 'statoblast',
	createInjectedBackend: options => withTransactionReviews(createInjectedBackend(options)),
	createSimulationBackend: async options => withTransactionReviews(await createSimulationBackend(options)),
} satisfies NonNullable<Parameters<typeof initializeActiveEnvironment>[1]>

export function initializeStatoblastActiveEnvironment(location: Parameters<typeof initializeActiveEnvironment>[0] = window.location, options: Parameters<typeof initializeActiveEnvironment>[2] = {}) {
	return initializeActiveEnvironment(location, statoblastActiveEnvironmentDependencies, options)
}
