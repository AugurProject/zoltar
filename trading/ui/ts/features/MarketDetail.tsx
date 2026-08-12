import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { quoteEnterPosition, quoteExitPosition, maximumInsuredExit, type EnterPositionQuote, type ExitPositionQuote } from '../../../ts/sdk/positions.ts'
import { conditionalYesProbability } from '../../../ts/sdk/math.ts'
import { getScalarOutcomeIndex } from '@zoltar/shared/scalarOutcome'
import type { DemoMarket } from '../demo/markets.ts'
import { demoAttoEthToAttoShares, demoAttoSharesToAttoEth, demoWalletBalances, lifecycleLabel, tradingClosedReason } from '../demo/markets.ts'
import { bigintToSafeNumber, formatOutcomeAmount, formatShareAmount, formatUnits, parseUnits, shortAddress } from '../app/format.ts'
import { SecurityPoolAddressLink, Status } from '../components/Status.tsx'
import { forkMigrationBatchBlocker, forkMigrationBatchWarning, insuredExitLimitMessage } from './LiveTrading.tsx'
import { ForkMigrationTargets, type ForkMigrationContext, type ForkTarget } from './ForkMigrationTargets.tsx'
import { createExclusiveWorkflowGuard } from '../app/latestRequest.ts'

type TransactionState = 'idle' | 'preparing' | 'approval' | 'submitting' | 'pending' | 'confirmed' | 'rejected' | 'reverted'

const demoTransactionHash = `0x${'88'.repeat(32)}`

function initialTransactionState(scenario: string): TransactionState {
	if (scenario === 'preparing') return 'preparing'
	if (scenario === 'pending') return 'pending'
	if (scenario === 'failure') return 'reverted'
	if (scenario === 'success') return 'confirmed'
	if (scenario === 'approval') return 'approval'
	if (scenario === 'submitting') return 'submitting'
	return 'idle'
}

export function demoPreviewPresentation({ scenario, hasQuote, pairExists, closedReason, inputValid, capacityAvailable }: { scenario: string; hasQuote: boolean; pairExists: boolean; closedReason: string | undefined; inputValid: boolean; capacityAvailable: boolean }): {
	tone: 'good' | 'warn' | 'neutral'
	label: string | undefined
	message: string | undefined
} {
	if (scenario === 'stale') return { tone: 'warn', label: 'Preview stale', message: 'Refresh the preview before relying on the displayed values.' }
	if (hasQuote) return { tone: 'neutral', label: undefined, message: undefined }
	if (closedReason !== undefined)
		return pairExists ? { tone: 'warn', label: 'Trading closed', message: `Trading and added liquidity are unavailable: ${closedReason}. Raw LP removal remains available.` } : { tone: 'warn', label: 'Trading closed', message: `Trading and pair initialization are unavailable: ${closedReason}.` }
	if (!pairExists) return { tone: 'warn', label: 'Pair initialization required', message: 'Create and initialize the pair before previewing a trade.' }
	if (!inputValid) return { tone: 'neutral', label: 'Valid input required', message: 'Enter a positive, valid amount to preview this trade.' }
	if (!capacityAvailable) return { tone: 'warn', label: 'Insufficient pair liquidity', message: 'Reduce the exit amount below the opposite-outcome reserve.' }
	return { tone: 'warn', label: 'Preview unavailable', message: 'The current inputs cannot be quoted.' }
}

function actionLabel(pairExists: boolean, closedReason: string | undefined, mode: 'enter' | 'exit', side: 'YES' | 'NO') {
	if (!pairExists) return 'Create pair before trading'
	if (closedReason !== undefined) return closedReason
	return mode === 'enter' ? `Enter ${side}` : `Exit insured ${side}`
}

export function transactionMessage(transactionState: TransactionState, mode: 'enter' | 'exit' = 'enter', side: 'YES' | 'NO' = 'YES') {
	const action = mode === 'enter' ? `Enter ${side}` : `Insured ${side} exit`
	if (transactionState === 'preparing') return `Preparing ${action}.`
	if (transactionState === 'approval') return `${action} approval is pending in the wallet.`
	if (transactionState === 'submitting') return `${action} is pending in the wallet.`
	if (transactionState === 'pending') return `${action} is pending confirmation.`
	if (transactionState === 'confirmed') return `${action} confirmed. Demo balances and reserves remain unchanged.`
	if (transactionState === 'reverted') return 'Failure shown. Change the amount or outcome and try again.'
	return undefined
}

function renderTradeSummary(quote: EnterPositionQuote | ExitPositionQuote | undefined, amountAtto: bigint | undefined, side: 'YES' | 'NO', unavailableMessage: string | undefined, estimatedExitAttoEth: bigint | undefined) {
	if (quote === undefined || amountAtto === undefined)
		return (
			<div class='trade-summary trade-summary--unavailable'>
				<div>
					<span>Preview</span>
					<strong>Unavailable</strong>
				</div>
				<p>{unavailableMessage ?? 'The current inputs cannot be quoted.'}</p>
			</div>
		)
	if ('oppositeSharesSwapped' in quote)
		return (
			<div class='trade-summary' aria-label='Trade summary'>
				<div>
					<span>You pay</span>
					<strong>{formatUnits(amountAtto, 18, 8)} ETH</strong>
				</div>
				<span class='trade-summary__arrow' aria-hidden='true'>
					→
				</span>
				<div>
					<span>You receive</span>
					<strong>{formatOutcomeAmount(quote.totalLongShares, side)}</strong>
					<small>+ {formatOutcomeAmount(quote.invalidInsurance, 'INVALID')}</small>
				</div>
			</div>
		)
	return (
		<div class='trade-summary' aria-label='Trade summary'>
			<div>
				<span>You use</span>
				<strong>{formatOutcomeAmount(quote.totalLongShares, side)}</strong>
				<small>+ {formatOutcomeAmount(quote.invalidRequired, 'INVALID')}</small>
			</div>
			<span class='trade-summary__arrow' aria-hidden='true'>
				→
			</span>
			<div>
				<span>You receive</span>
				<strong>{formatUnits(estimatedExitAttoEth ?? 0n, 18, 8)} ETH</strong>
			</div>
		</div>
	)
}

function renderQuote(quote: EnterPositionQuote | ExitPositionQuote | undefined, side: 'YES' | 'NO', unavailableMessage: string | undefined, estimatedExitAttoEth?: bigint) {
	if (quote === undefined) return <p>{unavailableMessage ?? 'The current inputs cannot be quoted.'}</p>
	if ('oppositeSharesSwapped' in quote)
		return (
			<dl class='metrics'>
				<div>
					<dt>Complete-set shares</dt>
					<dd>{formatShareAmount(quote.completeSetShares)}</dd>
				</div>
				<div>
					<dt>Opposite shares swapped</dt>
					<dd>{formatOutcomeAmount(quote.oppositeSharesSwapped, side === 'YES' ? 'NO' : 'YES')}</dd>
				</div>
				<div>
					<dt>Additional {side}</dt>
					<dd>{formatOutcomeAmount(quote.additionalLongShares, side)}</dd>
				</div>
				<div class='metrics__strong'>
					<dt>Total {side} delivered</dt>
					<dd>{formatOutcomeAmount(quote.totalLongShares, side)}</dd>
				</div>
				<div>
					<dt>INVALID received</dt>
					<dd>{formatOutcomeAmount(quote.invalidInsurance, 'INVALID')}</dd>
				</div>
				<div>
					<dt>AMM fee</dt>
					<dd>{formatOutcomeAmount(quote.feeAmount, side === 'YES' ? 'NO' : 'YES')}</dd>
				</div>
			</dl>
		)
	return (
		<dl class='metrics'>
			<div>
				<dt>INVALID required</dt>
				<dd>{formatOutcomeAmount(quote.invalidRequired, 'INVALID')}</dd>
			</div>
			<div>
				<dt>{side} swapped</dt>
				<dd>{formatOutcomeAmount(quote.longSharesSwapped, side)}</dd>
			</div>
			<div>
				<dt>Total {side} required</dt>
				<dd>{formatOutcomeAmount(quote.totalLongShares, side)}</dd>
			</div>
			<div class='metrics__strong'>
				<dt>Estimated ETH</dt>
				<dd>{formatUnits(estimatedExitAttoEth ?? 0n, 18, 8)} ETH</dd>
			</div>
		</dl>
	)
}

const demoScalarQuestion = {
	answerUnit: '°C',
	displayValueMax: 5n * 10n ** 18n,
	displayValueMin: -5n * 10n ** 18n,
	numTicks: 100n,
} as const

const demoScalarForkContext: Extract<ForkMigrationContext, { kind: 'scalar' }> = {
	...demoScalarQuestion,
	kind: 'scalar',
	parentUniverseId: 1n,
	questionId: 9_901n,
	title: 'Average global temperature anomaly in 2030?',
	availableTargets: [
		{ outcomeIndex: getScalarOutcomeIndex(demoScalarQuestion, 25n), universeId: 21n, label: '-2.5 °C', canonicalPool: `0x${'61'.repeat(20)}` },
		{ outcomeIndex: getScalarOutcomeIndex(demoScalarQuestion, 50n), universeId: 22n, label: '0 °C', canonicalPool: `0x${'62'.repeat(20)}` },
	],
}

function sourceOutcomeFromValue(value: string) {
	if (value === 'INVALID' || value === 'YES' || value === 'NO') return value
	throw new Error('Unknown demo source outcome')
}

function DemoScalarForkMigration() {
	const [sourceOutcome, setSourceOutcome] = useState<'INVALID' | 'YES' | 'NO'>('YES')
	const [selectedTargets, setSelectedTargets] = useState<readonly ForkTarget[]>(demoScalarForkContext.availableTargets)
	const batchBlocker = forkMigrationBatchBlocker(selectedTargets)
	const batchWarning = forkMigrationBatchWarning(selectedTargets)
	return (
		<section class='section demo-fork-migration' aria-labelledby='demo-fork-migration-heading'>
			<div class='section-heading'>
				<div>
					<span class='section-kicker'>Fork settlement</span>
					<h2 id='demo-fork-migration-heading'>Migrate shares to scalar branches</h2>
				</div>
			</div>
			<div class='fork-source-step'>
				<label class='field'>
					<span>Source share</span>
					<select value={sourceOutcome} onChange={event => setSourceOutcome(sourceOutcomeFromValue(event.currentTarget.value))}>
						<option value='INVALID'>INVALID</option>
						<option value='YES'>YES</option>
						<option value='NO'>NO</option>
					</select>
				</label>
				<p>Migration permanently locks parent-universe transfers for {sourceOutcome}. The same source can still migrate later into other children.</p>
			</div>
			<ForkMigrationTargets context={demoScalarForkContext} selectedTargets={selectedTargets} disabled={false} onChange={setSelectedTargets} />
			{batchWarning === undefined ? null : <p class='warning'>{batchWarning}</p>}
			<button class='primary-action' disabled={selectedTargets.length === 0 || batchBlocker !== undefined}>
				Simulate migration to {selectedTargets.length.toString()} {selectedTargets.length === 1 ? 'branch' : 'branches'}
			</button>
		</section>
	)
}

export function quoteDemoEnterPosition(market: DemoMarket, side: 'YES' | 'NO', amountAttoEth: bigint) {
	return quoteEnterPosition(side, demoAttoEthToAttoShares(amountAttoEth, market), market.yesReserve, market.noReserve, market.feeBps)
}

export function MarketDetail({ market, scenario, onWorkflowLockChange = () => undefined }: { market: DemoMarket; scenario: string; onWorkflowLockChange?: (locked: boolean) => void }) {
	const query = new URLSearchParams(window.location.search)
	const [side, setSide] = useState<'YES' | 'NO'>(query.get('side') === 'no' ? 'NO' : 'YES')
	const [mode, setMode] = useState<'enter' | 'exit'>(query.get('mode') === 'exit' ? 'exit' : 'enter')
	const [amount, setAmount] = useState(scenario === 'insufficient-invalid' ? '900' : '0.25')
	const [transactionState, setTransactionState] = useState<TransactionState>(initialTransactionState(scenario))
	const workflow = useRef(createExclusiveWorkflowGuard()).current
	const timers = useRef<number[]>([])
	const closedReason = tradingClosedReason(market.lifecycle)
	const initialized = market.pair !== undefined && market.lpTotalSupply > 0n && market.yesReserve > 0n && market.noReserve > 0n
	const conditional = initialized ? conditionalYesProbability(market.yesReserve, market.noReserve) : undefined
	const yesPercent = conditional === undefined ? undefined : bigintToSafeNumber((conditional.numerator * 1_000n) / conditional.denominator, 'Conditional YES tenths') / 10
	const parsed = useMemo(() => {
		try {
			return { value: parseUnits(amount) }
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'Invalid amount' }
		}
	}, [amount])
	const quote = useMemo(() => {
		if (parsed.value === undefined || parsed.value === 0n || !initialized) return undefined
		const oppositeReserve = side === 'YES' ? market.noReserve : market.yesReserve
		if (mode === 'exit' && parsed.value >= oppositeReserve) return undefined
		if (closedReason !== undefined) return undefined
		return mode === 'enter' ? quoteDemoEnterPosition(market, side, parsed.value) : quoteExitPosition(side, parsed.value, market.yesReserve, market.noReserve, market.feeBps)
	}, [closedReason, initialized, market, mode, parsed.value, side])
	const estimatedExitAttoEth = mode === 'exit' && parsed.value !== undefined ? demoAttoSharesToAttoEth(parsed.value, market) : undefined
	const longBalance = side === 'YES' ? demoWalletBalances.yes : demoWalletBalances.no
	const maxExit = maximumInsuredExit({ longOutcome: side, longBalance, invalidBalance: demoWalletBalances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const exitExceedsInsurance = mode === 'exit' && parsed.value !== undefined && parsed.value > maxExit
	const wrongNetwork = scenario === 'wrong-network'
	const actionBlocker = wrongNetwork ? 'Switch network to continue' : closedReason
	const inputValid = parsed.value !== undefined && parsed.value > 0n
	const oppositeReserve = side === 'YES' ? market.noReserve : market.yesReserve
	const capacityAvailable = mode !== 'exit' || parsed.value === undefined || parsed.value < oppositeReserve
	const displayedQuoteStatus = demoPreviewPresentation({ scenario, hasQuote: quote !== undefined, pairExists: initialized, closedReason, inputValid, capacityAvailable })
	const workflowLocked = transactionState === 'preparing' || transactionState === 'approval' || transactionState === 'submitting' || transactionState === 'pending'
	useEffect(() => {
		if (workflowLocked) onWorkflowLockChange(true)
		return () => {
			for (const timer of timers.current) window.clearTimeout(timer)
			if (workflow.isActive()) workflow.finish()
			onWorkflowLockChange(false)
		}
	}, [])
	const resetTerminalState = () => {
		if (!workflowLocked) setTransactionState('idle')
	}
	const submit = () => {
		if (!workflow.begin()) return
		onWorkflowLockChange(true)
		setTransactionState(mode === 'exit' ? 'approval' : 'pending')
		timers.current.push(window.setTimeout(() => setTransactionState('pending'), mode === 'exit' ? 450 : 0))
		timers.current.push(
			window.setTimeout(() => {
				setTransactionState('confirmed')
				workflow.finish()
				onWorkflowLockChange(false)
			}, 1_300),
		)
	}
	const quoteContent = renderQuote(quote, side, displayedQuoteStatus.message, estimatedExitAttoEth)
	let primaryAction = (
		<button class='primary-action' aria-busy={workflowLocked} disabled={actionBlocker !== undefined || exitExceedsInsurance || quote === undefined || workflowLocked} onClick={submit}>
			{exitExceedsInsurance ? 'Exit exceeds insured capacity' : actionLabel(true, actionBlocker, mode, side)}
		</button>
	)
	if (!initialized && closedReason === undefined)
		primaryAction = (
			<a class='primary-action' href='#/liquidity'>
				{market.pair === undefined ? 'Create and initialize this market in Liquidity' : 'Initialize this pair in Liquidity'}
			</a>
		)
	if (!initialized && closedReason !== undefined)
		primaryAction = (
			<button class='primary-action' disabled>
				{closedReason} — pair initialization unavailable
			</button>
		)

	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<a class='eyebrow' href='#/markets'>
						← Markets
					</a>
					<h1>{market.question}</h1>
				</div>
				<Status tone={closedReason === undefined ? 'good' : 'warn'}>{lifecycleLabel(market.lifecycle)}</Status>
			</header>

			<div class='detail-grid'>
				{!initialized ? (
					<section class='section uninitialized-state' aria-labelledby='initialization-heading'>
						<div class='section-heading'>
							<div>
								<span class='section-kicker'>Conditional price unavailable</span>
								<h2 id='initialization-heading'>Pair initialization required</h2>
							</div>
						</div>
						<p>Create initial YES/NO reserves before entering or exiting positions.</p>
						{primaryAction}
					</section>
				) : (
					<section class='section trade-panel' aria-labelledby='trade-heading'>
						<div class='section-heading'>
							<div>
								<span class='section-kicker'>Insured position</span>
								<h2 id='trade-heading'>{mode === 'enter' ? 'Enter with ETH' : 'Exit to ETH'}</h2>
							</div>
							<div class='segmented' aria-label='Position operation'>
								<button
									type='button'
									aria-pressed={mode === 'enter'}
									disabled={workflowLocked}
									onClick={() => {
										if (workflow.isActive()) return
										setMode('enter')
										resetTerminalState()
									}}
								>
									Enter
								</button>
								<button
									type='button'
									aria-pressed={mode === 'exit'}
									disabled={workflowLocked}
									onClick={() => {
										if (workflow.isActive()) return
										setMode('exit')
										resetTerminalState()
									}}
								>
									Exit
								</button>
							</div>
						</div>
						<div class='side-picker' aria-label='Outcome'>
							<button
								type='button'
								aria-pressed={side === 'YES'}
								disabled={closedReason !== undefined || workflowLocked}
								onClick={() => {
									if (workflow.isActive()) return
									setSide('YES')
									resetTerminalState()
								}}
							>
								<span>YES</span>
								<small>{yesPercent === undefined ? 'Conditional price unavailable' : `Conditional price ${yesPercent.toFixed(1)}%`}</small>
							</button>
							<button
								type='button'
								aria-pressed={side === 'NO'}
								disabled={closedReason !== undefined || workflowLocked}
								onClick={() => {
									if (workflow.isActive()) return
									setSide('NO')
									resetTerminalState()
								}}
							>
								<span>NO</span>
								<small>{yesPercent === undefined ? 'Conditional price unavailable' : `Conditional price ${(100 - yesPercent).toFixed(1)}%`}</small>
							</button>
						</div>
						<label class='field'>
							<span>{mode === 'enter' ? 'ETH amount' : 'Complete-set shares to redeem'}</span>
							<div class='amount-input'>
								<input
									value={amount}
									inputMode='decimal'
									disabled={closedReason !== undefined || workflowLocked}
									aria-describedby={parsed.error === undefined ? undefined : 'amount-error'}
									aria-invalid={parsed.error !== undefined}
									onInput={event => {
										if (workflow.isActive()) return
										setAmount(event.currentTarget.value)
										resetTerminalState()
									}}
								/>
								<span>{mode === 'enter' ? 'ETH' : 'shares'}</span>
							</div>
							{parsed.error === undefined ? null : (
								<small id='amount-error' class='error'>
									{parsed.error}
								</small>
							)}
						</label>
						{mode === 'exit' ? (
							<div class='coverage'>
								<div>
									<span>Maximum insured {side} exit</span>
									<strong>{formatOutcomeAmount(maxExit, side)}</strong>
								</div>
								<p>
									The limit uses wallet {side} ({formatOutcomeAmount(longBalance, side)}), wallet INVALID ({formatOutcomeAmount(demoWalletBalances.invalid, 'INVALID')}), and the displayed pair reserves. Excess directional shares remain in the wallet.
								</p>
								{exitExceedsInsurance ? (
									<p class='error' role='alert'>
										{insuredExitLimitMessage(parsed.value ?? 0n, maxExit, demoWalletBalances.invalid)}
									</p>
								) : null}
							</div>
						) : null}
						<div aria-live='polite'>
							{renderTradeSummary(quote, parsed.value, side, displayedQuoteStatus.message, estimatedExitAttoEth)}
							{displayedQuoteStatus.label === undefined ? null : <Status tone={displayedQuoteStatus.tone}>{displayedQuoteStatus.label}</Status>}
						</div>
						<div class='trade-action'>{primaryAction}</div>
						<div class={`transaction-message transaction-message--${transactionState}`} role='status' aria-live='polite'>
							{transactionMessage(transactionState, mode, side)}
						</div>
						{transactionState === 'pending' || transactionState === 'confirmed' || transactionState === 'reverted' ? (
							<p class='transaction-hash'>
								<span>Transaction</span>
								<code title={demoTransactionHash}>{demoTransactionHash}</code>
							</p>
						) : null}
						<details class='trade-breakdown pool-mechanics'>
							<summary>Pool and reserve details</summary>
							<dl class='metrics quote'>
								<div>
									<dt>Conditional YES price</dt>
									<dd>{yesPercent === undefined ? 'Unavailable' : `${yesPercent.toFixed(1)}%`}</dd>
								</div>
								<div>
									<dt>YES reserve</dt>
									<dd>{formatOutcomeAmount(market.yesReserve, 'YES')}</dd>
								</div>
								<div>
									<dt>NO reserve</dt>
									<dd>{formatOutcomeAmount(market.noReserve, 'NO')}</dd>
								</div>
							</dl>
						</details>
						{quote === undefined ? null : (
							<details class='trade-breakdown'>
								<summary>Full trade breakdown</summary>
								<div class='quote'>{quoteContent}</div>
							</details>
						)}
						<details>
							<summary>Advanced · Raw share swap</summary>
							<p>An uninsured share swap does not create matching INVALID. Use only when you intend to manage raw YES and NO balances.</p>
						</details>
					</section>
				)}

				<aside class='detail-aside'>
					<section class='section'>
						<div class='section-heading'>
							<div>
								<h2>Your position</h2>
							</div>
						</div>
						<dl class='fact-list'>
							<div>
								<dt>YES</dt>
								<dd>{formatOutcomeAmount(demoWalletBalances.yes, 'YES')}</dd>
							</div>
							<div>
								<dt>NO</dt>
								<dd>{formatOutcomeAmount(demoWalletBalances.no, 'NO')}</dd>
							</div>
							<div>
								<dt>INVALID</dt>
								<dd>{formatOutcomeAmount(demoWalletBalances.invalid, 'INVALID')}</dd>
							</div>
						</dl>
					</section>
					<section class='section'>
						<div class='section-heading'>
							<div>
								<h2>Protocol references</h2>
							</div>
						</div>
						<dl class='fact-list'>
							<div>
								<dt>Ends</dt>
								<dd>{market.endTime}</dd>
							</div>
							<div>
								<dt>Security pool</dt>
								<dd>
									<SecurityPoolAddressLink value={market.pool} disabled={workflowLocked} />
								</dd>
							</div>
							<div>
								<dt>Pair</dt>
								<dd>{market.pair === undefined ? 'Not created' : <span title={market.pair}>{shortAddress(market.pair)}</span>}</dd>
							</div>
							<div>
								<dt>Trading fee</dt>
								<dd>{formatUnits(market.feeBps, 2, 2)}%</dd>
							</div>
						</dl>
					</section>
				</aside>
			</div>
			{scenario === 'forked-scalar' ? <DemoScalarForkMigration /> : null}
		</main>
	)
}
