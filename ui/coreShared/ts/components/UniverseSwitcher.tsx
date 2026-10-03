import { useEffect, useRef } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import * as universeCopy from '../copy/universes.js'
import { formatUniverseLineageLabel, formatUniverseStepName } from '../lib/universeLineage.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { UniverseIdentity } from './UniverseIdentity.js'
import { UniverseLink } from './UniverseLink.js'

type UniverseSwitcherProps = {
	activeUniverseId: bigint
	/** Where the full universe browser lives; omitted when the application has no browser route. */
	browseHref?: string | undefined
	/** The loaded active universe; its lineage and deployed children are the switch targets. */
	universe: Pick<ZoltarUniverseSummary, 'parentUniverseId' | 'outcomeLabel' | 'childUniverses' | 'hasForked' | 'lineage' | 'universeId' | 'relatedUniversesLoaded'> | undefined
}

/** Navigation follows one edge of the universe tree at a time. */
function getParent(universe: UniverseSwitcherProps['universe']): readonly { label: string; universeId: bigint }[] {
	if (universe === undefined || universe.universeId === 0n) return []
	const parentIndex = universe.lineage?.findIndex(step => step.universeId === universe.parentUniverseId) ?? -1
	let label = universe.parentUniverseId === 0n ? universeCopy.genesis : universeCopy.parentUniverse
	if (parentIndex >= 0) label = formatUniverseLineageLabel(universe.lineage?.slice(0, parentIndex + 1), universe.parentUniverseId)
	return [{ label, universeId: universe.parentUniverseId }]
}

/**
 * Compact header control naming the active universe by lineage. It opens a menu of the universe's parent and
 * deployed children plus a link to the full universe browser; choosing one changes the shared `universe` parameter.
 */
export function UniverseSwitcher({ activeUniverseId, browseHref, universe }: UniverseSwitcherProps) {
	const detailsRef = useRef<HTMLDetailsElement>(null)
	const loadedUniverse = universe?.universeId === activeUniverseId ? universe : undefined
	const lineageLabel = formatUniverseLineageLabel(loadedUniverse?.lineage, activeUniverseId)
	const universeLabel = loadedUniverse?.relatedUniversesLoaded === false ? loadedUniverse.outcomeLabel?.trim() || lineageLabel : lineageLabel
	const parents = getParent(loadedUniverse)
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
		window.addEventListener('hashchange', close)
		window.addEventListener('popstate', close)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown)
			window.removeEventListener('hashchange', close)
			window.removeEventListener('popstate', close)
		}
	}, [])

	useEffect(close, [activeUniverseId])

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
				<UniverseIdentity universeId={activeUniverseId} variant='swatch' />
				<span className='universe-switcher-label'>{universeLabel}</span>
				<span aria-hidden='true' className='universe-switcher-caret'>
					{universeCopy.switcherCaret}
				</span>
			</summary>
			<div className='universe-switcher-popover'>
				<p className='universe-switcher-heading'>{universeCopy.lineageTitle}</p>
				<ul className='universe-switcher-list'>
					{parents.map(parent => (
						<li key={parent.universeId.toString()}>
							<UniverseLink universeId={parent.universeId} onNavigate={close}>
								{parent.label}
							</UniverseLink>
						</li>
					))}
					<li>
						<span aria-current='location' className='universe-switcher-current'>
							{universeLabel} <span className='universe-switcher-current-tag'>{universeCopy.currentUniverse}</span>
						</span>
					</li>
				</ul>
				{/* Only a forked universe has children to switch to. */}
				{loadedUniverse === undefined || loadedUniverse.relatedUniversesLoaded === false || !loadedUniverse.hasForked ? undefined : (
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
