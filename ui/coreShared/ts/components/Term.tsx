import type { ComponentChildren } from 'preact'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'

export type TermDefinition = {
	definition: string
	href: string
	label: string
}

type TermProps = TermDefinition & {
	/** Visible text when the sentence uses a different form of the term, such as a plural. */
	children?: ComponentChildren
}

const VIEWPORT_MARGIN_PX = 8

/** Horizontal shift that keeps a popover inside the viewport, preferring its natural start edge. */
export function getTermPopoverShift(popoverLeft: number, popoverWidth: number, viewportWidth: number) {
	const overflowRight = popoverLeft + popoverWidth - (viewportWidth - VIEWPORT_MARGIN_PX)
	const shiftLeft = overflowRight > 0 ? -overflowRight : 0
	const shiftedLeft = popoverLeft + shiftLeft
	return shiftedLeft < VIEWPORT_MARGIN_PX ? VIEWPORT_MARGIN_PX - popoverLeft : shiftLeft
}

/** Inline glossary term: a disclosure button that reveals a short definition and a link to the protocol documentation. */
export function Term({ children, definition, href, label }: TermProps) {
	const [open, setOpen] = useState(false)
	const [shift, setShift] = useState(0)
	const shiftRef = useRef(0)
	const rootRef = useRef<HTMLSpanElement>(null)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const popoverRef = useRef<HTMLSpanElement>(null)
	const popoverId = useId()

	// A reused instance that now describes another term starts closed, so a definition never carries over to a different sentence or route.
	useLayoutEffect(() => {
		setOpen(false)
	}, [href, label])

	useLayoutEffect(() => {
		const popover = popoverRef.current
		if (!open || popover === null) {
			shiftRef.current = 0
			setShift(0)
			return
		}
		const keepInViewport = () => {
			const bounds = popover.getBoundingClientRect()
			// Measure from the unshifted position so repeated measurements (for example after a resize) do not compound.
			const nextShift = getTermPopoverShift(bounds.left - shiftRef.current, bounds.width, document.documentElement.clientWidth)
			shiftRef.current = nextShift
			setShift(nextShift)
		}
		keepInViewport()
		window.addEventListener('resize', keepInViewport)
		return () => window.removeEventListener('resize', keepInViewport)
	}, [open])

	useEffect(() => {
		if (!open) return
		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
			setOpen(false)
		}
		document.addEventListener('pointerdown', closeOnOutsidePointer)
		return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
	}, [open])

	const closeOnEscape = (event: KeyboardEvent) => {
		if (!open || event.key !== 'Escape') return
		// Escape dismisses only the definition, not an enclosing dialog.
		event.stopPropagation()
		setOpen(false)
		buttonRef.current?.focus()
	}

	const closeWhenFocusLeaves = (event: FocusEvent) => {
		if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
		setOpen(false)
	}

	return (
		<span className='term' ref={rootRef} onKeyDown={closeOnEscape} onFocusOut={closeWhenFocusLeaves}>
			<button ref={buttonRef} type='button' className='term-trigger' aria-expanded={open} aria-controls={popoverId} onClick={() => setOpen(!open)}>
				{children ?? label}
			</button>
			<span ref={popoverRef} id={popoverId} className='term-popover' hidden={!open} tabIndex={-1} style={shift === 0 ? undefined : { transform: `translateX(${shift.toString()}px)` }}>
				<strong className='term-popover-label'>{label}</strong>
				<span className='term-popover-definition'>{definition}</span>
				<a className='term-popover-link' href={href} target='_blank' rel='noreferrer'>
					{commonCopy.readMoreInGuide}
				</a>
			</span>
		</span>
	)
}
