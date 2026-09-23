import { optionalRecord as retirementRecord } from '@zoltar/bot-shared/infrastructure/json-validation'

type RetirementResidual = { amount: string; asset: string; category: string; reason: string }
type CompletionEvidence = { blockHash: string; blockNumber: string; residuals: RetirementResidual[] }
type RetirementDetails = {
	blockers: unknown[]
	completionEvidence?: CompletionEvidence | undefined
	finalSweepStartedAt?: string | undefined
	positions: unknown[]
	recipient?: string | undefined
	status?: string | undefined
}
type RetirementSnapshot = { profileId?: string | undefined; retirement?: RetirementDetails | undefined; wallet?: string | undefined }

function retirementStringValue(value: unknown) {
	return typeof value === 'string' ? value : undefined
}

function parseCompletionEvidence(value: unknown) {
	const evidence = retirementRecord(value)
	if (evidence === undefined || typeof evidence['blockHash'] !== 'string' || typeof evidence['blockNumber'] !== 'string' || !Array.isArray(evidence['residuals'])) return undefined
	const residuals = evidence['residuals'].map(entry => {
		const residual = retirementRecord(entry)
		if (residual === undefined || typeof residual['amount'] !== 'string' || typeof residual['asset'] !== 'string' || typeof residual['category'] !== 'string' || typeof residual['reason'] !== 'string') return undefined
		return { amount: residual['amount'], asset: residual['asset'], category: residual['category'], reason: residual['reason'] }
	})
	if (residuals.some(entry => entry === undefined)) return undefined
	return { blockHash: evidence['blockHash'], blockNumber: evidence['blockNumber'], residuals: residuals.filter(entry => entry !== undefined) }
}

export function parsePublicRetirement(value: unknown): RetirementSnapshot['retirement'] {
	const retirement = retirementRecord(value)
	return retirement === undefined
		? undefined
		: {
				blockers: Array.isArray(retirement['blockers']) ? retirement['blockers'] : [],
				completionEvidence: parseCompletionEvidence(retirement['completionEvidence']),
				finalSweepStartedAt: retirementStringValue(retirement['finalSweepStartedAt']),
				positions: Array.isArray(retirement['positions']) ? retirement['positions'] : [],
				recipient: retirementStringValue(retirement['recipient']),
				status: retirementStringValue(retirement['status']),
			}
}

type RetirementDashboardOptions = {
	current: () => RetirementSnapshot | undefined
	put: (value: unknown) => Promise<unknown>
	refresh: () => Promise<unknown>
}

function retirementElement<T extends Element>(id: string, constructor: { new (): T }) {
	const value = document.getElementById(id)
	if (!(value instanceof constructor)) throw new Error(`Missing dashboard element #${id}`)
	return value
}

export function createRetirementDashboard(options: RetirementDashboardOptions) {
	const statusElement = retirementElement('retirement-status', HTMLSpanElement)
	const summary = retirementElement('retirement-summary', HTMLParagraphElement)
	const destination = retirementElement('retirement-destination', HTMLParagraphElement)
	const form = retirementElement('retirement-form', HTMLFormElement)
	const requestOptions = retirementElement('retirement-request-options', HTMLFieldSetElement)
	const maximumLoss = retirementElement('retirement-max-loss', HTMLInputElement)
	const exitUnmatched = retirementElement('retirement-exit-unmatched', HTMLInputElement)
	const migrateClaims = retirementElement('retirement-migrate-claims', HTMLInputElement)
	const exitAfter = retirementElement('retirement-exit-after', HTMLInputElement)
	const confirmationLabel = retirementElement('retirement-confirmation-label', HTMLLabelElement)
	const confirmation = retirementElement('retirement-confirmation', HTMLInputElement)
	const actions = retirementElement('retirement-actions', HTMLDivElement)
	const request = retirementElement('retirement-request', HTMLButtonElement)
	const cancel = retirementElement('retirement-cancel', HTMLButtonElement)
	const actionStatus = retirementElement('retirement-action-status', HTMLSpanElement)
	const v3Form = retirementElement('retirement-v3-form', HTMLFormElement)
	const v3Owner = retirementElement('retirement-v3-owner', HTMLInputElement)
	const v3Pool = retirementElement('retirement-v3-pool', HTMLInputElement)
	const v3Token0 = retirementElement('retirement-v3-token0', HTMLInputElement)
	const v3Token1 = retirementElement('retirement-v3-token1', HTMLInputElement)
	const v3Fee = retirementElement('retirement-v3-fee', HTMLInputElement)
	const v3Lower = retirementElement('retirement-v3-lower', HTMLInputElement)
	const v3Upper = retirementElement('retirement-v3-upper', HTMLInputElement)
	const v3Workflow = retirementElement('retirement-v3-workflow', HTMLInputElement)
	const v3Confirmation = retirementElement('retirement-v3-confirmation', HTMLInputElement)
	const residualForm = retirementElement('retirement-residual-form', HTMLFormElement)
	const residualEvidence = retirementElement('retirement-residual-evidence', HTMLDivElement)
	const residualBlock = retirementElement('retirement-residual-block', HTMLParagraphElement)
	const residualList = retirementElement('retirement-residual-list', HTMLUListElement)
	const residualTargetProfile = retirementElement('retirement-residual-target-profile', HTMLInputElement)
	const residualReason = retirementElement('retirement-residual-reason', HTMLTextAreaElement)
	const residualConfirmation = retirementElement('retirement-residual-confirmation', HTMLInputElement)
	const residualSubmit = retirementElement('retirement-residual-submit', HTMLButtonElement)
	let requestInFlight = false

	form.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			if (request.disabled || requestInFlight) return
			const profileId = options.current()?.profileId
			if (profileId === undefined) {
				actionStatus.textContent = 'Wait for the durable deployment profile to load.'
				return
			}
			requestInFlight = true
			request.disabled = true
			requestOptions.disabled = true
			let saved = false
			try {
				await options.put({
					action: 'request',
					confirmation: confirmation.value,
					policies: { exitAfterCompletion: exitAfter.checked, exitUnmatchedShares: exitUnmatched.checked, maximumExitLossBps: maximumLoss.valueAsNumber, migrateExistingClaims: migrateClaims.checked, sweepAssets: true, unwrapWeth: true },
					profileId,
				})
				saved = true
				actionStatus.textContent = 'Drain request saved.'
				await options.refresh()
			} catch (error) {
				actionStatus.textContent = error instanceof Error ? error.message : 'Drain request failed.'
			} finally {
				requestInFlight = false
				if (!saved) {
					const current = options.current()
					request.disabled = (current?.retirement?.status ?? 'inactive') !== 'inactive' || current?.wallet === undefined || current.profileId === undefined
					requestOptions.disabled = request.disabled
				}
			}
		})()
	})
	cancel.addEventListener('click', () => {
		void (async () => {
			try {
				await options.put({ action: 'cancel', confirmation: confirmation.value })
				actionStatus.textContent = 'Drain request cancelled.'
				await options.refresh()
			} catch (error) {
				actionStatus.textContent = error instanceof Error ? error.message : 'Drain cancellation failed.'
			}
		})()
	})
	v3Form.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			const profileId = options.current()?.profileId
			if (profileId === undefined) return
			try {
				await options.put({
					action: 'register-v3-position',
					confirmation: v3Confirmation.value,
					fee: v3Fee.valueAsNumber,
					owner: v3Owner.value.trim(),
					pool: v3Pool.value.trim(),
					profileId,
					tickLower: v3Lower.valueAsNumber,
					tickUpper: v3Upper.valueAsNumber,
					token0: v3Token0.value.trim(),
					token1: v3Token1.value.trim(),
					workflowId: v3Workflow.value.trim(),
				})
				actionStatus.textContent = 'Legacy V3 position registered for canonical verification.'
				await options.refresh()
			} catch (error) {
				actionStatus.textContent = error instanceof Error ? error.message : 'Position registration failed.'
			}
		})()
	})
	residualForm.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			try {
				await options.put({ action: 'accept-residuals', confirmation: residualConfirmation.value, reason: residualReason.value, targetProfileId: residualTargetProfile.value.trim() })
				actionStatus.textContent = 'Residual deployment replacement acceptance saved.'
				await options.refresh()
			} catch (error) {
				actionStatus.textContent = error instanceof Error ? error.message : 'Residual acceptance failed.'
			}
		})()
	})

	return {
		render(value: RetirementSnapshot) {
			const retirement = value.retirement
			const status = retirement?.status ?? 'inactive'
			const canCancel = ['requested', 'draining', 'waiting', 'blocked'].includes(status) && retirement?.finalSweepStartedAt === undefined
			destination.hidden = status !== 'inactive' && !canCancel && status !== 'known-claims-recovered'
			if (status === 'known-claims-recovered') destination.textContent = `Recovered ETH and REP go to signer wallet ${retirement?.recipient ?? 'not recorded'}.`
			else if (status !== 'inactive') destination.textContent = 'Type CANCEL DRAIN to cancel before WETH unwrapping begins.'
			else if (value.wallet === undefined || value.profileId === undefined) destination.textContent = 'Configure a signer wallet before requesting retirement.'
			else destination.textContent = `Recovered ETH and REP go to the signer wallet. Type DRAIN ${value.profileId} TO ${value.wallet} to confirm.`
			let tone = 'warning'
			if (status === 'drained') tone = 'success'
			else if (status === 'blocked') tone = 'error'
			else if (status === 'inactive') tone = 'neutral'
			statusElement.className = `badge ${tone}`
			statusElement.textContent = status === 'known-claims-recovered' ? 'All known claims recovered' : status.replaceAll('-', ' ')
			if (status === 'known-claims-recovered') summary.textContent = 'Earlier history remains unverified; additional claims may exist.'
			else if (status === 'inactive') summary.textContent = 'No retirement has been requested.'
			else summary.textContent = `${retirement?.positions.length.toString() ?? '0'} V3 position records; ${retirement?.blockers.length.toString() ?? '0'} blockers; signer wallet ${retirement?.recipient ?? 'not recorded'}.`
			request.disabled = status !== 'inactive' || value.wallet === undefined || value.profileId === undefined || requestInFlight
			requestOptions.disabled = request.disabled
			requestOptions.hidden = status !== 'inactive'
			cancel.disabled = !canCancel
			confirmationLabel.hidden = status !== 'inactive' && !canCancel
			confirmation.disabled = confirmationLabel.hidden
			request.hidden = status !== 'inactive'
			cancel.hidden = !canCancel
			actions.hidden = request.hidden && cancel.hidden
			const evidence = retirement?.completionEvidence
			residualEvidence.hidden = status !== 'drained-with-residuals'
			if (status === 'drained-with-residuals') {
				residualBlock.textContent = evidence === undefined ? 'Completion evidence is unavailable. Refresh before accepting residuals.' : `Completion block ${evidence.blockNumber} (${evidence.blockHash}). Review each retained asset before accepting replacement.`
				residualList.replaceChildren(
					...(evidence?.residuals.map(residual => {
						const item = document.createElement('li')
						item.textContent = `${residual.amount} ${residual.asset} base units · ${residual.category}: ${residual.reason}`
						return item
					}) ?? []),
				)
			}
			residualSubmit.disabled = status !== 'drained-with-residuals' || evidence === undefined || evidence.residuals.length === 0
		},
	}
}
