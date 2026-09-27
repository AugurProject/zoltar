import type { ComponentChildren } from 'preact'
import { formatUniverseIdHex, formatUniverseLabel } from '../lib/universeLabels.js'
import { formatUniverseLineageLabel } from '../lib/universeLineage.js'
import { getUniverseLinkHref, navigateToUniverse } from '../navigation/universeNavigation.js'
import { useUniverseName } from './UniverseNames.js'

type UniverseLinkProps = {
	children?: ComponentChildren
	className?: string
	format?: 'default' | 'hex'
	onNavigate?: () => void
	universeId: bigint
}

/** Link that switches the shared `universe` query parameter; it is named by lineage when the application knows it. */
export function UniverseLink({ children, className = '', format = 'default', onNavigate, universeId }: UniverseLinkProps) {
	const href = getUniverseLinkHref(universeId)
	const universeName = useUniverseName(universeId)
	const fullLabel = format === 'hex' ? formatUniverseIdHex(universeId) : formatUniverseLabel(universeId)
	const label = children ?? (format === 'hex' ? fullLabel : universeName)
	// A hex fallback is abbreviated visually; keep the complete ID as its accessible name.
	const isAbbreviatedFallback = children === undefined && format === 'default' && universeId !== 0n && universeName === formatUniverseLineageLabel(undefined, universeId) && universeName !== fullLabel
	const accessibleLabel = isAbbreviatedFallback ? fullLabel : undefined

	return (
		<a
			aria-label={accessibleLabel}
			className={`universe-link ${className}`.trim()}
			href={href}
			title={children === undefined && format === 'default' ? fullLabel : undefined}
			onClick={event => {
				if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
				event.preventDefault()
				onNavigate?.()
				navigateToUniverse(universeId)
			}}
		>
			{label}
		</a>
	)
}
