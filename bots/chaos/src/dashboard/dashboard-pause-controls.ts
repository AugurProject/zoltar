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
	const { pauseStatus, resumeDialog, resumePreflight, resumeRandomScopeWarning, cancelResume, confirmResume } = elements

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

	function openResumeDialog() {
		const value = state.snapshot
		if (value === undefined) return
		const executable = value.operationEvaluations.filter(operationIsIndependentlyExecutable)
		const eligible = executable.filter(operation => operation.enabled !== false && operation.eligible === true).length
		const signerDetail = value.signerReady === true && value.wallet !== undefined ? fullIdentifier(value.wallet, 'recovery signer address') : 'Missing'
		const selectionPolicy = state.configuration?.selectableOperationAllowlist
		let randomScope: HTMLElement | string = 'Unavailable — keep paused'
		if (selectionPolicy === null) randomScope = 'ALL selectable operations'
		else if (Array.isArray(selectionPolicy)) {
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
		const unrestricted = selectionPolicy === null
		let randomScopeWarning = ''
		if (unrestricted) randomScopeWarning = 'Random novelty is unrestricted. Any due eligible selectable operation may run immediately after resume.'
		else if (selectionPolicy === undefined) randomScopeWarning = 'The current random-selection policy is unavailable. Reload configuration before resuming.'
		resumeRandomScopeWarning.classList.toggle('hidden', !unrestricted && selectionPolicy !== undefined)
		resumeRandomScopeWarning.textContent = randomScopeWarning
		confirmResume.disabled = selectionPolicy === undefined
		confirmResume.textContent = unrestricted ? 'Resume unrestricted bot' : 'Resume bot'
		resumeDialog.showModal()
		cancelResume.focus()
	}

	elements.pauseButton.addEventListener('click', () => {
		if (state.snapshot?.paused === true) openResumeDialog()
		else void mutatePaused(true)
	})
	cancelResume.addEventListener('click', () => resumeDialog.close())
	confirmResume.addEventListener('click', () => {
		resumeDialog.close()
		void mutatePaused(false)
	})
}
