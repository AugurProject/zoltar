import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js';
export function isInvalidOutcomeLabel(outcome) {
    return sameCaseInsensitiveText(outcome, 'invalid');
}
export function appendInvalidOutcomeLabelIfMissing(outcomes) {
    return outcomes.some(isInvalidOutcomeLabel) ? [...outcomes] : [...outcomes, 'Invalid'];
}
//# sourceMappingURL=outcomeLabels.js.map