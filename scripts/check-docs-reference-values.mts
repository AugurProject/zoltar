import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { getMainnetProtocolConfig } from '../shared/ts/protocolConfig'
import { ORACLE_CANDIDATE_PROOF_WINDOW_BLOCKS, ORACLE_ECONOMIC_OPPORTUNITY_BLOCK_COUNT, ORACLE_GAS_UNITS_FOR_PRICE_FINALIZATION } from '../shared/ts/oracleInitialReport'

const readme = await readFile('README.md', 'utf8')
const html = await readFile('docs/escalation-game-architecture.html', 'utf8')
const invariantsHtml = await readFile('docs/invariants.html', 'utf8')
const liquidationHtml = await readFile('docs/liquidation.html', 'utf8')
const openOracleIntegration = await readFile('docs/open-oracle-integration.html', 'utf8')
const securityModel = await readFile('docs/security-model.html', 'utf8')
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
const priceCandidateVerifier = await readFile('solidity/contracts/peripherals/OpenOraclePriceCandidateVerifier.sol', 'utf8')
const executionBlockHeaderProof = await readFile('solidity/contracts/peripherals/ExecutionBlockHeaderProof.sol', 'utf8')
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
assertRecursiveForkGasStatusDocs()
assertCoordinatorRecoveryBranch()
assertCoordinatorSettlementEconomics()
assertOpenOracleVendorAndEventDocs()
assertLiquidationFullCloseDocs()
assertStartHereTimelines()
assertContractInteractionDistinctions()

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
	assert.match(normalizedOperatorReference, /Child creation initializes the canonical carry and aggregate backing without waiting for vault transactions/)
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

function assertRecursiveForkGasStatusDocs(): void {
	assert.match(invariantsHtml, /id="ext-05"[\s\S]*Recursive fork gas bound[\s\S]*Enforcement status<\/dt><dd>Enforced/)
	for (const [documentName, contents] of [
		['README', readme],
		['Operator reference', operatorReference],
		['Security model', securityModel],
		['Zoltar whitepaper', zoltarWhitepaper],
		['Placeholder whitepaper', whitepaperPlaceholder],
	] as const) {
		assert.match(contents, /invariants\.html#ext-05/, `${documentName} must route recursive-fork gas status to EXT-05`)
		assert.doesNotMatch(
			contents,
			/open pre-deployment requirement|open recursive-depth requirement|must be bounded and validated before deployment|maximum supported recursive depth established under|there is no explicit maximum recursive fork depth|origin registration is keyed by origin id and universe|does not traverse(?:s)? the pool or universe ancestry|gas does not grow with recursive lineage depth/i,
			`${documentName} must not duplicate EXT-05 status or implementation evidence`,
		)
	}
}

function assertCoordinatorRecoveryBranch(): void {
	const normalizedIntegration = openOracleIntegration.replaceAll(/\s+/g, ' ')
	for (const documentedClaim of [
		'A successful callback withdraws the coordinator reporter balances back to the sponsor and stores a <code>SettledPriceCandidate</code>.',
		"If OpenOracle's low-level callback failed, <code>recoverSettledPendingReport</code> reconstructs and stages the same candidate from OpenOracle's stored finalized game.",
		'Recovery never accepts a price or consumes the queued operation.',
	]) {
		assert.ok(normalizedIntegration.includes(documentedClaim), `Missing coordinator recovery-branch claim: ${documentedClaim}`)
	}
	assert.match(whitepaperPlaceholder, /open-oracle-integration\.html#placeholder-integration/, 'whitepaper should route recovery details to the OpenOracle integration')
}

function assertCoordinatorSettlementEconomics(): void {
	const normalizedIntegration = openOracleIntegration.replaceAll(/\s+/g, ' ')
	const normalizedSecurityModel = securityModel.replaceAll(/\s+/g, ' ')
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	const normalizedWhitepaper = whitepaperPlaceholder.replaceAll(/\s+/g, ' ')
	for (const documentedClaim of ['Settlement creates a candidate, not a usable price.', 'A valid proof with insufficient economics rejects and clears the candidate;', 'Accepted prices retain the original OpenOracle settlement timestamp', 'One accepted price may authorize only one successful staged operation.']) {
		assert.ok(normalizedIntegration.includes(documentedClaim), `Missing coordinator settlement-economics claim: ${documentedClaim}`)
	}
	assert.match(priceCoordinator, /candidateVerifier\.verify\(/, 'coordinator must validate settled candidates through the historical-header verifier')
	assert.match(priceCoordinator, /lastSettlementTimestamp = candidate\.settlementTimestamp/, 'accepted prices must preserve the OpenOracle settlement timestamp')
	assert.match(priceCoordinator, /_consumeAcceptedPrice\(\)/, 'successful staged operations must consume the accepted price')
	assert.match(priceCandidateVerifier, /availableWeth >= maximumRequiredProfit/, 'candidate verifier must compare final report profit with the largest modeled dispute cost')
	for (const formulaFragment of [
		'maximumRequiredProfit = max(requiredProfit(block) for each proved opportunity block)',
		'availableWeth = floor(amount1 * (targetError - protocolFee - reporterFee)',
		'availableRep = floor(amount2 * (targetError - protocolFee - reporterFee)',
		'accept = everyBlockHadDisputeCapacity &amp;&amp; availableWeth &gt;= maximumRequiredProfit',
	]) {
		assert.ok(normalizedIntegration.includes(formulaFragment), `OpenOracle integration is missing candidate-finalization formula: ${formulaFragment}`)
	}
	assert.match(normalizedIntegration, /report is too low[\s\S]*profit is WETH-denominated[\s\S]*report is too high[\s\S]*profit is REP-denominated/, 'OpenOracle integration must explain both wrong-price correction directions')
	assert.match(normalizedIntegration, /allowance increase[\s\S]*availableWeth[\s\S]*manufactured liquidation eligibility[\s\S]*availableWeth[\s\S]*REP withdrawal[\s\S]*availableRep/, 'OpenOracle integration must map each protected operation to its native capacity')
	assert.match(priceCandidateVerifier, /header\.gasLimit - header\.gasUsed < configuration\.gasUnitsForOneDispute/, 'candidate verifier must reject opportunity windows without dispute gas capacity')
	assert.match(executionBlockHeaderProof, /blockhash\(header\.number\) == keccak256\(encodedHeader\)/, 'execution headers must be authenticated against canonical block hashes')
	assert.match(priceCoordinator, /uint256 ethCost = getRequestPriceEthCost\(\)/, 'coordinator must derive the request bounty from getRequestPriceEthCost')
	assert.match(priceCoordinator, /uint256 settlerReward = ethCost - finalizerReward/, 'coordinator must retain the candidate finalizer reward from the request bounty')
	assert.match(priceCoordinator, /settlerReward: uint96\(settlerReward\)/, 'coordinator report creation must forward the settler share as the OpenOracle reward')
	const requestBountyFormula = 'data-source="requestPriceEthCost = openOracleSettlerReward + candidateFinalizerReward"'
	assert.ok(openOracleIntegration.includes(requestBountyFormula), 'OpenOracle request-cost section must retain the current full request-bounty formula')
	assert.ok(!whitepaperPlaceholder.includes(requestBountyFormula), 'whitepaper must link to the canonical request-bounty formula instead of copying it')
	assert.doesNotMatch(whitepaperPlaceholder, /disputers can replace a bad\s+report with a larger one/, 'whitepaper must not claim every dispute strictly increases the report after integer flooring')
	assert.doesNotMatch(normalizedSecurityModel, /no downstream-notional or cumulative cache-usage cap|Report liquidity need not equal the value of one operation or all operations using the cached price/i, 'security model retains the superseded uncapped cached-price classification')
	assert.doesNotMatch(normalizedInvariants, /not required to equal or bound the value of withdrawals, liquidations, allowance changes|cumulative operations that use an accepted price/i, 'invariants retain the superseded uncapped cached-price classification')
	assert.doesNotMatch(normalizedWhitepaper, /callback replays up to 4|callback batch is capped at four|coordinator then replays the pending operation/i, 'whitepaper retains the superseded callback-execution lifecycle')
	assert.match(normalizedWhitepaper, /settlement stages a candidate[\s\S]*canonical-header proof accepts or rejects it before at most one successful operation/i, 'whitepaper must summarize candidate validation and single-use execution')
	assert.match(normalizedInvariants, /ORA-07[\s\S]*Candidate-only settlement and canonical proof[\s\S]*ORA-09[\s\S]*Single-use native operation capacities/, 'invariants must catalog candidate proof and single-use native capacities')
	for (const [parameterName, parameterValue] of [
		['economicOpportunityBlockCount', ORACLE_ECONOMIC_OPPORTUNITY_BLOCK_COUNT],
		['candidateProofWindowBlocks', ORACLE_CANDIDATE_PROOF_WINDOW_BLOCKS],
		['gasUnitsForPriceFinalization', ORACLE_GAS_UNITS_FOR_PRICE_FINALIZATION],
	] as const) {
		assert.match(normalizedIntegration, new RegExp(`${parameterName}[^<]*<\\/code>.*?<td><code>${parameterValue.toString().replace(/000$/, ',000')}`), `OpenOracle parameter table must document ${parameterName}`)
	}
	assert.match(operatorReference, /earliest of the five-minute accepted-price expiry and the configured 200-block candidate rejection boundary[\s\S]*256-block `blockhash` history is only a later hard ceiling/, 'operator workflow must state the effective candidate proof deadline')
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
	assert.doesNotMatch(openOracleIntegration, /\b(?:sponsor|caller)s?\s+(?:may\s+)?(?:voluntarily\s+)?post(?:s|ed|ing)?\b/i, 'OpenOracle integration must not describe the funding sponsor as posting the report')
	const normalizedIntegration = openOracleIntegration.replaceAll(/\s+/g, ' ')
	assert.ok(normalizedIntegration.includes('The sponsor may request and fund more than the minimum; the coordinator submits the selected amount as <code>currentAmount1</code>.'), 'OpenOracle integration must distinguish sponsor funding from coordinator submission')
	assert.doesNotMatch(openOracleIntegration, /<code>openOracleReportPrice<\/code>/, 'OpenOracle integration must not name the removed openOracleReportPrice function')
	assert.doesNotMatch(invariantsHtml, /<\/a\s*>\s*>\s*and\s*<a href="\.\.\/solidity\/ts\/tests\/openOracleDispute\.test\.ts"/, 'oracle verification row must not render a stray greater-than marker between test links')
}

function assertLiquidationFullCloseDocs(): void {
	const normalizedLiquidation = liquidationHtml.replaceAll(/\s+/g, ' ')

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

	assert.match(whitepaperPlaceholder, /href="\.\/liquidation\.html"/, 'whitepaper should route liquidation math and examples to the canonical design')
	assert.doesNotMatch(whitepaperPlaceholder, /id="eq-placeholder-liquidation-transfer"/, 'whitepaper must not duplicate the canonical liquidation equation')
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
	assert.match(whitepaperPlaceholder, /auction-design\.html#clearing/)
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
	assert.match(startHere, /placeholder-whitepaper\.html#migration/)
	assert.match(startHere, /merkle-mountain-range\.html/)
	assert.match(startHere, />activateForkMode</)
	assert.match(startHere, /A universe\s+fork alone leaves <code>systemState<\/code> as <code>Operational<\/code>/)
	assert.match(startHere, /Pool fork initiation calls <code>activateForkMode<\/code>/)
	assert.match(startHere, /<code>startTruthAuction<\/code> always moves\s+the child into <code>ForkTruthAuction<\/code>/)
	assert.match(startHere, /a child that needs no\s+auction finalizes immediately/)
	assert.match(startHere, /an auctioned child returns to\s+<code>Operational<\/code> after its deadline and value-free finalization/)
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
	assert.match(contractInteractionReference, /stages a `SettledPriceCandidate`[\s\S]*does not activate a price or execute an operation/)
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
	assert.match(contractInteractionReference, /Withdrawal-time allocation assigns division dust from deterministic cumulative ETH positions, making each payout independent of claim order/)
	assert.match(contractInteractionReference, /addFeeEligibleSecurityBondAllowance\(vault, amount\)[\s\S]*Finalized truth-auction settlement[\s\S]*newly auction-claimed security-bond allowance to the live fee denominator/)
	assert.match(contractInteractionReference, /`SystemStateSet`/)
	assert.match(securityPoolForker, /Before finalization, only refundable bids can be settled/)
	assert.match(securityPoolForker, /require\(claimTickIndices\.length == 0, 'Not final'\)/)
	assert.match(securityPoolForker, /block\.timestamp <= data\.forkActivationTime \+ SecurityPoolUtils\.MIGRATION_TIME/)
	assert.match(securityPoolForkerVaultMigrationDelegate, /require\(address\(childrenByPoolAndOutcome\[parent\]\[outcomeIndex\]\) == address\(0x0\), 'Child pool exists'\)/)
	assert.match(priceCoordinator, /candidate\.amount1 == 0 \|\| candidate\.amount2 == 0 \|\| candidatePrice == 0/)
	assert.match(priceCoordinator, /rejectionReason = 'Candidate price expired'/)
	assert.match(priceCoordinator, /rejectionReason = 'Insufficient dispute economics'/)
	assert.match(priceCoordinator, /sufficientEconomics/)
	assert.match(priceCoordinator, /require\(msg\.sender == pendingReportSponsor, 'Pending report sponsor only'\)/)
	assert.match(priceCoordinator, /require\(!isPriceUsable\(\), 'Fresh oracle price exists'\)/)
	assert.match(contractInteractionReference, /`isPriceUsable\(\)` is false[\s\S]*timestamp-valid price whose operation capacity was consumed is replaceable/)
	assert.match(priceCoordinator, /bool shouldRequestPrice =\s*pendingReportId == 0 && candidateReportId\(\) == 0 && pendingSettlementOperationIds\.length == 0/)
	assert.match(priceCoordinator, /if \(shouldRequestPrice && isPendingSettlementOperationId\)/)
	assert.match(escalationGameForker, /require\(child\.systemState\(\) == SystemState\.ForkMigration, 'Child not migrating'\)/)
	assert.match(escalationGameForker, /block\.timestamp <= forkDataByPool\[parent\]\.forkActivationTime \+ SecurityPoolUtils\.MIGRATION_TIME/)
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
	assert.match(truthAuction, /function _allocateFromCumulativePosition\(/)
	assert.match(invariantsHtml, /FORK-12[\s\S]*activates after value-free finalization with 9 ETH of tracked collateral/)
	assert.doesNotMatch(invariantsHtml, /remains inactive until repair/)
	assert.match(invariantsHtml, /AUC-06[\s\S]*complete unmigrated allowance[\s\S]*independent of claim order/)
	assert.match(invariantsHtml, /AUC-06[\s\S]*REP allocation rounds to zero[\s\S]*claiming that bid alone still credits the allowance/)
	assert.match(invariantsHtml, /AUC-07[\s\S]*aggregate[\s\S]*underfundedWinningEth \/ maxRepBeingSold[\s\S]*dust winner can round to zero REP/)
	assert.doesNotMatch(invariantsHtml, /fraction funded by the bid's retained ETH/)
	assert.match(contractInteractionReference, /winning dust bid can receive positive allowance when its REP share rounds to zero/)
	assert.match(contractInteractionReference, /`ClaimAuctionProceeds` when REP or allowance is credited/)
	assert.match(truthAuction, /return cumulativeAllocationAfter - cumulativeAllocationBefore/)
	assert.match(truthAuction, /require\(msg\.sender == owner, 'Only the auction owner can refund losing bids on behalf of bidders'\)/)
	assert.match(zoltar, /safeTransferFrom\(migrator, Constants\.BURN_ADDRESS, amount\)/)
	assert.match(zoltar, /ReputationToken\(address\(reputationToken\)\)\.burn\(migrator, amount\)/)
	for (const integrationSource of ['libraries/Errors.sol', 'interfaces/ISignatureTransfer.sol', 'openzeppelin/contracts/token/ERC20/IERC20.sol', 'openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol']) {
		assert.ok(operatorReference.includes(`openOracle/${integrationSource}`), `Operator Reference must directly link ${integrationSource}`)
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
