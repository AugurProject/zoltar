import { ExecutionSignerLockHeldError, signerLockConflictMessage } from '@zoltar/bot-shared/execution/process-lock'
import { logDashboardFailure } from '@zoltar/bot-shared/dashboard/public-error'
import { publicConnectivityError } from '@zoltar/bot-shared/dashboard/connectivity-error'
import { dashboardJson as json } from '@zoltar/bot-shared/dashboard/security'
import { CONFIGURATION_REVISION_CONFLICT } from '@zoltar/bot-shared/config/durable-file'
import { CONFIGURATION_COMMIT_INDETERMINATE, CONFIGURATION_COMMITTED_SAFELY_PAUSED } from '../runtime/configuration-commit.ts'

export function publicFailure(operation: string, error: unknown) {
	if (error instanceof ExecutionSignerLockHeldError) return json({ error: signerLockConflictMessage(error) }, 400)
	logDashboardFailure('chaos', operation, error)
	if (error instanceof Error && error.name === CONFIGURATION_COMMITTED_SAFELY_PAUSED) {
		return json(
			{
				code: 'configuration_committed_safely_paused',
				committed: true,
				error: 'The configuration was committed, but activation did not complete. The bot remains durably safety-paused. Reload the committed configuration and explicitly resume after recovery.',
				safetyPaused: true,
			},
			503,
		)
	}
	if (error instanceof Error && error.name === CONFIGURATION_COMMIT_INDETERMINATE) {
		return indeterminateConfigurationFailure()
	}
	if (error instanceof Error && error.name === 'SignerOperationBusy') {
		const pausing = operation === 'mutation:/api/paused'
		return json(
			{
				error: pausing ? 'The operator is completing a transaction boundary. A requested pause is active in memory; retry to persist the change.' : 'The operator is completing a transaction boundary. No configuration change was applied; retry shortly.',
			},
			423,
		)
	}
	if (error instanceof Error && error.name === CONFIGURATION_REVISION_CONFLICT) {
		return json(
			{
				code: 'configuration_revision_conflict',
				error: 'Configuration changed after these values were loaded. Reload and review the current policy before saving again.',
			},
			409,
		)
	}
	if (operation === 'mutation:/api/connectivity') return json({ error: publicConnectivityFailure(error) }, 400)
	if (error instanceof Error && error.message.length > 0) return json({ error: error.message }, 400)
	return json({ error: 'The dashboard request could not be completed. Review the submitted values and protected bot logs.' }, 400)
}

function publicConnectivityFailure(error: unknown) {
	return publicConnectivityError(error, {
		fallback: 'RPC connectivity checks failed. Review the complete submitted endpoint set and retry.',
		validationMessages: new Set(['Expected quorum RPC URL list', 'Expected RPC configuration object', 'Expected supported network', 'RPC connectivity checks failed. Review the complete submitted endpoint set and retry.', 'RPC quorum 2 requires at least 2 healthy read endpoints']),
	})
}

export function indeterminateConfigurationFailure() {
	return json(
		{
			code: 'configuration_commit_indeterminate',
			commitStatus: 'indeterminate',
			error: 'The configuration may have committed. Treat it as committed and stop the bot before inspecting and reloading the owner configuration and runtime-state files.',
			safetyPausedInProcess: true,
			treatAsCommitted: true,
		},
		503,
	)
}
