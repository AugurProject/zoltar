import { useMemo, useState } from 'preact/hooks'
import { quoteEnterPosition, quoteExitPosition, maximumInsuredExit, type EnterPositionQuote, type ExitPositionQuote } from '../../../ts/sdk/positions.ts'
import { conditionalYesProbability } from '../../../ts/sdk/math.ts'
import type { DemoMarket } from '../demo/markets.ts'
import { demoCashToShares, lifecycleLabel, tradingClosedReason } from '../demo/markets.ts'
import { formatBpsMultiplier, formatShareAmount, formatUnits, parseUnits, shortAddress } from '../app/format.ts'
import { ProbabilityBar } from '../components/ProbabilityBar.tsx'
import { AddressValue, Status } from '../components/Status.tsx'

type TransactionState = 'idle' | 'approval' | 'pending' | 'confirmed' | 'rejected' | 'reverted'

function initialTransactionState(scenario: string): TransactionState {
	if (scenario === 'pending') return 'pending'
	if (scenario === 'failure') return 'reverted'
	if (scenario === 'success') return 'confirmed'
	if (scenario === 'approval') return 'approval'
	return 'idle'
}

function quoteStatus(scenario: string, hasQuote: boolean): { tone: 'good' | 'warn' | 'neutral'; label: string } {
	if (scenario === 'stale') return { tone: 'warn', label: 'Quote stale' }
	if (!hasQuote) return { tone: 'neutral', label: 'Waiting for input' }
	return { tone: 'good', label: 'Simulated · block 21,904,812' }
}

function actionLabel(pairExists: boolean, closedReason: string | undefined, transactionState: TransactionState, mode: 'enter' | 'exit', side: 'YES' | 'NO') {
	if (!pairExists) return 'Create pair before trading'
	if (closedReason !== undefined) return closedReason
	if (transactionState === 'approval') return 'Confirm share approval…'
	if (transactionState === 'pending') return 'Transaction pending…'
	return mode === 'enter' ? `Enter ${side} position` : `Exit insured ${side}`
}

function transactionMessage(transactionState: TransactionState) {
	if (transactionState === 'confirmed') return 'Transaction confirmed. Balances and reserves refreshed.'
	if (transactionState === 'reverted') return 'Simulation failed: reserve state changed. Refresh the quote and try again.'
	return undefined
}

function renderQuote(quote: EnterPositionQuote | ExitPositionQuote | undefined, side: 'YES' | 'NO') {
	if (quote === undefined) return <p>Enter an amount and ensure this market has initialized liquidity.</p>
	if ('oppositeSharesSwapped' in quote)
		return (
			<dl class='metrics'>
				<div>
					<dt>Complete-set shares</dt>
					<dd>{formatShareAmount(quote.completeSetShares)}</dd>
				</div>
				<div>
					<dt>Opposite shares swapped</dt>
					<dd>{formatShareAmount(quote.oppositeSharesSwapped)}</dd>
				</div>
				<div>
					<dt>Additional {side}</dt>
					<dd>{formatShareAmount(quote.additionalLongShares)}</dd>
				</div>
				<div class='metrics__strong'>
					<dt>Total {side} delivered</dt>
					<dd>{formatShareAmount(quote.totalLongShares)}</dd>
				</div>
				<div>
					<dt>INVALID insurance</dt>
					<dd>{formatShareAmount(quote.invalidInsurance)}</dd>
				</div>
				<div>
					<dt>AMM fee</dt>
					<dd>{formatShareAmount(quote.feeAmount)}</dd>
				</div>
			</dl>
		)
	return (
		<dl class='metrics'>
			<div>
				<dt>INVALID required</dt>
				<dd>{formatShareAmount(quote.invalidRequired)}</dd>
			</div>
			<div>
				<dt>{side} swapped</dt>
				<dd>{formatShareAmount(quote.longSharesSwapped)}</dd>
			</div>
			<div>
				<dt>Total {side} required</dt>
				<dd>{formatShareAmount(quote.totalLongShares)}</dd>
			</div>
			<div class='metrics__strong'>
				<dt>Estimated ETH</dt>
				<dd>0.2471 ETH</dd>
			</div>
		</dl>
	)
}

export function quoteDemoEnterPosition(market: DemoMarket, side: 'YES' | 'NO', eth: bigint) {
	return quoteEnterPosition(side, demoCashToShares(eth, market), market.yesReserve, market.noReserve, market.feeBps)
}

export function MarketDetail({ market, scenario }: { market: DemoMarket; scenario: string }) {
	const query = new URLSearchParams(window.location.search)
	const [side, setSide] = useState<'YES' | 'NO'>(query.get('side') === 'no' ? 'NO' : 'YES')
	const [mode, setMode] = useState<'enter' | 'exit'>(query.get('mode') === 'exit' ? 'exit' : 'enter')
	const [amount, setAmount] = useState(scenario === 'insufficient-invalid' ? '900' : '0.25')
	const [transactionState, setTransactionState] = useState<TransactionState>(initialTransactionState(scenario))
	const closedReason = tradingClosedReason(market.lifecycle)
	const conditional = conditionalYesProbability(market.yesReserve, market.noReserve)
	const yesPercent = Number((conditional.numerator * 1_000n) / conditional.denominator) / 10
	const collateralPerShare = (market.securityPool.completeSetCollateral * 10n ** 18n) / market.securityPool.shareTokenSupply
	const parsed = useMemo(() => {
		try {
			return { value: parseUnits(amount) }
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'Invalid amount' }
		}
	}, [amount])
	const quote = useMemo(() => {
		if (parsed.value === undefined || parsed.value === 0n || market.pair === undefined) return undefined
		const oppositeReserve = side === 'YES' ? market.noReserve : market.yesReserve
		if (mode === 'exit' && parsed.value >= oppositeReserve) return undefined
		return mode === 'enter' ? quoteDemoEnterPosition(market, side, parsed.value) : quoteExitPosition(side, parsed.value, market.yesReserve, market.noReserve, market.feeBps)
	}, [market, mode, parsed.value, side])
	const maxExit = maximumInsuredExit({ longOutcome: side, longBalance: 1_820n * 10n ** 18n, invalidBalance: 750n * 10n ** 18n, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const exitExceedsInsurance = mode === 'exit' && parsed.value !== undefined && parsed.value > maxExit
	const wrongNetwork = scenario === 'wrong-network'
	const actionBlocker = wrongNetwork ? 'Switch network to continue' : closedReason
	const displayedQuoteStatus = quoteStatus(scenario, quote !== undefined)
	const submit = () => {
		if (transactionState === 'pending') return
		setTransactionState(mode === 'exit' ? 'approval' : 'pending')
		window.setTimeout(() => setTransactionState('pending'), mode === 'exit' ? 450 : 0)
		window.setTimeout(() => setTransactionState('confirmed'), 1_300)
	}

	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<a class='eyebrow' href='#/markets'>
						← Markets
					</a>
					<h1>{market.question}</h1>
					<p>Binary shares for one exact SecurityPool and universe branch.</p>
				</div>
				<Status tone={closedReason === undefined ? 'good' : 'warn'}>{lifecycleLabel(market.lifecycle)}</Status>
			</header>

			<section class='invalid-note' aria-label='INVALID pricing limitation'>
				<span class='invalid-note__icon' aria-hidden='true'>
					◇
				</span>
				<div>
					<strong>INVALID is insurance, not a traded reserve.</strong>
					<span>This AMM contains no estimate of the probability of an INVALID resolution.</span>
				</div>
			</section>

			<div class='detail-grid'>
				<section class='section trade-panel' aria-labelledby='trade-heading'>
					<div class='section-heading'>
						<div>
							<span class='section-kicker'>Insured position</span>
							<h2 id='trade-heading'>{mode === 'enter' ? 'Enter with ETH' : 'Exit to ETH'}</h2>
						</div>
						<div class='segmented' aria-label='Position operation'>
							<button type='button' aria-pressed={mode === 'enter'} onClick={() => setMode('enter')}>
								Enter
							</button>
							<button type='button' aria-pressed={mode === 'exit'} onClick={() => setMode('exit')}>
								Exit
							</button>
						</div>
					</div>
					{mode === 'enter' ? (
						<p class='pool-mint-note'>
							Submitted ETH goes to Statoblast SecurityPool <code class='pool-mint-note__address'>{market.pool}</code>. That pool reconciles collateral and mints complete-set shares at its live rate.
						</p>
					) : null}
					<div class='side-picker' aria-label='Outcome'>
						<button type='button' aria-pressed={side === 'YES'} onClick={() => setSide('YES')}>
							<span>YES</span>
							<small>Conditional price {yesPercent.toFixed(1)}%</small>
						</button>
						<button type='button' aria-pressed={side === 'NO'} onClick={() => setSide('NO')}>
							<span>NO</span>
							<small>Conditional price {(100 - yesPercent).toFixed(1)}%</small>
						</button>
					</div>
					<label class='field'>
						<span>{mode === 'enter' ? 'ETH amount' : 'Complete-set shares to redeem'}</span>
						<div class='amount-input'>
							<input value={amount} inputMode='decimal' aria-describedby={parsed.error === undefined ? 'amount-help' : 'amount-error'} aria-invalid={parsed.error !== undefined} onInput={event => setAmount(event.currentTarget.value)} />
							<span>{mode === 'enter' ? 'ETH' : 'shares'}</span>
						</div>
						{parsed.error === undefined ? (
							<small id='amount-help'>Final values come from a fresh router simulation.</small>
						) : (
							<small id='amount-error' class='error'>
								{parsed.error}
							</small>
						)}
					</label>
					{mode === 'exit' ? (
						<div class='coverage'>
							<div>
								<span>Maximum insured {side} exit</span>
								<strong>{formatShareAmount(maxExit)}</strong>
							</div>
							<p>Your INVALID balance covers only {formatUnits(750n * 10n ** 18n)} complete sets. Excess YES/NO profit must remain as shares unless you acquire more INVALID.</p>
							{exitExceedsInsurance ? (
								<p class='error' role='alert'>
									Reduce the exit to {formatUnits(maxExit)} complete sets or acquire more INVALID.
								</p>
							) : null}
						</div>
					) : null}
					<div class='quote' aria-live='polite'>
						<div class='quote__title'>
							<span>{quote === undefined ? 'Quote unavailable' : 'Authoritative preview'}</span>
							<Status tone={displayedQuoteStatus.tone}>{displayedQuoteStatus.label}</Status>
						</div>
						{renderQuote(quote, side)}
					</div>
					{wrongNetwork ? (
						<p class='error' role='alert'>
							Switch to the configured network before simulating or submitting.
						</p>
					) : null}
					<button class='primary-action' disabled={actionBlocker !== undefined || exitExceedsInsurance || market.pair === undefined || quote === undefined || transactionState === 'pending'} onClick={submit}>
						{exitExceedsInsurance ? 'Exit exceeds INVALID coverage' : actionLabel(market.pair !== undefined, actionBlocker, transactionState, mode, side)}
					</button>
					<div class={`transaction-message transaction-message--${transactionState}`} role='status' aria-live='polite'>
						{transactionMessage(transactionState)}
					</div>
					<details>
						<summary>Advanced · Raw share swap</summary>
						<p>An uninsured share swap does not create new INVALID insurance. Use only when you intend to manage raw YES and NO balances.</p>
					</details>
				</section>

				<aside class='detail-aside'>
					<section class='section'>
						<div class='section-heading'>
							<div>
								<span class='section-kicker'>Market signal</span>
								<h2>Conditional YES price</h2>
							</div>
						</div>
						<ProbabilityBar yesPercent={yesPercent} beforePercent={yesPercent - 3.4} />
						<dl class='fact-list'>
							<div>
								<dt>YES reserve</dt>
								<dd>{formatShareAmount(market.yesReserve)}</dd>
							</div>
							<div>
								<dt>NO reserve</dt>
								<dd>{formatShareAmount(market.noReserve)}</dd>
							</div>
							<div>
								<dt>Trading fee</dt>
								<dd>{Number(market.feeBps) / 100}%</dd>
							</div>
							<div>
								<dt>Collateral rate</dt>
								<dd>{formatUnits(collateralPerShare)} ETH / share</dd>
							</div>
						</dl>
					</section>
					<section class='section'>
						<div class='section-heading'>
							<div>
								<span class='section-kicker'>Exact identity</span>
								<h2>Protocol references</h2>
							</div>
						</div>
						<dl class='fact-list'>
							<div>
								<dt>Universe</dt>
								<dd>{market.universe}</dd>
							</div>
							<div>
								<dt>Ends</dt>
								<dd>{market.endTime}</dd>
							</div>
							<div>
								<dt>SecurityPool</dt>
								<dd>
									<AddressValue value={market.pool} />
								</dd>
							</div>
							<div>
								<dt>Pool system state</dt>
								<dd>{market.securityPool.systemState}</dd>
							</div>
							<div>
								<dt>Question outcome</dt>
								<dd>{market.securityPool.questionOutcome}</dd>
							</div>
							<div>
								<dt>Statoblast security multiplier</dt>
								<dd>{formatBpsMultiplier(market.securityPool.statoblastSecurityMultiplierBps)}</dd>
							</div>
							<div>
								<dt>Initial report priority fee</dt>
								<dd>{market.securityPool.initialReportPriorityFeeGwei.toString()} gwei</dd>
							</div>
							<div>
								<dt>Active vaults</dt>
								<dd>{market.securityPool.activeVaultCount.toString()}</dd>
							</div>
							<div>
								<dt>Pair</dt>
								<dd>{market.pair === undefined ? 'Not created' : <span title={market.pair}>{shortAddress(market.pair)}</span>}</dd>
							</div>
						</dl>
					</section>
				</aside>
			</div>
		</main>
	)
}
