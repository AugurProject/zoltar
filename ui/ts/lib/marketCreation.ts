import { keccak256, toHex } from 'viem'
import type { MarketFormState, SecurityPoolFormState } from '../types/app.js'
import type { DeploymentStatus, MarketType, QuestionData } from '../types/contracts.js'
import { assertNever } from './assert.js'
import { parseBigIntInput, parseTimestampInput } from './marketForm.js'

export function hasDeployedStep(steps: DeploymentStatus[], stepId: DeploymentStatus['id']) {
	return steps.some(step => step.id === stepId && step.deployed)
}

function getScalarQuestionData(form: MarketFormState) {
	return {
		answerUnit: form.answerUnit.trim(),
		displayValueMax: parseBigIntInput(form.displayValueMax, 'Display value max'),
		displayValueMin: parseBigIntInput(form.displayValueMin, 'Display value min'),
		numTicks: parseBigIntInput(form.numTicks, 'Number of ticks'),
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
	if (form.marketType === 'scalar' && questionData.numTicks <= 1n) throw new Error('Number of ticks must be greater than 1')
	if (form.marketType === 'scalar' && questionData.displayValueMax <= questionData.displayValueMin) throw new Error('Display value max must be greater than display value min')

	return questionData
}

function normalizeOutcomeLabel(label: string) {
	return label.trim()
}

function compareOutcomeLabels(left: string, right: string) {
	const leftHash = keccak256(toHex(left))
	const rightHash = keccak256(toHex(right))
	return leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : 0
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

function getMarketSpecificParameters(form: MarketFormState, marketType: MarketType) {
	switch (marketType) {
		case 'binary':
			return {
				currentRetentionRate: parseBigIntInput(form.currentRetentionRate, 'Current retention rate'),
				securityMultiplier: parseBigIntInput(form.securityMultiplier, 'Security multiplier'),
				startingRepEthPrice: parseBigIntInput(form.startingRepEthPrice, 'Starting REP/ETH price'),
			}
		case 'categorical':
			return {
				currentRetentionRate: undefined,
				securityMultiplier: undefined,
				startingRepEthPrice: parseBigIntInput(form.scalarStartValue, 'Initial scalar reference value'),
			}
		case 'scalar':
			return {
				currentRetentionRate: undefined,
				securityMultiplier: undefined,
				startingRepEthPrice: parseBigIntInput(form.scalarStartValue, 'Initial scalar reference value'),
			}
		default:
			return assertNever(marketType)
	}
}

export function createMarketParameters(form: MarketFormState) {
	const marketSpecificParameters = getMarketSpecificParameters(form, form.marketType)

	return {
		marketType: form.marketType,
		outcomeLabels: getOutcomeLabels(form),
		questionData: createQuestionData(form),
		...marketSpecificParameters,
	}
}

function parseQuestionIdInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error('Market ID is required')

	try {
		return BigInt(trimmed)
	} catch {
		throw new Error('Market ID must be a valid decimal or hex bigint')
	}
}

export function createSecurityPoolParameters(form: SecurityPoolFormState) {
	return {
		currentRetentionRate: parseBigIntInput(form.currentRetentionRate, 'Current retention rate'),
		questionId: parseQuestionIdInput(form.marketId),
		securityMultiplier: parseBigIntInput(form.securityMultiplier, 'Security multiplier'),
		startingRepEthPrice: parseBigIntInput(form.startingRepEthPrice, 'Starting REP/ETH price'),
	}
}
