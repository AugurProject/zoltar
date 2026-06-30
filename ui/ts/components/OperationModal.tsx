import { useId, useRef } from 'preact/hooks'
import { useModalFocusIsolation } from '../hooks/useModalFocusIsolation.js'
import type { OperationModalProps } from '../types/components.js'

export function OperationModal({ children, description, isOpen, onClose, title }: OperationModalProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	const closeButtonRef = useRef<HTMLButtonElement | null>(null)
	const titleId = useId()
	const descriptionElementId = useId()
	const descriptionId = description === undefined ? undefined : descriptionElementId

	useModalFocusIsolation({
		dialogRef,
		initialFocusRef: closeButtonRef,
		isOpen,
		onClose,
	})

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
