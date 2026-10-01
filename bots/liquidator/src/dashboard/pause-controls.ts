import { shorten } from '@zoltar/bot-shared/dashboard/dom'
import { closeResumePreflight, openResumePreflight } from '@zoltar/bot-shared/dashboard/resume-preflight'
import type { Snapshot } from './api-validation.ts'
import type { MutationControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { actionStatus, put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { publicFailure } from './pool-presentation.ts'
import { enabledAutomaticActionCount } from './strategy-form.ts'

type PauseControlsContext = {
	state: DashboardState
	elements: DashboardElements
	controls: MutationControls
	refresh: () => Promise<void>
}

/** Wires the pause button; resuming live execution first shows a preflight of recovery work, market evidence, and automation. */
export function registerPauseControls({ state, elements, controls, refresh }: PauseControlsContext) {
	const { pauseButton, pauseStatus } = elements

	function openResumeConfirmation(snapshot: Snapshot) {
		const recoveryWork = snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length
		openResumePreflight([
			['Mode', 'Live execution'],
			['Recovery work', recoveryWork === 0 ? 'Clear' : `${recoveryWork.toString()} unresolved`],
			['Market evidence', snapshot.marketConsensus?.reliable === true ? 'Reliable' : 'Guarded / unavailable'],
			['Eligible pools', snapshot.metrics.eligiblePoolCount.toString()],
			['Execution signer', snapshot.wallet === undefined ? 'Missing' : shorten(snapshot.wallet)],
			['Automatic actions enabled', enabledAutomaticActionCount(elements).toString()],
		])
	}

	async function changePaused(paused: boolean) {
		if (state.pauseRequestPending !== undefined || state.snapshot === undefined || (!paused && (state.pendingNetworkProfile !== undefined || !state.stateConnected || !state.configurationConnected || state.configuration?.networkConfigured !== true))) return
		state.pauseRequestPending = paused
		controls.syncControls()
		actionStatus(pauseStatus, '')
		try {
			await put('/api/paused', { paused })
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
	elements.confirmResume.addEventListener('click', () => void changePaused(false))
	elements.resumeDialog.addEventListener('cancel', () => actionStatus(pauseStatus, ''))
}
