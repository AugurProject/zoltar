import { useEffect, useRef } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import * as universeCopy from '../copy/universes.js'
import { formatUniverseLineageLabel, formatUniverseStepName, type UniverseLineageStep } from '../lib/universeLineage.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { UniverseLink } from './UniverseLink.js'

type UniverseSwitcherProps = {
	activeUniverseId: bigint
	/** Where the full universe browser lives; omitted when the application has no browser route. */
	browseHref?: string | undefined
	/** The loaded active universe; its lineage and deployed children are the switch targets. */
	universe: Pick<ZoltarUniverseSummary, 'childUniverses' | 'lineage' | 'universeId'> | undefined
}

/** Every ancestor of the active universe with its own lineage name; without a lineage only Genesis is known. */
function getAncestors(activeUniverseId: bigint, lineage: readonly UniverseLineageStep[] | undefined): readonly { label: string; universeId: bigint }[] {
	if (activeUniverseId === 0n) return []
	if (lineage === undefined) return [{ label: formatUniverseLineageLabel(undefined, 0n), universeId: 0n }]
	return lineage.flatMap((step, index) => (step.universeId === activeUniverseId ? [] : [{ label: formatUniverseLineageLabel(lineage.slice(0, index + 1), step.universeId), universeId: step.universeId }]))
}

/**
 * Compact header control naming the active universe by lineage. It opens a menu of the universe's ancestors and
 * deployed children plus a link to the full universe browser; choosing one changes the shared `universe` parameter.
 */
export function UniverseSwitcher({ activeUniverseId, browseHref, universe }: UniverseSwitcherProps) {
	const detailsRef = useRef<HTMLDetailsElement>(null)
	const loadedUniverse = universe?.universeId === activeUniverseId ? universe : undefined
	const universeLabel = formatUniverseLineageLabel(loadedUniverse?.lineage, activeUniverseId)
	const ancestors = getAncestors(activeUniverseId, loadedUniverse?.lineage)
	const deployedChildren = loadedUniverse?.childUniverses.filter(child => child.exists) ?? []
	// Attribute access keeps the disclosure state in sync in every DOM implementation.
	const close = () => detailsRef.current?.removeAttribute('open')

	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			const details = detailsRef.current
			if (details === null || !details.hasAttribute('open')) return
			if (event.target instanceof Node && details.contains(event.target)) return
			details.removeAttribute('open')
		}
		document.addEventListener('pointerdown', onPointerDown)
		return () => document.removeEventListener('pointerdown', onPointerDown)
	}, [])

	return (
		<details
			ref={detailsRef}
			className='universe-switcher'
			onKeyDown={event => {
				const details = detailsRef.current
				if (event.key !== 'Escape' || details === null || !details.hasAttribute('open')) return
				event.preventDefault()
				close()
				details.querySelector('summary')?.focus()
			}}
		>
			<summary aria-label={universeCopy.formatSwitcherAriaLabel(universeLabel)} title={universeLabel}>
				<span className='universe-switcher-label'>{universeLabel}</span>
				<span aria-hidden='true' className='universe-switcher-caret'>
					{universeCopy.switcherCaret}
				</span>
			</summary>
			<div className='universe-switcher-popover'>
				<p className='universe-switcher-heading'>{universeCopy.lineageTitle}</p>
				<ul className='universe-switcher-list'>
					{ancestors.map(ancestor => (
						<li key={ancestor.universeId.toString()}>
							<UniverseLink universeId={ancestor.universeId} onNavigate={close}>
								{ancestor.label}
							</UniverseLink>
						</li>
					))}
					<li>
						<span aria-current='location' className='universe-switcher-current'>
							{universeLabel} <span className='universe-switcher-current-tag'>{universeCopy.currentUniverse}</span>
						</span>
					</li>
				</ul>
				{loadedUniverse === undefined ? undefined : (
					<>
						<p className='universe-switcher-heading'>{commonCopy.childUniverses}</p>
						{deployedChildren.length === 0 ? (
							<p className='detail'>{universeCopy.noDeployedChildren}</p>
						) : (
							<ul className='universe-switcher-list'>
								{deployedChildren.map(child => (
									<li key={child.universeId.toString()}>
										<UniverseLink universeId={child.universeId} onNavigate={close}>
											{formatUniverseStepName({ outcomeLabel: child.outcomeLabel, universeId: child.universeId })}
										</UniverseLink>
									</li>
								))}
							</ul>
						)}
					</>
				)}
				{browseHref === undefined ? undefined : (
					<a className='button-link secondary-link universe-switcher-browse' href={browseHref} onClick={close}>
						{universeCopy.browseUniverses}
					</a>
				)}
			</div>
		</details>
	)
}
