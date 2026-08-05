import { readFile } from 'node:fs/promises'

const sourceFilesResult = Bun.spawnSync(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], { stdout: 'pipe' })
if (sourceFilesResult.exitCode !== 0) throw new Error('Unable to enumerate repository files for unit terminology validation')

const protectedVendorPath = 'solidity/contracts/peripherals/openOracle/OpenOracle.sol'
const terminologyCheckPath = 'scripts/check-unit-terminology.mts'
const serializedAtomicStringAllowlist = new Set(['bots/liquidator/scripts/serve-dashboard-fixture.mts', 'bots/liquidator/tests/config/settings.test.ts', 'docs/mainnet-deployment-addresses.json', 'docs/sepolia-deployment-addresses.json', 'scripts/check-mainnet-deployment.mts', 'solidity/ts/types/index.d.ts'])
const textFilePattern = /\.(?:css|html|json|md|mts|sol|ts|tsx)$/
const legacyTerminology =
	/free[ -]?rep|freerep|pool[ -]?ownership|poolOwnership|security[ -]?bond|securityBond|bond[ -]?allowance|bondAllowance|unpaidEthFees|feesOwedToVaults|completeSetCollateral|cashToShares|sharesToCash|nanoEth|nanoETH|pool-level REP|selectedVaultAddress|ChildPoolRepSwept|poolRepAtForkAttoRep|poolRepAmountAttoRep|resultingChildPoolRepBalanceAttoRep|\bwei\b|seiz(?:e|ed|ing)[^\n]{0,24}REP/i
const missingAtomicSuffixIdentifiers =
	/\b(?:ethBalance|wethBalance|requestPriceEthCost|getRequestPriceEthCost|getQueuedOperationEthCost|ethCost|queuedOperationEthCost|totalAccruedFees|requiredEthCost|walletEthBalance|liquidationMaxAmount|netProfitWeth|winningEth|candidateWinningEth|activeCumulativeEth|provisionalEthRaised|acceptedEth|profitBeforeGasWeth|wethRefund|expectedEth|initialWeth|pendingReportMaxSettlementBaseFee|calculateOracleMinimumWethReport|snapshotDenominator|snapshotPoolHeldRepBalanceAttoRep|snapshotPoolHeldRepBalanceBackingUnits)\b/
const formattedAtomicStringField = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:AttoEth|AttoRep|AttoShares)[A-Za-z0-9_$]*\??:\s*string\b/
const humanDecimalUnderAtomicKey = /["'][A-Za-z_$][A-Za-z0-9_$]*(?:AttoEth|AttoRep|AttoShares)[A-Za-z0-9_$]*["']\s*:\s*["'](?:0|[1-9]\d*)(?:\.\d+)?["']/
const humanDecimalUnderAtomicProperty = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:AttoEth|AttoRep|AttoShares)[A-Za-z0-9_$]*\s*:\s*["'](?:0|[1-9]\d*)(?:\.\d+)?["']/
const humanControlWithAtomicKey = /data-example-(?:input|output|value)=["'][^"']*(?:AttoEth|AttoRep|AttoShares)[^"']*["']/
const ambiguousRepStateTerminology = /\b(?:unlocked[^\n]{0,32}REP|REP[^\n]{0,32}unlocked|unlocked (?:vault|position|balances|state)|viewerVaultAvailableDisputeStakedRepAttoRep|loadingAvailableVaultRep|repPlacedAtRisk|availableVaultRepAfterReport|_migrateVaultUnlockedState)\b/i
const repeatedAtomicSuffix = /(?:AttoEth|AttoRep|AttoShares){2}/
const ambiguousAtomicScaleConstant = /\b(?:ONE_ETH|ONE_REP|ETH|REP)\s*=\s*10n\s*\*\*\s*18n\b/
const atomicIdentifierWithHumanUnit = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:AttoEth|AttoRep|AttoShares)\s+(?:ETH|REP|shares)\b/
const atomicIdentifierAssignedHumanAmount = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:AttoEth|AttoRep|AttoShares)(?:<\/code>)?\s*(?:=|:|is|of)\s*(?:<code>)?\d+(?:\.\d+)?\s*(?:ETH|REP|shares)\b/i
const bigintDeclaration = /\b([A-Za-z_$][A-Za-z0-9_$]*)\??:\s*bigint\b/g
const ambiguousVaultBackingTerminology = /\bvault[ -]collateral\b/i
const ambiguousParentEscalationTerminology = /\b(?:parent[- ]locks?|parent escalation[- ]locks?|unresolved[- ]locks?|escalation[- ]lock accounting)\b/i
const ambiguousLiquidationBackingTerminology = /\b(?:target-assigned rescue collateral|seize the rescue deposit)\b/i
const ambiguousPoolHeldRepTerminology = /(?<!-)\bpool REP\b/i
const ambiguousSettlementCollateralTerminology = /\b(?:open-interest|parent) collateral\b/i
const uiEscrowAccountingAlias = /\b(?:escalationEscrowedRepAttoRep|connectedWalletEscrowedRepAttoRep)\b/
const uiDirectRepTruthAuctionClaimAlias = /\b(?:child-pool(?:-held)? REP|Estimated REP Claimed|Winning (?:claims|selections|bids)[^\n]{0,40}\b(?:add|receive|claim) REP(?! backing units))\b/i
const pathSpecificForbidden = new Map<string, RegExp>([
	['bots/shared/src/monitoring/market-consensus.ts', /\bminimum(?:Ask|Bid)DepthEthPerSource\b/],
	['solidity/contracts/peripherals/EscalationGameCalculations.sol', /\battritionCost\b/],
	['solidity/contracts/test/peripherals/EscalationGameForkThresholdHarness.sol', /\b(?:winningBalance|depositAmount|cumulativeAmount|burnAmount)\b/],
	['shared/ts/escalationMath.ts', /\b(?:balances|bindingCapital|depositAmount|depositEnd|depositStart|cumulativeAmount|postDepositCumulativeAmount|winningOutcomeBalance|attritionCost|acceptedAmount|projectedBalances)\b/],
	['docs/charts/chartModels.ts', /\b(?:[A-Za-z_$][A-Za-z0-9_$]*(?:AttoEth|AttoRep|AttoShares)[A-Za-z0-9_$]*\??:\s*number|[A-Za-z_$][A-Za-z0-9_$]*Atomic[A-Za-z0-9_$]*)\b/],
	['docs/charts/chartRuntime.ts', /\b[A-Za-z_$][A-Za-z0-9_$]*Atomic[A-Za-z0-9_$]*\b/],
	[
		'docs/explanation/statoblast.html',
		/\b(?:[A-Za-z_$][A-Za-z0-9_$]*Atomic[A-Za-z0-9_$]*|rewardEligibleCap|bindingCapital|rewardBonusPool|burnAmount|rewardEligibleDeposit|rewardEligiblePrincipal|depositAmount|scaledWithdrawal|actualForkThreshold|vaultMigrationPoweredRep|vaultTotalAssociatedRep|vaultEscalationGameRep|sourcePrincipalAtFork|inheritedUnresolvedTotal|localUnresolvedTotal)\b/,
	],
	['docs/explanation/open-oracle.html', /\b(?:[A-Za-z_$][A-Za-z0-9_$]*Atomic[A-Za-z0-9_$]*|priorityFeeReport|baseFeeReport|openInterestReport|initialWethReport)\b/],
	['docs/explanation/escalation-game.html', /\b(?:currentCarryTotal|effectiveInheritedUnresolvedTotal|localUnresolvedTotal)\b/],
	['docs/explanation/liquidations.html', /\bbonusRepQuote\b/],
	['docs/explanation/truth-auctions.html', /\b(?:postAuctionEffectiveOutcomeBalance|preAuctionOutcomeBalance)\b/],
	['solidity/contracts/peripherals/EscalationGameCarry.sol', /\b(?:forkCarryInitialBacking|forkCarryBackingExportedBeforeResume|minimumBacking|sourceRetainedAmount|inheritedUnresolvedTotal|directlyClaimedPrincipal|_getEffectiveInheritedUnresolvedTotal)\b/],
	['bots/shared/src/monitoring/constant-product-markets.ts', /\bethReceived\b/],
	['ui/ts/features/types.ts', /\bonRepRedeemedFromVault\b/],
	['ui/ts/copy/forkAuction.ts', /\bexport const collateral\b/],
	['scripts/check-docs-reference-values.mts', /poolHeldVaultRepBackingValueAttoRep/],
])

function findUnsuffixedAtomicEthBigintIdentifier(source: string) {
	for (const match of source.matchAll(bigintDeclaration)) {
		const identifier = match[1]
		if (identifier === undefined) continue
		const namesEthUnit = identifier.startsWith('eth') || identifier.startsWith('weth') || identifier.includes('Eth') || identifier.includes('Weth')
		if (namesEthUnit && !identifier.includes('AttoEth') && !identifier.includes('PerEth') && !identifier.includes('Ethereum')) return identifier
	}
	return undefined
}

if (findUnsuffixedAtomicEthBigintIdentifier('type Unsafe = { wethRefund: bigint }') !== 'wethRefund') throw new Error('Unit terminology checker negative fixture did not detect an unsuffixed atomic WETH declaration')
if (findUnsuffixedAtomicEthBigintIdentifier('type Safe = { wethRefundAttoEth: bigint; priceRepPerEth: bigint }') !== undefined) throw new Error('Unit terminology checker rejected canonical attoETH or REP-per-ETH declarations')
if (!missingAtomicSuffixIdentifiers.test('const initialWeth = 1n')) throw new Error('Unit terminology checker negative fixture did not detect an inferred unsuffixed atomic WETH value')
if (!ambiguousAtomicScaleConstant.test('const ONE_REP = 10n ** 18n')) throw new Error('Unit terminology checker negative fixture did not detect an ambiguous atomic scale constant')

const failures: string[] = []
for (const path of new TextDecoder().decode(sourceFilesResult.stdout).trim().split('\n')) {
	if (path === '' || !textFilePattern.test(path)) continue
	const source = await readFile(path, 'utf8')
	const isTestSource = path.includes('/tests/') || path.includes('/testSupport/') || /\.(?:test|fuzz)\.[^.]+$/.test(path)
	if (path !== protectedVendorPath && path !== terminologyCheckPath && legacyTerminology.test(source)) failures.push(`${path}: contains replaced terminology`)
	if (path !== terminologyCheckPath && missingAtomicSuffixIdentifiers.test(source)) failures.push(`${path}: contains a known atomic value without an atto-unit suffix`)
	if (!serializedAtomicStringAllowlist.has(path) && formattedAtomicStringField.test(source)) failures.push(`${path}: labels a human-formatted string as an atomic value`)
	if (!serializedAtomicStringAllowlist.has(path) && humanDecimalUnderAtomicKey.test(source)) failures.push(`${path}: serializes a human decimal under an atomic-unit key`)
	if (!serializedAtomicStringAllowlist.has(path) && humanDecimalUnderAtomicProperty.test(source)) failures.push(`${path}: assigns a human decimal to an unquoted atomic-unit property`)
	if (humanControlWithAtomicKey.test(source)) failures.push(`${path}: exposes a human-unit documentation control under an atomic-unit key`)
	if (path !== terminologyCheckPath && ambiguousRepStateTerminology.test(source)) failures.push(`${path}: uses ambiguous unlocked or available-dispute-staked REP terminology`)
	if (path !== terminologyCheckPath && repeatedAtomicSuffix.test(source)) failures.push(`${path}: repeats an atomic-unit suffix`)
	if (path !== terminologyCheckPath && ambiguousAtomicScaleConstant.test(source)) failures.push(`${path}: uses an atomic scale constant without an explicit atto-unit name`)
	if (path !== terminologyCheckPath && atomicIdentifierWithHumanUnit.test(source)) failures.push(`${path}: pairs an atomic-unit identifier with a human-display unit`)
	if (path !== terminologyCheckPath && atomicIdentifierAssignedHumanAmount.test(source)) failures.push(`${path}: assigns a human-display amount to an atomic-unit identifier`)
	if (!isTestSource && path !== terminologyCheckPath) {
		const unsuffixedAtomicEthIdentifier = findUnsuffixedAtomicEthBigintIdentifier(source)
		if (unsuffixedAtomicEthIdentifier !== undefined) failures.push(`${path}: atomic ETH/WETH bigint identifier ${unsuffixedAtomicEthIdentifier} lacks an AttoEth suffix`)
	}
	if (path !== terminologyCheckPath && ambiguousVaultBackingTerminology.test(source)) failures.push(`${path}: uses vault collateral where REP backing or settlement collateral is required`)
	if (path !== terminologyCheckPath && ambiguousParentEscalationTerminology.test(source)) failures.push(`${path}: uses an ambiguous parent escalation-lock alias`)
	if (path !== terminologyCheckPath && ambiguousLiquidationBackingTerminology.test(source)) failures.push(`${path}: describes target-assigned REP backing as rescue collateral or seizure`)
	if (path !== terminologyCheckPath && ambiguousPoolHeldRepTerminology.test(source)) failures.push(`${path}: uses pool REP instead of pool-held REP`)
	if ((path.startsWith('docs/') || path.startsWith('ui/ts/copy/')) && ambiguousSettlementCollateralTerminology.test(source)) failures.push(`${path}: uses generic open-interest or parent collateral instead of settlement collateral`)
	if (path.startsWith('ui/ts/') && uiEscrowAccountingAlias.test(source)) failures.push(`${path}: uses escrow mechanics terminology for the dispute-staked REP accounting state`)
	if (path.startsWith('ui/ts/') && uiDirectRepTruthAuctionClaimAlias.test(source)) failures.push(`${path}: describes truth-auction REP backing units as direct child-pool REP`)
	if (pathSpecificForbidden.get(path)?.test(source)) failures.push(`${path}: contains an atomic or command identifier without canonical naming`)
}

if (failures.length > 0) throw new Error(`Unit terminology validation failed:\n${failures.join('\n')}`)

console.log('Validated canonical attoETH, attoREP, attoShares, and human-display unit boundaries')
