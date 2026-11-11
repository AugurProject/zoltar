import { useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { FittedAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { RegisteredPortfolio } from '../../../protocol/securityPools.js'
import { useRegisteredPortfolios } from '../hooks/useRegisteredPortfolios.js'
import * as copy from '../../../copy/portfolio.js'

type Props = {
	enabled: boolean
	environmentKey: number
	/** Portfolios are listed for the universe they would open in. */
	universeId: bigint
	/** The portfolio address field, which may be partly typed. */
	selected: string
	/** The universe field: a row is selected only while the portfolio is open in the universe the list is for. */
	selectedUniverse: string
	/** Decided once by the caller: open for a visitor with no linked or remembered portfolio. */
	initiallyOpen: boolean
	disabled: boolean
	onOpen: (portfolio: Address) => void
}

function PortfolioRow({ entry, current, disabled, onOpen }: { entry: RegisteredPortfolio; current: boolean; disabled: boolean; onOpen: (portfolio: Address) => void }) {
	const slot = useRef<HTMLLIElement>(null)
	// The selected row keeps its button, inert but focusable, so opening a portfolio neither drops focus nor reflows the row.
	// Both labels share one cell, so the button is as wide as the longer one in either state.
	return (
		<li ref={slot} aria-current={current ? 'true' : undefined}>
			<div className='registered-portfolio-row'>
				<FittedAddressValue address={entry.portfolio} slot={slot} />
				<span>{copy.formatRegisteredQuestions(entry.questionCount)}</span>
				<button
					type='button'
					className='secondary registered-portfolio-action'
					disabled={disabled}
					aria-disabled={current ? 'true' : undefined}
					aria-label={current ? copy.formatSelectedPortfolioLabel(entry.portfolio) : copy.formatOpenPortfolioLabel(entry.portfolio)}
					onClick={() => {
						if (!current) onOpen(entry.portfolio)
					}}
				>
					<span className='registered-portfolio-action-labels'>
						<span aria-hidden={current ? 'true' : undefined}>{copy.openPortfolio}</span>
						<span aria-hidden={current ? undefined : 'true'}>{copy.portfolioSelected}</span>
					</span>
				</button>
			</div>
		</li>
	)
}

export function RegisteredPortfolios({ enabled, environmentKey, universeId, selected, selectedUniverse, initiallyOpen, disabled, onOpen }: Props) {
	const [open, setOpen] = useState(initiallyOpen)
	// A linked or remembered portfolio keeps the list folded, and a folded list that was never opened reads nothing.
	const [opened, setOpened] = useState(initiallyOpen)
	const { portfolios, loading, error, retrying, retry } = useRegisteredPortfolios({ enabled: enabled && opened, environmentKey, universeId })
	return (
		<details
			open={open}
			onToggle={event => {
				setOpen(event.currentTarget.open)
				if (event.currentTarget.open) setOpened(true)
			}}
		>
			<summary>{copy.portfoliosWithQuestions}</summary>
			{loading ? <UserMessage loading detail={copy.loadingPortfolios} /> : undefined}
			{error === undefined ? undefined : <RetryableNotice message={error} retryLabel={retrying ? commonCopy.retrying : commonCopy.retry} disabled={retrying} onRetry={retry} />}
			{portfolios?.length === 0 ? <EmptyState title={copy.noPortfoliosWithQuestions} detail={copy.noPortfoliosWithQuestionsHint} /> : undefined}
			{portfolios === undefined || portfolios.length === 0 ? undefined : (
				<ul className='status-list'>
					{portfolios.map(entry => (
						<PortfolioRow key={entry.portfolio} entry={entry} current={sameAddress(entry.portfolio, selected.trim()) && selectedUniverse.trim() === universeId.toString()} disabled={disabled} onOpen={onOpen} />
					))}
				</ul>
			)}
		</details>
	)
}
