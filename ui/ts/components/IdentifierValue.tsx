import * as commonCopy from '../copy/common.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'

type IdentifierValueProps = {
	className?: string
	value: string
}

export function IdentifierValue({ className = '', value }: IdentifierValueProps) {
	const { copied, copyText } = useCopyToClipboard()
	const classes = ['identifier-value', 'copyable', className].filter(Boolean).join(' ')

	return (
		<button className={classes} type='button' title={value} aria-label={commonCopy.formatCopyIdentifierValue(value)} onClick={() => copyText(value)}>
			{copied.value ? commonCopy.copied : value}
		</button>
	)
}
