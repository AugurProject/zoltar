import type { DurableState } from '../state/operator-state.ts'
import { canonicalDeployment, legacyDeploymentForProfile } from './canonical-deployment.ts'
import { executionProfileId } from './execution-profile.ts'
import type { OperatorSettings } from './settings.ts'

export function restoreDeploymentForDurableState(settings: OperatorSettings, state: Pick<DurableState, 'profileId'>, needsDeploymentPin = false): OperatorSettings {
	const previous = needsDeploymentPin ? legacyDeploymentForProfile(settings.network.chainId, state.profileId) : undefined
	return previous === undefined ? settings : { ...settings, deployment: previous }
}

export function assertDurableDeploymentFactory(settings: OperatorSettings, state: Pick<DurableState, 'profileId' | 'uniswapV3Factory'>, stateFile: string) {
	const factory = settings.deployment.uniswapV3Factory
	if (factory === undefined) throw new Error('Configured deployment is missing its Uniswap V3 factory')
	const previous = legacyDeploymentForProfile(settings.network.chainId, state.profileId)
	const canonical = canonicalDeployment(settings.network.chainId)
	const knownFactory = previous?.uniswapV3Factory ?? (executionProfileId({ deployment: canonical, network: settings.network }) === state.profileId ? canonical.uniswapV3Factory : undefined)
	const boundFactory = state.uniswapV3Factory ?? knownFactory
	if (boundFactory === undefined || boundFactory.toLowerCase() !== factory.toLowerCase()) throw new Error(`Durable state ${stateFile} belongs to a different Uniswap V3 factory`)
}
