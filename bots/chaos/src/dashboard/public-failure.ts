import { CONFIGURATION_REVISION_CONFLICT } from '@zoltar/bot-shared/config/durable-file'
import { publicConnectivityError } from '@zoltar/bot-shared/dashboard/connectivity-error'
import { categorizedDashboardError, type PublicDashboardFailure } from '@zoltar/bot-shared/dashboard/public-error'
import { dashboardJson } from '@zoltar/bot-shared/dashboard/security'
import { ExecutionSignerLockHeldError, signerLockConflictMessage } from '@zoltar/bot-shared/execution/process-lock'
import { CONFIGURATION_COMMIT_INDETERMINATE, CONFIGURATION_COMMITTED_SAFELY_PAUSED } from '../runtime/configuration-commit.ts'

// The public JSON responses for failed dashboard mutations. Raw errors reach only the protected process log.

const COMMITTED_SAFELY_PAUSED_FAILURE: PublicDashboardFailure = {
	body: {
		code: 'configuration_committed_safely_paused',
		committed: true,
		error: 'The configuration was committed, but activation did not complete. The bot remains durably safety-paused. Reload the committed configuration and explicitly resume after recovery.',
		safetyPaused: true,
	},
	status: 503,
}

const INDETERMINATE_CONFIGURATION_FAILURE: PublicDashboardFailure = {
	body: {
		code: 'configuration_commit_indeterminate',
		commitStatus: 'indeterminate',
		error: 'The configuration may have committed. Treat it as committed and stop the bot before inspecting and reloading the owner configuration and runtime-state files.',
		safetyPausedInProcess: true,
		treatAsCommitted: true,
	},
	status: 503,
}

const REVISION_CONFLICT_FAILURE: PublicDashboardFailure = {
	body: {
		code: 'configuration_revision_conflict',
		error: 'Configuration changed after these values were loaded. Reload and review the current policy before saving again.',
	},
	status: 409,
}

function signerBusyFailure(operation: string): PublicDashboardFailure {
	const pausing = operation === 'mutation:/api/paused'
	return {
		body: {
			error: pausing ? 'The operator is completing a transaction boundary. A requested pause is active in memory; retry to persist the change.' : 'The operator is completing a transaction boundary. No configuration change was applied; retry shortly.',
		},
		status: 423,
	}
}

/** Commit outcomes, a busy signer, and revision conflicts keep dedicated bodies; other failures surface validation messages. */
export function publicFailure(operation: string, error: unknown) {
	const categories = {
		[CONFIGURATION_COMMITTED_SAFELY_PAUSED]: COMMITTED_SAFELY_PAUSED_FAILURE,
		[CONFIGURATION_COMMIT_INDETERMINATE]: INDETERMINATE_CONFIGURATION_FAILURE,
		SignerOperationBusy: signerBusyFailure(operation),
		[CONFIGURATION_REVISION_CONFLICT]: REVISION_CONFLICT_FAILURE,
	}
	return categorizedDashboardError('chaos', operation, error, categories, uncategorized => ({ body: { error: publicRequestFailure(operation, uncategorized) }, status: 400 }))
}

function publicRequestFailure(operation: string, error: unknown) {
	if (error instanceof ExecutionSignerLockHeldError) return signerLockConflictMessage(error)
	if (operation === 'mutation:/api/connectivity') return publicConnectivityFailure(error)
	if (error instanceof Error && error.message.length > 0) return error.message
	return 'The dashboard request could not be completed. Review the submitted values and protected bot logs.'
}

function publicConnectivityFailure(error: unknown) {
	return publicConnectivityError(error, {
		fallback: 'RPC connectivity checks failed. Review the complete submitted endpoint set and retry.',
		validationMessages: new Set(['Expected quorum RPC URL list', 'Expected RPC configuration object', 'Expected supported network', 'RPC connectivity checks failed. Review the complete submitted endpoint set and retry.', 'RPC quorum 2 requires at least 2 healthy read endpoints']),
	})
}

export function indeterminateConfigurationFailure() {
	return dashboardJson(INDETERMINATE_CONFIGURATION_FAILURE.body, INDETERMINATE_CONFIGURATION_FAILURE.status)
}
