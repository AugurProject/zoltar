import { type DeploymentSettings } from '#config/deployment-settings'
import { positionConsumesRisk } from '#core/safety-controls'
import { type PositionRecord } from '#state/position-store'

function deploymentIdentityChanged(current: DeploymentSettings, next: DeploymentSettings) {
	return current.openOracle.toLowerCase() !== next.openOracle.toLowerCase() || current.executor?.toLowerCase() !== next.executor?.toLowerCase() || current.rep.toLowerCase() !== next.rep.toLowerCase() || current.weth.toLowerCase() !== next.weth.toLowerCase()
}

export function deploymentUpdateMustWait(current: DeploymentSettings, next: DeploymentSettings, positions: readonly Pick<PositionRecord, 'status'>[]) {
	return deploymentIdentityChanged(current, next) && positions.some(position => positionConsumesRisk(position.status))
}

export function requireSafeDeploymentTransition(state: { positions: readonly Pick<PositionRecord, 'status'>[] }, current: DeploymentSettings, next: DeploymentSettings) {
	if (deploymentUpdateMustWait(current, next, state.positions)) {
		throw new Error('OpenOracle, executor, REP, and WETH deployment identities cannot change while a position still consumes risk')
	}
}
