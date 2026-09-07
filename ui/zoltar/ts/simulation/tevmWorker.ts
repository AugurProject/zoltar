/// <reference lib="webworker" />

import { getDeploymentSteps } from '@zoltar/ui-zoltar-domain/protocol/deployment.js'
import { getZoltarAddress } from '@zoltar/ui-zoltar-domain/protocol/zoltarDeploymentHelpers.js'
import type { SimulationEngineDependencies } from '@zoltar/ui-core-shared/simulation/tevmEngine.js'
import { applyZoltarScenario } from './zoltarScenarios.js'

const dependencies: SimulationEngineDependencies = {
	applyScenario: applyZoltarScenario,
	getDeploymentSteps,
	getZoltarAddress,
}

globalThis.zoltarSimulationEngineDependencies = dependencies

import '@zoltar/ui-core-shared/simulation/tevmWorker.js'
