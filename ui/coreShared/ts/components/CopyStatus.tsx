/** Glyph inside a copy button so the value reads as a copy action on touch screens; it turns into a check while the copy confirmation shows. */
export function CopyGlyph() {
	return <span aria-hidden='true' className='copy-glyph' />
}

/**
 * Always-mounted polite live region beside a copy button. The button keeps its value, width, and accessible name while
 * the confirmation appears here, and the region exists before its text changes so screen readers announce it. It has no
 * status role, so the many idle copy regions on a page are not listed as status landmarks.
 */
export function CopyStatus({ copied, message }: { copied: boolean; message: string }) {
	return (
		<span aria-live='polite' className='copy-feedback'>
			{copied ? message : undefined}
		</span>
	)
}
