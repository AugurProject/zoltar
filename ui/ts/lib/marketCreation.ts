import type { MarketFormState } from '../types/app.js'
import type { DeploymentStatus, QuestionData } from '../types/contracts.js'
import { parseBigIntInput, parseTimestampInput } from './marketForm.js'

export function hasDeployedStep(steps: DeploymentStatus[], stepId: DeploymentStatus['id']) {
	return steps.some(step => step.id === stepId && step.deployed)
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

	if (questionData.title === '') throw new Error('Title is required')
	if (questionData.endTime <= questionData.startTime) throw new Error('End time must be after start time')

	return questionData
}

export function createMarketParameters(form: MarketFormState) {
	return {
		questionData: createQuestionData(form),
		securityMultiplier: parseBigIntInput(form.securityMultiplier, 'Security multiplier'),
		currentRetentionRate: parseBigIntInput(form.currentRetentionRate, 'Current retention rate'),
		startingRepEthPrice: parseBigIntInput(form.startingRepEthPrice, 'Starting REP/ETH price'),
	}
}
