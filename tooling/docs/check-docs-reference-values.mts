import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { diagramGraphSpecs } from '../../docs/charts/diagramModels'
import type { DiagramGraphNode } from '../../docs/charts/diagramTypes'
import { getMainnetProtocolConfig } from '../contracts/protocol-config.ts'
import { htmlToDocumentationText } from './docs-html-text.mts'

const normalizeHtmlSource = (source: string): string => source.replaceAll(/<\/([a-z][\w:-]*)\s+>/gi, '</$1>')
const html = normalizeHtmlSource(await readFile('docs/explanation/escalation-game.html', 'utf8'))
const invariantsHtml = normalizeHtmlSource(await readFile('docs/reference/invariants.html', 'utf8'))
const liquidationHtml = normalizeHtmlSource(await readFile('docs/explanation/liquidations.html', 'utf8'))
const openOracleIntegration = normalizeHtmlSource(await readFile('docs/reference/open-oracle.html', 'utf8'))
const whitepaperStatoblast = normalizeHtmlSource(await readFile('docs/explanation/statoblast.html', 'utf8'))
const diagramModelsSource = await readFile('docs/charts/diagramModels.ts', 'utf8')
const coordinatorData = await readFile('docs/data/open-oracle-coordinator.json', 'utf8')
const compiledContractArtifacts: unknown = JSON.parse(await readFile('solidity/artifacts/Contracts.json', 'utf8'))
const operatorReference = htmlToDocumentationText(await readFile('docs/reference/operator-guardrails.html', 'utf8'))
const contractInteractionReference = htmlToDocumentationText(await readFile('docs/reference/contracts.html', 'utf8'))
const contractReferenceGenerator = `${await readFile('tooling/docs/generate-contract-interaction-reference.mts', 'utf8')}\n${await readFile('tooling/docs/contract-reference-metadata.mts', 'utf8')}`
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
const deploymentStatusOracle = await readFile('solidity/contracts/DeploymentStatusOracle.sol', 'utf8')
const securityPool = await readFile('solidity/contracts/statoblast/SecurityPool.sol', 'utf8')
const securityPoolOperationsDelegate = await readFile('solidity/contracts/statoblast/SecurityPoolOperationsDelegate.sol', 'utf8')
const securityPoolSettlementDelegate = await readFile('solidity/contracts/statoblast/SecurityPoolSettlementDelegate.sol', 'utf8')
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
const sepoliaRepAllocations = await readFile('shared/zoltar/ts/deployment/sepoliaRepAllocations.ts', 'utf8')
const escalationGameForkThresholdTest = await readFile('solidity/ts/tests/escalationGameForkThreshold.test.ts', 'utf8')
const escalationGameBytecodeSnapshot = await readFile('solidity/ts/tests/fixtures/escalationGameBytecode.snapshot.json', 'utf8')

await assertNoNarrativeDocumentationSnapshots()
assertEscalationContinuationReference()
assertSystemDecisionForkTriggers()
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

async function assertNoNarrativeDocumentationSnapshots(): Promise<void> {
	const validatorPaths = ['tooling/docs/check-docs-examples.mts', 'tooling/docs/check-docs-reference-values.mts']
	for (const validatorPath of validatorPaths) {
		const validatorSource = await readFile(validatorPath, 'utf8')
		assert.deepEqual(findNarrativeDocumentationAssertions(validatorSource, validatorPath), [], `${validatorPath} must validate documentation structure, formulas, generated data, or executable behavior without freezing narrative prose`)
	}

	const paraphraseFriendlyFixture = `assert.match(html, /id="purpose"/)`
	const formulaFixture = `assert.match(openOracleIntegration, /data-source="amount = principal \\cdot rate"/)`
	const narrativeFixture = `assert.match(html, /The mechanism always follows this exact sentence/)`
	assert.deepEqual(findNarrativeDocumentationAssertions(paraphraseFriendlyFixture, 'paraphrase-fixture.mts'), [])
	assert.deepEqual(findNarrativeDocumentationAssertions(formulaFixture, 'formula-fixture.mts'), [])
	assert.equal(findNarrativeDocumentationAssertions(narrativeFixture, 'narrative-fixture.mts').length, 1)
}

function findNarrativeDocumentationAssertions(source: string, sourcePath: string): string[] {
	const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const violations: string[] = []
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'assert') {
			const assertionName = node.expression.name.text
			if ((assertionName === 'match' || assertionName === 'doesNotMatch') && node.arguments.length >= 2 && isStaticDocumentationExpression(node.arguments[0])) {
				const pattern = node.arguments[1]?.getText(sourceFile) ?? ''
				if (!isStructuredDocumentationPattern(pattern)) violations.push(`${sourcePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`)
			}
			if (assertionName === 'ok' && node.arguments.length > 0 && isNarrativeDocumentationIncludes(node.arguments[0], sourceFile)) {
				violations.push(`${sourcePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`)
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return violations
}

function isStaticDocumentationExpression(expression: ts.Expression | undefined): boolean {
	if (expression === undefined) return false
	if (ts.isIdentifier(expression)) {
		return new Set(['html', 'invariantsHtml', 'liquidationHtml', 'openOracleIntegration', 'whitepaperStatoblast', 'operatorReference', 'contractInteractionReference', 'openOracleHtml', 'auctionDesignHtml', 'statoblastHtml', 'requestCostEquation']).has(expression.text) || /(?:Entry|Row)$/.test(expression.text)
	}
	return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'blockWithId'
}

function isStructuredDocumentationPattern(pattern: string): boolean {
	if (/(?:data-source=|<mi>|<mn>)/.test(pattern)) return true
	if (/<(?:section|details) id=/.test(pattern) && !pattern.includes('[\\s\\S]')) return true
	return /(?:id|href|class)=/.test(pattern) && !pattern.includes(' ')
}

function isNarrativeDocumentationIncludes(expression: ts.Expression | undefined, sourceFile: ts.SourceFile): boolean {
	if (!expression || !ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression) || expression.expression.name.text !== 'includes') return false
	if (!isStaticDocumentationExpression(expression.expression.expression)) return false
	const argument = expression.arguments[0]
	if (argument === undefined) return false
	const argumentText = argument.getText(sourceFile)
	if (/^[`'"][A-Za-z_]\w*\([^`'"\n]*\)[`'"]$/.test(argumentText) || argumentText.includes('${') || argumentText.includes('/')) return false
	return /\s/.test(argumentText.slice(1, -1))
}

function assertEscalationContinuationReference(): void {
	assert.match(html, /href="\.\.\/reference\/merkle-mountain-range\.html"/)
}

function assertSystemDecisionForkTriggers(): void {
	const decisionFlow = diagramGraphSpecs['fig-statoblast-system-decision-flow']
	const nodes = decisionFlow.sections.flatMap(section => section.nodes)
	const forkEdges = decisionFlow.sections.flatMap(section => section.edges).filter(edge => edge.target === 'fork')
	const forkSources = forkEdges.map(edge => edge.source).sort()
	assert.deepEqual(forkSources, ['decision', 'universe-fork'], 'Statoblast lifecycle diagram must show local non-decision and an independent universe fork entering migration')
	assert.ok(forkEdges.find(edge => edge.source === 'decision')?.label?.includes('own-question'), 'Local non-decision must remain tied to the market question')
	assert.ok(forkEdges.find(edge => edge.source === 'universe-fork')?.label?.includes('unresolved operational'), 'An independent universe fork must only interrupt an unresolved operational pool')
	assert.ok(
		nodes.find(node => node.id === 'fork')?.details?.some(detail => detail.includes('fork question')),
		'Migrated children must follow the actual fork question rather than always using market outcomes',
	)
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
	assert.match(whitepaperStatoblast, /id="fees-capacity-liquidations"/)
	assert.match(securityPoolOperationsDelegate, /uint256 capacityOwnershipAddedAttoRep = Math\.mulDiv\(\s*attoRepAmount,\s*SecurityPoolUtils\.BPS_DENOMINATOR,\s*targetHealthFactorBps\s*\)/)
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
	assert.match(liquidationApprovalRegistry, /EIP712Domain\(string name,string version,uint256 chainId,address verifyingContract\)/)
	assert.match(
		securityPoolOperationsDelegate,
		/receiverOpenInterestAttoEth < minimumSecurityBondDebtAttoEth[\s\S]*targetOpenInterestAttoEthAfter == 0 \|\| targetOpenInterestAttoEthAfter >= minimumSecurityBondDebtAttoEth[\s\S]*targetOpenInterestAttoEthAfter == 0 \|\| targetVaultRepBackingAfterAttoRep >= minimumVaultRepDepositAttoRep[\s\S]*securityVaults\[request\.receiverVault\][\s\S]*minimumVaultRepDepositAttoRep/,
	)
	assert.match(
		securityPoolOperationsDelegate,
		/debtToMoveAttoEth = receiverOpenInterestAfterAttoEth - receiverOpenInterestBeforeAttoEth;[\s\S]*debtToMoveAttoEth <= nominalDebtToMoveAttoEth && debtToMoveAttoEth <= request\.requestedDebtAttoEth[\s\S]*nominalDebtToMoveAttoEth != 0 && debtToMoveAttoEth == 0[\s\S]*badDebtAttoEth = targetOpenInterestAttoEth - debtToMoveAttoEth/,
	)
	assert.match(securityPoolOperationsDelegate, /_getVaultBadDebtAttoEth\(request\.targetVault\) == 0[\s\S]*_getVaultBadDebtAttoEth\(request\.receiverVault\) == 0/)
	assertCoordinatorDataFunctionInventory()
}

function assertRepricingBoundaryDocs(): void {
	assert.match(invariantsHtml, /id="bal-03"/)
	assert.match(invariantsHtml, /id="vault-02"/)
	assert.match(securityPool, /function createCompleteSet\(\) external payable isOperational \{[\s\S]*SecurityPoolSettlementDelegate\.createCompleteSet/)
	assert.match(securityPoolSettlementDelegate, /function createCompleteSet\([\s\S]*uint256 nextSettlementCollateralAttoEth = settlementCollateralAttoEth \+ msg\.value;[\s\S]*_validateSettlementCollateral\(pool, nextSettlementCollateralAttoEth\)/)
	assert.match(securityPool, /function getCurrentMintingCapacityAttoEth\(\)[\s\S]*SecurityPoolUtils\.calculateMintingCapacityAttoEth\(\s*totalCapacityOwnershipAttoRep,/)
	const vaultOpenInterestBody = readSolidityFunctionBody(securityPool, 'function getVaultOpenInterestAttoEth(')
	assert.match(vaultOpenInterestBody, /SecurityPoolUtils\.calculateVaultOpenInterestAttoEth\([\s\S]*totalCapacityOwnershipAttoRep/)
	assert.doesNotMatch(vaultOpenInterestBody, /feeEligibleCapacityOwnershipAttoRep/)
	assert.match(securityPoolOperationsDelegate, /SecurityPoolUtils\.isVaultHealthyAtFactor\([\s\S]*minimumReceiverHealthFactorBps/)
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
	assert.doesNotMatch(escalationGameClaimDelegate, /moveEscalationClaim|payoutClaimBundle|getClaimOwner|liquidationClaimRep/)
	assert.doesNotMatch(escalationGameEscrow, /Escrow principal missing/)
	assert.match(
		escalationGameClaimDelegate,
		/retainedCumulativeAmountAttoRep = IEscalationClaimCheckpointSource\(sourceGame\)[\s\S]*\.applyInheritedClaimRetention\(cumulativeAmountAttoRep, parentDepositIndex\);[\s\S]*retainedPreviousAmountAttoRep = IEscalationClaimCheckpointSource\(sourceGame\)[\s\S]*\.applyInheritedClaimRetention\(cumulativeAmountAttoRep - amountAttoRep, parentDepositIndex\);[\s\S]*return retainedCumulativeAmountAttoRep - retainedPreviousAmountAttoRep/,
	)
}

function assertEscalationGameBytecodeDocs(): void {
	const creationBytes = escalationGameBytecodeSnapshot.match(/"creationBytes":\s*(\d+)/)?.[1]
	const deployedBytes = escalationGameBytecodeSnapshot.match(/"deployedBytes":\s*(\d+)/)?.[1]
	assert.ok(creationBytes, 'EscalationGame bytecode snapshot must record creationBytes')
	assert.ok(deployedBytes, 'EscalationGame bytecode snapshot must record deployedBytes')
}

function assertAggregateEscalationContinuationDocs(): void {
	assert.match(escalationGameCarry, /forkCarryDisputeStakedAttoRep/, 'continuation implementation must retain an aggregate dispute-staked REP backing bucket')
	assert.match(invariantsHtml, /id="fork-08"/)
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
	assert.deepEqual(enumMembers, ['None', 'Local', 'InheritedThresholdTie'])
	assert.match(securityPoolForker, /function getQuestionOutcome\([\s\S]*if \(data\.fixedQuestionOutcomePlusOne > 0\)[\s\S]*return BinaryOutcomes\.BinaryOutcome\(data\.fixedQuestionOutcomePlusOne - 1\)/)
	assert.match(escalationGameCalculations, /function getFinalQuestionResolution\(\)[\s\S]*if \(block\.timestamp <= getEscalationGameEndDate\(\)\) return BinaryOutcomes\.BinaryOutcome\.None/)
}

function assertAuditFindingRemediations(): void {
	assert.match(securityPool, /function updateRetentionRate\(\) public \{[\s\S]*SecurityPoolUtils\.calculateRetentionRate\([\s\S]*getCurrentMintingCapacityAttoEth\(\)/, 'SecurityPool retention updates must use live oracle-priced minting capacity')
	assert.match(securityPoolUtils, /if \(mintingCapacityAttoEth == 0\) return MAX_RETENTION_RATE;/, 'SecurityPoolUtils must select maximum retention for zero minting capacity')
	assert.match(escalationGameCalculations, /if \(forkTime > getEscalationGameEndDate\(\)\) \{[\s\S]*actualForkThresholdAttoRep = nonDecisionThresholdAttoRep;/, 'Escalation payout must restore the configured threshold only for forks strictly after the scheduled game end')
	for (const boundaryName of ['one second before', 'exactly at', 'one second after']) {
		assert.ok(escalationGameForkThresholdTest.includes(boundaryName), `Escalation fork-threshold regression must cover ${boundaryName} game end`)
	}
	assert.match(truthAuctionInterface, /event EthRefundCredited\(address indexed bidder, uint256 amountAttoEth, uint256 pendingAmountAttoEth\);/, 'Truth-auction interface must declare the refund-credit delta and resulting balance')
	assert.match(truthAuctionInterface, /event PendingEthRefundWithdrawn\(address indexed bidder, uint256 amountAttoEth\);/, 'Truth-auction interface must declare successful credited-refund withdrawals')
	assert.doesNotMatch(truthAuction, /REFUND_PUSH_GAS_LIMIT|_payOrDeferRefund/, 'Truth-auction settlement must not retain the callback-based push-refund path')
	assert.match(
		securityPoolForker,
		/function _getTruthAuctionCap\([\s\S]*Math\.ceilDiv\(data\.migratedAttoRep, SecurityPoolUtils\.MAX_AUCTION_VAULT_HAIRCUT_DIVISOR\)[\s\S]*Math\.mulDiv\(migratedPoolRepRetentionAttoRep, combinedAuctionableAttoRep, poolAuctionableRepAtForkAttoRep, Math\.Rounding\.Ceil\)[\s\S]*function _finalizeBackingUnitsAfterAuction\([\s\S]*uint256 incumbentRepAfterAttoRep =[\s\S]*Math\.mulDiv\(poolRepBeforeAttoRep, combinedRepBeforeAttoRep - repPurchasedAttoRep, combinedRepBeforeAttoRep\)[\s\S]*if \(incumbentRepAfterAttoRep == 0\)[\s\S]*auctionRepBackingUnitsPerAttoRep = SecurityPoolUtils\.PRICE_PRECISION;[\s\S]*Math\.ceilDiv\(poolRepAfterAttoRep, incumbentRepAfterAttoRep\)/,
		'Truth-auction REP backing units must reserve positive migrated claims and use bounded child-local scaling',
	)
	assert.match(contractReferenceGenerator, /settleAuctionBids[\s\S]*EthRefundCredited[\s\S]*claimAuctionProceeds[\s\S]*EthRefundCredited/, 'Generated public wrapper rows must expose refund-credit signals')
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
	assert.match(activeTreeEntry, /href="#auc-10"><code>AUC-10<\/code><\/a>/, 'AUC-11 must link historical-prefix ownership to AUC-10')
	assert.match(carryCommitmentEntry, /href="#esc-03"><code>ESC-03<\/code><\/a>/, 'ESC-14 must link unresolved-total ownership to ESC-03')
	assert.match(auctionLiabilityEntry, /href="#auc-05"><code>AUC-05<\/code><\/a>/, 'AUC-12 must link settlement-allocation ownership to AUC-05')
	assert.match(eventReplayEntry, /href="\.\/contracts\.html"/, 'OBS-01 must link the canonical contract interaction reference')
	assert.match(shareSupplyEntry, /href="#fork-10"><code>FORK-10<\/code><\/a>/, 'SHARE-06 must link migration ownership to FORK-10')
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
	assert.match(capacityOwnershipEntry, /href="\.\.\/explanation\/truth-auctions\.html#clearing"/)
	assert.match(vaultEntry, /href="\.\.\/\.\.\/solidity\/contracts\/statoblast\/SecurityPool\.sol"><code>_registerVault<\/code><\/a>/)
	assert.match(activeAuctionEntry, /href="#auc-12"><code>AUC-12<\/code><\/a>/)
}

function assertZoltarForkDepths(): void {
	const protocolConfig = getMainnetProtocolConfig()
	assert.equal(protocolConfig.forkThresholdDivisor, 20n, 'Zoltar fork threshold divisor changed')
	assert.equal(protocolConfig.forkBurnDivisor, 5n, 'Zoltar fork burn divisor changed')
	assert.match(zoltar, /_forkBurnDivisor >= Constants\.MINIMUM_FORK_BURN_DIVISOR/)
	assert.match(zoltar, /theoreticalSupplyAttoRep \/ forkThresholdDivisor \+[\s\S]*theoreticalSupplyAttoRep % forkThresholdDivisor == 0 \? 0 : 1/)
	assert.match(zoltar, /uint256 migrationRepBalanceAttoRep = forkThresholdAttoRep - forkThresholdAttoRep \/ forkBurnDivisor;/)

	const nonDivisibleThreshold = 6n
	const haircut = nonDivisibleThreshold / protocolConfig.forkBurnDivisor
	const migrationCredit = nonDivisibleThreshold - haircut
	assert.equal(haircut, 1n, 'non-divisible fork threshold haircut must round down')
	assert.equal(migrationCredit, 5n, 'non-divisible fork threshold remainder must round the 80% migration credit up')
}

function assertRecursiveForkGasStatusDocs(): void {
	assert.match(invariantsHtml, /id="ext-05"/)
}

function assertCoordinatorRecoveryBranch(): void {
	assert.match(openOracleIntegration, /<section id="callback-rejection-and-recovery">/)
	assert.match(
		priceCoordinator,
		/function recoverSettledPendingReport\(\)[\s\S]*require\(reportId != 0, 'No report to recover'\)[\s\S]*require\(settlementTimestamp != 0, 'Report not settled'\)[\s\S]*pendingReportId = 0;[\s\S]*pendingReportSponsor = address\(0\);[\s\S]*pendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;[\s\S]*_failPendingSettlementOperations\('Report recovered'\)/,
		'coordinator recovery must require settlement and clear pending state before failing every attached operation',
	)
	assert.match(priceCoordinator, /require\(msg\.sender == address\(openOracle\), 'Only OpenOracle'\)[\s\S]*require\(reportId == pendingReportId, 'Oracle report mismatch'\)/, 'coordinator callback must enforce the configured oracle and current pending report identity')
	assert.match(openOracleIntegration, /data-source="requestPriceCostAttoEth = block\.basefee \\cdot 4 \\cdot \(callbackGasLimit \+ gasConsumedOpenOracleReportPrice\) \+ 101"/, 'OpenOracle documentation must retain the canonical request-cost equation')
	const requestCostEquation = openOracleIntegration.match(/<figure class="equation" id="eq-openoracle-request-price-cost">[\s\S]*?<\/figure>/)?.[0]
	assert.ok(requestCostEquation, 'OpenOracle documentation must retain the request-cost equation figure')
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
	assert.equal(createHash('sha256').update(openOracleSource).digest('hex'), '7afa3edc2c0fb21ea560e67ad5220e461e9b5d3ef9dd68d18081ffef2d157728', 'Vendored OpenOracle source changed; compare it with the pinned openPunt revision and update the source fingerprint')
	for (const pinnedRevision of ['4e5cffb7203ccc5d47ab986d74c04796a8f51302', 'c64a1edb67b6e3f4a15cca8909c9482ad33a02b0', 'src/OpenOracleSlim.sol', 'OpenZeppelin Contracts v5.4.0']) {
		assert.ok(openOracleProvenance.includes(pinnedRevision), `OpenOracle provenance must retain ${pinnedRevision}`)
	}
	assert.match(liquidationHtml, /id="punitive-liquidation"/)
	assert.doesNotMatch(whitepaperStatoblast, /id="fig-statoblast-auction-clearing"/, 'whitepaper must delegate auction clearing to the canonical focused diagram')
}

function assertLifecycleReferences(): void {
	assert.match(escalationGameState, /activationDelay = 3 days/)
	assert.match(escalationGameTypes, /ESCALATION_TIME_LENGTH = 4233600; \/\/ 7 weeks/)
	assert.match(securityPoolUtils, /MIGRATION_TIME = 8 weeks/)
	for (const systemState of ['Operational', 'PoolForked', 'ForkMigration', 'ForkTruthAuction']) {
		assert.match(securityPoolInterface, new RegExp(`\\b${systemState}\\b`))
	}
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
	assert.match(contractReferenceGenerator, /interaction\.declarations\.length, 1,[\s\S]*interaction rows must describe exactly one entrypoint name; split materially different guards, effects, and signals into separate rows/, 'generated interaction rows must remain limited to one entrypoint name')
	assert.match(invariantsHtml, /id="fork-10"/)
	assert.match(invariantsHtml, /id="fork-11"[\s\S]*href="#share-04"><code>SHARE-04<\/code>/)
	assert.match(securityPoolFactory, /zoltar\.getNonDecisionThresholdAttoRep\(universeId\) > _getInitialEscalationDepositAttoRep\(universeId\)/)
	assert.match(securityPoolFactory, /SecurityPoolUtils\.calculateInitialEscalationDepositAttoRep\(zoltar\.getUniverseTheoreticalSupplyAttoRep\(universeId\)\)/)
	assert.doesNotMatch(securityPoolFactory, /initialEscalationGameDepositAttoRep/, 'Factory must not duplicate the pool-derived escalation deposit')
	assert.match(securityPool, /universeTheoreticalSupplyAttoRep = _zoltar\.getUniverseTheoreticalSupplyAttoRep\(_universeId\)[\s\S]*initialEscalationGameDepositAttoRep = SecurityPoolUtils\.calculateInitialEscalationDepositAttoRep\(universeTheoreticalSupplyAttoRep\)/)
	assert.match(securityPoolUtils, /function calculateInitialEscalationDepositAttoRep\([\s\S]*theoreticalSupplyAttoRep \/ 10_000_000[\s\S]*supplyBasedDepositAttoRep < 1e18 \? 1e18 : supplyBasedDepositAttoRep/)
	assert.match(securityPoolUtils, /function calculateMinimumVaultRepDepositAttoRep\([\s\S]*configuredMinimumAttoRep == 0 \? theoreticalSupplyAttoRep \/ 100_000 : configuredMinimumAttoRep/)
	assert.match(securityPool, /minimumVaultRepDepositAttoRep = SecurityPoolUtils\.calculateMinimumVaultRepDepositAttoRep\([\s\S]*securityPoolFactory\.minimumVaultRepDepositAttoRep\(\)/)
	assert.match(invariantsHtml, /id="esc-13"/)
	assert.match(securityPool, /deployEscalationGame\(\s*initialEscalationGameDepositAttoRep,\s*zoltar\.getNonDecisionThresholdAttoRep\(universeId\)\s*\)/)
	assert.match(escalationGameFactory, /_nonDecisionThresholdAttoRep > 1[\s\S]*startBondAttoRep >= _nonDecisionThresholdAttoRep[\s\S]*startBondAttoRep = _nonDecisionThresholdAttoRep - 1/)
	assert.match(deploymentStatusOracle, /DeploymentAddressesSet\(address\[\] deploymentAddresses\)/)
	assert.match(escalationGame, /function startFromFork\([\s\S]*?forkContinuation = true;[\s\S]*?forkElapsedAtStart = elapsedAtFork;[\s\S]*?emit GameContinuedFromFork/)
	assert.match(escalationGame, /function resumeFromFork\(\) external \{[\s\S]*EscalationGameDepositDelegate\.resumeFromFork/)
	assert.match(escalationGameDepositDelegate, /function resumeFromFork\(\) external \{[\s\S]*?require\(forkResumedAt == 0, 'Fork resumed'\);[\s\S]*?forkResumedAt = block\.timestamp;[\s\S]*?emit ForkContinuationResumed/)
	assert.match(escalationGameDepositDelegate, /require\(game\.isForkCarryFundingComplete\(\), 'Fork carry underfunded'\)/)
	assert.match(escalationGameCarry, /function initializeForkCarrySnapshotWithResolutionBalances\([\s\S]*?\) external \{\s*_initializeForkCarrySnapshot\(/)
	assert.match(escalationGameCarry, /function _initializeForkCarrySnapshot\([\s\S]*?require\(msg\.sender == address\(securityPool\), 'Only pool'\);\s*require\(forkContinuation, 'No fork mode'\);\s*require\(!forkCarrySnapshotInitialized\(\), 'Snapshot initialized'\)/)
	assert.match(securityPool, /function withdrawForkedEscalationDeposits\([\s\S]*for \(uint256 index = 0; index < proofs\.length; index\+\+\)[\s\S]*_registerVault\(beneficiaryVault\)/)
	assert.match(securityPool, /function withdrawFromEscalationGame\([\s\S]*for \(uint256 index = 0; index < depositIndexes\.length; index\+\+\)[\s\S]*_registerVault\(beneficiaryVault\)/)
	assert.match(
		securityPool,
		/function isEscalationResolved\(\) public view returns \(bool\) \{\s*return\s+hasInheritedForkOutcome \|\|\s+\(address\(escalationGame\) != address\(0x0\) &&\s+ISecurityPoolForker\(securityPoolForker\)\.getQuestionOutcome\(ISecurityPool\(payable\(address\(this\)\)\)\) !=\s+BinaryOutcomes\.BinaryOutcome\.None\);/,
	)
	assert.match(securityPoolForker, /if \(data\.fixedQuestionOutcomePlusOne > 0\)\s*return BinaryOutcomes\.BinaryOutcome\(data\.fixedQuestionOutcomePlusOne - 1\)/)
	assert.match(securityPool, /function createCompleteSet\(\) external payable isOperational \{[\s\S]*SecurityPoolSettlementDelegate\.createCompleteSet/, 'Complete-set issuance must delegate its atomic accounting transition')
	assert.match(securityPoolSettlementDelegate, /function createCompleteSet\([\s\S]*nextSettlementCollateralAttoEth[\s\S]*_validateSettlementCollateral\(pool, nextSettlementCollateralAttoEth\);/, 'Complete-set issuance must compare resulting total collateral against live oracle-priced capacity and backing')
	assert.match(securityPool, /function attoSharesToAttoEth\(uint256 amountAttoShares\)[\s\S]*return \(amountAttoShares \* settlementCollateralAttoEth\) \/ shareTokenSupplyAttoShares/)
	assert.match(securityPool, /function redeemCompleteSet\(uint256 amountAttoShares\)[\s\S]*SecurityPoolOperationsDelegate\.redeemCompleteSet/)
	assert.match(securityPoolOperationsDelegate, /function redeemCompleteSet\([\s\S]*amountAttoShares \* settlementCollateralAttoEth\) \/ shareTokenSupplyAttoShares[\s\S]*shareTokenSupplyAttoShares == 0[\s\S]*badDebtGeneration\+\+/)
	assert.match(securityPool, /function redeemShares\(\)[\s\S]*SecurityPoolOperationsDelegate\.redeemShares/)
	assert.match(securityPoolOperationsDelegate, /function redeemShares\([\s\S]*settlementCollateralAttoEth\) \/ shareTokenSupplyAttoShares[\s\S]*shareTokenSupplyAttoShares -= winningSharesBurnedAttoShares[\s\S]*shareTokenSupplyAttoShares == 0[\s\S]*badDebtGeneration\+\+/)
	assert.match(securityPoolForker, /securityPool\.setTotalSharesAttoShares\(parent\.shareTokenSupplyAttoShares\(\)\)/)
	assert.match(diagramModelsSource, /withdraw REP or liquidation/)
	assert.doesNotMatch(diagramModelsSource, /withdraw, capacity ownership/)
	assert.match(securityPoolUtils, /capacityOwnershipToMoveAttoRep =[\s\S]*Math\.mulDiv\(targetCapacityOwnershipAttoRep, debtToMoveAttoEth, targetOpenInterestAttoEth\)/)
	assert.match(securityPoolOperationsDelegate, /request\.receiverVault != request\.targetVault[\s\S]*receiverOpenInterestAttoEth < minimumSecurityBondDebtAttoEth[\s\S]*revert\('Receiver debt below minimum'\)/)
	assert.match(securityPoolOperationsDelegate, /SecurityPoolUtils\.isVaultHealthyAtFactor\([\s\S]*minimumReceiverHealthFactorBps[\s\S]*'Receiver bad'/)
	assert.match(securityPool, /function _requireVaultCoverage\([\s\S]*uint256 openInterestAttoEth[\s\S]*SecurityPoolUtils\.isVaultHealthy/)
	assert.match(securityPool, /function _requirePoolCoverage\([\s\S]*uint256 totalOpenInterestAttoEth[\s\S]*SecurityPoolUtils\.isVaultHealthy/)
	assert.match(securityPool, /function depositToEscalationGame\([^}]+if \(hasInheritedForkOutcome\) revert\(\);/)
	assert.match(securityPoolForker, /uint256 migrationAmountAttoRep = data\.ownFork \? data\.vaultRepAtForkAttoRep : data\.auctionableAttoRepAtFork;\s*if \(migrationAmountAttoRep > 0\) \{\s*for \(uint256 index = 0; index < outcomeIndices\.length; index\+\+\)/)
	assert.match(escalationGameForker, /\(ISecurityPool child, EscalationGame childEscalationGame\) = _getOrDeployChildPool\(parent, uint8\(outcomeIndex\)\);[\s\S]*_claimWinningDepositsFromGame\([\s\S]*emit ClaimForkedEscalationDepositsToWallet\(/)
	assert.match(securityPoolForkerVaultMigrationBase, /if \(address\(zoltar\.getRepToken\(childUniverseId\)\) == address\(0x0\)\) \{\s*zoltar\.deployChild\(parent\.universeId\(\), outcomeIndex\)/)
	assert.match(truthAuction, /function finalize\(\) external \{[\s\S]*payable\(owner\)\.call\{\s*value:\s*raisedAttoEthToSend\s*\}\(''\)[\s\S]*require\(sent, 'Auction failed to send raised ETH to the owner'\)/)
	assert.match(truthAuction, /function withdrawBids\([\s\S]*for \(uint256 i = 0; i < tickIndices\.length; i\+\+\)[\s\S]*_creditRefund\(withdrawFor, totalRefundAttoEth\)/)
	assert.ok(isRecord(compiledContractArtifacts))
	const compiledContracts = compiledContractArtifacts['contracts']
	assert.ok(isRecord(compiledContracts))
	const truthAuctionSourceArtifact = compiledContracts['contracts/statoblast/UniformPriceDualCapBatchAuction.sol']
	assert.ok(isRecord(truthAuctionSourceArtifact))
	const truthAuctionArtifact = truthAuctionSourceArtifact['UniformPriceDualCapBatchAuction']
	assert.ok(isRecord(truthAuctionArtifact))
	const truthAuctionAbi = truthAuctionArtifact['abi']
	assert.ok(Array.isArray(truthAuctionAbi))
	const withdrawBidsAbi = truthAuctionAbi.find(entry => isRecord(entry) && entry['type'] === 'function' && entry['name'] === 'withdrawBids')
	assert.ok(isRecord(withdrawBidsAbi))
	const withdrawBidsOutputs = withdrawBidsAbi['outputs']
	assert.ok(Array.isArray(withdrawBidsOutputs))
	assert.deepEqual(
		withdrawBidsOutputs.map(output => {
			assert.ok(isRecord(output))
			return output['name']
		}),
		['totalFilledAttoRep', 'totalRefundAttoEth', 'totalProRataAllocation', 'totalSecondaryProRataAllocation'],
	)
	assert.match(truthAuction, /function _refundLosingBids\([\s\S]*for \(uint256 i = 0; i < tickIndices\.length; i\+\+\)[\s\S]*_creditRefund\(bidder, totalRefundAttoEth\)/)
	assert.match(truthAuction, /function _creditRefund\([\s\S]*if \(amountAttoEth == 0\) return;[\s\S]*pendingEthRefundsAttoEth\[bidder\] = pendingAmountAttoEth;[\s\S]*emit EthRefundCredited\(/)
	assert.match(
		truthAuction,
		/function withdrawPendingEthRefund\(\) external \{[\s\S]*pendingEthRefundsAttoEth\[msg\.sender\] = 0;[\s\S]*emit PendingEthRefundWithdrawn\(msg\.sender, amountAttoEth\);[\s\S]*payable\(msg\.sender\)\.call\{\s*value:\s*amountAttoEth\s*\}\(''\)[\s\S]*require\(sent, 'Auction failed to withdraw credited ETH refund'\)/,
	)
	assert.match(truthAuction, /function startAuction\([\s\S]*block\.timestamp <= type\(uint48\)\.max/)
	assert.match(truthAuction, /function submitBid\([\s\S]*msg\.value <= type\(uint128\)\.max/)
	assert.match(truthAuction, /function _appendBid\([\s\S]*cumulativeBidAttoEth <= type\(uint128\)\.max/)
	assert.match(constants, /uint88 constant MAX_ATTO_REP = 11_000_000e18/)
	assert.match(zoltar, /genesisSupply <= Constants\.MAX_ATTO_REP/)
	assert.match(sepoliaRepAllocations, /const SEPOLIA_REP_MINT_CAP = parseUnits\('11000000', 18\)/)
	assert.match(sepoliaRepAllocations, /SEPOLIA_REP_MINT_CAP \/ BigInt\(SEPOLIA_REP_HOLDERS\.length\)/)
	assert.match(securityPool, /function getVaultCount\(\) external view returns \(uint256\) \{\s*return vaultAddresses\.length;/)
	assert.match(securityPool, /function getVaults\([\s\S]*vaultAddresses\[vaultCount - startIndex - index - 1\]/)
	assert.match(securityPool, /function _registerVault\(address vault\) private \{\s*if \(vault == address\(0x0\) \|\| isKnownVault\[vault\]\) return;\s*isKnownVault\[vault\] = true;\s*vaultAddresses\.push\(vault\);\s*\}/)
	assert.match(zoltar, /function splitMigrationRep\([\s\S]*require\(universes\[universeId\]\.forkTime != 0[\s\S]*splitRepInternal\(universeId, amountAttoRep, outcomeIndexes\)/)
	assert.match(zoltar, /function splitRepInternal\([\s\S]*for \(uint256 i = 0; i < outcomeIndexes\.length; i\+\+\)[\s\S]*reputationToken\.mint\(msg\.sender, amountAttoRep\)[\s\S]*emit MigrationRepSplit\(/)
	assert.match(reputationToken, /function mint\(address account, uint256 valueAttoRep\)[\s\S]*_mint\(account, valueAttoRep\);[\s\S]*emit Mint\(account, valueAttoRep\)/)
	assert.match(securityPoolForker, /function _claimAuctionProceeds\([\s\S]*require\(data\.truthAuction\.finalized\(\), 'Not final'\)[\s\S]*data\.truthAuction\.withdrawBids\([\s\S]*SecurityPoolForkerVaultMigrationDelegate\.creditAuctionProceeds/)
	assert.match(escalationGameSettlement, /function drainAllRep\(address receiver\)[\s\S]*amountAttoRep = repToken\.balanceOf\(address\(this\)\);[\s\S]*if \(amountAttoRep == 0\) return 0;[\s\S]*_safeTransferRep\(receiver, amountAttoRep\)/)
	assert.match(escalationGameSettlement, /function drainAllRep\(address receiver\)[\s\S]*require\(msg\.sender == address\(securityPool\), 'Only pool'\)/)
	assert.match(securityPool, /function activateForkMode\(\)[\s\S]*if \(hasInheritedForkOutcome\) revert\(\)[\s\S]*systemState = SystemState\.PoolForked;[\s\S]*escalationGame\.drainAllRep\(msg\.sender\)/)
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
	assert.match(securityPoolForkerBase, /function _finalizeEscalationStateAfterAuction\([\s\S]*childEscalationGame = child\.escalationGame\(\);\s*_validateChildEscalationGame\(child, childEscalationGame\);[\s\S]*_finalizeAwaitingForkContinuationIfReady\(child, childEscalationGame\)/)
	assert.match(securityPoolForker, /if \(!parentForkData\.unresolvedEscalationAtFork\) return childEscalationGame;\s*if \(address\(childEscalationGame\) == address\(0x0\)\)/)
	assert.match(securityPool, /updateVaultFees\(request\.targetVault\);\s*updateVaultFees\(request\.receiverVault\);[\s\S]*abi\.encodeCall\(SecurityPoolOperationsDelegate\.performBundledLiquidation, \(executionRequest\)\)/)
	assert.match(securityPoolOperationsDelegate, /securityVaults\[request\.receiverVault\]\.capacityOwnershipAttoRep \+= capacityOwnershipToMoveAttoRep/)
	assert.doesNotMatch(escalationGameClaimDelegate, /function moveEscalationClaim|payoutClaimBundle|forkCarryPayoutClaimImportCursor/)
	assert.doesNotMatch(securityPoolOperationsDelegate, /_moveEscalationClaim|previewLiquidationClaimRep|moveEscalationClaim/)
	assert.match(escalationGameSettlement, /_claimDepositForWinning\(depositIndex, outcome, false\)/)
	assert.match(escalationGameState, /uint256 claimUnits = _repToClaimUnits\(amountAttoRep\);[\s\S]*bundle\.disputeStakedRepClaimUnits -= claimUnits/)
	assert.match(escalationGameDepositDelegate, /recordForkedEscrowForOutcome\([\s\S]*_increaseEscrowedRepForBundle\(depositor, effectiveChildAttoRep, false\)/)
	assert.match(escalationGameEscrow, /function recordForkedEscrowForOutcome\([\s\S]*EscalationGameDepositDelegate\.recordForkedEscrowForOutcome/)
	assert.match(escalationGameDepositDelegate, /function recordForkedEscrowForOutcome\([\s\S]*if \(sourcePrincipalAttoRep == 0 && childRepAmountAttoRep == 0\) return;[\s\S]*emit ForkedEscrowRecorded\(/)
	assert.match(escalationGame, /function _initializeStartParams\([\s\S]*if \(owner != msg\.sender\) revert\(\);/)
	assert.match(escalationGame, /function recordDepositFromSecurityPool\([\s\S]*require\(msg\.sender == address\(securityPool\), 'Only security pool'\);/)
	assert.match(escalationGameDepositDelegate, /function resumeFromFork\(\) external \{[\s\S]*IEscalationGameDepositContext game = IEscalationGameDepositContext\(address\(this\)\);[\s\S]*require\(msg\.sender == game\.securityPool\(\), 'Only pool'\);/)
	assert.match(escalationGameDepositDelegate, /function applyTruthAuctionHaircut\([\s\S]*require\(msg\.sender == IEscalationGameSecurityPoolContext\(poolAddress\)\.securityPoolForker\(\), 'Only forker'\);/)
	assert.match(escalationGameEscrow, /function _exportForkedEscrowByOutcome\([\s\S]*if \(exported\) \{[\s\S]*emit ForkedEscrowExported\([\s\S]*if \(totalChildRepToTransferAttoRep == 0\) return/)
	assert.match(securityPool, /function transferEth\(address payable receiver, uint256 amountAttoEth\)[\s\S]*_emitPoolAccountingCheckpoint\(AccountingReason\.CollateralReconciliation, address\(0x0\)\);[\s\S]*_sendEth\(receiver, amountAttoEth\)/)
	assert.match(erc1155, /function _mint\(address to, uint256 id, uint256 value\)[\s\S]*emit TransferSingle\([\s\S]*_doSafeTransferAcceptanceCheck\(/)
	assert.match(erc1155, /function _mintBatch\(address to, uint256\[\] memory ids, uint256\[\] memory values\)[\s\S]*emit TransferBatch\([\s\S]*_doSafeBatchTransferAcceptanceCheck\(/)
	assert.match(
		shareToken,
		/alreadyMigratedAttoShares = migratedShareAmountAttoShares[\s\S]*amountAttoShares = fromIdBalanceAttoShares - alreadyMigratedAttoShares[\s\S]*migratedSourceBalanceLocked\[fromId\]\[msg\.sender\] = true[\s\S]*_mint\(msg\.sender, toId, amountAttoShares\)[\s\S]*emit Migrate\(msg\.sender, fromId, toId, amountAttoShares\)/,
	)
	assert.doesNotMatch(shareToken, /_burn\(msg\.sender, fromId, fromIdBalanceAttoShares\)/)
	assert.match(priceCoordinator, /function requestPrice\([\s\S]*if \(excess > 0\) \{[\s\S]*payable\(msg\.sender\)\.call\{\s*value:\s*excess\s*\}\(''\)[\s\S]*require\(sent, 'Oracle coordinator failed to refund excess ETH bounty'\)/)
	assert.match(priceCoordinator, /function requestPriceIfNeededAndStageOperation\([\s\S]*if \(refund > 0\) \{[\s\S]*payable\(msg\.sender\)\.call\{\s*value:\s*refund\s*\}\(''\)[\s\S]*require\(sent, 'Oracle coordinator failed to return unused ETH'\)/)
	assert.match(priceCoordinator, /function recoverSettledPendingReport\(\)[\s\S]*storedGame\(reportId\)[\s\S]*require\(settlementTimestamp != 0, 'Report not settled'\)[\s\S]*_failPendingSettlementOperations\('Report recovered'\)/)
	assert.match(
		securityPool,
		/function assignFinalizedAuctionFees\(address vault, uint256 amountAttoRep, uint256 auctionFeeIndexAtFinalization\) external onlyForker \{[\s\S]*SecurityPoolUtils\.calculateVaultFee\(amountAttoRep, feeIndex - auctionFeeIndexAtFinalization, previousVaultFeeRemainder\)[\s\S]*unallocatedAccruedFeesAttoEth -= fees;[\s\S]*_emitVaultAccountingCheckpoint\(vault\);/,
	)
	assert.ok(contractInteractionReference.includes('assignFinalizedAuctionFees(vault, amountAttoRep, auctionFeeIndexAtFinalization)'))
	assert.match(securityPool, /function setAwaitingForkContinuation\(bool shouldAwait\) external onlyForker \{\s*awaitingForkContinuation = shouldAwait;\s*emit AwaitingForkContinuationSet\(awaitingForkContinuation\)/)
	assert.match(securityPool, /function setSystemState\(SystemState newState\) external onlyForker \{\s*systemState = newState;\s*emit SystemStateSet\(systemState\)/)
	assert.match(securityPool, /function configureVault\([\s\S]*?\) external onlyForker \{[\s\S]*?_emitPoolAccountingCheckpoint\(AccountingReason\.CapacityOwnershipChange, vault\)/)
	assert.doesNotMatch(securityPool, /lastDepositTargetHealthFactorBpsByVault/, 'Deposit targets must remain event history rather than persistent pool storage')
	assert.match(securityPool, /function setTotalRepBackingUnits\(uint256 newDenominator\) external onlyForker \{\s*totalRepBackingUnits = newDenominator;\s*emit TotalRepBackingUnitsSet\(totalRepBackingUnits\)/)
	assert.match(securityPool, /function setTotalSharesAttoShares\(uint256 newTotalSharesAttoShares\) external onlyForker \{\s*shareTokenSupplyAttoShares = newTotalSharesAttoShares;\s*emit ShareTokenSupplySet\(shareTokenSupplyAttoShares\)/)
	assert.match(securityPool, /function setPoolFinancials\([\s\S]*?lastUpdatedFeeAccumulator = block\.timestamp;[\s\S]*?_emitPoolAccountingCheckpoint\(AccountingReason\.ForkFinalization, address\(0x0\)\)/)
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
	assert.match(
		escalationGameSettlement,
		/function withdrawDeposit\(\s*CarriedDepositProof calldata proof,[\s\S]*?require\(questionResolution != BinaryOutcomes\.BinaryOutcome\.None, 'Question not final'\)[\s\S]*?'Parent deposit claimed'[\s\S]*?require\(outcome == questionResolution, 'Not winning outcome'\)[\s\S]*?_verifyAndConsumeCarriedDepositProof/,
	)
	assert.match(escalationGameEscrow, /function _exportVaultUnresolvedTotals\([\s\S]*?require\(!localUnresolvedTotalsExportedByVault\[vault\], 'Vault totals exported'\)[\s\S]*?emit VaultUnresolvedTotalsExported\([\s\S]*?if \(principalToTransferAttoRep == 0\) return principalByOutcomeAttoRep/)
	assert.match(securityPoolFactory, /bytes32 securityPoolSalt = keccak256\([\s\S]*abi\.encode\(\s*parent,\s*universeId,\s*questionId,\s*statoblastSecurityMultiplierBps,\s*initialReportPriorityFeeAttoEthPerGas\s*\)/)
	assert.match(securityPoolFactory, /bytes32 securityPoolSalt = keccak256\([\s\S]*abi\.encode\(\s*address\(0x0\),\s*universeId,\s*questionId,\s*statoblastSecurityMultiplierBps,\s*initialReportPriorityFeeAttoEthPerGas\s*\)/)
	assert.match(priceCoordinatorFactory, /bytes32 deploymentSalt = keccak256\(abi\.encode\(msg\.sender, salt\)\)[\s\S]*priceCoordinatorDeploymentWorker\.deploy\([\s\S]*deploymentSalt[\s\S]*liquidationApprovalRegistryDeployer\.deploy\([\s\S]*address\(coordinator\),\s*deploymentSalt/)
	assert.match(truthAuctionFactory, /new UniformPriceDualCapBatchAuction\{\s*salt:\s*keccak256\(abi\.encode\(msg\.sender, salt\)\)\s*\}/)
	assert.match(securityPoolDeployer, /create2\(0, add\(initCode, 0x20\), mload\(initCode\), 0\)/)
	assert.match(securityPoolFactory, /shareTokenFactory\.deployShareToken\(originId, questionId\)/)
	assert.match(shareTokenFactory, /new ShareToken\{\s*salt:\s*salt\s*\}\(msg\.sender, zoltar, questionId\)/)
	assert.match(priceCoordinator, /maximumPriorityFeeReportAttoEth \/= 2/)
	assert.match(priceCoordinator, /'Initial report priority fee exceeds OpenOracle limits'/)
	for (const emitterFunction of ['emitPoolAccountingCheckpoint', 'emitVaultAccountingCheckpoint']) {
		assert.match(securityPoolEventEmitter, new RegExp(`function ${emitterFunction}\\([\\s\\S]*?\\) external payable`), `${emitterFunction} must remain externally payable for delegatecall flows`)
	}
	assert.match(securityPoolEventEmitter, /contract SecurityPoolEventEmitter is SecurityPoolStorage/)
	assert.match(securityPoolEventEmitter, /contract SecurityPoolForkEventEmitter is SecurityPoolForkerStorage, ISecurityPoolForkerEvents/)
	assert.match(securityPoolEventEmitter, /function emitForkSnapshotEvents\(\s*ISecurityPool parent,\s*address migrationProxy,\s*address sourceGame,\s*uint256 totalPoolHeldRepAtForkAttoRep,\s*uint256 disputeStakedRepAtForkAttoRep,\s*uint256 resultingLockedAttoRep\s*\) external payable/)
	assert.match(
		securityPoolForker,
		/mstore\(pointer, shl\(224, 0x408d33da\)\)[\s\S]*mstore\(add\(pointer, 0x04\), parent\)[\s\S]*mstore\(add\(pointer, 0x24\), migrationProxy\)[\s\S]*mstore\(add\(pointer, 0x44\), sourceGame\)[\s\S]*mstore\(add\(pointer, 0x64\), totalPoolHeldRepAtForkAttoRep\)[\s\S]*mstore\(add\(pointer, 0x84\), disputeStakedRepAtForkAttoRep\)[\s\S]*mstore\(add\(pointer, 0xa4\), resultingLockedAttoRep\)[\s\S]*delegatecall\(gas\(\), eventEmitter, pointer, 0xc4, 0, 0\)/,
	)
	assert.match(truthAuctionStorage, /function allocateFromCumulativePosition\(/)
	assert.match(truthAuction, /function finalize\(\) external[\s\S]*payable\(owner\)\.call\{\s*value:\s*raisedAttoEthToSend\s*\}/)
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
