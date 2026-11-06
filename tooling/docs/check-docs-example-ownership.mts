import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { attoPrecision, computeWinningWithdrawal, escalationPayoutExample, escalationRules, escalationTimeLengthSeconds, formatRep } from './contract-reference-rules.mts'
import { htmlToDocumentationText } from './docs-html-text.mts'

// Exact numbers live on the generated contract pages; explanation pages keep the rule and link there.
// The accounting rules are structured data, so this check compares each rule with the Solidity that
// enforces it instead of freezing a sentence of the rendered text.
export async function assertAccountingExampleOwnership(): Promise<void> {
	await assertExplanationPagesDelegateToReference()
	await assertEscalationRulesMatchContracts()
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
	assert.match(feesHtml, /href="\.\.\/reference\/contract-inventory\.html#portfolio-underwriting"/, 'fees explanation must delegate fee configuration to the portfolio reference')
	assert.doesNotMatch(feesHtml, /class="equation"/, 'fees explanation must not repeat the annualization formula')
	assert.match(liquidationsHtml, /href="\.\.\/reference\/contract-inventory\.html#portfolio-liquidation"/, 'liquidation explanation must delegate liquidation details to the portfolio reference')
	assert.match(truthAuctionsHtml, /href="\.\.\/reference\/contract-inventory\.html#portfolio-truth-auction"/, 'truth auction explanation must delegate lot pricing to the portfolio auction reference')
	assert.doesNotMatch(truthAuctionsHtml, /class="equation"/, 'truth auction explanation must not repeat the auction allocation formula')
}

const SOLIDITY_TIME_UNIT_SECONDS: Record<string, bigint> = { seconds: 1n, minutes: 60n, hours: 3_600n, days: 86_400n, weeks: 604_800n }

function solidityConstant(source: string, name: string, sourceLabel: string): bigint {
	const match = source.match(new RegExp(`\\b${name} = (-?\\d[\\d_]*)(?: (seconds|minutes|hours|days|weeks))?`))
	assert.ok(match?.[1] !== undefined, `${sourceLabel} must define ${name} as an integer literal, optionally with a Solidity time unit`)
	const unitSeconds = match[2] === undefined ? 1n : SOLIDITY_TIME_UNIT_SECONDS[match[2]]
	assert.ok(unitSeconds !== undefined, `${sourceLabel} uses an unsupported time unit for ${name}`)
	return BigInt(match[1].replaceAll('_', '')) * unitSeconds
}

function solidityFunction(source: string, name: string, sourceLabel: string): string {
	const match = source.match(new RegExp(`function ${name}\\([^{]*\\{[\\s\\S]*?\\n\\t\\}`))
	assert.ok(match !== null, `${sourceLabel} must define ${name}`)
	return match[0]
}

async function assertEscalationRulesMatchContracts(): Promise<void> {
	const proofVerifier = await readFile('solidity/contracts/statoblast/EscalationGameProofVerifier.sol', 'utf8')
	const escalationGameTypes = await readFile('solidity/contracts/statoblast/EscalationGameTypes.sol', 'utf8')
	const escalationGameStorage = await readFile('solidity/contracts/statoblast/EscalationGameStorage.sol', 'utf8')
	assert.equal(solidityConstant(escalationGameTypes, 'EXCESS_REWARD_WINDOW_DIVISOR', 'EscalationGameTypes.sol'), escalationRules.excessRewardWindowDivisor)
	assert.equal(solidityConstant(escalationGameTypes, 'ESCALATION_TIME_LENGTH', 'EscalationGameTypes.sol'), escalationTimeLengthSeconds)
	const activationDelay = escalationGameStorage.match(/ACTIVATION_DELAY = (\d+) days;/)
	assert.ok(activationDelay?.[1] !== undefined, 'EscalationGameStorage.sol must define ACTIVATION_DELAY in days')
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

async function assertGeneratedPagesRenderComputedValues(): Promise<void> {
	const page = async (slug: string) => htmlToDocumentationText(await readFile(`docs/reference/contracts/${slug}.html`, 'utf8'))
	const escalation = await page('escalationgame')
	const payout = computeWinningWithdrawal(escalationPayoutExample)
	for (const value of [payout.bonusAttoRep, payout.payoutAttoRep, payout.burnAttoRep, payout.scaledPayoutAttoRep]) {
		assert.ok(escalation.includes(`${formatRep(value)} REP`), `EscalationGame page must render the computed ${formatRep(value)} REP`)
	}
	assert.match(escalation, /Accounting examples/)
}
