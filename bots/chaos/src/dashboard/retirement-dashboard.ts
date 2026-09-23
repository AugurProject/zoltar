import { optionalRecord as retirementRecord } from '@zoltar/bot-shared/infrastructure/json-validation'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import { formatAmount } from '@zoltar/bot-shared/dashboard/amount'

type RetirementResidual = { amount: string; asset: string; category: string; reason: string }
type CompletionEvidence = { blockHash: string; blockNumber: string; residuals: RetirementResidual[] }
type RetirementDetails = { blockers: unknown[]; completionEvidence?: CompletionEvidence | undefined; finalSweepStartedAt?: string | undefined; positions: unknown[]; recipient?: string | undefined; status?: string | undefined }
type RetirementSnapshot = { profileId?: string | undefined; retirement?: RetirementDetails | undefined; wallet?: string | undefined }

function residualDescription(residual: RetirementResidual) {
	return `${formatAmount(residual.amount, `${residual.asset} base units`)} · ${residual.category}: ${residual.reason}`
}

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
	const start = retirementElement('retirement-start', HTMLButtonElement)
	const requestOptions = retirementElement('retirement-request-options', HTMLFieldSetElement)
	let drainEditorOpen = false
	start.addEventListener('click', () => {
		drainEditorOpen = true
		form.hidden = false
		start.hidden = true
		maximumLoss.focus()
	})
	const maximumLoss = retirementElement('retirement-max-loss', HTMLInputElement)
	const exitUnmatched = retirementElement('retirement-exit-unmatched', HTMLInputElement)
	const migrateClaims = retirementElement('retirement-migrate-claims', HTMLInputElement)
	const exitAfter = retirementElement('retirement-exit-after', HTMLInputElement)
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
			const current = options.current()
			const profileId = current?.profileId
			if (profileId === undefined || current?.wallet === undefined) {
				actionStatus.textContent = 'Wait for the durable deployment profile to load.'
				return
			}
			requestInFlight = true
			request.disabled = true
			requestOptions.disabled = true
			let saved = false
			try {
				const normalizedRecipient = getAddress(current.wallet)
				const maximumExitLossBps = maximumLoss.valueAsNumber
				if (!Number.isSafeInteger(maximumExitLossBps) || maximumExitLossBps < 0 || maximumExitLossBps > 10_000) throw new Error('Enter a maximum unmatched-share loss from 0 to 10000 bps.')
				const policies = { exitAfterCompletion: exitAfter.checked, exitUnmatchedShares: exitUnmatched.checked, maximumExitLossBps, migrateExistingClaims: migrateClaims.checked, sweepAssets: true, unwrapWeth: true }
				const phrase = `DRAIN ${profileId} TO ${normalizedRecipient}`
				if (
					!(await confirmOperatorAction({
						title: 'Drain and retire',
						description: 'Review the recipient, loss limit, and recovery policies before starting recovery.',
						phrase,
						confirmLabel: 'Request drain',
						changes: [
							{ label: 'Signer destination', before: 'Current signer', after: normalizedRecipient },
							{ label: 'Maximum unmatched-share loss', before: '0 bps', after: `${maximumExitLossBps.toString()} bps` },
							{ label: 'Exit unmatched shares', before: 'Not requested', after: policies.exitUnmatchedShares ? 'Enabled' : 'Disabled' },
							{ label: 'Migrate existing claims', before: 'Not requested', after: policies.migrateExistingClaims ? 'Enabled' : 'Disabled' },
							{ label: 'Exit after completion', before: 'Not requested', after: policies.exitAfterCompletion ? 'Enabled' : 'Disabled' },
						],
					}))
				)
					return
				confirmation.value = phrase
				await options.put({
					action: 'request',
					confirmation: confirmation.value,
					policies,
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
					const latest = options.current()
					request.disabled = (latest?.retirement?.status ?? 'inactive') !== 'inactive' || latest?.wallet === undefined || latest.profileId === undefined
					requestOptions.disabled = request.disabled
				}
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
				const position = {
					fee: v3Fee.valueAsNumber,
					owner: v3Owner.value.trim(),
					pool: v3Pool.value.trim(),
					profileId,
					tickLower: v3Lower.valueAsNumber,
					tickUpper: v3Upper.valueAsNumber,
					token0: v3Token0.value.trim(),
					token1: v3Token1.value.trim(),
					workflowId: v3Workflow.value.trim(),
				}
				const phrase = `REGISTER V3 ${profileId}`
				if (
					!(await confirmOperatorAction({
						title: 'Register V3 position',
						description: 'Verify these position details and workflow evidence before registering.',
						phrase,
						confirmLabel: 'Register position',
						changes: [
							{ label: 'Profile ID', before: '—', after: position.profileId },
							{ label: 'Owner', before: '—', after: position.owner },
							{ label: 'Pool', before: '—', after: position.pool },
							{ label: 'Token 0', before: '—', after: position.token0 },
							{ label: 'Token 1', before: '—', after: position.token1 },
							{ label: 'Fee tier', before: '—', after: position.fee.toString() },
							{ label: 'Lower tick', before: '—', after: position.tickLower.toString() },
							{ label: 'Upper tick', before: '—', after: position.tickUpper.toString() },
							{ label: 'Receipt/workflow reference', before: '—', after: position.workflowId },
						],
					}))
				)
					return
				v3Confirmation.value = phrase
				await options.put({ action: 'register-v3-position', confirmation: v3Confirmation.value, ...position })
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
				const targetProfileId = residualTargetProfile.value.trim()
				const reason = residualReason.value
				const evidence = options.current()?.retirement?.completionEvidence
				if (evidence === undefined || evidence.residuals.length === 0) throw new Error('Completion evidence is unavailable. Refresh before accepting residuals.')
				const phrase = `ACCEPT RESIDUALS FOR ${targetProfileId}`
				if (
					!(await confirmOperatorAction({
						title: 'Accept residuals',
						description: 'Review unresolved assets and the replacement deployment profile before accepting.',
						phrase,
						confirmLabel: 'Accept residuals',
						changes: [
							{ label: 'Target deployment ID', before: '—', after: targetProfileId },
							{ label: 'Review rationale', before: '—', after: reason },
							{ label: 'Completion block', before: '—', after: evidence.blockNumber },
							{ label: 'Completion block hash', before: '—', after: evidence.blockHash },
							...evidence.residuals.map((residual, index) => ({ label: `Residual ${(index + 1).toString()}`, before: '—', after: residualDescription(residual) })),
						],
					}))
				)
					return
				residualConfirmation.value = phrase
				await options.put({ action: 'accept-residuals', confirmation: residualConfirmation.value, reason, targetProfileId })
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
			else if (status !== 'inactive') destination.textContent = 'Cancel the drain before WETH unwrapping begins.'
			else if (value.wallet === undefined || value.profileId === undefined) destination.textContent = 'Configure a signer wallet before requesting retirement.'
			else destination.textContent = `Recovered ETH and REP go to signer wallet ${value.wallet}.`
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
			cancel.hidden = !canCancel
			request.hidden = status !== 'inactive'
			actions.hidden = request.hidden && cancel.hidden
			start.disabled = status !== 'inactive' || value.wallet === undefined || value.profileId === undefined
			start.hidden = status !== 'inactive' || drainEditorOpen
			form.hidden = status === 'inactive' ? !drainEditorOpen : !canCancel
			v3Form.parentElement?.toggleAttribute('hidden', status !== 'blocked' || !retirement?.blockers.some(blocker => typeof blocker === 'object' && blocker !== null && Reflect.get(blocker, 'category') === 'ambiguous-position'))
			residualForm.parentElement?.toggleAttribute('hidden', status !== 'drained-with-residuals')
			const evidence = retirement?.completionEvidence
			residualEvidence.hidden = status !== 'drained-with-residuals'
			if (status === 'drained-with-residuals') {
				residualBlock.textContent = evidence === undefined ? 'Completion evidence is unavailable. Refresh before accepting residuals.' : `Completion block ${evidence.blockNumber} (${evidence.blockHash}). Review each retained asset before accepting replacement.`
				residualList.replaceChildren(
					...(evidence?.residuals.map(residual => {
						const item = document.createElement('li')
						item.textContent = residualDescription(residual)
						return item
					}) ?? []),
				)
			}
			residualSubmit.disabled = status !== 'drained-with-residuals' || evidence === undefined || evidence.residuals.length === 0
		},
	}
}
