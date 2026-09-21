import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { type AccountingExampleBlock, accountingExamplesByContract } from './contract-reference-examples.mts'
import { htmlToDocumentationText } from './docs-html-text.mts'

const blockText = (block: AccountingExampleBlock): string => {
	if (block.kind === 'equation') return block.source
	if (block.kind === 'list') return block.items.join(' ')
	return block.text
}

// Exact numbers live on the generated contract pages; explanation pages keep the rule and link there.
// These checks tie each published example to the Solidity that enforces it.
export async function assertAccountingExampleOwnership(): Promise<void> {
	const escalationGameHtml = await readFile('docs/explanation/escalation-game.html', 'utf8')
	const feesHtml = await readFile('docs/explanation/fees.html', 'utf8')
	const liquidationsHtml = await readFile('docs/explanation/liquidations.html', 'utf8')
	const truthAuctionsHtml = await readFile('docs/explanation/truth-auctions.html', 'utf8')
	const proofVerifier = await readFile('solidity/contracts/statoblast/EscalationGameProofVerifier.sol', 'utf8')
	const escalationGameTypes = await readFile('solidity/contracts/statoblast/EscalationGameTypes.sol', 'utf8')
	const escalationGameState = await readFile('solidity/contracts/statoblast/EscalationGameState.sol', 'utf8')
	const securityPoolUtils = await readFile('solidity/contracts/statoblast/SecurityPoolUtils.sol', 'utf8')
	const auctionStorage = await readFile('solidity/contracts/statoblast/UniformPriceDualCapBatchAuctionStorage.sol', 'utf8')

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

	const exampleText = (contractName: string): string => {
		const examples = accountingExamplesByContract.get(contractName)
		assert.ok(examples !== undefined, `${contractName} must publish accounting examples`)
		return examples.flatMap(example => example.blocks.map(blockText)).join('\n')
	}

	const escalationExamples = exampleText('EscalationGame')
	assert.match(escalationGameTypes, /EXCESS_REWARD_WINDOW_DIVISOR = 2;/)
	assert.match(escalationGameTypes, /ESCALATION_TIME_LENGTH = 4233600; \/\/ 7 weeks/)
	assert.match(escalationGameState, /activationDelay = 3 days/)
	assert.match(proofVerifier, /bindingCapitalAttoRep \+ bindingCapitalAttoRep \/ EXCESS_REWARD_WINDOW_DIVISOR/)
	assert.match(proofVerifier, /\(\(bindingCapitalAttoRep \* 3\) \/ 5\)/, 'reward pool must be three fifths of binding capital')
	assert.match(proofVerifier, /\(\(bindingCapitalAttoRep \* 2\) \/ 5\)/, 'haircut pool must be two fifths of binding capital')
	assert.match(proofVerifier, /if \(actualForkThresholdAttoRep < nonDecisionThresholdAttoRep\) \{\s*amountToWithdrawAttoRep =\s*\(amountToWithdrawAttoRep \* actualForkThresholdAttoRep\) \/ nonDecisionThresholdAttoRep;/)
	for (const fragment of ['`EXCESS_REWARD_WINDOW_DIVISOR` (2)', '`3 / 5`', '`2 / 5`', '`10 + 10 / 2 = 15 REP`', '`5 × 6 / 15 = 2 REP`', '`5 × 4 / 15 = 1.333333333333333333 REP`', '`7 × 16 / 20 = 5.6 REP`', 'd ≥ 52']) {
		assert.ok(escalationExamples.includes(fragment), `EscalationGame examples must retain ${fragment}`)
	}

	const securityPoolExamples = exampleText('SecurityPool')
	for (const constant of ['MAX_RETENTION_RATE = 999_999_996_848_000_000', 'MIN_RETENTION_RATE = 999_999_977_880_000_000', 'RETENTION_RATE_DIP = (80 * PRICE_PRECISION) / 100', 'LIQUIDATION_REP_BONUS_BPS = 500', 'BPS_DENOMINATOR = 10_000']) {
		assert.ok(securityPoolUtils.includes(constant), `SecurityPoolUtils must define ${constant}`)
	}
	assert.match(securityPoolUtils, /if \(mintingCapacityAttoEth == 0\) return MAX_RETENTION_RATE;[\s\S]*if \(utilization <= RETENTION_RATE_DIP\) \{[\s\S]*return MAX_RETENTION_RATE - \(slopeSpan \* utilizationRatio\) \/ PRICE_PRECISION;[\s\S]*return MIN_RETENTION_RATE;/)
	for (const fragment of ['`MAX_RETENTION_RATE = 999_999_996_848_000_000`', '`MIN_RETENTION_RATE = 999_999_977_880_000_000`', '80% of live minting capacity', '`LIQUIDATION_REP_BONUS_BPS` = 500, so 5%', 'rounded down', 'rounded up']) {
		assert.ok(securityPoolExamples.includes(fragment), `SecurityPool examples must retain ${fragment}`)
	}

	assert.ok(exampleText('LiquidationApprovalRegistry').includes('`10,000` (`BPS_DENOMINATOR`)'), 'registry example must explain the protocol-minimum health factor')

	const auctionExamples = exampleText('UniformPriceDualCapBatchAuction')
	assert.match(auctionStorage, /MIN_TICK = -524288;[\s\S]*MAX_TICK = 524288;/)
	assert.match(auctionStorage, /function tickToPrice\(int256 tick\)[\s\S]*price = PRICE_PRECISION;[\s\S]*_powerOf1Point0001\(i\)[\s\S]*if \(tick < 0\) price = \(PRICE_PRECISION \* PRICE_PRECISION\) \/ price;/)
	for (const fragment of ['`MIN_TICK` (`-524288`)', '`MAX_TICK` (`524288`)', '1.0001^t']) {
		assert.ok(auctionExamples.includes(fragment), `auction examples must retain ${fragment}`)
	}

	const generatedPages = await Promise.all(['escalationgame', 'securitypool', 'liquidationapprovalregistry', 'uniformpricedualcapbatchauction'].map(async slug => htmlToDocumentationText(await readFile(`docs/reference/contracts/${slug}.html`, 'utf8'))))
	for (const page of generatedPages) assert.match(page, /Accounting examples/, 'every contract with published examples must render them')
}
