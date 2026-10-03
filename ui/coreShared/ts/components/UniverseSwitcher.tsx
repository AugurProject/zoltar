import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import * as universeCopy from '../copy/universes.js'
import { formatUniverseLineageLabel, formatUniverseStepName, formatUniverseViewLabel } from '../lib/universeLineage.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { UniverseIdentity } from './UniverseIdentity.js'
import { UniverseLink } from './UniverseLink.js'

type UniverseSwitcherProps = {
	activeUniverseId: bigint
	/** The view scope, independent of whether migration details remain cached. */
	includeRelatedUniverses?: boolean
	/** Where the full universe browser lives; omitted when the application has no browser route. */
	browseHref?: string | undefined
	/** The loaded active universe; its lineage and deployed children are the switch targets. */
	universe: Pick<ZoltarUniverseSummary, 'parentUniverseId' | 'outcomeLabel' | 'childUniverses' | 'hasForked' | 'lineage' | 'universeId' | 'relatedUniversesLoaded'> | undefined
}

/** Fit the disclosure to the visible viewport while keeping it beside its trigger. */
function positionPopover(details: HTMLDetailsElement | null) {
	if (details === null || !details.hasAttribute('open')) return
	const summary = details.querySelector('summary')
	const popover = details.querySelector('.universe-switcher-popover')
	if (!(summary instanceof HTMLElement) || !(popover instanceof HTMLElement)) return
	const viewport = window.visualViewport
	const viewportLeft = viewport?.offsetLeft ?? 0
	const viewportTop = viewport?.offsetTop ?? 0
	const viewportWidth = viewport?.width ?? window.innerWidth
	const viewportHeight = viewport?.height ?? window.innerHeight
	const margin = 12
	const gap = 8
	const leftEdge = viewportLeft + margin
	const topEdge = viewportTop + margin
	const rightEdge = viewportLeft + viewportWidth - margin
	const bottomEdge = viewportTop + viewportHeight - margin
	const trigger = summary.getBoundingClientRect()
	const availableWidth = Math.max(0, viewportWidth - 2 * margin)
	popover.style.minWidth = `min(16rem, ${availableWidth}px)`
	popover.style.maxWidth = `${availableWidth}px`
	const width = popover.getBoundingClientRect().width
	popover.style.left = `${Math.max(leftEdge, Math.min(trigger.right - width, rightEdge - width))}px`
	const belowTop = Math.max(topEdge, Math.min(trigger.bottom + gap, bottomEdge))
	const aboveBottom = Math.max(topEdge, Math.min(trigger.top - gap, bottomEdge))
	const below = Math.max(0, bottomEdge - belowTop)
	const above = Math.max(0, aboveBottom - topEdge)
	const desiredHeight = Math.min(448, popover.scrollHeight + 2)
	const openAbove = below < desiredHeight && above > below
	const availableHeight = openAbove ? above : below
	popover.style.maxHeight = `${Math.min(448, availableHeight)}px`
	const height = popover.getBoundingClientRect().height
	popover.style.top = `${openAbove ? Math.max(topEdge, aboveBottom - height) : belowTop}px`
}

/** Navigation follows one edge of the universe tree at a time. */
function getParent(universe: UniverseSwitcherProps['universe'], includeRelatedUniverses: boolean): readonly { label: string; universeId: bigint }[] {
	if (universe === undefined || universe.universeId === 0n) return []
	const parentIndex = includeRelatedUniverses ? (universe.lineage?.findIndex(step => step.universeId === universe.parentUniverseId) ?? -1) : -1
	let label = universe.parentUniverseId === 0n ? universeCopy.genesis : universeCopy.parentUniverse
	if (includeRelatedUniverses && parentIndex >= 0) label = formatUniverseLineageLabel(universe.lineage?.slice(0, parentIndex + 1), universe.parentUniverseId)
	return [{ label, universeId: universe.parentUniverseId }]
}

/**
 * Compact header control naming the active universe by lineage. It opens a menu of the universe's parent and
 * deployed children plus a link to the full universe browser; choosing one changes the shared `universe` parameter.
 */
export function UniverseSwitcher({ activeUniverseId, browseHref, universe, includeRelatedUniverses = universe?.relatedUniversesLoaded !== false }: UniverseSwitcherProps) {
	const detailsRef = useRef<HTMLDetailsElement>(null)
	const loadedUniverse = universe?.universeId === activeUniverseId ? universe : undefined
	const universeLabel = formatUniverseViewLabel(loadedUniverse, activeUniverseId, includeRelatedUniverses)
	const parents = getParent(loadedUniverse, includeRelatedUniverses)
	const deployedChildren = includeRelatedUniverses ? (loadedUniverse?.childUniverses.filter(child => child.exists) ?? []) : []
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

	useLayoutEffect(() => positionPopover(detailsRef.current))

	useEffect(() => {
		const reposition = () => positionPopover(detailsRef.current)
		const details = detailsRef.current
		details?.addEventListener('toggle', reposition)
		window.addEventListener('resize', reposition)
		window.addEventListener('scroll', reposition, true)
		const viewport = window.visualViewport
		viewport?.addEventListener('resize', reposition)
		viewport?.addEventListener('scroll', reposition)
		return () => {
			details?.removeEventListener('toggle', reposition)
			window.removeEventListener('resize', reposition)
			window.removeEventListener('scroll', reposition, true)
			viewport?.removeEventListener('resize', reposition)
			viewport?.removeEventListener('scroll', reposition)
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
				{loadedUniverse === undefined || !includeRelatedUniverses || loadedUniverse.relatedUniversesLoaded === false || !loadedUniverse.hasForked ? undefined : (
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
