import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '../config/settings.ts'
import { carryProofDeploymentProfileId } from '../monitoring/carry-proof-scan.ts'
import type { Activity, DurableState } from './operator-state.ts'
import { isPristineBootstrapState } from './pristine.ts'

function obsoleteEmptyProfile(settings: OperatorSettings) {
	// Identify only the previously shipped zero-root bootstrap, never an operated deployment.
	return carryProofDeploymentProfileId({ ...settings, deployment: { openOracle: zeroAddress, questionData: zeroAddress, securityPoolFactory: zeroAddress, securityPoolForker: zeroAddress, tradingFactory: zeroAddress, tradingRouter: zeroAddress, weth: zeroAddress, zoltar: zeroAddress } })
}

function isMissingBootstrapDeployment(activity: Activity, chainId: number) {
	if (activity.type !== 'error' || activity.status !== 'failed' || activity.hash !== undefined || activity.operationId !== undefined) return false
	if (!activity.message.startsWith(`Operator cycle stopped safely: No contract code on RPC chain ${chainId.toString()} at block `)) return false
	const addresses = activity.message.match(/0x[0-9a-fA-F]{40}/g)
	return addresses !== null && addresses.length > 0 && addresses.every(address => address === zeroAddress)
}

export function migrateEmptyBootstrapState<T extends DurableState>(state: T, settings: OperatorSettings): T {
	if (state.chainId !== settings.network.chainId || state.profileId !== obsoleteEmptyProfile(settings)) return state
	if (!isPristineBootstrapState({ ...state, activities: [], signerAddress: undefined, safetyPaused: false })) return state
	const missingDeploymentErrors = state.activities.filter(activity => isMissingBootstrapDeployment(activity, state.chainId))
	const safeAudit = state.activities.every(activity => activity.hash === undefined && activity.operationId === undefined && (((activity.type === 'configuration' || activity.type === 'wallet') && activity.status === 'info') || (activity.type === 'error' && activity.status === 'failed')))
	if (!safeAudit) return state
	// Keep the signer and every audit entry. This only clears the obsolete absence
	// latch; the persisted pause and all current readiness checks still apply.
	const onlyAbsenceFailures = missingDeploymentErrors.length > 0 && state.activities.filter(activity => activity.type === 'error').length === missingDeploymentErrors.length
	return { ...state, profileId: carryProofDeploymentProfileId(settings), safetyPaused: state.safetyPaused && !onlyAbsenceFailures }
}
