import { escapeHtml, headingId, renderRichText } from './contract-reference-rich-text.mts'

// Exact accounting examples and formulas belong to the contract that enforces them. Explanation pages
// keep the qualitative rule and link here; the numbers below are checked against the Solidity sources
// by tooling/docs/check-docs-reference-values.mts.
export type AccountingExampleBlock = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] } | { kind: 'equation'; id: string; label: string; source: string; mathml: string }

export type AccountingExample = {
	heading: string
	blocks: AccountingExampleBlock[]
}

const paragraph = (text: string): AccountingExampleBlock => ({ kind: 'paragraph', text })
const list = (...items: string[]): AccountingExampleBlock => ({ kind: 'list', items })
// mathml is the structured MathML body so the responsive runtime can wrap and compact it.
const equation = (id: string, label: string, source: string, mathml: string): AccountingExampleBlock => ({ id, kind: 'equation', label, mathml, source })

export const accountingExamplesByContract: ReadonlyMap<string, readonly AccountingExample[]> = new Map<string, readonly AccountingExample[]>([
	[
		'EscalationGame',
		[
			{
				heading: 'Required support threshold',
				blocks: [
					paragraph(
						'The contract waits `activationDelay` (three days) after `start()` before the escalation clock begins. From day 3 the cumulative binding-capital requirement rises from the configured start bond `S` to the non-decision threshold `T` over the seven-week `ESCALATION_TIME_LENGTH`, reaching `T` on day 52. The contract evaluates a fixed-point curve; this expression is its readable idealization.',
					),
					equation(
						'eq-escalation-required-support',
						'required support is zero before day 3, the start bond on day 3, an exponential interpolation from the start bond to the non-decision threshold between days 3 and 52, and the threshold from day 52 onward',
						'A(d) = 0 for 0 ≤ d < 3; S for d = 3; S × exp(ln(T / S) × (d − 3) / 49) for 3 < d < 52; T for d ≥ 52',
						'<mtable><mtr><mtd><mi>A</mi><mo>(</mo><mi>d</mi><mo>)</mo></mtd><mtd><mo>=</mo></mtd><mtd><mn>0</mn></mtd><mtd><mtext>for</mtext><mspace width="0.3em"></mspace><mn>0</mn><mo>≤</mo><mi>d</mi><mo>&lt;</mo><mn>3</mn></mtd></mtr><mtr><mtd></mtd><mtd><mo>=</mo></mtd><mtd><mi>S</mi></mtd><mtd><mtext>for</mtext><mspace width="0.3em"></mspace><mi>d</mi><mo>=</mo><mn>3</mn></mtd></mtr><mtr><mtd></mtd><mtd><mo>=</mo></mtd><mtd><mstyle displaystyle="true"><mi>S</mi><mo>×</mo><mi>exp</mi><mo>(</mo><mi>ln</mi><mo>(</mo><mfrac><mi>T</mi><mi>S</mi></mfrac><mo>)</mo><mo>×</mo><mfrac><mrow><mi>d</mi><mo>−</mo><mn>3</mn></mrow><mn>49</mn></mfrac><mo>)</mo></mstyle></mtd><mtd><mtext>for</mtext><mspace width="0.3em"></mspace><mn>3</mn><mo>&lt;</mo><mi>d</mi><mo>&lt;</mo><mn>52</mn></mtd></mtr><mtr><mtd></mtd><mtd><mo>=</mo></mtd><mtd><mi>T</mi></mtd><mtd><mtext>for</mtext><mspace width="0.3em"></mspace><mi>d</mi><mo>≥</mo><mn>52</mn></mtd></mtr></mtable>',
					),
				],
			},
			{
				heading: 'Winning-deposit payout',
				blocks: [
					paragraph(
						'Binding capital is the median outcome balance at settlement; no outcome balance can exceed the non-decision threshold. The reward-eligible cap is binding capital plus binding capital divided by `EXCESS_REWARD_WINDOW_DIVISOR` (2), so only the portion of winning deposits up to 1.5 × binding capital participates in the bonus. Of the binding capital, `3 / 5` funds the reward pool and `2 / 5` funds the haircut pool; both are shared pro rata across the reward-eligible principal.',
					),
					paragraph('Let binding capital be `10 REP`, so the reward-eligible cap is `10 + 10 / 2 = 15 REP`, the reward pool is `10 × 3 / 5 = 6 REP`, and the haircut pool is `10 × 2 / 5 = 4 REP`. If the winning outcome holds `15 REP` and one deposit contributed `5 REP` inside the eligible range:'),
					list('Principal returned: `5 REP`.', 'Bonus: `5 × 6 / 15 = 2 REP`.', 'Winning payout: `5 + 2 = 7 REP`.', 'Haircut burned: `5 × 4 / 15 = 1.333333333333333333 REP` at attoREP precision.'),
					paragraph(
						"A winning deposit position above `15 REP` returns its principal without a bonus. When Zoltar's fork threshold at settlement is below the game's non-decision threshold, the whole withdrawal is scaled by their ratio. If this game's non-decision threshold were `20 REP` and the fork threshold `16 REP`, the `7 REP` payout becomes `7 × 16 / 20 = 5.6 REP`, rounded down to attoREP. Fork scaling can therefore reduce the final transfer below principal.",
					),
				],
			},
		],
	],
	[
		'SecurityPool',
		[
			{
				heading: 'Retention rate and annualized fee',
				blocks: [
					paragraph(
						'`SecurityPoolUtils.calculateRetentionRate` returns a per-second retention factor scaled by `PRICE_PRECISION` (`1e18`). It equals `MAX_RETENTION_RATE` at zero utilization, declines linearly until utilization reaches `RETENTION_RATE_DIP` (80% of live minting capacity), and stays at `MIN_RETENTION_RATE` above that. Zero live minting capacity selects `MAX_RETENTION_RATE`.',
					),
					list('`MAX_RETENTION_RATE = 999_999_996_848_000_000`, about a 10% yearly fee.', '`MIN_RETENTION_RATE = 999_999_977_880_000_000`, about a 50% yearly fee.'),
					paragraph('Clients annualize a retention rate for display as follows; the contract never computes this value.'),
					equation(
						'eq-securitypool-annual-fee',
						'annual fee equals one minus the retention rate divided by price precision, raised to the number of seconds in a year',
						'annualFee = 1 - (retentionRate / PRICE_PRECISION)^SECONDS_PER_YEAR',
						'<mrow><mi>annualFee</mi><mo>=</mo><mn>1</mn><mo>−</mo><msup><mrow><mo>(</mo><mfrac><mi>retentionRate</mi><mi>PRICE_PRECISION</mi></mfrac><mo>)</mo></mrow><mi>SECONDS_PER_YEAR</mi></msup></mrow>',
					),
				],
			},
			{
				heading: 'Liquidation transfer rounding',
				blocks: [
					paragraph(
						"A liquidation request is an ETH-denominated debt amount. Execution caps it at the target vault's live debt and at the largest amount whose complete REP award (`LIQUIDATION_REP_BONUS_BPS` = 500, so 5%) the target can fund. The proportional capacity ownership that leaves the target is rounded down; the REP backing units that leave it are rounded up. The receiver incurs exactly the reported debt increase and receives those ownership and backing units. Target claims, fees, surplus, and unmatched ownership remain with the target.",
					),
					paragraph(
						"Only a request covering the target's full position records the untransferable remainder as target-local bad debt. Partial requests leave the remainder as ordinary target debt. After the transfer the receiver must remain healthy and any remaining target position must still meet `minimumSecurityBondDebtAttoEth` and `minimumVaultRepDepositAttoRep`, so a liquidation cannot leave unusable dust.",
					),
				],
			},
		],
	],
	[
		'LiquidationApprovalRegistry',
		[
			{
				heading: 'Minimum post-liquidation health factor',
				blocks: [
					paragraph(
						'`minPostLiquidationHealthFactorBps` is applied to both vault-health branches at execution. `10,000` (`BPS_DENOMINATOR`) means exactly the protocol minimum; a larger value requires the receiver to be over-collateralized by that ratio after accepting the position. The factor is checked against live post-liquidation state, not the queue-time preview.',
					),
				],
			},
		],
	],
	[
		'UniformPriceDualCapBatchAuction',
		[
			{
				heading: 'Tick pricing',
				blocks: [
					paragraph(
						'Bids are placed at integer ticks between `MIN_TICK` (`-524288`) and `MAX_TICK` (`524288`). `tickToPrice(0)` is `PRICE_PRECISION`, one ETH per REP. Each tick above zero multiplies the price by 1.0001 through a binary-exponentiation table of `_powerOf1Point0001`; negative ticks take the reciprocal. The price at tick `t` is therefore approximately:',
					),
					equation('eq-auction-tick-price', 'price at tick t is approximately 1.0001 to the power t ETH per REP', 'price(t) ≈ 1.0001^t ETH/REP', '<mrow><mi>price</mi><mo>(</mo><mi>t</mi><mo>)</mo><mo>≈</mo><msup><mn>1.0001</mn><mi>t</mi></msup><mspace width="0.3em"></mspace><mtext>ETH per REP</mtext></mrow>'),
					paragraph('A tick whose price rounds to zero is rejected. Within one tick, the uniform-clearing branch fills bids first in, first out, so earlier same-tick bids are consumed before later ones.'),
				],
			},
		],
	],
])

export function renderAccountingExamples(contractName: string): string {
	const examples = accountingExamplesByContract.get(contractName)
	if (examples === undefined) return ''
	const sections = examples.map(example => `\t<h3 id="${headingId(example.heading)}">${escapeHtml(example.heading)}</h3>\n${example.blocks.map(renderBlock).join('\n')}`)
	return `\n\t<h2 id="accounting-examples">Accounting examples</h2>\n${sections.join('\n')}`
}

function renderBlock(block: AccountingExampleBlock): string {
	if (block.kind === 'paragraph') return `\t<p>${renderRichText(block.text)}</p>`
	if (block.kind === 'list') return `\t<ul>\n${block.items.map(item => `\t\t<li>${renderRichText(item)}</li>`).join('\n')}\n\t</ul>`
	return `\t<div class="equation" id="${escapeHtml(block.id)}"><math display="block" aria-label="${escapeHtml(block.label)}" data-source="${escapeHtml(block.source)}">${block.mathml}</math></div>`
}
