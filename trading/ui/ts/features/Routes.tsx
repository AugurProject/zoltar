import { useState } from 'preact/hooks'
import { quoteAddLiquidity, quoteInitialLiquidity, quoteRemoveLiquidity } from '../../../ts/sdk/math.ts'
import type { DemoMarket } from '../demo/markets.ts'
import { demoAttoEthToAttoShares, demoWalletBalances, lifecycleLabel } from '../demo/markets.ts'
import { bigintToSafeNumber, formatBpsMultiplier, formatCapacityOwnership, formatShareAmount, formatUnits, parseUnitsOrUndefined } from '../app/format.ts'
import { ProbabilityBar } from '../components/ProbabilityBar.tsx'
import { AddressValue, Status } from '../components/Status.tsx'
import { maximumInsuredExit } from '../../../ts/sdk/positions.ts'
import { shareBalanceScope } from '../protocol/live.ts'

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
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Canonical SecurityPools</span>
					<h1>Markets</h1>
				</div>
				<span class='muted'>Demo discovery snapshot</span>
			</header>
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
						<p>{market.universe}</p>
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
						<div class='market-row__pool-identity'>
							<span>SecurityPool used by this AMM</span>
							<AddressValue value={market.pool} />
						</div>
						<dl>
							<div>
								<dt>System state</dt>
								<dd>{market.securityPool.systemState}</dd>
							</div>
							<div>
								<dt>Outcome</dt>
								<dd>{market.securityPool.questionOutcome}</dd>
							</div>
							<div>
								<dt>Security multiplier</dt>
								<dd>{formatBpsMultiplier(market.securityPool.statoblastSecurityMultiplierBps)}</dd>
							</div>
							<div>
								<dt>Total / fee-eligible capacity ownership</dt>
								<dd>{formatCapacityOwnership(market.securityPool.totalCapacityOwnershipAttoRep, market.securityPool.feeEligibleCapacityOwnershipAttoRep)}</dd>
							</div>
							<div>
								<dt>Minting capacity ceiling</dt>
								<dd>{formatUnits(market.securityPool.mintingCapacityCeilingAttoEth)} ETH</dd>
							</div>
							<div>
								<dt>Available minting capacity</dt>
								<dd>{formatUnits(market.securityPool.availableMintingCapacityAttoEth)} ETH</dd>
							</div>
							<div>
								<dt>Collateral</dt>
								<dd>{formatUnits(market.securityPool.settlementCollateralAttoEth)} ETH</dd>
							</div>
							<div>
								<dt>Fork continuation</dt>
								<dd>{market.securityPool.awaitingForkContinuation ? 'Awaiting' : 'Not awaiting'}</dd>
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
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Separate insurance accounting</span>
					<h1>Liquidity</h1>
					<p>LP tokens represent only YES and NO reserves.</p>
				</div>
				<Status tone={liquidityStatusTone}>{actionAvailability.remove ? 'Removal preview' : liquidityStatus}</Status>
			</header>
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
									<dd>{formatShareAmount(liquidityQuote.initial.yesUsed)}</dd>
								</div>
								<div>
									<dt>NO reserve</dt>
									<dd>{formatShareAmount(liquidityQuote.initial.noUsed)}</dd>
								</div>
								<div>
									<dt>Unused YES returned</dt>
									<dd>{formatShareAmount(liquidityQuote.initial.yesReturned)}</dd>
								</div>
								<div>
									<dt>INVALID retained</dt>
									<dd>{formatShareAmount(liquidityQuote.initial.invalidReturned)}</dd>
								</div>
							</dl>
						)}
						<div class='warning'>
							<strong>LP tokens do not carry insurance.</strong> Transferring LP tokens does not transfer the INVALID retained during this deposit.
						</div>
						<button class='primary-action' disabled>
							Demo preview only · Create pair + initialize
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
										<dd>{formatShareAmount(liquidityQuote.added.yesUsed)}</dd>
									</div>
									<div>
										<dt>NO used</dt>
										<dd>{formatShareAmount(liquidityQuote.added.noUsed)}</dd>
									</div>
									<div>
										<dt>INVALID retained</dt>
										<dd>{formatShareAmount(liquidityQuote.addedCompleteSetShares)}</dd>
									</div>
									<div>
										<dt>Unused NO returned</dt>
										<dd>{formatShareAmount(liquidityQuote.added.noReturned)}</dd>
									</div>
								</dl>
								<button class='secondary-action' disabled>
									Demo preview only · Add proportional liquidity
								</button>
							</div>
						)}
						{removed === undefined ? null : (
							<div class='operation-block'>
								<h3>Remove 100 LP tokens</h3>
								<dl class='metrics'>
									<div>
										<dt>Raw YES returned</dt>
										<dd>{formatShareAmount(removed.yesOut)}</dd>
									</div>
									<div>
										<dt>Raw NO returned</dt>
										<dd>{formatShareAmount(removed.noOut)}</dd>
									</div>
								</dl>
								<p>No INVALID is consumed and no complete set is redeemed.</p>
								<button class='secondary-action' disabled>
									Demo preview only · Remove into raw shares
								</button>
							</div>
						)}
					</section>
				) : null}
			</div>
		</main>
	)
}

export function Portfolio({ market }: { market: DemoMarket }) {
	const scope = shareBalanceScope(market)
	const maximumYesExit = maximumInsuredExit({ longOutcome: 'YES', longBalance: demoWalletBalances.yes, invalidBalance: demoWalletBalances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const maximumNoExit = maximumInsuredExit({ longOutcome: 'NO', longBalance: demoWalletBalances.no, invalidBalance: demoWalletBalances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const yesClaim = market.lpTotalSupply === 0n ? 0n : (market.yesReserve * demoWalletBalances.lp) / market.lpTotalSupply
	const noClaim = market.lpTotalSupply === 0n ? 0n : (market.noReserve * demoWalletBalances.lp) / market.lpTotalSupply
	const completeSetClaim = yesClaim < noClaim ? yesClaim : noClaim
	const coveredClaim = demoWalletBalances.invalid < completeSetClaim ? demoWalletBalances.invalid : completeSetClaim
	const coverageBps = completeSetClaim === 0n ? 0n : (coveredClaim * 10_000n) / completeSetClaim
	const excessYes = demoWalletBalances.yes > maximumYesExit ? demoWalletBalances.yes - maximumYesExit : 0n
	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Selected SecurityPool balances</span>
					<h1>Portfolio</h1>
					<p>{market.question}</p>
				</div>
				<Status tone='neutral'>Demo account</Status>
			</header>
			<section class='section'>
				<div class='section-heading'>
					<h2>Pool identity</h2>
				</div>
				<dl class='fact-list'>
					<div>
						<dt>SecurityPool</dt>
						<dd>
							<AddressValue value={market.pool} />
						</dd>
					</div>
					<div>
						<dt>ShareToken</dt>
						<dd>
							<AddressValue value={market.shareToken} />
						</dd>
					</div>
					<div>
						<dt>Universe</dt>
						<dd>
							{market.universe} · {market.universeId.toString()}
						</dd>
					</div>
					<div>
						<dt>Outcome token IDs</dt>
						<dd>
							INVALID {scope.invalidTokenId.toString()} · YES {scope.yesTokenId.toString()} · NO {scope.noTokenId.toString()}
						</dd>
					</div>
				</dl>
				<p>Balances from other SecurityPools are not included.</p>
			</section>
			<section class='balance-strip'>
				<div>
					<span>YES</span>
					<strong>{formatShareAmount(demoWalletBalances.yes)}</strong>
				</div>
				<div>
					<span>NO</span>
					<strong>{formatShareAmount(demoWalletBalances.no)}</strong>
				</div>
				<div>
					<span>INVALID</span>
					<strong>{formatShareAmount(demoWalletBalances.invalid)}</strong>
				</div>
				<div>
					<span>LP tokens</span>
					<strong>{formatUnits(demoWalletBalances.lp)} LP</strong>
				</div>
			</section>
			<div class='two-column'>
				<section class='section'>
					<div class='section-heading'>
						<div>
							<span class='section-kicker'>Directional coverage</span>
							<h2>Insured exits</h2>
						</div>
					</div>
					<div class='coverage-meter'>
						<div>
							<span>Maximum insured YES exit</span>
							<strong>{formatUnits(maximumYesExit)} sets</strong>
						</div>
						<progress value={bigintToSafeNumber((maximumYesExit * 10_000n) / demoWalletBalances.invalid, 'YES insurance coverage basis points')} max='10000'>
							{formatUnits(maximumYesExit)} of {formatUnits(demoWalletBalances.invalid)}
						</progress>
					</div>
					<div class='coverage-meter'>
						<div>
							<span>Maximum insured NO exit</span>
							<strong>{formatUnits(maximumNoExit)} sets</strong>
						</div>
						<progress value={bigintToSafeNumber((maximumNoExit * 10_000n) / demoWalletBalances.invalid, 'NO insurance coverage basis points')} max='10000'>
							{formatUnits(maximumNoExit)} of {formatUnits(demoWalletBalances.invalid)}
						</progress>
					</div>
				</section>
				<section class='section'>
					<div class='section-heading'>
						<div>
							<span class='section-kicker'>LP reserve claim</span>
							<h2>Liquidity exposure</h2>
						</div>
					</div>
					<dl class='fact-list'>
						<div>
							<dt>Claimed YES reserve</dt>
							<dd>{formatShareAmount(yesClaim)}</dd>
						</div>
						<div>
							<dt>Claimed NO reserve</dt>
							<dd>{formatShareAmount(noClaim)}</dd>
						</div>
						<div>
							<dt>Wallet INVALID</dt>
							<dd>{formatShareAmount(demoWalletBalances.invalid)}</dd>
						</div>
						<div>
							<dt>Estimated covered fraction</dt>
							<dd>{formatUnits(coverageBps, 2, 1)}%</dd>
						</div>
					</dl>
					<p class='muted'>The estimate compares separate wallet INVALID with the complete-set coverage of the reserve claim. The LP token itself is not insured.</p>
				</section>
			</div>
			<section class='section table-section'>
				<div class='section-heading'>
					<div>
						<span class='section-kicker'>One exact branch</span>
						<h2>{market.question}</h2>
					</div>
				</div>
				<div class='table-row'>
					<span>Unresolved directional shares</span>
					<strong>{formatShareAmount(excessYes)} YES above insured exit</strong>
					<a href='#/market'>Manage</a>
				</div>
				<div class='table-row'>
					<span>Approvals</span>
					<strong>Router approved for shares · LP approval required</strong>
					<span class='muted'>Demo approval snapshot</span>
				</div>
			</section>
		</main>
	)
}

export function Help() {
	return (
		<main class='route prose-route' id='main-content'>
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Project guide</span>
					<h1>How the two-way market works</h1>
					<p>A compact guide to conditional pricing, insurance, and early exits.</p>
				</div>
			</header>
			<section class='explanation-flow'>
				<article>
					<span>01</span>
					<h2>Create a complete set</h2>
					<p>Your ETH is sent to the selected Statoblast SecurityPool, which creates equal INVALID, YES, and NO shares at its current exchange rate.</p>
				</article>
				<article>
					<span>02</span>
					<h2>Trade one direction</h2>
					<p>The opposite share enters the constant-product pair. You receive extra shares of your selected outcome.</p>
				</article>
				<article>
					<span>03</span>
					<h2>Keep INVALID</h2>
					<p>Matching INVALID stays in your wallet as insurance. It is never deposited in the pair or represented by LP tokens.</p>
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
					The complete developer and protocol documentation is included in <code>trading/docs/</code>.
				</p>
			</section>
		</main>
	)
}

export function Developer({ demo = true, deploymentStatus = 'loading' }: { demo?: boolean; deploymentStatus?: 'loading' | 'verified' | 'unavailable' }) {
	let liveStatus = 'Checking deployment'
	let liveChain = 'Validating deployment.json against RPC'
	let liveTone: 'good' | 'warn' | 'neutral' = 'neutral'
	let liveNotice = 'Live deployment details remain unavailable until deployment.json and its RPC contracts validate successfully.'
	if (deploymentStatus === 'verified') {
		liveStatus = 'Verified runtime manifest'
		liveChain = 'Read from deployment.json and verified against RPC'
		liveTone = 'good'
		liveNotice = 'The live client validated the RPC chain ID, factory, router, fee, and core SecurityPoolFactory against deployment.json before discovering markets.'
	} else if (deploymentStatus === 'unavailable') {
		liveStatus = 'Deployment unavailable'
		liveChain = 'Unavailable — inspect deployment.json and RPC configuration'
		liveTone = 'warn'
	}
	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Runtime configuration</span>
					<h1>Deployment</h1>
					<p>Addresses are loaded from a project-local manifest. This build never invents public-network deployments.</p>
				</div>
				<Status tone={demo ? 'warn' : liveTone}>{demo ? 'Demo configuration' : liveStatus}</Status>
			</header>
			<section class='section'>
				<dl class='fact-list'>
					<div>
						<dt>Chain</dt>
						<dd>{demo ? 'Anvil · 31337' : liveChain}</dd>
					</div>
					<div>
						<dt>SecurityPoolFactory</dt>
						<dd>Read from core deployment manifest</dd>
					</div>
					<div>
						<dt>Trading factory</dt>
						<dd>Deployed immutably with one fee</dd>
					</div>
					<div>
						<dt>Router</dt>
						<dd>Stateless operation coordinator</dd>
					</div>
					<div>
						<dt>Pair discovery</dt>
						<dd>Factory mapping by exact SecurityPool</dd>
					</div>
				</dl>
				<div class='warning'>{demo ? 'Demo data is simulated and is not evidence of live chain state.' : liveNotice}</div>
			</section>
		</main>
	)
}
