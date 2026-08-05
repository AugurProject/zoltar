import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { getMainnetProtocolConfig } from '../shared/ts/protocolConfig'
import { htmlToDocumentationText } from './docs-html-text.mts'

const readme = await readFile('README.md', 'utf8')
const normalizeHtmlSource = (source: string): string => source.replaceAll(/<\/([a-z][\w:-]*)\s+>/gi, '</$1>')
const auctionDesign = normalizeHtmlSource(await readFile('docs/explanation/truth-auctions.html', 'utf8'))
const html = normalizeHtmlSource(await readFile('docs/explanation/escalation-game.html', 'utf8'))
const invariantsHtml = normalizeHtmlSource(await readFile('docs/reference/invariants.html', 'utf8'))
const liquidationHtml = normalizeHtmlSource(await readFile('docs/explanation/liquidations.html', 'utf8'))
const openOracleIntegration = normalizeHtmlSource(await readFile('docs/explanation/open-oracle.html', 'utf8'))
const zoltarWhitepaper = normalizeHtmlSource(await readFile('docs/explanation/zoltar.html', 'utf8'))
const whitepaperStatoblast = normalizeHtmlSource(await readFile('docs/explanation/statoblast.html', 'utf8'))
const contractArchitecture = normalizeHtmlSource(await readFile('docs/explanation/contract-architecture.html', 'utf8'))
const diagramSpecs = await readFile('docs/charts/diagramSpecs.json', 'utf8')
const normalizedDiagramSpecs = diagramSpecs.replaceAll(/\\n|\\t|\s+/g, ' ')
const chartRuntime = await readFile('docs/assets/js/chartRuntime.js', 'utf8')
const ambiguousVaultActorAlias = new RegExp(String.raw`\b(?:REP ${'vaults'}|vault ${'users'})\b`, 'i')
const startHere = normalizeHtmlSource(await readFile('docs/documentation.html', 'utf8'))
const forkMigrationGuide = normalizeHtmlSource(await readFile('docs/how-to/migrate-fork.html', 'utf8'))
const liquidationGuide = normalizeHtmlSource(await readFile('docs/how-to/liquidate-vault.html', 'utf8'))
const oracleRecoveryGuide = normalizeHtmlSource(await readFile('docs/how-to/recover-oracle-operation.html', 'utf8'))
const escalationGuide = normalizeHtmlSource(await readFile('docs/how-to/resolve-escalation.html', 'utf8'))
const truthAuctionGuide = normalizeHtmlSource(await readFile('docs/how-to/run-truth-auction.html', 'utf8'))
const operatorReference = htmlToDocumentationText(await readFile('docs/reference/operator-guardrails.html', 'utf8'))
const securityModel = await readFile('docs/reference/security-model.html', 'utf8')
const contractInteractionReference = htmlToDocumentationText(await readFile('docs/reference/contracts.html', 'utf8'))
const contractReferenceGenerator = await readFile('scripts/generate-contract-interaction-reference.mts', 'utf8')
const eventStream = htmlToDocumentationText(await readFile('docs/reference/event-stream.html', 'utf8'))
const protocolTerms = await readFile('docs/assets/js/protocolTerms.js', 'utf8')
const forkAuctionCopy = await readFile('ui/ts/copy/forkAuction.ts', 'utf8')
const deploymentStatus = normalizeHtmlSource(await readFile('docs/reference/deployment-status.html', 'utf8'))
const escalationGame = await readFile('solidity/contracts/peripherals/EscalationGame.sol', 'utf8')
const escalationGameClaimDelegate = await readFile('solidity/contracts/peripherals/EscalationGameClaimDelegate.sol', 'utf8')
const escalationGameDepositDelegate = await readFile('solidity/contracts/peripherals/EscalationGameDepositDelegate.sol', 'utf8')
const escalationGameCarry = await readFile('solidity/contracts/peripherals/EscalationGameCarry.sol', 'utf8')
const escalationGameState = await readFile('solidity/contracts/peripherals/EscalationGameState.sol', 'utf8')
const escalationGameTypes = await readFile('solidity/contracts/peripherals/EscalationGameTypes.sol', 'utf8')
const escalationGameForker = await readFile('solidity/contracts/peripherals/EscalationGameForker.sol', 'utf8')
const escalationGameCalculations = await readFile('solidity/contracts/peripherals/EscalationGameCalculations.sol', 'utf8')
const escalationGameSettlement = await readFile('solidity/contracts/peripherals/EscalationGameSettlement.sol', 'utf8')
const escalationGameEscrow = await readFile('solidity/contracts/peripherals/EscalationGameEscrow.sol', 'utf8')
const escalationGameFactory = await readFile('solidity/contracts/peripherals/factories/EscalationGameFactory.sol', 'utf8')
const priceCoordinator = await readFile('solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol', 'utf8')
const openOracleSource = await readFile('solidity/contracts/peripherals/openOracle/OpenOracle.sol', 'utf8')
const openOracleProvenance = await readFile('solidity/contracts/peripherals/openOracle/UPSTREAM.md', 'utf8')
const openOracleState = await readFile('shared/ts/openOracle.ts', 'utf8')
const securityPool = await readFile('solidity/contracts/peripherals/SecurityPool.sol', 'utf8')
const securityPoolLiquidationDelegate = await readFile('solidity/contracts/peripherals/SecurityPoolLiquidationDelegate.sol', 'utf8')
const securityPoolDeployer = await readFile('solidity/contracts/peripherals/factories/SecurityPoolDeployer.sol', 'utf8')
const securityPoolFactory = await readFile('solidity/contracts/peripherals/factories/SecurityPoolFactory.sol', 'utf8')
const priceCoordinatorFactory = await readFile('solidity/contracts/peripherals/factories/PriceOracleManagerAndOperatorQueuerFactory.sol', 'utf8')
const shareTokenFactory = await readFile('solidity/contracts/peripherals/factories/ShareTokenFactory.sol', 'utf8')
const truthAuctionFactory = await readFile('solidity/contracts/peripherals/factories/UniformPriceDualCapBatchAuctionFactory.sol', 'utf8')
const securityPoolInterface = await readFile('solidity/contracts/peripherals/interfaces/ISecurityPool.sol', 'utf8')
const securityPoolForker = await readFile('solidity/contracts/peripherals/SecurityPoolForker.sol', 'utf8')
const securityPoolForkerAuctionSettlementBase = await readFile('solidity/contracts/peripherals/SecurityPoolForkerAuctionSettlementBase.sol', 'utf8')
const securityPoolForkerBase = await readFile('solidity/contracts/peripherals/SecurityPoolForkerBase.sol', 'utf8')
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
const truthAuctionInterface = await readFile('solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol', 'utf8')
const zoltar = await readFile('solidity/contracts/Zoltar.sol', 'utf8')
const escalationGameForkThresholdTest = await readFile('solidity/ts/tests/escalationGameForkThreshold.test.ts', 'utf8')
const escalationGameBytecodeSnapshot = await readFile('solidity/ts/tests/fixtures/escalationGameBytecode.snapshot.json', 'utf8')
const forkMigrationTest = await readFile('solidity/ts/tests/peripherals/forkMigration.test.ts', 'utf8')
const truthAuctionTest = await readFile('solidity/ts/tests/peripherals/truthAuction.test.ts', 'utf8')

assertContinuationIdentifierExplanation()
assertDisputeStakedReplayIdentityDocs()
assertAggregateEscalationContinuationDocs()
assertNonDecisionLifecycleDocs()
assertAuditFindingRemediations()
assertInvariantCatalogOwnership()
assertInvariantCatalogLifecycleBoundaries()
assertEventStreamSemantics()
assertZoltarForkDepths()
assertRecursiveForkGasStatusDocs()
assertCoordinatorRecoveryBranch()
assertCoordinatorSettlementEconomics()
assertOpenOracleVendorAndEventDocs()
assertLiquidationFullCloseDocs()
assertTruthAuctionCombinedRepCapDocs()
assertMigrationSecurityCoverageCommitmentDocs()
assertLazyClaimCommitmentDocs()
assertEscalationGameBytecodeDocs()
assertLifecycleReferences()
assertOperationalGuideSemantics()
assertContractInteractionDistinctions()
assertSolidityFunctionReader()
await assertProductionSolidityInventory()

function assertContinuationIdentifierExplanation(): void {
	assert.ok(html.includes('(uint256(uint160(address(this))) &lt;&lt; 96)') && html.includes('(uint256(outcomeIndex) &lt;&lt; 88) | depositIndex'), 'docs/explanation/escalation-game.html must explain the reversible fork-continuation stable parent deposit identifier layout')
	assert.ok(html.includes('consumedParentDepositIndexes'), 'docs/explanation/escalation-game.html must connect the continuation identifier to consumedParentDepositIndexes')
	assert.ok(html.includes('LocalDepositAppended') && html.includes('CarryDepositConsumed') && html.includes('ClaimDeposit') && html.includes('exportUnresolvedDeposit(uint256,...)'), 'docs/explanation/escalation-game.html must name the exact event and local export surface that expose the continuation identifier')
	assert.ok(!html.includes('CarriedDepositClaimed'), 'docs/explanation/escalation-game.html must not reference the removed CarriedDepositClaimed event')
}

function assertDisputeStakedReplayIdentityDocs(): void {
	const replayIdentityFunction = securityPoolForkerBase.match(/function _getEscalationDepositId\([^}]+?\n\t\}/s)?.[0]
	assert.ok(replayIdentityFunction, 'SecurityPoolForkerBase.sol must define _getEscalationDepositId')
	assert.match(replayIdentityFunction, /ISecurityPoolFactory factory = securityPool\.securityPoolFactory\(\);/)
	assert.match(replayIdentityFunction, /bytes32 originId = factory\.getSecurityPoolOriginId\(securityPool\);/)
	assert.match(replayIdentityFunction, /keccak256\(abi\.encode\(factory, originId, outcomeIndex, parentDepositIndex\)\)/)

	const normalizedStatoblast = whitepaperStatoblast.replaceAll(/\s+/g, ' ')
	const normalizedArchitecture = html.replaceAll(/\s+/g, ' ')
	assert.ok(normalizedStatoblast.includes('keccak256(abi.encode(securityPoolFactory, originId, uint8(outcomeIndex), parentDepositIndex))'), 'Statoblast whitepaper must document the factory-scoped escalation replay identity encoded by SecurityPoolForkerBase.sol')
	assert.match(normalizedArchitecture, /factory-scoped lineage id[\s\S]*href="\.\.\/explanation\/statoblast\.html#migration">fork-migration specification<\/a> owns the exact construction/)
}

function assertTruthAuctionCombinedRepCapDocs(): void {
	assert.match(
		securityPoolForker,
		/uint256 combinedAuctionableRepAttoRep = poolAuctionableRepAtForkAttoRep \+ disputeStakedRepAttoRep;[\s\S]*if \(migratedRepHaircutAttoRep >= combinedAuctionableRepAttoRep\) return 0;[\s\S]*uint256 cap = combinedAuctionableRepAttoRep - migratedRepHaircutAttoRep;[\s\S]*if \(cap == combinedAuctionableRepAttoRep && address\(securityPool\.escalationGame\(\)\) != address\(0x0\)\) cap -= 1;/,
	)
	assert.match(
		whitepaperStatoblast,
		/data-source="combinedAuctionableRepAttoRep = poolAuctionableRepAtForkAttoRep \+ unresolvedDisputeStakedRepAttoRep; migratedRepHaircutAttoRep = migratedRepAttoRep \/ MAX_AUCTION_VAULT_HAIRCUT_DIVISOR; maxRepBeingSoldAttoRep = migratedRepHaircutAttoRep &gt;= combinedAuctionableRepAttoRep \? 0 : migratedRepHaircutAttoRep == 0 and escalationGameExists \? combinedAuctionableRepAttoRep - 1 : combinedAuctionableRepAttoRep - migratedRepHaircutAttoRep"/,
	)
	assert.match(whitepaperStatoblast, /cap reserves one attoREP[\s\S]*auction removal strictly smaller than its backing[\s\S]*nonzero aggregate game backing and a defined nonzero retention state/)
	assert.ok(!whitepaperStatoblast.includes('a live claim and a defined post-auction escalation state'), 'the one-attoREP auction reserve must not promise a positive individual claim after independent floors')
}

function assertMigrationSecurityCoverageCommitmentDocs(): void {
	assert.match(securityPoolUtils, /return\s+poolHeldVaultRepBackingAttoRep \* valueScale >\s+coverageCommitmentAttoEth \* migrationSecurityMultiplierBps \* repEthPrice;/)
	assert.match(liquidationHtml, /data-source="coverageCommitmentAttoEth = 0 or poolHeldVaultRepBackingAttoRep \* pricePrecision \* BPS_DENOMINATOR > coverageCommitmentAttoEth \* migrationSecurityMultiplierBps \* repPerEthPrice"/)
	assert.ok(!whitepaperStatoblast.includes('migratedOpenInterestValue'), 'the migration security inequality must use coverage commitment rather than routed OI')
	assert.match(liquidationHtml, /valueScale = pricePrecision × BPS_DENOMINATOR/)
	assert.match(whitepaperStatoblast, /liquidation design owns the exact integer equations/)
	assert.match(whitepaperStatoblast, /equality passes ordinary coverage admission but is unsafe for migration coverage/)
	assert.doesNotMatch(securityPoolUtils, /function calculateLiquidationTransfer\(/, 'the obsolete bonus-priced liquidation preview must not remain externally callable')
	const externalPureFunctions = [...securityPoolUtils.matchAll(/function\s+(\w+)\([^{}]*?\)\s+external\s+pure/g)].map(match => match[1])
	assert.deepEqual(externalPureFunctions, ['calculateFeeAccrual', 'calculateVaultFee', 'calculateBundledLiquidationTransfer', 'isVaultHealthy', 'isLiquidationBeyondMinPriceDistance', 'calculateRetentionRate'], 'SecurityPoolUtils external pure surface changed; document every preview and reject obsolete selectors')
	for (const functionName of externalPureFunctions) {
		assert.ok(operatorReference.includes(`\`${functionName}(`), `operator reference must document SecurityPoolUtils.${functionName}`)
	}
}

function assertLazyClaimCommitmentDocs(): void {
	assert.doesNotMatch(escalationGameTypes, /MAX_CLAIM_BUNDLES_PER_VAULT|MAX_CLAIM_OWNERS_PER_BUNDLE|MAX_PAYOUT_CLAIM_IMPORT_BATCH/)
	assert.match(html, /fixed 64-entry peak frontier is logarithmic commitment storage supporting up to <code>2\^64 - 1<\/code> leaves; it is not a 64-reporter or 64-portfolio cap/)
	assert.match(html, /Claims are non-transferable commitments[\s\S]*never copies per-claim or per-owner state from its parent/)
	assert.match(html, /Settlement supplies a leaf proof and nullifier proof, pays the committed depositor, and consumes that stable index once/)
	assert.match(liquidationHtml, /Only that pool-held vault REP backing and funded coverage commitment move\. Accrued fees and escalation claims stay with the target vault/)
	assert.doesNotMatch(liquidationHtml, /claim move|portfolio cap|owner slot/i)
	assert.doesNotMatch(escalationGameClaimDelegate, /moveEscalationClaim|payoutClaimBundle|getClaimOwner|liquidationClaimRep/)
	assert.doesNotMatch(escalationGameEscrow, /Escrow principal missing/)
	assert.match(whitepaperStatoblast, /Cumulative-prefix retention computes[\s\S]*retained\(cumulativeAmountAttoRep\) - retained\(cumulativeAmountAttoRep - amountAttoRep\)[\s\S]*floored prefix differences telescope to the aggregate checkpoint in every[\s\S]*proof order, preventing phantom unresolved principal/)
	assert.match(
		escalationGameClaimDelegate,
		/retainedCumulativeAmountAttoRep = IEscalationClaimCheckpointSource\(sourceGame\)[\s\S]*\.applyInheritedClaimRetention\(cumulativeAmountAttoRep, parentDepositIndex\);[\s\S]*retainedPreviousAmountAttoRep = IEscalationClaimCheckpointSource\(sourceGame\)[\s\S]*\.applyInheritedClaimRetention\(cumulativeAmountAttoRep - amountAttoRep, parentDepositIndex\);[\s\S]*return retainedCumulativeAmountAttoRep - retainedPreviousAmountAttoRep/,
	)
	for (const staleOwnershipPhrase of ['current liquidation owners', 'liquidation moved half the claim', 'current-owner shares', 'payout ownership copied', '64-key global cap', 'eight batches']) {
		for (const document of [invariantsHtml, whitepaperStatoblast, operatorReference, diagramSpecs]) assert.ok(!document.includes(staleOwnershipPhrase), `obsolete claim ownership/import text remains: ${staleOwnershipPhrase}`)
	}
	assert.doesNotMatch(operatorReference, /leaves owner import to permissionless/)
	assert.match(invariantsHtml, /Bob may relay Alice's valid winning proof[\s\S]*payout still goes entirely to Alice as the committed depositor/)
	assert.match(diagramSpecs, /to committed depositor/)
}

function assertEscalationGameBytecodeDocs(): void {
	const creationBytes = escalationGameBytecodeSnapshot.match(/"creationBytes":\s*(\d+)/)?.[1]
	const deployedBytes = escalationGameBytecodeSnapshot.match(/"deployedBytes":\s*(\d+)/)?.[1]
	assert.ok(creationBytes, 'EscalationGame bytecode snapshot must record creationBytes')
	assert.ok(deployedBytes, 'EscalationGame bytecode snapshot must record deployedBytes')
	const deployedHeadroom = 24_576 - Number(deployedBytes)
	const normalizedArchitecture = html.replaceAll(/\s+/g, ' ')
	assert.match(normalizedArchitecture, new RegExp(`<td><code>${Number(creationBytes).toLocaleString('en-US')}</code> bytes</td>`))
	assert.match(normalizedArchitecture, new RegExp(`<td><code>${Number(deployedBytes).toLocaleString('en-US')}</code> bytes</td>`))
	assert.strictEqual((normalizedArchitecture.match(new RegExp(`<td><code>${deployedHeadroom.toLocaleString('en-US')}</code> bytes below <code>24,576</code></td>`, 'g')) ?? []).length, 2, 'Escalation architecture must report snapshot-derived project and EIP-170 headroom')
}

function assertAggregateEscalationContinuationDocs(): void {
	const normalizedStatoblast = whitepaperStatoblast.replaceAll(/\s+/g, ' ')
	const normalizedArchitecture = html.replaceAll(/\s+/g, ' ')
	const normalizedOperatorReference = operatorReference.replaceAll(/\s+/g, ' ')
	const normalizedContractReference = contractInteractionReference.replaceAll(/\s+/g, ' ')
	const normalizedZoltarWhitepaper = zoltarWhitepaper.replaceAll(/\s+/g, ' ')
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	assert.match(escalationGameCarry, /forkCarryDisputeStakedRepAttoRep/, 'continuation implementation must retain an aggregate dispute-staked REP backing bucket')
	assert.match(normalizedStatoblast, /Locally dispute-staked REP remains attributed to its vault[\s\S]*Inherited fork-continuation backing instead remains aggregate[\s\S]*does not count toward any child vault's health or migration power/)
	assert.match(protocolTerms, /Local escalation REP remains attributed to its vault[\s\S]*Inherited fork-continuation backing is aggregate rather than child-vault health or migration credit/)
	assert.match(normalizedInvariants, /Continuation backing is not assigned to child-vault health or migration power/)
	for (const [documentName, contents] of [
		['Statoblast whitepaper', normalizedStatoblast],
		['Operator reference', normalizedOperatorReference],
	] as const) {
		for (const documentedClaim of ['aggregate backing', 'winning proof', 'committed depositor', 'inherited losers', 'parent escalation-deposit accounting', 'optional']) {
			assert.ok(contents.toLowerCase().includes(documentedClaim), `${documentName} must explain aggregate winner-only continuation semantics: ${documentedClaim}`)
		}
	}
	for (const documentedClaim of ['uncredited haircut', 'forkBurnDivisor']) {
		assert.ok(normalizedZoltarWhitepaper.includes(documentedClaim), `Zoltar whitepaper must document fork admission economics: ${documentedClaim}`)
		assert.ok(normalizedContractReference.includes(documentedClaim), `Contract interaction reference must document fork admission economics: ${documentedClaim}`)
	}
	assert.match(normalizedZoltarWhitepaper, /href="\.\/statoblast\.html#migration"[\s\S]*own-fork escalation continuation/, 'Zoltar fork admission rationale must link its Statoblast-specific continuation term to the canonical migration explanation')
	for (const forbiddenClaim of ['vaultEscrowChildRep', 'forked-escrow-scaling', 'forked-escrow-example', 'only selected vault escrow authorizes inherited proofs', 'vault migration grants only logical authorization', 'only materialized vault escrow authorizes proofs']) {
		assert.ok(!normalizedStatoblast.includes(forbiddenClaim), `Statoblast whitepaper retains obsolete per-vault continuation claim: ${forbiddenClaim}`)
	}
	assert.match(normalizedContractReference, /cleanup neither funds dispute-staked REP backing nor authorizes carried proofs/)
	assert.match(normalizedOperatorReference, /Child creation installs the canonical carry commitment, retention checkpoint, and aggregate backing without waiting for vault transactions or copying claims and owners/)
	assert.match(normalizedStatoblast, /resumeFromFork<\/code> verifies aggregate REP funding/)
	assert.match(normalizedOperatorReference, /resumeFromFork` remains paused until that backing is present after accounting for child REP already exported by valid direct pre-resume claims/)
	assert.match(normalizedInvariants, /continuation cannot resume until its game balance covers/)
	assert.match(normalizedInvariants, /id="fork-08"/)
	assert.match(normalizedInvariants, /sourcePrincipalAtForkAttoRep - ⌊sourcePrincipalAtForkAttoRep \/ 5⌋/)
	assert.match(normalizedContractReference, /resumeFromFork\(\)[\s\S]*sourcePrincipalAtForkAttoRep - ⌊sourcePrincipalAtForkAttoRep \/ 5⌋/)
	assert.match(normalizedStatoblast, /id="source-principal-at-fork"[\s\S]*aggregate raw unresolved principal[\s\S]*before effective direct-claim deductions/)
	assert.match(normalizedInvariants, /href="\.\.\/explanation\/statoblast\.html#source-principal-at-fork"/)
	assert.match(normalizedContractReference, /sourcePrincipalAtForkAttoRep` is the aggregate raw unresolved principal installed by the snapshot before effective direct-claim deductions/)
	assert.match(normalizedContractReference, /live balance must cover that initial backing minus child REP already exported by valid direct pre-resume claims/)
	assert.match(normalizedArchitecture, /resumeFromFork<\/code> keeps the continuation paused until the applicable aggregate backing is present and accounts for child REP already exported by valid direct pre-resume claims/)
	for (const summaryDocument of [normalizedArchitecture, normalizedOperatorReference]) {
		assert.match(summaryDocument, /statoblast\.html#migration/)
		assert.match(summaryDocument, /invariants\.html#fork-08/)
	}
	for (const documentedClaim of [
		'complete aggregate continuation backing at most once',
		'Optional vault cleanup only clears unresolved parent escalation-deposit accounting',
		'currentCarryTotalAttoRep</code> equals effective inherited unresolved principal plus unresolved local deposits',
		'a direct ancestor claim invalidates the matching proof in every descendant',
		'Inherited losing principal retires at finalization without a proof',
	]) {
		assert.ok(normalizedInvariants.includes(documentedClaim), `Invariant catalog must explain aggregate winner-only continuation semantics: ${documentedClaim}`)
	}
	for (const forbiddenClaim of ['credited to child escrow', 'forked child REP backing', 'Forked escrow claims never exceed']) {
		assert.ok(!normalizedInvariants.includes(forbiddenClaim), `Invariant catalog retains obsolete per-vault continuation claim: ${forbiddenClaim}`)
	}
	const nonDivisibleSourcePrincipal = 6n
	assert.equal(nonDivisibleSourcePrincipal - nonDivisibleSourcePrincipal / 5n, 5n, 'own-fork documentation boundary must round the 80% backing minimum up for non-divisible principal')
}

function assertNonDecisionLifecycleDocs(): void {
	const enumBody = escalationGameTypes.match(/enum NonDecisionState\s*\{([^}]*)\}/s)?.[1]
	assert.ok(enumBody, 'EscalationGameTypes.sol must define NonDecisionState')
	const enumMembers = enumBody
		.split(',')
		.map(member => member.trim())
		.filter(member => member.length > 0)
	const normalizedOperatorReference = operatorReference.replaceAll(/\s+/g, ' ')
	const normalizedStatoblast = whitepaperStatoblast.replaceAll(/\s+/g, ' ')
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	for (const enumMember of enumMembers) {
		assert.ok(normalizedOperatorReference.includes(`nonDecisionState = ${enumMember}`), `Operator reference must define NonDecisionState.${enumMember}`)
	}
	assert.match(normalizedOperatorReference, /nonDecisionState = Local[\s\S]*closes further deposits[\s\S]*nonDecisionState = InheritedThresholdTie[\s\S]*closes further deposits/)
	assert.ok(normalizedStatoblast.includes('Both explicit states close further deposits.'), 'Statoblast whitepaper must explain the shared deposit-closure rule')
	assert.match(normalizedDiagramSpecs, /local\s+game's fork eligibility[\s\S]*pool with an inherited fixed outcome[\s\S]*rejects both new local deposits and fork activation/)
	assert.match(normalizedDiagramSpecs, /Game-Local[\s\S]*Eligibility[\s\S]*pool guard still applies/)
	assert.match(normalizedStatoblast, /This diagram shows a local threshold crossing, which makes <code>canTriggerOwnFork\(\)<\/code> true[\s\S]*pool with an inherited fixed outcome rejects the deposits that could create this state[\s\S]*still rejects <code>activateForkMode\(\)<\/code>/)
	assert.match(normalizedStatoblast, /A continuation pool can fork again only when it has no inherited fixed outcome/)
	assert.match(normalizedStatoblast, /The game-local <code>canTriggerOwnFork\(\)<\/code> predicate returns true for a local non-decision, but it does not bypass the pool's fixed-outcome guard/)
	assert.match(
		normalizedStatoblast,
		/<h3 id="child-outcome-resolution">Child Outcome Resolution<\/h3>[\s\S]*pool stores and reports that result from child creation[\s\S]*Pool asset redemptions begin after the child becomes operational\.[\s\S]*continuation game exists[\s\S]*carried-deposit settlement only after its remaining continuation deadline\.[\s\S]*Later universe forks cannot transition a pool with an inherited fixed result, even when they reuse the pool question\.[\s\S]*Winning-share redemption burns only the fixed winning token and reduces the pool's remaining economic claim supply\.[\s\S]*surviving sibling outcome token as winning against that reduced denominator\.[\s\S]*fixed-outcome pool cannot use another fork to export a local non-decision[\s\S]*convert the depositor's pool-held vault REP backing into dispute-staked REP and block REP redemption[\s\S]*Carried winning proofs from the parent continuation remain claimable/,
	)
	assert.match(securityPoolForker, /function getQuestionOutcome\([\s\S]*if \(data\.fixedQuestionOutcomePlusOne > 0\)[\s\S]*return BinaryOutcomes\.BinaryOutcome\(data\.fixedQuestionOutcomePlusOne - 1\)/)
	assert.match(escalationGameCalculations, /function getFinalQuestionResolution\(\)[\s\S]*if \(block\.timestamp <= getEscalationGameEndDate\(\)\) return BinaryOutcomes\.BinaryOutcome\.None/)
	assert.match(
		normalizedInvariants,
		/<summary><code>ESC-12<\/code><span class="invariant-title">Pool and continuation payout agreement<\/span><\/summary>[\s\S]*Once a pool inherits that fixed outcome, new local escalation deposits and every later fork transition revert[\s\S]*rejects new local dispute-staked REP before escrow[\s\S]*eligible share, vault REP, and carried-proof redemption paths remain available/,
	)
	assert.match(normalizedOperatorReference, /Escalation deposit wrapper[\s\S]*rejects pools with an inherited fixed outcome because they cannot enter another fork or safely unwind a later local non-decision/)
	assert.match(normalizedOperatorReference, /Matching-question child outcome[\s\S]*`depositToEscalationGame` rejects new local deposits, and `activateForkMode` rejects every later pool fork transition[\s\S]*Child Outcome Resolution/)
	assert.match(
		normalizedStatoblast,
		/<td>Second fork<\/td>\s*<td>\s*This unrelated continuation has no fixed outcome and did not inherit a threshold tie\. When new activity records a local non-decision, <code>canTriggerOwnFork\(\)<\/code> becomes true\.\s*<\/td>\s*<td>\s*The same predicate also accepts an inherited threshold tie without a fixed outcome\./,
	)
	assert.match(protocolTerms, /local or inherited origin determines the game's canTriggerOwnFork\(\) predicate, but a successful pool fork also requires no inherited fixed outcome\. Fixed-outcome pools reject new local escalation deposits before this state can be created/)
	for (const forbiddenClaim of ['a later fork on the same question replaces the inherited outcome', 'the fixed result applies after continuation and is inherited through later unrelated descendants', 'a later unrelated fork keeps Yes as the payout outcome']) {
		assert.ok(!`${normalizedStatoblast} ${normalizedInvariants} ${normalizedOperatorReference}`.toLowerCase().includes(forbiddenClaim.toLowerCase()), `Fixed-outcome documentation retains obsolete replacement or descendant-inheritance semantics: ${forbiddenClaim}`)
	}
}

function assertAuditFindingRemediations(): void {
	const normalizedStatoblast = whitepaperStatoblast.replaceAll(/\s+/g, ' ')
	const normalizedAuctionDesign = auctionDesign.replaceAll(/\s+/g, ' ')
	const normalizedEventStream = eventStream.replaceAll(/\s+/g, ' ')
	assert.doesNotMatch(normalizedStatoblast, /Retention-rate updates also no-op when total coverage commitment is zero/, 'Statoblast whitepaper must not retain the obsolete total-coverage commitment zero-retention rule')
	assert.match(
		normalizedStatoblast,
		/Retention-rate updates no-op outside <code>Operational<\/code> mode or when the recalculated rate is unchanged\.[\s\S]*zero eligible coverage commitment selects the maximum retention rate/,
		'Statoblast whitepaper must describe the fee-eligible retention denominator and its zero case',
	)
	assert.match(securityPool, /function updateRetentionRate\(\) public \{[\s\S]*SecurityPoolUtils\.calculateRetentionRate\([\s\S]*feeEligibleCoverageCommitmentAttoEth/, 'SecurityPool retention updates must use fee-eligible coverage commitment')
	assert.match(securityPoolUtils, /if \(coverageCommitmentAttoEth == 0\) return MAX_RETENTION_RATE;/, 'SecurityPoolUtils must select maximum retention for zero eligible coverage commitment')
	assert.match(escalationGameCalculations, /if \(forkTime > getEscalationGameEndDate\(\)\) \{[\s\S]*actualForkThresholdAttoRep = nonDecisionThresholdAttoRep;/, 'Escalation payout must restore the configured threshold only for forks strictly after the scheduled game end')
	assert.match(normalizedStatoblast, /thresholds scale the payout down when no fork is recorded or the recorded universe <code>forkTime<\/code> is at or before the scheduled <code>escalationGameEndDate<\/code>/, 'Statoblast payout caption must cover both the no-fork case and the inclusive scheduled game-end boundary')
	assert.match(
		normalizedStatoblast,
		/When <code>forkTime<\/code> is strictly later than the scheduled <code>escalationGameEndDate<\/code>, the withdrawal calculation substitutes the configured <code>nonDecisionThresholdAttoRep<\/code> for the actual fork threshold, restoring the unscaled payout schedule for unclaimed winning deposits/,
		'Statoblast payout caption must document the implementation-linked strict-after threshold restoration for unclaimed withdrawals',
	)
	assert.doesNotMatch(normalizedStatoblast, /later unrelated fork (?:cannot reprice|leaves (?:the )?finalized payout unchanged)/i, 'Statoblast must not claim that a strictly later fork leaves unclaimed winning payouts unchanged')
	for (const boundaryName of ['one second before', 'exactly at', 'one second after']) {
		assert.ok(escalationGameForkThresholdTest.includes(boundaryName), `Escalation fork-threshold regression must cover ${boundaryName} game end`)
	}
	assert.match(truthAuctionInterface, /event EthRefundDeferred\(address indexed bidder, uint256 amountAttoEth, uint256 pendingAmountAttoEth\);/, 'Truth-auction interface must declare the deferred-refund delta and resulting balance')
	assert.match(truthAuctionInterface, /event PendingEthRefundWithdrawn\(address indexed bidder, uint256 amountAttoEth\);/, 'Truth-auction interface must declare successful deferred-refund withdrawals')
	assert.match(truthAuction, /REFUND_PUSH_GAS_LIMIT = 30_000;/, 'Truth-auction push refunds must retain the documented explicit CALL gas argument')
	assert.match(
		normalizedAuctionDesign,
		/explicit <code>gas: 30,000<\/code> call argument[\s\S]*EVM adds its <code>2,300<\/code>-gas value-transfer stipend[\s\S]*effective maximum of <code>32,300<\/code> gas/,
		'Truth Auction must canonically distinguish the explicit CALL gas argument from the EVM value-transfer stipend and effective callback maximum',
	)
	const normalizedRefundGasDocs = `${normalizedAuctionDesign} ${invariantsHtml} ${contractInteractionReference} ${contractReferenceGenerator}`.replaceAll(/<[^>]+>/g, '')
	assert.doesNotMatch(normalizedRefundGasDocs, /(?:at most|forwards at most|limited to) 30,000 gas/i, 'Refund documentation must not confuse the explicit CALL gas argument with the larger stipend-inclusive callback maximum')
	assert.match(
		securityPoolForker,
		/function _finalizeBackingUnitsAfterAuction\([\s\S]*uint256 incumbentRepAfterAttoRep =[\s\S]*currentBackingUnitsDenominator == 0 \|\| incumbentRepAfterAttoRep == 0[\s\S]*\? SecurityPoolUtils\.PRICE_PRECISION/,
		'Full-cap truth-auction REP backing units must use the standard REP precision instead of a phantom inherited denominator',
	)
	assert.match(
		normalizedAuctionDesign,
		/id="zero-migration-full-cap-rep-backing-units"[\s\S]*no vault REP migrated[\s\S]*auctionRepBackingUnitsPerAttoRep[\s\S]*PRICE_PRECISION[\s\S]*backingUnitsToAttoRep[\s\S]*later direct REP deposits/,
		'Truth Auction must canonically explain the zero-migration full-cap backing-unit conversion and fresh-deposit behavior',
	)
	assert.doesNotMatch(normalizedAuctionDesign, /(?:all the REP in the vaults have been auctioned off|old REP vault holders have been wiped)/i, 'Truth Auction must not claim that every underfunded auction sells all REP or wipes prior vault holders')
	assert.match(
		normalizedAuctionDesign,
		/When bidding ends[\s\S]*qualifying bidders collectively receive <code>maxRepBeingSoldAttoRep<\/code>[\s\S]*no bid qualifies, no REP is sold[\s\S]*Any unsold REP remains attributed through inherited REP backing units[\s\S]*zero-migration full-cap sale[\s\S]*href="#zero-migration-full-cap-rep-backing-units"/,
		'Truth Auction lifecycle summary must distinguish qualifying underfunding, no qualifying demand, residual REP backing units, and the zero-migration full-cap case',
	)
	assert.match(normalizedStatoblast, /href="\.\.\/explanation\/truth-auctions\.html#zero-migration-full-cap-rep-backing-units"[\s\S]*Truth Auction settlement specification/, 'Statoblast must link to the canonical zero-migration full-cap REP-backing-unit rule')
	assert.doesNotMatch(normalizedStatoblast, /zero-migration full-cap sale initializes auction ownership[\s\S]*30,000[\s\S]*withdrawPendingEthRefund/, 'Statoblast must not duplicate the exact truth-auction ownership and refund mechanics')
	for (const documentedClaim of [
		'`amountAttoEth` is the newly deferred delta and `pendingAmountAttoEth` is the authoritative resulting bidder balance',
		"require the event's `pendingAmountAttoEth` to equal the prior reconstructed balance plus the `amountAttoEth` delta",
		"require `amountAttoEth` to equal that bidder's complete prior balance, then clear it to zero",
		'any reentrant settlement that creates a new deferred refund appears later in the same receipt and adds to zero',
	]) {
		assert.ok(normalizedEventStream.includes(documentedClaim), `Event-stream guide must define deferred-refund reducer semantics: ${documentedClaim}`)
	}
	assert.match(contractReferenceGenerator, /settleAuctionBids[\s\S]*EthRefundDeferred[\s\S]*claimAuctionProceeds[\s\S]*EthRefundDeferred/, 'Generated public wrapper rows must expose possible deferred-refund signals')
}

function assertInvariantCatalogOwnership(): void {
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	const persistentHistoryEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-10"\s*>[\s\S]*?<\/details>/)?.[0]
	const activeTreeEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-11"\s*>[\s\S]*?<\/details>/)?.[0]
	const carryAccountingEntry = normalizedInvariants.match(/<details class="invariant-entry" id="esc-03"\s*>[\s\S]*?<\/details>/)?.[0]
	const carryCommitmentEntry = normalizedInvariants.match(/<details class="invariant-entry" id="esc-14"\s*>[\s\S]*?<\/details>/)?.[0]
	const auctionAllocationEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-05"\s*>[\s\S]*?<\/details>/)?.[0]
	const auctionLiabilityEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-12"\s*>[\s\S]*?<\/details>/)?.[0]
	const eventReplayEntry = normalizedInvariants.match(/<details class="invariant-entry" id="obs-01"\s*>[\s\S]*?<\/details>/)?.[0]
	const shareSupplyEntry = normalizedInvariants.match(/<details class="invariant-entry" id="share-06"\s*>[\s\S]*?<\/details>/)?.[0]
	assert.ok(persistentHistoryEntry, 'Invariant catalog must give AUC-10 a stable anchor for persistent tick history')
	assert.ok(activeTreeEntry, 'Invariant catalog must retain AUC-11 for active-tree and public-model equivalence')
	assert.ok(carryAccountingEntry, 'Invariant catalog must give ESC-03 a stable anchor for carry accounting')
	assert.ok(carryCommitmentEntry, 'Invariant catalog must retain ESC-14 for carry commitment structure')
	assert.ok(auctionAllocationEntry, 'Invariant catalog must give AUC-05 a stable anchor for allocation accounting')
	assert.ok(auctionLiabilityEntry, 'Invariant catalog must retain AUC-12 for raw ETH liability accounting')
	assert.ok(eventReplayEntry, 'Invariant catalog must retain OBS-01 for event-state replay equivalence')
	assert.ok(shareSupplyEntry, 'Invariant catalog must retain SHARE-06 for aggregate ERC-1155 supply conservation')
	assert.match(persistentHistoryEntry, /Bid cumulative ETH remains append-only[\s\S]*Refunded history is subtracted exactly once/)
	assert.match(activeTreeEntry, /href="#auc-10"><code>AUC-10<\/code><\/a>/, 'AUC-11 must link historical-prefix ownership to AUC-10')
	assert.doesNotMatch(activeTreeEntry, /Historical tick pages preserve|active bid prefixes subtract every prior refund/, 'AUC-11 must not duplicate AUC-10 historical-prefix requirements')
	assert.match(carryCommitmentEntry, /href="#esc-03"><code>ESC-03<\/code><\/a>/, 'ESC-14 must link unresolved-total ownership to ESC-03')
	assert.doesNotMatch(carryCommitmentEntry, /unresolved total equals inherited plus local principal/, 'ESC-14 must not duplicate ESC-03 carry-accounting requirements')
	assert.match(auctionLiabilityEntry, /href="#auc-05"><code>AUC-05<\/code><\/a>/, 'AUC-12 must link settlement-allocation ownership to AUC-05')
	assert.doesNotMatch(auctionLiabilityEntry, /each bid partitions exactly|aggregate filled REP equals/, 'AUC-12 must not duplicate AUC-05 settlement-allocation requirements')
	assert.match(eventReplayEntry, /href="\.\/event-stream\.html"/, 'OBS-01 must link the canonical event-stream specification')
	assert.match(shareSupplyEntry, /total supply equals the sum of holder balances[\s\S]*href="#fork-10"><code>FORK-10<\/code><\/a>/, 'SHARE-06 must own aggregate supply conservation and link migration ownership to FORK-10')
	assert.doesNotMatch(shareSupplyEntry, /persistent source entitlement|materialized child amount equals|cannot be materialized twice/, 'SHARE-06 must not duplicate FORK-10 source-entitlement requirements')
}

function assertInvariantCatalogLifecycleBoundaries(): void {
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	const coverageCommitmentEntry = normalizedInvariants.match(/<details class="invariant-entry" id="bal-08"\s*>[\s\S]*?<\/details>/)?.[0]
	const vaultEntry = normalizedInvariants.match(/<details class="invariant-entry" id="vault-03"\s*>[\s\S]*?<\/details>/)?.[0]
	const activeAuctionEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-11"\s*>[\s\S]*?<\/details>/)?.[0]
	const auctionLiabilityEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-12"\s*>[\s\S]*?<\/details>/)?.[0]
	assert.ok(coverageCommitmentEntry, 'Invariant catalog must retain BAL-08 lifecycle-qualified coverage commitment accounting')
	assert.ok(vaultEntry, 'Invariant catalog must retain VAULT-03 active-index boundary accounting')
	assert.ok(activeAuctionEntry, 'Invariant catalog must retain AUC-11 lifecycle-qualified clearing-tree accounting')
	assert.ok(auctionLiabilityEntry, 'Invariant catalog must retain AUC-12 ETH liability accounting')
	assert.match(coverageCommitmentEntry, /In <code>Operational<\/code>[\s\S]*During <code>ForkMigration<\/code>[\s\S]*A <code>PoolForked<\/code> parent retains its fork-time[\s\S]*positive-purchase truth-auction[\s\S]*purchases zero REP[\s\S]*href="\.\.\/explanation\/truth-auctions\.html#settlement"/)
	assert.match(vaultEntry, /A direct own-fork claim[\s\S]*may remain indexed with zero live state until its next pool-mediated synchronization/)
	assert.match(activeAuctionEntry, /Before finalization[\s\S]*pre-finalization refunds[\s\S]*Finalization freezes that tree and clearing result[\s\S]*href="#auc-12"><code>AUC-12<\/code><\/a>/)
	assert.match(auctionLiabilityEntry, /active unrefunded bids[\s\S]*aggregate <code>pendingEthRefundsAttoEth<\/code>[\s\S]*refunds still attached to unclaimed bids[\s\S]*deferred <code>pendingEthRefundsAttoEth<\/code>/)
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
		'Pool and vault `feeIndex` `1e18` fixed-point',
		'`currentRetentionRate` `1e18` fixed-point per-second multiplier',
		'Coordinator REP/ETH `price` `(attoREP * 1e18) / attoETH`',
		'Redemption `settlementCollateralRedeemedAttoEth` fields are the net attoETH paid',
		'`bidUsedAttoEth + refundAttoEth = originalBidAmountAttoEth`',
		'preserve the proof/carry roots, counts, peaks, and leaves under `escalationSnapshotId`',
		'`ForkCarryCheckpoint` installs that immutable proof state, aggregate backing, and retention checkpoint in the child',
		'It copies no leaves, bundles, or owners',
		'A winning inherited settlement supplies its carry proof',
		'pays once',
		'`InheritedThresholdTie(sourceGame indexed)`',
		'accept it only after a `ForkCarryCheckpoint` from the same child emitter',
		"require its indexed `sourceGame` to equal that checkpoint's source",
		'require `ids.length == values.length`',
		'apply each `(ids[i], values[i])` pair in array order',
		'Array-taking protocol calls expand into one cause event per affected item',
		'`ZoltarQuestionData.QuestionCreated`',
		'The constructor emits it only for universe 0.',
		'`Zoltar.DeployChild`',
		'`deployer`, `universeId indexed`, `outcomeIndex indexed`, `childUniverseId indexed`, `childReputationToken`, `childUniverseTheoreticalSupplyAttoRep`',
		'`SecurityPoolFactory.SecurityPoolRegistered`',
		'`SecurityPoolFactory.DeploySecurityPool` `securityPool indexed`, `truthAuction`, `priceOracleManagerAndOperatorQueuer`, `shareToken`, `parent indexed`, `universeId indexed`, `questionId`, `statoblastSecurityMultiplierBps`, `initialReportPriorityFeeAttoEthPerGas`, `currentRetentionRate`, `settlementCollateralAttoEth`',
		'`SecurityPoolForker.ChildPoolLinked`',
		'`SecurityPoolForker.ChildRepSplit`',
		'`SecurityPoolForker.ChildDisputeStakedRepMaterialized`',
		'`SecurityPoolForker.PoolHeldRepSweptToChild`',
		'`SecurityPoolForker.EscalationMigrationEntitlementInitialized`',
		'`SecurityPoolForker.EscalationMigrationEntitlementMaterialized`',
		'`ReputationToken.TheoreticalSupplySet(totalTheoreticalSupplyAttoRep)`',
		'`DeploymentStatusOracle.DeploymentAddressesSet(address[])`',
		'`AwaitingForkContinuationSet(awaitingForkContinuation)`',
		'`TotalRepBackingUnitsSet(totalRepBackingUnits)`',
		'`ShareTokenSupplySet(shareTokenSupplyAttoShares)`',
		'`ForkedEscrowRecorded(depositor indexed, outcome indexed, sourcePrincipalTotalAttoRep, childRepTotalAttoRep, disputeStakedRepByVaultAttoRep, totalDisputeStakedRepAttoRep, outcomeBalanceAttoRep)`',
		'current implementation never emits it',
		'The ERC-1155 ABI declares `URI`, but the current implementation never emits it',
		'a finite `transferFrom` spend decreases allowance without emitting `Approval`',
		'infinite allowance is neither decreased nor re-emitted',
		"OpenOracle's `InternalApproval`",
	]) {
		assert.ok(normalizedEventStream.includes(documentedClaim), `Missing event-stream unit or value-semantics claim: ${documentedClaim}`)
	}
	for (const documentedField of ['resultingDisputeStakedRepBalanceAttoRep', 'resultingChildPoolHeldRepBalanceAttoRep', 'childRepAttoRep', 'repBeforeAttoRep', 'repRemovedAttoRep', 'repRemainingAttoRep', 'amountAttoEth']) {
		assert.ok(normalizedEventStream.includes(`\`${documentedField}\``), `Missing canonical event field in event-stream reference: ${documentedField}`)
	}
	assert.match(truthAuctionInterface, /event AuctionFinalized\([\s\S]*grossAcceptedAttoEth,[\s\S]*repSoldAttoRep,[\s\S]*bidAtClearingTickAttoEth/)
	assert.match(truthAuctionInterface, /event BidSettled\([\s\S]*originalBidAmountAttoEth,[\s\S]*bidUsedAttoEth,[\s\S]*repFilledAttoRep,[\s\S]*refundAttoEth/)
	assert.match(normalizedEventStream, /`grossAcceptedAttoEth` is the accepted ETH[\s\S]*`bidUsedAttoEth \+ refundAttoEth = originalBidAmountAttoEth`/)
	assert.doesNotMatch(eventStream, /grossEthAcceptedAttoEth|ethUsedAttoEth|ethRefundAttoEth|originalEthAmountAttoEth/)
	assert.match(securityPoolForkerVaultMigrationBase, /childForkData\.migratedRepBackingUnits == parentBackingUnitsDenominator[\s\S]*parentRepAtForkAttoRep - childForkData\.migratedRepAttoRep/)
	assert.match(whitepaperStatoblast, /cumulative migrated backing units equal the parent total[\s\S]*final migration routes the exact remaining REP delta into the selected child/)
	assert.match(normalizedDiagramSpecs, /cumulative migrated backing units reach the parent total[\s\S]*remaining REP delta into the selected child[\s\S]*settlement-collateral target/)
	assert.doesNotMatch(`${auctionDesign}\n${whitepaperStatoblast}\n${openOracleIntegration}\n${forkAuctionCopy}`, /free[^\n]{0,24}REP|live child owner|child-pool owners/i)
	assert.match(openOracleIntegration, /snapshotTargetVaultRepBackingAttoRep \+ snapshotDisputeStakedRepAttoRep/)
	assert.match(openOracleIntegration, /<mi>snapshotTargetVaultRepBackingAttoRep<\/mi>[\s\S]*<mi>snapshotDisputeStakedRepAttoRep<\/mi>/)
	assert.match(whitepaperStatoblast, /migrationRepDenominatorAtForkAttoRep[\s\S]*cumulativeRepTransferredAfterMigrationAttoRep/)
	assert.match(whitepaperStatoblast, /<mi>migrationRepDenominatorAtForkAttoRep<\/mi>[\s\S]*<mi>cumulativeRepTransferredAfterMigrationAttoRep<\/mi>/)
	assert.match(zoltarWhitepaper, /uncreditedForkHaircutAttoRep[\s\S]*forkInitiatorMigrationBalanceAttoRep/)
	assert.equal(Array.from(zoltar.matchAll(/emit UniverseInitialized\s*\(/g)).length, 1, 'Zoltar must emit UniverseInitialized only for the root-universe constructor path')
	assert.match(zoltar, /emit DeployChild\(\s*msg\.sender,\s*universeId,\s*outcomeIndex,\s*childUniverseId,\s*childReputationToken,\s*childUniverseTheoreticalSupplyAttoRep\s*\)/)
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
	assert.match(zoltar, /_forkBurnDivisor >= Constants\.MINIMUM_FORK_BURN_DIVISOR/)
	assert.match(zoltar, /uint256 migrationRepBalanceAttoRep = forkThresholdAttoRep - forkThresholdAttoRep \/ forkBurnDivisor;/)

	const nonDivisibleThreshold = 6n
	const haircut = nonDivisibleThreshold / protocolConfig.forkBurnDivisor
	const migrationCredit = nonDivisibleThreshold - haircut
	assert.equal(haircut, 1n, 'non-divisible fork threshold haircut must round down')
	assert.equal(migrationCredit, 5n, 'non-divisible fork threshold remainder must round the 80% migration credit up')

	const normalizedWhitepaper = zoltarWhitepaper.replaceAll(/<[^>]*>/g, '').replaceAll(/\s+/g, ' ')
	for (const documentedClaim of [
		'⌊forkThresholdAttoRep / 5⌋, approximately 20% of the threshold',
		'⌈4 × forkThresholdAttoRep / 5⌉',
		'constructor rejects forkBurnDivisor &lt; 5',
		'rounded up when the threshold is not divisible by five',
		'Later REP added to a migration balance converts 1:1',
		'intended admission cost',
	]) {
		assert.ok(normalizedWhitepaper.includes(documentedClaim), `Missing Zoltar fork haircut claim: ${documentedClaim}`)
	}
}

function assertRecursiveForkGasStatusDocs(): void {
	assert.match(invariantsHtml, /id="ext-05"[\s\S]*Recursive fork gas bound[\s\S]*Enforcement status<\/dt>\s*<dd>Reviewed preservation/)
	for (const [documentName, contents] of [
		['README', readme],
		['Operator reference', operatorReference],
		['Zoltar whitepaper', zoltarWhitepaper],
		['Statoblast whitepaper', whitepaperStatoblast],
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
		'a saturated <code>uint24</code> report counter, reported as <code>Counter saturated</code>, a final history record whose WETH amount is too small for another dispute',
		'reported as <code>Report uneconomic</code>',
		'zero amounts, or a computed zero price clears the pending id, emits <code>PriceReportRejected</code>, and does not update the price cache or replay pending operations. Those pending settlement operations remain queued for a later valid price report.',
		'If the pending settlement list is empty, another staged request can fund a replacement report.',
		'If pending settlement operation IDs still remain, an operator or user must call direct <code>requestPrice(proposedRepPerEthPrice, requestedInitialWethAttoEth)</code> with the ETH bounty and initial-report funding, then let that replacement report settle.',
	]) {
		assert.ok(normalizedIntegration.includes(documentedClaim), `Missing coordinator recovery-branch claim: ${documentedClaim}`)
	}
	assert.match(whitepaperStatoblast, /open-oracle\.html#statoblast-integration/, 'whitepaper should route recovery details to the OpenOracle integration')
}

function assertCoordinatorSettlementEconomics(): void {
	const normalizedIntegration = openOracleIntegration.replaceAll(/\s+/g, ' ')
	for (const documentedClaim of [
		'Equality is accepted.',
		'correction profit at the configured target error is <code>10(b + p) / (3b + p)</code> times one-dispute gas cost at the largest admitted settlement base fee.',
		'This is at least the base-fee-only <code>10 / 3</code> lower bound; an open-interest-dominant report only increases the position.',
		'The bound is a deployment assumption, not a constructor invariant',
		'the callback cap constrains only <code>block.basefee</code>, so a prevailing transaction priority fee above <code>p</code> weakens it.',
		"The constructor checks each multiplier's lower bound but does not require the settlement cap to remain below the Open Oracle Security multiplier.",
		'the callback does not recompute <code>minimumToken1ReportAttoEth()</code> from settlement base fee and does not compare the final price with an external truth source.',
		"OpenOracle records each report block's base fee when dispute tracking is enabled.",
		'If that <code>uint24</code> counter is saturated, the callback rejects the price with <code>Counter saturated</code> because a later dispute can overwrite history index <code>type(uint24).max</code> without advancing the counter.',
		"Otherwise it selects history index <code>numReports - 1</code> and requires the final WETH amount to cover the configured security formula at that record's base fee plus the configured priority fee.",
		'This check proves only that the final WETH position meets the modeled security-sizing floor.',
		'A correction is modeled as profitable only when the price is wrong by at least the configured target error and the configured priority-fee, gas-unit, fee, and transaction-inclusion assumptions hold; the check does not prove that an accepted price is externally correct.',
	]) {
		assert.ok(normalizedIntegration.includes(documentedClaim), `Missing coordinator settlement-economics claim: ${documentedClaim}`)
	}
	const requestBaseFee = 30n
	const configuredPriorityFee = 10n
	const actualPriorityFeeAtAssumption = configuredPriorityFee
	const actualPriorityFeeAboveAssumption = 60n
	const openOracleSecurityMultiplier = 10n
	const settlementBaseFeeMultiplier = 3n
	const correctionGasBudget = openOracleSecurityMultiplier * (requestBaseFee + configuredPriorityFee)
	const settlementGasCostAtAssumption = settlementBaseFeeMultiplier * requestBaseFee + actualPriorityFeeAtAssumption
	const settlementGasCostAboveAssumption = settlementBaseFeeMultiplier * requestBaseFee + actualPriorityFeeAboveAssumption
	assert.ok(correctionGasBudget * 3n >= settlementGasCostAtAssumption * 10n, 'positive configured priority must preserve the base-fee-only 10/3 lower bound when actual priority matches')
	assert.notEqual(correctionGasBudget * 3n, settlementGasCostAtAssumption * 10n, 'positive configured priority makes the settlement-cap ratio larger than, rather than exactly, 10/3')
	assert.ok(correctionGasBudget * 3n < settlementGasCostAboveAssumption * 10n, 'an actual priority fee above configuration can weaken the 10/3 base-fee-only bound')
	assert.match(
		priceCoordinator,
		/uint256 maxSettlementBaseFeeAttoEthPerGas = pendingReportMaxSettlementBaseFeeAttoEthPerGas;\s*pendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;\s*if \(block\.basefee > maxSettlementBaseFeeAttoEthPerGas\)/,
		'coordinator must preserve the request-time cap before clearing it and accept an equal settlement base fee',
	)
	assert.match(priceCoordinator, /if \(amount1 == 0 \|\| amount2 == 0\)/, 'coordinator must reject empty settled token amounts')
	assert.match(priceCoordinator, /uint256 price = Math\.mulDiv\(amount2, PRICE_PRECISION, amount1\)/, 'coordinator must derive the settled REP/ETH ratio from final token amounts')
	assert.match(priceCoordinator, /uint256 costAttoEth = getRequestPriceCostAttoEth\(\)/, 'coordinator must derive the request bounty from getRequestPriceCostAttoEth')
	assert.match(priceCoordinator, /uint256 settlerRewardAttoEth = costAttoEth/, 'coordinator must assign the entire request bounty to the OpenOracle settler reward')
	assert.match(priceCoordinator, /settlerReward: uint96\(settlerRewardAttoEth\)/, 'coordinator report creation must forward the full attoETH request bounty through the upstream unit-neutral settlerReward field')
	const requestBountyFormula = 'data-source="requestPriceCostAttoEth = block.basefee \\cdot 4 \\cdot (callbackGasLimit + gasConsumedOpenOracleReportPrice) + 101"'
	assert.ok(openOracleIntegration.includes(requestBountyFormula), 'OpenOracle request-cost section must retain the current full request-bounty formula')
	assert.ok(!whitepaperStatoblast.includes(requestBountyFormula), 'whitepaper must link to the canonical request-bounty formula instead of copying it')
	assert.doesNotMatch(whitepaperStatoblast, /disputers can replace a bad\s+report with a larger one/, 'whitepaper must not claim every dispute strictly increases the report after integer flooring')
}

function assertOpenOracleVendorAndEventDocs(): void {
	assert.equal(createHash('sha256').update(openOracleSource).digest('hex'), 'dd48faa19839d443ffb272458051a14507cccc89faa5cec54786902cbd348b37', 'Vendored OpenOracle source changed; compare it with the pinned SlimStorage revision and update the source fingerprint')
	for (const pinnedRevision of ['a2d8515333b41fb2fb6f1f84663180ff4ceb5c7d', 'c64a1edb67b6e3f4a15cca8909c9482ad33a02b0', 'src/OpenOracleSlim.sol', 'OpenZeppelin Contracts v5.4.0']) {
		assert.ok(openOracleProvenance.includes(pinnedRevision), `OpenOracle provenance must retain ${pinnedRevision}`)
	}
	for (const reconstructionClaim of ['topic 1 is the indexed 32-byte report ID', '`data` is exactly 235 raw packed bytes', 'set `settlementTimestamp` from the settlement block']) {
		assert.ok(eventStream.includes(reconstructionClaim), `OpenOracle event reconstruction docs must retain: ${reconstructionClaim}`)
	}
	assert.match(openOracleState, /new Uint8Array\(235\)/, 'shared OpenOracle encoder must retain the documented 235-byte packed layout')
	assert.match(openOracleState, /if \(bytes\.length !== 235\)/, 'shared OpenOracle decoder must reject non-canonical packed lengths')
	assert.doesNotMatch(whitepaperStatoblast, /sponsor posts initial report/, 'whitepaper diagrams must not identify the funding sponsor as the on-chain reporter')
	assert.match(normalizedDiagramSpecs, /coordinator reports[\s\S]*sponsor funds/, 'whitepaper oracle flow must distinguish the coordinator reporter from the funding sponsor')
	assert.doesNotMatch(openOracleIntegration, /\b(?:sponsor|caller)s?\s+(?:may\s+)?(?:voluntarily\s+)?post(?:s|ed|ing)?\b/i, 'OpenOracle integration must not describe the funding sponsor as posting the report')
	const normalizedIntegration = openOracleIntegration.replaceAll(/\s+/g, ' ')
	for (const storageClaim of ['Its state hash remains authoritative', 'materializes <code>storedGame</code> and <code>storedHelper</code> when the report is created', 'updates the live game fields after each dispute']) {
		assert.ok(normalizedIntegration.includes(storageClaim), `OpenOracle integration must document SlimStorage behavior: ${storageClaim}`)
	}
	for (const directionClaim of ['The dispute calldata does not select <code>tokenToSwap</code>', '<code>newAmount2 * oldAmount1 &gt; oldAmount2 * newAmount1</code>', 'equality and lower ratios use token1', 'The on-chain comparison remains authoritative.']) {
		assert.ok(normalizedIntegration.includes(directionClaim), `OpenOracle integration must document derived dispute direction: ${directionClaim}`)
	}
	assert.doesNotMatch(openOracleIntegration, /Only its state hash|finalized storage/, 'OpenOracle docs must not retain the superseded finalized-only storage description')
	assert.ok(normalizedIntegration.includes('The sponsor may request and fund more than the minimum; the coordinator submits the selected amount as <code>currentAmount1</code>.'), 'OpenOracle integration must distinguish sponsor funding from coordinator submission')
	assert.doesNotMatch(openOracleIntegration, /<code>openOracleReportPrice<\/code>/, 'OpenOracle integration must not name the removed openOracleReportPrice function')
	assert.doesNotMatch(invariantsHtml, /<\/a\s*>\s*>\s*and\s*<a href="\.\.\/\.\.\/solidity\/ts\/tests\/openOracleDispute\.test\.ts"/, 'oracle verification row must not render a stray greater-than marker between test links')
}

function assertLiquidationFullCloseDocs(): void {
	const normalizedLiquidation = liquidationHtml.replaceAll(/\s+/g, ' ')
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	assert.doesNotMatch(`${forkMigrationTest}\n${truthAuctionTest}`, /seiz(?:e|ed|ing)[^\n]{0,24}REP/i, 'liquidation tests must describe REP backing transfers without seizure terminology')
	assert.match(forkMigrationTest, /max liquidation should transfer vault REP backing to the liquidator/, 'liquidation tests must preserve canonical REP backing transfer terminology')
	assert.match(truthAuctionTest, /liquidation should transfer migrated vault REP backing into the liquidator vault/, 'truth-auction liquidation tests must preserve canonical REP backing transfer terminology')
	assert.match(priceCoordinator, /function executeStagedOperation\(/)
	assert.match(priceCoordinator, /currentTargetBackingUnits != stagedOperation\.snapshotTargetBackingUnits[\s\S]*currentTargetCoverageCommitmentAttoEth != stagedOperation\.snapshotTargetCoverageCommitmentAttoEth/)
	assert.match(normalizedInvariants, /Execution rejects changed target REP backing units or coverage commitment/)
	assert.match(normalizedInvariants, /OpenOraclePriceCoordinator\.sol"\s*><code>executeStagedOperation<\/code>/)
	assert.match(normalizedInvariants, /cannot receive the newly assigned REP backing under the stale quote/)
	assert.match(normalizedInvariants, /Queued Execution/)

	for (const documentedClaim of [
		'data-source="grossRepAwardAttoRep = ⌈coverageCommitmentTransferredAttoEth * repPerEthPrice * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS) / (PRICE_PRECISION * BPS_DENOMINATOR)⌉"',
		'data-source="maximumFundedCoverageCommitmentAttoEth = ⌊transferableVaultRepBackingAttoRep * PRICE_PRECISION * BPS_DENOMINATOR / (repPerEthPrice * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS))⌋"',
		'data-source="associatedRepAttoRep * pricePrecision * BPS_DENOMINATOR >= coverageCommitmentAttoEth * poolSecurityMultiplierBps * repPerEthPrice"',
		'data-source="coverageCommitmentAttoEth = 0 or poolHeldVaultRepBackingAttoRep * pricePrecision * BPS_DENOMINATOR > coverageCommitmentAttoEth * migrationSecurityMultiplierBps * repPerEthPrice"',
		'A liquidator cannot cherry-pick escalation claims because it cannot acquire any of them.',
		'The 105% quote is paid from pool-held vault REP backing',
		'A donation that does not cross either live health boundary cannot stop execution; even a small donation can stop it when the target is sufficiently close to a boundary.',
	]) {
		assert.ok(normalizedLiquidation.includes(documentedClaim), `Missing bundled-liquidation documentation claim: ${documentedClaim}`)
	}
	for (const marker of ['id="bundled-liquidation"', 'id="game-theory"', 'id="fig-liquidation-punitive-flow"']) {
		assert.ok(liquidationHtml.includes(marker), `Missing liquidation documentation marker: ${marker}`)
	}

	assert.match(whitepaperStatoblast, /href="\.\.\/explanation\/liquidations\.html"/, 'whitepaper should route liquidation math and examples to the canonical design')
	assert.doesNotMatch(whitepaperStatoblast, /id="eq-statoblast-liquidation-transfer"/, 'whitepaper must not duplicate the canonical liquidation equation')
	assert.match(
		diagramSpecs,
		/"fig-liquidation-punitive-flow"[\s\S]*complete 5%-bonus pool-held vault REP backing award[\s\S]*maximum request records untransferred residual coverage commitment as bad debt/i,
		'canonical liquidation diagram must show the fully funded pool-held vault REP backing award, claim and fee isolation, and the residual backstop',
	)
	assert.match(liquidationHtml, /Funded coverage commitment and its complete pool-held vault REP backing award move; claims, fees, and surplus stay, while a maximum request records untransferred residual coverage commitment as bad debt/)
	assert.match(liquidationHtml, /Accrued ETH fees, escalation claims, and pool-held vault REP backing surplus are always inaccessible\. The backstop never mints REP backing units or socializes the missing bonus/)
	assert.match(eventStream, /Escalation continuation\t`ForkCarryCheckpoint`, `ForkContinuationResumed`, `InheritedThresholdTie`, `CarryDepositConsumed`/)
	assert.doesNotMatch(eventStream, /PayoutClaimCheckpointImported|EscalationClaimMoved/)
	assert.match(
		operatorReference,
		/calculateBundledLiquidationTransfer\(targetBackingUnits, targetCoverageCommitmentAttoEth, requestedCommitmentTransferAttoEth, repEthPrice, currentPoolHeldRepBalanceAttoRep, currentTotalRepBackingUnits\)/,
		'operator reference must preserve the current liquidation utility signature and parameter order',
	)
	assert.doesNotMatch(whitepaperStatoblast, /id="fig-statoblast-auction-clearing"/, 'whitepaper must delegate auction clearing to the canonical focused diagram')
	assert.match(whitepaperStatoblast, /truth-auctions\.html#clearing/)
}

function assertLifecycleReferences(): void {
	assert.match(escalationGameState, /activationDelay = 3 days/)
	assert.match(escalationGameTypes, /ESCALATION_TIME_LENGTH = 4233600; \/\/ 7 weeks/)
	assert.match(securityPoolUtils, /MIGRATION_TIME = 8 weeks/)
	for (const systemState of ['Operational', 'PoolForked', 'ForkMigration', 'ForkTruthAuction']) {
		assert.match(securityPoolInterface, new RegExp(`\\b${systemState}\\b`))
	}
	assert.match(startHere, /statoblast\.html/)
	assert.match(startHere, /merkle-mountain-range\.html/)
	assert.match(whitepaperStatoblast, /<td><code>ForkTruthAuction<\/code><\/td>[\s\S]{0,220}decision and finalization phase[\s\S]{0,180}sells REP when repair is needed or finalizes immediately without a sale/)
	for (const transition of ['Operational->PoolForked', 'PoolForked->ForkMigration', 'ForkMigration->ForkTruthAuction', 'ForkTruthAuction->Operational']) {
		assert.match(diagramSpecs, new RegExp(`"data-transition": "${transition}"`), `Statoblast lifecycle must include ${transition}`)
	}
	for (const [state, role] of [
		['Operational', 'parent'],
		['PoolForked', 'parent'],
		['ForkMigration', 'child'],
		['ForkTruthAuction', 'child'],
		['Operational', 'child'],
	]) {
		assert.match(diagramSpecs, new RegExp(`"data-state": "${state}",\\s+"data-pool-role": "${role}"`), `Statoblast lifecycle must label ${role} ${state}`)
	}
	assert.match(diagramSpecs, /"data-transition": "PoolForked->ForkMigration",\s+"data-boundary": "parent-to-child"/)
	assert.doesNotMatch(diagramSpecs, /"data-transition": "ForkMigration->Operational"/)
}

function assertOperationalGuideSemantics(): void {
	assert.match(forkMigrationGuide, /fork activation automatically materialized the parent's deterministic pool migration proxy[\s\S]*Create a missing Statoblast child pool[\s\S]*pool-local eight-week migration window/)
	assert.doesNotMatch(forkMigrationGuide, /Create a missing Statoblast child pool or pool migration proxy/)
	assert.match(forkMigrationGuide, /Zoltar child universe or split raw Zoltar migration REP[\s\S]*No Statoblast eight-week pool deadline/)
	assert.match(invariantsHtml, /FORK-05[\s\S]*pool-local boundary does not limit <code>Zoltar\.deployChild<\/code>, <code>addRepToMigrationBalance<\/code>, or <code>splitMigrationRep<\/code>/)
	assert.match(securityPoolForkerVaultMigrationBase, /forkActivationTime \+ SecurityPoolUtils\.MIGRATION_TIME/)
	for (const zoltarOperation of ['deployChild', 'addRepToMigrationBalance', 'splitMigrationRep']) {
		assert.match(zoltar, new RegExp(`function ${zoltarOperation}\\b`), `Zoltar must define ${zoltarOperation}`)
	}

	assert.match(truthAuctionGuide, /finalize and activate/i)
	assert.match(truthAuctionGuide, /does not settle individual bids, credit bidder vaults, or deliver their refunds/)
	assert.match(truthAuctionGuide, /settleAuctionBids[\s\S]*claimAuctionProceeds[\s\S]*pendingEthRefundsAttoEth[\s\S]*withdrawPendingEthRefund/)
	assert.match(truthAuctionGuide, /conditionally applies a haircut when purchased REP removes a positive escalation allocation[\s\S]*resumption attempt reverts finalization[\s\S]*reconcile backing and retry/)
	assert.match(securityPoolForker, /function _startTruthAuctionOrFinalize\([\s\S]*_finalizeTruthAuction\(securityPool\);[\s\S]*data\.truthAuction\.startAuction/)
	assert.match(securityPoolForker, /function _finalizeTruthAuction\([\s\S]*TruthAuctionFinalized/)
	assert.match(normalizedDiagramSpecs, /Start transition[\s\S]*startTruthAuction[\s\S]*Operational[\s\S]*immediate finalization[\s\S]*Bid[\s\S]*AuctionStarted[\s\S]*Finalize[\s\S]*clearing → operational[\s\S]*Settle bids[\s\S]*claims and refunds/)
	assert.match(diagramSpecs, /"d": "M 380 140 H 410 V 65 H 440"/)
	assert.match(diagramSpecs, /"d": "M 380 140 H 410 V 215 H 440"/)
	assert.match(auctionDesign, /TruthAuctionFinalized activates the child immediately and bypasses AuctionStarted, bidding, and bid settlement/)
	assert.match(auctionDesign, /If all required REP migrated or no repair ETH is required[\s\S]*activates the child immediately without <code>AuctionStarted<\/code>[\s\S]*Otherwise[\s\S]*<code>AuctionStarted<\/code>[\s\S]*one-week bidding window/)
	assert.doesNotMatch(auctionDesign, /forker then starts the underlying auction/)
	assert.equal(auctionDesign.match(/forkResumedAt \+ 3 days/g)?.length ?? 0, 1, 'truth-auction explanation must state the canonical post-resume deadline once')

	assert.match(
		escalationGuide,
		/configured <code>SecurityPoolForker<\/code> applies a haircut only when purchased REP removes a positive escalation allocation[\s\S]*Incomplete aggregate backing reverts the entire finalization[\s\S]*retry finalization[\s\S]*already operational but still has its awaiting-continuation flag/,
	)
	assert.match(escalationGameDepositDelegate, /function applyTruthAuctionHaircut\([\s\S]*require\(msg\.sender == IEscalationGameSecurityPoolContext\(poolAddress\)\.securityPoolForker\(\), 'Only forker'\)/)
	assert.match(securityPoolForker, /if \(disputeStakedRepBeforeAttoRep == 0 \|\| repPurchasedAttoRep == 0\) return 0;[\s\S]*if \(disputeStakedRepSoldAttoRep == 0\) return 0;[\s\S]*applyTruthAuctionHaircut/)
	assert.match(securityPoolForker, /_applyEscalationTruthAuctionHaircut\([\s\S]*_finalizeEscalationStateAfterAuction\(/)
	assert.match(securityPoolForkerBase, /function _finalizeEscalationStateAfterAuction\([\s\S]*_finalizeAwaitingForkContinuationIfReady\(child, childEscalationGame\)/)
	assert.match(securityPoolLiquidationDelegate, /function resumeForkedEscalationGame\(\) external \{[\s\S]*escalationGame\.resumeFromFork\(\);[\s\S]*awaitingForkContinuation = false/)
	assert.match(escalationGameDepositDelegate, /function resumeFromFork\(\) external \{[\s\S]*require\(game\.isForkCarryFundingComplete\(\), 'Fork carry underfunded'\)/)

	assert.match(oracleRecoveryGuide, /deactivates that operation, removes it from the active and pending collections[\s\S]*advances the slot[\s\S]*Other queued operations remain active/)
	assert.match(priceCoordinator, /function _consumeRecoveredPendingOperation\(\) private \{[\s\S]*_consumeStagedOperation\(operationId\)[\s\S]*PendingOperationRecoveryConsumed/)

	assert.match(liquidationGuide, /liquidator does not supply REP or ETH liquidation principal[\s\S]*complete bonus-bearing award comes from the target's pool-held vault REP backing/)
	assert.match(liquidationGuide, /cached REP\/ETH price is fresh[\s\S]*executes immediately and no report is created[\s\S]*price is stale[\s\S]*sponsors the OpenOracle bounty and initial position/)
	assert.match(liquidationGuide, /maximum request recorded only the untransferred residual as bad debt/)
	assert.match(securityPoolLiquidationDelegate, /uint256 targetVaultRepBackingAttoRep = pool\.backingUnitsToAttoRep\(snapshotTargetBackingUnits\)[\s\S]*calculateBundledLiquidationTransfer[\s\S]*badDebtAttoEth = snapshotTargetCoverageCommitmentAttoEth - coverageCommitmentToTransferAttoEth/)
}

function assertContractInteractionDistinctions(): void {
	const activateForkModeRow = getContractInteractionRow('activateForkMode()')
	const initiateSecurityPoolForkRow = getContractInteractionRow('initiateSecurityPoolFork(securityPool)')
	const ownEscalationForkRow = getContractInteractionRow('forkZoltarWithOwnEscalationGame(securityPool)')
	const escalationDepositRow = getContractInteractionRow('depositToEscalationGame(outcome, maxAmount)')
	const migrateSharesRow = getContractInteractionRow('migrate(fromId, targetOutcomeIndexes)')
	const drainAllRepRow = getContractInteractionRow('drainAllRep(receiver)')
	const createChildUniverseRow = getContractInteractionRow('createChildUniverse(securityPool, outcomeIndex)')
	const migrateVaultRow = getContractInteractionRow('migrateVault(securityPool, outcomeIndex)')
	const migrateVaultWithUnresolvedEscalationRow = getContractInteractionRow('migrateVaultWithUnresolvedEscalation(securityPool, vault, childOutcomeIndex)')
	const claimForkedEscalationDepositsRow = getContractInteractionRow('claimForkedEscalationDeposits(...)')
	const performLiquidationRow = getContractInteractionRow('performLiquidation(...)')
	const claimDepositWithoutTransferRow = getContractInteractionRow('claimDepositForWinningWithoutTransfer(depositIndex, outcome)')
	const recordForkedEscrowRow = getContractInteractionRow('recordForkedEscrowForOutcome(depositor, outcome, sourcePrincipalAttoRep, childRepAmountAttoRep)')
	const startTruthAuctionRow = getContractInteractionRow('startTruthAuction(securityPool)')
	const finalizeTruthAuctionRow = getContractInteractionRow('finalizeTruthAuction(securityPool)')
	assert.match(contractReferenceGenerator, /interaction\.declarations\.length, 1,[\s\S]*interaction rows must describe exactly one entrypoint name; split materially different guards, effects, and signals into separate rows/, 'generated interaction rows must remain limited to one entrypoint name')
	assert.match(invariantsHtml, /<code>SHARE-04<\/code>[\s\S]*remaining economic claim[\s\S]*source entitlements/)
	assert.match(invariantsHtml, /id="fork-10"[\s\S]*<code>FORK-10<\/code>[\s\S]*mints only the unmaterialized balance/)
	assert.match(invariantsHtml, /id="fork-11"[\s\S]*<code>FORK-11<\/code>[\s\S]*fork-time economic claim supply[\s\S]*Unequal ERC-1155 supplies[\s\S]*do not block complete-set minting[\s\S]*href="#share-04"><code>SHARE-04<\/code>/)
	assert.match(operatorReference, /invariants\.html#fork-10[\s\S]*invariants\.html#share-04[\s\S]*invariants\.html#fork-11/)
	assert.match(whitepaperStatoblast, /none of the selected children has received[\s\S]*On a later call, each child receives only[\s\S]*current source balance - amount already materialized[\s\S]*every selected delta is zero, the call reverts/)
	assert.match(whitepaperStatoblast, /invariants\.html#fork-10[\s\S]*invariants\.html#share-04[\s\S]*invariants\.html#fork-11/)
	assert.match(invariantsHtml, /FORK-05[\s\S]*forkActivationTime \+ 8 weeks[\s\S]*parent pool enters <code>PoolForked<\/code>[\s\S]*Share materialization has no expiry[\s\S]*already-created child/)
	assert.doesNotMatch(invariantsHtml, /Child creation, share migration, vault migration/)
	assert.doesNotMatch(invariantsHtml, /forkTime \+ 8 weeks/)
	assert.match(auctionDesign, /forkActivationTime \+ SecurityPoolUtils\.MIGRATION_TIME[\s\S]*pool-local[\s\S]*universe <code>forkTime<\/code>[\s\S]*invariants\.html#fork-05/)
	assert.doesNotMatch(auctionDesign, /8 weeks from the parent\s+universe fork time/)
	assert.match(whitepaperStatoblast, /source remains locked as an entitlement/)
	assert.doesNotMatch(whitepaperStatoblast, /Parent burned/)
	assert.match(eventStream, /ShareTokenSupplySet[\s\S]*source entitlements whose child ERC-1155 balances have not materialized yet[\s\S]*Migrate[\s\S]*do not change this denominator/)
	assert.match(eventStream, /On every `startTruthAuction`, initialize the child's remaining economic claim supply from `ShareTokenSupplySet`[\s\S]*immediate no-auction path/)
	assert.match(contractInteractionReference, /single-target call may lazily create that child/)
	assert.match(contractInteractionReference, /every target in a multi-target call already has a canonical child pool/)
	assert.match(contractInteractionReference, /startTruthAuction\(securityPool\)[\s\S]*frozen parent's remaining economic claim supply[\s\S]*ShareTokenSupplySet/)
	assert.match(contractInteractionReference, /getForkThresholdAttoRep`, `getNonDecisionThresholdAttoRep`, `getUniverseTheoreticalSupplyAttoRep`/)
	assert.match(contractInteractionReference, /getQuestionResolution`, `getFinalQuestionResolution`/)
	assert.match(contractInteractionReference, /`fixedQuestionOutcome`/)
	assert.doesNotMatch(contractInteractionReference, /getCurrentCost/)
	assert.match(contractInteractionReference, /computeIterativeAttritionCostAttoRep`, `computeTimeSinceStartFromAttritionCostAttoRep`, `totalCostAttoRep`/)
	assert.match(contractInteractionReference, /ZoltarQuestionData[\s\S]*createQuestion\(questionData, outcomeOptions\)/)
	assert.match(contractInteractionReference, /ReputationToken[\s\S]*setMaxTheoreticalSupplyAttoRep[\s\S]*mint\(account, valueAttoRep\)[\s\S]*burn\(account, valueAttoRep\)/)
	assert.match(contractInteractionReference, /SecurityPoolFactory[\s\S]*deployOriginSecurityPool[\s\S]*statoblastSecurityMultiplierBps > 10_001[\s\S]*initialReportPriorityFeeAttoEthPerGas > 0[\s\S]*labels `Yes`, then `No`/)
	assert.match(contractInteractionReference, /securityPoolDeploymentsRange\(startIndex, count\)[\s\S]*reverts rather than truncating/)
	assert.match(contractInteractionReference, /burnEscalationWinnerHaircut\(amountAttoRep\)[\s\S]*configured escalation game/)
	assert.match(contractInteractionReference, /getPoolAccountingSnapshot`, `getVaultFeeRemainder`/)
	assert.match(contractInteractionReference, /securityPoolEventEmitter`, `getVaultCount`/)
	assert.match(contractInteractionReference, /getMigratedRepAttoRep`, `getForkActivationTime`/)
	assert.match(contractInteractionReference, /previewDepositOnOutcome`, `computeIterativeAttritionCostAttoRep`/)
	assert.match(operatorReference, /factory has no owner role and no later `resumeFromFork` relay/)
	assert.match(securityPoolFactory, /_initialEscalationGameDepositAttoRep >= 1e18[\s\S]*zoltar\.getNonDecisionThresholdAttoRep\(universeId\) > initialEscalationGameDepositAttoRep/)
	assert.match(securityPoolFactory, /initialEscalationGameDepositAttoRep = _initialEscalationGameDepositAttoRep/)
	assert.match(securityPool, /initialEscalationGameDepositAttoRep = _initialEscalationGameDepositAttoRep/)
	assert.match(securityPool, /deployEscalationGame\(\s*initialEscalationGameDepositAttoRep,\s*zoltar\.getNonDecisionThresholdAttoRep\(universeId\)\s*\)/)
	assert.match(escalationGameFactory, /_nonDecisionThresholdAttoRep > 1[\s\S]*startBondAttoRep >= _nonDecisionThresholdAttoRep[\s\S]*startBondAttoRep = _nonDecisionThresholdAttoRep - 1/)
	assert.match(
		whitepaperStatoblast.replaceAll(/\s+/g, ' '),
		/<code>SecurityPoolFactory<\/code> requires its configured <code>initialEscalationGameDepositAttoRep<\/code> to be at least <code>1 REP<\/code>, copies that value into every deployed <code>SecurityPool<\/code>[\s\S]*<code>SecurityPool<\/code> passes its stored bond and the current threshold to <code>EscalationGameFactory<\/code>/,
	)
	assert.match(contractInteractionReference, /On the first deposit, the live non-decision threshold must exceed one attoREP/)
	assert.match(contractInteractionReference, /Repeat deposits use the existing game's stored `startBondAttoRep` and `nonDecisionThresholdAttoRep`/)
	assert.match(contractInteractionReference, /tracked REP supply later makes it too large[\s\S]*nonDecisionThresholdAttoRep - 1/)
	assert.doesNotMatch(contractInteractionReference, /Factory owner|EscalationGameFactory` owner/)
	assert.match(contractInteractionReference, /withdrawDeposit\(uint256 depositIndex, outcome\)[\s\S]*Owning `SecurityPool` only/)
	assert.match(contractInteractionReference, /withdrawDeposit\(CarriedDepositProof proof, outcome\)[\s\S]*Owning `SecurityPool` or its `SecurityPoolForker`/)
	assert.match(contractInteractionReference, /child-pool truth auction trusted by this forker during `ChildPoolLinked`/)
	assert.match(contractInteractionReference, /`trustedAuctionAddresses\[msg\.sender\]` was set when the forker linked the child and emitted `ChildPoolLinked`; configured-factory registration determines whether that lineage is canonical/)
	assert.match(contractInteractionReference, /Accepts auction ETH during forker-controlled auction finalization/)
	assert.doesNotMatch(contractInteractionReference, /Accepts auction ETH during forker-controlled finalization and settlement/)
	assert.match(contractInteractionReference, /auction `AuctionFinalized` is followed by forker `TruthAuctionFinalized` and pool accounting checkpoints/)
	assert.match(operatorReference, /Caller and trust boundaries[\s\S]*SecurityPoolEventEmitter[\s\S]*recognized pool or forker address/)
	assert.match(
		operatorReference,
		/EscalationGameDepositDelegate`, `EscalationGameClaimDelegate`, `EscalationGameForker`, `SecurityPoolForkerVaultMigrationDelegate`, and `SecurityPoolLiquidationDelegate`[\s\S]*no ownership or import surface[\s\S]*pool-held vault REP backing-only liquidation[\s\S]*fee and claim isolation/,
	)
	assert.match(operatorReference, /Migration, liquidation, and storage modules[\s\S]*`SecurityPoolLiquidationDelegate\.sol`[\s\S]*`EscalationGameForker\.sol` \(\.\.\/\.\.\/solidity\/contracts\/peripherals\/EscalationGameForker\.sol\)/)
	assert.match(deploymentStatus, /DeploymentAddressesSet\(address\[\] deploymentAddresses\)/)
	assert.match(escalationGame, /function startFromFork\([\s\S]*?forkContinuation = true;[\s\S]*?forkElapsedAtStart = elapsedAtFork;[\s\S]*?emit GameContinuedFromFork/)
	assert.match(contractInteractionReference, /startFromFork\(startBondAttoRep, nonDecisionThresholdAttoRep, elapsedAtFork, fixedQuestionOutcome, winnerHaircutPaidByFork, forkCarryInitialBackingAttoRep\)[\s\S]*does not start the remaining clock until `resumeFromFork`/)
	assert.match(escalationGame, /function resumeFromFork\(\) external \{[\s\S]*EscalationGameDepositDelegate\.resumeFromFork/)
	assert.match(escalationGameDepositDelegate, /function resumeFromFork\(\) external \{[\s\S]*?require\(forkResumedAt == 0, 'Fork resumed'\);[\s\S]*?forkResumedAt = block\.timestamp;[\s\S]*?emit ForkContinuationResumed/)
	assert.match(escalationGameDepositDelegate, /require\(game\.isForkCarryFundingComplete\(\), 'Fork carry underfunded'\)/)
	assert.match(contractInteractionReference, /resumeFromFork\(\)[\s\S]*After that deadline, `getFinalQuestionResolution` returns the fixed outcome/)
	assert.match(escalationGameCarry, /function initializeForkCarrySnapshotWithResolutionBalances\([\s\S]*?\) external \{\s*_initializeForkCarrySnapshot\(/)
	assert.match(escalationGameCarry, /function _initializeForkCarrySnapshot\([\s\S]*?require\(msg\.sender == address\(securityPool\), 'Only pool'\);\s*require\(forkContinuation, 'No fork mode'\);\s*require\(!forkCarrySnapshotInitialized\(\), 'Snapshot initialized'\)/)
	assert.match(contractInteractionReference, /initializeForkCarrySnapshotWithResolutionBalances\(\.\.\.\)[\s\S]*no prior snapshot[\s\S]*Installs the immutable inherited peaks, leaf counts, carry totals, resolution balances, and normalized nullifier roots/)
	assert.match(contractInteractionReference, /Transfers the caller's REP backing units and coverage commitment into one child pool/)
	assert.match(contractInteractionReference, /optional unresolved parent escalation-deposit accounting cleanup wrapper calls this function first to migrate transferable vault state/)
	assert.match(contractInteractionReference, /migrateVaultWithUnresolvedEscalation[\s\S]*First runs ordinary migration for the same vault[\s\S]*cleanup neither funds dispute-staked REP backing nor authorizes carried proofs/)
	assert.match(contractInteractionReference, /external fork interrupted the game[\s\S]*winners settle in the child by carried proof[\s\S]*unresolved parent escalation-deposit accounting cleanup is optional/)
	assert.doesNotMatch(contractInteractionReference, /external-fork timing may require migration instead/)
	assert.match(securityPool, /function withdrawForkedEscalationDeposits\([\s\S]*for \(uint256 index = 0; index < proofs\.length; index\+\+\)[\s\S]*_syncActiveVault\(beneficiaryVault\)/)
	assert.match(securityPool, /function withdrawFromEscalationGame\([\s\S]*for \(uint256 index = 0; index < depositIndexes\.length; index\+\+\)[\s\S]*_syncActiveVault\(beneficiaryVault\)/)
	assert.match(contractInteractionReference, /withdrawFromEscalationGame\(outcome, depositIndexes\)[\s\S]*An empty list returns after the outer lifecycle checks without settlement, state change, or event[\s\S]*No event for an empty list/)
	assert.match(contractInteractionReference, /withdrawForkedEscalationDeposits\(outcome, proofs\)[\s\S]*An empty list returns after the outer lifecycle checks without proof verification, state change, or event[\s\S]*No event for an empty list/)
	assert.match(contractInteractionReference, /Before finalization, refunds only provably losing bids/)
	assert.match(contractInteractionReference, /Auction owner \(`SecurityPoolForker`\) only; public callers use `settleAuctionBids`/)
	assert.match(contractInteractionReference, /Only a positive migration amount with at least one selected outcome checks the eight-week window, existing child `ForkMigration` state/)
	assert.match(contractInteractionReference, /child pool is not already deployed/)
	assert.match(contractInteractionReference, /selected child can be created or loaded, remains in `ForkMigration`, has a continuation game that passes the child-game trust boundary \(#child-game-trust-boundary\), and is inside the eight-week claim window/)
	assert.match(contractInteractionReference, /rejected settlement clears pending-report state but leaves staged operations queued for a later valid price path/)
	assert.match(contractInteractionReference, /setSecurityPool\(pool\)[\s\S]*Anyone while `securityPool` remains zero[\s\S]*zero value emits and checkpoints zero but leaves the setter callable/)
	assert.match(contractInteractionReference, /setRepEthPrice\(price\)[\s\S]*Configured nonzero `SecurityPool` only/)
	assert.match(openOracleIntegration, /setSecurityPool<\/code> once with that nonzero pool/)
	assert.match(openOracleIntegration, /BPS_DENOMINATOR = 10_000[\s\S]*id="eq-openoracle-binary-threshold"/, 'OpenOracle integration must define BPS_DENOMINATOR before its first named-denominator formula')
	assert.match(contractInteractionReference, /While a report is pending, only that report sponsor may stage more operations/)
	assert.match(contractInteractionReference, /required only when this call opens a new report/)
	assert.match(contractInteractionReference, /Genesis REP requires allowance; child REP is burned directly without allowance/)
	assert.match(
		securityPool,
		/function isEscalationResolved\(\) public view returns \(bool\) \{\s*if \(address\(escalationGame\) == address\(0x0\)\) return false;\s*return\s+ISecurityPoolForker\(securityPoolForker\)\.getQuestionOutcome\(ISecurityPool\(payable\(address\(this\)\)\)\) !=\s+BinaryOutcomes\.BinaryOutcome\.None/,
	)
	assert.match(securityPoolForker, /if \(data\.fixedQuestionOutcomePlusOne > 0\)\s*return BinaryOutcomes\.BinaryOutcome\(data\.fixedQuestionOutcomePlusOne - 1\)/)
	assert.match(contractInteractionReference, /`isEscalationResolved\(\)` is true only when a local escalation game is configured and the forker routes a non-`None` outcome; an operational fixed-outcome child without a local game returns false/)
	assert.match(contractInteractionReference, /createCompleteSet\(\)[\s\S]*Operational and unforked; `isEscalationResolved\(\)` is false; not awaiting continuation/)
	assert.match(contractInteractionReference, /requestPriceIfNeededAndStageOperation\(\.\.\.\)[\s\S]*`securityPool\.isEscalationResolved\(\)` is false/)
	assert.match(contractInteractionReference, /requestPriceIfNeededAndStageOperation\(\.\.\.\)[\s\S]*`StagedOperationQueued` immediately followed by `StagedOperationDisputeStakedRepSnapshotted`/)
	assert.doesNotMatch(contractInteractionReference, /Operational, unforked, unresolved|unresolved local escalation|Unresolved pool;/)
	assert.match(contractInteractionReference, /positive ETH converts to at least one complete-set unit/)
	assert.match(
		securityPool,
		/function createCompleteSet\(\) external payable isOperational \{[\s\S]*uint256 nextSettlementCollateralAttoEth = settlementCollateralAttoEth \+ msg\.value;[\s\S]*_requireCapacityNotExceeded\(feeEligibleCoverageCommitmentAttoEth, nextSettlementCollateralAttoEth\);/,
		'Complete-set issuance must compare resulting total collateral against fee-eligible coverage commitment',
	)
	assert.match(contractInteractionReference, /createCompleteSet\(\)[\s\S]*vault-assigned, fee-eligible coverage commitment covers the resulting settlement collateral, not merely this deposit/, 'Generated complete-set prerequisites must identify the fee-eligible coverage commitment and resulting-total-collateral guard')
	assert.match(contractInteractionReference, /redeemCompleteSet\(amountAttoShares\)[\s\S]*caller accepts the resulting ETH call, including zero value[\s\S]*rejection of that ETH call reverts the transaction/)
	assert.match(securityPool, /function attoSharesToAttoEth\(uint256 amountAttoShares\)[\s\S]*return \(amountAttoShares \* settlementCollateralAttoEth\) \/ shareTokenSupplyAttoShares/)
	assert.match(securityPool, /function redeemCompleteSet\(uint256 amountAttoShares\)[\s\S]*uint256 settlementCollateralRedeemedAttoEth = attoSharesToAttoEth\(amountAttoShares\)/)
	assert.match(securityPool, /function redeemShares\(\)[\s\S]*settlementCollateralAttoEth\) \/ shareTokenSupplyAttoShares[\s\S]*shareTokenSupplyAttoShares -= winningSharesBurnedAttoShares/)
	assert.match(securityPoolForker, /securityPool\.setTotalSharesAttoShares\(parent\.shareTokenSupplyAttoShares\(\)\)/)
	assert.match(contractInteractionReference, /redeemCompleteSet\(amountAttoShares\)[\s\S]*amountAttoShares \* settlementCollateralAttoEth \/ shareTokenSupplyAttoShares[\s\S]*remaining economic claim supply[\s\S]*source entitlements materialize without changing it/)
	assert.doesNotMatch(contractInteractionReference, /redeemCompleteSet\(amountAttoShares\)[\s\S]*largest live outcome supply/)
	assert.match(whitepaperStatoblast, /child uses its remaining economic claim supply as\s*the denominator[\s\S]*fork-time claims whose ERC-1155 balances\s*have not materialized there yet/)
	assert.doesNotMatch(whitepaperStatoblast, /payout uses\s*the maximum outcome supply as its denominator/)
	assert.match(contractInteractionReference, /redeemShares\(\)[\s\S]*caller accepts the resulting ETH call, including zero value[\s\S]*rejection of that ETH call reverts the transaction/)
	assert.match(contractInteractionReference, /redeemFees\(vault\)[\s\S]*If resulting claimable fees are zero, returns without payment[\s\S]*no event when fees and accrual state are unchanged/)
	assert.match(contractInteractionReference, /withdrawRepFromVault\(vault, repAmountAttoRep\)[\s\S]*operational pool in an unforked universe[\s\S]*`isEscalationResolved\(\)` is false/)
	assert.match(whitepaperStatoblast, /attoEthToAttoShares[\s\S]*Exchange rate undefined/)
	for (const flow of ['pool-to-share-token-mint', 'pool-to-share-token-burn', 'trader-to-pool-redemption', 'pool-to-trader-eth-payout']) {
		assert.match(diagramSpecs, new RegExp(`"data-flow": "${flow}"`), `Statoblast asset flow must include ${flow}`)
	}
	assert.doesNotMatch(diagramSpecs, /"data-flow": "share-token-to-trader-redemption"/)
	assert.match(normalizedDiagramSpecs, /"fig-statoblast-actor-swimlanes"[\s\S]*Vault owner[\s\S]*"fig-statoblast-asset-flow"/, 'Statoblast actor swimlane must name the controlling actor as the vault owner')
	assert.match(normalizedDiagramSpecs, /"fig-statoblast-asset-flow"[\s\S]*Vault owners send REP[\s\S]*Vault owner[\s\S]*deposits REP/, 'Statoblast asset flow must attribute REP deposits and fees to vault owners')
	assert.match(whitepaperStatoblast, /Vault owners send REP and receive fees/, 'Statoblast asset-flow fallback must identify vault owners as the actors')
	assert.match(chartRuntime, /Vault owners send REP/, 'generated chart runtime must retain the vault-owner asset-flow description')
	assert.match(chartRuntime, /Vault owner/, 'generated chart runtime must retain visible vault-owner diagram labels')
	assert.match(whitepaperStatoblast, /vault owners fund security vaults with REP backing/i, 'Statoblast overview must distinguish vault-owner actors from security-vault containers')
	assert.match(contractArchitecture, /Vault owners and liquidators stage withdrawals/, 'contract architecture must name vault owners as coordinator callers')
	assert.match(normalizedDiagramSpecs, /Security vaults \+ ETH shares/, 'whole-system diagram must label the accounting containers as security vaults')
	assert.match(chartRuntime, /Security vaults \+ ETH shares/, 'generated chart runtime must retain the security-vault system label')
	for (const representation of [whitepaperStatoblast, contractArchitecture, diagramSpecs, chartRuntime]) assert.doesNotMatch(representation, ambiguousVaultActorAlias, 'documentation must not use vault containers as actors')
	assert.match(liquidationHtml, /data-source="associatedRepAttoRep \* pricePrecision \* BPS_DENOMINATOR >= coverageCommitmentAttoEth \* poolSecurityMultiplierBps \* repPerEthPrice"/)
	assert.match(liquidationHtml, /data-source="coverageCommitmentAttoEth = 0 or poolHeldVaultRepBackingAttoRep \* pricePrecision \* BPS_DENOMINATOR > coverageCommitmentAttoEth \* migrationSecurityMultiplierBps \* repPerEthPrice"/)
	assert.match(whitepaperStatoblast.replaceAll(/\s+/g, ' '), /<a href="\.\.\/explanation\/liquidations\.html#rule">liquidation design owns the exact integer equations<\/a>[\s\S]*equality passes ordinary coverage admission but is unsafe for migration coverage/)
	assert.match(
		liquidationHtml,
		/reservedBackingUnits = ⌈MIN_REP_DEPOSIT_ATTO_REP × totalRepBackingUnits \/ totalRepAttoRep⌉[\s\S]*reserve is at least the target backing units, no partial coverage commitment or REP transfer is fundable[\s\S]*transferableVaultRepBackingAttoRep = ⌊\(targetBackingUnits - reservedBackingUnits\) × totalRepAttoRep \/ totalRepBackingUnits⌋[\s\S]*maximum request[\s\S]*requestedCommitmentTransferAttoEth >= targetCoverageCommitmentAttoEth[\s\S]*transferableVaultRepBackingAttoRep = ⌊targetBackingUnits × totalRepAttoRep \/ totalRepBackingUnits⌋[\s\S]*user queues that amount through the coordinator[\s\S]*pool's maximum-request path/,
	)
	assert.match(securityPoolUtils, /if \(reservedBackingUnits >= targetBackingUnits\) return \(0, 0, 0\);/)
	assert.match(securityPoolUtils, /bool resolveResidualAsBadDebt = requestedCommitmentTransferAttoEth >= targetCoverageCommitmentAttoEth;/)
	assert.match(protocolTerms, /MIN_REP_DEPOSIT_ATTO_REP: 'The 10 REP minimum pool-held vault REP backing position for a security vault that retains a positive coverage commitment after a partial liquidation\. A maximum liquidation may clear the coverage commitment without preserving this floor\.'/)
	assert.match(protocolTerms, /MIN_COVERAGE_COMMITMENT_ATTO_ETH: 'The 1 ETH minimum active coverage commitment for a vault\. Bad-debt audit totals may record smaller amounts\.'/)
	assert.match(liquidationHtml, /positive funded slice would leave the caller's resulting coverage commitment below <code>MIN_COVERAGE_COMMITMENT_ATTO_ETH<\/code>[\s\S]*transfers no coverage commitment, REP, or REP backing units[\s\S]*no <code>VaultLiquidated<\/code> or post-transfer caller checkpoint/)
	assert.match(securityPoolLiquidationDelegate, /securityVaults\[callerVault\]\.coverageCommitmentAttoEth \+ coverageCommitmentToTransferAttoEth <\s+SecurityPoolUtils\.MIN_COVERAGE_COMMITMENT_ATTO_ETH[\s\S]*coverageCommitmentToTransferAttoEth = 0;\s*vaultRepBackingToTransferAttoRep = 0;\s*backingUnitsToTransfer = 0;/)
	assert.match(securityModel, /effective pool-held vault REP backing\s+multiplier at least the 10,500-BPS liquidation-award reserve/)
	assert.doesNotMatch(securityModel, /pool multiplier strictly above the migration multiplier/)
	for (const representation of [operatorReference, contractInteractionReference, contractReferenceGenerator]) {
		assert.doesNotMatch(representation, /surplus remains unless|floors quote-to-backing-unit|dust may promote/)
	}
	assert.match(operatorReference, /Requests below the target coverage commitment are partial[\s\S]*Requests at or above the target coverage commitment are maximum requests[\s\S]*award and quote-to-backing-unit conversion round up/)
	assert.match(operatorReference, /Coverage commitment moves only up to the amount whose complete 5%-bonus award is funded by target pool-held vault REP backing[\s\S]*maximum request records any untransferred coverage commitment as bad debt[\s\S]*Queued Execution[\s\S]*canonical lifecycle and rationale/)
	for (const representation of [liquidationHtml, operatorReference, contractInteractionReference, contractReferenceGenerator, eventStream, invariantsHtml, whitepaperStatoblast, diagramSpecs]) {
		assert.doesNotMatch(representation, /(?:any|an) unfunded residual/, 'Recorded bad debt must not be classified exclusively as unfunded')
	}
	assert.match(contractInteractionReference, /halfway migration component strictly greater than one[\s\S]*effective pool-held vault REP backing multiplier separately floors that component at the 10,500-BPS liquidation-award reserve/)
	assert.match(securityPoolUtils, /if \(coverageCommitmentAttoEth == 0\) return true/)
	assert.match(openOracleIntegration, /thresholdPrice = min\(associatedRepThreshold, migrationThreshold\)/)
	assert.match(
		openOracleIntegration,
		/migrationSecurityMultiplierBps = max\(10,000 \+ ⌊\(poolSecurityMultiplierBps - 10,000\) \/ 2⌋, 10,500\)[\s\S]*liquidation design[\s\S]*partial execution preserves the positive target REP and coverage commitment floors[\s\S]*funded transfer must leave the caller above both floors and healthy[\s\S]*maximum request instead records untransferred residual coverage commitment as bad debt[\s\S]*complete coverage commitment when its funded slice would leave the caller below the minimum active coverage commitment/,
	)
	assert.match(whitepaperStatoblast, /10,000 \+ ⌊\(poolSecurityMultiplierBps - 10,000\) \/ 2⌋[\s\S]*migrationSecurityMultiplierBps[\s\S]*10,500 BPS/)
	assert.doesNotMatch(openOracleIntegration, /rejects chunks that fail\s+target, caller, or floor checks/)
	assert.doesNotMatch(openOracleIntegration, /thresholdPrice = ⌊vaultRepAttoRep \* PRICE_PRECISION/)
	assert.doesNotMatch(whitepaperStatoblast, /data-source="coverageCommitmentAttoEth \* statoblastSecurityMultiplierBps \* repPerEthPrice > repBacking/)
	assert.match(
		whitepaperStatoblast,
		/Admission for each affected vault requires sufficient total associated REP and, for positive commitments, strictly sufficient pool-held vault REP backing under the effective migration multiplier\. Aggregate pool totals must independently pass the same conditions, and only vaults are liquidation targets/,
	)
	assert.match(securityPool, /function _requirePoolCoverage\([\s\S]*SecurityPoolUtils\.isVaultHealthy\(\s*totalPoolHeldRepAttoRep,\s*totalDisputeStakedRepAttoRep,\s*totalCoverageCommitmentAttoEthValue/)
	assert.match(securityPool, /function executeCoverageCommitmentUpdate\([\s\S]*SecurityPoolUtils\.isVaultHealthy\([\s\S]*'Vault commitment'[\s\S]*SecurityPoolUtils\.isVaultHealthy\(\s*getTotalPoolHeldRepAttoRep\(\),\s*_getTotalDisputeStakedRep\(\),\s*totalCoverageCommitmentAttoEth[\s\S]*'Pool commitment'/)
	for (const [label, representation] of [
		['Statoblast whitepaper', whitepaperStatoblast],
		['invariants', invariantsHtml],
		['liquidation design', liquidationHtml],
		['generated interaction reference', contractInteractionReference],
		['interaction reference generator', contractReferenceGenerator],
	] as const) {
		assert.match(representation, /affected vault[\s\S]{0,300}(?:aggregate )?pool (?:backing|totals)/, `${label} must distinguish the affected vault from aggregate pool totals`)
		assert.doesNotMatch(representation, /pool (?:is|becomes?|remain(?:s)?) (?:immediately )?liquidatable/, `${label} must not describe the pool as liquidatable`)
	}
	assert.match(whitepaperStatoblast, /Later REP withdrawals and escalation deposits cannot\s+violate either vault condition or either aggregate condition while the\s+coverage commitment remains active/)
	assert.match(invariantsHtml, /Exactly 150 pool-held vault REP backing is unsafe[\s\S]*Both the vault and aggregate totals must pass this example/)
	assert.match(initiateSecurityPoolForkRow, /Pool operational with no inherited fixed outcome;[\s\S]*authorized by its declared share token[\s\S]*Declared-token authorization is not configured-factory registration/)
	assert.match(
		ownEscalationForkRow,
		/Pool operational with no inherited fixed outcome;[\s\S]*`canTriggerOwnFork\(\)` is true because it recorded a local non-decision or inherited a threshold tie without a game-level fixed outcome[\s\S]*does not require declared-share-token authorization[\s\S]*neither path authenticates the supplied address against the configured pool factory/,
	)
	assert.match(createChildUniverseRow, /returned auction is nonzero, deployed, and has never been trusted by this forker[\s\S]*child's fork-data slot is unused[\s\S]*expected parent, universe, source factory, forker, and auction[\s\S]*do not independently prove configured-factory registration/)
	assert.match(escalationDepositRow, /pool operational in an unforked universe, without an inherited fixed outcome, and not awaiting continuation/)
	assert.match(securityPool, /function depositToEscalationGame\([^}]+require\(!hasInheritedForkOutcome, 'Resolved'\);/)
	assert.match(migrateSharesRow, /an `Operational` source has no inherited fixed outcome because auto-fork activation rejects one/)
	assert.match(contractInteractionReference, /claimForkedEscalationDeposits\(\.\.\.\)[\s\S]*parent game still satisfies `canTriggerOwnFork\(\)` by having either a local non-decision or an inherited threshold tie without a fixed outcome/)
	assert.match(claimForkedEscalationDepositsRow, /every deposit to commit `vault` as its immutable depositor/)
	assert.match(whitepaperStatoblast.replaceAll(/\s+/g, ' '), /named vault must be the deposit's committed depositor[\s\S]*settlement pays that same depositor/)
	assert.match(contractInteractionReference, /withdrawDeposit\(uint256 depositIndex, outcome\)[\s\S]*`CarryDepositConsumed` and `VaultEscrowUpdated`[\s\S]*for a winner, `ClaimDeposit`/)
	assert.match(contractInteractionReference, /`DisputeStakedRepDrainedAtFork` when unresolved escalation exists/)
	assert.match(contractInteractionReference, /Initially authorized `SecurityPoolFactory` for an origin pool; an authorized parent `SecurityPool` for a child pool/)
	assert.match(contractInteractionReference, /canonical source pool is `Operational` or `PoolForked`[\s\S]*every target in a multi-target call already has a canonical child pool/)
	assert.match(contractInteractionReference, /If needed, first freezes the operational source pool and records its fork snapshot/)
	assert.match(securityPoolForker, /uint256 migrationAmountAttoRep = data\.ownFork \? data\.vaultRepAtForkAttoRep : data\.auctionableRepAtForkAttoRep;\s*if \(migrationAmountAttoRep > 0\) \{\s*for \(uint256 index = 0; index < outcomeIndices\.length; index\+\+\)/)
	assert.match(contractInteractionReference, /migrateRepToZoltar\(securityPool, outcomeIndices\)[\s\S]*A zero migration amount or empty list returns after the proxy and pool-state guards without per-outcome validation or events/)
	assert.match(escalationGameForker, /\(ISecurityPool child, EscalationGame childEscalationGame\) = _getOrDeployChildPool\(parent, uint8\(outcomeIndex\)\);[\s\S]*_claimWinningDepositsFromGame\([\s\S]*emit ClaimForkedEscalationDepositsToWallet\(/)
	assert.match(contractInteractionReference, /claimForkedEscalationDeposits\(\.\.\.\)[\s\S]*An empty list still performs child setup and emits a zero-valued claim summary[\s\S]*always `ClaimForkedEscalationDepositsToWallet`, including for an empty list/)
	assert.match(securityPoolForkerVaultMigrationBase, /if \(address\(zoltar\.getRepToken\(childUniverseId\)\) == address\(0x0\)\) \{\s*zoltar\.deployChild\(parent\.universeId\(\), outcomeIndex\)/)
	assert.match(contractInteractionReference, /createChildUniverse\(securityPool, outcomeIndex\)[\s\S]*Loads an already deployed child universe and REP token or deploys them when absent[\s\S]*`DeployChild` only when child REP was absent/)
	assert.match(contractInteractionReference, /candidate reports this exact share token; its universe has no different canonical pool/)
	assert.match(contractInteractionReference, /Establishes the candidate as `canonicalPoolByUniverse`/)
	assert.match(operatorReference, /Canonical source and fork transition[\s\S]*asks its forker to initiate the pool fork[\s\S]*Canonical destinations[\s\S]*single-target migration may lazily create a missing child/)
	assert.match(contractInteractionReference, /`mintCompleteSets\(universeId, account, amountAttoShares\)`\tAn authorized `SecurityPool`/)
	assert.match(contractInteractionReference, /`burnCompleteSets\(universeId, account, amountAttoShares\)`\tAn authorized `SecurityPool`/)
	assert.match(contractInteractionReference, /`burnTokenIdAndGetRemainingSupply\(tokenId, account\)`\tAn authorized `SecurityPool`/)
	assert.match(contractInteractionReference, /Fixes the clearing mode, clearing tick, ETH totals, and aggregate REP allocation/)
	assert.match(contractInteractionReference, /Withdrawal-time allocation assigns division dust from deterministic cumulative ETH positions, making each payout independent of claim order/)
	assert.match(truthAuction, /function finalize\(\) external \{[\s\S]*payable\(owner\)\.call\{ value: raisedAttoEthToSend \}\(''\)[\s\S]*require\(sent, 'Auction failed to send raised ETH to the owner'\)/)
	assert.match(truthAuction, /function withdrawBids\([\s\S]*for \(uint256 i = 0; i < tickIndices\.length; i\+\+\)[\s\S]*_payOrDeferRefund\(withdrawFor, totalRefundAttoEth\)/)
	assert.match(truthAuction, /function _refundLosingBids\([\s\S]*for \(uint256 i = 0; i < tickIndices\.length; i\+\+\)[\s\S]*_payOrDeferRefund\(bidder, totalRefundAttoEth\)/)
	assert.match(truthAuction, /function _payOrDeferRefund\([\s\S]*if \(amountAttoEth == 0\) return;[\s\S]*payable\(bidder\)\.call\{ value: amountAttoEth, gas: REFUND_PUSH_GAS_LIMIT \}\(''\)[\s\S]*pendingEthRefundsAttoEth\[bidder\] = pendingAmountAttoEth;[\s\S]*emit EthRefundDeferred\(/)
	assert.match(
		truthAuction,
		/function withdrawPendingEthRefund\(\) external \{[\s\S]*pendingEthRefundsAttoEth\[msg\.sender\] = 0;[\s\S]*emit PendingEthRefundWithdrawn\(msg\.sender, amountAttoEth\);[\s\S]*payable\(msg\.sender\)\.call\{ value: amountAttoEth \}\(''\)[\s\S]*require\(sent, 'Auction failed to withdraw deferred ETH refund'\)/,
	)
	assert.match(contractInteractionReference, /refundLosingBids\(tickIndices\)[\s\S]*attempts an immediate gas-bounded ETH refund[\s\S]*gas-exhausted pushes are recorded in `pendingEthRefundsAttoEth` without restoring the bid[\s\S]*An empty list changes no bids and makes no external call/)
	assert.match(contractInteractionReference, /finalize\(\)[\s\S]*owner accepts the proceeds ETH call, including zero value[\s\S]*A rejected call reverts finalization and its event/)
	assert.match(
		contractInteractionReference,
		/withdrawBids\(withdrawFor, tickIndices, proRataTotal\)[\s\S]*gas-exhausted positive refund push is gas-bounded and deferred rather than reverting or starving the REP and coverage-commitment settlement[\s\S]*An empty list returns three zeros without changing bids, emitting events, or calling the beneficiary/,
	)
	assert.match(contractInteractionReference, /withdrawPendingEthRefund\(\)[\s\S]*emits its withdrawal before transferring without the push-refund gas cap[\s\S]*callback-created deferrals follow the clear in log order[\s\S]*A rejected pull reverts the transfer, clear, and event[\s\S]*`PendingEthRefundWithdrawn`/)
	assert.match(zoltar, /function splitMigrationRep\([\s\S]*require\(universe\.forkTime != 0[\s\S]*splitRepInternal\(universeId, amountAttoRep, msg\.sender, outcomeIndexes\)/)
	assert.match(zoltar, /function splitRepInternal\([\s\S]*for \(uint256 i = 0; i < outcomeIndexes\.length; i\+\+\)[\s\S]*reputationToken\.mint\(recipient, amountAttoRep\)[\s\S]*emit MigrationRepSplit\(/)
	assert.match(reputationToken, /function mint\(address account, uint256 valueAttoRep\)[\s\S]*_mint\(account, valueAttoRep\);[\s\S]*emit Mint\(account, valueAttoRep\)/)
	assert.match(
		contractInteractionReference,
		/splitMigrationRep\(universeId, amountAttoRep, outcomeIndexes\)[\s\S]*An empty outcome list returns after the universe-fork guard without outcome validation, deployment, minting, or events[\s\S]*nonempty zero-amount call still validates every outcome[\s\S]*child REP `Transfer` and `Mint`, then `MigrationRepSplit`[\s\S]*no event for an empty list/,
	)
	assert.match(securityPoolForker, /function _claimAuctionProceeds\([\s\S]*require\(data\.truthAuction\.finalized\(\), 'Not final'\)[\s\S]*data\.truthAuction\.withdrawBids\([\s\S]*_creditAuctionProceeds\(/)
	assert.match(
		contractInteractionReference,
		/claimAuctionProceeds\(securityPool, vault, tickIndices\)[\s\S]*For an empty list, the underlying auction withdrawal returns three zeros and the wrapper exits after the finalization guard without validating bids or the named beneficiary, calling it, changing state, or emitting events[\s\S]*no event for an empty list/,
	)
	assert.match(escalationGameSettlement, /function drainAllRep\(address receiver\)[\s\S]*amountAttoRep = repToken\.balanceOf\(address\(this\)\);[\s\S]*if \(amountAttoRep == 0\) return 0;[\s\S]*_safeTransferRep\(receiver, amountAttoRep\)/)
	assert.match(escalationGameSettlement, /function drainAllRep\(address receiver\)[\s\S]*require\(msg\.sender == address\(securityPool\), 'Only pool'\)/)
	assert.match(securityPool, /function activateForkMode\(\)[\s\S]*require\(!hasInheritedForkOutcome, 'Resolved'\)[\s\S]*systemState = SystemState\.PoolForked;[\s\S]*mstore\(0x00, shl\(224, 0x3c250020\)\)[\s\S]*call\(gas\(\), game/)
	assert.match(securityPoolForker, /function _getEscalationGame\(ISecurityPool securityPool\)[\s\S]*escalationGame\.securityPool\(\)[\s\S]*'Escalation game pool'/)
	assert.match(securityPoolForkerBase, /function _validateChildEscalationGame\([\s\S]*childEscalationGame\.securityPool\(\)[\s\S]*'Child game'/)
	assert.match(
		securityPoolForkerVaultMigrationBase,
		/childEscalationGame = child\.escalationGame\(\);[\s\S]*_validateChildEscalationGame\(child, childEscalationGame\);[\s\S]*_initializeChildForkedEscalationGameIfNeeded\([\s\S]*childEscalationGame[\s\S]*_ensureChildEscalationBacking\(parent, outcomeIndex, child, childEscalationGame\)/,
	)
	assert.match(escalationGameForker, /function _claimWinningDepositsFromGame\([\s\S]*if \(depositor != vault\) revert\(\);[\s\S]*childEscalationGame\.recordForkedEscrowForOutcome\(\s*depositor[\s\S]*childEscalationGame\.exportForkedEscrowByOutcome\(depositor, depositor\)/)
	assert.match(securityPoolForker, /\(child, childEscalationGame\) = _migrateVaultAndReturnChild\(securityPool, childOutcomeIndex\);[\s\S]*\(securityPool, vault, childOutcomeIndex, child, childEscalationGame\)/)
	assert.match(escalationGameForker, /ISecurityPool child = migratedChild;[\s\S]*EscalationGame childEscalationGame = migratedChildEscalationGame;[\s\S]*if \(address\(child\) == address\(0x0\)\)[\s\S]*_validateChildEscalationGame\(child, childEscalationGame\)/)
	assert.equal((securityPoolForkerVaultMigrationBase.match(/child\.escalationGame\(\)/g) ?? []).length, 1, 'child setup must capture the child game exactly once')
	assert.equal((securityPoolForker.match(/child\.escalationGame\(\)/g) ?? []).length, 1, 'the zero-game initialization branch must capture the newly initialized game exactly once')
	assert.equal((securityPoolForkerBase.match(/child\.escalationGame\(\)/g) ?? []).length, 1, 'auction completion must capture the child game exactly once')
	assert.doesNotMatch(escalationGameForker, /child\.escalationGame\(\)/, 'claim and unresolved cleanup must reuse the validated child game instead of reading the child getter')
	assert.match(
		contractInteractionReference,
		/Child-game trust boundary[\s\S]*game relationship check is point-in-time[\s\S]*does not prove that an arbitrary game getter is immutable[\s\S]*reuses that exact address[\s\S]*without reading the child getter again[\s\S]*Truth-auction completion performs a fresh point-in-time validation/,
	)
	assert.doesNotMatch(contractInteractionReference, /immutable `securityPool\(\)` binding/)
	for (const childPoolInteractionRow of [createChildUniverseRow, migrateVaultRow, migrateVaultWithUnresolvedEscalationRow]) {
		assert.match(childPoolInteractionRow, /reported nonzero escalation game passes the child-game trust boundary \(#child-game-trust-boundary\)/)
	}
	assert.match(claimForkedEscalationDepositsRow, /continuation game that passes the child-game trust boundary \(#child-game-trust-boundary\)/)
	assert.match(claimForkedEscalationDepositsRow, /captures and validates the child's escalation game and uses that same game for continuation backing and escrow payment/)
	assert.match(migrateVaultWithUnresolvedEscalationRow, /returns the selected child and its captured, validated escalation game to the unresolved-accounting cleanup phase, which reuses those exact addresses without reading the child's game again/)
	assert.match(securityPoolForkerBase, /function _finalizeEscalationStateAfterAuction\([\s\S]*childEscalationGame = child\.escalationGame\(\);\s*_validateChildEscalationGame\(child, childEscalationGame\);[\s\S]*_finalizeAwaitingForkContinuationIfReady\(child, childEscalationGame\)/)
	assert.match(securityPoolForker, /if \(!parentForkData\.unresolvedEscalationAtFork\) return childEscalationGame;\s*if \(address\(childEscalationGame\) == address\(0x0\)\)/)
	assert.match(contractInteractionReference, /When unresolved escalation requires a continuation and setup initially reports no game, initialization creates one; the forker then captures and validates it before continuation use/)
	assert.match(contractInteractionReference, /initializeChildForkedEscalationGameIfNeeded\(parent, child, childEscalationGame\)[\s\S]*When unresolved escalation requires a continuation and no game existed, it captures and validates the game created by initialization before any continuation use/)
	assert.match(startTruthAuctionRow, /game reported during immediate completion passes the child-game trust boundary \(#child-game-trust-boundary\)/)
	assert.match(finalizeTruthAuctionRow, /game reported at completion passes the child-game trust boundary \(#child-game-trust-boundary\)/)
	assert.match(performLiquidationRow, /complete 105% award is funded by target vault REP backing[\s\S]*fixed 5%-bonus vault REP backing award[\s\S]*Dispute-staked REP claims, accrued claimable fees, and surplus vault REP backing remain with the target/)
	assert.match(performLiquidationRow, /pre-execution target or caller `VaultAccountingCheckpoint` events as needed[\s\S]*post-transfer caller checkpoint only when coverage commitment moves/)
	assert.match(performLiquidationRow, /otherwise funded slice would leave the caller below the minimum coverage commitment[\s\S]*not transferred[\s\S]*complete target coverage commitment is recorded/)
	assert.match(securityPool, /updateVaultFees\(targetVaultAddress\);\s*updateVaultFees\(callerVault\);[\s\S]*if \(coverageCommitmentToTransferAttoEth != 0\) _emitVaultAccountingCheckpoint\(callerVault\);/)
	assert.doesNotMatch(performLiquidationRow, /EscalationClaimMoved|Claim checkpoint pending|Claim move failed/)
	assert.doesNotMatch(escalationGameClaimDelegate, /function moveEscalationClaim|payoutClaimBundle|forkCarryPayoutClaimImportCursor/)
	assert.doesNotMatch(securityPoolLiquidationDelegate, /_moveEscalationClaim|previewLiquidationClaimRep|moveEscalationClaim/)
	assert.match(claimDepositWithoutTransferRow, /inverse-retention claim units[\s\S]*no local auction checkpoint[\s\S]*⌈originalPrincipal × truthAuctionRepBeforeAttoRep \/ truthAuctionRepRemainingAttoRep⌉[\s\S]*Other unconsumed deposits by the same depositor remain backed/)
	assert.match(escalationGameSettlement, /_claimDepositForWinning\(depositIndex, outcome, false\)/)
	assert.match(escalationGameState, /uint256 claimUnits = _repToClaimUnits\(amountAttoRep\);[\s\S]*bundle\.disputeStakedRepClaimUnits -= claimUnits/)
	assert.match(html, /raw claim units corresponding to that deposit's effective original principal[\s\S]*truthAuctionRepBeforeAttoRep \/ truthAuctionRepRemainingAttoRep/)
	assert.match(recordForkedEscrowRow, /depositor remains the immutable payout owner[\s\S]*inherited claims remain in the carry commitment and are not copied/)
	assert.match(escalationGameDepositDelegate, /recordForkedEscrowForOutcome\([\s\S]*_increaseEscrowedRepForBundle\(depositor, effectiveChildRepAttoRep, false\)/)
	assert.match(
		eventStream,
		/leaf's depositor is the immutable claim owner[\s\S]*ClaimDeposit` with `transferredRep = false`[\s\S]*truthAuctionRepBeforeAttoRep == 0[\s\S]*ceiling of `originalDepositAmountAttoRep × truthAuctionRepBeforeAttoRep \/ truthAuctionRepRemainingAttoRep`[\s\S]*Other unconsumed deposits by the same depositor remain backed/,
	)
	assert.match(eventStream, /ForkCarryCheckpoint` installs that immutable proof state[\s\S]*copies no leaves, bundles, or owners/)
	assert.match(auctionDesign, /call <code>resumeForkedEscalationGame<\/code> immediately[\s\S]*already-installed commitment and aggregate funding checks are bounded/)
	assert.match(startTruthAuctionRow, /ForkContinuationResumed/)
	assert.match(finalizeTruthAuctionRow, /TruthAuctionHaircutApplied[\s\S]*ForkContinuationResumed/)
	assert.match(whitepaperStatoblast, /Winning proofs can be relayed permissionlessly and pay the original depositor committed in each leaf/)
	assert.doesNotMatch(whitepaperStatoblast, /Liquidation penalty math/)
	assert.match(drainAllRepRow, /Owning `SecurityPool` only[\s\S]*A zero balance returns zero without a transfer or event[\s\S]*no event at zero balance/)
	assert.doesNotMatch(drainAllRepRow, /SecurityPoolForker/)
	assert.match(
		activateForkModeRow,
		/configured game's drain must succeed or the entire activation reverts without propagating its reason data[\s\S]*makes the pool drain its configured escalation game's entire REP balance to the forker[\s\S]*balances replenished since the prior call[\s\S]*Pool-held REP `Transfer` always, including at zero; configured-game REP `Transfer` only for a positive game balance/,
	)
	assert.match(escalationGameEscrow, /function recordForkedEscrowForOutcome\([\s\S]*EscalationGameDepositDelegate\.recordForkedEscrowForOutcome/)
	assert.match(escalationGameDepositDelegate, /function recordForkedEscrowForOutcome\([\s\S]*if \(sourcePrincipalAttoRep == 0 && childRepAmountAttoRep == 0\) return;[\s\S]*emit ForkedEscrowRecorded\(/)
	assert.match(
		contractInteractionReference,
		/recordForkedEscrowForOutcome\(depositor, outcome, sourcePrincipalAttoRep, childRepAmountAttoRep\)[\s\S]*Source principal and child REP may independently be zero; when both are zero, the call is a no-op[\s\S]*When both amounts are zero, returns without changing state or emitting an event[\s\S]*no event when both amounts are zero/,
	)
	assert.doesNotMatch(contractInteractionReference, /nonzero call additionally requires positive source principal/)
	const gameDelegateSelectors = [...new Set([...escalationGame, ...escalationGameState, ...escalationGameEscrow, ...escalationGameSettlement].join('').matchAll(/EscalationGameDepositDelegate\.(\w+)/g))].map(match => match[1]).filter((name): name is string => name !== undefined && name !== 'sol')
	for (const selector of gameDelegateSelectors) {
		assert.ok(html.includes(`<code>${selector}</code>`) || html.includes(selector), `Escalation architecture must inventory delegated game mutation ${selector}`)
		assert.ok(operatorReference.includes(`\`${selector}\``), `Operator reference must inventory delegated game mutation ${selector}`)
	}
	assert.match(escalationGame, /function _initializeStartParams\([\s\S]*if \(owner != msg\.sender\) revert\(\);/)
	assert.match(escalationGame, /function recordDepositFromSecurityPool\([\s\S]*require\(msg\.sender == address\(securityPool\), 'Only security pool'\);/)
	assert.match(escalationGameDepositDelegate, /function resumeFromFork\(\) external \{[\s\S]*IEscalationGameDepositContext game = IEscalationGameDepositContext\(address\(this\)\);[\s\S]*require\(msg\.sender == game\.securityPool\(\), 'Only pool'\);/)
	assert.match(escalationGameDepositDelegate, /function applyTruthAuctionHaircut\([\s\S]*require\(msg\.sender == IEscalationGameSecurityPoolContext\(poolAddress\)\.securityPoolForker\(\), 'Only forker'\);/)
	assert.match(html, /Factory-owner-only start and fork-continuation initialization entrypoints, pool-only resume and local-deposit wrappers, and the forker-only auction-haircut wrapper/)
	assert.match(escalationGameEscrow, /function _exportForkedEscrowByOutcome\([\s\S]*if \(exported\) \{[\s\S]*emit ForkedEscrowExported\([\s\S]*if \(totalChildRepToTransferAttoRep == 0\) return/)
	assert.match(contractInteractionReference, /exportForkedEscrowByOutcome\(vault, repReceiver\)[\s\S]*When all outcomes were already empty or exported, returns zero arrays without state change, token transfer, or event[\s\S]*no event for an already-empty export/)
	assert.match(securityPool, /function transferEth\(address payable receiver, uint256 amountAttoEth\)[\s\S]*_emitPoolAccountingCheckpoint\(AccountingReason\.CollateralReconciliation, address\(0x0\)\);[\s\S]*_sendEth\(receiver, amountAttoEth\)/)
	assert.match(contractInteractionReference, /transferEth\(receiver, amountAttoEth\)[\s\S]*receiver` accepts the ETH call, including zero value[\s\S]*At zero amount it reduces no settlement collateral but still emits the checkpoint and performs a zero-value call/)
	assert.match(erc1155, /function _mint\(address to, uint256 id, uint256 value\)[\s\S]*emit TransferSingle\([\s\S]*_doSafeTransferAcceptanceCheck\(/)
	assert.match(erc1155, /function _mintBatch\(address to, uint256\[\] memory ids, uint256\[\] memory values\)[\s\S]*emit TransferBatch\([\s\S]*_doSafeBatchTransferAcceptanceCheck\(/)
	assert.match(
		shareToken,
		/alreadyMigratedAttoShares = migratedShareAmountAttoShares[\s\S]*amountAttoShares = fromIdBalanceAttoShares - alreadyMigratedAttoShares[\s\S]*migratedSourceBalanceLocked\[fromId\]\[msg\.sender\] = true[\s\S]*_mint\(msg\.sender, toId, amountAttoShares\)[\s\S]*emit Migrate\(msg\.sender, fromId, toId, amountAttoShares\)/,
	)
	assert.doesNotMatch(shareToken, /_burn\(msg\.sender, fromId, fromIdBalanceAttoShares\)/)
	assert.match(contractInteractionReference, /createCompleteSet\(\)[\s\S]*contract trader accepts `onERC1155BatchReceived`[\s\S]*Callback rejection rolls back the ETH, pool accounting, events, and share mint/)
	assert.match(contractInteractionReference, /migrate\(fromId, targetOutcomeIndexes\)[\s\S]*contract holder accepts `onERC1155Received` for every target mint[\s\S]*one ERC-1155 mint `TransferSingle` and `Migrate` per materialized target on successful callbacks/)
	assert.match(contractInteractionReference, /mintCompleteSets\(universeId, account, amountAttoShares\)[\s\S]*contract account accepts `onERC1155BatchReceived`[\s\S]*Rejection rolls back the mint and the authorized pool's surrounding transaction/)
	assert.match(priceCoordinator, /function requestPrice\([\s\S]*if \(excess > 0\) \{[\s\S]*payable\(msg\.sender\)\.call\{ value: excess \}\(''\)[\s\S]*require\(sent, 'Oracle coordinator failed to refund excess ETH bounty'\)/)
	assert.match(priceCoordinator, /function requestPriceIfNeededAndStageOperation\([\s\S]*if \(refund > 0\) \{[\s\S]*payable\(msg\.sender\)\.call\{ value: refund \}\(''\)[\s\S]*require\(sent, 'Oracle coordinator failed to return unused ETH'\)/)
	assert.match(contractInteractionReference, /requestPriceIfNeededAndStageOperation\(\.\.\.\)[\s\S]*caller must accept any positive unused-ETH refund[\s\S]*rejection rolls back the entire transaction, including any queueing, immediate execution, or newly opened report/)
	assert.match(contractInteractionReference, /requestPrice\(proposedRepPerEthPrice, requestedInitialWethAttoEth\)[\s\S]*caller must accept any positive excess-ETH refund[\s\S]*Callback rejection rolls back the report and initial position/)
	assert.match(openOracleIntegration, /id="refund-callback"[\s\S]*Both public request paths refund only a positive unused or excess ETH\s+amount[\s\S]*If it rejects the refund, the entire transaction\s+reverts/)
	assert.match(operatorReference, /Immediate execution[\s\S]*canonical refund warning[\s\S]*open-oracle\.html#refund-callback/)
	assert.match(priceCoordinator, /function recoverSettledPendingReport\(\)[\s\S]*storedGame\(reportId\)[\s\S]*require\(settlementTimestamp != 0, 'Pending oracle report has not settled'\)/)
	assert.match(contractInteractionReference, /recoverSettledPendingReport\(\)[\s\S]*stored OpenOracle `storedGame\(reportId\)\.settlementTimestamp` is nonzero/)
	assert.match(operatorReference, /Recovery path[\s\S]*requires both a pending report and a nonzero `storedGame\(reportId\)\.settlementTimestamp`/)
	assert.match(
		contractInteractionReference,
		/addFeeEligibleCoverageCommitmentAttoEth\(vault, amountAttoEth\)[\s\S]*no lifecycle, vault, positive-amount, or value-change guard[\s\S]*newly auction-claimed coverage commitment to the live fee denominator[\s\S]*immediately recalculates retention against the assigned denominator[\s\S]*including the latter two at zero amount/,
	)
	assert.match(securityPool, /function setAwaitingForkContinuation\(bool shouldAwait\) external onlyForker \{\s*awaitingForkContinuation = shouldAwait;\s*emit AwaitingForkContinuationSet\(awaitingForkContinuation\)/)
	assert.match(contractInteractionReference, /setAwaitingForkContinuation\(shouldAwait\)[\s\S]*No lifecycle or value-change guard[\s\S]*`AwaitingForkContinuationSet`, including for a repeated value/)
	assert.match(securityPool, /function setSystemState\(SystemState newState\) external onlyForker \{\s*systemState = newState;\s*emit SystemStateSet\(systemState\)/)
	assert.match(contractInteractionReference, /setSystemState\(newState\)[\s\S]*No transition or value-change guard[\s\S]*`SystemStateSet`, including for a repeated state/)
	assert.match(securityPool, /function configureVault\([\s\S]*?\) external onlyForker \{[\s\S]*?_emitVaultAccountingCheckpoint\(vault\);\s*_emitPoolAccountingCheckpoint\(AccountingReason\.CoverageCommitmentChange, vault\)/)
	assert.match(contractInteractionReference, /configureVault\(vault, repBackingUnits, coverageCommitmentAttoEth, vaultFeeIndex\)[\s\S]*no lifecycle or value-change guard[\s\S]*Always `VaultAccountingCheckpoint` and `PoolAccountingCheckpoint`, including when all supplied values repeat current state/)
	assert.match(securityPool, /function setTotalRepBackingUnits\(uint256 newDenominator\) external onlyForker \{\s*totalRepBackingUnits = newDenominator;\s*emit TotalRepBackingUnitsSet\(totalRepBackingUnits\)/)
	assert.match(contractInteractionReference, /setTotalRepBackingUnits\(newDenominator\)[\s\S]*No lifecycle or value-change guard[\s\S]*`TotalRepBackingUnitsSet`, including for zero or a repeated value/)
	assert.match(securityPool, /function setTotalSharesAttoShares\(uint256 newTotalSharesAttoShares\) external onlyForker \{\s*shareTokenSupplyAttoShares = newTotalSharesAttoShares;\s*emit ShareTokenSupplySet\(shareTokenSupplyAttoShares\)/)
	assert.match(contractInteractionReference, /setTotalSharesAttoShares\(newTotalSharesAttoShares\)[\s\S]*No lifecycle or value-change guard[\s\S]*`ShareTokenSupplySet`, including for zero or a repeated value/)
	assert.match(securityPool, /function setPoolFinancials\([\s\S]*?lastUpdatedFeeAccumulator = block\.timestamp;[\s\S]*?_emitPoolAccountingCheckpoint\(AccountingReason\.ForkFinalization, address\(0x0\)\)/)
	assert.match(contractInteractionReference, /setPoolFinancials\(newSettlementCollateralAttoEth, newTotalCoverageCommitmentAttoEth, newFeeEligibleCoverageCommitmentAttoEth\)[\s\S]*no lifecycle or value-change guard[\s\S]*`PoolAccountingCheckpoint`, including for repeated financial values/)
	assert.match(securityPool, /function addFeeEligibleCoverageCommitmentAttoEth\(address vault, uint256 amountAttoEth\) external onlyForker \{[\s\S]*?_emitVaultAccountingCheckpoint\(vault\);\s*_emitPoolAccountingCheckpoint\(AccountingReason\.AuctionClaim, vault\)/)
	assert.match(securityPoolForker, /Before finalization, only refundable bids can be settled/)
	assert.match(securityPoolForker, /require\(claimTickIndices\.length == 0, 'Not final'\)/)
	assert.match(securityPoolForker, /block\.timestamp <= data\.forkActivationTime \+ SecurityPoolUtils\.MIGRATION_TIME/)
	assert.match(securityPoolForkerVaultMigrationDelegate, /require\(address\(childrenByPoolAndOutcome\[parent\]\[outcomeIndex\]\) == address\(0x0\), 'Child pool exists'\)/)
	assert.match(priceCoordinator, /_emitPriceReportRejected\(reportId, 'Base fee too high'\);\s*return;/)
	assert.match(priceCoordinator, /finalReportDisputeStatus == FINAL_REPORT_COUNTER_SATURATED\s*\? 'Counter saturated'\s*: 'Report uneconomic'/)
	assert.match(priceCoordinator, /_emitPriceReportRejected\(reportId, 'Empty oracle settlement'\);\s*return;/)
	assert.match(priceCoordinator, /_emitPriceReportRejected\(reportId, 'Oracle price is zero'\);\s*return;/)
	assert.match(priceCoordinator, /require\(\s*msg\.sender == pendingReportSponsor,\s*'Only the pending report sponsor can queue more operations until settlement'/)
	assert.match(priceCoordinator, /bool shouldRequestPrice = pendingReportId == 0 && pendingSettlementOperationIds\.length == 0/)
	assert.match(priceCoordinator, /if \(shouldRequestPrice && isPendingSettlementOperationId\)/)
	assert.match(escalationGameForker, /if \(child\.systemState\(\) != SystemState\.ForkMigration\) revert\(\)/)
	assert.match(escalationGameForker, /block\.timestamp > forkDataByPool\[parent\]\.forkActivationTime \+ SecurityPoolUtils\.MIGRATION_TIME\) revert\(\)/)
	assert.match(escalationGameForker, /guards keep that initcode below EIP-3860's hard deployment limit/)
	assert.match(securityPool, /event SystemStateSet\(SystemState systemState\)/)
	assert.match(securityPool, /require\(zoltar\.getForkTime\(universeId\) == 0, 'Forked'\)/)
	assert.match(securityPool, /function activateForkMode\(\) external onlyForker/)
	assert.match(securityPool, /function activateForkMode\(\) external onlyForker \{\s*require\(!hasInheritedForkOutcome, 'Resolved'\)/)
	const externalForkBody = readSolidityFunctionBody(securityPoolForker, 'function initiateSecurityPoolFork(')
	assertCallOrder(externalForkBody, '_prepareForkState(securityPool, escalationGame)', 'securityPool.activateForkMode()', 'external pool-fork handling must validate the existing universe fork before activating pool fork mode')
	const prepareForkBody = readSolidityFunctionBody(securityPoolForker, 'function _prepareForkState(')
	assert.match(prepareForkBody, /securityPool\.shareToken\(\)\.isAuthorized\(address\(securityPool\)\)/)
	assertCallOrder(prepareForkBody, 'uint256 forkTime = zoltar.getForkTime(universe)', 'require(forkTime > 0,', 'external pool-fork preparation must read and require an existing universe fork')
	const ownForkBody = readSolidityFunctionBody(securityPoolForker, 'function forkZoltarWithOwnEscalationGame(')
	assert.doesNotMatch(ownForkBody, /shareToken\(\)\.isAuthorized/)
	assertCallOrder(ownForkBody, 'securityPool.activateForkMode()', 'migrationProxy.forkUniverse(securityPool.questionId())', 'own-fork handling must activate pool fork mode before forking Zoltar')
	const pooledRepMigrationBody = readSolidityFunctionBody(securityPoolForker, 'function migrateRepToZoltar(')
	assert.match(pooledRepMigrationBody, /_delegateEnsureChildPoolRepSplit\(securityPool, outcomeIndex, migrationAmountAttoRep\)/)
	assert.doesNotMatch(pooledRepMigrationBody, /_transferForkMigratedCollateralToChild/)
	const vaultMigrationBody = readSolidityFunctionBody(securityPoolForkerVaultMigrationBase, 'function _migrateNonEscrowedVaultAccounting(')
	assert.match(vaultMigrationBody, /parent\.updateVaultFees\(vault\)/)
	assert.match(vaultMigrationBody, /parent\.configureVault\(vault, 0, 0, parentVaultFeeIndex\)/)
	assert.match(vaultMigrationBody, /_transferForkMigratedCollateralToChild\(parent, child, migratedRepAttoRep\)/)
	assert.match(contractInteractionReference, /Transfers the caller's REP backing units and coverage commitment into one child pool[\s\S]*retains claimable fees in the parent vault[\s\S]*routes proportional pool-level settlement collateral/)
	assert.match(whitepaperStatoblast, /checkpoints but retains claimable fees in the parent vault[\s\S]*separately routes proportional pool-level settlement collateral/)
	assert.match(shareToken, /if \(sourcePool\.systemState\(\) == SystemState\.Operational\) \{\s*forker\.initiateSecurityPoolFork\(sourcePool\)/)
	assert.match(securityPool, /systemState = SystemState\.PoolForked/)
	assert.match(securityPool, /shareToken\.authorize\(pool\)/)
	assert.match(securityPoolFactory, /shareToken\.authorize\(securityPool\)/)
	assert.match(securityPoolForker, /address\(escalationGame\) == address\(0x0\) \|\| _forkOccurredBeforeEscalationSettled\(escalationGame, forkTime\)/)
	assert.match(securityPoolForker, /'Resolved'/)
	assert.match(securityPoolForker, /securityPool\.setSystemState\(SystemState\.ForkTruthAuction\)/)
	assert.match(securityPoolForkerAuctionSettlementBase, /securityPool\.addFeeEligibleCoverageCommitmentAttoEth\(vault, newCoverageCommitmentAttoEth\)/)
	assert.match(securityPoolForker, /if \(!trustedAuctionAddresses\[msg\.sender\]\) revert\(\);/)
	assert.match(securityPoolForkerVaultMigrationBase, /trustedAuctionAddresses\[address\(truthAuction\)\] = true;[\s\S]*emit ChildPoolLinked\(parent, outcomeIndex, child, truthAuction\)/)
	assert.match(securityPoolForkerVaultMigrationBase, /address\(truthAuction\)\.code\.length != 0/)
	assert.match(securityPoolForkerVaultMigrationBase, /!trustedAuctionAddresses\[address\(truthAuction\)\]/)
	assert.match(securityPoolForkerVaultMigrationBase, /address\(forkDataByPool\[child\]\.truthAuction\) == address\(0x0\)/)
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
	assert.match(escalationGameEscrow, /function _exportVaultUnresolvedTotals\([\s\S]*?require\(!localUnresolvedTotalsExportedByVault\[vault\], 'Vault totals exported'\)[\s\S]*?emit VaultUnresolvedTotalsExported\([\s\S]*?if \(principalToTransferAttoRep == 0\) return principalByOutcomeAttoRep/)
	assert.match(contractInteractionReference, /exportVaultUnresolvedTotals\(vault, repReceiver\)[\s\S]*no explicit nonzero-receiver guard[\s\S]*Always `VaultUnresolvedTotalsExported`, including when every amount is zero/)
	assert.match(contractInteractionReference, /exportVaultUnresolvedTotalsWithoutTransfer\(vault\)[\s\S]*has not exported before[\s\S]*Always `VaultUnresolvedTotalsExported` with `transferredRep = false`, including when every amount is zero[\s\S]*no REP transfer/)
	assert.match(securityPoolFactory, /bytes32 securityPoolSalt = keccak256\([\s\S]*abi\.encode\(\s*parent,\s*universeId,\s*questionId,\s*statoblastSecurityMultiplierBps,\s*initialReportPriorityFeeAttoEthPerGas\s*\)/)
	assert.match(securityPoolFactory, /bytes32 securityPoolSalt = keccak256\([\s\S]*abi\.encode\(\s*address\(0x0\),\s*universeId,\s*questionId,\s*statoblastSecurityMultiplierBps,\s*initialReportPriorityFeeAttoEthPerGas\s*\)/)
	assert.match(priceCoordinatorFactory, /new OpenOraclePriceCoordinator\{ salt: keccak256\(abi\.encode\(msg\.sender, salt\)\) \}/)
	assert.match(truthAuctionFactory, /new UniformPriceDualCapBatchAuction\{ salt: keccak256\(abi\.encode\(msg\.sender, salt\)\) \}/)
	assert.match(securityPoolDeployer, /create2\(0, add\(initCode, 0x20\), mload\(initCode\), 0\)/)
	assert.match(securityPoolFactory, /shareTokenFactory\.deployShareToken\(originId, questionId\)/)
	assert.match(shareTokenFactory, /new ShareToken\{ salt: salt \}\(msg\.sender, zoltar, questionId\)/)
	assert.match(operatorReference, /securityPoolSalt = keccak256\(abi\.encode\(parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas\)\)[\s\S]*using a zero parent for an origin/)
	assert.match(operatorReference, /coordinator and child truth-auction factories each hash that value again with their caller \(`SecurityPoolFactory`\)/)
	assert.match(operatorReference, /pool deployment worker instead uses literal CREATE2 salt zero[\s\S]*full constructor init-code hash/)
	assert.match(operatorReference, /origin share token uses `originId = keccak256\(abi\.encode\(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, originUniverseId\)\)` directly as its CREATE2 salt[\s\S]*children reuse that lineage token and inherit its priority fee/)
	assert.match(operatorReference, /caller-supplied OpenOracle, REP token, and positive `initialReportPriorityFeeAttoEthPerGas`[\s\S]*coordinator construction rejects zero/)
	assert.match(operatorReference, /reserved OpenOracle `uint128` report and escalation-halt capacity/)
	assert.match(openOracleIntegration, /half[\s\S]*capacity remains available for the dynamic base-fee or open-interest[\s\S]*component/)
	assert.match(priceCoordinator, /maximumPriorityFeeReportAttoEth \/= 2/)
	assert.match(priceCoordinator, /'Initial report priority fee exceeds OpenOracle limits'/)
	assert.match(contractInteractionReference, /deployChildSecurityPool\(parent, shareToken[\s\S]*inherits `initialReportPriorityFeeAttoEthPerGas` from the parent coordinator/)
	assert.match(protocolTerms, /minimumToken1ReportAttoEthDefinition = 'The coordinator-computed minimum WETH side: the priority-fee-derived report plus the larger base-fee- or open-interest-derived report\.'/)
	assert.match(protocolTerms, /'initial report size':[\s\S]*minimumToken1ReportAttoEthDefinition/)
	assert.match(whitepaperStatoblast, /lineage identity[\s\S]*commits to the origin's immutable[\s\S]*<code>initialReportPriorityFeeAttoEthPerGas<\/code>[\s\S]*children\s+inherit their origin's\s+configuration/)
	assert.match(whitepaperStatoblast, /href="\.\.\/reference\/operator-guardrails\.html#security-pool-guardrails"/)
	assert.doesNotMatch(whitepaperStatoblast, /originId = keccak256\(abi\.encode\(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, originUniverseId\)\)/)
	for (const emitterFunction of ['emitPoolAccountingCheckpoint', 'emitVaultAccountingCheckpoint']) {
		assert.match(securityPoolEventEmitter, new RegExp(`function ${emitterFunction}\\([\\s\\S]*?\\) external payable`), `${emitterFunction} must remain externally payable for delegatecall flows`)
	}
	assert.match(securityPoolEventEmitter, /function emitForkSnapshotEvents\(\s*ISecurityPool parent,\s*address migrationProxy,\s*address sourceGame,\s*uint256 totalPoolHeldRepAtForkAttoRep,\s*uint256 disputeStakedRepAtForkAttoRep,\s*uint256 resultingLockedRepAttoRep\s*\) external payable/)
	assert.match(
		securityPoolForker,
		/mstore\(pointer, shl\(224, 0x408d33da\)\)[\s\S]*mstore\(add\(pointer, 0x04\), parent\)[\s\S]*mstore\(add\(pointer, 0x24\), migrationProxy\)[\s\S]*mstore\(add\(pointer, 0x44\), sourceGame\)[\s\S]*mstore\(add\(pointer, 0x64\), totalPoolHeldRepAtForkAttoRep\)[\s\S]*mstore\(add\(pointer, 0x84\), disputeStakedRepAtForkAttoRep\)[\s\S]*mstore\(add\(pointer, 0xa4\), resultingLockedRepAttoRep\)[\s\S]*delegatecall\(gas\(\), eventEmitter, pointer, 0xc4, 0, 0\)/,
	)
	assert.match(operatorReference, /Payability permits delegatecalls from value-bearing protocol flows; callers must not send ETH directly/)
	assert.match(truthAuction, /function _allocateFromCumulativePosition\(/)
	assert.match(truthAuction, /function finalize\(\) external[\s\S]*payable\(owner\)\.call\{ value: raisedAttoEthToSend \}/)
	assert.match(invariantsHtml, /FORK-12[\s\S]*activates after value-free finalization with 9 ETH of tracked collateral/)
	assert.doesNotMatch(invariantsHtml, /remains inactive until repair/)
	assert.match(invariantsHtml, /AUC-06[\s\S]*complete unmigrated coverage commitment[\s\S]*independent of claim order/)
	assert.match(invariantsHtml, /AUC-06[\s\S]*REP allocation rounds to zero[\s\S]*claiming that bid alone still credits the coverage commitment/)
	assert.match(invariantsHtml, /AUTH-06[\s\S]*purchased REP remains pool-held[\s\S]*REP backing units and coverage commitment are credited to Bob's vault/)
	assert.match(invariantsHtml, /VAULT-01[\s\S]*initially attributed 20 REP[\s\S]*15 REP of vault backing plus a separate 5 REP claim/)
	assert.match(invariantsHtml, /AUC-06[\s\S]*keeps purchased REP pool-held[\s\S]*credits corresponding REP backing units/)
	assert.match(liquidationHtml, /id="eq-migration-health-condition"[\s\S]*<mi>coverageCommitmentAttoEth<\/mi><mo>=<\/mo><mn>0<\/mn>/)
	assert.match(invariantsHtml, /AUC-07[\s\S]*aggregate[\s\S]*underfundedWinningAttoEth \/ maxRepBeingSoldAttoRep[\s\S]*dust winner can round to zero REP/)
	assert.doesNotMatch(invariantsHtml, /fraction funded by the bid's retained ETH/)
	assert.match(contractInteractionReference, /winning dust bid can receive positive coverage commitment when its REP allocation rounds to zero/)
	assert.match(contractInteractionReference, /`ClaimAuctionProceeds` when REP backing or coverage commitment is credited/)
	assert.match(truthAuction, /return cumulativeAllocationAfter - cumulativeAllocationBefore/)
	assert.match(truthAuction, /require\(msg\.sender == owner, 'Only the auction owner can refund losing bids on behalf of bidders'\)/)
	assert.match(zoltar, /safeTransferFrom\(migrator, Constants\.BURN_ADDRESS, amountAttoRep\)/)
	assert.match(zoltar, /ReputationToken\(address\(reputationToken\)\)\.burn\(migrator, amountAttoRep\)/)
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

function getContractInteractionRow(call: string): string {
	const rowPrefix = `\`${call}\`\t`
	const rows = contractInteractionReference.split('\n').filter(row => row.startsWith(rowPrefix))
	assert.equal(rows.length, 1, `Expected exactly one generated interaction row for ${call}`)
	const [row] = rows
	assert.ok(row, `Missing generated interaction row for ${call}`)
	return row
}

function readSolidityFunctionBody(source: string, functionPrefix: string): string {
	const code = maskSolidityCommentsAndStrings(source)
	const functionIndex = code.indexOf(functionPrefix)
	assert.notEqual(functionIndex, -1, `Missing Solidity function ${functionPrefix}`)
	const openingBraceIndex = code.indexOf('{', functionIndex)
	assert.notEqual(openingBraceIndex, -1, `Missing opening brace for Solidity function ${functionPrefix}`)

	let depth = 0
	for (let index = openingBraceIndex; index < code.length; index++) {
		const character = code[index]
		if (character === '{') {
			depth++
			continue
		}
		if (character !== '}') continue
		depth--
		if (depth === 0) return code.slice(openingBraceIndex + 1, index)
	}
	throw new Error(`Missing closing brace for Solidity function ${functionPrefix}`)
}

function maskSolidityCommentsAndStrings(source: string): string {
	const characters = source.split('')
	let blockComment = false
	let lineComment = false
	let quote: '"' | "'" | undefined
	for (let index = 0; index < characters.length; index++) {
		const character = characters[index]
		const nextCharacter = characters[index + 1]
		if (lineComment) {
			if (character === '\n') lineComment = false
			else characters[index] = ' '
			continue
		}
		if (blockComment) {
			if (character === '*' && nextCharacter === '/') {
				characters[index] = ' '
				characters[index + 1] = ' '
				blockComment = false
				index++
			} else if (character !== '\n') {
				characters[index] = ' '
			}
			continue
		}
		if (quote !== undefined) {
			characters[index] = character === '\n' ? '\n' : ' '
			if (character === '\\') {
				if (nextCharacter !== undefined) characters[index + 1] = ' '
				index++
			} else if (character === quote) {
				quote = undefined
			}
			continue
		}
		if (character === '/' && nextCharacter === '/') {
			characters[index] = ' '
			characters[index + 1] = ' '
			lineComment = true
			index++
			continue
		}
		if (character === '/' && nextCharacter === '*') {
			characters[index] = ' '
			characters[index + 1] = ' '
			blockComment = true
			index++
			continue
		}
		if (character === '"' || character === "'") {
			characters[index] = ' '
			quote = character
		}
	}
	return characters.join('')
}

function assertCallOrder(functionBody: string, firstCall: string, secondCall: string, message: string): void {
	const firstIndex = functionBody.indexOf(firstCall)
	const secondIndex = functionBody.indexOf(secondCall)
	assert.notEqual(firstIndex, -1, `${message}: missing ${firstCall}`)
	assert.notEqual(secondIndex, -1, `${message}: missing ${secondCall}`)
	assert.ok(firstIndex < secondIndex, message)
}

function assertSolidityFunctionReader(): void {
	const fixtureBody = readSolidityFunctionBody(
		`function fixture() /* { secondCall(); } */ {
			firstCall();
			string memory ignored = "secondCall(); }";
			// secondCall();
			secondCall();
		}`,
		'function fixture(',
	)
	assertCallOrder(fixtureBody, 'firstCall()', 'secondCall()', 'fixture calls must retain source order')

	const commentedCallBody = readSolidityFunctionBody(
		`function fixture() {
			firstCall();
			// secondCall();
			string memory ignored = "secondCall()";
		}`,
		'function fixture(',
	)
	assert.throws(() => assertCallOrder(commentedCallBody, 'firstCall()', 'secondCall()', 'commented calls must not satisfy order checks'))
}
