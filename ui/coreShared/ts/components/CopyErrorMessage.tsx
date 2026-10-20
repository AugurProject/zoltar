import * as commonCopy from '../copy/common.js'

type CopyErrorMessageProps = {
	id: string
	manualValue?: string
	message: string | undefined
}

function selectManualValue(element: HTMLElement) {
	const selection = window.getSelection()
	if (selection === null) return
	const range = document.createRange()
	range.selectNodeContents(element)
	selection.removeAllRanges()
	selection.addRange(range)
}

export function CopyErrorMessage({ id, manualValue, message }: CopyErrorMessageProps) {
	if (message === undefined) return undefined

	return (
		<span className='copy-error-recovery-wrap'>
			<span className='visually-hidden' id={id} role='alert' aria-live='assertive'>
				{message}
			</span>
			<details className='copy-error-recovery'>
				<summary>{commonCopy.copyUnavailable}</summary>
				<span className='copy-error-recovery-panel'>
					<span className='copy-error-message'>{message}</span>
					{/* A text control remains selectable when transaction fieldsets disable native inputs. */}
					{manualValue === undefined ? undefined : (
						<span
							role='textbox'
							aria-readonly='true'
							aria-label={commonCopy.manualCopyValue}
							className='copy-manual-value'
							tabIndex={0}
							onFocus={event => selectManualValue(event.currentTarget)}
							onKeyDown={event => {
								if (event.key.toLowerCase() !== 'a' || (!event.ctrlKey && !event.metaKey)) return
								event.preventDefault()
								selectManualValue(event.currentTarget)
							}}
						>
							{manualValue}
						</span>
					)}
				</span>
			</details>
		</span>
	)
}
