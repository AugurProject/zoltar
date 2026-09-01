import * as commonCopy from '../copy/common.js'
import { useState } from 'preact/hooks'

type InlineHintProps = {
	ariaLabel?: string
	id?: string
	message: string
}

export function InlineHint({ ariaLabel = commonCopy.moreInfo, id, message }: InlineHintProps) {
	const [open, setOpen] = useState(false)

	return (
		<span className='inline-hint'>
			<button aria-expanded={open} aria-label={ariaLabel} aria-controls={id} className='inline-hint-toggle' title={message} type='button' onClick={() => setOpen(current => !current)}>
				<span aria-hidden='true'>i</span>
			</button>
			{!open ? undefined : (
				<div className='inline-hint-popover' id={id} role='note'>
					{message}
				</div>
			)}
		</span>
	)
}
