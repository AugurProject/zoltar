import { publicChaosConfiguration, publicChaosState } from '../src/dashboard/dashboard-server.ts'

const configuration = publicChaosConfiguration({
	revision: 'runtime-smoke',
	settings: {
		network: { chainId: 11_155_111, name: 'sepolia' },
		paused: true,
		privateKey: null,
		runtime: { execute: false },
		scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
		strategy: { allowHighRiskOperations: true, allowIrreversibleOperations: false, enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'], minimumEthReserve: '0.05', minimumRepReserve: '10' },
	},
})
const state = publicChaosState({ inventory: { eth: '0', rep: [], weth: '0' }, paused: true, scheduler: { status: 'paused' } })

if (configuration['paused'] !== true || state['paused'] !== true) throw new Error('Chaos dashboard runtime smoke check failed')
