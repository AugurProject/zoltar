import { useEffect, useId, useRef, useState } from 'preact/hooks'

/**
 * State for a non-modal disclosure popover anchored to a trigger button: outside clicks and focus leaving the
 * container close it, and Escape closes it and returns focus to the trigger.
 */
export function useDisclosurePopover() {
	const [open, setOpen] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelId = useId()

	useEffect(() => {
		if (!open) return
		const closeOnOutsidePointer = (event: MouseEvent) => {
			if (event.target instanceof Node && containerRef.current?.contains(event.target) !== true) setOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			setOpen(false)
			triggerRef.current?.focus()
		}
		const closeOnFocusOutside = (event: FocusEvent) => {
			if (event.target instanceof Node && containerRef.current?.contains(event.target) !== true) setOpen(false)
		}
		document.addEventListener('mousedown', closeOnOutsidePointer)
		document.addEventListener('keydown', closeOnEscape)
		document.addEventListener('focusin', closeOnFocusOutside)
		return () => {
			document.removeEventListener('mousedown', closeOnOutsidePointer)
			document.removeEventListener('keydown', closeOnEscape)
			document.removeEventListener('focusin', closeOnFocusOutside)
		}
	}, [open])

	return {
		close: () => setOpen(false),
		containerRef,
		open,
		panelId,
		toggle: () => setOpen(current => !current),
		triggerProps: { 'aria-controls': panelId, 'aria-expanded': open, ref: triggerRef, type: 'button' as const },
	}
}
