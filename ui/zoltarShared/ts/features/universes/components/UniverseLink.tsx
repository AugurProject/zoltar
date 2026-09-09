import type { ComponentChildren } from 'preact'
import { formatUniverseDisplayLabel, formatUniverseIdHex, formatUniverseLabel, getUniverseLinkHref, navigateToUniverse } from '../lib/universe.js'

type UniverseLinkProps = {
	children?: ComponentChildren
	className?: string
	format?: 'default' | 'hex'
	universeId: bigint
}

export function UniverseLink({ children, className = '', format = 'default', universeId }: UniverseLinkProps) {
	const href = getUniverseLinkHref(universeId)
	const fullLabel = format === 'hex' ? formatUniverseIdHex(universeId) : formatUniverseLabel(universeId)
	const label = children ?? (format === 'hex' ? fullLabel : formatUniverseDisplayLabel(universeId))
	const accessibleLabel = children === undefined && label !== fullLabel ? fullLabel : undefined

	return (
		<a
			aria-label={accessibleLabel}
			className={`universe-link ${className}`}
			href={href}
			title={accessibleLabel}
			onClick={event => {
				if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
				event.preventDefault()
				navigateToUniverse(universeId)
			}}
		>
			{label}
		</a>
	)
}
