import type { ComponentChildren } from 'preact'
import type { MutableRef } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import { shouldCloseOnBackdropClick } from '../lib/modalBackdrop.js'

type ModalFrameProps = {
	busy?: boolean
	children: ComponentChildren
	closeButtonRef: MutableRef<HTMLButtonElement | null>
	closeDisabled?: boolean
	describedBy?: string | undefined
	dialogRef: MutableRef<HTMLElement | null>
	/** Added to `modal-panel` on the dialog section. */
	panelClassName: string
	onClose: () => void
	/** Makes the dialog itself programmatically focusable. */
	focusable?: boolean
	title: ComponentChildren
	titleId: string
}

/** Backdrop, dialog panel, and title bar with a close control; a backdrop click closes only a dialog without form fields. */
export function ModalFrame({ busy = false, children, closeButtonRef, closeDisabled = false, describedBy, dialogRef, focusable = false, onClose, panelClassName, title, titleId }: ModalFrameProps) {
	return (
		<div
			className='modal-backdrop'
			role='presentation'
			onClick={() => {
				if (shouldCloseOnBackdropClick(dialogRef.current)) onClose()
			}}
		>
			<section ref={dialogRef} className={`modal-panel ${panelClassName}`} role='dialog' tabIndex={focusable ? -1 : undefined} aria-busy={busy || undefined} aria-modal='true' aria-labelledby={titleId} aria-describedby={describedBy} onClick={event => event.stopPropagation()}>
				<div className='modal-header'>
					<div className='modal-header-title'>
						<h3 id={titleId}>{title}</h3>
					</div>
					<button ref={closeButtonRef} className='quiet modal-close-button' type='button' aria-label={commonCopy.close} title={commonCopy.close} disabled={closeDisabled} onClick={onClose}>
						×
					</button>
				</div>
				{children}
			</section>
		</div>
	)
}
