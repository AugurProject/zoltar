/**
 * A recovery form marks its fieldset while its request is in flight. Every state refresh recomputes the fieldset's
 * disabled state, and without the mark a refresh landing mid-request would re-enable the form for a second submission.
 */
export function setRecoveryFormSubmitting(fields: HTMLFieldSetElement, submitting: boolean) {
	if (submitting) {
		fields.dataset['submitting'] = 'true'
		fields.disabled = true
	} else delete fields.dataset['submitting']
}

export function recoveryFormSubmitting(fields: HTMLFieldSetElement) {
	return fields.dataset['submitting'] === 'true'
}
