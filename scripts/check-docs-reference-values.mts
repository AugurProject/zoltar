import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { diagramGraphSpecs } from '../docs/charts/diagramModels'
import type { DiagramGraphNode } from '../docs/charts/diagramTypes'
import { getMainnetProtocolConfig } from '../shared/ts/protocolConfig'
import { htmlToDocumentationText } from './docs-html-text.mts'

const normalizeHtmlSource = (source: string): string => source.replaceAll(/<\/([a-z][\w:-]*)\s+>/gi, '</$1>')
const auctionDesign = normalizeHtmlSource(await readFile('docs/explanation/truth-auctions.html', 'utf8'))
const html = normalizeHtmlSource(await readFile('docs/explanation/escalation-game.html', 'utf8'))
const invariantsHtml = normalizeHtmlSource(await readFile('docs/reference/invariants.html', 'utf8'))
const liquidationHtml = normalizeHtmlSource(await readFile('docs/explanation/liquidations.html', 'utf8'))
const openOracleIntegration = normalizeHtmlSource(await readFile('docs/explanation/open-oracle.html', 'utf8'))
const zoltarWhitepaper = normalizeHtmlSource(await readFile('docs/explanation/zoltar.html', 'utf8'))
const whitepaperStatoblast = normalizeHtmlSource(await readFile('docs/explanation/statoblast.html', 'utf8'))
const diagramModelsSource = await readFile('docs/charts/diagramModels.ts', 'utf8')
const coordinatorData = await readFile('docs/data/open-oracle-coordinator.json', 'utf8')
const compiledContractArtifacts: unknown = JSON.parse(await readFile('solidity/artifacts/Contracts.json', 'utf8'))
const startHere = normalizeHtmlSource(await readFile('docs/documentation.html', 'utf8'))
const operatorReference = htmlToDocumentationText(await readFile('docs/reference/operator-guardrails.html', 'utf8'))
const securityModel = await readFile('docs/reference/security-model.html', 'utf8')
const contractInteractionReference = htmlToDocumentationText(await readFile('docs/reference/contracts.html', 'utf8'))
const contractReferenceGenerator = `${await readFile('scripts/generate-contract-interaction-reference.mts', 'utf8')}\n${await readFile('scripts/contract-reference-metadata.mts', 'utf8')}`
const deploymentStatus = normalizeHtmlSource(await readFile('docs/reference/deployment-status.html', 'utf8'))
const escalationGame = await readFile('solidity/contracts/statoblast/EscalationGame.sol', 'utf8')
const escalationGameClaimDelegate = await readFile('solidity/contracts/statoblast/EscalationGameClaimDelegate.sol', 'utf8')
const escalationGameDepositDelegate = await readFile('solidity/contracts/statoblast/EscalationGameDepositDelegate.sol', 'utf8')
const escalationGameCarry = await readFile('solidity/contracts/statoblast/EscalationGameCarry.sol', 'utf8')
const escalationGameState = await readFile('solidity/contracts/statoblast/EscalationGameState.sol', 'utf8')
const escalationGameTypes = await readFile('solidity/contracts/statoblast/EscalationGameTypes.sol', 'utf8')
const escalationGameForker = await readFile('solidity/contracts/statoblast/EscalationGameForker.sol', 'utf8')
const escalationGameCalculations = await readFile('solidity/contracts/statoblast/EscalationGameCalculations.sol', 'utf8')
const escalationGameSettlement = await readFile('solidity/contracts/statoblast/EscalationGameSettlement.sol', 'utf8')
const escalationGameEscrow = await readFile('solidity/contracts/statoblast/EscalationGameEscrow.sol', 'utf8')
const escalationGameFactory = await readFile('solidity/contracts/statoblast/factories/EscalationGameFactory.sol', 'utf8')
const priceCoordinator = await readFile('solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol', 'utf8')
const liquidationApprovalRegistry = await readFile('solidity/contracts/statoblast/LiquidationApprovalRegistry.sol', 'utf8')
const openOracleSource = await readFile('solidity/contracts/statoblast/openOracle/OpenOracle.sol', 'utf8')
const openOracleProvenance = await readFile('solidity/contracts/statoblast/openOracle/UPSTREAM.md', 'utf8')
const securityPool = await readFile('solidity/contracts/statoblast/SecurityPool.sol', 'utf8')
const securityPoolLiquidationDelegate = await readFile('solidity/contracts/statoblast/SecurityPoolLiquidationDelegate.sol', 'utf8')
const securityPoolDeployer = await readFile('solidity/contracts/statoblast/factories/SecurityPoolDeployer.sol', 'utf8')
const securityPoolFactory = await readFile('solidity/contracts/statoblast/factories/SecurityPoolFactory.sol', 'utf8')
const priceCoordinatorFactory = await readFile('solidity/contracts/statoblast/factories/PriceOracleManagerAndOperatorQueuerFactory.sol', 'utf8')
const shareTokenFactory = await readFile('solidity/contracts/statoblast/factories/ShareTokenFactory.sol', 'utf8')
const truthAuctionFactory = await readFile('solidity/contracts/statoblast/factories/UniformPriceDualCapBatchAuctionFactory.sol', 'utf8')
const securityPoolInterface = await readFile('solidity/contracts/statoblast/interfaces/ISecurityPool.sol', 'utf8')
const securityPoolForker = await readFile('solidity/contracts/statoblast/SecurityPoolForker.sol', 'utf8')
const securityPoolForkerAuctionSettlementBase = await readFile('solidity/contracts/statoblast/SecurityPoolForkerAuctionSettlementBase.sol', 'utf8')
const securityPoolForkerBase = await readFile('solidity/contracts/statoblast/SecurityPoolForkerBase.sol', 'utf8')
const securityPoolForkerVaultMigrationBase = await readFile('solidity/contracts/statoblast/SecurityPoolForkerVaultMigrationBase.sol', 'utf8')
const securityPoolForkerVaultMigrationDelegate = await readFile('solidity/contracts/statoblast/SecurityPoolForkerVaultMigrationDelegate.sol', 'utf8')
const securityPoolEventEmitter = await readFile('solidity/contracts/statoblast/SecurityPoolEventEmitter.sol', 'utf8')
const securityPoolUtils = await readFile('solidity/contracts/statoblast/SecurityPoolUtils.sol', 'utf8')
const erc1155 = await readFile('solidity/contracts/statoblast/tokens/ERC1155.sol', 'utf8')
const reputationToken = await readFile('solidity/contracts/ReputationToken.sol', 'utf8')
const shareToken = await readFile('solidity/contracts/statoblast/tokens/ShareToken.sol', 'utf8')
const truthAuction = await readFile('solidity/contracts/statoblast/UniformPriceDualCapBatchAuction.sol', 'utf8')
const truthAuctionStorage = await readFile('solidity/contracts/statoblast/UniformPriceDualCapBatchAuctionStorage.sol', 'utf8')
const truthAuctionInterface = await readFile('solidity/contracts/statoblast/interfaces/IUniformPriceDualCapBatchAuction.sol', 'utf8')
const zoltar = await readFile('solidity/contracts/Zoltar.sol', 'utf8')
const constants = await readFile('solidity/contracts/Constants.sol', 'utf8')
const sepoliaRepAllocations = await readFile('shared/ts/sepoliaRepAllocations.ts', 'utf8')
const escalationGameForkThresholdTest = await readFile('solidity/ts/tests/escalationGameForkThreshold.test.ts', 'utf8')
const escalationGameBytecodeSnapshot = await readFile('solidity/ts/tests/fixtures/escalationGameBytecode.snapshot.json', 'utf8')

assertEscalationContinuationOverview()
assertDisputeStakedReplayIdentityDocs()
assertAggregateEscalationContinuationDocs()
assertNonDecisionLifecycleDocs()
assertAuditFindingRemediations()
assertInvariantCatalogOwnership()
assertInvariantCatalogLifecycleBoundaries()
assertZoltarForkDepths()
assertRecursiveForkGasStatusDocs()
assertCoordinatorRecoveryBranch()
assertCoordinatorSettlementEconomics()
assertOpenOracleVendorAndEventDocs()
assertTruthAuctionCombinedRepCapDocs()
assertMigrationSecurityCoverageCommitmentDocs()
assertRepricingBoundaryDocs()
assertLazyClaimCommitmentDocs()
assertEscalationGameBytecodeDocs()
assertLifecycleReferences()
assertContractInteractionDistinctions()
assertSolidityFunctionReader()
await assertProductionSolidityInventory()

function assertEscalationContinuationOverview(): void {
	assert.match(html, /<h3>Escalation game continuation<\/h3>/)
	assert.match(html, /fork escalation games\. This is called continuation\./)
	assert.match(html, /Merkle Mountain Range carry proofs<\/a> and nullifier roots/)
}

function assertDisputeStakedReplayIdentityDocs(): void {
	const replayIdentityFunction = securityPoolForkerBase.match(/function _getEscalationDepositId\([^}]+?\n\t\}/s)?.[0]
	assert.ok(replayIdentityFunction, 'SecurityPoolForkerBase.sol must define _getEscalationDepositId')
	assert.match(replayIdentityFunction, /ISecurityPoolFactory factory = securityPool\.securityPoolFactory\(\);/)
	assert.match(replayIdentityFunction, /bytes32 originId = factory\.getSecurityPoolOriginId\(securityPool\);/)
	assert.match(replayIdentityFunction, /keccak256\(abi\.encode\(factory, originId, outcomeIndex, parentDepositIndex\)\)/)
}

function assertTruthAuctionCombinedRepCapDocs(): void {
	assert.match(
		securityPoolForker,
		/uint256 combinedAuctionableAttoRep = poolAuctionableRepAtForkAttoRep \+ disputeStakedAttoRep;[\s\S]*uint256 migratedPoolRepRetentionAttoRep = Math\.ceilDiv\(data\.migratedAttoRep, SecurityPoolUtils\.MAX_AUCTION_VAULT_HAIRCUT_DIVISOR\);[\s\S]*Math\.mulDiv\(migratedPoolRepRetentionAttoRep, combinedAuctionableAttoRep, poolAuctionableRepAtForkAttoRep, Math\.Rounding\.Ceil\);[\s\S]*if \(combinedRepRetentionAttoRep >= combinedAuctionableAttoRep\) return 0;[\s\S]*uint256 cap = combinedAuctionableAttoRep - combinedRepRetentionAttoRep;/,
	)
}

function assertMigrationSecurityCoverageCommitmentDocs(): void {
	assert.match(securityPoolUtils, /function calculateMintingCapacityAttoEth\([\s\S]*Math\.mulDiv\(capacityOwnershipAttoRep, PRICE_PRECISION, repEthPrice\)[\s\S]*Math\.mulDiv\(capacityValueAttoEth, BPS_DENOMINATOR, securityMultiplierBps\)/)
	const calculateCapacity = (capacityOwnershipAttoRep: bigint, repPerEth: bigint, securityMultiplierBps: bigint) => ((capacityOwnershipAttoRep * 10n ** 18n) / repPerEth / securityMultiplierBps) * 10_000n
	assert.ok(calculateCapacity(100n * 10n ** 18n, 4n * 10n ** 18n, 20_000n) < calculateCapacity(100n * 10n ** 18n, 2n * 10n ** 18n, 20_000n), 'A higher REP-per-ETH quote must lower live ETH minting capacity')
	assert.match(whitepaperStatoblast, /id="dynamic-capacity"/)
	assert.match(securityPool, /uint256 capacityOwnershipAddedAttoRep = Math\.mulDiv\(\s*attoRepAmount,\s*SecurityPoolUtils\.BPS_DENOMINATOR,\s*targetHealthFactorBps\s*\)/)
	assert.equal((11n * 10_000n) / 30_000n, 3n, 'capacity ownership must round a nonzero remainder downward')
	assert.equal((1n * 10_000n) / 10_001n, 0n, 'an extreme deposit target factor may round capacity ownership to zero')
	assert.match(securityPoolUtils, /function isVaultHealthyAtFactor\([\s\S]*Math\.Rounding\.Ceil[\s\S]*poolHeldVaultRepBackingAttoRep \+ disputeStakedAttoRep < associatedRequiredRepAttoRep[\s\S]*return poolHeldVaultRepBackingAttoRep >= freeRequiredRepAttoRep/)
	assert.match(liquidationHtml, /id="capacity-and-health"/)
	assert.doesNotMatch(securityPoolUtils, /function calculateLiquidationTransfer\(/, 'the obsolete bonus-priced liquidation preview must not remain externally callable')
	const externalPureFunctions = [...securityPoolUtils.matchAll(/function\s+(\w+)\([^{}]*?\)\s+external\s+pure/g)].map(match => match[1])
	assert.deepEqual(
		externalPureFunctions,
		['calculateFeeAccrual', 'calculateVaultFee', 'calculateMintingCapacityAttoEth', 'calculateVaultOpenInterestAttoEth', 'calculateBundledLiquidationTransfer', 'isVaultHealthy', 'calculateRetentionRate'],
		'SecurityPoolUtils external pure surface changed; document every preview and reject obsolete selectors',
	)
	for (const functionName of externalPureFunctions) {
		assert.ok(operatorReference.includes(`${functionName}(`), `operator reference must document SecurityPoolUtils.${functionName}`)
	}
	assert.match(priceCoordinator, /enum OperationType \{\s*Liquidation,\s*WithdrawRep\s*\}/)
	assert.match(coordinatorData, /"OperationType": \{ "0": "Liquidation", "1": "WithdrawRep" \}/)
	assert.doesNotMatch(coordinatorData, /StagedOperationDisputeStakedRepSnapshotted|initiatorVault/)
	assert.doesNotMatch(priceCoordinator, /event PendingOperationRecoveryConsumed/)
	assert.match(coordinatorData, /LiquidationRouteStaged\(uint256 indexed operationId, address indexed operator, address indexed receiverVault, address targetVault, bytes32 approvalId, uint256 requestedDebtAttoEth, uint256 reservedDebtAttoEth\)/)
	assert.match(coordinatorData, /"trigger": "requestPriceIfNeededAndStageLiquidation",\s*"preconditions": \["stale-cache", "pending-report", "pending callback batch is full"\],[\s\S]*?"the liquidation remains active outside the bounded callback batch"/)
	assert.match(coordinatorData, /"trigger": "executeStagedOperation",\s*"preconditions": \["operation exists", "operation is expired", "cache may be stale"\],[\s\S]*?"operation is consumed without requiring a valid price"/)
	assert.match(priceCoordinator, /event LiquidationRouteStaged\([\s\S]*address indexed operator,[\s\S]*address indexed receiverVault,[\s\S]*uint256 reservedDebtAttoEth[\s\S]*\);/)
	assert.match(contractInteractionReference, /LiquidationApprovalRegistry[\s\S]*permitLiquidationApproval\(params, signature\)[\s\S]*revokeLiquidationApproval\(approvalId\)[\s\S]*invalidateLiquidationApprovalNonce\(newNonce\)[\s\S]*reserve\(operationId/)
	assert.match(liquidationApprovalRegistry, /EIP712Domain\(string name,string version,uint256 chainId,address verifyingContract\)/)
	assert.match(contractInteractionReference, /exactly `max\(1 REP, theoretical REP supply \/ 10,000,000\)`[\s\S]*zero configured vault REP floor[\s\S]*theoretical REP supply \/ 100,000[\s\S]*nonzero constructor value is the exact override[\s\S]*security-bond debt floor defaults to 1 ETH/)
	assert.doesNotMatch(contractInteractionReference, /max\(1 REP, configured floor, theoretical REP supply \/ 10,000,000\)/)
	assert.match(operatorReference, /effective escalation deposit is exactly `max\(1 REP, theoretical REP supply \/ 10,000,000\)`/)
	assert.doesNotMatch(operatorReference, /max\(1 REP, configured floor, theoretical REP supply \/ 10,000,000\)/)
	assert.match(operatorReference, /funded REP-backing-unit, capacity-ownership, receiver-debt, and full-request bad-debt liquidation accounting/)
	assert.doesNotMatch(operatorReference, /backing-only liquidation/)
	assert.match(
		securityPoolLiquidationDelegate,
		/receiverOpenInterestAttoEth < minimumSecurityBondDebtAttoEth[\s\S]*targetOpenInterestAttoEthAfter == 0 \|\| targetOpenInterestAttoEthAfter >= minimumSecurityBondDebtAttoEth[\s\S]*targetOpenInterestAttoEthAfter == 0 \|\| targetVaultRepBackingAfterAttoRep >= minimumVaultRepDepositAttoRep[\s\S]*securityVaults\[request\.receiverVault\][\s\S]*minimumVaultRepDepositAttoRep/,
	)
	assert.match(
		securityPoolLiquidationDelegate,
		/debtToMoveAttoEth = receiverOpenInterestAfterAttoEth - receiverOpenInterestBeforeAttoEth;[\s\S]*debtToMoveAttoEth <= nominalDebtToMoveAttoEth && debtToMoveAttoEth <= request\.requestedDebtAttoEth[\s\S]*nominalDebtToMoveAttoEth != 0 && debtToMoveAttoEth == 0[\s\S]*badDebtAttoEth = targetOpenInterestAttoEth - debtToMoveAttoEth/,
	)
	assertCoordinatorDataFunctionInventory()
}

function assertRepricingBoundaryDocs(): void {
	assert.match(invariantsHtml, /id="bal-03"/)
	assert.match(invariantsHtml, /id="vault-02"/)
	assert.match(securityPool, /function createCompleteSet\([\s\S]*uint256 nextSettlementCollateralAttoEth = settlementCollateralAttoEth \+ msg\.value;[\s\S]*_requireCapacityNotExceeded\(nextSettlementCollateralAttoEth\)/)
	assert.match(securityPool, /function getCurrentMintingCapacityAttoEth\(\)[\s\S]*SecurityPoolUtils\.calculateMintingCapacityAttoEth\(\s*totalCapacityOwnershipAttoRep,/)
	const vaultOpenInterestBody = readSolidityFunctionBody(securityPool, 'function getVaultOpenInterestAttoEth(')
	assert.match(vaultOpenInterestBody, /SecurityPoolUtils\.calculateVaultOpenInterestAttoEth\([\s\S]*totalCapacityOwnershipAttoRep/)
	assert.doesNotMatch(vaultOpenInterestBody, /feeEligibleCapacityOwnershipAttoRep/)
	assert.match(securityPoolLiquidationDelegate, /SecurityPoolUtils\.isVaultHealthyAtFactor\([\s\S]*minimumReceiverHealthFactorBps/)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function assertCoordinatorDataFunctionInventory(): void {
	const coordinatorIndex: unknown = JSON.parse(coordinatorData)
	assert.ok(isRecord(coordinatorIndex))
	const documentedFunctions = coordinatorIndex['functions']
	assert.ok(isRecord(documentedFunctions), 'Coordinator data must provide its complete function inventory')
	assert.ok(isRecord(compiledContractArtifacts))
	const contracts = compiledContractArtifacts['contracts']
	assert.ok(isRecord(contracts))
	const coordinatorSource = contracts['contracts/statoblast/OpenOraclePriceCoordinator.sol']
	assert.ok(isRecord(coordinatorSource))
	const coordinatorArtifact = coordinatorSource['OpenOraclePriceCoordinator']
	assert.ok(isRecord(coordinatorArtifact))
	const abi = coordinatorArtifact['abi']
	assert.ok(Array.isArray(abi))
	const compiledFunctionNames = Array.from(
		new Set(
			abi.flatMap(entry => {
				if (!isRecord(entry) || entry['type'] !== 'function' || typeof entry['name'] !== 'string') return []
				return [entry['name']]
			}),
		),
	).sort()
	assert.deepEqual(Object.keys(documentedFunctions).sort(), compiledFunctionNames, 'Coordinator data function inventory must exactly match the compiled ABI')
}

function assertLazyClaimCommitmentDocs(): void {
	assert.doesNotMatch(escalationGameTypes, /MAX_CLAIM_BUNDLES_PER_VAULT|MAX_CLAIM_OWNERS_PER_BUNDLE|MAX_PAYOUT_CLAIM_IMPORT_BATCH/)
	assert.match(liquidationHtml, /id="fig-liquidation-punitive-flow"/)
	assert.doesNotMatch(liquidationHtml, /claim move|portfolio cap|owner slot/i)
	assert.doesNotMatch(escalationGameClaimDelegate, /moveEscalationClaim|payoutClaimBundle|getClaimOwner|liquidationClaimRep/)
	assert.doesNotMatch(escalationGameEscrow, /Escrow principal missing/)
	assert.match(
		escalationGameClaimDelegate,
		/retainedCumulativeAmountAttoRep = IEscalationClaimCheckpointSource\(sourceGame\)[\s\S]*\.applyInheritedClaimRetention\(cumulativeAmountAttoRep, parentDepositIndex\);[\s\S]*retainedPreviousAmountAttoRep = IEscalationClaimCheckpointSource\(sourceGame\)[\s\S]*\.applyInheritedClaimRetention\(cumulativeAmountAttoRep - amountAttoRep, parentDepositIndex\);[\s\S]*return retainedCumulativeAmountAttoRep - retainedPreviousAmountAttoRep/,
	)
	for (const staleOwnershipPhrase of ['current liquidation owners', 'liquidation moved half the claim', 'current-owner shares', 'payout ownership copied', '64-key global cap', 'eight batches']) {
		for (const document of [invariantsHtml, whitepaperStatoblast, operatorReference, diagramModelsSource]) assert.ok(!document.includes(staleOwnershipPhrase), `obsolete claim ownership/import text remains: ${staleOwnershipPhrase}`)
	}
	assert.doesNotMatch(operatorReference, /leaves owner import to permissionless/)
	assert.match(invariantsHtml, /Bob may relay Alice's valid winning proof[\s\S]*payout still goes entirely to Alice as the committed depositor/)
}

function assertEscalationGameBytecodeDocs(): void {
	const creationBytes = escalationGameBytecodeSnapshot.match(/"creationBytes":\s*(\d+)/)?.[1]
	const deployedBytes = escalationGameBytecodeSnapshot.match(/"deployedBytes":\s*(\d+)/)?.[1]
	assert.ok(creationBytes, 'EscalationGame bytecode snapshot must record creationBytes')
	assert.ok(deployedBytes, 'EscalationGame bytecode snapshot must record deployedBytes')
}

function assertAggregateEscalationContinuationDocs(): void {
	const normalizedStatoblast = whitepaperStatoblast.replaceAll(/\s+/g, ' ')
	const normalizedOperatorReference = operatorReference.replaceAll(/\s+/g, ' ')
	const normalizedContractReference = contractInteractionReference.replaceAll(/\s+/g, ' ')
	const normalizedZoltarWhitepaper = zoltarWhitepaper.replaceAll(/\s+/g, ' ')
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	assert.match(escalationGameCarry, /forkCarryDisputeStakedAttoRep/, 'continuation implementation must retain an aggregate dispute-staked REP backing bucket')
	assert.match(normalizedInvariants, /Continuation backing is not assigned to child-vault health or migration power/)
	for (const [documentName, contents] of [['Operator reference', normalizedOperatorReference]] as const) {
		for (const documentedClaim of ['aggregate backing', 'winning proof', 'committed depositor', 'inherited losers', 'parent escalation-deposit accounting', 'optional']) {
			assert.ok(contents.toLowerCase().includes(documentedClaim), `${documentName} must explain aggregate winner-only continuation semantics: ${documentedClaim}`)
		}
	}
	for (const documentedClaim of ['uncredited haircut', 'forkBurnDivisor']) {
		assert.ok(normalizedZoltarWhitepaper.includes(documentedClaim), `Zoltar whitepaper must document fork admission economics: ${documentedClaim}`)
		assert.ok(normalizedContractReference.includes(documentedClaim), `Contract interaction reference must document fork admission economics: ${documentedClaim}`)
	}
	for (const forbiddenClaim of ['vaultEscrowChildRep', 'forked-escrow-scaling', 'forked-escrow-example', 'only selected vault escrow authorizes inherited proofs', 'vault migration grants only logical authorization', 'only materialized vault escrow authorizes proofs']) {
		assert.ok(!normalizedStatoblast.includes(forbiddenClaim), `Statoblast whitepaper retains obsolete per-vault continuation claim: ${forbiddenClaim}`)
	}
	assert.match(normalizedContractReference, /cleanup neither funds dispute-staked REP backing nor authorizes carried proofs/)
	assert.match(normalizedOperatorReference, /Child creation installs the canonical carry commitment, retention checkpoint, and aggregate backing without waiting for vault transactions or copying claims and owners/)
	assert.match(normalizedOperatorReference, /resumeFromFork` remains paused until that backing is present after accounting for child REP already exported by valid direct pre-resume claims/)
	assert.match(normalizedInvariants, /continuation cannot resume until its game balance covers/)
	assert.match(normalizedInvariants, /id="fork-08"/)
	assert.match(normalizedInvariants, /sourcePrincipalAtForkAttoRep - ⌊sourcePrincipalAtForkAttoRep \/ 5⌋/)
	assert.match(normalizedContractReference, /resumeFromFork\(\)[\s\S]*sourcePrincipalAtForkAttoRep - ⌊sourcePrincipalAtForkAttoRep \/ 5⌋/)
	assert.match(normalizedContractReference, /sourcePrincipalAtForkAttoRep` is the aggregate raw unresolved principal installed by the snapshot before effective direct-claim deductions/)
	assert.match(normalizedContractReference, /live balance must cover that initial backing minus child REP already exported by valid direct pre-resume claims/)
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
	assert.match(securityPoolForker, /function getQuestionOutcome\([\s\S]*if \(data\.fixedQuestionOutcomePlusOne > 0\)[\s\S]*return BinaryOutcomes\.BinaryOutcome\(data\.fixedQuestionOutcomePlusOne - 1\)/)
	assert.match(escalationGameCalculations, /function getFinalQuestionResolution\(\)[\s\S]*if \(block\.timestamp <= getEscalationGameEndDate\(\)\) return BinaryOutcomes\.BinaryOutcome\.None/)
	assert.match(
		normalizedInvariants,
		/<summary><code>ESC-12<\/code><span class="invariant-title">Pool and continuation payout agreement<\/span><\/summary>[\s\S]*Once a pool inherits that fixed outcome, new local escalation deposits and every later fork transition revert[\s\S]*rejects new local dispute-staked REP before escrow[\s\S]*eligible share, vault REP, and carried-proof redemption paths remain available/,
	)
	assert.match(normalizedOperatorReference, /Escalation deposit wrapper[\s\S]*rejects pools with an inherited fixed outcome because they cannot enter another fork or safely unwind a later local non-decision/)
	assert.match(normalizedOperatorReference, /Matching-question child outcome[\s\S]*`depositToEscalationGame` rejects new local deposits, and `activateForkMode` rejects every later pool fork transition[\s\S]*Child Outcome Resolution/)
	for (const forbiddenClaim of ['a later fork on the same question replaces the inherited outcome', 'the fixed result applies after continuation and is inherited through later unrelated descendants', 'a later unrelated fork keeps Yes as the payout outcome']) {
		assert.ok(!`${normalizedStatoblast} ${normalizedInvariants} ${normalizedOperatorReference}`.toLowerCase().includes(forbiddenClaim.toLowerCase()), `Fixed-outcome documentation retains obsolete replacement or descendant-inheritance semantics: ${forbiddenClaim}`)
	}
}

function assertAuditFindingRemediations(): void {
	const normalizedStatoblast = whitepaperStatoblast.replaceAll(/\s+/g, ' ')
	const normalizedAuctionDesign = auctionDesign.replaceAll(/\s+/g, ' ')
	assert.match(normalizedStatoblast, /settlement-collateral migration weight[\s\S]*transferred capacity ownership determines the vault's live proportional open-interest allocation in the child/)
	assert.doesNotMatch(normalizedStatoblast, /vault's migrated OI share is its pool-held vault REP backing share/)
	assert.doesNotMatch(normalizedStatoblast, /Retention-rate updates also no-op when total coverage commitment is zero/, 'Statoblast whitepaper must not retain the obsolete total-coverage commitment zero-retention rule')
	assert.match(securityPool, /function updateRetentionRate\(\) public \{[\s\S]*SecurityPoolUtils\.calculateRetentionRate\([\s\S]*getCurrentMintingCapacityAttoEth\(\)/, 'SecurityPool retention updates must use live oracle-priced minting capacity')
	assert.match(securityPoolUtils, /if \(mintingCapacityAttoEth == 0\) return MAX_RETENTION_RATE;/, 'SecurityPoolUtils must select maximum retention for zero minting capacity')
	assert.match(escalationGameCalculations, /if \(forkTime > getEscalationGameEndDate\(\)\) \{[\s\S]*actualForkThresholdAttoRep = nonDecisionThresholdAttoRep;/, 'Escalation payout must restore the configured threshold only for forks strictly after the scheduled game end')
	assert.doesNotMatch(normalizedStatoblast, /later unrelated fork (?:cannot reprice|leaves (?:the )?finalized payout unchanged)/i, 'Statoblast must not claim that a strictly later fork leaves unclaimed winning payouts unchanged')
	for (const boundaryName of ['one second before', 'exactly at', 'one second after']) {
		assert.ok(escalationGameForkThresholdTest.includes(boundaryName), `Escalation fork-threshold regression must cover ${boundaryName} game end`)
	}
	assert.match(truthAuctionInterface, /event EthRefundDeferred\(address indexed bidder, uint256 amountAttoEth, uint256 pendingAmountAttoEth\);/, 'Truth-auction interface must declare the deferred-refund delta and resulting balance')
	assert.match(truthAuctionInterface, /event PendingEthRefundWithdrawn\(address indexed bidder, uint256 amountAttoEth\);/, 'Truth-auction interface must declare successful deferred-refund withdrawals')
	assert.match(truthAuction, /REFUND_PUSH_GAS_LIMIT = 30_000;/, 'Truth-auction push refunds must retain the documented explicit CALL gas argument')
	const normalizedRefundGasDocs = `${normalizedAuctionDesign} ${invariantsHtml} ${contractInteractionReference} ${contractReferenceGenerator}`.replaceAll(/<[^>]+>/g, '')
	assert.doesNotMatch(normalizedRefundGasDocs, /(?:at most|forwards at most|limited to) 30,000 gas/i, 'Refund documentation must not confuse the explicit CALL gas argument with the larger stipend-inclusive callback maximum')
	assert.match(
		securityPoolForker,
		/function _getTruthAuctionCap\([\s\S]*Math\.ceilDiv\(data\.migratedAttoRep, SecurityPoolUtils\.MAX_AUCTION_VAULT_HAIRCUT_DIVISOR\)[\s\S]*Math\.mulDiv\(migratedPoolRepRetentionAttoRep, combinedAuctionableAttoRep, poolAuctionableRepAtForkAttoRep, Math\.Rounding\.Ceil\)[\s\S]*function _finalizeBackingUnitsAfterAuction\([\s\S]*uint256 incumbentRepAfterAttoRep =[\s\S]*Math\.mulDiv\(poolRepBeforeAttoRep, combinedRepBeforeAttoRep - repPurchasedAttoRep, combinedRepBeforeAttoRep\)[\s\S]*if \(incumbentRepAfterAttoRep == 0\)[\s\S]*auctionRepBackingUnitsPerAttoRep = SecurityPoolUtils\.PRICE_PRECISION;[\s\S]*Math\.ceilDiv\(poolRepAfterAttoRep, incumbentRepAfterAttoRep\)/,
		'Truth-auction REP backing units must reserve positive migrated claims and use bounded child-local scaling',
	)
	assert.doesNotMatch(normalizedAuctionDesign, /(?:all the REP in the vaults have been auctioned off|old REP vault holders have been wiped)/i, 'Truth Auction must not claim that every underfunded auction sells all REP or wipes prior vault holders')
	assert.match(contractReferenceGenerator, /settleAuctionBids[\s\S]*EthRefundDeferred[\s\S]*claimAuctionProceeds[\s\S]*EthRefundDeferred/, 'Generated public wrapper rows must expose possible deferred-refund signals')
}

function assertInvariantCatalogOwnership(): void {
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	const persistentHistoryEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-10"\s*>[\s\S]*?<\/details>/)?.[0]
	const activeTreeEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-11"\s*>[\s\S]*?<\/details>/)?.[0]
	const claimOrderEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-04"\s*>[\s\S]*?<\/details>/)?.[0]
	const carryAccountingEntry = normalizedInvariants.match(/<details class="invariant-entry" id="esc-03"\s*>[\s\S]*?<\/details>/)?.[0]
	const carryCommitmentEntry = normalizedInvariants.match(/<details class="invariant-entry" id="esc-14"\s*>[\s\S]*?<\/details>/)?.[0]
	const auctionAllocationEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-05"\s*>[\s\S]*?<\/details>/)?.[0]
	const auctionLiabilityEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-12"\s*>[\s\S]*?<\/details>/)?.[0]
	const eventReplayEntry = normalizedInvariants.match(/<details class="invariant-entry" id="obs-01"\s*>[\s\S]*?<\/details>/)?.[0]
	const shareSupplyEntry = normalizedInvariants.match(/<details class="invariant-entry" id="share-06"\s*>[\s\S]*?<\/details>/)?.[0]
	assert.ok(persistentHistoryEntry, 'Invariant catalog must give AUC-10 a stable anchor for persistent tick history')
	assert.ok(activeTreeEntry, 'Invariant catalog must retain AUC-11 for active-tree and public-model equivalence')
	assert.ok(claimOrderEntry, 'Invariant catalog must retain AUC-04 for claim-order independence')
	assert.ok(carryAccountingEntry, 'Invariant catalog must give ESC-03 a stable anchor for carry accounting')
	assert.ok(carryCommitmentEntry, 'Invariant catalog must retain ESC-14 for carry commitment structure')
	assert.ok(auctionAllocationEntry, 'Invariant catalog must give AUC-05 a stable anchor for allocation accounting')
	assert.ok(auctionLiabilityEntry, 'Invariant catalog must retain AUC-12 for raw ETH liability accounting')
	assert.ok(eventReplayEntry, 'Invariant catalog must retain OBS-01 for event-state replay equivalence')
	assert.ok(shareSupplyEntry, 'Invariant catalog must retain SHARE-06 for aggregate ERC-1155 supply conservation')
	assert.match(persistentHistoryEntry, /Bid cumulative ETH remains append-only[\s\S]*Refunded history is subtracted exactly once/)
	assert.match(persistentHistoryEntry, /UniformPriceDualCapBatchAuction\.sol[\s\S]*_appendBid[\s\S]*UniformPriceDualCapBatchAuctionStorage\.sol[\s\S]*refund-prefix accounting/)
	assert.match(claimOrderEntry, /UniformPriceDualCapBatchAuctionStorage\.sol[\s\S]*allocateFromCumulativePosition/)
	assert.match(activeTreeEntry, /href="#auc-10"><code>AUC-10<\/code><\/a>/, 'AUC-11 must link historical-prefix ownership to AUC-10')
	assert.match(activeTreeEntry, /UniformPriceDualCapBatchAuctionStorage\.sol[\s\S]*AVL tree and clearing[\s\S]*UniformPriceDualCapBatchAuction\.sol[\s\S]*enumeration and auction integration/)
	assert.doesNotMatch(activeTreeEntry, /Historical tick pages preserve|active bid prefixes subtract every prior refund/, 'AUC-11 must not duplicate AUC-10 historical-prefix requirements')
	assert.match(carryCommitmentEntry, /href="#esc-03"><code>ESC-03<\/code><\/a>/, 'ESC-14 must link unresolved-total ownership to ESC-03')
	assert.doesNotMatch(carryCommitmentEntry, /unresolved total equals inherited plus local principal/, 'ESC-14 must not duplicate ESC-03 carry-accounting requirements')
	assert.match(auctionLiabilityEntry, /href="#auc-05"><code>AUC-05<\/code><\/a>/, 'AUC-12 must link settlement-allocation ownership to AUC-05')
	assert.doesNotMatch(auctionLiabilityEntry, /each bid partitions exactly|aggregate filled REP equals/, 'AUC-12 must not duplicate AUC-05 settlement-allocation requirements')
	assert.match(eventReplayEntry, /href="\.\/contracts\.html"/, 'OBS-01 must link the canonical contract interaction reference')
	assert.match(shareSupplyEntry, /total supply equals the sum of holder balances[\s\S]*href="#fork-10"><code>FORK-10<\/code><\/a>/, 'SHARE-06 must own aggregate supply conservation and link migration ownership to FORK-10')
	assert.doesNotMatch(shareSupplyEntry, /persistent source entitlement|materialized child amount equals|cannot be materialized twice/, 'SHARE-06 must not duplicate FORK-10 source-entitlement requirements')
}

function assertInvariantCatalogLifecycleBoundaries(): void {
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	const capacityOwnershipEntry = normalizedInvariants.match(/<details class="invariant-entry" id="bal-08"\s*>[\s\S]*?<\/details>/)?.[0]
	const vaultEntry = normalizedInvariants.match(/<details class="invariant-entry" id="vault-03"\s*>[\s\S]*?<\/details>/)?.[0]
	const activeAuctionEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-11"\s*>[\s\S]*?<\/details>/)?.[0]
	const auctionLiabilityEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-12"\s*>[\s\S]*?<\/details>/)?.[0]
	assert.ok(capacityOwnershipEntry, 'Invariant catalog must retain BAL-08 lifecycle-qualified capacity ownership accounting')
	assert.ok(vaultEntry, 'Invariant catalog must retain VAULT-03 append-only registry accounting')
	assert.ok(activeAuctionEntry, 'Invariant catalog must retain AUC-11 lifecycle-qualified clearing-tree accounting')
	assert.ok(auctionLiabilityEntry, 'Invariant catalog must retain AUC-12 ETH liability accounting')
	assert.match(capacityOwnershipEntry, /In <code>Operational<\/code>[\s\S]*During <code>ForkMigration<\/code>[\s\S]*A <code>PoolForked<\/code> parent retains its fork-time[\s\S]*positive-purchase truth-auction[\s\S]*purchases zero REP[\s\S]*href="\.\.\/explanation\/truth-auctions\.html#clearing"/)
	assert.match(vaultEntry, /href="\.\.\/\.\.\/solidity\/contracts\/statoblast\/SecurityPool\.sol"><code>_registerVault<\/code><\/a>/)
	assert.match(activeAuctionEntry, /Before finalization[\s\S]*pre-finalization refunds[\s\S]*Finalization freezes that tree and clearing result[\s\S]*href="#auc-12"><code>AUC-12<\/code><\/a>/)
	assert.match(auctionLiabilityEntry, /active unrefunded bids[\s\S]*aggregate <code>pendingEthRefundsAttoEth<\/code>[\s\S]*refunds still attached to unclaimed bids[\s\S]*deferred <code>pendingEthRefundsAttoEth<\/code>/)
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
	for (const documentedClaim of ['⌈4 × forkThresholdAttoRep / 5⌉', 'constructor rejects forkBurnDivisor &lt; 5', 'Later REP added to a migration balance converts 1:1', 'intended admission cost']) {
		assert.ok(normalizedWhitepaper.includes(documentedClaim), `Missing Zoltar fork haircut claim: ${documentedClaim}`)
	}
}

function assertRecursiveForkGasStatusDocs(): void {
	assert.match(invariantsHtml, /id="ext-05"[\s\S]*Recursive fork gas bound[\s\S]*Enforcement status<\/dt>\s*<dd>Reviewed preservation/)
	for (const [documentName, contents] of [['Operator reference', operatorReference]] as const) {
		assert.match(contents, /invariants\.html#ext-05/, `${documentName} must route recursive-fork gas status to EXT-05`)
		assert.doesNotMatch(
			contents,
			/open pre-deployment requirement|open recursive-depth requirement|must be bounded and validated before deployment|maximum supported recursive depth established under|there is no explicit maximum recursive fork depth|origin registration is keyed by origin id and universe|does not traverse(?:s)? the pool or universe ancestry|gas does not grow with recursive lineage depth/i,
			`${documentName} must not duplicate EXT-05 status or implementation evidence`,
		)
	}
}

function assertCoordinatorRecoveryBranch(): void {
	assert.match(openOracleIntegration, /<section id="callback-rejection-and-recovery">[\s\S]*<h2>Settlement validation, rejection, and recovery<\/h2>/)
	assert.match(openOracleIntegration, /failed callback does not automatically undo an otherwise valid OpenOracle settlement[\s\S]*coordinator remains pending/, 'OpenOracle documentation must explain the pending state after a failed low-level callback')
	assert.match(
		openOracleIntegration,
		/settlement base fee exceeds the request-time cap[\s\S]*storedGame\(reportId\)\.numReports[\s\S]*final history record's WETH amount is too small[\s\S]*Report uneconomic[\s\S]*either settled token amount is zero[\s\S]*integer REP\/ETH calculation produces a zero price/,
		'OpenOracle documentation must retain the current coordinator rejection conditions',
	)
	assert.match(openOracleIntegration, /rejected report does not replay its pending settlement operations[\s\S]*terminally fails every operation[\s\S]*releases any liquidation-approval reservation exactly once/, 'OpenOracle documentation must describe terminal operation and reservation cleanup after rejection')
	assert.match(
		openOracleIntegration,
		/anyone can call <code>recoverSettledPendingReport<\/code>[\s\S]*clears the pending report, sponsor, and base-fee cap[\s\S]*terminally fails every pending settlement operation[\s\S]*does not treat those operations as successful[\s\S]*reservation is released/,
		'OpenOracle documentation must describe settled-report recovery effects',
	)
	assert.match(
		priceCoordinator,
		/function recoverSettledPendingReport\(\)[\s\S]*require\(reportId != 0, 'No report to recover'\)[\s\S]*require\(settlementTimestamp != 0, 'Report not settled'\)[\s\S]*pendingReportId = 0;[\s\S]*pendingReportSponsor = address\(0\);[\s\S]*pendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;[\s\S]*_failPendingSettlementOperations\('Report recovered'\)/,
		'coordinator recovery must require settlement and clear pending state before failing every attached operation',
	)
	assert.match(priceCoordinator, /require\(msg\.sender == address\(openOracle\), 'Only OpenOracle'\)[\s\S]*require\(reportId == pendingReportId, 'Oracle report mismatch'\)/, 'coordinator callback must enforce the configured oracle and current pending report identity')
	assert.match(openOracleIntegration, /data-source="requestPriceCostAttoEth = block\.basefee \\cdot 4 \\cdot \(callbackGasLimit \+ gasConsumedOpenOracleReportPrice\) \+ 101"/, 'OpenOracle documentation must retain the canonical request-cost equation')
	const requestCostEquation = openOracleIntegration.match(/<figure class="equation" id="eq-openoracle-request-price-cost">[\s\S]*?<\/figure>/)?.[0]
	assert.ok(requestCostEquation, 'OpenOracle documentation must retain the request-cost equation figure')
	assert.match(requestCostEquation, /aria-label="request price cost in attoETH equals block base fee times 4 times callback gas limit plus gas consumed open oracle report price, plus 101 attoETH"/)
	assert.match(requestCostEquation, /<mi>requestPriceCostAttoEth<\/mi>[\s\S]*?<mi>block\.basefee<\/mi>[\s\S]*?<mn>4<\/mn>[\s\S]*?<mi>callbackGasLimit<\/mi>[\s\S]*?<mi>gasConsumedOpenOracleReportPrice<\/mi>[\s\S]*?<mn>101<\/mn>/)
	assert.match(
		priceCoordinator,
		/function getRequestPriceCostAttoEth\(\) public view returns \(uint256\) \{\s*return block\.basefee \* 4 \* \(getSettlementCallbackGasLimit\(\) \+ gasConsumedOpenOracleReportPrice\) \+ 101;/,
		'coordinator request-cost implementation must retain the documented factors and boundary offset',
	)
}

function assertCoordinatorSettlementEconomics(): void {
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
}

function assertOpenOracleVendorAndEventDocs(): void {
	assert.equal(createHash('sha256').update(openOracleSource).digest('hex'), 'dd48faa19839d443ffb272458051a14507cccc89faa5cec54786902cbd348b37', 'Vendored OpenOracle source changed; compare it with the pinned SlimStorage revision and update the source fingerprint')
	for (const pinnedRevision of ['a2d8515333b41fb2fb6f1f84663180ff4ceb5c7d', 'c64a1edb67b6e3f4a15cca8909c9482ad33a02b0', 'src/OpenOracleSlim.sol', 'OpenZeppelin Contracts v5.4.0']) {
		assert.ok(openOracleProvenance.includes(pinnedRevision), `OpenOracle provenance must retain ${pinnedRevision}`)
	}
	assert.match(liquidationHtml, /id="punitive-liquidation"/)
	assert.match(
		operatorReference,
		/calculateBundledLiquidationTransfer\(targetBackingUnits, targetCapacityOwnershipAttoRep, targetOpenInterestAttoEth, requestedDebtAttoEth, repEthPrice, currentPoolHeldAttoRepBalance, currentTotalRepBackingUnits, minimumRemainingAttoRep\)/,
		'operator reference must preserve the current liquidation utility signature and parameter order',
	)
	assert.doesNotMatch(whitepaperStatoblast, /id="fig-statoblast-auction-clearing"/, 'whitepaper must delegate auction clearing to the canonical focused diagram')
}

function assertLifecycleReferences(): void {
	assert.match(escalationGameState, /activationDelay = 3 days/)
	assert.match(escalationGameTypes, /ESCALATION_TIME_LENGTH = 4233600; \/\/ 7 weeks/)
	assert.match(securityPoolUtils, /MIGRATION_TIME = 8 weeks/)
	for (const systemState of ['Operational', 'PoolForked', 'ForkMigration', 'ForkTruthAuction']) {
		assert.match(securityPoolInterface, new RegExp(`\\b${systemState}\\b`))
	}
	assert.match(startHere, /explanation\/escalation-game\.html/)
	const lifecycle = diagramGraphSpecs['fig-statoblast-fork-state-machine']
	assert.ok(lifecycle, 'Statoblast lifecycle diagram model must exist')
	const lifecycleSection = lifecycle.sections[0]
	assert.ok(lifecycleSection, 'Statoblast lifecycle diagram must have a graph section')
	const lifecycleStates: ReadonlyArray<readonly [string, string, string]> = [
		['parent', 'Operational', 'parent pool'],
		['forked', 'PoolForked', 'parent halted'],
		['migration', 'ForkMigration', 'child pool'],
		['auction', 'ForkTruthAuction', 'repair phase'],
		['child', 'Operational', 'child activated'],
	]
	for (const [id, state, role] of lifecycleStates) {
		const lifecycleNode: DiagramGraphNode | undefined = lifecycleSection.nodes.find(candidate => candidate.id === id)
		assert.equal(lifecycleNode?.title, state, `Statoblast lifecycle must label ${role} ${state}`)
		assert.ok(lifecycleNode?.details?.includes(role), `Statoblast lifecycle ${state} must identify ${role}`)
	}
	for (const [source, target] of [
		['parent', 'forked'],
		['forked', 'migration'],
		['migration', 'auction'],
		['auction', 'child'],
	]) {
		assert.ok(
			lifecycleSection.edges.some(candidate => candidate.source === source && candidate.target === target),
			`Statoblast lifecycle must include ${source} -> ${target}`,
		)
	}
	assert.ok(!lifecycleSection.edges.some(candidate => candidate.source === 'migration' && candidate.target === 'child'), 'Statoblast lifecycle must pass through ForkTruthAuction before child operation')
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
	const performLiquidationRow = getContractInteractionRow('performLiquidation(request)')
	const claimDepositWithoutTransferRow = getContractInteractionRow('claimDepositForWinningWithoutTransfer(depositIndex, outcome)')
	const recordForkedEscrowRow = getContractInteractionRow('recordForkedEscrowForOutcome(depositor, outcome, sourcePrincipalAttoRep, childRepAmountAttoRep)')
	const startTruthAuctionRow = getContractInteractionRow('startTruthAuction(securityPool)')
	const finalizeTruthAuctionRow = getContractInteractionRow('finalizeTruthAuction(securityPool)')
	assert.match(contractReferenceGenerator, /interaction\.declarations\.length, 1,[\s\S]*interaction rows must describe exactly one entrypoint name; split materially different guards, effects, and signals into separate rows/, 'generated interaction rows must remain limited to one entrypoint name')
	assert.match(invariantsHtml, /<code>SHARE-04<\/code>[\s\S]*remaining economic claim[\s\S]*source entitlements/)
	assert.match(invariantsHtml, /id="fork-10"[\s\S]*<code>FORK-10<\/code>[\s\S]*mints only the unmaterialized balance/)
	assert.match(invariantsHtml, /id="fork-11"[\s\S]*<code>FORK-11<\/code>[\s\S]*fork-time economic claim supply[\s\S]*Unequal ERC-1155 supplies[\s\S]*do not block complete-set minting[\s\S]*href="#share-04"><code>SHARE-04<\/code>/)
	assert.match(operatorReference, /invariants\.html#fork-10[\s\S]*invariants\.html#share-04[\s\S]*invariants\.html#fork-11/)
	assert.match(invariantsHtml, /FORK-05[\s\S]*forkActivationTime \+ 8 weeks[\s\S]*parent pool enters <code>PoolForked<\/code>[\s\S]*Share materialization has no expiry[\s\S]*already-created child/)
	assert.doesNotMatch(invariantsHtml, /Child creation, share migration, vault migration/)
	assert.doesNotMatch(invariantsHtml, /forkTime \+ 8 weeks/)
	assert.doesNotMatch(auctionDesign, /8 weeks from the parent\s+universe fork time/)
	assert.match(whitepaperStatoblast, /source remains locked as an entitlement/)
	assert.doesNotMatch(whitepaperStatoblast, /Parent burned/)
	assert.match(contractInteractionReference, /single-target call may lazily create that child/)
	assert.match(contractInteractionReference, /every target in a multi-target call already has a canonical child pool/)
	assert.match(contractInteractionReference, /startTruthAuction\(securityPool\)[\s\S]*frozen parent's remaining economic claim supply[\s\S]*ShareTokenSupplySet/)
	assert.match(contractInteractionReference, /getForkThresholdAttoRep`, `getNonDecisionThresholdAttoRep`, `getUniverseTheoreticalSupplyAttoRep`/)
	assert.match(contractInteractionReference, /getQuestionResolution`, `getFinalQuestionResolution`/)
	assert.match(contractInteractionReference, /`fixedQuestionOutcome`/)
	assert.doesNotMatch(contractInteractionReference, /getCurrentCost/)
	assert.match(contractInteractionReference, /computeIterativeAttritionCostAttoRep`, `computeTimeSinceStartFromAttritionCostAttoRep`, `totalCostAttoRep`/)
	assert.match(contractInteractionReference, /ZoltarQuestionData[\s\S]*createQuestion\(questionData, outcomeOptions\)/)
	assert.match(contractInteractionReference, /`QuestionData` tuple[\s\S]*`startTime` and `endTime` are `uint48`[\s\S]*`numTicks` is `uint120`[\s\S]*determine the `getQuestionId` and `createQuestion` selectors/)
	assert.doesNotMatch(invariantsHtml, /active-vault index|<code>_syncActiveVault<\/code>/)
	assert.match(contractInteractionReference, /ReputationToken[\s\S]*setMaxTheoreticalSupplyAttoRep[\s\S]*mint\(account, valueAttoRep\)[\s\S]*burn\(account, valueAttoRep\)/)
	assert.match(contractInteractionReference, /SecurityPoolFactory[\s\S]*deployOriginSecurityPool[\s\S]*statoblastSecurityMultiplierBps > 10_001[\s\S]*initialReportPriorityFeeAttoEthPerGas > 0[\s\S]*labels `Yes`, then `No`/)
	assert.match(contractInteractionReference, /securityPoolDeploymentsRange\(startIndex, count\)[\s\S]*reverts rather than truncating/)
	assert.match(contractInteractionReference, /burnEscalationWinnerHaircut\(amountAttoRep\)[\s\S]*configured escalation game/)
	assert.match(contractInteractionReference, /getPoolAccountingSnapshot`, `getVaultFeeRemainder`/)
	assert.match(contractInteractionReference, /getVaultCount`, `getVaults`/)
	assert.match(contractInteractionReference, /`forkData` includes cumulative migrated REP and the fork-activation timestamp/)
	assert.match(contractInteractionReference, /previewDepositOnOutcome`, `computeIterativeAttritionCostAttoRep`/)
	assert.match(operatorReference, /factory has no owner role and no later `resumeFromFork` relay/)
	assert.match(securityPoolFactory, /_initialEscalationGameDepositAttoRep == 1e18[\s\S]*zoltar\.getNonDecisionThresholdAttoRep\(universeId\) > _getInitialEscalationDepositAttoRep\(reputationToken\)/)
	assert.match(securityPoolFactory, /SecurityPoolUtils\.calculateInitialEscalationDepositAttoRep\([\s\S]*reputationToken\.getTotalTheoreticalSupplyAttoRep\(\)/)
	assert.match(securityPoolFactory, /initialEscalationGameDepositAttoRep = _initialEscalationGameDepositAttoRep/)
	assert.match(securityPool, /initialEscalationGameDepositAttoRep = SecurityPoolUtils\.calculateInitialEscalationDepositAttoRep\([\s\S]*repToken\.getTotalTheoreticalSupplyAttoRep\(\)/)
	assert.match(securityPoolUtils, /function calculateInitialEscalationDepositAttoRep\([\s\S]*theoreticalSupplyAttoRep \/ 10_000_000[\s\S]*supplyBasedDepositAttoRep < 1e18 \? 1e18 : supplyBasedDepositAttoRep/)
	assert.match(securityPoolUtils, /function calculateMinimumVaultRepDepositAttoRep\([\s\S]*configuredMinimumAttoRep == 0 \? theoreticalSupplyAttoRep \/ 100_000 : configuredMinimumAttoRep/)
	assert.match(securityPool, /minimumVaultRepDepositAttoRep = SecurityPoolUtils\.calculateMinimumVaultRepDepositAttoRep\([\s\S]*securityPoolFactory\.minimumVaultRepDepositAttoRep\(\)/)
	assert.match(invariantsHtml, /id="esc-13"[\s\S]*max\(1 REP, theoretical REP supply \/ 10,000,000\)[\s\S]*clamps the live start bond to[\s\S]*nonDecisionThresholdAttoRep - 1/)
	assert.match(securityPool, /deployEscalationGame\(\s*initialEscalationGameDepositAttoRep,\s*zoltar\.getNonDecisionThresholdAttoRep\(universeId\)\s*\)/)
	assert.match(escalationGameFactory, /_nonDecisionThresholdAttoRep > 1[\s\S]*startBondAttoRep >= _nonDecisionThresholdAttoRep[\s\S]*startBondAttoRep = _nonDecisionThresholdAttoRep - 1/)
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
		/EscalationGameDepositDelegate`, `EscalationGameClaimDelegate`, `EscalationGameForker`, `SecurityPoolForkerVaultMigrationDelegate`, and `SecurityPoolLiquidationDelegate`[\s\S]*no ownership or import surface[\s\S]*funded REP-backing-unit, capacity-ownership, receiver-debt, and full-request bad-debt liquidation accounting[\s\S]*isolating fees and claims/,
	)
	assert.match(operatorReference, /Migration, liquidation, and storage modules[\s\S]*`SecurityPoolLiquidationDelegate\.sol`[\s\S]*`EscalationGameForker\.sol` \(\.\.\/\.\.\/solidity\/contracts\/statoblast\/EscalationGameForker\.sol\)/)
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
	assert.match(
		contractInteractionReference,
		/Converts the caller's parent REP backing-unit claim to REP at the fork snapshot and credits that REP amount as child-local backing units; transfers REP-denominated capacity ownership, latest-positive-deposit target preference metadata, and vault bad debt into one child pool/,
	)
	assert.doesNotMatch(contractInteractionReference, /transfers REP-denominated capacity ownership, target health factor/)
	assert.match(contractInteractionReference, /optional unresolved parent escalation-deposit accounting cleanup wrapper calls this function first to migrate transferable vault state/)
	assert.match(contractInteractionReference, /migrateVaultWithUnresolvedEscalation[\s\S]*First runs ordinary migration for the same vault[\s\S]*cleanup neither funds dispute-staked REP backing nor authorizes carried proofs/)
	assert.match(contractInteractionReference, /external fork interrupted the game[\s\S]*winners settle in the child by carried proof[\s\S]*unresolved parent escalation-deposit accounting cleanup is optional/)
	assert.doesNotMatch(contractInteractionReference, /external-fork timing may require migration instead/)
	assert.match(securityPool, /function withdrawForkedEscalationDeposits\([\s\S]*for \(uint256 index = 0; index < proofs\.length; index\+\+\)[\s\S]*_registerVault\(beneficiaryVault\)/)
	assert.match(securityPool, /function withdrawFromEscalationGame\([\s\S]*for \(uint256 index = 0; index < depositIndexes\.length; index\+\+\)[\s\S]*_registerVault\(beneficiaryVault\)/)
	assert.match(contractInteractionReference, /withdrawFromEscalationGame\(outcome, depositIndexes\)[\s\S]*An empty list returns after the outer lifecycle checks without settlement, state change, or event[\s\S]*No event for an empty list/)
	assert.match(contractInteractionReference, /withdrawForkedEscalationDeposits\(outcome, proofs\)[\s\S]*An empty list returns after the outer lifecycle checks without proof verification, state change, or event[\s\S]*No event for an empty list/)
	assert.match(contractInteractionReference, /Before finalization, refunds only provably losing bids/)
	assert.match(contractInteractionReference, /Auction owner \(`SecurityPoolForker`\) only; public callers use `settleAuctionBids`/)
	assert.match(contractInteractionReference, /Only a positive migration amount with at least one selected outcome checks the eight-week window, existing child `ForkMigration` state/)
	assert.match(contractInteractionReference, /child pool is not already deployed/)
	assert.match(contractInteractionReference, /selected child can be created or loaded, remains in `ForkMigration`, has a continuation game that passes the child-game trust boundary \(#child-game-trust-boundary\), and is inside the eight-week claim window/)
	assert.match(contractInteractionReference, /terminally rejected settlement consumes the pending batch and releases every liquidation reservation/)
	assert.match(contractInteractionReference, /setSecurityPool\(pool\)[\s\S]*Anyone while `securityPool` remains zero[\s\S]*zero value emits and checkpoints zero but leaves the setter callable/)
	assert.match(contractInteractionReference, /setRepEthPrice\(price\)[\s\S]*Configured nonzero `SecurityPool` only/)
	assert.match(openOracleIntegration, /setSecurityPool<\/code> once with the nonzero pool address/)
	assert.match(contractInteractionReference, /While a report is pending, only that report sponsor may stage more operations/)
	assert.match(contractInteractionReference, /required only when this call opens a new report/)
	assert.match(contractInteractionReference, /Genesis REP requires allowance; child REP is burned directly without allowance/)
	assert.match(
		securityPool,
		/function isEscalationResolved\(\) public view returns \(bool\) \{\s*return\s+hasInheritedForkOutcome \|\|\s+\(address\(escalationGame\) != address\(0x0\) &&\s+ISecurityPoolForker\(securityPoolForker\)\.getQuestionOutcome\(ISecurityPool\(payable\(address\(this\)\)\)\) !=\s+BinaryOutcomes\.BinaryOutcome\.None\);/,
	)
	assert.match(securityPoolForker, /if \(data\.fixedQuestionOutcomePlusOne > 0\)\s*return BinaryOutcomes\.BinaryOutcome\(data\.fixedQuestionOutcomePlusOne - 1\)/)
	assert.match(
		contractInteractionReference,
		/`isEscalationResolved\(\)` is true when the pool inherits a fixed fork outcome, or when a local escalation game is configured and the forker routes a non-`None` outcome\. An operational fixed-outcome child remains available for settlement and redemption but rejects new collateralized operations/,
	)
	assert.match(contractInteractionReference, /createCompleteSet\(\)[\s\S]*Operational and unforked; `isEscalationResolved\(\)` is false; not awaiting continuation/)
	assert.match(contractInteractionReference, /requestPriceIfNeededAndStageOperation\(\.\.\.\)[\s\S]*`securityPool\.isEscalationResolved\(\)` is false/)
	assert.match(contractInteractionReference, /requestPriceIfNeededAndStageOperation\(\.\.\.\)[\s\S]*`StagedOperationQueued`, possibly `PriceRequested`, then `ExecutedStagedOperation`/)
	assert.doesNotMatch(contractInteractionReference, /Operational, unforked, unresolved|unresolved local escalation|Unresolved pool;/)
	assert.match(contractInteractionReference, /positive ETH converts to at least one complete-set unit/)
	assert.match(
		securityPool,
		/function createCompleteSet\(\) external payable isOperational \{[\s\S]*uint256 nextSettlementCollateralAttoEth = settlementCollateralAttoEth \+ msg\.value;[\s\S]*_requireCapacityNotExceeded\(nextSettlementCollateralAttoEth\);/,
		'Complete-set issuance must compare resulting total collateral against live oracle-priced capacity',
	)
	assert.match(contractInteractionReference, /createCompleteSet\(\)[\s\S]*live oracle-priced minting capacity covers the resulting settlement collateral, not merely this deposit/, 'Generated complete-set prerequisites must identify live capacity and the resulting-total-collateral guard')
	assert.match(contractInteractionReference, /redeemCompleteSet\(amountAttoShares\)[\s\S]*caller accepts the resulting ETH call, including zero value[\s\S]*rejection of that ETH call reverts the transaction/)
	assert.match(securityPool, /function attoSharesToAttoEth\(uint256 amountAttoShares\)[\s\S]*return \(amountAttoShares \* settlementCollateralAttoEth\) \/ shareTokenSupplyAttoShares/)
	assert.match(securityPool, /function redeemCompleteSet\(uint256 amountAttoShares\)[\s\S]*uint256 settlementCollateralRedeemedAttoEth = attoSharesToAttoEth\(amountAttoShares\)/)
	assert.match(securityPool, /function redeemShares\(\)[\s\S]*settlementCollateralAttoEth\) \/ shareTokenSupplyAttoShares[\s\S]*shareTokenSupplyAttoShares -= winningSharesBurnedAttoShares/)
	assert.match(securityPoolForker, /securityPool\.setTotalSharesAttoShares\(parent\.shareTokenSupplyAttoShares\(\)\)/)
	assert.match(contractInteractionReference, /redeemCompleteSet\(amountAttoShares\)[\s\S]*amountAttoShares \* settlementCollateralAttoEth \/ shareTokenSupplyAttoShares[\s\S]*remaining economic claim supply[\s\S]*source entitlements materialize without changing it/)
	assert.doesNotMatch(contractInteractionReference, /redeemCompleteSet\(amountAttoShares\)[\s\S]*largest live outcome supply/)
	assert.match(contractInteractionReference, /redeemShares\(\)[\s\S]*caller accepts the resulting ETH call, including zero value[\s\S]*rejection of that ETH call reverts the transaction/)
	assert.match(contractInteractionReference, /redeemFees\(vault\)[\s\S]*If resulting claimable fees are zero, returns without payment[\s\S]*no event when fees and accrual state are unchanged/)
	assert.match(contractInteractionReference, /withdrawRepFromVault\(vault, attoRepAmount\)[\s\S]*operational pool in an unforked universe[\s\S]*`isEscalationResolved\(\)` is false/)
	assert.match(diagramModelsSource, /withdraw REP or liquidation/)
	assert.doesNotMatch(diagramModelsSource, /withdraw, capacity ownership/)
	assert.match(securityPoolUtils, /capacityOwnershipToMoveAttoRep =[\s\S]*Math\.mulDiv\(targetCapacityOwnershipAttoRep, debtToMoveAttoEth, targetOpenInterestAttoEth\)/)
	assert.match(securityPoolLiquidationDelegate, /request\.receiverVault != request\.targetVault[\s\S]*receiverOpenInterestAttoEth < minimumSecurityBondDebtAttoEth[\s\S]*revert\('Receiver debt below minimum'\)/)
	assert.match(securityPoolLiquidationDelegate, /SecurityPoolUtils\.isVaultHealthyAtFactor\([\s\S]*minimumReceiverHealthFactorBps[\s\S]*'Receiver bad'/)
	assert.match(securityModel, /effective pool-held vault REP backing\s+multiplier at least the 10,500-BPS liquidation-award reserve/)
	assert.doesNotMatch(securityModel, /pool multiplier strictly above the migration multiplier/)
	for (const representation of [operatorReference, contractInteractionReference, contractReferenceGenerator]) {
		assert.doesNotMatch(representation, /surplus remains unless|floors quote-to-backing-unit|dust may promote/)
	}
	assert.ok(operatorReference.includes('calculateBundledLiquidationTransfer('))
	assert.match(securityPool, /function _requireVaultCoverage\([\s\S]*uint256 openInterestAttoEth[\s\S]*SecurityPoolUtils\.isVaultHealthy/)
	assert.match(securityPool, /function _requirePoolCoverage\([\s\S]*uint256 totalOpenInterestAttoEth[\s\S]*SecurityPoolUtils\.isVaultHealthy/)
	assert.match(initiateSecurityPoolForkRow, /Pool operational with no inherited fixed outcome;[\s\S]*authorized by its declared share token[\s\S]*Declared-token authorization is not configured-factory registration/)
	assert.match(
		ownEscalationForkRow,
		/Pool operational with no inherited fixed outcome;[\s\S]*`canTriggerOwnFork\(\)` is true because it recorded a local non-decision or inherited a threshold tie without a game-level fixed outcome[\s\S]*does not require declared-share-token authorization[\s\S]*neither path authenticates the supplied address against the configured pool factory/,
	)
	assert.match(createChildUniverseRow, /returned auction is nonzero, deployed, and has never been trusted by this forker[\s\S]*child's fork-data slot is unused[\s\S]*expected parent, universe, source factory, forker, and auction[\s\S]*do not independently prove configured-factory registration/)
	assert.match(escalationDepositRow, /pool operational in an unforked universe, without an inherited fixed outcome, and not awaiting continuation/)
	assert.match(securityPool, /function depositToEscalationGame\([^}]+if \(hasInheritedForkOutcome\) revert\(\);/)
	assert.match(migrateSharesRow, /an `Operational` source has no inherited fixed outcome because auto-fork activation rejects one/)
	assert.match(contractInteractionReference, /claimForkedEscalationDeposits\(\.\.\.\)[\s\S]*parent game still satisfies `canTriggerOwnFork\(\)` by having either a local non-decision or an inherited threshold tie without a fixed outcome/)
	assert.match(claimForkedEscalationDepositsRow, /every deposit to commit `vault` as its immutable depositor/)
	assert.match(contractInteractionReference, /withdrawDeposit\(uint256 depositIndex, outcome\)[\s\S]*`CarryDepositConsumed` and `VaultEscrowUpdated`[\s\S]*for a winner, `ClaimDeposit`/)
	assert.match(contractInteractionReference, /`DisputeStakedRepDrainedAtFork` when unresolved escalation exists/)
	assert.match(contractInteractionReference, /Initially authorized `SecurityPoolFactory` for an origin pool; an authorized parent `SecurityPool` for a child pool/)
	assert.match(contractInteractionReference, /canonical source pool is `Operational` or `PoolForked`[\s\S]*every target in a multi-target call already has a canonical child pool/)
	assert.match(contractInteractionReference, /If needed, first freezes the operational source pool and records its fork snapshot/)
	assert.match(securityPoolForker, /uint256 migrationAmountAttoRep = data\.ownFork \? data\.vaultRepAtForkAttoRep : data\.auctionableAttoRepAtFork;\s*if \(migrationAmountAttoRep > 0\) \{\s*for \(uint256 index = 0; index < outcomeIndices\.length; index\+\+\)/)
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
	assert.match(truthAuction, /function finalize\(\) external \{[\s\S]*payable\(owner\)\.call\{\s*value:\s*raisedAttoEthToSend\s*\}\(''\)[\s\S]*require\(sent, 'Auction failed to send raised ETH to the owner'\)/)
	assert.match(truthAuction, /function withdrawBids\([\s\S]*for \(uint256 i = 0; i < tickIndices\.length; i\+\+\)[\s\S]*_payOrDeferRefund\(withdrawFor, totalRefundAttoEth\)/)
	assert.match(truthAuction, /function _refundLosingBids\([\s\S]*for \(uint256 i = 0; i < tickIndices\.length; i\+\+\)[\s\S]*_payOrDeferRefund\(bidder, totalRefundAttoEth\)/)
	assert.match(truthAuction, /function _payOrDeferRefund\([\s\S]*if \(amountAttoEth == 0\) return;[\s\S]*payable\(bidder\)\.call\{\s*value:\s*amountAttoEth,\s*gas:\s*REFUND_PUSH_GAS_LIMIT\s*\}\(''\)[\s\S]*pendingEthRefundsAttoEth\[bidder\] = pendingAmountAttoEth;[\s\S]*emit EthRefundDeferred\(/)
	assert.match(
		truthAuction,
		/function withdrawPendingEthRefund\(\) external \{[\s\S]*pendingEthRefundsAttoEth\[msg\.sender\] = 0;[\s\S]*emit PendingEthRefundWithdrawn\(msg\.sender, amountAttoEth\);[\s\S]*payable\(msg\.sender\)\.call\{\s*value:\s*amountAttoEth\s*\}\(''\)[\s\S]*require\(sent, 'Auction failed to withdraw deferred ETH refund'\)/,
	)
	assert.match(contractInteractionReference, /refundLosingBids\(tickIndices\)[\s\S]*attempts an immediate gas-bounded ETH refund[\s\S]*gas-exhausted pushes are recorded in `pendingEthRefundsAttoEth` without restoring the bid[\s\S]*An empty list changes no bids and makes no external call/)
	assert.match(contractInteractionReference, /finalize\(\)[\s\S]*owner accepts the proceeds ETH call, including zero value[\s\S]*A rejected call reverts finalization and its event/)
	assert.match(
		contractInteractionReference,
		/withdrawBids\(withdrawFor, tickIndices, proRataTotal, secondaryProRataTotal\)[\s\S]*gas-exhausted positive refund push is gas-bounded and deferred rather than reverting or starving the REP, capacity-ownership, and bad-debt settlement[\s\S]*An empty list returns four zeros without changing bids, emitting events, or calling the beneficiary/,
	)
	assert.match(contractInteractionReference, /withdrawPendingEthRefund\(\)[\s\S]*emits its withdrawal before transferring without the push-refund gas cap[\s\S]*callback-created deferrals follow the clear in log order[\s\S]*A rejected pull reverts the transfer, clear, and event[\s\S]*`PendingEthRefundWithdrawn`/)
	assert.match(truthAuction, /function startAuction\([\s\S]*block\.timestamp <= type\(uint48\)\.max/)
	assert.match(truthAuction, /function submitBid\([\s\S]*msg\.value <= type\(uint128\)\.max/)
	assert.match(truthAuction, /function _appendBid\([\s\S]*cumulativeBidAttoEth <= type\(uint128\)\.max/)
	assert.match(contractInteractionReference, /startAuction\(attoEthRaiseCap, maxAttoRepBeingSold\)[\s\S]*block timestamp fits in `uint48`/)
	assert.match(contractInteractionReference, /individual bid and the resulting cumulative ETH at that tick each fit in `uint128`/)
	assert.match(constants, /uint88 constant MAX_ATTO_REP = 11_000_000e18/)
	assert.match(zoltar, /genesisSupply <= Constants\.MAX_ATTO_REP/)
	assert.match(contractInteractionReference, /theoretical supply from one attoREP through 11 million REP/)
	assert.match(sepoliaRepAllocations, /const SEPOLIA_REP_MINT_CAP = parseUnits\('11000000', 18\)/)
	assert.match(sepoliaRepAllocations, /SEPOLIA_REP_MINT_CAP \/ BigInt\(SEPOLIA_REP_HOLDERS\.length\)/)
	assert.match(operatorReference, /configured 11 million REP mint cap is divided equally among the listed holders/)
	assert.match(operatorReference, /total supply no greater than 11 million REP/)
	assert.match(securityPool, /function getVaultCount\(\) external view returns \(uint256\) \{\s*return vaultAddresses\.length;/)
	assert.match(securityPool, /function getVaults\([\s\S]*vaultAddresses\[vaultCount - startIndex - index - 1\]/)
	assert.match(securityPool, /function _registerVault\(address vault\) private \{\s*if \(vault == address\(0x0\) \|\| isKnownVault\[vault\]\) return;\s*isKnownVault\[vault\] = true;\s*vaultAddresses\.push\(vault\);\s*\}/)
	assert.match(zoltar, /function splitMigrationRep\([\s\S]*require\(universes\[universeId\]\.forkTime != 0[\s\S]*splitRepInternal\(universeId, amountAttoRep, msg\.sender, outcomeIndexes\)/)
	assert.match(zoltar, /function splitRepInternal\([\s\S]*for \(uint256 i = 0; i < outcomeIndexes\.length; i\+\+\)[\s\S]*reputationToken\.mint\(recipient, amountAttoRep\)[\s\S]*emit MigrationRepSplit\(/)
	assert.match(reputationToken, /function mint\(address account, uint256 valueAttoRep\)[\s\S]*_mint\(account, valueAttoRep\);[\s\S]*emit Mint\(account, valueAttoRep\)/)
	assert.match(
		contractInteractionReference,
		/splitMigrationRep\(universeId, amountAttoRep, outcomeIndexes\)[\s\S]*An empty outcome list returns after the universe-fork guard without outcome validation, deployment, minting, or events[\s\S]*nonempty zero-amount call still validates every outcome[\s\S]*child REP `Transfer` and `Mint`, then `MigrationRepSplit`[\s\S]*no event for an empty list/,
	)
	assert.match(securityPoolForker, /function _claimAuctionProceeds\([\s\S]*require\(data\.truthAuction\.finalized\(\), 'Not final'\)[\s\S]*data\.truthAuction\.withdrawBids\([\s\S]*SecurityPoolForkerVaultMigrationDelegate\.creditAuctionProceeds/)
	assert.match(
		contractInteractionReference,
		/claimAuctionProceeds\(securityPool, vault, tickIndices\)[\s\S]*For an empty list, the underlying auction withdrawal returns four zeros and the wrapper exits after the finalization guard without validating bids or the named beneficiary, calling it, changing state, or emitting events[\s\S]*no event for an empty list/,
	)
	assert.match(escalationGameSettlement, /function drainAllRep\(address receiver\)[\s\S]*amountAttoRep = repToken\.balanceOf\(address\(this\)\);[\s\S]*if \(amountAttoRep == 0\) return 0;[\s\S]*_safeTransferRep\(receiver, amountAttoRep\)/)
	assert.match(escalationGameSettlement, /function drainAllRep\(address receiver\)[\s\S]*require\(msg\.sender == address\(securityPool\), 'Only pool'\)/)
	assert.match(securityPool, /function activateForkMode\(\)[\s\S]*if \(hasInheritedForkOutcome\) revert\(\)[\s\S]*systemState = SystemState\.PoolForked;[\s\S]*mstore\(0x00, shl\(224, 0x3c250020\)\)[\s\S]*call\(gas\(\), game/)
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
	assert.match(securityPool, /updateVaultFees\(request\.targetVault\);\s*updateVaultFees\(request\.receiverVault\);[\s\S]*abi\.encodeCall\(SecurityPoolLiquidationDelegate\.performBundledLiquidation, \(executionRequest\)\)/)
	assert.match(securityPoolLiquidationDelegate, /securityVaults\[request\.receiverVault\]\.capacityOwnershipAttoRep \+= capacityOwnershipToMoveAttoRep/)
	assert.doesNotMatch(performLiquidationRow, /EscalationClaimMoved|Claim checkpoint pending|Claim move failed/)
	assert.match(
		performLiquidationRow,
		/In ABI order,[\s\S]*operationId[\s\S]*operator[\s\S]*receiverVault[\s\S]*targetVault[\s\S]*requestedDebtAttoEth[\s\S]*snapshot[\s\S]*minimumReceiverHealthFactorBps[\s\S]*minLiquidationPriceDistanceBps[\s\S]*nested snapshot contains[\s\S]*targetBackingUnits[\s\S]*targetCapacityOwnershipAttoRep[\s\S]*totalPoolHeldAttoRep[\s\S]*totalRepBackingUnits/,
	)
	assert.match(performLiquidationRow, /target backing and capacity-ownership snapshot fields must match[\s\S]*pool-total snapshot fields are reconstruction evidence[\s\S]*execution uses live pool totals/)
	assert.match(performLiquidationRow, /live target backing, dispute-staked REP, and open interest[\s\S]*minLiquidationPriceDistanceBps/)
	assert.match(operatorReference, /Liquidation distance[\s\S]*minLiquidationPriceDistanceBps[\s\S]*SecurityPoolLiquidationDelegate\.sol/)
	assert.doesNotMatch(escalationGameClaimDelegate, /function moveEscalationClaim|payoutClaimBundle|forkCarryPayoutClaimImportCursor/)
	assert.doesNotMatch(securityPoolLiquidationDelegate, /_moveEscalationClaim|previewLiquidationClaimRep|moveEscalationClaim/)
	assert.match(claimDepositWithoutTransferRow, /inverse-retention claim units[\s\S]*no local auction checkpoint[\s\S]*⌈originalPrincipal × truthAuctionRepBeforeAttoRep \/ truthAuctionRepRemainingAttoRep⌉[\s\S]*Other unconsumed deposits by the same depositor remain backed/)
	assert.match(escalationGameSettlement, /_claimDepositForWinning\(depositIndex, outcome, false\)/)
	assert.match(escalationGameState, /uint256 claimUnits = _repToClaimUnits\(amountAttoRep\);[\s\S]*bundle\.disputeStakedRepClaimUnits -= claimUnits/)
	assert.match(recordForkedEscrowRow, /depositor remains the immutable payout owner[\s\S]*inherited claims remain in the carry commitment and are not copied/)
	assert.match(escalationGameDepositDelegate, /recordForkedEscrowForOutcome\([\s\S]*_increaseEscrowedRepForBundle\(depositor, effectiveChildAttoRep, false\)/)
	assert.match(startTruthAuctionRow, /ForkContinuationResumed/)
	assert.match(finalizeTruthAuctionRow, /TruthAuctionHaircutApplied[\s\S]*ForkContinuationResumed/)
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
	assert.match(escalationGame, /function _initializeStartParams\([\s\S]*if \(owner != msg\.sender\) revert\(\);/)
	assert.match(escalationGame, /function recordDepositFromSecurityPool\([\s\S]*require\(msg\.sender == address\(securityPool\), 'Only security pool'\);/)
	assert.match(escalationGameDepositDelegate, /function resumeFromFork\(\) external \{[\s\S]*IEscalationGameDepositContext game = IEscalationGameDepositContext\(address\(this\)\);[\s\S]*require\(msg\.sender == game\.securityPool\(\), 'Only pool'\);/)
	assert.match(escalationGameDepositDelegate, /function applyTruthAuctionHaircut\([\s\S]*require\(msg\.sender == IEscalationGameSecurityPoolContext\(poolAddress\)\.securityPoolForker\(\), 'Only forker'\);/)
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
	assert.match(priceCoordinator, /function requestPrice\([\s\S]*if \(excess > 0\) \{[\s\S]*payable\(msg\.sender\)\.call\{\s*value:\s*excess\s*\}\(''\)[\s\S]*require\(sent, 'Oracle coordinator failed to refund excess ETH bounty'\)/)
	assert.match(priceCoordinator, /function requestPriceIfNeededAndStageOperation\([\s\S]*if \(refund > 0\) \{[\s\S]*payable\(msg\.sender\)\.call\{\s*value:\s*refund\s*\}\(''\)[\s\S]*require\(sent, 'Oracle coordinator failed to return unused ETH'\)/)
	assert.match(contractInteractionReference, /requestPriceIfNeededAndStageOperation\(\.\.\.\)[\s\S]*caller must accept any positive unused-ETH refund[\s\S]*rejection rolls back the entire transaction, including any queueing, immediate execution, or newly opened report/)
	assert.match(contractInteractionReference, /requestPrice\(proposedRepPerEthPrice, requestedInitialAttoWeth\)[\s\S]*caller must accept any positive excess-ETH refund[\s\S]*Callback rejection rolls back the report and initial position/)
	assert.match(operatorReference, /Immediate execution[\s\S]*canonical refund warning[\s\S]*open-oracle\.html#refund-callback/)
	assert.match(priceCoordinator, /function recoverSettledPendingReport\(\)[\s\S]*storedGame\(reportId\)[\s\S]*require\(settlementTimestamp != 0, 'Report not settled'\)[\s\S]*_failPendingSettlementOperations\('Report recovered'\)/)
	assert.match(contractInteractionReference, /recoverSettledPendingReport\(\)[\s\S]*stored OpenOracle `storedGame\(reportId\)\.settlementTimestamp` is nonzero/)
	assert.match(operatorReference, /Recovery path[\s\S]*requires a pending report whose stored OpenOracle settlement timestamp is nonzero[\s\S]*consumes all associated pending operations[\s\S]*releases their liquidation reservations/)
	assert.match(
		securityPool,
		/function assignFinalizedAuctionFees\(address vault, uint256 amountAttoRep, uint256 auctionFeeIndexAtFinalization\) external onlyForker \{[\s\S]*SecurityPoolUtils\.calculateVaultFee\(amountAttoRep, feeIndex - auctionFeeIndexAtFinalization, previousVaultFeeRemainder\)[\s\S]*unallocatedAccruedFeesAttoEth -= fees;[\s\S]*_emitVaultAccountingCheckpoint\(vault\);/,
	)
	assert.ok(contractInteractionReference.includes('assignFinalizedAuctionFees(vault, amountAttoRep, auctionFeeIndexAtFinalization)'))
	assert.match(securityPool, /function setAwaitingForkContinuation\(bool shouldAwait\) external onlyForker \{\s*awaitingForkContinuation = shouldAwait;\s*emit AwaitingForkContinuationSet\(awaitingForkContinuation\)/)
	assert.match(contractInteractionReference, /setAwaitingForkContinuation\(shouldAwait\)[\s\S]*No lifecycle or value-change guard[\s\S]*`AwaitingForkContinuationSet`, including for a repeated value/)
	assert.match(securityPool, /function setSystemState\(SystemState newState\) external onlyForker \{\s*systemState = newState;\s*emit SystemStateSet\(systemState\)/)
	assert.match(contractInteractionReference, /setSystemState\(newState\)[\s\S]*No transition or value-change guard[\s\S]*`SystemStateSet`, including for a repeated state/)
	assert.match(securityPool, /function configureVault\([\s\S]*?\) external onlyForker \{[\s\S]*?lastDepositTargetHealthFactorBpsByVault\[vault\] = lastDepositTargetHealthFactorBps;[\s\S]*?_emitPoolAccountingCheckpoint\(AccountingReason\.CapacityOwnershipChange, vault\)/)
	assert.match(
		contractInteractionReference,
		/configureVault\(vault, repBackingUnits, capacityOwnershipAttoRep, vaultFeeIndex, lastDepositTargetHealthFactorBps, newVaultBadDebtAttoEth, newTotalBadDebtAttoEth\)[\s\S]*no lifecycle or value-change guard[\s\S]*Always `VaultAccountingCheckpoint` and `PoolAccountingCheckpoint`, including when all supplied values repeat current state/,
	)
	assert.match(securityPool, /function setTotalRepBackingUnits\(uint256 newDenominator\) external onlyForker \{\s*totalRepBackingUnits = newDenominator;\s*emit TotalRepBackingUnitsSet\(totalRepBackingUnits\)/)
	assert.match(contractInteractionReference, /setTotalRepBackingUnits\(newDenominator\)[\s\S]*No lifecycle or value-change guard[\s\S]*`TotalRepBackingUnitsSet`, including for zero or a repeated value/)
	assert.match(securityPool, /function setTotalSharesAttoShares\(uint256 newTotalSharesAttoShares\) external onlyForker \{\s*shareTokenSupplyAttoShares = newTotalSharesAttoShares;\s*emit ShareTokenSupplySet\(shareTokenSupplyAttoShares\)/)
	assert.match(contractInteractionReference, /setTotalSharesAttoShares\(newTotalSharesAttoShares\)[\s\S]*No lifecycle or value-change guard[\s\S]*`ShareTokenSupplySet`, including for zero or a repeated value/)
	assert.match(securityPool, /function setPoolFinancials\([\s\S]*?lastUpdatedFeeAccumulator = block\.timestamp;[\s\S]*?_emitPoolAccountingCheckpoint\(AccountingReason\.ForkFinalization, address\(0x0\)\)/)
	assert.match(contractInteractionReference, /setPoolFinancials\(newSettlementCollateralAttoEth, newTotalCapacityOwnershipAttoRep, newFeeEligibleCapacityOwnershipAttoRep, newTotalBadDebtAttoEth\)[\s\S]*no lifecycle or value-change guard[\s\S]*`PoolAccountingCheckpoint`, including for repeated financial values/)
	assert.match(securityPool, /function assignFinalizedAuctionFees\(address vault, uint256 amountAttoRep, uint256 auctionFeeIndexAtFinalization\) external onlyForker \{[\s\S]*?_emitVaultAccountingCheckpoint\(vault\);\s*_emitPoolAccountingCheckpoint\(AccountingReason\.AuctionClaim, vault\)/)
	assert.match(securityPoolForker, /Before finalization, only refundable bids can be settled/)
	assert.match(securityPoolForker, /require\(claimTickIndices\.length == 0, 'Not final'\)/)
	assert.match(securityPoolForker, /block\.timestamp <= data\.forkActivationTime \+ SecurityPoolUtils\.MIGRATION_TIME/)
	assert.match(securityPoolForkerVaultMigrationDelegate, /require\(address\(childrenByPoolAndOutcome\[parent\]\[outcomeIndex\]\) == address\(0x0\), 'Child pool exists'\)/)
	assert.match(priceCoordinator, /_rejectReportAndPendingOperations\(reportId, 'Base fee too high'\);\s*return;/)
	assert.match(priceCoordinator, /finalReportDisputeStatus == FINAL_REPORT_COUNTER_SATURATED\s*\? 'Counter saturated'\s*: 'Report uneconomic'/)
	assert.match(priceCoordinator, /_rejectReportAndPendingOperations\(reportId, 'Empty oracle settlement'\);\s*return;/)
	assert.match(priceCoordinator, /_rejectReportAndPendingOperations\(reportId, 'Oracle price is zero'\);\s*return;/)
	assert.match(priceCoordinator, /require\(\s*msg\.sender == pendingReportSponsor,\s*'Only the pending report sponsor can queue more operations until settlement'/)
	assert.match(priceCoordinator, /bool shouldRequestPrice = pendingReportId == 0 && pendingSettlementOperationIds\.length == 0/)
	assert.match(priceCoordinator, /if \(shouldRequestPrice && isPendingSettlementOperationId\)/)
	assert.match(escalationGameForker, /if \(child\.systemState\(\) != SystemState\.ForkMigration\) revert\(\)/)
	assert.match(escalationGameForker, /block\.timestamp > forkDataByPool\[parent\]\.forkActivationTime \+ SecurityPoolUtils\.MIGRATION_TIME\) revert\(\)/)
	assert.match(escalationGameForker, /guards keep that initcode below EIP-3860's hard deployment limit/)
	assert.match(securityPool, /event SystemStateSet\(SystemState systemState\)/)
	assert.match(securityPool, /require\(zoltar\.getForkTime\(universeId\) == 0, 'Forked'\)/)
	assert.match(securityPool, /function activateForkMode\(\) external onlyForker/)
	assert.match(securityPool, /function activateForkMode\(\) external onlyForker \{\s*if \(hasInheritedForkOutcome\) revert\(\)/)
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
	assert.match(vaultMigrationBody, /SecurityPoolUtils\.configureForkMigratedVault\([\s\S]*migratedBadDebtByPool\[child\] \+= parentVaultBadDebtAttoEth/)
	assert.match(vaultMigrationBody, /_transferForkMigratedCollateralToChild\(parent, child, migratedAttoRep\)/)
	assert.match(contractInteractionReference, /Converts the caller's parent REP backing-unit claim to REP at the fork snapshot and credits that REP amount as child-local backing units[\s\S]*retains claimable fees in the parent vault[\s\S]*routes proportional pool-level settlement collateral/)
	assert.match(shareToken, /if \(sourcePool\.systemState\(\) == SystemState\.Operational\) \{\s*forker\.initiateSecurityPoolFork\(sourcePool\)/)
	assert.match(securityPool, /systemState = SystemState\.PoolForked/)
	assert.match(securityPool, /shareToken\.authorize\(pool\)/)
	assert.match(securityPoolFactory, /shareToken\.authorize\(securityPool\)/)
	assert.match(securityPoolForker, /address\(escalationGame\) == address\(0x0\) \|\| _forkOccurredBeforeEscalationSettled\(escalationGame, forkTime\)/)
	assert.match(securityPoolForker, /'Resolved'/)
	assert.match(securityPoolForker, /securityPool\.setSystemState\(SystemState\.ForkTruthAuction\)/)
	assert.match(securityPoolForkerAuctionSettlementBase, /SecurityPoolUtils\.creditForkAuctionVault\([\s\S]*badDebtToAssignAttoEth/)
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
	assert.match(priceCoordinatorFactory, /bytes32 deploymentSalt = keccak256\(abi\.encode\(msg\.sender, salt\)\)[\s\S]*priceCoordinatorDeploymentWorker\.deploy\([\s\S]*deploymentSalt[\s\S]*liquidationApprovalRegistryDeployer\.deploy\([\s\S]*address\(coordinator\),\s*deploymentSalt/)
	assert.match(truthAuctionFactory, /new UniformPriceDualCapBatchAuction\{\s*salt:\s*keccak256\(abi\.encode\(msg\.sender, salt\)\)\s*\}/)
	assert.match(securityPoolDeployer, /create2\(0, add\(initCode, 0x20\), mload\(initCode\), 0\)/)
	assert.match(securityPoolFactory, /shareTokenFactory\.deployShareToken\(originId, questionId\)/)
	assert.match(shareTokenFactory, /new ShareToken\{\s*salt:\s*salt\s*\}\(msg\.sender, zoltar, questionId\)/)
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
	for (const emitterFunction of ['emitPoolAccountingCheckpoint', 'emitVaultAccountingCheckpoint']) {
		assert.match(securityPoolEventEmitter, new RegExp(`function ${emitterFunction}\\([\\s\\S]*?\\) external payable`), `${emitterFunction} must remain externally payable for delegatecall flows`)
	}
	assert.match(securityPoolEventEmitter, /function emitForkSnapshotEvents\(\s*ISecurityPool parent,\s*address migrationProxy,\s*address sourceGame,\s*uint256 totalPoolHeldRepAtForkAttoRep,\s*uint256 disputeStakedRepAtForkAttoRep,\s*uint256 resultingLockedAttoRep\s*\) external payable/)
	assert.match(
		securityPoolForker,
		/mstore\(pointer, shl\(224, 0x408d33da\)\)[\s\S]*mstore\(add\(pointer, 0x04\), parent\)[\s\S]*mstore\(add\(pointer, 0x24\), migrationProxy\)[\s\S]*mstore\(add\(pointer, 0x44\), sourceGame\)[\s\S]*mstore\(add\(pointer, 0x64\), totalPoolHeldRepAtForkAttoRep\)[\s\S]*mstore\(add\(pointer, 0x84\), disputeStakedRepAtForkAttoRep\)[\s\S]*mstore\(add\(pointer, 0xa4\), resultingLockedAttoRep\)[\s\S]*delegatecall\(gas\(\), eventEmitter, pointer, 0xc4, 0, 0\)/,
	)
	assert.match(operatorReference, /Payability permits delegatecalls from value-bearing protocol flows; callers must not send ETH directly/)
	assert.match(truthAuctionStorage, /function allocateFromCumulativePosition\(/)
	assert.match(truthAuction, /function finalize\(\) external[\s\S]*payable\(owner\)\.call\{\s*value:\s*raisedAttoEthToSend\s*\}/)
	assert.match(invariantsHtml, /FORK-12[\s\S]*activates after value-free finalization with 9 ETH of tracked collateral/)
	assert.doesNotMatch(invariantsHtml, /remains inactive until repair/)
	assert.match(invariantsHtml, /AUC-06[\s\S]*proportional REP backing units[\s\S]*independent of claim order[\s\S]*does not change total capacity ownership[\s\S]*aggregate accrued fees/)
	assert.match(invariantsHtml, /AUC-06[\s\S]*REP allocation rounds to zero[\s\S]*claiming that bid alone still credits the capacity ownership/)
	assert.match(invariantsHtml, /AUTH-06[\s\S]*purchased REP remains pool-held[\s\S]*REP backing units and capacity ownership are credited to Bob's vault/)
	assert.match(invariantsHtml, /VAULT-01[\s\S]*initially attributed 20 REP[\s\S]*15 REP of vault backing plus a separate 5 REP claim/)
	assert.match(invariantsHtml, /AUC-06[\s\S]*keeps purchased REP pool-held[\s\S]*transfers the bid's proportional REP backing units/)
	assert.match(invariantsHtml, /AUC-07[\s\S]*aggregate[\s\S]*underfundedWinningAttoEth \/ maxAttoRepBeingSold[\s\S]*dust winner can round to zero REP/)
	assert.doesNotMatch(invariantsHtml, /fraction funded by the bid's retained ETH/)
	assert.match(contractInteractionReference, /winning dust bid can receive positive capacity ownership when its REP allocation rounds to zero/)
	assert.match(
		contractInteractionReference,
		/`ClaimAuctionProceeds` when REP backing, capacity ownership, or raw auction bad-debt settlement advances[\s\S]*cumulative claimed and total auctioned bad-debt fields are raw counters[\s\S]*effective vault debt still requires the recorded auction generation to match the pool’s current generation/,
	)
	assert.match(truthAuctionStorage, /return cumulativeAllocationAfter - cumulativeAllocationBefore/)
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
		if (sourcePath.includes('/test/')) continue
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
