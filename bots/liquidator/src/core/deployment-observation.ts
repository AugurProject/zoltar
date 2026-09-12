import { recordActivity, type RuntimeState } from '../state/operator-state.ts'
import type { SystemDeploymentStatus } from './deployment-gate.ts'

export function recordSystemDeploymentCheck(state: RuntimeState, status: SystemDeploymentStatus, previousAddress: string | undefined) {
	if (status.deployed) {
		state.deploymentMissingName = undefined
		state.deploymentCheckedBlock = undefined
		state.deploymentCheckedTimestamp = undefined
		return undefined
	}
	state.error = undefined
	state.deploymentMissingName = status.name
	state.deploymentCheckedBlock = status.block.number
	state.deploymentCheckedTimestamp = status.block.timestamp
	state.status = state.paused ? 'paused' : 'starting'
	if (previousAddress !== status.address) recordActivity(state, { details: `chain=${state.chainId.toString()} block=${status.block.number.toString()} contract=${status.address}`, kind: 'deployment', message: `${status.name} is not deployed; waiting before checking again`, status: 'info' })
	return status.address
}
