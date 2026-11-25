import { formIsDirty } from '@zoltar/bot-shared/dashboard/form-state'
import { closeResumePreflight, openResumePreflight } from '@zoltar/bot-shared/dashboard/resume-preflight'
import type { Snapshot } from './api-validation.ts'
import type { MutationControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { actionStatus, put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { publicFailure } from './pool-presentation.ts'
import { enabledAutomaticActions } from './strategy-form.ts'

type PauseControlsContext = {
	state: DashboardState
	elements: DashboardElements
	controls: MutationControls
	refresh: () => Promise<void>
}

/** Wires the pause button; resuming live execution first shows a preflight of recovery work, market evidence, and automation. */
export function registerPauseControls({ state, elements, controls, refresh }: PauseControlsContext) {
	const { pauseButton, pauseStatus } = elements

	/** The preflight describes the saved strategy the bot runs, so unsaved form edits are called out instead of counted. */
	function automaticActionsSummary() {
		const actions = enabledAutomaticActions(state.configuration)
		if (actions === undefined) return 'Unavailable'
		const summary = actions.length === 0 ? 'None' : `${actions.length.toString()} · ${actions.join(', ')}`
		return formIsDirty('strategy-form') ? `${summary} · unsaved strategy edits are not applied` : summary
	}

	let reviewedRevision: string | undefined
	let reviewedRows: string | undefined
	function resumeRows(snapshot: Snapshot) {
		const recoveryWork = snapshot.pendingTransactions.length
		return [
			['Mode', snapshot.execute ? 'Live execution' : 'Dry run'],
			['Recovery work', recoveryWork === 0 ? 'Clear' : `${recoveryWork.toString()} unresolved`],
			['Market evidence', snapshot.marketConsensus?.reliable === true ? 'Reliable' : 'Guarded / unavailable'],
			['Eligible pools', snapshot.metrics.eligiblePoolCount.toString()],
			['Execution signer', snapshot.wallet ?? 'Missing'],
			['Automatic actions enabled', automaticActionsSummary()],
		] as const
	}
	function openResumeConfirmation(snapshot: Snapshot) {
		const rows = resumeRows(snapshot)
		reviewedRevision = snapshot.configurationRevision
		reviewedRows = JSON.stringify(rows)
		openResumePreflight(rows)
	}

	async function changePaused(paused: boolean) {
		if (state.pauseRequestPending !== undefined || state.snapshot === undefined || (!paused && (state.pendingNetworkProfile !== undefined || !state.stateConnected || !state.configurationConnected || state.configuration?.networkConfigured !== true))) return
		state.pauseRequestPending = paused
		controls.syncControls()
		actionStatus(pauseStatus, '')
		try {
			await put('/api/paused', paused || !state.snapshot.execute ? { paused } : { paused, revision: reviewedRevision })
			await refresh()
			actionStatus(pauseStatus, '')
		} catch (error) {
			actionStatus(pauseStatus, publicFailure(error, 'Could not change bot status. Check the bot connection and retry.', true), true)
		} finally {
			closeResumePreflight()
			state.pauseRequestPending = undefined
			controls.syncControls()
		}
	}

	pauseButton.addEventListener('click', () => {
		if (state.snapshot === undefined) return
		if (pauseButton.dataset['action'] === 'confirm-resume') {
			openResumeConfirmation(state.snapshot)
			return
		}
		void changePaused(!state.snapshot.paused)
	})
	elements.cancelResume.addEventListener('click', closeResumePreflight)
	elements.confirmResume.addEventListener('click', () => {
		const snapshot = state.snapshot
		if (snapshot === undefined) return
		if (!snapshot.execute || !snapshot.paused) {
			closeResumePreflight()
			return
		}
		if (reviewedRevision === undefined || state.configurationRevision !== snapshot.configurationRevision) {
			actionStatus(pauseStatus, 'Waiting for current configuration. Review the preflight after it loads.')
			void refresh()
			return
		}
		if (snapshot.configurationRevision !== reviewedRevision || JSON.stringify(resumeRows(snapshot)) !== reviewedRows) {
			closeResumePreflight()
			openResumeConfirmation(snapshot)
			actionStatus(pauseStatus, 'The resume preflight changed. Review the updated values and confirm again.')
			return
		}
		void changePaused(false)
	})
	elements.resumeDialog.addEventListener('cancel', () => actionStatus(pauseStatus, ''))
}
