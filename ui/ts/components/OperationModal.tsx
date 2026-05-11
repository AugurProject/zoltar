import { useEffect, useRef } from 'preact/hooks'
import type { OperationModalProps } from '../types/components.js'

export function OperationModal({ children, description, isOpen, onClose, title }: OperationModalProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	const closeButtonRef = useRef<HTMLButtonElement | null>(null)
	const onCloseRef = useRef(onClose)

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
			const firstElement = focusableElements[0]
			const lastElement = focusableElements[focusableElements.length - 1]
			if (!(document.activeElement instanceof HTMLElement)) return
			if (event.shiftKey && document.activeElement === firstElement) {
				event.preventDefault()
				lastElement?.focus()
				return
			}
			if (!event.shiftKey && document.activeElement === lastElement) {
				event.preventDefault()
				firstElement?.focus()
			}
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
			<section ref={dialogRef} className='modal-panel operation-modal-panel' role='dialog' aria-modal='true' aria-labelledby='operation-modal-title' onClick={event => event.stopPropagation()}>
				<div className='modal-header'>
					<div>
						<h3 id='operation-modal-title'>{title}</h3>
					</div>
					<button ref={closeButtonRef} className='quiet' type='button' onClick={onClose}>
						Close
					</button>
				</div>
				{description === undefined ? undefined : <p className='detail'>{description}</p>}
				<div className='operation-modal-body'>{children}</div>
			</section>
		</div>
	)
}
