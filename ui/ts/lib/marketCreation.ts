import { keccak256, toHex } from 'viem'
import type { MarketFormState, SecurityPoolFormState } from '../types/app.js'
import type { DeploymentStatus, QuestionData } from '../types/contracts.js'
import { parseBigIntInput, parseTimestampInput } from './marketForm.js'

export function hasDeployedStep(steps: DeploymentStatus[], stepId: DeploymentStatus['id']) {
	return steps.some(step => step.id === stepId && step.deployed)
}

function createQuestionData(form: MarketFormState): QuestionData {
	const marketType = form.marketType
	const questionData = {
		title: form.title.trim(),
		description: form.description.trim(),
		startTime: form.startTime.trim() === '' ? 0n : parseTimestampInput(form.startTime, 'Start time'),
		endTime: parseTimestampInput(form.endTime, 'End time'),
		numTicks: marketType === 'scalar' ? parseBigIntInput(form.numTicks, 'Number of ticks') : 0n,
		displayValueMin: marketType === 'scalar' ? parseBigIntInput(form.displayValueMin, 'Display value min') : 0n,
		displayValueMax: marketType === 'scalar' ? parseBigIntInput(form.displayValueMax, 'Display value max') : 0n,
		answerUnit: marketType === 'scalar' ? form.answerUnit.trim() : '',
	}

	if (questionData.title === '') throw new Error('Title is required')
	if (questionData.endTime <= questionData.startTime) throw new Error('End time must be after start time')
	if (marketType === 'scalar' && questionData.numTicks <= 1n) throw new Error('Number of ticks must be greater than 1')
	if (marketType === 'scalar' && questionData.displayValueMax <= questionData.displayValueMin) throw new Error('Display value max must be greater than display value min')

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
	if (form.marketType === 'binary') return ['Yes', 'No']
	if (form.marketType === 'scalar') return []
	return getCategoricalOutcomeLabels(form)
}

export function createMarketParameters(form: MarketFormState) {
	const marketType = form.marketType

	return {
		marketType,
		outcomeLabels: getOutcomeLabels(form),
		questionData: createQuestionData(form),
		currentRetentionRate: marketType === 'binary' ? parseBigIntInput(form.currentRetentionRate, 'Current retention rate') : null,
		securityMultiplier: marketType === 'binary' ? parseBigIntInput(form.securityMultiplier, 'Security multiplier') : null,
		startingRepEthPrice: marketType === 'binary' ? parseBigIntInput(form.startingRepEthPrice, 'Starting REP/ETH price') : parseBigIntInput(form.scalarStartValue, 'Initial scalar reference value'),
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
