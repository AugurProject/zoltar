import { useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { FittedAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { RegisteredSecurityPool } from '../../../protocol/questionLedgers.js'
import { useRegisteredSecurityPools } from '../hooks/useRegisteredSecurityPools.js'
import * as copy from '../../../copy/securityPool.js'

type Props = {
	enabled: boolean
	environmentKey: number
	/** Security pools are listed for the universe they would open in. */
	universeId: bigint
	/** The security pool address field, which may be partly typed. */
	selected: string
	/** The universe field: a row is selected only while the security pool is open in the universe the list is for. */
	selectedUniverse: string
	/** Decided once by the caller: open for a visitor with no linked or remembered security pool. */
	initiallyOpen: boolean
	disabled: boolean
	onOpen: (securityPool: Address) => void
}

function SecurityPoolRow({ entry, current, disabled, onOpen }: { entry: RegisteredSecurityPool; current: boolean; disabled: boolean; onOpen: (securityPool: Address) => void }) {
	const slot = useRef<HTMLLIElement>(null)
	// The selected row keeps its button, inert but focusable, so opening a security pool neither drops focus nor reflows the row.
	// Both labels share one cell, so the button is as wide as the longer one in either state.
	return (
		<li ref={slot} aria-current={current ? 'true' : undefined}>
			<div className='registered-security-pool-row'>
				<FittedAddressValue address={entry.securityPool} slot={slot} />
				<span>{copy.formatRegisteredQuestions(entry.questionCount)}</span>
				<button
					type='button'
					className='secondary registered-security-pool-action'
					disabled={disabled}
					aria-disabled={current ? 'true' : undefined}
					aria-label={current ? copy.formatSelectedSecurityPoolLabel(entry.securityPool) : copy.formatOpenSecurityPoolLabel(entry.securityPool)}
					onClick={() => {
						if (!current) onOpen(entry.securityPool)
					}}
				>
					<span className='registered-security-pool-action-labels'>
						<span aria-hidden={current ? 'true' : undefined}>{copy.openSecurityPool}</span>
						<span aria-hidden={current ? undefined : 'true'}>{copy.securityPoolSelected}</span>
					</span>
				</button>
			</div>
		</li>
	)
}

export function RegisteredSecurityPools({ enabled, environmentKey, universeId, selected, selectedUniverse, initiallyOpen, disabled, onOpen }: Props) {
	const [open, setOpen] = useState(initiallyOpen)
	// A linked or remembered security pool keeps the list folded, and a folded list that was never opened reads nothing.
	const [opened, setOpened] = useState(initiallyOpen)
	const { securityPools, loading, error, retrying, retry } = useRegisteredSecurityPools({ enabled: enabled && opened, environmentKey, universeId })
	return (
		<details
			open={open}
			onToggle={event => {
				setOpen(event.currentTarget.open)
				if (event.currentTarget.open) setOpened(true)
			}}
		>
			<summary>{copy.securityPoolsInUniverse}</summary>
			{loading ? <UserMessage loading detail={copy.loadingSecurityPools} /> : undefined}
			{error === undefined ? undefined : <RetryableNotice message={error} retryLabel={retrying ? commonCopy.retrying : commonCopy.retry} disabled={retrying} onRetry={retry} />}
			{securityPools?.length === 0 ? <EmptyState title={copy.noSecurityPoolsInUniverse} detail={copy.noSecurityPoolsHint} /> : undefined}
			{securityPools === undefined || securityPools.length === 0 ? undefined : (
				<ul className='status-list'>
					{securityPools.map(entry => (
						<SecurityPoolRow key={entry.securityPool} entry={entry} current={sameAddress(entry.securityPool, selected.trim()) && selectedUniverse.trim() === universeId.toString()} disabled={disabled} onOpen={onOpen} />
					))}
				</ul>
			)}
		</details>
	)
}
