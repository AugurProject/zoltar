import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { getMainnetProtocolConfig } from '../shared/ts/protocolConfig'

const html = await readFile('docs/escalation-game-architecture.html', 'utf8')
const invariantsHtml = await readFile('docs/invariants.html', 'utf8')
const liquidationHtml = await readFile('docs/liquidation.html', 'utf8')
const openOracleIntegration = await readFile('docs/open-oracle-integration.html', 'utf8')
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
const openOracleProvenance = await readFile('solidity/contracts/peripherals/openOracle/UPSTREAM.md', 'utf8')
const openOracleState = await readFile('shared/ts/openOracle.ts', 'utf8')
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
assertAggregateEscalationContinuationDocs()
assertEventStreamSemantics()
assertZoltarForkDepths()
assertCoordinatorRecoveryBranch()
assertCoordinatorSettlementEconomics()
assertOpenOracleVendorAndEventDocs()
assertLiquidationFullCloseDocs()
assertStartHereTimelines()
assertContractInteractionDistinctions()
assertTruthAuctionRepairParameter()

function assertContinuationIdentifierExplanation(): void {
	assert.ok(html.includes('uint256(keccak256(abi.encode(address(this), outcomeIndex, depositIndex)))'), 'docs/escalation-game-architecture.html must explain the fork-continuation stable parent deposit identifier formula')
	assert.ok(html.includes('consumedParentDepositIndexes'), 'docs/escalation-game-architecture.html must connect the continuation identifier to consumedParentDepositIndexes')
	assert.ok(html.includes('LocalDepositAppended') && html.includes('CarryDepositConsumed') && html.includes('ClaimDeposit') && html.includes('exportUnresolvedDeposit'), 'docs/escalation-game-architecture.html must name the exact event and export surfaces that expose the continuation identifier')
	assert.ok(!html.includes('CarriedDepositClaimed'), 'docs/escalation-game-architecture.html must not reference the removed CarriedDepositClaimed event')
}

function assertAggregateEscalationContinuationDocs(): void {
	const normalizedPlaceholder = whitepaperPlaceholder.replaceAll(/\s+/g, ' ')
	const normalizedOperatorReference = operatorReference.replaceAll(/\s+/g, ' ')
	const normalizedContractReference = contractInteractionReference.replaceAll(/\s+/g, ' ')
	const normalizedZoltarWhitepaper = zoltarWhitepaper.replaceAll(/\s+/g, ' ')
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	for (const [documentName, contents] of [
		['Placeholder whitepaper', normalizedPlaceholder],
		['Operator reference', normalizedOperatorReference],
	] as const) {
		for (const documentedClaim of ['aggregate backing', 'winning proof', 'recorded depositor', 'inherited losers', 'optional parent']) {
			assert.ok(contents.toLowerCase().includes(documentedClaim), `${documentName} must explain aggregate winner-only continuation semantics: ${documentedClaim}`)
		}
	}
	for (const documentedClaim of ['uncredited haircut', 'forkBurnDivisor']) {
		assert.ok(normalizedZoltarWhitepaper.includes(documentedClaim), `Zoltar whitepaper must document fork admission economics: ${documentedClaim}`)
		assert.ok(normalizedContractReference.includes(documentedClaim), `Contract interaction reference must document fork admission economics: ${documentedClaim}`)
	}
	for (const forbiddenClaim of ['vaultEscrowChildRep', 'forked-escrow-scaling', 'forked-escrow-example', 'only selected vault escrow authorizes inherited proofs', 'vault migration grants only logical authorization', 'only materialized vault escrow authorizes proofs']) {
		assert.ok(!normalizedPlaceholder.includes(forbiddenClaim), `Placeholder whitepaper retains obsolete per-vault continuation claim: ${forbiddenClaim}`)
	}
	assert.match(normalizedContractReference, /cleanup neither funds escalation backing nor authorizes carried proofs/)
	assert.match(normalizedOperatorReference, /Child funding, continuation progress, and proof eligibility do not require cleanup/)
	for (const documentedClaim of [
		'complete aggregate continuation backing at most once',
		'Optional vault cleanup only clears parent locks',
		'currentCarryTotal</code> equals effective inherited unresolved principal plus unresolved local deposits',
		'a direct ancestor claim invalidates the matching proof in every descendant',
		'Inherited losing principal retires at finalization without a proof',
	]) {
		assert.ok(normalizedInvariants.includes(documentedClaim), `Invariant catalog must explain aggregate winner-only continuation semantics: ${documentedClaim}`)
	}
	for (const forbiddenClaim of ['credited to child escrow', 'forked child REP backing', 'Forked escrow claims never exceed']) {
		assert.ok(!normalizedInvariants.includes(forbiddenClaim), `Invariant catalog retains obsolete per-vault continuation claim: ${forbiddenClaim}`)
	}
}

function assertEventStreamSemantics(): void {
	assert.match(priceCoordinator, /PRICE_PRECISION = 1e18/)
	assert.match(securityPoolUtils, /PRICE_PRECISION = 1e18/)
	assert.match(securityPoolInterface, /Complete sets burned and net ETH paid/)
	assert.match(securityPoolInterface, /Winning shares burned and net ETH paid/)
	for (const documentedClaim of [
		'Genesis REP has a separate balance-history anchor',
		'First scan `DeploySecurityPool` logs from the configured `SecurityPoolFactory`',
		'Apply the same pre-pass to `EscalationGameSet` logs from recognized pools',
		'Accept escalation signatures only from game addresses collected through this pool relationship',
		'Pool and vault `feeIndex` | `1e18` fixed-point',
		'`currentRetentionRate` | `1e18` fixed-point per-second multiplier',
		'Coordinator REP/ETH `price` | `(REP base units * 1e18) / ETH wei`',
		'Redemption `ethAmount` fields are the net wei paid',
		'`ethUsed + ethRefund = originalEthAmount`',
		'preserve an immutable copy of the current roots, counts, peaks, and leaves under `escalationSnapshotId`',
		'select that historical version by `snapshotId`',
		'clone the frozen peaks and leaves into the child',
		'require `ids.length == values.length`',
		'apply each `(ids[i], values[i])` pair in array order',
		'Array-taking protocol calls expand into one cause event per affected item',
	]) {
		assert.ok(eventStream.includes(documentedClaim), `Missing event-stream unit or value-semantics claim: ${documentedClaim}`)
	}
}

function assertZoltarForkDepths(): void {
	const protocolConfig = getMainnetProtocolConfig()
	assert.equal(protocolConfig.forkThresholdDivisor, 20n, 'Zoltar fork threshold divisor changed')
	assert.equal(protocolConfig.forkBurnDivisor, 5n, 'Zoltar fork burn divisor changed')
	const normalizedWhitepaper = zoltarWhitepaper.replaceAll(/\s+/g, ' ')
	for (const documentedClaim of ['one fifth of the threshold is an uncredited haircut', 'Later REP added to a migration balance converts 1:1', 'Permanent admission cost']) {
		assert.ok(normalizedWhitepaper.includes(documentedClaim), `Missing Zoltar fork haircut claim: ${documentedClaim}`)
	}
}

function assertCoordinatorRecoveryBranch(): void {
	const normalizedPlaceholder = whitepaperPlaceholder.replaceAll(/\s+/g, ' ')
	for (const documentedClaim of [
		'If the pending settlement list is empty, another staged request can fund a replacement report.',
		'If pending settlement operation IDs still remain, an operator or user must call direct <code>requestPrice(proposedRepPerEthPrice, requestedInitialWeth)</code> with the ETH bounty and initial-report funding, then let that replacement report settle.',
	]) {
		assert.ok(normalizedPlaceholder.includes(documentedClaim), `Missing coordinator recovery-branch claim: ${documentedClaim}`)
	}
}

function assertCoordinatorSettlementEconomics(): void {
	const normalizedIntegration = openOracleIntegration.replaceAll(/\s+/g, ' ')
	for (const documentedClaim of [
		'Equality is accepted.',
		'correction profit at the configured target error remains <code>10 / 3</code> times the one-dispute gas cost at the largest admitted settlement base fee.',
		'That relationship is a deployment assumption, not a constructor invariant',
		"the constructor checks each multiplier's lower bound but does not require the settlement cap to remain below the Open Oracle Security multiplier.",
		'the callback does not recompute <code>minimumToken1Report()</code> from settlement base fee and does not compare the final price with an external truth source.',
		'The cap is a rejection boundary, not operation-value insurance or proof that an accepted price is externally correct.',
	]) {
		assert.ok(normalizedIntegration.includes(documentedClaim), `Missing coordinator settlement-economics claim: ${documentedClaim}`)
	}
	assert.match(priceCoordinator, /if \(block\.basefee > pendingReportMaxSettlementBaseFee\)/, 'coordinator must accept settlement base fee equal to the request-time cap')
	assert.match(priceCoordinator, /if \(amount1 == 0 \|\| amount2 == 0\)/, 'coordinator must reject empty settled token amounts')
	assert.match(priceCoordinator, /uint256 price = Math\.mulDiv\(amount2, PRICE_PRECISION, amount1\)/, 'coordinator must derive the settled REP/ETH ratio from final token amounts')
	assert.match(priceCoordinator, /uint256 ethCost = getRequestPriceEthCost\(\)/, 'coordinator must derive the request bounty from getRequestPriceEthCost')
	assert.match(priceCoordinator, /uint256 settlerReward = ethCost/, 'coordinator must assign the entire request bounty to the OpenOracle settler reward')
	assert.match(priceCoordinator, /settlerReward: uint96\(settlerReward\)/, 'coordinator report creation must forward the full request bounty as settler reward')
	const requestBountyFormula = 'data-source="block.basefee \\cdot 4 \\cdot (callbackGasLimit + gasConsumedOpenOracleReportPrice) + 101"'
	assert.ok(openOracleIntegration.includes(requestBountyFormula), 'OpenOracle integration parameter table must use the current full request-bounty settler reward')
	assert.ok(whitepaperPlaceholder.includes(requestBountyFormula), 'whitepaper OpenOracle parameter table must use the current full request-bounty settler reward')
	assert.doesNotMatch(whitepaperPlaceholder, /disputers can replace a bad\s+report with a larger one/, 'whitepaper must not claim every dispute strictly increases the report after integer flooring')
}

function assertOpenOracleVendorAndEventDocs(): void {
	for (const pinnedRevision of ['ae4578bb4fa9d32820ac32c482f318cdbd63bfa2', 'c64a1edb67b6e3f4a15cca8909c9482ad33a02b0', 'src/OpenOracleSlim.sol', 'OpenZeppelin Contracts v5.4.0']) {
		assert.ok(openOracleProvenance.includes(pinnedRevision), `OpenOracle provenance must retain ${pinnedRevision}`)
	}
	for (const reconstructionClaim of ['topic 1 is the indexed 32-byte report ID', '`data` is exactly 235 raw packed bytes', 'set `settlementTimestamp` from the settlement block']) {
		assert.ok(eventStream.includes(reconstructionClaim), `OpenOracle event reconstruction docs must retain: ${reconstructionClaim}`)
	}
	assert.match(openOracleState, /new Uint8Array\(235\)/, 'shared OpenOracle encoder must retain the documented 235-byte packed layout')
	assert.match(openOracleState, /if \(bytes\.length !== 235\)/, 'shared OpenOracle decoder must reject non-canonical packed lengths')
	assert.doesNotMatch(whitepaperPlaceholder, /sponsor posts initial report/, 'whitepaper diagrams must not identify the funding sponsor as the on-chain reporter')
	assert.match(whitepaperPlaceholder, /coordinator reports\s*<\/text>\s*<text[^>]+>\s*sponsor funds/, 'whitepaper oracle flow must distinguish the coordinator reporter from the funding sponsor')
	for (const [documentName, contents] of [
		['OpenOracle integration', openOracleIntegration],
		['whitepaper', whitepaperPlaceholder],
	] as const) {
		assert.doesNotMatch(contents, /\b(?:sponsor|caller)s?\s+(?:may\s+)?(?:voluntarily\s+)?post(?:s|ed|ing)?\b/i, `${documentName} must not describe the funding sponsor as posting the report`)
		const normalizedContents = contents.replaceAll(/\s+/g, ' ')
		assert.ok(normalizedContents.includes('The sponsor may request and fund more than the minimum; the coordinator submits the selected amount as <code>currentAmount1</code>.'), `${documentName} must distinguish sponsor funding from coordinator submission`)
	}
	assert.doesNotMatch(openOracleIntegration, /<code>openOracleReportPrice<\/code>/, 'OpenOracle integration must not name the removed openOracleReportPrice function')
	assert.doesNotMatch(invariantsHtml, /<\/a\s*>\s*>\s*and\s*<a href="\.\.\/solidity\/ts\/tests\/openOracleDispute\.test\.ts"/, 'oracle verification row must not render a stray greater-than marker between test links')
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
	assert.match(invariantsHtml, /<code>SHARE-04<\/code>[\s\S]*maximum actual outcome supply[\s\S]*actual winning supply/)
	assert.match(contractInteractionReference, /getForkThreshold`, `getNonDecisionThreshold`, `getUniverseTheoreticalSupply`/)
	assert.match(contractInteractionReference, /getQuestionResolution`, `getFinalQuestionResolution`, `fixedQuestionOutcome`/)
	assert.match(contractInteractionReference, /startFromFork\(startBond, nonDecisionThreshold, elapsedAtFork, fixedQuestionOutcome, winnerHaircutPaidByFork, forkCarryInitialBacking\)[\s\S]*After the continuation deadline, `getFinalQuestionResolution` returns the fixed outcome/)
	assert.match(contractInteractionReference, /currently unlocked REP ownership/)
	assert.match(contractInteractionReference, /optional unresolved-lock cleanup wrapper calls this function first to migrate any unlocked state/)
	assert.match(contractInteractionReference, /migrateVaultWithUnresolvedEscalation[\s\S]*First runs ordinary migration for the same vault[\s\S]*cleanup neither funds escalation backing nor authorizes carried proofs/)
	assert.match(contractInteractionReference, /external fork interrupted the game[\s\S]*winners settle in the child by carried proof[\s\S]*parent-lock cleanup is optional/)
	assert.doesNotMatch(contractInteractionReference, /external-fork timing may require migration instead/)
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
	assert.match(contractInteractionReference, /positive ETH converts to at least one complete-set unit/)
	assert.match(contractInteractionReference, /Operational, unresolved pool in an unforked universe/)
	assert.match(whitepaperPlaceholder, /cashToShares[\s\S]*Exchange rate undefined/)
	assert.match(contractInteractionReference, /if an escalation game exists, the universe fork occurred before that game settled/)
	assert.match(contractInteractionReference, /`CarryDepositConsumed`; additionally `ClaimDeposit` for a winning payout/)
	assert.match(contractInteractionReference, /`EscalationRepDrainedAtFork` when unresolved escalation exists/)
	assert.match(contractInteractionReference, /Initially authorized `SecurityPoolFactory` for an origin pool; an authorized parent `SecurityPool` for a child pool/)
	assert.match(contractInteractionReference, /`mintCompleteSets\(universeId, account, amount\)` \| An authorized `SecurityPool`/)
	assert.match(contractInteractionReference, /`burnCompleteSets\(universeId, account, amount\)` \| An authorized `SecurityPool`/)
	assert.match(contractInteractionReference, /`burnTokenIdAndGetRemainingSupply\(tokenId, account\)` \| An authorized `SecurityPool`/)
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
	assert.match(securityPool, /function activateForkMode\(bool forkQuestionMatchesPoolQuestion\) external onlyForker/)
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
	for (const integrationSource of ['libraries/Errors.sol', 'interfaces/ISignatureTransfer.sol', 'openzeppelin/contracts/token/ERC20/IERC20.sol', 'openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol']) {
		assert.ok(operatorReference.includes(`openOracle/${integrationSource}`), `Operator Reference must directly link ${integrationSource}`)
	}
}

function assertTruthAuctionRepairParameter(): void {
	const repairBpsMatch = securityPoolUtils.match(/uint256 constant MIN_TRUTH_AUCTION_REPAIR_BPS = BPS_DENOMINATOR/)
	assert.ok(repairBpsMatch, 'SecurityPoolUtils must keep the truth-auction repair floor tied to BPS_DENOMINATOR')
	const normalizedPlaceholder = whitepaperPlaceholder.replaceAll(/\s+/g, ' ')
	assert.match(normalizedPlaceholder, /<code>MIN_TRUTH_AUCTION_REPAIR_BPS<\/code>[\s\S]*?<code>10000 bps \(100%\)<\/code>/, 'whitepaper parameter table must document the exact 100% truth-auction repair floor')
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
