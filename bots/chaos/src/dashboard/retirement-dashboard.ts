import { optionalRecord as retirementRecord } from '@zoltar/bot-shared/infrastructure/json-validation'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'

type RetirementSnapshot = {
	profileId?: string | undefined
	retirement?: { blockers: unknown[]; finalSweepStartedAt?: string | undefined; positions: unknown[]; recipient?: string | undefined; status?: string | undefined } | undefined
}

function retirementStringValue(value: unknown) {
	return typeof value === 'string' ? value : undefined
}

export function parsePublicRetirement(value: unknown): RetirementSnapshot['retirement'] {
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

export function createRetirementDashboard(options: RetirementDashboardOptions) {
	const statusElement = retirementElement('retirement-status', HTMLSpanElement)
	const summary = retirementElement('retirement-summary', HTMLParagraphElement)
	const form = retirementElement('retirement-form', HTMLFormElement)
	const start = retirementElement('retirement-start', HTMLButtonElement)
	let drainEditorOpen = false
	start.addEventListener('click', () => {
		drainEditorOpen = true
		form.hidden = false
		start.hidden = true
		retirementElement('retirement-recipient', HTMLInputElement).focus()
	})
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
				const normalizedRecipient = getAddress(recipient.value.trim())
				const phrase = `DRAIN ${profileId} TO ${normalizedRecipient}`
				if (
					!(await confirmOperatorAction({
						title: 'Drain and retire',
						description: 'Review the recipient and loss limit before starting recovery.',
						phrase,
						confirmLabel: 'Request drain',
						changes: [
							{ label: 'Recipient', before: 'Current wallet', after: normalizedRecipient },
							{ label: 'Maximum unmatched-share loss', before: '0 bps', after: `${maximumLoss.value} bps` },
						],
					}))
				)
					return
				confirmation.value = phrase
				await options.put({
					action: 'request',
					confirmation: confirmation.value,
					policies: { exitAfterCompletion: exitAfter.checked, exitUnmatchedShares: exitUnmatched.checked, maximumExitLossBps: maximumLoss.valueAsNumber, migrateExistingClaims: migrateClaims.checked, sweepAssets: true, unwrapWeth: true },
					profileId,
					recipient: normalizedRecipient,
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
				if (!(await confirmOperatorAction({ title: 'Cancel drain', description: 'Cancel the pending retirement request before the final sweep starts.', phrase: 'CANCEL DRAIN', confirmLabel: 'Cancel drain' }))) return
				confirmation.value = 'CANCEL DRAIN'
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
				const phrase = `REGISTER V3 ${profileId}`
				if (!(await confirmOperatorAction({ title: 'Register V3 position', description: 'Verify the pool, owner, token addresses, ticks, and workflow evidence.', phrase, confirmLabel: 'Register position' }))) return
				v3Confirmation.value = phrase
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
				const phrase = `ACCEPT RESIDUALS FOR ${residualTargetProfile.value.trim()}`
				if (!(await confirmOperatorAction({ title: 'Accept residuals', description: 'Record unresolved assets against the replacement deployment profile.', phrase, confirmLabel: 'Accept residuals' }))) return
				residualConfirmation.value = phrase
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
			statusElement.textContent = status === 'known-claims-recovered' ? 'All known claims recovered' : status.replaceAll('-', ' ')
			if (status === 'known-claims-recovered') summary.textContent = 'Earlier history remains unverified; additional claims may exist.'
			else if (status === 'inactive') summary.textContent = 'No retirement has been requested.'
			else summary.textContent = `${retirement?.positions.length.toString() ?? '0'} V3 position records; ${retirement?.blockers.length.toString() ?? '0'} blockers; recipient ${retirement?.recipient ?? 'not recorded'}.`
			recipient.disabled = status !== 'inactive'
			for (const field of form.querySelectorAll<HTMLElement>('label, #retirement-request')) field.hidden = status !== 'inactive'
			cancel.disabled = status === 'inactive' || retirement?.finalSweepStartedAt !== undefined || status === 'drained' || status === 'drained-with-residuals'
			cancel.hidden = cancel.disabled
			start.hidden = status !== 'inactive' || drainEditorOpen
			form.hidden = status === 'inactive' ? !drainEditorOpen : cancel.disabled
			v3Form.parentElement?.toggleAttribute('hidden', status !== 'blocked' || !retirement?.blockers.some(blocker => typeof blocker === 'object' && blocker !== null && Reflect.get(blocker, 'category') === 'ambiguous-position'))
			residualForm.parentElement?.toggleAttribute('hidden', status !== 'drained-with-residuals')
			residualSubmit.disabled = status !== 'drained-with-residuals'
		},
	}
}
