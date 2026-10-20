/// <reference lib="webworker" />

import { getOpenOracleDeploymentSteps } from '../protocol/deployment.js'
import { getZoltarAddress } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import type { SimulationEngineDependencies } from '@zoltar/ui-core-shared/simulation/tevmEngine.js'
import { applyStatoblastScenario } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'

const dependencies: SimulationEngineDependencies = {
	applyScenario: applyStatoblastScenario,
	getDeploymentSteps: getOpenOracleDeploymentSteps,
	getZoltarAddress,
}

globalThis.zoltarSimulationEngineDependencies = dependencies

import '@zoltar/ui-core-shared/simulation/tevmWorker.js'
