import { useState } from 'preact/hooks'
import { quoteAddLiquidity, quoteInitialLiquidity, quoteRemoveLiquidity } from '../../../ts/sdk/math.ts'
import type { DemoMarket } from '../demo/markets.ts'
import { lifecycleLabel } from '../demo/markets.ts'
import { formatUnits, shortAddress } from '../app/format.ts'
import { ProbabilityBar } from '../components/ProbabilityBar.tsx'
import { Status } from '../components/Status.tsx'

export function MarketList({ market }: { market: DemoMarket }) {
	const yesPercent = Number((market.noReserve * 1_000n) / (market.yesReserve + market.noReserve)) / 10
	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Canonical SecurityPools</span>
					<h1>Markets</h1>
					<p>Trade valid-resolution outcomes while retaining INVALID insurance in your wallet.</p>
				</div>
				<button class='secondary-action'>Refresh discovery</button>
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
						<p>
							{market.universe} · Pool {shortAddress(market.pool)}
						</p>
					</div>
					<div class='market-row__price'>
						<ProbabilityBar yesPercent={yesPercent} />
					</div>
					<dl class='market-row__metrics'>
						<div>
							<dt>Liquidity</dt>
							<dd>{market.pair === undefined ? 'Pair not created' : '1,428.57 shares'}</dd>
						</div>
						<div>
							<dt>Fee</dt>
							<dd>{Number(market.feeBps) / 100}%</dd>
						</div>
					</dl>
					<a class='row-action' href={market.pair === undefined ? '#/liquidity' : '#/market'}>
						{market.pair === undefined ? 'Create + initialize' : 'Open market'} →
					</a>
				</article>
			</section>
		</main>
	)
}

export function Liquidity({ market }: { market: DemoMarket }) {
	const [probability, setProbability] = useState('70')
	const targetBps = BigInt(Math.max(1, Math.min(99, Number(probability) || 0))) * 100n
	const initial = quoteInitialLiquidity(1_000n * 10n ** 18n, targetBps)
	const added = quoteAddLiquidity(market.yesReserve, market.noReserve, 100n * 10n ** 18n, 100n * 10n ** 18n)
	const removed = quoteRemoveLiquidity(market.yesReserve, market.noReserve, 100n * 10n ** 18n, 428_571n * 10n ** 18n)
	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Separate insurance accounting</span>
					<h1>Liquidity</h1>
					<p>LP tokens represent only the pair’s YES and NO reserves. INVALID remains in the provider wallet.</p>
				</div>
				<Status tone='good'>Removal always available</Status>
			</header>
			<div class='two-column'>
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
							<input value={probability} inputMode='numeric' onInput={event => setProbability(event.currentTarget.value)} />
							<span>%</span>
						</div>
					</label>
					<ProbabilityBar yesPercent={Number(targetBps) / 100} />
					<dl class='metrics'>
						<div>
							<dt>YES reserve</dt>
							<dd>{formatUnits(initial.yesUsed)}</dd>
						</div>
						<div>
							<dt>NO reserve</dt>
							<dd>{formatUnits(initial.noUsed)}</dd>
						</div>
						<div>
							<dt>Unused YES returned</dt>
							<dd>{formatUnits(initial.yesReturned)}</dd>
						</div>
						<div>
							<dt>INVALID retained</dt>
							<dd>{formatUnits(initial.invalidReturned)}</dd>
						</div>
					</dl>
					<div class='warning'>
						<strong>LP tokens do not carry insurance.</strong> Transferring LP tokens does not transfer the INVALID retained during this deposit.
					</div>
					<button class='primary-action'>Create pair + initialize</button>
				</section>
				<section class='section'>
					<div class='section-heading'>
						<div>
							<span class='section-kicker'>Initialized pair</span>
							<h2>Add or remove liquidity</h2>
						</div>
					</div>
					<div class='operation-block'>
						<h3>Add from 0.1 ETH</h3>
						<dl class='metrics'>
							<div>
								<dt>YES used</dt>
								<dd>{formatUnits(added.yesUsed)}</dd>
							</div>
							<div>
								<dt>NO used</dt>
								<dd>{formatUnits(added.noUsed)}</dd>
							</div>
							<div>
								<dt>INVALID retained</dt>
								<dd>100.0000</dd>
							</div>
							<div>
								<dt>Unused NO returned</dt>
								<dd>{formatUnits(added.noReturned)}</dd>
							</div>
						</dl>
						<button class='secondary-action'>Add proportional liquidity</button>
					</div>
					<div class='operation-block'>
						<h3>Remove 100 LP tokens</h3>
						<dl class='metrics'>
							<div>
								<dt>Raw YES returned</dt>
								<dd>{formatUnits(removed.yesOut)}</dd>
							</div>
							<div>
								<dt>Raw NO returned</dt>
								<dd>{formatUnits(removed.noOut)}</dd>
							</div>
						</dl>
						<p>No INVALID is consumed and no complete set is redeemed.</p>
						<button class='secondary-action'>Remove into raw shares</button>
					</div>
				</section>
			</div>
		</main>
	)
}

export function Portfolio({ market }: { market: DemoMarket }) {
	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Aggregate wallet balances</span>
					<h1>Portfolio</h1>
					<p>Coverage is derived from wallet balances, not individually tracked on-chain positions.</p>
				</div>
				<Status tone='neutral'>Demo account</Status>
			</header>
			<section class='balance-strip'>
				<div>
					<span>YES</span>
					<strong>1,820.42</strong>
				</div>
				<div>
					<span>NO</span>
					<strong>184.09</strong>
				</div>
				<div>
					<span>INVALID</span>
					<strong>750.00</strong>
				</div>
				<div>
					<span>LP tokens</span>
					<strong>428.57</strong>
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
							<strong>438.01 sets</strong>
						</div>
						<progress value='438' max='750'>
							438 of 750
						</progress>
						<small>Bounded by the YES required to buy matching NO from current reserves.</small>
					</div>
					<div class='coverage-meter'>
						<div>
							<span>Maximum insured NO exit</span>
							<strong>153.74 sets</strong>
						</div>
						<progress value='154' max='750'>
							154 of 750
						</progress>
						<small>Bounded by wallet NO and available pair YES.</small>
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
							<dd>428.57 shares</dd>
						</div>
						<div>
							<dt>Claimed NO reserve</dt>
							<dd>1,000.00 shares</dd>
						</div>
						<div>
							<dt>Wallet INVALID</dt>
							<dd>750.00 shares</dd>
						</div>
						<div>
							<dt>Estimated covered fraction</dt>
							<dd>75.0%</dd>
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
					<strong>1,254.51 YES above insured exit</strong>
					<a href='#/market'>Manage</a>
				</div>
				<div class='table-row'>
					<span>Approvals</span>
					<strong>Router approved for shares · LP approval required</strong>
					<button class='link-button'>Review</button>
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
					<p>Your ETH creates equal INVALID, YES, and NO shares at the SecurityPool’s current exchange rate.</p>
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
				<p>An insured ETH exit requires one INVALID for every complete set redeemed. If a profitable position contains more directional shares than matching INVALID, the excess remains transferable and redeemable after resolution, but cannot be converted into complete sets without acquiring more INVALID.</p>
				<p>
					<a href='./docs/index.md'>Open the complete project documentation →</a>
				</p>
			</section>
		</main>
	)
}

export function Developer() {
	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Runtime configuration</span>
					<h1>Deployment</h1>
					<p>Addresses are loaded from a project-local manifest. This build never invents public-network deployments.</p>
				</div>
				<Status tone='warn'>Demo configuration</Status>
			</header>
			<section class='section'>
				<dl class='fact-list'>
					<div>
						<dt>Chain</dt>
						<dd>Anvil · 31337</dd>
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
				<div class='warning'>Demo data is simulated and is not evidence of live chain state.</div>
			</section>
		</main>
	)
}
