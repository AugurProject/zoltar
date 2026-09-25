const FORM_FIELD_SELECTOR = 'input:not([type="hidden"]), select, textarea'

/** A backdrop click dismisses only a dialog without form fields, so a stray click outside cannot discard entered values; Escape and the close button still close every dialog. */
export function shouldCloseOnBackdropClick(dialog: Element | null) {
	return dialog !== null && dialog.querySelector(FORM_FIELD_SELECTOR) === null
}
