/// <reference lib="webworker" />

import { getDeploymentSteps } from '../protocol/deployment.js'
import { getZoltarAddress } from '../protocol/zoltarDeploymentHelpers.js'
import type { SimulationEngineDependencies } from '@zoltar/ui-core-shared/simulation/tevmEngine.js'
import { applyZoltarScenario } from './zoltarScenarios.js'

const dependencies: SimulationEngineDependencies = {
	applyScenario: applyZoltarScenario,
	getDeploymentSteps,
	getZoltarAddress,
}

globalThis.zoltarSimulationEngineDependencies = dependencies

import '@zoltar/ui-core-shared/simulation/tevmWorker.js'
