import { useEffect, useId, useRef } from 'preact/hooks'
import type { OperationModalProps } from '../types/components.js'

export function OperationModal({ children, description, isOpen, onClose, title }: OperationModalProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	const closeButtonRef = useRef<HTMLButtonElement | null>(null)
	const onCloseRef = useRef(onClose)
	const titleId = useId()
	const descriptionElementId = useId()
	const descriptionId = description === undefined ? undefined : descriptionElementId

	useEffect(() => {
		onCloseRef.current = onClose
	}, [onClose])

	useEffect(() => {
		if (!isOpen) return
		const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
		closeButtonRef.current?.focus()
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onCloseRef.current()
			if (event.key !== 'Tab') return
			const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")
			if (focusableElements === undefined || focusableElements.length === 0) return
			const elements = Array.from(focusableElements)
			if (!(document.activeElement instanceof HTMLElement)) {
				elements[0]?.focus()
				return
			}

			const currentIndex = elements.indexOf(document.activeElement)
			if (currentIndex === -1) {
				elements[0]?.focus()
				return
			}

			if (event.shiftKey) {
				event.preventDefault()
				elements[(currentIndex - 1 + elements.length) % elements.length]?.focus()
				return
			}

			event.preventDefault()
			elements[(currentIndex + 1) % elements.length]?.focus()
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => {
			document.removeEventListener('keydown', handleKeyDown)
			previouslyFocusedElement?.focus()
		}
	}, [isOpen])

	if (!isOpen) return undefined

	return (
		<div className='modal-backdrop' role='presentation' onClick={onClose}>
			<section ref={dialogRef} className='modal-panel operation-modal-panel' role='dialog' aria-modal='true' aria-labelledby={titleId} aria-describedby={descriptionId} onClick={event => event.stopPropagation()}>
				<div className='modal-header'>
					<div className='modal-header-title'>
						<h3 id={titleId}>{title}</h3>
					</div>
					<button ref={closeButtonRef} className='quiet modal-close-button' type='button' aria-label='Close' title='Close' onClick={onClose}>
						×
					</button>
				</div>
				{description === undefined ? undefined : (
					<p id={descriptionId} className='detail'>
						{description}
					</p>
				)}
				<div className='operation-modal-body'>{children}</div>
			</section>
		</div>
	)
}
