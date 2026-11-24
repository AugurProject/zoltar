import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/statoblastShell.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { useDisclosurePopover } from '@zoltar/ui-core-shared/hooks/useDisclosurePopover.js'
import { useModalFocusIsolation } from '@zoltar/ui-core-shared/hooks/useModalFocusIsolation.js'
import { formatUniverseLineageLabel } from '@zoltar/ui-core-shared/lib/universeLineage.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { statoblastPageHref } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'

type Props = {
	activeUniverse: bigint
	environmentKey: number
	universe: ZoltarUniverseSummary | undefined
	wallet: Address | undefined
	onOpenChange: (open: boolean) => void
	onSelect: (universeId: bigint) => void
}

export function StatoblastUniverseMenu({ activeUniverse, environmentKey, universe, wallet, onOpenChange, onSelect }: Props) {
	const popover = useDisclosurePopover()
	const [mobile, setMobile] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 40rem)').matches)
	const [balances, setBalances] = useState<ReadonlyMap<bigint, bigint>>(new Map())
	const panel = useRef<HTMLElement>(null)
	const closeButton = useRef<HTMLButtonElement>(null)
	const forked = universe?.hasForked === true
	const currentLabel = formatUniverseLineageLabel(universe?.lineage, activeUniverse)
	const parentId = universe?.universeId === activeUniverse && activeUniverse !== 0n ? universe.parentUniverseId : undefined
	const select = (universeId: bigint) => {
		popover.close()
		onSelect(universeId)
	}
	useEffect(() => {
		if (typeof window.matchMedia !== 'function') return
		const query = window.matchMedia('(max-width: 40rem)')
		const update = () => setMobile(query.matches)
		query.addEventListener('change', update)
		return () => query.removeEventListener('change', update)
	}, [])
	useEffect(() => onOpenChange(popover.open), [popover.open])
	useModalFocusIsolation({ dialogRef: panel, getReturnFocusTarget: () => popover.triggerRef.current, initialFocusRef: closeButton, isOpen: popover.open && mobile, onClose: popover.close })
	useEffect(() => {
		setBalances(new Map())
		if (!popover.open || wallet === undefined || universe === undefined || universe.universeId !== activeUniverse) return
		let current = true
		void (async () => {
			const client = createConnectedReadClient()
			const block = await client.getBlock()
			if (block.number === undefined) return
			const tokens = [{ id: activeUniverse, token: universe.reputationToken }, ...universe.childUniverses.filter(child => child.exists).map(child => ({ id: child.universeId, token: child.reputationToken }))]
			if (parentId !== undefined && universe.zoltarAddress !== undefined) {
				const token = await client.readContract({ abi: Zoltar_Zoltar.abi, address: universe.zoltarAddress, functionName: 'getRepToken', args: [parentId], blockNumber: block.number })
				tokens.push({ id: parentId, token })
			}
			const reads = await readOptionalMulticall(
				client,
				tokens.map(({ token }) => ({ abi: ABIS.mainnet.erc20, address: token, functionName: 'balanceOf', args: [wallet] }) as const),
				block.number,
			)
			if (current)
				setBalances(
					new Map(
						tokens.flatMap(({ id }, index) => {
							const result = reads[index]
							return result?.status === 'success' && typeof result.result === 'bigint' ? [[id, result.result]] : []
						}),
					),
				)
		})().catch(() => undefined)
		return () => {
			current = false
		}
	}, [activeUniverse, environmentKey, parentId, popover.open, universe, wallet])

	let migrationSource: bigint | undefined
	if (forked && (balances.get(activeUniverse) ?? 0n) > 0n) migrationSource = activeUniverse
	else if (parentId !== undefined && (balances.get(parentId) ?? 0n) > 0n) migrationSource = parentId
	const ownRep = (id: bigint) => <CurrencyValue value={balances.get(id)} suffix={pageCopy.rep} />
	return (
		<div className='statoblast-universe-menu' ref={popover.containerRef}>
			<button {...popover.triggerProps} className='secondary' onClick={popover.toggle} aria-label={pageCopy.formatUniverses(currentLabel)}>
				{currentLabel}
				{forked || (parentId !== undefined && migrationSource === parentId) ? <span className='statoblast-universe-alert' aria-label={pageCopy.repMigrationAvailable} /> : undefined}
			</button>
			{popover.open && (
				<div className={mobile ? 'modal-backdrop statoblast-universe-scrim' : 'statoblast-universe-popover'}>
					<section ref={panel} id={popover.panelId} className='statoblast-universe-panel' role='dialog' aria-modal={mobile ? 'true' : undefined} aria-label={pageCopy.universes} tabIndex={-1}>
						<header>
							<strong>{pageCopy.universes}</strong>
							<button
								type='button'
								className='secondary'
								ref={closeButton}
								onClick={() => {
									popover.close()
									if (!mobile) popover.triggerRef.current?.focus()
								}}
							>
								{pageCopy.close}
							</button>
						</header>
						<ul>
							<li>
								<strong>{currentLabel}</strong>
								<Badge tone={forked ? 'warning' : 'ok'}>{forked ? pageCopy.forked : pageCopy.active}</Badge>
								{ownRep(activeUniverse)}
							</li>
							{parentId !== undefined && (
								<li>
									<button type='button' className='secondary' onClick={() => select(parentId)}>
										{formatUniverseLineageLabel(universe?.lineage?.slice(0, -1), parentId)}
									</button>
									<Badge tone='warning'>{pageCopy.forkedParent}</Badge>
									{ownRep(parentId)}
								</li>
							)}
							{universe?.childUniverses.map(child => (
								<li key={child.universeId.toString()}>
									<button type='button' className='secondary' disabled={!child.exists} onClick={() => select(child.universeId)}>
										{child.outcomeLabel}
									</button>
									<Badge>{child.exists ? pageCopy.created : pageCopy.notCreatedYet}</Badge>
									{child.exists ? ownRep(child.universeId) : undefined}
								</li>
							))}
						</ul>
						{migrationSource !== undefined && (
							<footer>
								<a href={statoblastPageHref({ kind: 'migrate-rep' }, migrationSource)} onClick={popover.close}>
									{pageCopy.migrateRepAction}
								</a>
								<p>{pageCopy.noMigrationDeadline}</p>
							</footer>
						)}
					</section>
				</div>
			)}
		</div>
	)
}
