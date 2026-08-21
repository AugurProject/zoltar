import { useState } from 'preact/hooks'
import { quoteAddLiquidity, quoteInitialLiquidity, quoteRemoveLiquidity } from '@zoltar/shared/trading/math'
import type { DemoMarket } from '../demo/markets.js'
import { demoAttoEthToAttoShares, demoWalletBalances, lifecycleLabel } from '../demo/markets.js'
import { bigintToSafeNumber, formatBpsMultiplier, formatCapacityOwnership, formatEthPerShare, formatMintingCapacity, formatOutcomeAmount, formatShareAmount, formatUnits, parseUnitsOrUndefined } from '../lib/format.js'
import { ProbabilityBar } from '../components/ProbabilityBar.js'
import { AddressValue, SecurityPoolAddressLink, Status } from '../components/Status.js'
import { maximumInsuredExit } from '@zoltar/shared/trading/positions'
import { shareBalanceScope } from '../protocol/live.js'
import * as commonCopy from '../copy/common.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import * as appCopy from '../copy/app.js'

function MarketListAction({ market }: { market: DemoMarket }) {
	const initialized = market.pair !== undefined && market.lpTotalSupply > 0n && market.yesReserve > 0n && market.noReserve > 0n
	if (initialized)
		return (
			<a class='row-action' href='#/market'>
				Open market →
			</a>
		)
	if (market.lifecycle !== 'open')
		return (
			<button class='row-action' disabled>
				{lifecycleLabel(market.lifecycle)} · initialization unavailable
			</button>
		)
	return (
		<a class='row-action' href='#/liquidity'>
			{market.pair === undefined ? 'Create + initialize →' : 'Initialize pair →'}
		</a>
	)
}

export function MarketList({ market }: { market: DemoMarket }) {
	const initialized = market.pair !== undefined && market.lpTotalSupply > 0n && market.yesReserve > 0n && market.noReserve > 0n
	const yesPercent = initialized ? bigintToSafeNumber((market.noReserve * 1_000n) / (market.yesReserve + market.noReserve), 'Conditional YES tenths') / 10 : 0
	return (
		<main class='route' id='main-content'>
			<RouteHeader title={appCopy.markets} />
			<section class='market-list'>
				<article class='market-row'>
					<div class='market-row__main'>
						<div class='market-row__top'>
							<Status tone={market.lifecycle === 'open' ? 'good' : 'warn'}>{lifecycleLabel(market.lifecycle)}</Status>
							<span>{market.endTime}</span>
						</div>
						<h2>
							<a href='#/market'>{market.question}</a>
						</h2>
					</div>
					<div class='market-row__price'>{initialized ? <ProbabilityBar yesPercent={yesPercent} /> : <p class='muted'>Conditional price available after initialization.</p>}</div>
					<dl class='market-row__metrics'>
						<div>
							<dt>Liquidity</dt>
							<dd>{market.pair === undefined ? 'Pair not created' : formatShareAmount(market.yesReserve + market.noReserve)}</dd>
						</div>
						<div>
							<dt>Fee</dt>
							<dd>{formatUnits(market.feeBps, 2, 2)}%</dd>
						</div>
					</dl>
					<MarketListAction market={market} />
					<div class='market-row__pool'>
						<dl>
							<div class='market-row__pool-address'>
								<dt>Security pool</dt>
								<dd>
									<SecurityPoolAddressLink value={market.pool} />
								</dd>
							</div>
						</dl>
					</div>
				</article>
			</section>
		</main>
	)
}

export function liquidityActionAvailability(market: DemoMarket) {
	const open = market.lifecycle === 'open'
	const initialized = market.pair !== undefined && market.lpTotalSupply > 0n
	return { initialize: open && !initialized, add: open && initialized, remove: initialized } as const
}

export function quoteDemoEthLiquidity(market: DemoMarket, targetBps: bigint) {
	const initialCompleteSetShares = demoAttoEthToAttoShares(1n * 10n ** 18n, market)
	const addedCompleteSetShares = demoAttoEthToAttoShares(1n * 10n ** 17n, market)
	return {
		initial: quoteInitialLiquidity(initialCompleteSetShares, targetBps),
		added: market.yesReserve === 0n || market.noReserve === 0n ? undefined : quoteAddLiquidity(market.yesReserve, market.noReserve, addedCompleteSetShares, addedCompleteSetShares),
		addedCompleteSetShares,
	} as const
}

export function quoteDemoRemoval(market: DemoMarket, liquidity: bigint) {
	return quoteRemoveLiquidity(market.yesReserve, market.noReserve, liquidity, market.lpTotalSupply)
}

export function parseConditionalProbabilityBps(input: string): { value: bigint | undefined; error: string | undefined } {
	const value = parseUnitsOrUndefined(input, 2)
	if (value === undefined) return { value: undefined, error: 'Enter a percentage with at most two decimal places.' }
	if (value === 0n) return { value: undefined, error: 'Conditional YES price must be above 0%.' }
	if (value >= 10_000n) return { value: undefined, error: 'Conditional YES price must be below 100%.' }
	return { value, error: undefined }
}

export function Liquidity({ market }: { market: DemoMarket }) {
	const [probability, setProbability] = useState('70')
	const parsedProbability = parseConditionalProbabilityBps(probability)
	const liquidityQuote = parsedProbability.value === undefined ? undefined : quoteDemoEthLiquidity(market, parsedProbability.value)
	const actionAvailability = liquidityActionAvailability(market)
	const removed = actionAvailability.remove ? quoteDemoRemoval(market, 100n * 10n ** 18n) : undefined
	const closedReason = market.lifecycle === 'open' ? undefined : lifecycleLabel(market.lifecycle)
	let liquidityStatusTone: 'good' | 'neutral' | 'warn' = 'neutral'
	let liquidityStatus = 'No LP liquidity yet'
	if (actionAvailability.remove) {
		liquidityStatusTone = 'good'
		liquidityStatus = 'Removal available'
	} else if (closedReason !== undefined) {
		liquidityStatusTone = 'warn'
		liquidityStatus = `${closedReason} · initialization unavailable`
	}
	return (
		<main class='route' id='main-content'>
			<RouteHeader eyebrow={appCopy.separateInvalidAccounting} title={appCopy.liquidity} description={appCopy.liquidityDescription} badge={<Status tone={liquidityStatusTone}>{actionAvailability.remove ? appCopy.removalPreview : liquidityStatus}</Status>} />
			<div class='two-column'>
				{closedReason !== undefined && !actionAvailability.remove ? (
					<section class='section'>
						<div class='section-heading'>
							<div>
								<span class='section-kicker'>Lifecycle blocker</span>
								<h2>{closedReason}</h2>
							</div>
						</div>
						<p>This SecurityPool cannot create or initialize a pair after the market closes. There is no LP position to remove.</p>
						<button class='primary-action' disabled>
							{closedReason} — pair initialization unavailable
						</button>
					</section>
				) : null}
				{actionAvailability.initialize ? (
					<section class='section'>
						<div class='section-heading'>
							<div>
								<span class='section-kicker'>Uninitialized pair</span>
								<h2>Create and initialize atomically</h2>
							</div>
						</div>
						<label class='field'>
							<span>ETH amount</span>
							<div class='amount-input'>
								<input value='1.0' readOnly />
								<span>ETH</span>
							</div>
						</label>
						<label class='field'>
							<span>Target Conditional YES price</span>
							<div class='amount-input'>
								<input value={probability} inputMode='decimal' aria-invalid={parsedProbability.error !== undefined} aria-describedby={parsedProbability.error === undefined ? undefined : 'conditional-price-error'} onInput={event => setProbability(event.currentTarget.value)} />
								<span>%</span>
							</div>
							{parsedProbability.error === undefined ? null : (
								<small class='error' id='conditional-price-error' role='alert'>
									{parsedProbability.error}
								</small>
							)}
						</label>
						{parsedProbability.value === undefined ? null : <ProbabilityBar yesPercent={bigintToSafeNumber(parsedProbability.value, 'Conditional probability basis points') / 100} />}
						{liquidityQuote === undefined ? null : (
							<dl class='metrics'>
								<div>
									<dt>YES reserve</dt>
									<dd>{formatOutcomeAmount(liquidityQuote.initial.yesUsed, 'YES')}</dd>
								</div>
								<div>
									<dt>NO reserve</dt>
									<dd>{formatOutcomeAmount(liquidityQuote.initial.noUsed, 'NO')}</dd>
								</div>
								<div>
									<dt>Unused YES returned</dt>
									<dd>{formatOutcomeAmount(liquidityQuote.initial.yesReturned, 'YES')}</dd>
								</div>
								<div>
									<dt>INVALID retained</dt>
									<dd>{formatOutcomeAmount(liquidityQuote.initial.invalidReturned, 'INVALID')}</dd>
								</div>
							</dl>
						)}
						<div class='warning'>
							<strong>LP tokens do not include wallet INVALID.</strong> Transferring LP tokens does not transfer the INVALID retained during this deposit.
						</div>
						<button class='primary-action' disabled>
							Create pair + initialize
						</button>
					</section>
				) : null}
				{actionAvailability.add || actionAvailability.remove ? (
					<section class='section'>
						<div class='section-heading'>
							<div>
								<span class='section-kicker'>Initialized pair</span>
								<h2>{actionAvailability.add ? 'Add or remove liquidity' : 'Remove liquidity'}</h2>
							</div>
						</div>
						{liquidityQuote?.added === undefined || !actionAvailability.add ? null : (
							<div class='operation-block'>
								<h3>Add from 0.1 ETH</h3>
								<dl class='metrics'>
									<div>
										<dt>YES used</dt>
										<dd>{formatOutcomeAmount(liquidityQuote.added.yesUsed, 'YES')}</dd>
									</div>
									<div>
										<dt>NO used</dt>
										<dd>{formatOutcomeAmount(liquidityQuote.added.noUsed, 'NO')}</dd>
									</div>
									<div>
										<dt>INVALID retained</dt>
										<dd>{formatOutcomeAmount(liquidityQuote.addedCompleteSetShares, 'INVALID')}</dd>
									</div>
									<div>
										<dt>Unused NO returned</dt>
										<dd>{formatOutcomeAmount(liquidityQuote.added.noReturned, 'NO')}</dd>
									</div>
								</dl>
								<button class='secondary-action' disabled>
									Add proportional liquidity
								</button>
							</div>
						)}
						{removed === undefined ? null : (
							<div class='operation-block'>
								<h3>Remove 100 LP tokens</h3>
								<dl class='metrics'>
									<div>
										<dt>Raw YES returned</dt>
										<dd>{formatOutcomeAmount(removed.yesOut, 'YES')}</dd>
									</div>
									<div>
										<dt>Raw NO returned</dt>
										<dd>{formatOutcomeAmount(removed.noOut, 'NO')}</dd>
									</div>
								</dl>
								<p>No INVALID is consumed and no complete set is redeemed.</p>
								<button class='secondary-action' disabled>
									Remove into raw shares
								</button>
							</div>
						)}
					</section>
				) : null}
			</div>
		</main>
	)
}

type DemoPortfolioBalances = Readonly<{ yes: bigint; no: bigint; invalid: bigint; lp: bigint }>

function DemoPortfolioGroup({ market, balances }: { market: DemoMarket; balances: DemoPortfolioBalances }) {
	const maximumYesExit = maximumInsuredExit({ longOutcome: 'YES', longBalance: balances.yes, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const maximumNoExit = maximumInsuredExit({ longOutcome: 'NO', longBalance: balances.no, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const yesClaim = market.lpTotalSupply === 0n ? 0n : (market.yesReserve * balances.lp) / market.lpTotalSupply
	const noClaim = market.lpTotalSupply === 0n ? 0n : (market.noReserve * balances.lp) / market.lpTotalSupply
	const completeSetClaim = yesClaim < noClaim ? yesClaim : noClaim
	const coveredClaim = balances.invalid < completeSetClaim ? balances.invalid : completeSetClaim
	const coverageBps = completeSetClaim === 0n ? 0n : (coveredClaim * 10_000n) / completeSetClaim
	return (
		<section class='section portfolio-pool' data-portfolio-pool={market.pool}>
			<div class='section-heading'>
				<div>
					<span class='section-kicker'>SecurityPool position</span>
					<h2>{market.question}</h2>
				</div>
			</div>
			<dl class='fact-list'>
				<div>
					<dt>Security pool</dt>
					<dd>
						<SecurityPoolAddressLink value={market.pool} />
					</dd>
				</div>
			</dl>
			<section class='balance-strip'>
				<div>
					<span>YES</span>
					<strong>{formatOutcomeAmount(balances.yes, 'YES')}</strong>
				</div>
				<div>
					<span>NO</span>
					<strong>{formatOutcomeAmount(balances.no, 'NO')}</strong>
				</div>
				<div>
					<span>INVALID</span>
					<strong>{formatOutcomeAmount(balances.invalid, 'INVALID')}</strong>
				</div>
				<div>
					<span>LP tokens</span>
					<strong>{formatUnits(balances.lp)} LP</strong>
				</div>
			</section>
			<div class='portfolio-position-metrics'>
				<dl class='fact-list'>
					<div>
						<dt>Maximum insured YES exit</dt>
						<dd>{formatOutcomeAmount(maximumYesExit, 'YES')}</dd>
					</div>
					<div>
						<dt>Maximum insured NO exit</dt>
						<dd>{formatOutcomeAmount(maximumNoExit, 'NO')}</dd>
					</div>
					<div>
						<dt>LP YES / NO claim</dt>
						<dd>
							{formatOutcomeAmount(yesClaim, 'YES')} / {formatOutcomeAmount(noClaim, 'NO')}
						</dd>
					</div>
					<div>
						<dt>LP claim covered by wallet INVALID</dt>
						<dd>{formatUnits(coverageBps, 2, 1)}%</dd>
					</div>
				</dl>
			</div>
		</section>
	)
}

export function SecurityPoolDetails({ market }: { market: DemoMarket }) {
	const scope = shareBalanceScope(market)
	return (
		<main class='route' id='main-content'>
			<RouteHeader eyebrow={<a href='#/markets'>{appCopy.backToMarkets}</a>} title={appCopy.securityPool} description={market.question} />
			<section class='section'>
				<dl class='fact-list'>
					<div>
						<dt>Security pool address</dt>
						<dd>
							<AddressValue value={market.pool} />
						</dd>
					</div>
					<div>
						<dt>Share token address</dt>
						<dd>
							<AddressValue value={market.shareToken} />
						</dd>
					</div>
					<div>
						<dt>Outcome token IDs</dt>
						<dd>
							INVALID {scope.invalidTokenId.toString()} · YES {scope.yesTokenId.toString()} · NO {scope.noTokenId.toString()}
						</dd>
					</div>
					<div>
						<dt>System state</dt>
						<dd>{market.securityPool.systemState}</dd>
					</div>
					{market.securityPool.questionOutcome === 'Unresolved' ? null : (
						<div>
							<dt>Outcome</dt>
							<dd>{market.securityPool.questionOutcome}</dd>
						</div>
					)}
					<div>
						<dt>Security multiplier</dt>
						<dd>{formatBpsMultiplier(market.securityPool.statoblastSecurityMultiplierBps)}</dd>
					</div>
					<div>
						<dt>Initial report priority fee</dt>
						<dd>{formatUnits(market.securityPool.initialReportPriorityFeeAttoEthPerGas, 9)} nETH / gas</dd>
					</div>
					<div>
						<dt>Registered vaults</dt>
						<dd>{market.securityPool.vaultCount.toString()}</dd>
					</div>
					<div>
						<dt>Total / fee-eligible capacity ownership</dt>
						<dd>{formatCapacityOwnership(market.securityPool.totalCapacityOwnershipAttoRep, market.securityPool.feeEligibleCapacityOwnershipAttoRep)}</dd>
					</div>
					<div>
						<dt>Minting capacity</dt>
						<dd>{formatMintingCapacity(market.securityPool.settlementCollateralAttoEth, market.securityPool.mintingCapacityCeilingAttoEth)}</dd>
					</div>
					<div>
						<dt>Checkpointed collateral / share ratio</dt>
						<dd>{formatEthPerShare(market.securityPool.settlementCollateralAttoEth, market.securityPool.shareTokenSupplyAttoShares)}</dd>
					</div>
				</dl>
			</section>
		</main>
	)
}

export function Portfolio({ market }: { market: DemoMarket }) {
	return (
		<main class='route' id='main-content'>
			<RouteHeader title={appCopy.portfolio} />
			<div class='portfolio-groups'>
				<DemoPortfolioGroup market={market} balances={demoWalletBalances} />
			</div>
		</main>
	)
}

export function Help() {
	return (
		<main class='route prose-route' id='main-content'>
			<RouteHeader eyebrow={appCopy.projectGuide} title={appCopy.marketGuide} />
			<section class='explanation-flow'>
				<article>
					<span>01</span>
					<h2>Create a complete set</h2>
					<p>Your ETH is sent to the selected Statoblast security pool, which creates equal amounts of INVALID, YES, and NO at its current exchange rate.</p>
				</article>
				<article>
					<span>02</span>
					<h2>Trade one direction</h2>
					<p>The opposite share enters the constant-product pair. You receive extra shares of your selected outcome.</p>
				</article>
				<article>
					<span>03</span>
					<h2>Retain INVALID</h2>
					<p>Matching INVALID stays in your wallet and is required alongside YES and NO to redeem a complete set.</p>
				</article>
				<article>
					<span>04</span>
					<h2>Exit a covered amount</h2>
					<p>The router buys the missing opposite share, combines a full set, and redeems current collateral value to ETH.</p>
				</article>
			</section>
			<section class='section prose'>
				<h2>What the price means</h2>
				<p>Conditional YES and NO prices sum to 100% because the pair compares only valid outcomes. This does not say INVALID has zero probability; the AMM has no invalidity estimate at all.</p>
				<h2>Why profit can remain as shares</h2>
				<p>
					An insured ETH exit requires one INVALID for every complete set redeemed. If a profitable position contains more directional shares than matching INVALID, the excess remains transferable but cannot be converted into complete sets without acquiring more INVALID. After resolution, those excess shares redeem
					collateral only if their outcome won.
				</p>
				<p>
					{commonCopy.developerDocumentation} <code>{commonCopy.developerDocumentationPath}</code>.
				</p>
			</section>
		</main>
	)
}
