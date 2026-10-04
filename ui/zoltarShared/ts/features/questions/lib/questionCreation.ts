import { sortStringArrayByKeccak } from '@zoltar/core-shared/serialization/sortStringArrayByKeccak'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import * as marketTypeCopy from '@zoltar/ui-core-shared/copy/marketType.js'
import { appendInvalidOutcomeLabelIfMissing } from '@zoltar/ui-core-shared/lib/outcomeLabels.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import type { MarketFormState } from '../../../types/app.js'
import type { QuestionData } from '@zoltar/ui-core-shared/types/contracts.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { ensureSentence } from '@zoltar/ui-core-shared/lib/errors.js'
import { parseTimestampInput, tryParseTimestampInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { parseScalarFormInputs } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
type MarketFormField = keyof Pick<MarketFormState, 'categoricalOutcomes' | 'endTime' | 'scalarIncrement' | 'scalarMax' | 'scalarMin' | 'startTime' | 'title'>
type MarketFormValidation = {
	fieldErrors: Partial<Record<MarketFormField, string>>
	isValid: boolean
	notice: string | undefined
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
		startTime: form.startTime.trim() === '' ? 0n : parseTimestampInput(form.startTime, marketCopy.startTime),
		endTime: parseTimestampInput(form.endTime, commonCopy.endTime),
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
	if (questionData.title === '') throw new Error('Title is required.')
	if (questionData.endTime <= questionData.startTime) throw new Error('End time must be after start time.')
	return questionData
}
function normalizeOutcomeLabel(label: string) {
	return label.trim()
}
function getMissingRequiredCategoricalOutcomeLabels(form: MarketFormState) {
	return [0, 1].filter(index => normalizeOutcomeLabel(form.categoricalOutcomes[index] ?? '') === '').map(index => zoltarCopy.formatUnnamedOutcome(index + 1))
}
function getRequiredCategoricalOutcomeMessage(missingOutcomeLabels: string[]) {
	if (missingOutcomeLabels.length === 1) return `${missingOutcomeLabels[0]} is required.`
	return `${missingOutcomeLabels.join(' and ')} are required.`
}
function getCategoricalOutcomeLabels(form: MarketFormState) {
	const missingRequiredOutcomeLabels = getMissingRequiredCategoricalOutcomeLabels(form)
	if (missingRequiredOutcomeLabels.length > 0) throw new Error(getRequiredCategoricalOutcomeMessage(missingRequiredOutcomeLabels))
	const outcomeLabels = form.categoricalOutcomes.map(normalizeOutcomeLabel).filter(label => label !== '')
	if (new Set(outcomeLabels).size !== outcomeLabels.length) throw new Error('Outcomes must be unique.')
	return sortStringArrayByKeccak(outcomeLabels)
}
function getOutcomeLabels(form: MarketFormState) {
	switch (form.marketType) {
		case 'binary':
			return [commonCopy.yes, commonCopy.no]
		case 'categorical':
			return getCategoricalOutcomeLabels(form)
		case 'scalar':
			return []
		default:
			return assertNever(form.marketType)
	}
}

function getMarketCreationOutcomeLabels(form: MarketFormState) {
	return getOutcomeLabels(form)
}

export function hasMarketEndTimePassed(form: MarketFormState, currentTimestamp: bigint | undefined) {
	if (currentTimestamp === undefined || form.endTime.trim() === '') return false
	const endTimestamp = tryParseTimestampInput(form.endTime)
	return endTimestamp !== undefined && endTimestamp <= currentTimestamp
}
function setFieldError(fieldErrors: Partial<Record<MarketFormField, string>>, field: MarketFormField, message: string) {
	if (fieldErrors[field] !== undefined) return
	fieldErrors[field] = message
}
function formatFieldList(fields: string[]) {
	return fields.join(', ')
}
function withoutTerminalPeriod(message: string) {
	return message.replace(/\.$/, '')
}
export function validateMarketForm(form: MarketFormState): MarketFormValidation {
	const fieldErrors: Partial<Record<MarketFormField, string>> = {}
	const missingFields: string[] = []
	const invalidMessages: string[] = []
	if (form.title.trim() === '') {
		setFieldError(fieldErrors, 'title', 'Title is required.')
		missingFields.push(marketCopy.title)
	}
	const startTime = form.startTime.trim()
	const endTime = form.endTime.trim()
	let parsedStartTime = 0n
	let parsedEndTime: bigint | undefined
	if (startTime !== '')
		try {
			parsedStartTime = parseTimestampInput(form.startTime, marketCopy.startTime)
		} catch (error) {
			const message = ensureSentence(error instanceof Error ? error.message : 'Start time is invalid.')
			setFieldError(fieldErrors, 'startTime', message)
			invalidMessages.push(message)
		}
	if (endTime === '') {
		setFieldError(fieldErrors, 'endTime', 'End time is required.')
		missingFields.push(commonCopy.endTime)
	} else {
		try {
			parsedEndTime = parseTimestampInput(form.endTime, commonCopy.endTime)
		} catch (error) {
			const message = ensureSentence(error instanceof Error ? error.message : 'End time is invalid.')
			setFieldError(fieldErrors, 'endTime', message)
			invalidMessages.push(message)
		}
	}
	if (parsedEndTime !== undefined && parsedEndTime <= parsedStartTime) {
		const message = 'End time must be after start time.'
		if (startTime !== '') setFieldError(fieldErrors, 'startTime', message)
		setFieldError(fieldErrors, 'endTime', message)
		invalidMessages.push(message)
	}
	if (form.marketType === 'categorical') {
		const missingRequiredOutcomeLabels = getMissingRequiredCategoricalOutcomeLabels(form)
		if (missingRequiredOutcomeLabels.length > 0) {
			setFieldError(fieldErrors, 'categoricalOutcomes', getRequiredCategoricalOutcomeMessage(missingRequiredOutcomeLabels))
			missingFields.push(...missingRequiredOutcomeLabels)
		} else {
			try {
				getCategoricalOutcomeLabels(form)
			} catch (error) {
				const message = ensureSentence(error instanceof Error ? error.message : 'Outcomes are invalid.')
				setFieldError(fieldErrors, 'categoricalOutcomes', message)
				invalidMessages.push(message)
			}
		}
	}
	if (form.marketType === 'scalar') {
		const scalarFields: Array<{
			key: 'scalarMin' | 'scalarMax' | 'scalarIncrement'
			label: string
		}> = [
			{ key: 'scalarMin', label: marketCopy.scalarMin },
			{ key: 'scalarMax', label: marketCopy.scalarMax },
			{ key: 'scalarIncrement', label: marketCopy.scalarIncrement },
		]
		const missingScalarFields = scalarFields.filter(field => form[field.key].trim() === '')
		for (const field of missingScalarFields) {
			setFieldError(fieldErrors, field.key, `${field.label} is required.`)
			missingFields.push(field.label)
		}
		if (missingScalarFields.length === 0)
			try {
				parseScalarFormInputs(form)
			} catch (error) {
				const message = ensureSentence(error instanceof Error ? error.message : 'Scalar inputs are invalid.')
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
	const noticeParts: string[] = []
	if (missingFields.length > 0) noticeParts.push(`Missing required fields: ${formatFieldList(missingFields)}.`)
	if (invalidMessages.length > 0) noticeParts.push(`Fix invalid fields: ${[...new Set(invalidMessages)].map(withoutTerminalPeriod).join(', ')}.`)
	return {
		fieldErrors,
		isValid: missingFields.length === 0 && invalidMessages.length === 0,
		notice: noticeParts.length === 0 ? undefined : noticeParts.join(' '),
	}
}
export function createQuestionParameters(form: MarketFormState) {
	return {
		marketType: form.marketType,
		outcomeLabels: getMarketCreationOutcomeLabels(form),
		questionData: createQuestionData(form),
	}
}

/** Outcome chips for the draft preview, matching how the created question lists its outcomes. */
export function getDraftOutcomeLabels(questionForm: MarketFormState, categoricalOutcomesError: string | undefined) {
	switch (questionForm.marketType) {
		case 'binary':
			return appendInvalidOutcomeLabelIfMissing(getMarketCreationOutcomeLabels(questionForm))
		case 'categorical': {
			if (categoricalOutcomesError === undefined) {
				return appendInvalidOutcomeLabelIfMissing(getMarketCreationOutcomeLabels(questionForm))
			}

			const normalizedOutcomes = questionForm.categoricalOutcomes.map(outcome => outcome.trim()).filter(outcome => outcome !== '')
			return appendInvalidOutcomeLabelIfMissing(normalizedOutcomes)
		}
		case 'scalar':
			// The created question's display names its scalar outcome the same way.
			return [marketTypeCopy.scalar, commonCopy.invalid]
		default:
			return assertNever(questionForm.marketType)
	}
}
