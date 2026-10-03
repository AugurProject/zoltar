import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import { formIsSubmitting, setFormSubmitting } from '@zoltar/bot-shared/dashboard/form-state'
import { type Configuration, decodeConfiguration } from './api-validation.ts'
import type { ConfigurationSource } from './dashboard-configuration.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { actionStatus, put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { publicFailure } from './pool-presentation.ts'
import { strategyReviewRows, validateStrategyReview } from './strategy-review.ts'

/** The automatic actions the strategy can enable, with the name the dashboard gives each one. */
const AUTOMATIC_ACTION_LABELS = [
	['allowAutomaticDeposits', 'REP deposits'],
	['allowAutomaticPoolCreation', 'pool creation'],
	['allowAutomaticVaultMigrations', 'vault migrations'],
	['allowAutomaticWithdrawals', 'REP withdrawals'],
] as const
const NUMERIC_STRATEGY_FIELDS = ['stalePriceFundingBufferBps', 'stagedOperationValidForSeconds', 'vaultTargetHealthBps', 'vaultTopUpHealthBps', 'vaultWithdrawHealthBps']

type StrategyFormContext = {
	state: DashboardState
	elements: DashboardElements
	populateConfiguration: (configuration: Configuration, source?: ConfigurationSource) => void
	/** Re-derives every fieldset's locked state once a save has finished. */
	syncControls: () => void
}

function checkboxChecked(form: HTMLFormElement, name: string) {
	const field = form.elements.namedItem(name)
	return field instanceof HTMLInputElement && field.checked
}

function setFormValue(form: HTMLFormElement, name: string, value: string | number | boolean) {
	const field = form.elements.namedItem(name)
	if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = value === true
	else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = String(value)
}

/** Fills the strategy form, including the runtime log-recovery fields it edits, from a loaded configuration. */
export function loadStrategyForm(elements: DashboardElements, configuration: Configuration) {
	const form = elements.strategyForm
	for (const [name, value] of Object.entries(configuration.strategy)) setFormValue(form, name, value)
	setFormValue(form, 'logLookbackBlocks', configuration.runtime.logLookbackBlocks)
	setFormValue(form, 'historicalLogRecovery', configuration.runtime.historicalLogRecovery)
}

/** Names the automatic actions the saved strategy enables: what the running bot does, not what the form currently shows. */
export function enabledAutomaticActions(configuration: Configuration | undefined) {
	if (configuration === undefined) return undefined
	return AUTOMATIC_ACTION_LABELS.filter(([name]) => configuration.strategy[name] === true).map(([, label]) => label)
}

function healthPercent(value: string) {
	if (value === '') return '—'
	const basisPoints = Number(value)
	return Number.isFinite(basisPoints) ? `${(basisPoints / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%` : '—'
}

/** Summarizes the vault health thresholds the strategy form currently holds. */
export function updateHealthPolicyPreview(elements: DashboardElements) {
	const strategyInput = (name: string) => {
		const field = elements.strategyForm.elements.namedItem(name)
		return field instanceof HTMLInputElement ? field.value.trim() : ''
	}
	const topUp = healthPercent(strategyInput('vaultTopUpHealthBps'))
	const target = healthPercent(strategyInput('vaultTargetHealthBps'))
	const withdraw = healthPercent(strategyInput('vaultWithdrawHealthBps'))
	elements.healthPolicyPreview.textContent = `Top up below ${topUp} · restore to ${target} · withdraw excess above ${withdraw}`
}

function readStrategyForm(form: HTMLFormElement, saved: Configuration) {
	const data = new FormData(form)
	const next = { ...saved.strategy }
	for (const [name, value] of data.entries()) next[name] = String(value)
	for (const name of NUMERIC_STRATEGY_FIELDS) {
		const value = next[name]
		if (typeof value === 'string' && value !== '') next[name] = Number(value)
	}
	for (const [name] of AUTOMATIC_ACTION_LABELS) next[name] = checkboxChecked(form, name)
	next['logLookbackBlocks'] = Number(data.get('logLookbackBlocks'))
	next['historicalLogRecovery'] = checkboxChecked(form, 'historicalLogRecovery')
	return next
}

/** Keeps the health preview in step with each strategy edit. */
export function registerStrategyPreview(elements: DashboardElements) {
	elements.strategyForm.addEventListener('input', () => updateHealthPolicyPreview(elements))
}

/** Saves the strategy form after validating it and confirming the reviewed changes. */
export function registerStrategyForm({ state, elements, populateConfiguration, syncControls }: StrategyFormContext) {
	const { strategyForm, strategyStatus } = elements
	strategyForm.addEventListener('submit', async event => {
		event.preventDefault()
		if (state.configuration === undefined || formIsSubmitting('strategy-form')) return
		const savedConfiguration = state.configuration
		const next = readStrategyForm(strategyForm, savedConfiguration)
		try {
			validateStrategyReview(savedConfiguration, next)
		} catch (error) {
			actionStatus(strategyStatus, error instanceof Error ? error.message : 'Review the strategy values and retry.', true)
			return
		}
		// The submitting latch keeps the form locked across polls through the review and the request.
		setFormSubmitting('strategy-form', true)
		try {
			const changes = strategyReviewRows(savedConfiguration, next)
			if (changes.length > 0 && !(await confirmOperatorAction({ title: 'Review liquidation strategy', description: 'Changes to amounts and automation apply on the next scan.', changes, confirmLabel: 'Save strategy' }))) {
				actionStatus(strategyStatus, '')
				return
			}
			actionStatus(strategyStatus, 'Saving…')
			const configuration = decodeConfiguration(await put('/api/strategy', next))
			populateConfiguration(configuration, 'strategy-form')
			actionStatus(strategyStatus, 'Saved')
		} catch (error) {
			actionStatus(strategyStatus, publicFailure(error, 'Could not save strategy. Review the fields and retry.'), true)
		} finally {
			setFormSubmitting('strategy-form', false)
			syncControls()
		}
	})
}
