import type { DurableState } from '../state/operator-state.ts'
import { assertSepoliaUniswapFactory, canonicalDeployment, legacyDeploymentForProfile } from './canonical-deployment.ts'
import { executionProfileId } from './execution-profile.ts'
import type { OperatorSettings } from './settings.ts'

export function assertSepoliaDurableFactory(chainId: number, state: Pick<DurableState, 'uniswapV3Factory'>) {
	if (state.uniswapV3Factory !== undefined) assertSepoliaUniswapFactory(chainId, state.uniswapV3Factory)
}

export function restoreDeploymentForDurableState(settings: OperatorSettings, state: Pick<DurableState, 'profileId' | 'uniswapV3Factory'>, needsDeploymentPin = false): OperatorSettings {
	assertSepoliaDurableFactory(settings.network.chainId, state)
	const previous = needsDeploymentPin ? legacyDeploymentForProfile(settings.network.chainId, state.profileId) : undefined
	const restored = previous === undefined ? settings : { ...settings, deployment: previous }
	if (restored.deployment.uniswapV3Factory !== undefined) assertSepoliaUniswapFactory(restored.network.chainId, restored.deployment.uniswapV3Factory)
	return restored
}

export function assertDurableDeploymentFactory(settings: OperatorSettings, state: Pick<DurableState, 'profileId' | 'uniswapV3Factory'>, stateFile: string) {
	const factory = settings.deployment.uniswapV3Factory
	if (factory === undefined) throw new Error('Configured deployment is missing its Uniswap V3 factory')
	assertSepoliaUniswapFactory(settings.network.chainId, factory)
	const previous = legacyDeploymentForProfile(settings.network.chainId, state.profileId)
	const canonical = canonicalDeployment(settings.network.chainId)
	const knownFactory = previous?.uniswapV3Factory ?? (executionProfileId({ deployment: canonical, network: settings.network }) === state.profileId ? canonical.uniswapV3Factory : undefined)
	const boundFactory = state.uniswapV3Factory ?? knownFactory
	if (boundFactory === undefined || boundFactory.toLowerCase() !== factory.toLowerCase()) throw new Error(`Durable state ${stateFile} belongs to a different Uniswap V3 factory`)
}
