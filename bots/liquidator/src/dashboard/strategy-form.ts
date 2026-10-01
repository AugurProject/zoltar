import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import { type Configuration, decodeConfiguration } from './api-validation.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { actionStatus, put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { publicFailure } from './pool-presentation.ts'
import { strategyReviewRows, validateStrategyReview } from './strategy-review.ts'

const AUTOMATIC_ACTIONS = ['allowAutomaticDeposits', 'allowAutomaticPoolCreation', 'allowAutomaticVaultMigrations', 'allowAutomaticWithdrawals']
const NUMERIC_STRATEGY_FIELDS = ['stalePriceFundingBufferBps', 'stagedOperationValidForSeconds', 'vaultTargetHealthBps', 'vaultTopUpHealthBps', 'vaultWithdrawHealthBps']

type StrategyFormContext = {
	state: DashboardState
	elements: DashboardElements
	populateConfiguration: (configuration: Configuration) => void
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

/** Counts the automatic actions the strategy form currently enables. */
export function enabledAutomaticActionCount(elements: DashboardElements) {
	return AUTOMATIC_ACTIONS.filter(name => checkboxChecked(elements.strategyForm, name)).length
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
	for (const name of AUTOMATIC_ACTIONS) next[name] = checkboxChecked(form, name)
	next['logLookbackBlocks'] = Number(data.get('logLookbackBlocks'))
	next['historicalLogRecovery'] = checkboxChecked(form, 'historicalLogRecovery')
	return next
}

/** Keeps the health preview in step with each strategy edit. */
export function registerStrategyPreview(elements: DashboardElements) {
	elements.strategyForm.addEventListener('input', () => updateHealthPolicyPreview(elements))
}

/** Saves the strategy form after validating it and confirming the reviewed changes. */
export function registerStrategyForm({ state, elements, populateConfiguration }: StrategyFormContext) {
	const { strategyForm, strategyStatus } = elements
	strategyForm.addEventListener('submit', async event => {
		event.preventDefault()
		if (state.configuration === undefined) return
		const savedConfiguration = state.configuration
		strategyStatus.textContent = 'Saving…'
		const next = readStrategyForm(strategyForm, savedConfiguration)
		try {
			validateStrategyReview(savedConfiguration, next)
		} catch (error) {
			actionStatus(strategyStatus, error instanceof Error ? error.message : 'Review the strategy values and retry.', true)
			return
		}
		try {
			const changes = strategyReviewRows(savedConfiguration, next)
			if (changes.length > 0 && !(await confirmOperatorAction({ title: 'Review liquidation strategy', description: 'Changes to amounts and automation apply on the next scan.', changes, confirmLabel: 'Save strategy' }))) {
				actionStatus(strategyStatus, '')
				return
			}
			const configuration = decodeConfiguration(await put('/api/strategy', next))
			populateConfiguration(configuration)
			actionStatus(strategyStatus, 'Saved')
		} catch (error) {
			actionStatus(strategyStatus, publicFailure(error, 'Could not save strategy. Review the fields and retry.'), true)
		}
	})
}
