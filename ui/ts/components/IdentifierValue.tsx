import * as commonCopy from '../copy/common.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { CopyErrorMessage } from './CopyErrorMessage.js'

type IdentifierValueProps = {
	className?: string
	value: string
}

export function IdentifierValue({ className = '', value }: IdentifierValueProps) {
	const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(value)
	const classes = ['identifier-value', 'copyable', className].filter(Boolean).join(' ')

	return (
		<span className='copy-value-wrap'>
			<button className={classes} type='button' title={value} aria-label={commonCopy.formatCopyIdentifierValue(value)} aria-describedby={copyError.value === undefined ? undefined : copyErrorId} onClick={() => copyText(value)}>
				{copied.value ? commonCopy.copied : value}
			</button>
			<CopyErrorMessage id={copyErrorId} message={copyError.value} />
		</span>
	)
}
