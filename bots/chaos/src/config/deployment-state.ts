import type { DurableState } from '../state/operator-state.ts'
import { assertSepoliaUniswapFactory } from './canonical-deployment.ts'
import type { OperatorSettings } from './settings.ts'

export function assertSepoliaDurableFactory(chainId: number, state: Pick<DurableState, 'uniswapV3Factory'>) {
	if (state.uniswapV3Factory !== undefined) assertSepoliaUniswapFactory(chainId, state.uniswapV3Factory)
}

/** Rejects a Sepolia configuration or durable journal bound to anything but the published Uniswap V3 factory. */
export function assertDurableStateFactories(settings: OperatorSettings, state: Pick<DurableState, 'uniswapV3Factory'>) {
	assertSepoliaDurableFactory(settings.network.chainId, state)
	if (settings.deployment.uniswapV3Factory !== undefined) assertSepoliaUniswapFactory(settings.network.chainId, settings.deployment.uniswapV3Factory)
}

export function assertDurableDeploymentFactory(settings: OperatorSettings, state: Pick<DurableState, 'uniswapV3Factory'>, stateFile: string) {
	const factory = settings.deployment.uniswapV3Factory
	if (factory === undefined) throw new Error('Configured deployment is missing its Uniswap V3 factory')
	assertSepoliaUniswapFactory(settings.network.chainId, factory)
	if (state.uniswapV3Factory === undefined || state.uniswapV3Factory.toLowerCase() !== factory.toLowerCase()) throw new Error(`Durable state ${stateFile} belongs to a different Uniswap V3 factory`)
}
