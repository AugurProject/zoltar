import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { getMainnetProtocolConfig } from '../shared/ts/protocolConfig'

const html = await readFile('docs/escalation-game-architecture.html', 'utf8')
const liquidationHtml = await readFile('docs/liquidation.html', 'utf8')
const zoltarWhitepaper = await readFile('docs/zoltar-whitepaper.html', 'utf8')
const whitepaperPlaceholder = await readFile('docs/placeholder-whitepaper.html', 'utf8')
const startHere = await readFile('docs/start-here.html', 'utf8')
const operatorReference = await readFile('docs/operator-reference.md', 'utf8')
const contractInteractionReference = await readFile('docs/contract-interaction-reference.md', 'utf8')
const eventStream = await readFile('docs/event-stream.md', 'utf8')
const escalationGameState = await readFile('solidity/contracts/peripherals/EscalationGameState.sol', 'utf8')
const escalationGameTypes = await readFile('solidity/contracts/peripherals/EscalationGameTypes.sol', 'utf8')
const escalationGameForker = await readFile('solidity/contracts/peripherals/EscalationGameForker.sol', 'utf8')
const priceCoordinator = await readFile('solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol', 'utf8')
const securityPool = await readFile('solidity/contracts/peripherals/SecurityPool.sol', 'utf8')
const securityPoolFactory = await readFile('solidity/contracts/peripherals/factories/SecurityPoolFactory.sol', 'utf8')
const securityPoolInterface = await readFile('solidity/contracts/peripherals/interfaces/ISecurityPool.sol', 'utf8')
const securityPoolForker = await readFile('solidity/contracts/peripherals/SecurityPoolForker.sol', 'utf8')
const securityPoolForkerVaultMigrationDelegate = await readFile('solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationDelegate.sol', 'utf8')
const securityPoolUtils = await readFile('solidity/contracts/peripherals/SecurityPoolUtils.sol', 'utf8')
const truthAuction = await readFile('solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol', 'utf8')
const zoltar = await readFile('solidity/contracts/Zoltar.sol', 'utf8')
const bytecodeSnapshot = readBytecodeSnapshot(await readFile('solidity/ts/tests/fixtures/escalationGameBytecode.snapshot.json', 'utf8'))
const interfaceRegressionTest = await readFile('solidity/ts/tests/escalationGameInterfaceRegression.test.ts', 'utf8')

const expectedProjectBudget = readNumericConstant(interfaceRegressionTest, 'escalationGameDeployedBytecodeBudgetBytes')
const expectedEip170Budget = readNumericConstant(interfaceRegressionTest, 'eip170DeployedBytecodeLimitBytes')

assertSimpleByteRow('Creation bytecode', formatNumber(bytecodeSnapshot.creationBytes))
assertSimpleByteRow('Deployed bytecode', formatNumber(bytecodeSnapshot.deployedBytes))
assertBudgetHeadroomRow('Project deployed-bytecode budget headroom', formatNumber(expectedProjectBudget - bytecodeSnapshot.deployedBytes), formatNumber(expectedProjectBudget))
assertBudgetHeadroomRow('EIP-170 headroom', formatNumber(expectedEip170Budget - bytecodeSnapshot.deployedBytes), formatNumber(expectedEip170Budget))
assertContinuationIdentifierExplanation()
assertEventStreamSemantics()
assertZoltarForkDepths()
assertCoordinatorRecoveryBranch()
assertLiquidationFullCloseDocs()
assertStartHereTimelines()
assertContractInteractionDistinctions()

function assertContinuationIdentifierExplanation(): void {
	assert.ok(html.includes('uint256(keccak256(abi.encode(address(this), outcomeIndex, depositIndex)))'), 'docs/escalation-game-architecture.html must explain the fork-continuation stable parent deposit identifier formula')
	assert.ok(html.includes('consumedParentDepositIndexes'), 'docs/escalation-game-architecture.html must connect the continuation identifier to consumedParentDepositIndexes')
	assert.ok(html.includes('LocalDepositAppended') && html.includes('CarryDepositConsumed') && html.includes('ClaimDeposit') && html.includes('exportUnresolvedDeposit'), 'docs/escalation-game-architecture.html must name the exact event and export surfaces that expose the continuation identifier')
	assert.ok(!html.includes('CarriedDepositClaimed'), 'docs/escalation-game-architecture.html must not reference the removed CarriedDepositClaimed event')
}

function assertEventStreamSemantics(): void {
	assert.match(priceCoordinator, /PRICE_PRECISION = 1e18/)
	assert.match(securityPoolUtils, /PRICE_PRECISION = 1e18/)
	assert.match(securityPoolInterface, /Complete sets burned and net ETH paid/)
	assert.match(securityPoolInterface, /Winning shares burned and net ETH paid/)
	for (const documentedClaim of [
		'Genesis REP has a separate balance-history anchor',
		'Pool and vault `feeIndex` | `1e18` fixed-point',
		'`currentRetentionRate` | `1e18` fixed-point per-second multiplier',
		'Coordinator REP/ETH `price` | `(REP base units * 1e18) / ETH wei`',
		'Redemption `ethAmount` fields are the net wei paid',
		'`ethUsed + ethRefund = originalEthAmount`',
	]) {
		assert.ok(eventStream.includes(documentedClaim), `Missing event-stream unit or value-semantics claim: ${documentedClaim}`)
	}
}

function assertZoltarForkDepths(): void {
	const initialSupply = 7_825_488_326_666_847_200_078_019n
	const oneRep = 10n ** 18n
	const protocolConfig = getMainnetProtocolConfig()
	let supply = initialSupply
	let escalationBoundary: number | undefined
	let subOneRepBoundary: number | undefined
	let zeroHaircutBoundary: number | undefined

	for (let depth = 0; zeroHaircutBoundary === undefined; depth += 1) {
		const threshold = supply / protocolConfig.forkThresholdDivisor
		const haircut = threshold / protocolConfig.forkBurnDivisor
		if (escalationBoundary === undefined && threshold / 2n <= oneRep) escalationBoundary = depth
		if (subOneRepBoundary === undefined && threshold < oneRep) subOneRepBoundary = depth
		if (haircut === 0n) {
			zeroHaircutBoundary = depth
			break
		}
		supply -= haircut
	}

	assert.equal(escalationBoundary, 1_213, 'Zoltar escalation boundary depth changed')
	assert.equal(subOneRepBoundary, 1_282, 'Zoltar sub-1-REP threshold depth changed')
	assert.equal(zeroHaircutBoundary, 5_303, 'Zoltar zero-haircut boundary depth changed')
	assert.equal(supply, 99n, 'Zoltar zero-haircut fixed-point supply changed')
	assert.equal(supply / protocolConfig.forkThresholdDivisor, 4n, 'Zoltar zero-haircut fixed-point threshold changed')
	const normalizedWhitepaper = zoltarWhitepaper.replaceAll(/\s+/g, ' ')
	for (const documentedClaim of [
		'at child depth <code>1,213</code>, the fork threshold is approximately <code>1.986 REP</code>',
		'at depth <code>1,282</code>, the fork threshold is below <code>1 REP</code>',
		'at depth <code>5,303</code>, theoretical supply is <code>99 wei</code>, the fork threshold is <code>4 wei</code>, and the haircut floors to zero',
	]) {
		assert.ok(normalizedWhitepaper.includes(documentedClaim), `Missing Zoltar fork-depth claim: ${documentedClaim}`)
	}
}

function assertCoordinatorRecoveryBranch(): void {
	const normalizedPlaceholder = whitepaperPlaceholder.replaceAll(/\s+/g, ' ')
	for (const documentedClaim of [
		'If the pending settlement list is empty, another staged request can fund a replacement report.',
		'If pending settlement operation IDs still remain, an operator or user must call direct <code>requestPrice(amount2)</code> with the ETH bounty and initial-report funding, then let that replacement report settle.',
	]) {
		assert.ok(normalizedPlaceholder.includes(documentedClaim), `Missing coordinator recovery-branch claim: ${documentedClaim}`)
	}
}

function assertLiquidationFullCloseDocs(): void {
	const normalizedLiquidation = liquidationHtml.replaceAll(/\s+/g, ' ')
	const normalizedPlaceholder = whitepaperPlaceholder.replaceAll(/\s+/g, ' ')

	for (const documentedClaim of [
		'repBoundDebt = snapshotTargetUnlockedRep > MIN_REP_DEPOSIT ? floor((snapshotTargetUnlockedRep - MIN_REP_DEPOSIT) * PRICE_PRECISION * BPS_DENOMINATOR / (currentRepPerEthPrice * (BPS_DENOMINATOR + liquidationRepBonusBps))) : 0',
		'targetCapBeforeDebtFloor = min(snapshotTargetAllowanceEth, repBoundDebt)',
		'targetCapAfterDebtFloor = 0 < snapshotTargetAllowanceEth - targetCapBeforeDebtFloor <= MIN_SECURITY_BOND_DEBT ? (snapshotTargetAllowanceEth > MIN_SECURITY_BOND_DEBT ? snapshotTargetAllowanceEth - MIN_SECURITY_BOND_DEBT : snapshotTargetAllowanceEth) : targetCapBeforeDebtFloor',
		'computedOwnershipToMove = repToPoolOwnership(computedRepToMove)',
		'repToMove = debtToMove != snapshotTargetAllowanceEth ? computedRepToMove : computedOwnershipToMove >= currentTargetOwnership ? currentTargetUnlockedRep : poolOwnershipToRep(currentTargetOwnership - computedOwnershipToMove) < MIN_REP_DEPOSIT ? currentTargetUnlockedRep : computedRepToMove',
	]) {
		assert.ok(normalizedLiquidation.includes(documentedClaim), `Missing liquidation full-close documentation claim: ${documentedClaim}`)
	}
	for (const marker of ['data-liquidation-note="snapshot-queue-behavior"', 'data-liquidation-note="snapshot-cap-promotion"', 'data-liquidation-note="variable-legend"', 'data-liquidation-case="minimum-size-full-close"', 'data-liquidation-case="queued-topup-no-gain"']) {
		assert.ok(liquidationHtml.includes(marker), `Missing liquidation documentation marker: ${marker}`)
	}

	for (const documentedClaim of ["When a liquidation clears the target's full staged allowance", 'would consume all current unlocked REP or leave less than <code>MIN_REP_DEPOSIT</code>', "the contract instead seizes the target's full current unlocked REP and force-closes the vault."]) {
		assert.ok(normalizedPlaceholder.includes(documentedClaim), `Missing whitepaper liquidation full-close documentation claim: ${documentedClaim}`)
	}
	assert.ok(
		normalizedPlaceholder.includes('computedRepToMove = ceil(debtToMove \\cdot currentPrice \\cdot (BPS_DENOMINATOR + liquidationRepBonusBps) / (PRICE_PRECISION \\cdot BPS_DENOMINATOR)); repToMove = currentTargetUnlockedRep on the full-close dust override branch; otherwise computedRepToMove'),
		'whitepaper placeholder liquidation equation must mention the full-close override',
	)
	assert.ok(liquidationHtml.includes('data-liquidation-summary="normal-plus-full-close"'), 'canonical liquidation diagram caption must be tagged for the normal-path plus full-close summary')
	const computeCandidateIndex = liquidationHtml.indexOf('Compute debt and REP candidate')
	const fullCloseDecisionIndex = liquidationHtml.indexOf('Full-close sweep required?')
	const poolValidationIndex = liquidationHtml.indexOf('Pool validates and applies?')
	const completedTransferIndex = liquidationHtml.indexOf('Transfer completed')
	assert.ok(computeCandidateIndex !== -1 && computeCandidateIndex < fullCloseDecisionIndex, 'liquidation diagram must compute the ordinary candidate before deciding whether to replace it with a full-close sweep')
	assert.ok(fullCloseDecisionIndex < poolValidationIndex, 'liquidation diagram must select the ordinary or full-close candidate before pool validation')
	assert.ok(poolValidationIndex < completedTransferIndex, 'liquidation diagram must show pool validation before a completed transfer')
	assert.doesNotMatch(liquidationHtml, /Pool execution succeeds\?/, 'liquidation diagram must not imply success before full-close candidate selection')
	assert.doesNotMatch(whitepaperPlaceholder, /id="fig-placeholder-auction-clearing"/, 'whitepaper must delegate auction clearing to the canonical focused diagram')
	assert.match(whitepaperPlaceholder, /auction-design\.html#fig-auction-clearing-ladder/)
}

function assertStartHereTimelines(): void {
	assert.match(escalationGameState, /activationDelay = 3 days/)
	assert.match(escalationGameTypes, /ESCALATION_TIME_LENGTH = 4233600; \/\/ 7 weeks/)
	assert.match(securityPoolUtils, /MIGRATION_TIME = 8 weeks/)
	for (const systemState of ['Operational', 'PoolForked', 'ForkMigration', 'ForkTruthAuction']) {
		assert.match(securityPoolInterface, new RegExp(`\\b${systemState}\\b`))
		assert.match(startHere, new RegExp(`>${systemState}<`), `Start Here state diagram must include ${systemState}`)
	}
	assert.match(startHere, /three-day activation delay/)
	assert.match(startHere, /up to seven weeks/)
	assert.match(startHere, /eight-week migration window/)
	assert.match(startHere, /resumes\s+from its inherited elapsed time without a new activation delay/)
	assert.match(startHere, /d="M 800 103 C 810 103 810 59 820 59"/)
	assert.match(startHere, /d="M 800 103 C 810 103 810 151 820 151"/)
	assert.match(startHere, /If an unrelated market caused the first fork/)
	assert.match(startHere, /the first fork's branches\s+represent the unrelated question, while the recursive branches represent\s+the original one/)
	assert.match(startHere, /placeholder-whitepaper\.html#fig-placeholder-recursive-continuation/)
	assert.match(startHere, />activateForkMode</)
	assert.match(startHere, /A universe\s+fork alone leaves <code>systemState<\/code> as <code>Operational<\/code>/)
	assert.match(startHere, /Pool fork initiation calls <code>activateForkMode<\/code>/)
	assert.match(startHere, /<code>startTruthAuction<\/code> always moves\s+the child into <code>ForkTruthAuction<\/code>/)
	assert.match(startHere, /finalizes back to <code>Operational<\/code> in the same transaction/)
	assert.match(startHere, /d="M 555 82 C 555 120 215 120 215 146"/, 'Start Here deployment arrow must end at the ForkMigration child state')
	assert.doesNotMatch(startHere, /d="M 555 82 V 146"/, 'Start Here deployment arrow must not point into ForkTruthAuction')
	assert.doesNotMatch(startHere, /d="M 340 222 C 450 270 650 270 710 218"/)
	assert.ok(startHere.indexOf('The ordinary lifecycle is question, pool, trading, local escalation') < startHere.indexOf('<code>deployChild</code>'), 'Start Here must introduce the ordinary lifecycle before fork implementation calls')
}

function assertContractInteractionDistinctions(): void {
	assert.match(contractInteractionReference, /currently unlocked REP ownership/)
	assert.match(contractInteractionReference, /aggregate-entitlement wrapper calls this function first to migrate unlocked state/)
	assert.match(contractInteractionReference, /Before finalization, refunds only provably losing bids/)
	assert.match(contractInteractionReference, /Auction owner \(`SecurityPoolForker`\) only; public callers use `settleAuctionBids`/)
	assert.match(contractInteractionReference, /eight-week migration window is open and every existing selected child remains in `ForkMigration`/)
	assert.match(contractInteractionReference, /child pool is not already deployed/)
	assert.match(contractInteractionReference, /eight-week claim window open; selected child remains in `ForkMigration`/)
	assert.match(contractInteractionReference, /rejected settlement clears pending-report state but leaves staged operations queued for a later valid price path/)
	assert.match(contractInteractionReference, /While a report is pending, only that report sponsor may stage more operations/)
	assert.match(contractInteractionReference, /required only when this call opens a new report/)
	assert.match(contractInteractionReference, /Genesis REP requires allowance; child REP is burned directly without allowance/)
	assert.match(contractInteractionReference, /pool operational in an unforked universe and not awaiting continuation/)
	assert.match(contractInteractionReference, /Operational, unresolved pool in an unforked universe/)
	assert.match(contractInteractionReference, /if an escalation game exists, the universe fork occurred before that game settled/)
	assert.match(contractInteractionReference, /Initially authorized `SecurityPoolFactory` for an origin pool; an authorized parent `SecurityPool` for a child pool/)
	assert.match(contractInteractionReference, /Mint and burn entrypoints \| An authorized `SecurityPool`/)
	assert.match(contractInteractionReference, /Fixes the clearing mode, clearing tick, ETH totals, and aggregate REP allocation/)
	assert.match(contractInteractionReference, /Withdrawal-time allocation assigns division dust from deterministic cumulative ETH positions, making payout independent of claim order/)
	assert.match(contractInteractionReference, /addFeeEligibleSecurityBondAllowance\(vault, amount\)[\s\S]*Finalized truth-auction settlement[\s\S]*newly auction-claimed security-bond allowance to the live fee denominator/)
	assert.match(contractInteractionReference, /`SystemStateSet`/)
	assert.match(securityPoolForker, /Before finalization, only refundable bids can be settled/)
	assert.match(securityPoolForker, /require\(claimTickIndices\.length == 0, 'Not final'\)/)
	assert.match(securityPoolForker, /block\.timestamp <= zoltar\.getForkTime\(securityPool\.universeId\(\)\) \+ SecurityPoolUtils\.MIGRATION_TIME/)
	assert.match(securityPoolForkerVaultMigrationDelegate, /require\(address\(childrenByPoolAndOutcome\[parent\]\[outcomeIndex\]\) == address\(0x0\), 'Child pool exists'\)/)
	assert.match(priceCoordinator, /_emitPriceReportRejected\(reportId, 'Base fee too high'\);\s*return;/)
	assert.match(priceCoordinator, /_emitPriceReportRejected\(reportId, 'Empty oracle settlement'\);\s*return;/)
	assert.match(priceCoordinator, /_emitPriceReportRejected\(reportId, 'Oracle price is zero'\);\s*return;/)
	assert.match(priceCoordinator, /require\(\s*msg\.sender == pendingReportSponsor,\s*'Only the pending report sponsor can queue more operations until settlement'/)
	assert.match(priceCoordinator, /bool shouldRequestPrice = pendingReportId == 0 && pendingSettlementOperationIds\.length == 0/)
	assert.match(priceCoordinator, /if \(shouldRequestPrice && isPendingSettlementOperationId\)/)
	assert.match(escalationGameForker, /require\(child\.systemState\(\) == SystemState\.ForkMigration, 'Child not migrating'\)/)
	assert.match(escalationGameForker, /block\.timestamp <= zoltar\.getForkTime\(parent\.universeId\(\)\) \+ SecurityPoolUtils\.MIGRATION_TIME/)
	assert.match(escalationGameForker, /'Claim window closed'/)
	assert.match(securityPool, /event SystemStateSet\(SystemState systemState\)/)
	assert.match(securityPool, /require\(zoltar\.getForkTime\(universeId\) == 0, 'Forked'\)/)
	assert.match(securityPool, /function activateForkMode\(\) external onlyForker/)
	assert.match(securityPool, /systemState = SystemState\.PoolForked/)
	assert.match(securityPool, /shareToken\.authorize\(pool\)/)
	assert.match(securityPoolFactory, /shareToken\.authorize\(securityPool\)/)
	assert.match(securityPoolForker, /address\(escalationGame\) == address\(0x0\) \|\| _forkOccurredBeforeEscalationSettled\(escalationGame, forkTime\)/)
	assert.match(securityPoolForker, /'Resolved'/)
	assert.match(securityPoolForker, /securityPool\.setSystemState\(SystemState\.ForkTruthAuction\)/)
	assert.match(securityPoolForker, /securityPool\.addFeeEligibleSecurityBondAllowance\(vault, newSecurityBondAllowance\)/)
	assert.match(truthAuction, /function _allocateRepFromCumulativePosition\(/)
	assert.match(truthAuction, /return cumulativeRepAfter - cumulativeRepBefore/)
	assert.match(truthAuction, /require\(msg\.sender == owner, 'Only the auction owner can refund losing bids on behalf of bidders'\)/)
	assert.match(zoltar, /safeTransferFrom\(migrator, Constants\.BURN_ADDRESS, amount\)/)
	assert.match(zoltar, /ReputationToken\(address\(reputationToken\)\)\.burn\(migrator, amount\)/)
	for (const compatibilitySource of ['utils/ReentrancyGuard.sol', 'token/ERC20/IERC20.sol', 'token/ERC20/utils/SafeERC20.sol', 'utils/math/Math.sol']) {
		assert.ok(operatorReference.includes(`openOracle/openzeppelin/contracts/${compatibilitySource}`), `Operator Reference must directly link ${compatibilitySource}`)
	}
}

function assertSimpleByteRow(label: string, expectedValue: string): void {
	const escapedLabel = escapeRegExp(label)
	const match = html.match(new RegExp(`<td>${escapedLabel}</td>\\s*<td><code>([^<]+)</code> bytes</td>`))
	assert.ok(match, `Missing documentation row for ${label}`)
	assert.equal(match[1], expectedValue, `${label} should be ${expectedValue} in docs/escalation-game-architecture.html`)
}

function assertBudgetHeadroomRow(label: string, expectedHeadroom: string, expectedBudget: string): void {
	const escapedLabel = escapeRegExp(label)
	const match = html.match(new RegExp(`<td>${escapedLabel}</td>\\s*<td><code>([^<]+)</code> bytes below <code>([^<]+)</code></td>`))
	assert.ok(match, `Missing documentation row for ${label}`)
	assert.equal(match[1], expectedHeadroom, `${label} headroom should be ${expectedHeadroom} in docs/escalation-game-architecture.html`)
	assert.equal(match[2], expectedBudget, `${label} budget should be ${expectedBudget} in docs/escalation-game-architecture.html`)
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatNumber(value: number): string {
	return value.toLocaleString('en-US')
}

function readNumericConstant(source: string, constantName: string): number {
	const match = source.match(new RegExp(`const\\s+${constantName}\\s*=\\s*([\\d_]+)`))
	assert.ok(match, `Could not find ${constantName} in escalationGameInterfaceRegression.test.ts`)
	return Number(match[1]?.replaceAll('_', ''))
}

function readBytecodeSnapshot(source: string): { creationBytes: number; deployedBytes: number } {
	const parsed = JSON.parse(source) as unknown
	assert.ok(isRecord(parsed), 'Escalation game bytecode snapshot must be a JSON object')
	return {
		creationBytes: readNumberField(parsed, 'creationBytes'),
		deployedBytes: readNumberField(parsed, 'deployedBytes'),
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function readNumberField(record: Record<string, unknown>, fieldName: string): number {
	const value = Reflect.get(record, fieldName)
	if (typeof value !== 'number') {
		throw new Error(`Escalation game bytecode snapshot field ${fieldName} must be a number`)
	}
	return value
}
