import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED } from '#state/executor-deployment-recovery'
import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import { markFormClean, setFormSubmitting } from '@zoltar/bot-shared/dashboard/form-state'
import { closeResumePreflight, openResumePreflight } from '@zoltar/bot-shared/dashboard/resume-preflight'
import { decodeExecutorDeployment, decodePrediction } from './api-validation.ts'
import type { ConfigurationLoader } from './dashboard-configuration.ts'
import type { DashboardControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { requiredSignerPrivateKey } from './dashboard-format.ts'
import { sendJson } from './dashboard-requests.ts'
import type { SnapshotView } from './dashboard-snapshot-view.ts'
import type { DashboardState } from './dashboard-state.ts'
import { setStatus, setText, shorten } from './dom.ts'
import { resumePreflightRows } from './resume-preflight-rows.ts'

type OperatorActionContext = {
	state: DashboardState
	elements: DashboardElements
	controls: DashboardControls
	view: SnapshotView
	configuration: ConfigurationLoader
	refresh: () => Promise<void>
}

/** Wires the pause button and the resume preflight; a rejected request stays on the overview notice until it is resolved. */
export function registerPauseControls({ state, elements, controls, view, configuration, refresh }: OperatorActionContext) {
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
			void configuration.refreshConfigurationView()
		} catch (error) {
			// The bot refused the request; the dashboard is still connected, so only the readiness check closes and the notice explains why.
			closeResumePreflight()
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

/** The approvals a save would add and remove, capped so a large fork tree still fits the review dialog. */
function universeReviewRows(saved: ReadonlySet<string>, selected: ReadonlySet<string>) {
	const added = [...selected].filter(id => !saved.has(id))
	const removed = [...saved].filter(id => !selected.has(id))
	const rows = [...added.map(id => ({ label: `Universe ${shorten(id)}`, before: 'Not approved', after: 'Approved' })), ...removed.map(id => ({ label: `Universe ${shorten(id)}`, before: 'Approved', after: 'Not approved' }))]
	const maximumRows = 12
	const shown = rows.slice(0, maximumRows)
	if (rows.length > maximumRows) shown.push({ label: 'More changes', before: '—', after: `${(rows.length - maximumRows).toString()} more` })
	return [{ label: 'Approved universes', before: saved.size.toString(), after: selected.size.toString() }, ...shown]
}

/** Wires the approved-universe form, whose selection lives in the universe explorer rather than in form controls. */
export function registerUniverseForm({ state, elements, controls, configuration }: OperatorActionContext) {
	elements.tokensForm.addEventListener('submit', async event => {
		event.preventDefault()
		if (state.universeSavePending) return
		const requestEpoch = state.profileRequestEpoch
		const approved = [...state.approvedUniverseIds]
		state.universeSavePending = true
		controls.syncControls()
		setFormSubmitting('tokens-form', true)
		try {
			if (!(await confirmOperatorAction({ title: 'Review approved universes', description: 'Only REP of approved universes can be traded. Existing positions continue recovery after a change.', changes: universeReviewRows(state.savedUniverseIds, new Set(approved)), confirmLabel: 'Save universe approvals' }))) {
				setStatus('tokens-status', 'Save canceled.')
				return
			}
			setStatus('tokens-status', 'Saving universe approvals…')
			await sendJson('/api/approved-universes', 'PUT', approved)
			if (requestEpoch !== state.profileRequestEpoch) return
			state.savedUniverseIds = new Set(approved)
			markFormClean('tokens-form')
			setStatus('tokens-status', 'Universe approvals saved.')
			void configuration.refreshConfigurationView()
		} catch (error) {
			if (requestEpoch === state.profileRequestEpoch) setStatus('tokens-status', errorMessage(error), true)
		} finally {
			state.universeSavePending = false
			setFormSubmitting('tokens-form', false)
			controls.syncControls()
		}
	})
}

/** Wires the CREATE2 executor deployment, which shows the predicted address and requires a typed confirmation before deploying. */
export function registerExecutorDeploymentForm({ state, elements, configuration, refresh }: OperatorActionContext) {
	elements.create2Form.addEventListener('submit', async event => {
		event.preventDefault()
		const button = elements.deployExecutorButton
		button.disabled = true
		setStatus('create2-status', 'Calculating the CREATE2 address…')
		try {
			const prediction = decodePrediction(await sendJson('/api/executor-prediction', 'POST', {}))
			const snapshot = state.latestSnapshot
			const chain = snapshot === undefined ? 'the active chain' : `${snapshot.network} (chain ${snapshot.expectedChainId.toString()})`
			const signer = snapshot?.wallet === undefined ? 'the active local signer' : `signer ${snapshot.wallet}`
			if (
				!(await confirmOperatorAction({
					title: 'Deploy executor',
					description: `Deploy the executor at ${prediction.address} on ${chain} with ${signer}. Unless the executor already exists there, this broadcasts a transaction immediately and spends that wallet's ETH on gas.`,
					phrase: 'DEPLOY EXECUTOR',
					confirmLabel: 'Deploy executor',
				}))
			) {
				setStatus('create2-status', `Deployment canceled. Predicted executor address: ${prediction.address}.`)
				return
			}
			setStatus('create2-status', `Checking the canonical CREATE2 proxy before deploying ${prediction.address}…`)
			const result = decodeExecutorDeployment(await sendJson('/api/executor-deployment', 'POST', {}))
			setText('deployment-executor', result.address)
			setStatus('create2-status', result.alreadyDeployed ? `Verified existing executor at ${result.address}.` : `Deployed ${result.address} in transaction ${result.transactionHash ?? 'unknown'}.`)
			// A verified deployment is the recovery the refusal asked for; do not wait for a poll that may never have shown the journal.
			if (state.pauseFailure?.message === EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED) state.pauseFailure = undefined
			await refresh()
			void configuration.refreshConfigurationView()
		} catch (error) {
			setStatus('create2-status', errorMessage(error), true)
		} finally {
			button.disabled = !state.connected
		}
	})
}

/** Wires the signer form and the clear and forget actions; keys are cleared from the input whatever the outcome. */
export function registerSignerControls({ state, elements, view, configuration, refresh }: OperatorActionContext) {
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
			void configuration.refreshConfigurationView()
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
			void configuration.refreshConfigurationView()
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
