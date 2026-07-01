import { sameCaseInsensitiveText } from './caseInsensitive.js'

export function isInvalidOutcomeLabel(outcome: string) {
	return sameCaseInsensitiveText(outcome, 'invalid')
}

export function appendInvalidOutcomeLabelIfMissing(outcomes: readonly string[]) {
	return outcomes.some(isInvalidOutcomeLabel) ? [...outcomes] : [...outcomes, 'Invalid']
}
