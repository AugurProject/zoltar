import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installFetchStub } from '@zoltar/ui-core-shared/tests/testUtils/fetchStub.js'
import { getGenesisNetworkProfile, MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import type { GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import { loadCoreDeployments } from '../../protocol/coreDeployments.js'

// Loads a core deployment registry through the public loader with a stubbed fetch and a non-simulation backend.
export async function loadCoreDeploymentsFrom(registry: unknown, outcome: GenesisOutcome = 'yes') {
	const restoreEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: getGenesisNetworkProfile(MAINNET_NETWORK_PROFILE, outcome) }))
	const restoreFetch = installFetchStub(async () => new Response(JSON.stringify(registry), { headers: { 'content-type': 'application/json' } }))
	try {
		return await loadCoreDeployments()
	} finally {
		restoreFetch()
		restoreEnvironment()
	}
}
