import { loadOpenOracleReportDetails, settleOracleReport } from '../protocol/openOracle.js'
import { getDeploymentSteps } from '../protocol/deployment.js'

const defaultScenarioProtocol = { getDeploymentSteps, loadOpenOracleReportDetails, settleOracleReport }
type StatoblastScenarioProtocol = typeof defaultScenarioProtocol
let scenarioProtocolOverride: StatoblastScenarioProtocol | undefined

/** @internal */
export function installStatoblastScenarioProtocolForTesting(override: StatoblastScenarioProtocol | undefined) {
	scenarioProtocolOverride = override
}
export function getStatoblastScenarioProtocol(): StatoblastScenarioProtocol {
	return scenarioProtocolOverride ?? defaultScenarioProtocol
}
