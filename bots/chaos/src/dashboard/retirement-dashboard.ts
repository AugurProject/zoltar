type RetirementSnapshot = {
	profileId?: string | undefined
	retirement?: { blockers: unknown[]; finalSweepStartedAt?: string | undefined; positions: unknown[]; recipient?: string | undefined; status?: string | undefined } | undefined
}

function retirementRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

function retirementStringValue(value: unknown) {
	return typeof value === 'string' ? value : undefined
}

function parsePublicRetirement(value: unknown): RetirementSnapshot['retirement'] {
	const retirement = retirementRecord(value)
	return retirement === undefined
		? undefined
		: {
				blockers: Array.isArray(retirement['blockers']) ? retirement['blockers'] : [],
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

function createRetirementDashboard(options: RetirementDashboardOptions) {
	const statusElement = retirementElement('retirement-status', HTMLSpanElement)
	const summary = retirementElement('retirement-summary', HTMLParagraphElement)
	const form = retirementElement('retirement-form', HTMLFormElement)
	const recipient = retirementElement('retirement-recipient', HTMLInputElement)
	const maximumLoss = retirementElement('retirement-max-loss', HTMLInputElement)
	const exitUnmatched = retirementElement('retirement-exit-unmatched', HTMLInputElement)
	const migrateClaims = retirementElement('retirement-migrate-claims', HTMLInputElement)
	const exitAfter = retirementElement('retirement-exit-after', HTMLInputElement)
	const confirmation = retirementElement('retirement-confirmation', HTMLInputElement)
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
	const residualTargetProfile = retirementElement('retirement-residual-target-profile', HTMLInputElement)
	const residualReason = retirementElement('retirement-residual-reason', HTMLTextAreaElement)
	const residualConfirmation = retirementElement('retirement-residual-confirmation', HTMLInputElement)
	const residualSubmit = retirementElement('retirement-residual-submit', HTMLButtonElement)

	form.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			const profileId = options.current()?.profileId
			if (profileId === undefined) {
				actionStatus.textContent = 'Wait for the durable deployment profile to load.'
				return
			}
			try {
				await options.put({
					action: 'request',
					confirmation: confirmation.value,
					policies: { exitAfterCompletion: exitAfter.checked, exitUnmatchedShares: exitUnmatched.checked, maximumExitLossBps: maximumLoss.valueAsNumber, migrateExistingClaims: migrateClaims.checked, sweepAssets: true, unwrapWeth: true },
					profileId,
					recipient: recipient.value.trim(),
				})
				actionStatus.textContent = 'Drain request saved.'
				await options.refresh()
			} catch (error) {
				actionStatus.textContent = error instanceof Error ? error.message : 'Drain request failed.'
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
				actionStatus.textContent = 'Residual profile replacement acceptance saved.'
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
			let tone = 'warning'
			if (status === 'drained') tone = 'success'
			else if (status === 'blocked') tone = 'error'
			else if (status === 'inactive') tone = 'neutral'
			statusElement.className = `badge ${tone}`
			statusElement.textContent = status.replaceAll('-', ' ')
			summary.textContent = status === 'inactive' ? 'No retirement has been requested.' : `${retirement?.positions.length.toString() ?? '0'} V3 position records; ${retirement?.blockers.length.toString() ?? '0'} blockers; recipient ${retirement?.recipient ?? 'not recorded'}.`
			recipient.disabled = status !== 'inactive'
			cancel.disabled = status === 'inactive' || retirement?.finalSweepStartedAt !== undefined || status === 'drained' || status === 'drained-with-residuals'
			residualSubmit.disabled = status !== 'drained-with-residuals'
		},
	}
}

Object.assign(globalThis, { createRetirementDashboard, parsePublicRetirement })
