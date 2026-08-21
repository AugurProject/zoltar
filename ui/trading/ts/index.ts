import { createElement } from 'preact'
import { createPublicClient, custom, getAddress } from '@zoltar/shared/ethereum'
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js'
import { App } from './app/App.js'
import { initializeTradingActiveEnvironment } from './app/activeEnvironment.js'
import { installTradingRouting } from './lib/routing.js'
import { registerTradingSimulationScenario, TRADING_SIMULATION_SCENARIO } from './simulation/index.js'
import type { TradingDeploymentSetupServices } from './features/TradingDeploymentSetup.js'
import { CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE, deploymentConfigurationForPlan, getTradingDeploymentPlan } from './protocol/deployment.js'

const qaDeploymentPending = ['127.0.0.1', 'localhost'].includes(window.location.hostname) && new URLSearchParams(window.location.search).get('qaDeployment') === 'pending'
const qaCore = {
	chainId: 1,
	chainName: 'Ethereum Mainnet',
	defaultRpcUrl: 'https://rpc.example',
	id: 'mainnet',
	proxyDeployer: getAddress('0x7A0D94F55792C434d74a40883C6ed8545E406D12'),
	securityPoolFactory: getAddress('0x5dae4d3F03A59a51F01e52920a76Cb4013D15c70'),
}

function pendingDeploymentFixture() {
	const client = createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_getCode' && Array.isArray(params)) {
					const address = params[0]
					if (typeof address === 'string' && address.toLowerCase() === qaCore.proxyDeployer.toLowerCase()) return CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE
					if (typeof address === 'string' && address.toLowerCase() === qaCore.securityPoolFactory.toLowerCase()) return '0x01'
					return '0x'
				}
				throw new Error(`Unexpected QA RPC method ${method}`)
			},
		}),
	})
	const services: TradingDeploymentSetupServices = {
		createPublicClient: () => client,
		connectWallet: async () => ({ account: getAddress('0x8ba1f109551bD432803012645Ac136ddd64DBA72'), chainId: qaCore.chainId }),
		deployStep: async (_publicClient, _plan, _step, onSubmitted) => {
			onSubmitted(`0x${'ab'.repeat(32)}`)
			await new Promise<void>(() => undefined)
		},
		loadCoreDeployments: async () => [qaCore],
	}
	const configuration = deploymentConfigurationForPlan(getTradingDeploymentPlan(qaCore, 30), 'http://127.0.0.1:8545/')
	return {
		deploymentSetupServices: services,
		loadLiveDeployment: async () => {
			await new Promise(resolve => setTimeout(resolve, 1_200))
			return configuration
		},
	}
}

document.querySelector('body > main')?.remove()
const root = document.querySelector('#app') ?? document.body
installTradingRouting()
registerTradingSimulationScenario()
if (new URLSearchParams(window.location.search).get('simulate') === '1' && !new URLSearchParams(window.location.search).has('simScenario')) {
	const url = new URL(window.location.href)
	url.searchParams.set('simScenario', TRADING_SIMULATION_SCENARIO)
	window.history.replaceState({}, '', url)
}
void mountApp({ initialize: initializeTradingActiveEnvironment, root: () => createElement(App, qaDeploymentPending ? pendingDeploymentFixture() : {}), target: root })
