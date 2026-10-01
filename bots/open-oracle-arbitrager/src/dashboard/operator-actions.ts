import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED } from '#state/executor-deployment-recovery'
import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import { markFormClean, setFormSubmitting } from '@zoltar/bot-shared/dashboard/form-state'
import { closeResumePreflight, openResumePreflight } from '@zoltar/bot-shared/dashboard/resume-preflight'
import { decodeExecutorDeployment, decodePrediction } from './api-validation.ts'
import type { DashboardControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { requiredSignerPrivateKey } from './dashboard-format.ts'
import { sendJson } from './dashboard-requests.ts'
import type { SnapshotView } from './dashboard-snapshot-view.ts'
import type { DashboardState } from './dashboard-state.ts'
import { setText } from './dom.ts'
import { resumePreflightRows } from './resume-preflight-rows.ts'

type OperatorActionContext = {
	state: DashboardState
	elements: DashboardElements
	controls: DashboardControls
	view: SnapshotView
	refresh: () => Promise<void>
}

/** Wires the pause button and the resume preflight; a rejected request stays on the overview notice until it is resolved. */
export function registerPauseControls({ state, elements, controls, view, refresh }: OperatorActionContext) {
	async function changePaused(paused: boolean) {
		const emergencyPauseAvailable = paused && state.latestSnapshot?.paused === false
		if ((!state.connected && !emergencyPauseAvailable) || (!paused && state.latestSnapshot?.networkConfigured !== true)) {
			closeResumePreflight()
			return
		}
		state.pauseRequestPending = paused ? 'pause' : 'resume'
		state.pauseFailure = undefined
		controls.syncControls()
		try {
			await sendJson('/api/paused', 'PUT', { paused })
			await refresh()
			closeResumePreflight()
		} catch (error) {
			controls.setControlsEnabled(false)
			state.pauseFailure = { message: errorMessage(error), recoverySeen: false, requestedPaused: paused }
			if (state.latestSnapshot !== undefined) view.renderOperatorNotice(state.latestSnapshot)
		} finally {
			state.pauseRequestPending = undefined
			controls.syncControls()
		}
	}

	elements.pauseButton.addEventListener('click', () => {
		const snapshot = state.latestSnapshot
		if (snapshot === undefined) return
		if (snapshot.paused && (!state.connected || !snapshot.networkConfigured)) return
		if (snapshot.paused && snapshot.execute) {
			openResumePreflight(resumePreflightRows(snapshot))
			return
		}
		void changePaused(!snapshot.paused)
	})
	elements.cancelResume.addEventListener('click', closeResumePreflight)
	elements.confirmResume.addEventListener('click', () => {
		if (!state.connected || state.latestSnapshot?.networkConfigured !== true) return
		void changePaused(false)
	})
}

/** Wires the approved-universe form, whose selection lives in the universe explorer rather than in form controls. */
export function registerUniverseForm({ state, elements, controls }: OperatorActionContext) {
	elements.tokensForm.addEventListener('submit', async event => {
		event.preventDefault()
		const requestEpoch = state.profileRequestEpoch
		state.universeSavePending = true
		controls.syncControls()
		setFormSubmitting('tokens-form', true)
		setText('tokens-status', 'Saving universe approvals…')
		try {
			await sendJson('/api/approved-universes', 'PUT', [...state.approvedUniverseIds])
			if (requestEpoch !== state.profileRequestEpoch) return
			markFormClean('tokens-form')
			setText('tokens-status', 'Universe approvals saved.')
		} catch (error) {
			if (requestEpoch === state.profileRequestEpoch) setText('tokens-status', errorMessage(error))
		} finally {
			state.universeSavePending = false
			setFormSubmitting('tokens-form', false)
			controls.syncControls()
		}
	})
}

/** Wires the CREATE2 executor deployment, which shows the predicted address and requires a typed confirmation before deploying. */
export function registerExecutorDeploymentForm({ state, elements, refresh }: OperatorActionContext) {
	elements.create2Form.addEventListener('submit', async event => {
		event.preventDefault()
		const button = elements.deployExecutorButton
		button.disabled = true
		setText('create2-status', 'Calculating the CREATE2 address…')
		try {
			const prediction = decodePrediction(await sendJson('/api/executor-prediction', 'POST', {}))
			if (!(await confirmOperatorAction({ title: 'Deploy executor', description: `Deploy the executor at ${prediction.address} with the active local signer.`, phrase: 'DEPLOY EXECUTOR', confirmLabel: 'Deploy executor' }))) {
				setText('create2-status', `Deployment cancelled. Predicted executor address: ${prediction.address}.`)
				return
			}
			setText('create2-status', `Checking the canonical CREATE2 proxy before deploying ${prediction.address}…`)
			const result = decodeExecutorDeployment(await sendJson('/api/executor-deployment', 'POST', {}))
			setText('deployment-executor', result.address)
			setText('create2-status', result.alreadyDeployed ? `Verified existing executor at ${result.address}.` : `Deployed ${result.address} in transaction ${result.transactionHash ?? 'unknown'}.`)
			// A verified deployment is the recovery the refusal asked for; do not wait for a poll that may never have shown the journal.
			if (state.pauseFailure?.message === EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED) state.pauseFailure = undefined
			await refresh()
		} catch (error) {
			setText('create2-status', errorMessage(error))
		} finally {
			button.disabled = !state.connected
		}
	})
}

/** Wires the signer form and the clear and forget actions; keys are cleared from the input whatever the outcome. */
export function registerSignerControls({ state, elements, view, refresh }: OperatorActionContext) {
	async function updateSigner(privateKey: string | undefined, rememberSigner: boolean) {
		if (state.signerRequestPending) return
		state.signerRequestPending = true
		state.signerFeedback = { error: false, message: privateKey === undefined ? 'Clearing signer…' : 'Validating signer…' }
		view.refreshSignerStatus()
		try {
			await sendJson('/api/signer', 'PUT', { privateKey: privateKey ?? null, rememberSigner })
			elements.privateKey.value = ''
			elements.rememberSigner.checked = false
			state.signerFeedback = undefined
		} catch (error) {
			elements.privateKey.value = ''
			state.signerFeedback = { error: true, message: errorMessage(error) }
		} finally {
			state.signerRequestPending = false
			await refresh()
		}
	}

	elements.signerForm.addEventListener('submit', event => {
		event.preventDefault()
		try {
			const privateKey = requiredSignerPrivateKey(elements.privateKey.value)
			void updateSigner(privateKey, elements.rememberSigner.checked)
		} catch (error) {
			state.signerFeedback = { error: true, message: errorMessage(error) }
			view.refreshSignerStatus()
		}
	})
	elements.clearSignerButton.addEventListener(
		'click',
		() =>
			void (async () => {
				if (await confirmOperatorAction({ title: 'Clear signer', description: 'Remove the active signer from this bot.', phrase: 'CLEAR SIGNER', confirmLabel: 'Clear signer' })) await updateSigner(undefined, false)
			})(),
	)
	elements.forgetSignerButton.addEventListener('click', async () => {
		if (state.signerRequestPending) return
		if (!(await confirmOperatorAction({ title: 'Forget saved signer', description: 'Remove the saved private key from the local operator file.', phrase: 'FORGET SIGNER', confirmLabel: 'Forget signer' }))) return
		state.signerRequestPending = true
		state.signerFeedback = { error: false, message: 'Removing the saved key…' }
		view.refreshSignerStatus()
		try {
			await sendJson('/api/signer', 'PUT', { forgetSavedSigner: true })
			state.signerFeedback = undefined
		} catch (error) {
			state.signerFeedback = { error: true, message: errorMessage(error) }
		} finally {
			state.signerRequestPending = false
			await refresh()
		}
	})
	elements.privateKey.addEventListener('input', () => {
		if (state.signerRequestPending) return
		state.signerFeedback = undefined
		view.refreshSignerStatus()
	})
}
