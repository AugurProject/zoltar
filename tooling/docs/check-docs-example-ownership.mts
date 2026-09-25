import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { attoPrecision, auctionRules, computeWinningWithdrawal, escalationPayoutExample, escalationRules, escalationTimeLengthSeconds, formatRep, liquidationRules, retentionRules, type RoundingDirection } from './contract-reference-rules.mts'
import { htmlToDocumentationText } from './docs-html-text.mts'

// Exact numbers live on the generated contract pages; explanation pages keep the rule and link there.
// The accounting rules are structured data, so this check compares each rule with the Solidity that
// enforces it instead of freezing a sentence of the rendered text.
export async function assertAccountingExampleOwnership(): Promise<void> {
	await assertExplanationPagesDelegateToReference()
	await assertEscalationRulesMatchContracts()
	await assertRetentionRulesMatchContracts()
	await assertLiquidationRulesMatchContracts()
	await assertAuctionRulesMatchContracts()
	await assertGeneratedPagesRenderComputedValues()
}

async function assertExplanationPagesDelegateToReference(): Promise<void> {
	const escalationGameHtml = await readFile('docs/explanation/escalation-game.html', 'utf8')
	const feesHtml = await readFile('docs/explanation/fees.html', 'utf8')
	const liquidationsHtml = await readFile('docs/explanation/liquidations.html', 'utf8')
	const truthAuctionsHtml = await readFile('docs/explanation/truth-auctions.html', 'utf8')
	assert.match(escalationGameHtml, /href="\.\.\/reference\/merkle-mountain-range\.html"/)
	assert.match(escalationGameHtml, /href="\.\.\/reference\/contracts\/escalationgame\.html#winning-deposit-payout"/, 'escalation explanation must delegate the exact payout to the EscalationGame reference')
	assert.match(escalationGameHtml, /href="\.\.\/reference\/contracts\/escalationgame\.html#required-support-threshold"/, 'escalation explanation must delegate the attrition curve to the EscalationGame reference')
	assert.doesNotMatch(escalationGameHtml, /class="equation"/, 'escalation explanation must not repeat the attrition formula')
	assert.match(feesHtml, /href="\.\.\/reference\/contracts\/securitypool\.html#retention-rate-and-annualized-fee"/, 'fees explanation must delegate retention constants to the SecurityPool reference')
	assert.doesNotMatch(feesHtml, /class="equation"/, 'fees explanation must not repeat the annualization formula')
	assert.match(liquidationsHtml, /href="\.\.\/reference\/contracts\/securitypool\.html#liquidation-transfer-rounding"/, 'liquidation explanation must delegate rounding to the SecurityPool reference')
	assert.match(liquidationsHtml, /href="\.\.\/reference\/contracts\/liquidationapprovalregistry\.html#minimum-post-liquidation-health-factor"/, 'liquidation explanation must delegate the health-factor field to the registry reference')
	assert.match(truthAuctionsHtml, /href="\.\.\/reference\/contracts\/uniformpricedualcapbatchauction\.html#tick-pricing"/, 'truth auction explanation must delegate tick pricing to the auction reference')
	assert.doesNotMatch(truthAuctionsHtml, /class="equation"/, 'truth auction explanation must not repeat the tick price formula')
}

function solidityConstant(source: string, name: string, sourceLabel: string): bigint {
	const match = source.match(new RegExp(`\\b${name} = (-?\\d[\\d_]*)`))
	assert.ok(match?.[1] !== undefined, `${sourceLabel} must define ${name} as an integer literal`)
	return BigInt(match[1].replaceAll('_', ''))
}

function solidityFunction(source: string, name: string, sourceLabel: string): string {
	const match = source.match(new RegExp(`function ${name}\\([^{]*\\{[\\s\\S]*?\\n\\t\\}`))
	assert.ok(match !== null, `${sourceLabel} must define ${name}`)
	return match[0]
}

// Math.mulDiv rounds down unless the call names Math.Rounding.Ceil; a statement's direction follows its call.
function roundingDirectionOf(statement: string, label: string): RoundingDirection {
	assert.match(statement, /Math\.mulDiv\(/, `${label} must compute through Math.mulDiv so its rounding direction is explicit`)
	return statement.includes('Math.Rounding.Ceil') ? 'up' : 'down'
}

async function assertEscalationRulesMatchContracts(): Promise<void> {
	const proofVerifier = await readFile('solidity/contracts/statoblast/EscalationGameProofVerifier.sol', 'utf8')
	const escalationGameTypes = await readFile('solidity/contracts/statoblast/EscalationGameTypes.sol', 'utf8')
	const escalationGameStorage = await readFile('solidity/contracts/statoblast/EscalationGameStorage.sol', 'utf8')
	assert.equal(solidityConstant(escalationGameTypes, 'EXCESS_REWARD_WINDOW_DIVISOR', 'EscalationGameTypes.sol'), escalationRules.excessRewardWindowDivisor)
	assert.equal(solidityConstant(escalationGameTypes, 'ESCALATION_TIME_LENGTH', 'EscalationGameTypes.sol'), escalationTimeLengthSeconds)
	const activationDelay = escalationGameStorage.match(/activationDelay = (\d+) days;/)
	assert.ok(activationDelay?.[1] !== undefined, 'EscalationGameStorage.sol must define activationDelay in days')
	assert.equal(BigInt(activationDelay[1]), escalationRules.activationDays)
	const directWithdrawal = solidityFunction(proofVerifier, 'computeWinningWithdrawal', 'EscalationGameProofVerifier.sol')
	assert.match(
		directWithdrawal,
		/computeAllocatedWinningWithdrawal\(depositAmountAttoRep, depositAmountAttoRep, cumulativeAmountAttoRep, bindingCapitalAttoRep, winningOutcomeBalanceAttoRep, actualForkThresholdAttoRep, nonDecisionThresholdAttoRep\)/,
		'direct withdrawals must use the deposit amount as both principal and reward basis',
	)
	const withdrawal = solidityFunction(proofVerifier, 'computeAllocatedWinningWithdrawal', 'EscalationGameProofVerifier.sol')
	assert.match(withdrawal, /bindingCapitalAttoRep \+ bindingCapitalAttoRep \/ EXCESS_REWARD_WINDOW_DIVISOR/, 'the reward-eligible cap must add binding capital divided by the excess-reward window divisor')
	const pools = [...withdrawal.matchAll(/\(\(bindingCapitalAttoRep \* (\d+)\) \/ (\d+)\)/g)].map(match => ({ denominator: BigInt(match[2] ?? ''), numerator: BigInt(match[1] ?? '') }))
	assert.deepEqual(pools, [
		{ denominator: escalationRules.poolDenominator, numerator: escalationRules.rewardPoolNumerator },
		{ denominator: escalationRules.poolDenominator, numerator: escalationRules.haircutPoolNumerator },
	])
	assert.match(withdrawal, /bonusAttoRep =\s*\(rewardEligibleDepositAttoRep \* \(\(bindingCapitalAttoRep \* \d+\) \/ \d+\)\) \/ rewardEligiblePrincipalAttoRep;/, 'the bonus must share the reward pool pro rata across the reward-eligible principal')
	assert.match(withdrawal, /burnAmountAttoRep =\s*\(rewardEligibleDepositAttoRep \* \(\(bindingCapitalAttoRep \* \d+\) \/ \d+\)\) \/ rewardEligiblePrincipalAttoRep;/, 'the haircut must share the haircut pool pro rata across the reward-eligible principal')
	assert.match(withdrawal, /if \(actualForkThresholdAttoRep < nonDecisionThresholdAttoRep\) \{\s*amountToWithdrawAttoRep =\s*\(amountToWithdrawAttoRep \* actualForkThresholdAttoRep\) \/ nonDecisionThresholdAttoRep;/, 'fork scaling must multiply by the actual fork threshold over the non-decision threshold')
	// The published example must be a legal game state: balances never exceed the non-decision threshold.
	assert.ok(escalationPayoutExample.winningOutcomeBalanceAttoRep <= escalationPayoutExample.nonDecisionThresholdAttoRep, 'the winning balance in the example cannot exceed the non-decision threshold')
	assert.ok(escalationPayoutExample.cumulativeAmountAttoRep <= escalationPayoutExample.winningOutcomeBalanceAttoRep, 'the example deposit must sit inside the winning balance')
	// Sanity-check the TypeScript port with a boundary the Solidity guarantees: a full-cap position pays the whole pool.
	const wholeCap = computeWinningWithdrawal({ ...escalationPayoutExample, cumulativeAmountAttoRep: 15n * attoPrecision, depositAmountAttoRep: 15n * attoPrecision, winningOutcomeBalanceAttoRep: 15n * attoPrecision })
	assert.equal(wholeCap.rewardEligiblePrincipalAttoRep, wholeCap.rewardEligibleCapAttoRep, 'a winning balance at the cap makes the principal equal the cap')
	assert.equal(wholeCap.bonusAttoRep, wholeCap.rewardPoolAttoRep)
	assert.equal(wholeCap.burnAttoRep, wholeCap.haircutPoolAttoRep)
	// The pools are divided by the reward-eligible principal, not the cap. Exercise a winning balance below the cap so the
	// two differ; the published divisor must follow the principal.
	const belowCap = computeWinningWithdrawal({ ...escalationPayoutExample, cumulativeAmountAttoRep: 12n * attoPrecision, winningOutcomeBalanceAttoRep: 12n * attoPrecision })
	assert.ok(belowCap.rewardEligiblePrincipalAttoRep < belowCap.rewardEligibleCapAttoRep, 'the below-cap case must make the principal smaller than the cap')
	assert.equal(belowCap.bonusAttoRep, (escalationPayoutExample.depositAmountAttoRep * belowCap.rewardPoolAttoRep) / belowCap.rewardEligiblePrincipalAttoRep, 'the bonus must divide by the reward-eligible principal')
	assert.equal(belowCap.burnAttoRep, (escalationPayoutExample.depositAmountAttoRep * belowCap.haircutPoolAttoRep) / belowCap.rewardEligiblePrincipalAttoRep, 'the haircut must divide by the reward-eligible principal')
}

async function assertRetentionRulesMatchContracts(): Promise<void> {
	const securityPoolUtils = await readFile('solidity/contracts/statoblast/SecurityPoolUtils.sol', 'utf8')
	assert.equal(solidityConstant(securityPoolUtils, 'MAX_RETENTION_RATE', 'SecurityPoolUtils.sol'), retentionRules.maxRetentionRate)
	assert.equal(solidityConstant(securityPoolUtils, 'MIN_RETENTION_RATE', 'SecurityPoolUtils.sol'), retentionRules.minRetentionRate)
	const dip = securityPoolUtils.match(/RETENTION_RATE_DIP = \((\d+) \* PRICE_PRECISION\) \/ 100;/)
	assert.ok(dip?.[1] !== undefined, 'SecurityPoolUtils.sol must express RETENTION_RATE_DIP as a percentage of PRICE_PRECISION')
	assert.equal(BigInt(dip[1]), retentionRules.dipUtilizationPercent)
	assert.match(
		securityPoolUtils,
		/if \(mintingCapacityAttoEth == 0\) return MAX_RETENTION_RATE;[\s\S]*if \(utilization <= RETENTION_RATE_DIP\) \{[\s\S]*return MAX_RETENTION_RATE - \(slopeSpan \* utilizationRatio\) \/ PRICE_PRECISION;[\s\S]*return MIN_RETENTION_RATE;/,
		'retention must be maximal at zero capacity, linear until the dip, then minimal',
	)
}

async function assertLiquidationRulesMatchContracts(): Promise<void> {
	const securityPoolUtils = await readFile('solidity/contracts/statoblast/SecurityPoolUtils.sol', 'utf8')
	assert.equal(solidityConstant(securityPoolUtils, 'LIQUIDATION_REP_BONUS_BPS', 'SecurityPoolUtils.sol'), liquidationRules.repBonusBps)
	assert.equal(solidityConstant(securityPoolUtils, 'BPS_DENOMINATOR', 'SecurityPoolUtils.sol'), liquidationRules.bpsDenominator)
	const transfer = solidityFunction(securityPoolUtils, 'calculateBundledLiquidationTransfer', 'SecurityPoolUtils.sol')
	const capacityStatement = transfer.match(/obligationUnitsToMove =[\s\S]*?;/)?.[0]
	assert.ok(capacityStatement !== undefined, 'calculateBundledLiquidationTransfer must compute obligationUnitsToMove')
	assert.equal(roundingDirectionOf(capacityStatement, 'capacity ownership to move'), liquidationRules.capacityOwnershipRounding, 'published capacity-ownership rounding must match the contract')
	const award = solidityFunction(securityPoolUtils, 'calculateLiquidationBackingUnitsAward', 'SecurityPoolUtils.sol')
	const grossAwardStatement = award.match(/grossRepAwardAttoRep = Math\.mulDiv\([\s\S]*?\);/)?.[0]
	const backingUnitsStatement = award.match(/backingUnitsToTransfer =[\s\S]*?;/)?.[0]
	assert.ok(grossAwardStatement !== undefined && backingUnitsStatement !== undefined, 'calculateLiquidationBackingUnitsAward must derive the gross award and backing units')
	assert.equal(roundingDirectionOf(grossAwardStatement, 'gross REP award'), liquidationRules.repBackingUnitsRounding, 'published REP-backing rounding must match the gross award')
	assert.equal(roundingDirectionOf(backingUnitsStatement, 'backing units to transfer'), liquidationRules.repBackingUnitsRounding, 'published REP-backing rounding must match the backing-unit conversion')
}

async function assertAuctionRulesMatchContracts(): Promise<void> {
	const auctionStorage = await readFile('solidity/contracts/statoblast/UniformPriceDualCapBatchAuctionStorage.sol', 'utf8')
	assert.equal(solidityConstant(auctionStorage, 'MIN_TICK', 'UniformPriceDualCapBatchAuctionStorage.sol'), auctionRules.minTick)
	assert.equal(solidityConstant(auctionStorage, 'MAX_TICK', 'UniformPriceDualCapBatchAuctionStorage.sol'), auctionRules.maxTick)
	assert.match(auctionStorage, /function tickToPrice\(int256 tick\)[\s\S]*price = PRICE_PRECISION;[\s\S]*_powerOf1Point0001\(i\)[\s\S]*if \(tick < 0\) price = \(PRICE_PRECISION \* PRICE_PRECISION\) \/ price;/, 'tick pricing must start at PRICE_PRECISION, multiply by powers of 1.0001, and invert negative ticks')
	assert.equal(auctionRules.tickBase, '1.0001', 'the published tick base must match _powerOf1Point0001')
}

// Generated-output check: the rendered pages carry the values the rules compute, so a stale page fails.
async function assertGeneratedPagesRenderComputedValues(): Promise<void> {
	const page = async (slug: string) => htmlToDocumentationText(await readFile(`docs/reference/contracts/${slug}.html`, 'utf8'))
	const escalation = await page('escalationgame')
	const payout = computeWinningWithdrawal(escalationPayoutExample)
	for (const value of [payout.bonusAttoRep, payout.payoutAttoRep, payout.burnAttoRep, payout.scaledPayoutAttoRep]) {
		assert.ok(escalation.includes(`${formatRep(value)} REP`), `EscalationGame page must render the computed ${formatRep(value)} REP`)
	}
	const securityPool = await page('securitypool')
	assert.ok(securityPool.includes(retentionRules.maxRetentionRate.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '_')), 'SecurityPool page must render MAX_RETENTION_RATE')
	assert.ok(securityPool.includes(retentionRules.minRetentionRate.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '_')), 'SecurityPool page must render MIN_RETENTION_RATE')
	const auction = await page('uniformpricedualcapbatchauction')
	assert.ok(auction.includes(auctionRules.minTick.toString()) && auction.includes(auctionRules.maxTick.toString()), 'auction page must render the tick bounds')
	for (const slug of ['escalationgame', 'securitypool', 'liquidationapprovalregistry', 'uniformpricedualcapbatchauction']) {
		assert.match(await page(slug), /Accounting examples/, `${slug} must render its accounting examples`)
	}
}
