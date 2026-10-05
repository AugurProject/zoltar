import { fullIdentifier, node } from './dom.js'
import type { Snapshot } from './dashboard-data.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { operationIsIndependentlyExecutable, recoveryItemCount } from './dashboard-format.ts'
import type { ReconcileUnknownMutation } from './dashboard-refresh.ts'
import type { DashboardPut } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'

type PauseControlsContext = {
	state: DashboardState
	elements: DashboardElements
	put: DashboardPut
	refresh: () => Promise<unknown>
	reconcileUnknownMutation: ReconcileUnknownMutation
	renderHeader: (value: Snapshot) => void
}

/** The header pause button and the resume preflight dialog. */
export function registerPauseControls({ state, elements, put, refresh, reconcileUnknownMutation, renderHeader }: PauseControlsContext) {
	const { pauseStatus, resumeDialog, resumePreflight, resumeRandomScopeWarning, resumeStaleWarning, cancelResume, confirmResume } = elements
	let resumeDialogOpening = false

	async function mutatePaused(paused: boolean) {
		state.pauseMutationPending = true
		pauseStatus.textContent = paused ? 'Pausing…' : 'Resuming…'
		if (state.snapshot !== undefined) renderHeader(state.snapshot)
		try {
			await put('/api/paused', { paused, revision: state.configuration?.revision })
			pauseStatus.textContent = paused ? 'Pause saved.' : 'Resume saved.'
			await refresh()
			pauseStatus.textContent = ''
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, pauseStatus, 'configuration and state', 'pause')
			if (!reconciliation.handled) pauseStatus.textContent = error instanceof Error ? error.message : 'Pause control failed.'
			else state.pauseMutationUnreconciled = !reconciliation.reconciled
		} finally {
			state.pauseMutationPending = false
			if (state.snapshot !== undefined) renderHeader(state.snapshot)
		}
	}

	/** Loads current state first: the checklist decides whether to resume, so it must not describe an older snapshot. */
	async function openResumeDialog() {
		if (resumeDialogOpening || resumeDialog.open) return
		resumeDialogOpening = true
		elements.pauseButton.disabled = true
		pauseStatus.textContent = 'Loading current state…'
		try {
			await refresh()
		} finally {
			resumeDialogOpening = false
			pauseStatus.textContent = ''
			if (state.snapshot !== undefined) renderHeader(state.snapshot)
			else elements.pauseButton.disabled = false
		}
		const value = state.snapshot
		if (value === undefined || value.paused !== true) return
		const executable = value.operationEvaluations.filter(operationIsIndependentlyExecutable)
		const eligible = executable.filter(operation => operation.enabled !== false && operation.eligible === true).length
		const signerDetail = value.signerReady === true && value.wallet !== undefined ? fullIdentifier(value.wallet, 'recovery signer address') : 'Missing'
		const selectionPolicy = state.configuration?.selectableOperationAllowlist
		let randomScope: HTMLElement | string = 'Unavailable — keep paused'
		if (Array.isArray(selectionPolicy)) {
			if (selectionPolicy.length === 0) randomScope = 'Lifecycle only — no random novelty'
			else {
				const scope = node('span', 'resume-random-scope')
				scope.append(node('span', undefined, `${selectionPolicy.length.toString()}-ID canary`), node('small', 'mono resume-random-scope-ids', selectionPolicy.join('\n')))
				randomScope = scope
			}
		}
		const rows: [string, HTMLElement | string][] = [
			['Mode', value.execute === true ? 'Live execution' : 'Dry run'],
			['Signer', signerDetail],
			['Eligible executable operations', `${eligible.toString()} of ${executable.length.toString()}`],
			['Random novelty scope', randomScope],
			['Recovery items', recoveryItemCount(value).toString()],
			['Safety latch', value.safetyPaused === true ? 'Active' : 'Clear'],
		]
		resumePreflight.replaceChildren(
			...rows.map(([label, detail]) => {
				const row = node('li')
				const detailValue = node('strong')
				detailValue.append(typeof detail === 'string' ? document.createTextNode(detail) : detail)
				row.append(node('span', undefined, label), detailValue)
				return row
			}),
		)
		resumeRandomScopeWarning.classList.toggle('hidden', selectionPolicy !== undefined)
		resumeRandomScopeWarning.textContent = selectionPolicy === undefined ? 'The current random-selection policy is unavailable. Reload configuration before resuming.' : ''
		resumeStaleWarning.classList.toggle('hidden', !state.snapshotStale)
		confirmResume.disabled = selectionPolicy === undefined || state.snapshotStale || state.configurationCommitIndeterminate
		confirmResume.textContent = 'Resume bot'
		resumeDialog.showModal()
		cancelResume.focus()
	}

	elements.pauseButton.addEventListener('click', () => {
		if (state.snapshot?.paused === true) void openResumeDialog()
		else void mutatePaused(true)
	})
	cancelResume.addEventListener('click', () => resumeDialog.close())
	confirmResume.addEventListener('click', () => {
		if (confirmResume.disabled) return
		resumeDialog.close()
		void mutatePaused(false)
	})
}
