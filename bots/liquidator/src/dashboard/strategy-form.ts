import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import { formIsSubmitting, setFormSubmitting } from '@zoltar/bot-shared/dashboard/form-state'
import { type Configuration, decodeConfiguration } from './api-validation.ts'
import type { ConfigurationSource } from './dashboard-configuration.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { actionStatus, put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { publicFailure } from './pool-presentation.ts'
import { parsePortfolioPolicy, serializePortfolioPolicy } from '../config/portfolio-policy.ts'
import { strategyReviewRows, validateStrategyReview, type StrategyUpdate } from './strategy-review.ts'

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
	for (const [name, value] of Object.entries({ ...configuration.strategy, ...configuration.portfolioPolicy })) setFormValue(form, name, value)
	setFormValue(form, 'logLookbackBlocks', configuration.runtime.logLookbackBlocks)
	setFormValue(form, 'historicalLogRecovery', configuration.runtime.historicalLogRecovery)
}

/** Names the automatic actions the saved strategy enables: what the running bot does, not what the form currently shows. */
export function enabledAutomaticActions(configuration: Configuration | undefined) {
	if (configuration === undefined) return undefined
	return configuration.portfolioPolicy['allowFundedTakeovers'] === true ? ['funded takeovers', 'earnings claims'] : []
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
	const target = healthPercent(strategyInput('targetHealthFactorBps'))
	elements.healthPolicyPreview.textContent = `Receiver health target ${target}; the on-chain target must match before a takeover.`
}

function readStrategyForm(form: HTMLFormElement): StrategyUpdate {
	const data = new FormData(form)
	const fields = Object.fromEntries(data.entries())
	return {
		maximumGasCostEth: String(data.get('maximumGasCostEth') ?? ''),
		walletReserveRep: String(data.get('walletReserveRep') ?? ''),
		logLookbackBlocks: Number(data.get('logLookbackBlocks')),
		historicalLogRecovery: checkboxChecked(form, 'historicalLogRecovery'),
		portfolioPolicy: serializePortfolioPolicy(
			parsePortfolioPolicy({
				...fields,
				allowFundedTakeovers: checkboxChecked(form, 'allowFundedTakeovers'),
				targetHealthFactorBps: Number(data.get('targetHealthFactorBps')),
				maximumPositionsPerScan: Number(data.get('maximumPositionsPerScan')),
				stalledRetirementSeconds: Number(data.get('stalledRetirementSeconds')),
			}),
		),
	}
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
		let next: StrategyUpdate
		try {
			next = readStrategyForm(strategyForm)
			validateStrategyReview(next)
		} catch (error) {
			actionStatus(strategyStatus, error instanceof Error ? error.message : 'Review the strategy values and retry.', true)
			return
		}
		// The submitting latch keeps the form locked across polls through the review and the request.
		setFormSubmitting('strategy-form', true)
		try {
			const changes = strategyReviewRows(savedConfiguration, next)
			if (changes.length > 0 && !(await confirmOperatorAction({ title: 'Review portfolio policy', description: 'Changes to amounts and automation apply on the next scan.', changes, confirmLabel: 'Save policy' }))) {
				actionStatus(strategyStatus, '')
				return
			}
			actionStatus(strategyStatus, 'Saving…')
			const configuration = decodeConfiguration(await put('/api/strategy', next))
			populateConfiguration(configuration, 'strategy-form')
			actionStatus(strategyStatus, 'Saved')
		} catch (error) {
			actionStatus(strategyStatus, publicFailure(error, 'Could not save portfolio policy. Review the fields and retry.'), true)
		} finally {
			setFormSubmitting('strategy-form', false)
			syncControls()
		}
	})
}
