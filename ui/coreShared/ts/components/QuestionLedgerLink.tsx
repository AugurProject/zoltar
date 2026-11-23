import type { ComponentChildren } from 'preact'
import * as commonCopy from '../copy/common.js'
import { AddressValue } from './AddressValue.js'

type QuestionLedgerLinkProps = {
	ariaLabel?: string | undefined
	children?: ComponentChildren
	className?: string | undefined
	disabled?: boolean
	href: string
	/** In-app navigation for unmodified primary clicks; modified clicks and new tabs still follow `href`. */
	onNavigate?: (() => void) | undefined
	questionLedgerAddress: string
}

/** Pool identity links to its explorer; the separate local link opens the pool's detail route. */
export function QuestionLedgerLink({ ariaLabel, children, className, disabled = false, href, onNavigate, questionLedgerAddress }: QuestionLedgerLinkProps) {
	const navigation = (
		<a
			aria-disabled={disabled ? 'true' : undefined}
			aria-label={ariaLabel}
			className={className === undefined ? 'question-ledger-link' : `question-ledger-link ${className}`}
			href={href}
			onClick={event => {
				if (disabled) {
					event.preventDefault()
					return
				}
				if (onNavigate === undefined || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
				event.preventDefault()
				onNavigate()
			}}
			title={questionLedgerAddress}
		>
			{children ?? commonCopy.openPool}
		</a>
	)
	if (children !== undefined && children !== null) return navigation
	return (
		<span className='question-ledger-navigation'>
			<AddressValue address={questionLedgerAddress} />
			{navigation}
		</span>
	)
}
