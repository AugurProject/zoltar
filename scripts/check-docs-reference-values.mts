import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { getMainnetProtocolConfig } from '../shared/ts/protocolConfig'

const readme = await readFile('README.md', 'utf8')
const auctionDesign = await readFile('docs/auction-design.html', 'utf8')
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
const contractReferenceGenerator = await readFile('scripts/generate-contract-interaction-reference.mts', 'utf8')
const eventStream = await readFile('docs/event-stream.md', 'utf8')
const deploymentStatus = await readFile('docs/deployment-status.html', 'utf8')
const escalationGame = await readFile('solidity/contracts/peripherals/EscalationGame.sol', 'utf8')
const escalationGameCarry = await readFile('solidity/contracts/peripherals/EscalationGameCarry.sol', 'utf8')
const escalationGameState = await readFile('solidity/contracts/peripherals/EscalationGameState.sol', 'utf8')
const escalationGameTypes = await readFile('solidity/contracts/peripherals/EscalationGameTypes.sol', 'utf8')
const escalationGameForker = await readFile('solidity/contracts/peripherals/EscalationGameForker.sol', 'utf8')
const escalationGameSettlement = await readFile('solidity/contracts/peripherals/EscalationGameSettlement.sol', 'utf8')
const escalationGameEscrow = await readFile('solidity/contracts/peripherals/EscalationGameEscrow.sol', 'utf8')
const priceCoordinator = await readFile('solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol', 'utf8')
const openOracleProvenance = await readFile('solidity/contracts/peripherals/openOracle/UPSTREAM.md', 'utf8')
const openOracleState = await readFile('shared/ts/openOracle.ts', 'utf8')
const securityPool = await readFile('solidity/contracts/peripherals/SecurityPool.sol', 'utf8')
const securityPoolDeployer = await readFile('solidity/contracts/peripherals/factories/SecurityPoolDeployer.sol', 'utf8')
const securityPoolFactory = await readFile('solidity/contracts/peripherals/factories/SecurityPoolFactory.sol', 'utf8')
const priceCoordinatorFactory = await readFile('solidity/contracts/peripherals/factories/PriceOracleManagerAndOperatorQueuerFactory.sol', 'utf8')
const shareTokenFactory = await readFile('solidity/contracts/peripherals/factories/ShareTokenFactory.sol', 'utf8')
const truthAuctionFactory = await readFile('solidity/contracts/peripherals/factories/UniformPriceDualCapBatchAuctionFactory.sol', 'utf8')
const securityPoolInterface = await readFile('solidity/contracts/peripherals/interfaces/ISecurityPool.sol', 'utf8')
const securityPoolForker = await readFile('solidity/contracts/peripherals/SecurityPoolForker.sol', 'utf8')
const securityPoolForkerVaultMigrationBase = await readFile('solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol', 'utf8')
const securityPoolForkerVaultMigrationDelegate = await readFile('solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationDelegate.sol', 'utf8')
const securityPoolEventEmitter = await readFile('solidity/contracts/peripherals/SecurityPoolEventEmitter.sol', 'utf8')
const securityPoolUtils = await readFile('solidity/contracts/peripherals/SecurityPoolUtils.sol', 'utf8')
const erc20 = await readFile('solidity/contracts/ERC20.sol', 'utf8')
const erc1155 = await readFile('solidity/contracts/peripherals/tokens/ERC1155.sol', 'utf8')
const erc1155Interface = await readFile('solidity/contracts/peripherals/interfaces/IERC1155.sol', 'utf8')
const reputationToken = await readFile('solidity/contracts/ReputationToken.sol', 'utf8')
const shareToken = await readFile('solidity/contracts/peripherals/tokens/ShareToken.sol', 'utf8')
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
await assertProductionSolidityInventory()

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
		['Statoblast whitepaper', normalizedPlaceholder],
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
		assert.ok(!normalizedPlaceholder.includes(forbiddenClaim), `Statoblast whitepaper retains obsolete per-vault continuation claim: ${forbiddenClaim}`)
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
	const normalizedEventStream = eventStream.replaceAll(/\s+/g, ' ')
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
		'`ZoltarQuestionData.QuestionCreated`',
		'The constructor emits it only for universe 0.',
		'`Zoltar.DeployChild`',
		'`deployer`, `universeId indexed`, `outcomeIndex indexed`, `childUniverseId indexed`, `childReputationToken`, `childUniverseTheoreticalSupply`',
		'`SecurityPoolFactory.SecurityPoolRegistered`',
		'`SecurityPoolForker.ChildPoolLinked`',
		'`SecurityPoolForker.ChildRepSplit`',
		'`SecurityPoolForker.ChildEscalationRepMaterialized`',
		'`SecurityPoolForker.ChildPoolRepSwept`',
		'`SecurityPoolForker.EscalationMigrationEntitlementInitialized`',
		'`SecurityPoolForker.EscalationMigrationEntitlementMaterialized`',
		'`ReputationToken.TheoreticalSupplySet(totalTheoreticalSupply)`',
		'`DeploymentStatusOracle.DeploymentAddressesSet(address[])`',
		'`AwaitingForkContinuationSet(awaitingForkContinuation)`',
		'`OwnershipDenominatorSet(poolOwnershipDenominator)`',
		'`ShareTokenSupplySet(shareTokenSupply)`',
		'`ForkedEscrowRecorded(depositor indexed, outcome indexed, sourcePrincipalTotal, childRepTotal, escrowedRepByVault, totalEscrowedRep, outcomeBalance)`',
		'current implementation never emits it',
		'The ERC-1155 ABI declares `URI`, but the current implementation never emits it',
		'a finite `transferFrom` spend decreases allowance without emitting `Approval`',
		'infinite allowance is neither decreased nor re-emitted',
		"OpenOracle's `InternalApproval`",
	]) {
		assert.ok(normalizedEventStream.includes(documentedClaim), `Missing event-stream unit or value-semantics claim: ${documentedClaim}`)
	}
	assert.equal(Array.from(zoltar.matchAll(/emit UniverseInitialized\s*\(/g)).length, 1, 'Zoltar must emit UniverseInitialized only for the root-universe constructor path')
	assert.match(zoltar, /emit DeployChild\(\s*msg\.sender,\s*universeId,\s*outcomeIndex,\s*childUniverseId,\s*childReputationToken,\s*childUniverseTheoreticalSupply\s*\)/)
	assert.match(erc1155Interface, /event URI\(string value, uint256 indexed id\)/)
	assert.doesNotMatch(erc1155, /\bemit\s+URI\s*\(/)
	assert.doesNotMatch(shareToken, /\bemit\s+URI\s*\(/)
	assert.match(erc20, /if \(currentAllowance < type\(uint256\)\.max\) \{[\s\S]*?_approve\(owner, spender, currentAllowance - value, false\)/)
	assert.doesNotMatch(normalizedEventStream, /Discovers every genesis or child universe/)
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
		['Statoblast whitepaper', whitepaperPlaceholder],
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
		'If the pending settlement list is empty, another staged request can fund a replacement report.',
		'If pending settlement operation IDs still remain, an operator or user must call direct <code>requestPrice(proposedRepPerEthPrice, requestedInitialWeth)</code> with the ETH bounty and initial-report funding, then let that replacement report settle.',
	]) {
		assert.ok(normalizedIntegration.includes(documentedClaim), `Missing coordinator recovery-branch claim: ${documentedClaim}`)
	}
	assert.match(whitepaperPlaceholder, /open-oracle-integration\.html#placeholder-integration/, 'whitepaper should route recovery details to the OpenOracle integration')
}

function assertCoordinatorSettlementEconomics(): void {
	const normalizedIntegration = openOracleIntegration.replaceAll(/\s+/g, ' ')
	for (const documentedClaim of [
		'Equality is accepted.',
		'correction profit at the configured target error remains <code>10 / 3</code> times the one-dispute gas cost at the largest admitted settlement base fee.',
		'That relationship is a deployment assumption, not a constructor invariant',
		"the constructor checks each multiplier's lower bound but does not require the settlement cap to remain below the Open Oracle Security multiplier.",
		'the callback does not recompute <code>minimumToken1Report()</code> from settlement base fee and does not compare the final price with an external truth source.',
		'The cap is a rejection boundary, not proof that an accepted price is externally correct;',
	]) {
		assert.ok(normalizedIntegration.includes(documentedClaim), `Missing coordinator settlement-economics claim: ${documentedClaim}`)
	}
	assert.match(priceCoordinator, /if \(block\.basefee > pendingReportMaxSettlementBaseFee\)/, 'coordinator must accept settlement base fee equal to the request-time cap')
	assert.match(priceCoordinator, /if \(amount1 == 0 \|\| amount2 == 0\)/, 'coordinator must reject empty settled token amounts')
	assert.match(priceCoordinator, /uint256 price = Math\.mulDiv\(amount2, PRICE_PRECISION, amount1\)/, 'coordinator must derive the settled REP/ETH ratio from final token amounts')
	assert.match(priceCoordinator, /uint256 ethCost = getRequestPriceEthCost\(\)/, 'coordinator must derive the request bounty from getRequestPriceEthCost')
	assert.match(priceCoordinator, /uint256 settlerReward = ethCost/, 'coordinator must assign the entire request bounty to the OpenOracle settler reward')
	assert.match(priceCoordinator, /settlerReward: uint96\(settlerReward\)/, 'coordinator report creation must forward the full request bounty as settler reward')
	const requestBountyFormula = 'data-source="requestPriceEthCost = block.basefee \\cdot 4 \\cdot (callbackGasLimit + gasConsumedOpenOracleReportPrice) + 101"'
	assert.ok(openOracleIntegration.includes(requestBountyFormula), 'OpenOracle request-cost section must retain the current full request-bounty formula')
	assert.ok(!whitepaperPlaceholder.includes(requestBountyFormula), 'whitepaper must link to the canonical request-bounty formula instead of copying it')
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
	assert.match(startHere, /d="M 800 103 C 818 103 812 59 835 59"/)
	assert.match(startHere, /d="M 800 103 C 818 103 812 151 835 151"/)
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
	assert.match(contractReferenceGenerator, /interaction\.declarations\.length, 1,[\s\S]*interaction rows must describe exactly one entrypoint name; split materially different guards, effects, and signals into separate rows/, 'generated interaction rows must remain limited to one entrypoint name')
	assert.match(invariantsHtml, /<code>SHARE-04<\/code>[\s\S]*remaining economic claim[\s\S]*source entitlements/)
	assert.match(invariantsHtml, /id="fork-10"[\s\S]*<code>FORK-10<\/code>[\s\S]*mints only the unmaterialized balance/)
	assert.match(invariantsHtml, /id="fork-11"[\s\S]*<code>FORK-11<\/code>[\s\S]*fork-time economic claim supply[\s\S]*Unequal ERC-1155 supplies[\s\S]*do not block complete-set minting[\s\S]*href="#share-04"><code>SHARE-04<\/code>/)
	assert.match(operatorReference, /invariants\.html#fork-10[\s\S]*invariants\.html#share-04[\s\S]*invariants\.html#fork-11/)
	assert.match(whitepaperPlaceholder, /none of the selected children has received[\s\S]*On a later call, each child receives only[\s\S]*current source balance - amount already materialized[\s\S]*every selected delta is zero, the call reverts/)
	assert.match(whitepaperPlaceholder, /invariants\.html#fork-10[\s\S]*invariants\.html#share-04[\s\S]*invariants\.html#fork-11/)
	assert.match(invariantsHtml, /FORK-05[\s\S]*forkActivationTime \+ 8 weeks[\s\S]*parent pool enters <code>PoolForked<\/code>[\s\S]*Share materialization has no expiry[\s\S]*already-created child/)
	assert.doesNotMatch(invariantsHtml, /Child creation, share migration, vault migration/)
	assert.doesNotMatch(invariantsHtml, /forkTime \+ 8 weeks/)
	assert.match(auctionDesign, /forkActivationTime \+ SecurityPoolUtils\.MIGRATION_TIME[\s\S]*pool-local[\s\S]*universe <code>forkTime<\/code>[\s\S]*invariants\.html#fork-05/)
	assert.doesNotMatch(auctionDesign, /8 weeks from the parent\s+universe fork time/)
	assert.match(whitepaperPlaceholder, /Parent retained \+ locked/)
	assert.doesNotMatch(whitepaperPlaceholder, /Parent burned/)
	assert.match(eventStream, /ShareTokenSupplySet[\s\S]*source entitlements whose child ERC-1155 balances have not materialized yet[\s\S]*Migrate[\s\S]*do not change this denominator/)
	assert.match(eventStream, /On every `startTruthAuction`, initialize the child's remaining economic claim supply from `ShareTokenSupplySet`[\s\S]*immediate no-auction path/)
	assert.match(contractInteractionReference, /single-target call may lazily create that child/)
	assert.match(contractInteractionReference, /every target in a multi-target call already has a canonical child pool/)
	assert.match(contractInteractionReference, /startTruthAuction\(securityPool\)[\s\S]*frozen parent's remaining economic claim supply[\s\S]*ShareTokenSupplySet/)
	assert.match(contractInteractionReference, /getForkThreshold`, `getNonDecisionThreshold`, `getUniverseTheoreticalSupply`/)
	assert.match(contractInteractionReference, /getQuestionResolution`, `getFinalQuestionResolution`/)
	assert.match(contractInteractionReference, /`fixedQuestionOutcome`/)
	assert.doesNotMatch(contractInteractionReference, /getCurrentCost/)
	assert.match(contractInteractionReference, /computeIterativeAttritionCost`, `computeTimeSinceStartFromAttritionCost`, `totalCost`/)
	assert.match(contractInteractionReference, /## ZoltarQuestionData[\s\S]*createQuestion\(questionData, outcomeOptions\)/)
	assert.match(contractInteractionReference, /## ReputationToken[\s\S]*setMaxTheoreticalSupply[\s\S]*mint\(account, value\)[\s\S]*burn\(account, value\)/)
	assert.match(contractInteractionReference, /## SecurityPoolFactory[\s\S]*deployOriginSecurityPool[\s\S]*securityMultiplier > 1[\s\S]*labels `Yes`, then `No`/)
	assert.match(contractInteractionReference, /securityPoolDeploymentsRange\(startIndex, count\)[\s\S]*reverts rather than truncating/)
	assert.match(contractInteractionReference, /burnEscalationWinnerHaircut\(amount\)[\s\S]*configured escalation game/)
	assert.match(contractInteractionReference, /getPoolAccountingSnapshot`, `getVaultFeeRemainder`/)
	assert.match(contractInteractionReference, /securityPoolEventEmitter`, `getVaultCount`/)
	assert.match(contractInteractionReference, /getMigratedRep`, `getForkActivationTime`/)
	assert.match(contractInteractionReference, /previewDepositOnOutcome`, `computeIterativeAttritionCost`/)
	assert.match(contractInteractionReference, /factory contract exposes no relay/)
	assert.doesNotMatch(contractInteractionReference, /Factory owner|EscalationGameFactory` owner/)
	assert.match(contractInteractionReference, /withdrawDeposit\(uint256 depositIndex, outcome\)[\s\S]*Owning `SecurityPool` only/)
	assert.match(contractInteractionReference, /withdrawDeposit\(CarriedDepositProof proof, outcome\)[\s\S]*Owning `SecurityPool` or its `SecurityPoolForker`/)
	assert.match(contractInteractionReference, /canonical child-pool truth auction registered by this forker during `ChildPoolLinked`/)
	assert.match(contractInteractionReference, /`trustedAuctionAddresses\[msg\.sender\]` was set when the forker linked that canonical child pool and emitted `ChildPoolLinked`/)
	assert.match(contractInteractionReference, /Accepts auction ETH during forker-controlled auction finalization/)
	assert.doesNotMatch(contractInteractionReference, /Accepts auction ETH during forker-controlled finalization and settlement/)
	assert.match(contractInteractionReference, /auction `AuctionFinalized` is followed by forker `TruthAuctionFinalized` and pool accounting checkpoints/)
	assert.match(operatorReference, /### Caller and trust boundaries[\s\S]*SecurityPoolEventEmitter[\s\S]*recognized pool or forker address/)
	assert.match(operatorReference, /EscalationGameDepositDelegate`, `EscalationGameForker`, and `SecurityPoolForkerVaultMigrationDelegate`[\s\S]*`claimForkedEscalationDeposits` and `migrateVaultWithUnresolvedEscalation`/)
	assert.match(operatorReference, /Migration delegates and storage modules[\s\S]*\[`EscalationGameForker\.sol`\]\(\.\.\/solidity\/contracts\/peripherals\/EscalationGameForker\.sol\)/)
	assert.match(deploymentStatus, /DeploymentAddressesSet\(address\[\] deploymentAddresses\)/)
	assert.match(escalationGame, /function startFromFork\([\s\S]*?forkContinuation = true;[\s\S]*?forkElapsedAtStart = elapsedAtFork;[\s\S]*?emit GameContinuedFromFork/)
	assert.match(contractInteractionReference, /startFromFork\(startBond, nonDecisionThreshold, elapsedAtFork, fixedQuestionOutcome, winnerHaircutPaidByFork, forkCarryInitialBacking\)[\s\S]*does not start the remaining clock until `resumeFromFork`/)
	assert.match(escalationGame, /function resumeFromFork\(\) external \{[\s\S]*?require\(forkResumedAt == 0, 'Fork resumed'\);[\s\S]*?forkResumedAt = block\.timestamp;[\s\S]*?emit ForkContinuationResumed/)
	assert.match(contractInteractionReference, /resumeFromFork\(\)[\s\S]*After the deadline, `getFinalQuestionResolution` returns the fixed outcome/)
	assert.match(escalationGameCarry, /function initializeForkCarrySnapshotWithResolutionBalances\([\s\S]*?\) external \{\s*_initializeForkCarrySnapshot\(/)
	assert.match(escalationGameCarry, /function _initializeForkCarrySnapshot\([\s\S]*?require\(msg\.sender == address\(securityPool\), 'Only pool'\);\s*require\(forkContinuation, 'No fork mode'\);\s*require\(!forkCarrySnapshotInitialized\(\), 'Snapshot initialized'\)/)
	assert.match(contractInteractionReference, /initializeForkCarrySnapshotWithResolutionBalances\(\.\.\.\)[\s\S]*no prior snapshot[\s\S]*Installs the immutable inherited peaks, leaf counts, carry totals, resolution balances, and normalized nullifier roots/)
	assert.match(contractInteractionReference, /currently unlocked REP ownership/)
	assert.match(contractInteractionReference, /optional unresolved-lock cleanup wrapper calls this function first to migrate any unlocked state/)
	assert.match(contractInteractionReference, /migrateVaultWithUnresolvedEscalation[\s\S]*First runs ordinary migration for the same vault[\s\S]*cleanup neither funds escalation backing nor authorizes carried proofs/)
	assert.match(contractInteractionReference, /external fork interrupted the game[\s\S]*winners settle in the child by carried proof[\s\S]*parent-lock cleanup is optional/)
	assert.doesNotMatch(contractInteractionReference, /external-fork timing may require migration instead/)
	assert.match(securityPool, /function withdrawForkedEscalationDeposits\([\s\S]*for \(uint256 index = 0; index < proofs\.length; index\+\+\)[\s\S]*_syncActiveVault\(beneficiaryVault\)/)
	assert.match(securityPool, /function withdrawFromEscalationGame\([\s\S]*for \(uint256 index = 0; index < depositIndexes\.length; index\+\+\)[\s\S]*_syncActiveVault\(beneficiaryVault\)/)
	assert.match(contractInteractionReference, /withdrawFromEscalationGame\(outcome, depositIndexes\)[\s\S]*An empty list returns after the outer lifecycle checks without settlement, state change, or event[\s\S]*No event for an empty list/)
	assert.match(contractInteractionReference, /withdrawForkedEscalationDeposits\(outcome, proofs\)[\s\S]*An empty list returns after the outer lifecycle checks without proof verification, state change, or event[\s\S]*No event for an empty list/)
	assert.match(contractInteractionReference, /Before finalization, refunds only provably losing bids/)
	assert.match(contractInteractionReference, /Auction owner \(`SecurityPoolForker`\) only; public callers use `settleAuctionBids`/)
	assert.match(contractInteractionReference, /Only a positive migration amount with at least one selected outcome checks the eight-week window, existing child `ForkMigration` state/)
	assert.match(contractInteractionReference, /child pool is not already deployed/)
	assert.match(contractInteractionReference, /selected child can be created or loaded, remains in `ForkMigration`, has its continuation game, and is inside the eight-week claim window/)
	assert.match(contractInteractionReference, /rejected settlement clears pending-report state but leaves staged operations queued for a later valid price path/)
	assert.match(contractInteractionReference, /setSecurityPool\(pool\)[\s\S]*Anyone while `securityPool` remains zero[\s\S]*zero value emits and checkpoints zero but leaves the setter callable/)
	assert.match(contractInteractionReference, /setRepEthPrice\(price\)[\s\S]*Configured nonzero `SecurityPool` only/)
	assert.match(openOracleIntegration, /setSecurityPool<\/code> once with that nonzero pool/)
	assert.match(contractInteractionReference, /While a report is pending, only that report sponsor may stage more operations/)
	assert.match(contractInteractionReference, /required only when this call opens a new report/)
	assert.match(contractInteractionReference, /Genesis REP requires allowance; child REP is burned directly without allowance/)
	assert.match(securityPool, /function isEscalationResolved\(\) public view returns \(bool\) \{\s*if \(address\(escalationGame\) == address\(0x0\)\) return false;\s*return ISecurityPoolForker\(securityPoolForker\)\.getQuestionOutcome\(this\) != BinaryOutcomes\.BinaryOutcome\.None/)
	assert.match(securityPoolForker, /if \(data\.fixedQuestionOutcomePlusOne > 0\)\s*return BinaryOutcomes\.BinaryOutcome\(data\.fixedQuestionOutcomePlusOne - 1\)/)
	assert.match(contractInteractionReference, /`isEscalationResolved\(\)` is true only when a local escalation game is configured and the forker routes a non-`None` outcome; an operational fixed-outcome child without a local game returns false/)
	assert.match(contractInteractionReference, /createCompleteSet\(\)[\s\S]*Operational and unforked; `isEscalationResolved\(\)` is false; not awaiting continuation/)
	assert.match(contractInteractionReference, /requestPriceIfNeededAndStageOperation\(\.\.\.\)[\s\S]*`securityPool\.isEscalationResolved\(\)` is false/)
	assert.doesNotMatch(contractInteractionReference, /Operational, unforked, unresolved|unresolved local escalation|Unresolved pool;/)
	assert.match(contractInteractionReference, /positive ETH converts to at least one complete-set unit/)
	assert.match(contractInteractionReference, /redeemCompleteSet\(completeSetAmount\)[\s\S]*caller accepts the resulting ETH call, including zero value[\s\S]*rejection of that ETH call reverts the transaction/)
	assert.match(securityPool, /function sharesToCash\(uint256 completeSetAmount\)[\s\S]*return \(completeSetAmount \* completeSetCollateralAmount\) \/ shareTokenSupply/)
	assert.match(securityPool, /function redeemCompleteSet\(uint256 completeSetAmount\)[\s\S]*uint256 ethValue = sharesToCash\(completeSetAmount\)/)
	assert.match(securityPool, /function redeemShares\(\)[\s\S]*completeSetCollateralAmount\) \/ shareTokenSupply[\s\S]*shareTokenSupply -= amount/)
	assert.match(securityPoolForker, /securityPool\.setTotalShares\(parent\.shareTokenSupply\(\)\)/)
	assert.match(contractInteractionReference, /redeemCompleteSet\(completeSetAmount\)[\s\S]*completeSetAmount \* completeSetCollateralAmount \/ shareTokenSupply[\s\S]*remaining economic claim supply[\s\S]*source entitlements materialize without changing it/)
	assert.doesNotMatch(contractInteractionReference, /redeemCompleteSet\(completeSetAmount\)[\s\S]*largest live outcome supply/)
	assert.match(whitepaperPlaceholder, /child uses its remaining economic claim supply as\s*the denominator[\s\S]*fork-time claims whose ERC-1155 balances\s*have not materialized there yet/)
	assert.doesNotMatch(whitepaperPlaceholder, /payout uses\s*the maximum outcome supply as its denominator/)
	assert.match(contractInteractionReference, /redeemShares\(\)[\s\S]*caller accepts the resulting ETH call, including zero value[\s\S]*rejection of that ETH call reverts the transaction/)
	assert.match(contractInteractionReference, /redeemFees\(vault\)[\s\S]*If resulting unpaid fees are zero, returns without payment[\s\S]*no event when fees and accrual state are unchanged/)
	assert.match(contractInteractionReference, /performWithdrawRep\(vault, repAmount\)[\s\S]*operational pool in an unforked universe[\s\S]*`isEscalationResolved\(\)` is false/)
	assert.match(whitepaperPlaceholder, /cashToShares[\s\S]*Exchange rate undefined/)
	assert.match(contractInteractionReference, /if an escalation game exists, the universe fork occurred before that game settled/)
	assert.match(contractInteractionReference, /withdrawDeposit\(uint256 depositIndex, outcome\)[\s\S]*`CarryDepositConsumed` and `VaultEscrowUpdated`[\s\S]*for a winner, `ClaimDeposit`/)
	assert.match(contractInteractionReference, /`EscalationRepDrainedAtFork` when unresolved escalation exists/)
	assert.match(contractInteractionReference, /Initially authorized `SecurityPoolFactory` for an origin pool; an authorized parent `SecurityPool` for a child pool/)
	assert.match(contractInteractionReference, /canonical source pool is `Operational` or `PoolForked`[\s\S]*every target in a multi-target call already has a canonical child pool/)
	assert.match(contractInteractionReference, /If needed, first freezes the operational source pool and records its fork snapshot/)
	assert.match(securityPoolForker, /uint256 migrationAmount = data\.ownFork \? data\.vaultRepAtFork : data\.auctionableRepAtFork;\s*if \(migrationAmount > 0\) \{\s*for \(uint256 index = 0; index < outcomeIndices\.length; index\+\+\)/)
	assert.match(contractInteractionReference, /migrateRepToZoltar\(securityPool, outcomeIndices\)[\s\S]*A zero migration amount or empty list returns after the proxy and pool-state guards without per-outcome validation or events/)
	assert.match(escalationGameForker, /ISecurityPool child = _getOrDeployChildPool\(parent, uint8\(outcomeIndex\)\);[\s\S]*_claimWinningDepositsFromGame\([\s\S]*emit ClaimForkedEscalationDepositsToWallet\(/)
	assert.match(contractInteractionReference, /claimForkedEscalationDeposits\(\.\.\.\)[\s\S]*An empty list still performs child setup and emits a zero-valued claim summary[\s\S]*always `ClaimForkedEscalationDepositsToWallet`, including for an empty list/)
	assert.match(securityPoolForkerVaultMigrationBase, /if \(address\(zoltar\.getRepToken\(childUniverseId\)\) == address\(0x0\)\) \{\s*zoltar\.deployChild\(parent\.universeId\(\), outcomeIndex\)/)
	assert.match(contractInteractionReference, /createChildUniverse\(securityPool, outcomeIndex\)[\s\S]*Loads an already deployed child universe and REP token or deploys them when absent[\s\S]*`DeployChild` only when child REP was absent/)
	assert.match(contractInteractionReference, /candidate reports this exact share token; its universe has no different canonical pool/)
	assert.match(contractInteractionReference, /Establishes the candidate as `canonicalPoolByUniverse`/)
	assert.match(operatorReference, /Canonical source and fork transition[\s\S]*asks its forker to initiate the pool fork[\s\S]*Canonical destinations[\s\S]*single-target migration may lazily create a missing child/)
	assert.match(contractInteractionReference, /`mintCompleteSets\(universeId, account, amount\)` \| An authorized `SecurityPool`/)
	assert.match(contractInteractionReference, /`burnCompleteSets\(universeId, account, amount\)` \| An authorized `SecurityPool`/)
	assert.match(contractInteractionReference, /`burnTokenIdAndGetRemainingSupply\(tokenId, account\)` \| An authorized `SecurityPool`/)
	assert.match(contractInteractionReference, /Fixes the clearing mode, clearing tick, ETH totals, and aggregate REP allocation/)
	assert.match(contractInteractionReference, /Withdrawal-time allocation assigns division dust from deterministic cumulative ETH positions, making each payout independent of claim order/)
	assert.match(truthAuction, /function finalize\(\) external \{[\s\S]*payable\(owner\)\.call\{ value: ethToSend \}\(''\)[\s\S]*require\(sent, 'Auction failed to send raised ETH to the owner'\)/)
	assert.match(truthAuction, /function withdrawBids\([\s\S]*for \(uint256 i = 0; i < tickIndices\.length; i\+\+\)[\s\S]*if \(totalEthRefund > 0\) \{/)
	assert.match(truthAuction, /function _refundLosingBids\([\s\S]*for \(uint256 i = 0; i < tickIndices\.length; i\+\+\)[\s\S]*payable\(bidder\)\.call\{ value: totalEthToRefund \}\(''\)/)
	assert.match(contractInteractionReference, /refundLosingBids\(tickIndices\)[\s\S]*still calls the bidder with zero ETH[\s\S]*no event for an empty list/)
	assert.match(contractInteractionReference, /finalize\(\)[\s\S]*owner accepts the proceeds ETH call, including zero value[\s\S]*A rejected call reverts finalization and its event/)
	assert.match(contractInteractionReference, /withdrawBids\(withdrawFor, tickIndices, proRataTotal\)[\s\S]*An empty list returns three zeros without changing bids, emitting events, or calling the beneficiary[\s\S]*no event for an empty list/)
	assert.match(zoltar, /function splitMigrationRep\([\s\S]*require\(universe\.forkTime != 0[\s\S]*splitRepInternal\(universeId, amount, msg\.sender, outcomeIndexes\)/)
	assert.match(zoltar, /function splitRepInternal\([\s\S]*for \(uint256 i = 0; i < outcomeIndexes\.length; i\+\+\)[\s\S]*reputationToken\.mint\(recipient, amount\)[\s\S]*emit MigrationRepSplit\(/)
	assert.match(reputationToken, /function mint\(address account, uint256 value\)[\s\S]*_mint\(account, value\);[\s\S]*emit Mint\(account, value\)/)
	assert.match(
		contractInteractionReference,
		/splitMigrationRep\(universeId, amount, outcomeIndexes\)[\s\S]*An empty outcome list returns after the universe-fork guard without outcome validation, deployment, minting, or events[\s\S]*nonempty zero-amount call still validates every outcome[\s\S]*child REP `Transfer` and `Mint`, then `MigrationRepSplit`[\s\S]*no event for an empty list/,
	)
	assert.match(securityPoolForker, /function _claimAuctionProceeds\([\s\S]*require\(data\.truthAuction\.finalized\(\), 'Not final'\)[\s\S]*data\.truthAuction\.withdrawBids\([\s\S]*_creditAuctionProceeds\(/)
	assert.match(
		contractInteractionReference,
		/claimAuctionProceeds\(securityPool, vault, tickIndices\)[\s\S]*For an empty list, the underlying auction withdrawal returns three zeros and the wrapper exits after the finalization guard without validating bids or the named beneficiary, calling it, changing state, or emitting events[\s\S]*no event for an empty list/,
	)
	assert.match(escalationGameSettlement, /function drainAllRep\(address receiver\)[\s\S]*amount = repToken\.balanceOf\(address\(this\)\);[\s\S]*if \(amount == 0\) return 0;[\s\S]*_safeTransferRep\(receiver, amount\)/)
	assert.match(contractInteractionReference, /drainAllRep\(receiver\)[\s\S]*A zero balance returns zero without a transfer or event[\s\S]*no event at zero balance/)
	assert.match(escalationGameEscrow, /function recordForkedEscrowForOutcome\([\s\S]*if \(sourcePrincipal == 0 && childRepAmount == 0\) return;[\s\S]*emit ForkedEscrowRecorded\(/)
	assert.match(contractInteractionReference, /recordForkedEscrowForOutcome\(depositor, outcome, sourcePrincipal, childRepAmount\)[\s\S]*When both amounts are zero, returns without changing state or emitting an event[\s\S]*no event when both amounts are zero/)
	assert.match(escalationGameEscrow, /function _exportForkedEscrowByOutcome\([\s\S]*if \(exported\) \{[\s\S]*emit ForkedEscrowExported\([\s\S]*if \(totalChildRepToTransfer == 0\) return/)
	assert.match(contractInteractionReference, /exportForkedEscrowByOutcome\(vault, repReceiver\)[\s\S]*When all outcomes were already empty or exported, returns zero arrays without state change, token transfer, or event[\s\S]*no event for an already-empty export/)
	assert.match(securityPool, /function transferEth\(address payable receiver, uint256 amount\)[\s\S]*_emitPoolAccountingCheckpoint\(AccountingReason\.CollateralReconciliation, address\(0x0\)\);[\s\S]*_sendEth\(receiver, amount\)/)
	assert.match(contractInteractionReference, /transferEth\(receiver, amount\)[\s\S]*receiver` accepts the ETH call, including zero value[\s\S]*At zero amount it reduces no collateral but still emits the checkpoint and performs a zero-value call/)
	assert.match(erc1155, /function _mint\(address to, uint256 id, uint256 value\)[\s\S]*emit TransferSingle\([\s\S]*_doSafeTransferAcceptanceCheck\(/)
	assert.match(erc1155, /function _mintBatch\(address to, uint256\[\] memory ids, uint256\[\] memory values\)[\s\S]*emit TransferBatch\([\s\S]*_doSafeBatchTransferAcceptanceCheck\(/)
	assert.match(shareToken, /alreadyMigratedAmount = migratedShareAmount[\s\S]*shareAmount = fromIdBalance - alreadyMigratedAmount[\s\S]*migratedSourceBalanceLocked\[fromId\]\[msg\.sender\] = true[\s\S]*_mint\(msg\.sender, toId, shareAmount\)[\s\S]*emit Migrate\(msg\.sender, fromId, toId, shareAmount\)/)
	assert.doesNotMatch(shareToken, /_burn\(msg\.sender, fromId, fromIdBalance\)/)
	assert.match(contractInteractionReference, /createCompleteSet\(\)[\s\S]*contract trader accepts `onERC1155BatchReceived`[\s\S]*Callback rejection rolls back the ETH, pool accounting, events, and share mint/)
	assert.match(contractInteractionReference, /migrate\(fromId, targetOutcomeIndexes\)[\s\S]*contract holder accepts `onERC1155Received` for every target mint[\s\S]*one ERC-1155 mint `TransferSingle` and `Migrate` per materialized target on successful callbacks/)
	assert.match(contractInteractionReference, /mintCompleteSets\(universeId, account, amount\)[\s\S]*contract account accepts `onERC1155BatchReceived`[\s\S]*Rejection rolls back the mint and the authorized pool's surrounding transaction/)
	assert.match(priceCoordinator, /function requestPrice\([\s\S]*if \(excess > 0\) \{[\s\S]*payable\(msg\.sender\)\.call\{ value: excess \}\(''\)[\s\S]*require\(sent, 'Oracle coordinator failed to refund excess ETH bounty'\)/)
	assert.match(priceCoordinator, /function requestPriceIfNeededAndStageOperation\([\s\S]*if \(refund > 0\) \{[\s\S]*payable\(msg\.sender\)\.call\{ value: refund \}\(''\)[\s\S]*require\(sent, 'Oracle coordinator failed to return unused ETH'\)/)
	assert.match(contractInteractionReference, /requestPriceIfNeededAndStageOperation\(\.\.\.\)[\s\S]*caller must accept any positive unused-ETH refund[\s\S]*rejection rolls back the entire transaction, including any queueing, immediate execution, or newly opened report/)
	assert.match(contractInteractionReference, /requestPrice\(proposedRepPerEthPrice, requestedInitialWeth\)[\s\S]*caller must accept any positive excess-ETH refund[\s\S]*Callback rejection rolls back the report and initial position/)
	assert.match(openOracleIntegration, /id="refund-callback"[\s\S]*Both public request paths refund only a positive unused or excess ETH\s+amount[\s\S]*If it rejects the refund, the entire transaction\s+reverts/)
	assert.match(operatorReference, /Immediate execution[\s\S]*canonical refund warning[\s\S]*open-oracle-integration\.html#refund-callback/)
	assert.match(priceCoordinator, /function recoverSettledPendingReport\(\)[\s\S]*finalizedGame\(reportId\)[\s\S]*require\(settlementTimestamp != 0, 'Pending oracle report has not settled'\)/)
	assert.match(contractInteractionReference, /recoverSettledPendingReport\(\)[\s\S]*stored OpenOracle `finalizedGame\(reportId\)\.settlementTimestamp` is nonzero/)
	assert.match(operatorReference, /Recovery path[\s\S]*requires both a pending report and a nonzero `finalizedGame\(reportId\)\.settlementTimestamp`/)
	assert.match(contractInteractionReference, /addFeeEligibleSecurityBondAllowance\(vault, amount\)[\s\S]*no lifecycle, vault, positive-amount, or value-change guard[\s\S]*newly auction-claimed security-bond allowance to the live fee denominator[\s\S]*including at zero amount/)
	assert.match(securityPool, /function setAwaitingForkContinuation\(bool shouldAwait\) external onlyForker \{\s*awaitingForkContinuation = shouldAwait;\s*emit AwaitingForkContinuationSet\(awaitingForkContinuation\)/)
	assert.match(contractInteractionReference, /setAwaitingForkContinuation\(shouldAwait\)[\s\S]*No lifecycle or value-change guard[\s\S]*`AwaitingForkContinuationSet`, including for a repeated value/)
	assert.match(securityPool, /function setSystemState\(SystemState newState\) external onlyForker \{\s*systemState = newState;\s*emit SystemStateSet\(systemState\)/)
	assert.match(contractInteractionReference, /setSystemState\(newState\)[\s\S]*No transition or value-change guard[\s\S]*`SystemStateSet`, including for a repeated state/)
	assert.match(securityPool, /function configureVault\([\s\S]*?\) external onlyForker \{[\s\S]*?_emitVaultAccountingCheckpoint\(vault\);\s*_emitPoolAccountingCheckpoint\(AccountingReason\.AllowanceChange, vault\)/)
	assert.match(contractInteractionReference, /configureVault\(vault, poolOwnership, securityBondAllowance, vaultFeeIndex\)[\s\S]*no lifecycle or value-change guard[\s\S]*Always `VaultAccountingCheckpoint` and `PoolAccountingCheckpoint`, including when all supplied values repeat current state/)
	assert.match(securityPool, /function setOwnershipDenominator\(uint256 newDenominator\) external onlyForker \{\s*poolOwnershipDenominator = newDenominator;\s*emit OwnershipDenominatorSet\(poolOwnershipDenominator\)/)
	assert.match(contractInteractionReference, /setOwnershipDenominator\(newDenominator\)[\s\S]*No lifecycle or value-change guard[\s\S]*`OwnershipDenominatorSet`, including for zero or a repeated value/)
	assert.match(securityPool, /function setTotalShares\(uint256 newTotalShares\) external onlyForker \{\s*shareTokenSupply = newTotalShares;\s*emit ShareTokenSupplySet\(shareTokenSupply\)/)
	assert.match(contractInteractionReference, /setTotalShares\(newTotalShares\)[\s\S]*No lifecycle or value-change guard[\s\S]*`ShareTokenSupplySet`, including for zero or a repeated value/)
	assert.match(securityPool, /function setPoolFinancials\([\s\S]*?lastUpdatedFeeAccumulator = block\.timestamp;[\s\S]*?_emitPoolAccountingCheckpoint\(AccountingReason\.ForkFinalization, address\(0x0\)\)/)
	assert.match(contractInteractionReference, /setPoolFinancials\(newCollateral, newTotalBondAllowance, newFeeEligibleBondAllowance\)[\s\S]*no lifecycle or value-change guard[\s\S]*`PoolAccountingCheckpoint`, including for repeated financial values/)
	assert.match(securityPool, /function addFeeEligibleSecurityBondAllowance\(address vault, uint256 amount\) external onlyForker \{[\s\S]*?_emitVaultAccountingCheckpoint\(vault\);\s*_emitPoolAccountingCheckpoint\(AccountingReason\.AuctionClaim, vault\)/)
	assert.match(securityPoolForker, /Before finalization, only refundable bids can be settled/)
	assert.match(securityPoolForker, /require\(claimTickIndices\.length == 0, 'Not final'\)/)
	assert.match(securityPoolForker, /block\.timestamp <= data\.forkActivationTime \+ SecurityPoolUtils\.MIGRATION_TIME/)
	assert.match(securityPoolForkerVaultMigrationDelegate, /require\(address\(childrenByPoolAndOutcome\[parent\]\[outcomeIndex\]\) == address\(0x0\), 'Child pool exists'\)/)
	assert.match(priceCoordinator, /_emitPriceReportRejected\(reportId, 'Base fee too high'\);\s*return;/)
	assert.match(priceCoordinator, /_emitPriceReportRejected\(reportId, 'Empty oracle settlement'\);\s*return;/)
	assert.match(priceCoordinator, /_emitPriceReportRejected\(reportId, 'Oracle price is zero'\);\s*return;/)
	assert.match(priceCoordinator, /require\(\s*msg\.sender == pendingReportSponsor,\s*'Only the pending report sponsor can queue more operations until settlement'/)
	assert.match(priceCoordinator, /bool shouldRequestPrice = pendingReportId == 0 && pendingSettlementOperationIds\.length == 0/)
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
	assert.match(securityPoolForker, /require\(trustedAuctionAddresses\[msg\.sender\], 'Trusted'\)/)
	assert.match(securityPoolForkerVaultMigrationBase, /trustedAuctionAddresses\[address\(truthAuction\)\] = true;[\s\S]*emit ChildPoolLinked\(parent, outcomeIndex, child, truthAuction\)/)
	assert.match(shareToken, /ISecurityPool sourcePool = canonicalPoolByUniverse\[universeId\]/)
	assert.match(shareToken, /if \(sourcePool\.systemState\(\) == SystemState\.Operational\) \{\s*forker\.initiateSecurityPoolFork\(sourcePool\)/)
	assert.match(shareToken, /require\(sourcePool\.systemState\(\) == SystemState\.PoolForked, 'ShareToken source pool cannot migrate'\)/)
	assert.match(shareToken, /require\(targetOutcomeIndexesLength == 1, 'ShareToken bulk migration requires canonical child pools'\)/)
	assert.match(shareToken, /address\(targetPool\) != address\(0x0\) && address\(targetPool\.parent\(\)\) == address\(sourcePool\)/)
	assert.match(shareToken, /address\(_securityPoolCandidate\.shareToken\(\)\) == address\(this\)/)
	assert.match(shareToken, /'ShareToken universe already has a canonical pool'/)
	assert.match(shareToken, /canonicalPoolByUniverse\[candidateUniverseId\] = _securityPoolCandidate/)
	assert.match(escalationGameSettlement, /function claimDepositForWinningWithoutTransfer\([\s\S]*?return _claimDepositForWinning\(depositIndex, outcome, false\)/)
	assert.match(contractInteractionReference, /claimDepositForWinningWithoutTransfer\(depositIndex, outcome\)[\s\S]*no explicit non-`None` guard[\s\S]*neither form checks final resolution or that the outcome won[\s\S]*neither transfers REP nor burns the computed haircut/)
	assert.match(
		escalationGameSettlement,
		/function withdrawDeposit\(\s*CarriedDepositProof calldata proof,[\s\S]*?require\(questionResolution != BinaryOutcomes\.BinaryOutcome\.None, 'Question not final'\)[\s\S]*?'Parent deposit claimed'[\s\S]*?require\(outcome == questionResolution, 'Not winning outcome'\)[\s\S]*?_verifyAndConsumeCarriedDepositProof/,
	)
	assert.match(contractInteractionReference, /withdrawDeposit\(CarriedDepositProof proof, outcome\)[\s\S]*game final and matching the pool final outcome[\s\S]*parent deposit was not directly claimed[\s\S]*valid unconsumed Merkle\/nullifier proof/)
	assert.match(escalationGameEscrow, /function _exportVaultUnresolvedTotals\([\s\S]*?require\(!localUnresolvedTotalsExportedByVault\[vault\], 'Vault totals exported'\)[\s\S]*?emit VaultUnresolvedTotalsExported\([\s\S]*?if \(principalToTransfer == 0\) return principalByOutcome/)
	assert.match(contractInteractionReference, /exportVaultUnresolvedTotals\(vault, repReceiver\)[\s\S]*no explicit nonzero-receiver guard[\s\S]*Always `VaultUnresolvedTotalsExported`, including when every amount is zero/)
	assert.match(contractInteractionReference, /exportVaultUnresolvedTotalsWithoutTransfer\(vault\)[\s\S]*has not exported before[\s\S]*Always `VaultUnresolvedTotalsExported` with `transferredRep = false`, including when every amount is zero[\s\S]*no REP transfer/)
	assert.match(securityPoolFactory, /bytes32 securityPoolSalt = keccak256\(abi\.encode\(parent, universeId, questionId, securityMultiplier\)\)/)
	assert.match(securityPoolFactory, /bytes32 securityPoolSalt = keccak256\(abi\.encode\(address\(0x0\), universeId, questionId, securityMultiplier\)\)/)
	assert.match(priceCoordinatorFactory, /new OpenOraclePriceCoordinator\{ salt: keccak256\(abi\.encode\(msg\.sender, salt\)\) \}/)
	assert.match(truthAuctionFactory, /new UniformPriceDualCapBatchAuction\{ salt: keccak256\(abi\.encode\(msg\.sender, salt\)\) \}/)
	assert.match(securityPoolDeployer, /create2\(0, add\(initCode, 0x20\), mload\(initCode\), 0\)/)
	assert.match(securityPoolFactory, /shareTokenFactory\.deployShareToken\(originId, questionId\)/)
	assert.match(shareTokenFactory, /new ShareToken\{ salt: salt \}\(msg\.sender, zoltar, questionId\)/)
	assert.match(operatorReference, /securityPoolSalt = keccak256\(abi\.encode\(parent, universeId, questionId, securityMultiplier\)\)[\s\S]*using a zero parent for an origin/)
	assert.match(operatorReference, /coordinator and child truth-auction factories each hash that value again with their caller \(`SecurityPoolFactory`\)/)
	assert.match(operatorReference, /pool deployment worker instead uses literal CREATE2 salt zero[\s\S]*full constructor init-code hash/)
	assert.match(operatorReference, /origin share token uses `originId = keccak256\(abi\.encode\(questionId, securityMultiplier, originUniverseId\)\)` directly as its CREATE2 salt[\s\S]*children reuse that lineage token/)
	assert.match(whitepaperPlaceholder, /<code>securityPoolSalt<\/code> seed from the parent address, universe\s*id, question id, and <code>securityMultiplier<\/code>, using a zero\s*parent for an origin/)
	assert.match(whitepaperPlaceholder, /pool deployment worker's raw CREATE2 salt\s*is zero; constructor init code commits the pool wiring/)
	assert.match(whitepaperPlaceholder, /href="\.\/operator-reference\.md#security-pool-guardrails"/)
	assert.doesNotMatch(whitepaperPlaceholder, /Origin-pool\s*deployment salts include/)
	for (const emitterFunction of ['emitPoolAccountingCheckpoint', 'emitVaultAccountingCheckpoint']) {
		assert.match(securityPoolEventEmitter, new RegExp(`function ${emitterFunction}\\([\\s\\S]*?\\) external payable`), `${emitterFunction} must remain externally payable for delegatecall flows`)
	}
	assert.match(securityPoolEventEmitter, /function emitForkSnapshotEvents\(\s*ISecurityPool parent,\s*address migrationProxy,\s*address sourceGame,\s*uint256 poolRepAtFork,\s*uint256 escalationRepAtFork,\s*uint256 resultingLockedRep\s*\) external payable/)
	assert.match(
		securityPoolForker,
		/mstore\(pointer, shl\(224, 0x408d33da\)\)[\s\S]*mstore\(add\(pointer, 0x04\), parent\)[\s\S]*mstore\(add\(pointer, 0x24\), migrationProxy\)[\s\S]*mstore\(add\(pointer, 0x44\), sourceGame\)[\s\S]*mstore\(add\(pointer, 0x64\), poolRepAtFork\)[\s\S]*mstore\(add\(pointer, 0x84\), escalationRepAtFork\)[\s\S]*mstore\(add\(pointer, 0xa4\), resultingLockedRep\)[\s\S]*delegatecall\(gas\(\), eventEmitter, pointer, 0xc4, 0, 0\)/,
	)
	assert.match(operatorReference, /Payability permits delegatecalls from value-bearing protocol flows; callers must not send ETH directly/)
	assert.match(truthAuction, /function _allocateFromCumulativePosition\(/)
	assert.match(truthAuction, /function finalize\(\) external[\s\S]*payable\(owner\)\.call\{ value: ethToSend \}/)
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
	for (const integrationSource of [
		'libraries/Errors.sol',
		'interfaces/ISignatureTransfer.sol',
		'openzeppelin/contracts/token/ERC20/IERC20.sol',
		'openzeppelin/contracts/interfaces/IERC1363.sol',
		'openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol',
		'openzeppelin/contracts/utils/Panic.sol',
		'openzeppelin/contracts/utils/ReentrancyGuard.sol',
		'openzeppelin/contracts/utils/StorageSlot.sol',
		'openzeppelin/contracts/utils/math/Math.sol',
		'openzeppelin/contracts/utils/math/SafeCast.sol',
	]) {
		assert.ok(operatorReference.includes(`openOracle/${integrationSource}`), `Operator Reference must directly link ${integrationSource}`)
	}
	for (const supportSource of ['SecurityPoolEventEmitter.sol', 'IEscalationGame.sol']) {
		assert.ok(operatorReference.includes(supportSource), `Operator Reference must inventory ${supportSource}`)
	}
}

async function assertProductionSolidityInventory(): Promise<void> {
	const inventoryDocuments = `${contractInteractionReference}\n${operatorReference}`
	for (const sourcePath of await listSoliditySources('solidity/contracts')) {
		if (sourcePath.startsWith('solidity/contracts/test/')) continue
		assert.ok(inventoryDocuments.includes(`../${sourcePath}`), `Contract and operator references must inventory production source ${sourcePath}`)
	}
}

async function listSoliditySources(directoryPath: string): Promise<string[]> {
	const sourcePaths: string[] = []
	for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
		const entryPath = `${directoryPath}/${entry.name}`
		if (entry.isDirectory()) sourcePaths.push(...(await listSoliditySources(entryPath)))
		else if (entry.isFile() && entry.name.endsWith('.sol')) sourcePaths.push(entryPath)
	}
	return sourcePaths.sort()
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
