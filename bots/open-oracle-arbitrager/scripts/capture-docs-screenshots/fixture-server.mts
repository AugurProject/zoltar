import { join } from 'node:path'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { protectedFailureMarker, wallet } from './fixture-constants.mts'
import { snapshot } from './fixture-snapshot.mts'
import { currentFixtureSnapshot, fixture } from './fixture-state.mts'

/** Serves the real dashboard on an ephemeral port, backed by the fixture scenario instead of a running bot. */
export function startFixtureServer() {
	return startDashboardServer(0, {
		getConfiguration: async () => {
			while (fixture.configurationHanging) await Bun.sleep(10)
			if (fixture.configurationUnavailable) throw new Error('fixture configuration endpoint unavailable')
			const configuration = await Bun.file(join(import.meta.dir, '..', '..', 'config', 'operator.example.json')).json()
			return {
				configuration: { ...configuration, connectivity: snapshot.connectivity, network: fixture.network, networkConfigured: true, rpcQuorum: 2 },
				revision: 'fixture-revision',
			}
		},
		getSnapshot: async () => {
			if (fixture.stateHanging) await new Promise<never>(() => {})
			if (fixture.stateUnavailable) throw new Error('fixture state endpoint unavailable')
			return currentFixtureSnapshot()
		},
		isNetworkConfigured: () => true,
		setPaused: async value => {
			fixture.pauseRequests.push(value)
			while (fixture.pauseHanging) await Bun.sleep(10)
			fixture.paused = value
		},
		switchNetworkProfile: async value => {
			if (typeof value !== 'object' || value === null || Reflect.get(value, 'network') !== 'sepolia') throw new Error('Expected Sepolia profile request')
			while (fixture.profileHanging) await Bun.sleep(10)
			return { network: 'sepolia' }
		},
		updateConnectivity: async () => {
			while (fixture.connectivityHanging) await Bun.sleep(10)
			if (fixture.connectivityFailure) throw new Error(`RPC https://operator:${protectedFailureMarker}@rpc.example returned credential-bearing provider text`)
			return { connectivity: snapshot.connectivity, network: 'mainnet' as const, rpcQuorum: 2 as const }
		},
		updateConfiguration: value => value,
		updateSigner: () => ({ wallet }),
		updateStrategy: () => snapshot.settings,
		updateSubmission: () => snapshot.submission,
		updateTokens: () => snapshot.tokenAddresses,
	})
}
