import type { ComponentChildren } from 'preact'
import { formatUniverseIdHex, formatUniverseLabel, getUniverseLinkHref, navigateToUniverse } from '../lib/universe.js'

type UniverseLinkProps = {
	children?: ComponentChildren
	className?: string
	format?: 'default' | 'hex'
	universeId: bigint
}

export function UniverseLink({ children, className = '', format = 'default', universeId }: UniverseLinkProps) {
	const href = getUniverseLinkHref(universeId)
	const label = children ?? (format === 'hex' ? formatUniverseIdHex(universeId) : formatUniverseLabel(universeId))

	return (
		<a
			className={`universe-link ${className}`}
			href={href}
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
