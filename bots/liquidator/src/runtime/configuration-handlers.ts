import { parseRootMarketSettings } from '#config/canonical-deployment'
import { parsePoolSelection, updateSupportedPool } from '#config/pool-selection'
import { parseDesiredPools, parseStrategy, serializedSettings } from '#config/settings'
import { switchSettingsNetworkProfile } from '#config/settings-store'
import { validateApprovedUniverseSelection } from '#core/fork-migration'
import { updateNetworkConnectivity } from '#core/network-connectivity'
import { chainFor } from '#monitoring/operator-chain'
import { clearMarketEvidenceForConfigurationChange, recordActivity } from '#state/operator-state'
import { parseCentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { endpointLabel } from '@zoltar/bot-shared/monitoring/connectivity'
import { parseApprovedUniverses } from '@zoltar/bot-shared/monitoring/universe-policy'
import { createPrimaryClient, createReadPool, persistSettings, requestProfileSwitch, signerWalletFor, type LiquidatorDeps, type LiquidatorRuntime } from './liquidator-runtime.ts'

/** Saves the other chain profile after preflighting it, pauses, and asks the operator loop to restart on it. */
export function switchNetworkProfile(runtime: LiquidatorRuntime, deps: LiquidatorDeps, value: unknown) {
	return deps.configurationMutationGate.run(async () => {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Chain profile request must be an object')
		const network = Reflect.get(value, 'network')
		if (network !== 'mainnet' && network !== 'sepolia') throw new Error('Chain profile must be mainnet or sepolia')
		if (network === runtime.settings.network.name) return serializedSettings(runtime.settings, true)
		const switched = await switchSettingsNetworkProfile(deps.settingsPath, network, new URL('../../config/operator.example.json', import.meta.url).pathname, deps.preflightNetworkProfile)
		deps.state.paused = true
		requestProfileSwitch(runtime)
		return serializedSettings(switched.settings, true)
	})
}

export function setApprovedUniverses(runtime: LiquidatorRuntime, deps: LiquidatorDeps, value: unknown) {
	return deps.configurationMutationGate.run(async () => {
		const { state } = deps
		const approvedUniverses = parseApprovedUniverses(value)
		validateApprovedUniverseSelection(state.universes, approvedUniverses)
		await persistSettings(runtime, deps, current => ({ ...current, approvedUniverses }))
		for (const universe of state.universes) universe.approved = approvedUniverses.includes(universe.id)
		for (const pool of state.pools) pool.approvedUniverse = approvedUniverses.includes(pool.universeId)
		recordActivity(state, {
			details: approvedUniverses.map(universe => universe.toString()).join(', '),
			kind: 'configuration',
			message: 'Truthful universe selection saved',
			status: 'info',
		})
		return serializedSettings(runtime.settings, true)
	})
}

export function setMarketConfiguration(runtime: LiquidatorRuntime, deps: LiquidatorDeps, value: unknown) {
	return deps.configurationMutationGate.run(async () => {
		const { state } = deps
		const settings = runtime.settings
		if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Market configuration must be an object')
		const rootValue = Reflect.get(value, 'root')
		const childrenValue = Reflect.get(value, 'children')
		const desiredPools = parseDesiredPools(
			Reflect.get(value, 'desiredPools') ??
				settings.desiredPools.map(pool => ({
					initialReportPriorityFeeAttoEthPerGas: pool.initialReportPriorityFeeAttoEthPerGas.toString(),
					questionId: pool.questionId.toString(),
					statoblastSecurityMultiplierBps: Number(pool.statoblastSecurityMultiplierBps),
					universeId: pool.universeId.toString(),
				})),
		)
		const centralizedMarkets = parseRootMarketSettings(rootValue ?? value, settings.network.chainId)
		if (childrenValue !== undefined && !Array.isArray(childrenValue)) throw new Error('Market configuration children must be an array')
		const childValues: readonly unknown[] = childrenValue ?? []
		const childMarketConfigurations = childValues.map(parseCentralizedMarketSettings)
		if (centralizedMarkets.assetChainId !== settings.network.chainId) throw new Error('Market consensus configuration targets another chain')
		if (childMarketConfigurations.some(configuration => configuration.assetChainId !== settings.network.chainId)) throw new Error('Child market configuration targets another chain')
		const configuredAssets = [centralizedMarkets, ...childMarketConfigurations].map(configuration => configuration.assetAddress.toLowerCase())
		if (new Set(configuredAssets).size !== configuredAssets.length) throw new Error('Market configurations must target distinct REP assets')
		const rootUniverse = state.universes.find(universe => universe.parentId === undefined)
		if (rootUniverse !== undefined && centralizedMarkets.assetAddress.toLowerCase() !== rootUniverse.repToken.toLowerCase()) throw new Error('Market consensus configuration targets another REP asset')
		const knownChildRep = new Set(state.universes.filter(universe => universe.parentId !== undefined).map(universe => universe.repToken.toLowerCase()))
		if (knownChildRep.size > 0 && childMarketConfigurations.some(configuration => !knownChildRep.has(configuration.assetAddress.toLowerCase()))) throw new Error('Child market configuration targets an unknown universe REP asset')
		await persistSettings(runtime, deps, current => ({ ...current, centralizedMarkets, childMarketConfigurations, desiredPools }))
		clearMarketEvidenceForConfigurationChange(state)
		recordActivity(state, {
			details: `${(centralizedMarkets.sources.length + childMarketConfigurations.reduce((total, configuration) => total + configuration.sources.length, 0)).toString()} CEX source(s) across ${(childMarketConfigurations.length + 1).toString()} REP asset(s)`,
			kind: 'configuration',
			message: 'Market consensus configuration saved',
			status: 'info',
		})
		return serializedSettings(runtime.settings, true)
	})
}

/** Saves chain and RPC settings, then rebuilds the chain, read pool, clients, and signer wallet on the new endpoints. */
export function setNetworkConnectivity(runtime: LiquidatorRuntime, deps: LiquidatorDeps, value: unknown) {
	return deps.configurationMutationGate.run(async () => {
		const next = await updateNetworkConnectivity({
			apply: applied => {
				runtime.chain = chainFor(applied)
				runtime.readPool = createReadPool(applied)
				runtime.poolMonitorIndexes = new Map()
				runtime.client = createPrimaryClient(runtime)
				runtime.wallet = runtime.activePrivateKey === undefined ? undefined : signerWalletFor(runtime.activePrivateKey, runtime.chain, runtime.readPool)
				clearMarketEvidenceForConfigurationChange(deps.state)
			},
			persist: update => persistSettings(runtime, deps, update),
			settings: runtime.settings,
			value,
		})
		recordActivity(deps.state, { details: `chain=${next.network.chainId.toString()} readRpc=${endpointLabel(next.connectivity.readRpcUrl)}`, kind: 'configuration', message: 'Chain and RPC configuration saved', status: 'info' })
		return serializedSettings(next, true)
	})
}

export function setSupportedPool(runtime: LiquidatorRuntime, deps: LiquidatorDeps, value: unknown) {
	return deps.configurationMutationGate.run(async () => {
		await persistSettings(runtime, deps, current => updateSupportedPool(current, value))
		recordActivity(deps.state, { kind: 'configuration', message: 'Supported pools updated', status: 'info' })
		return serializedSettings(runtime.settings, true)
	})
}

export function setSelectedPools(runtime: LiquidatorRuntime, deps: LiquidatorDeps, value: unknown) {
	return deps.configurationMutationGate.run(async () => {
		const selectedPools = parsePoolSelection(value)
		await persistSettings(runtime, deps, current => ({ ...current, selectedPools }))
		recordActivity(deps.state, {
			details: selectedPools.join(', '),
			kind: 'configuration',
			message: 'Pool selection saved',
			status: 'info',
		})
		return serializedSettings(runtime.settings, true)
	})
}

export function setStrategy(runtime: LiquidatorRuntime, deps: LiquidatorDeps, value: unknown) {
	return deps.configurationMutationGate.run(async () => {
		const strategy = parseStrategy(value)
		if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Strategy settings must be an object')
		const logLookbackBlocks = Number(Reflect.get(value, 'logLookbackBlocks'))
		const historicalLogRecovery = Reflect.get(value, 'historicalLogRecovery')
		if (!Number.isSafeInteger(logLookbackBlocks) || logLookbackBlocks < 1 || logLookbackBlocks > 256) throw new Error('Latest log blocks must be an integer from 1 through 256')
		if (typeof historicalLogRecovery !== 'boolean') throw new Error('Historical log recovery must be enabled or disabled explicitly')
		await persistSettings(runtime, deps, current => ({ ...current, runtime: { ...current.runtime, historicalLogRecovery, logLookbackBlocks }, strategy }))
		recordActivity(deps.state, {
			kind: 'configuration',
			message: 'Liquidation strategy saved',
			status: 'info',
		})
		return serializedSettings(runtime.settings, true)
	})
}
