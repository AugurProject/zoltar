import { serializedSettings } from '#config/settings'
import { marketConfigurations } from '#core/candidate-selection'
import { createGoLiveControls } from '#core/go-live-controls'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { loadPoolCatalog } from '#monitoring/pool-catalog'
import { operatorSnapshot } from '#state/operator-state'
import { setApprovedUniverses, setMarketConfiguration, setNetworkConnectivity, setSelectedPools, setStrategy, setSupportedPool, switchNetworkProfile } from './configuration-handlers.ts'
import { persistSettings, signerWalletFor, type LiquidatorDeps, type LiquidatorRuntime } from './liquidator-runtime.ts'
import { testMarketSources } from './market-source-test.ts'
import { reconcileTransaction } from './transaction-reconciliation-handler.ts'

function goLiveControlsFor(runtime: LiquidatorRuntime, deps: LiquidatorDeps) {
	return createGoLiveControls({
		activePrivateKey: () => runtime.activePrivateKey,
		applySigner: privateKey => {
			runtime.activePrivateKey = privateKey
			runtime.wallet = privateKey === undefined ? undefined : signerWalletFor(privateKey, runtime.chain, runtime.readPool)
			deps.state.wallet = runtime.wallet?.account.address
		},
		locks: deps.processLocks,
		persist: update => persistSettings(runtime, deps, update),
		runMutation: mutation => deps.configurationMutationGate.run(mutation),
		settings: () => runtime.settings,
		state: deps.state,
	})
}

/** Starts the operator dashboard when the settings enable it; every endpoint reads the runtime when it is called. */
export function startLiquidatorDashboard(runtime: LiquidatorRuntime, deps: LiquidatorDeps) {
	const { state } = deps
	const goLiveControls = goLiveControlsFor(runtime, deps)
	if (!runtime.settings.runtime.ui) return undefined
	return startDashboardServer(runtime.settings.runtime.uiPort, {
		getConfiguration: () => serializedSettings(runtime.settings, true),
		getPoolCatalog: (page, address, scope) => loadPoolCatalog(runtime.client, runtime.settings.deployment.securityPoolFactory, runtime.settings.network.chainId, page, address, scope === 'monitored' ? state.pools.map(pool => pool.address) : undefined, deps.poolDeploymentDates),
		getState: () => {
			state.rpcEndpointHealth = runtime.readPool.snapshot()
			return { ...operatorSnapshot(state, runtime.settings.runtime.execute, marketConfigurations(runtime.settings)), network: runtime.settings.network.name }
		},
		hostname: runtime.settings.runtime.uiHost,
		isNetworkConfigured: () => runtime.settings.networkConfigured,
		loopbackPublished: deps.dashboardEnvironment.loopbackPublished,
		password: deps.dashboardEnvironment.password,
		publicAuthority: deps.dashboardEnvironment.publicAuthority,
		switchNetworkProfile: value => switchNetworkProfile(runtime, deps, value),
		reconcileTransaction: value => reconcileTransaction(runtime, deps, value),
		testMarketSources: () => testMarketSources(runtime, deps),
		setApprovedUniverses: value => setApprovedUniverses(runtime, deps, value),
		setMarketConfiguration: value => setMarketConfiguration(runtime, deps, value),
		setNetworkConnectivity: value => setNetworkConnectivity(runtime, deps, value),
		setSupportedPool: value => setSupportedPool(runtime, deps, value),
		setSelectedPools: value => setSelectedPools(runtime, deps, value),
		...goLiveControls,
		setStrategy: value => setStrategy(runtime, deps, value),
	})
}
