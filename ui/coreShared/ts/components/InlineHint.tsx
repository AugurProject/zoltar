import * as commonCopy from '../copy/common.js'
import { useEffect, useRef, useState } from 'preact/hooks'

type InlineHintProps = {
	ariaLabel?: string
	id?: string
	message: string
}

export function InlineHint({ ariaLabel = commonCopy.moreInfo, id, message }: InlineHintProps) {
	const [open, setOpen] = useState(false)
	const containerRef = useRef<HTMLSpanElement>(null)
	const popoverRef = useRef<HTMLDivElement>(null)
	const [alignment, setAlignment] = useState<'left' | 'right'>('right')
	const [popoverStyle, setPopoverStyle] = useState<{ bottom?: string; left?: string; right?: string; top?: string; width?: string } | undefined>(undefined)

	useEffect(() => {
		if (!open) return
		const updatePosition = () => {
			const buttonRect = containerRef.current?.getBoundingClientRect()
			if (buttonRect === undefined) return
			setAlignment(buttonRect.left < window.innerWidth / 2 ? 'left' : 'right')
			if (window.innerWidth > 480) {
				setPopoverStyle(undefined)
				return
			}
			const maxWidth = Math.min(352, window.innerWidth - 32)
			const nextLeft = Math.min(Math.max(16, buttonRect.left), window.innerWidth - maxWidth - 16)
			setPopoverStyle({
				left: `${nextLeft}px`,
				top: '16px',
				width: `${maxWidth}px`,
			})
		}
		const handlePointerDown = (event: PointerEvent | MouseEvent) => {
			if (containerRef.current?.contains(event.target as Node)) return
			setOpen(false)
		}
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			setOpen(false)
		}
		const handleLayoutChange = () => updatePosition()
		updatePosition()
		const frameId = window.requestAnimationFrame(updatePosition)
		window.addEventListener('resize', handleLayoutChange)
		window.addEventListener('scroll', handleLayoutChange, true)
		document.addEventListener('pointerdown', handlePointerDown)
		document.addEventListener('keydown', handleEscape)
		return () => {
			window.cancelAnimationFrame(frameId)
			window.removeEventListener('resize', handleLayoutChange)
			window.removeEventListener('scroll', handleLayoutChange, true)
			document.removeEventListener('pointerdown', handlePointerDown)
			document.removeEventListener('keydown', handleEscape)
		}
	}, [open])

	return (
		<span className={`inline-hint ${open ? 'is-open' : ''}`.trim()} data-align={alignment} ref={containerRef}>
			<button aria-expanded={open} aria-label={ariaLabel} aria-controls={id} className='inline-hint-toggle' title={message} type='button' onClick={() => setOpen(current => !current)}>
				<span aria-hidden='true'>i</span>
			</button>
			{!open ? undefined : (
				<div className='inline-hint-popover' id={id} ref={popoverRef} role='note' style={popoverStyle}>
					{message}
				</div>
			)}
		</span>
	)
}
