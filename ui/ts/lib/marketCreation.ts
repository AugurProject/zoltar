import { encodeAbiParameters, keccak256 } from 'viem'
import type { MarketFormState, SecurityPoolFormState } from '../types/app.js'
import type { DeploymentStatus, QuestionData } from '../types/contracts.js'
import { assertNever } from './assert.js'
import { parseBigIntInput, parseTimestampInput } from './marketForm.js'
import { parseOpenInterestFeePerYearPercentInput } from './retentionRate.js'
import { parseScalarFormInputs } from './scalarOutcome.js'

type MarketFormField = keyof Pick<MarketFormState, 'categoricalOutcomes' | 'endTime' | 'scalarIncrement' | 'scalarMax' | 'scalarMin' | 'startTime' | 'title'>

type MarketFormValidation = {
	fieldErrors: Partial<Record<MarketFormField, string>>
	isValid: boolean
	notice: string | undefined
}

export function hasDeployedStep(steps: DeploymentStatus[], stepId: DeploymentStatus['id']) {
	return steps.some(step => step.id === stepId && step.deployed)
}

function getScalarQuestionData(form: MarketFormState) {
	return {
		answerUnit: form.answerUnit.trim(),
		...parseScalarFormInputs(form),
	}
}

function createQuestionData(form: MarketFormState): QuestionData {
	const questionData = {
		title: form.title.trim(),
		description: form.description.trim(),
		startTime: form.startTime.trim() === '' ? 0n : parseTimestampInput(form.startTime, 'Start time'),
		endTime: parseTimestampInput(form.endTime, 'End time'),
		numTicks: 0n,
		displayValueMin: 0n,
		displayValueMax: 0n,
		answerUnit: '',
	}

	switch (form.marketType) {
		case 'binary':
		case 'categorical':
			break
		case 'scalar': {
			const scalarQuestionData = getScalarQuestionData(form)
			questionData.numTicks = scalarQuestionData.numTicks
			questionData.displayValueMin = scalarQuestionData.displayValueMin
			questionData.displayValueMax = scalarQuestionData.displayValueMax
			questionData.answerUnit = scalarQuestionData.answerUnit
			break
		}
		default:
			assertNever(form.marketType)
	}

	if (questionData.title === '') throw new Error('Title is required')
	if (questionData.endTime <= questionData.startTime) throw new Error('End time must be after start time')

	return questionData
}

function normalizeOutcomeLabel(label: string) {
	return label.trim()
}

function getOutcomeLabelHash(label: string) {
	return keccak256(encodeAbiParameters([{ type: 'string' }], [label]))
}

function compareOutcomeLabels(left: string, right: string) {
	const leftHash = getOutcomeLabelHash(left)
	const rightHash = getOutcomeLabelHash(right)
	return leftHash > rightHash ? -1 : leftHash < rightHash ? 1 : 0
}

function getCategoricalOutcomeLabels(form: MarketFormState) {
	const outcomeLabels = form.categoricalOutcomes
		.split('\n')
		.map(normalizeOutcomeLabel)
		.filter(label => label !== '')

	if (outcomeLabels.length < 2) throw new Error('Categorical markets require at least 2 outcome labels')
	if (new Set(outcomeLabels).size !== outcomeLabels.length) throw new Error('Outcome labels must be unique')

	return [...outcomeLabels].sort(compareOutcomeLabels)
}

function getOutcomeLabels(form: MarketFormState) {
	switch (form.marketType) {
		case 'binary':
			return ['Yes', 'No']
		case 'categorical':
			return getCategoricalOutcomeLabels(form)
		case 'scalar':
			return []
		default:
			return assertNever(form.marketType)
	}
}

function setFieldError(fieldErrors: Partial<Record<MarketFormField, string>>, field: MarketFormField, message: string) {
	if (fieldErrors[field] !== undefined) return
	fieldErrors[field] = message
}

function formatFieldList(fields: string[]) {
	return fields.join(', ')
}

export function validateMarketForm(form: MarketFormState): MarketFormValidation {
	const fieldErrors: Partial<Record<MarketFormField, string>> = {}
	const missingFields: string[] = []
	const invalidMessages: string[] = []

	if (form.title.trim() === '') {
		setFieldError(fieldErrors, 'title', 'Title is required')
		missingFields.push('Title')
	}

	const startTime = form.startTime.trim()
	const endTime = form.endTime.trim()
	let parsedStartTime: bigint | undefined
	let parsedEndTime: bigint | undefined

	if (startTime !== '') {
		try {
			parsedStartTime = parseTimestampInput(form.startTime, 'Start time')
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Start time is invalid'
			setFieldError(fieldErrors, 'startTime', message)
			invalidMessages.push(message)
		}
	}

	if (endTime === '') {
		setFieldError(fieldErrors, 'endTime', 'End time is required')
		missingFields.push('End Time')
	} else {
		try {
			parsedEndTime = parseTimestampInput(form.endTime, 'End time')
		} catch (error) {
			const message = error instanceof Error ? error.message : 'End time is invalid'
			setFieldError(fieldErrors, 'endTime', message)
			invalidMessages.push(message)
		}
	}

	if (parsedEndTime !== undefined && parsedStartTime !== undefined && parsedEndTime <= parsedStartTime) {
		const message = 'End time must be after start time'
		setFieldError(fieldErrors, 'startTime', message)
		setFieldError(fieldErrors, 'endTime', message)
		invalidMessages.push(message)
	}

	if (form.marketType === 'categorical') {
		const normalizedOutcomeLabels = form.categoricalOutcomes
			.split('\n')
			.map(normalizeOutcomeLabel)
			.filter(label => label !== '')

		if (normalizedOutcomeLabels.length === 0) {
			setFieldError(fieldErrors, 'categoricalOutcomes', 'Outcome labels are required')
			missingFields.push('Outcome Labels')
		} else {
			try {
				getCategoricalOutcomeLabels(form)
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Outcome labels are invalid'
				setFieldError(fieldErrors, 'categoricalOutcomes', message)
				invalidMessages.push(message)
			}
		}
	}

	if (form.marketType === 'scalar') {
		const scalarFields: Array<{ key: 'scalarMin' | 'scalarMax' | 'scalarIncrement'; label: string }> = [
			{ key: 'scalarMin', label: 'Scalar Min' },
			{ key: 'scalarMax', label: 'Scalar Max' },
			{ key: 'scalarIncrement', label: 'Scalar Increment' },
		]

		const missingScalarFields = scalarFields.filter(field => form[field.key].trim() === '')
		for (const field of missingScalarFields) {
			setFieldError(fieldErrors, field.key, `${field.label} is required`)
			missingFields.push(field.label)
		}

		if (missingScalarFields.length === 0) {
			try {
				parseScalarFormInputs(form)
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Scalar inputs are invalid'
				if (message.includes('Scalar increment')) {
					setFieldError(fieldErrors, 'scalarIncrement', message)
				} else if (message.includes('Scalar max must be greater than scalar min')) {
					setFieldError(fieldErrors, 'scalarMin', message)
					setFieldError(fieldErrors, 'scalarMax', message)
				} else {
					setFieldError(fieldErrors, 'scalarMin', message)
					setFieldError(fieldErrors, 'scalarMax', message)
					setFieldError(fieldErrors, 'scalarIncrement', message)
				}
				invalidMessages.push(message)
			}
		}
	}

	const noticeParts: string[] = []
	if (missingFields.length > 0) noticeParts.push(`Missing required fields: ${formatFieldList(missingFields)}`)
	if (invalidMessages.length > 0) noticeParts.push(`Fix invalid fields: ${[...new Set(invalidMessages)].join(', ')}`)

	return {
		fieldErrors,
		isValid: missingFields.length === 0 && invalidMessages.length === 0,
		notice: noticeParts.length === 0 ? undefined : noticeParts.join('. '),
	}
}

export function createMarketParameters(form: MarketFormState) {
	return {
		marketType: form.marketType,
		outcomeLabels: getOutcomeLabels(form),
		questionData: createQuestionData(form),
	}
}

function parseQuestionIdInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error('Question ID is required')

	try {
		return BigInt(trimmed)
	} catch {
		throw new Error('Question ID must be a valid decimal or hex bigint')
	}
}

export function createSecurityPoolParameters(form: SecurityPoolFormState) {
	return {
		currentRetentionRate: parseOpenInterestFeePerYearPercentInput(form.currentRetentionRate, 'Open interest fee per year'),
		questionId: parseQuestionIdInput(form.marketId),
		securityMultiplier: parseBigIntInput(form.securityMultiplier, 'Security multiplier'),
		startingRepEthPrice: parseBigIntInput(form.startingRepEthPrice, 'Starting REP/ETH price'),
	}
}
