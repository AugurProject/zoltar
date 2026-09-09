/// <reference lib="webworker" />

import { getDeploymentSteps } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'
import { getZoltarAddress } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import type { SimulationEngineDependencies } from '@zoltar/ui-core-shared/simulation/tevmEngine.js'
import { applyTradingScenario } from './tradingScenario.js'

const dependencies: SimulationEngineDependencies = {
	applyScenario: applyTradingScenario,
	getDeploymentSteps,
	getZoltarAddress,
}

globalThis.zoltarSimulationEngineDependencies = dependencies

import '@zoltar/ui-core-shared/simulation/tevmWorker.js'
