import type { OperationAbiEntryKind, OperationClassification } from '../operations/types.ts'

export type ContractAbiEntryKind = OperationAbiEntryKind

/** A selector intentionally routed through one catalog operation that subsumes its effects. */
export interface ContractMethodSemanticAlias {
	contract: string
	method: string
	relation: 'target-subsumes-source'
	sharedImplementation: string
}

export interface ContractMethodClassification {
	abiEntryKind: ContractAbiEntryKind
	contract: string
	method: string
	classification: OperationClassification
	operationId?: string
	reason?: string
	semanticAliasOf?: ContractMethodSemanticAlias
	signatures?: readonly string[]
}

export type CanonicalMutatingContractExposure = 'static-endpoint' | 'dynamic-endpoint' | 'deployment-helper' | 'delegate-module' | 'fallback-module' | 'migration-proxy'

export interface CanonicalMutatingContract {
	artifactSource: `contracts/${string}.sol`
	contract: string
	exposure: CanonicalMutatingContractExposure
}

// This is the canonical runtime code-family boundary for mutating-surface coverage.
// It contains user-facing protocol endpoints plus deployed factories, workers,
// migration proxies, and storage-coupled delegate modules. Pure/view-only runtime
// helpers, generic Multicall transport, libraries, interfaces, and test contracts
// are deliberately outside this economic-operation manifest.
export const CANONICAL_MUTATING_CONTRACT_MANIFEST: readonly CanonicalMutatingContract[] = [
	{ artifactSource: 'contracts/ZoltarQuestionData.sol', contract: 'ZoltarQuestionData', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/Zoltar.sol', contract: 'Zoltar', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/GenesisReputationToken.sol', contract: 'GenesisReputationToken', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/ReputationToken.sol', contract: 'ReputationToken', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/SecurityPoolFactory.sol', contract: 'SecurityPoolFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/SecurityPoolDeployer.sol', contract: 'SecurityPoolDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/factories/SecurityPoolDeployer.sol', contract: 'SecurityPoolDeploymentWorker', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPool.sol', contract: 'SecurityPool', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolLiquidationDelegate.sol', contract: 'SecurityPoolLiquidationDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolEventEmitter.sol', contract: 'SecurityPoolEventEmitter', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/OpenOraclePriceCoordinator.sol', contract: 'OpenOraclePriceCoordinator', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/LiquidationApprovalRegistry.sol', contract: 'LiquidationApprovalRegistry', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/PriceOracleManagerAndOperatorQueuerFactory.sol', contract: 'PriceOracleManagerAndOperatorQueuerFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/PriceOracleManagerAndOperatorQueuerFactory.sol', contract: 'LiquidationApprovalRegistryDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/factories/PriceOracleManagerAndOperatorQueuerFactory.sol', contract: 'PriceCoordinatorDeploymentWorker', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolForker.sol', contract: 'SecurityPoolForker', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolForkerVaultMigrationDelegate.sol', contract: 'SecurityPoolForkerVaultMigrationDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/EscalationGameForker.sol', contract: 'EscalationGameForker', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolMigrationProxy.sol', contract: 'SecurityPoolMigrationProxy', exposure: 'migration-proxy' },
	{ artifactSource: 'contracts/statoblast/factories/EscalationGameFactory.sol', contract: 'EscalationGameFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/EscalationGame.sol', contract: 'EscalationGame', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/EscalationGameClaimDelegate.sol', contract: 'EscalationGameClaimDelegate', exposure: 'fallback-module' },
	{ artifactSource: 'contracts/statoblast/EscalationGameDepositDelegate.sol', contract: 'EscalationGameDepositDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/factories/ShareTokenFactory.sol', contract: 'ShareTokenFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/tokens/ShareToken.sol', contract: 'ShareToken', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/UniformPriceDualCapBatchAuctionFactory.sol', contract: 'UniformPriceDualCapBatchAuctionFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/UniformPriceDualCapBatchAuction.sol', contract: 'UniformPriceDualCapBatchAuction', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/openOracle/OpenOracle.sol', contract: 'OpenOracle', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/WETH9.sol', contract: 'WETH9', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/trading/TwoWayConstantProductFactory.sol', contract: 'TwoWayConstantProductFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/trading/TwoWayConstantProductPair.sol', contract: 'TwoWayConstantProductPair', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/trading/TwoWayConstantProductRouter.sol', contract: 'TwoWayConstantProductRouter', exposure: 'static-endpoint' },
] as const

const entry = (contract: string, method: string, classification: OperationClassification, operationId?: string, reason?: string, signatures?: readonly string[], abiEntryKind: ContractAbiEntryKind = 'function'): ContractMethodClassification => {
	const base = { abiEntryKind, classification, contract, method }
	return { ...base, ...(operationId === undefined ? {} : { operationId }), ...(reason === undefined ? {} : { reason }), ...(signatures === undefined ? {} : { signatures }) }
}

const semanticAlias = (contract: string, method: string, classification: OperationClassification, operationId: string, targetMethod: string, sharedImplementation: string, reason: string): ContractMethodClassification => ({
	...entry(contract, method, classification, operationId, reason),
	semanticAliasOf: { contract, method: targetMethod, relation: 'target-subsumes-source', sharedImplementation },
})

// This is deliberately explicit. New protocol methods should fail the artifact coverage
// test until their chaos behavior (or exclusion reason) is reviewed.
export const MUTATING_CONTRACT_SURFACE: readonly ContractMethodClassification[] = [
	entry('ZoltarQuestionData', 'createQuestion', 'selectable', 'zoltar.question.create-binary'),
	entry('Zoltar', 'forkUniverse', 'selectable', 'zoltar.universe.fork'),
	entry('Zoltar', 'burnRep', 'selectable', 'zoltar.rep.burn'),
	entry('Zoltar', 'deployChild', 'selectable', 'zoltar.child.deploy'),
	entry('Zoltar', 'addRepToMigrationBalance', 'selectable', 'zoltar.migration.add'),
	entry('Zoltar', 'splitMigrationRep', 'selectable', 'zoltar.migration.split'),
	entry('GenesisReputationToken', 'approve', 'prerequisite', 'token.rep.approve'),
	entry('GenesisReputationToken', 'transfer', 'excluded-dangerous', undefined, 'Raw transfers have no ecosystem postcondition and can strand funded genesis REP.'),
	entry('GenesisReputationToken', 'transferFrom', 'excluded-dangerous', undefined, 'Delegated raw transfers are not chaos workflows.'),
	entry('ReputationToken', 'approve', 'prerequisite', 'token.rep.approve'),
	entry('ReputationToken', 'transfer', 'excluded-dangerous', undefined, 'Raw transfers have no ecosystem postcondition and can strand funded REP.'),
	entry('ReputationToken', 'transferFrom', 'excluded-dangerous', undefined, 'Delegated raw transfers are not chaos workflows.'),
	entry('ReputationToken', 'mint', 'role-restricted', undefined, 'Only Zoltar may mint child-universe REP.'),
	entry('ReputationToken', 'burn', 'role-restricted', undefined, 'Only Zoltar may burn child-universe REP.'),
	entry('ReputationToken', 'setMaxTheoreticalSupplyAttoRep', 'role-restricted', undefined, 'Only Zoltar initializes the supply bound.'),

	entry('SecurityPoolFactory', 'deployOriginSecurityPool', 'selectable', 'statoblast.pool.deploy'),
	entry('SecurityPoolFactory', 'deployChildSecurityPool', 'role-restricted', undefined, 'Only SecurityPoolForker deploys canonical children.'),
	entry('SecurityPoolDeployer', 'deploy', 'role-restricted', undefined, 'Only the canonical SecurityPoolFactory may use its constructor-deployed pool deployer.'),
	entry('SecurityPoolDeploymentWorker', 'deploy', 'role-restricted', undefined, 'Only the canonical SecurityPoolDeployer may use its creation-code worker.'),
	entry('SecurityPool', 'updateSettlementCollateral', 'selectable', 'statoblast.pool.checkpoint-collateral'),
	entry('SecurityPool', 'updateRetentionRate', 'selectable', 'statoblast.pool.checkpoint-retention'),
	entry('SecurityPool', 'updateVaultFees', 'selectable', 'statoblast.vault.update-fees'),
	entry('SecurityPool', 'redeemFees', 'selectable', 'statoblast.vault.redeem-fees'),
	entry('SecurityPool', 'depositRepToVault', 'selectable', 'statoblast.vault.deposit-rep'),
	entry('SecurityPool', 'withdrawRepFromVault', 'role-restricted', undefined, 'Only the OpenOracle price coordinator may execute a staged REP withdrawal.'),
	entry('SecurityPool', 'performLiquidation', 'role-restricted', undefined, 'Only the OpenOracle price coordinator may execute a staged liquidation.'),
	entry('SecurityPool', 'createCompleteSet', 'selectable', 'statoblast.complete-set.create'),
	entry('SecurityPool', 'redeemCompleteSet', 'selectable', 'statoblast.complete-set.redeem'),
	entry('SecurityPool', 'redeemShares', 'selectable', 'statoblast.shares.redeem-winning'),
	entry('SecurityPool', 'redeemRepFromVault', 'selectable', 'statoblast.vault.redeem-rep'),
	entry('SecurityPool', 'withdrawForkedEscalationDeposits', 'lifecycle-obligation', 'statoblast.escalation.withdraw-forked'),
	entry('SecurityPool', 'depositToEscalationGame', 'selectable', 'statoblast.escalation.deposit'),
	entry('SecurityPool', 'withdrawFromEscalationGame', 'lifecycle-obligation', 'statoblast.escalation.withdraw'),
	entry('SecurityPool', 'resumeForkedEscalationGame', 'lifecycle-obligation', 'statoblast.escalation.resume'),
	entry('SecurityPool', 'burnEscalationWinnerHaircut', 'role-restricted', undefined, 'Only the canonical escalation game may invoke this.'),
	entry('SecurityPool', 'setStartingParams', 'role-restricted', undefined, 'Only the canonical factory initializes pool parameters.'),
	entry('SecurityPool', 'activateForkMode', 'role-restricted', undefined, 'Only SecurityPoolForker coordinates fork state.'),
	entry('SecurityPool', 'initializeForkedEscalationGame', 'role-restricted', undefined, 'Only SecurityPoolForker initializes inherited games.'),
	entry('SecurityPool', 'initializeForkCarrySnapshotWithResolutionBalances', 'role-restricted', undefined, 'Only SecurityPoolForker installs proof roots.'),
	entry('SecurityPool', 'setAwaitingForkContinuation', 'role-restricted', undefined, 'Only SecurityPoolForker controls fork continuation.'),
	entry('SecurityPool', 'setSystemState', 'role-restricted', undefined, 'Only SecurityPoolForker controls lifecycle state.'),
	entry('SecurityPool', 'configureVault', 'role-restricted', undefined, 'Only SecurityPoolForker migrates vault accounting.'),
	entry('SecurityPool', 'configureFinalizedAuctionVault', 'role-restricted', undefined, 'Only SecurityPoolForker settles migrated vault state.'),
	entry('SecurityPool', 'assignFinalizedAuctionFees', 'role-restricted', undefined, 'Only SecurityPoolForker assigns auction fees.'),
	entry('SecurityPool', 'setTotalRepBackingUnits', 'role-restricted', undefined, 'Only SecurityPoolForker migrates aggregate accounting.'),
	entry('SecurityPool', 'setTotalSharesAttoShares', 'role-restricted', undefined, 'Only SecurityPoolForker migrates share supply.'),
	entry('SecurityPool', 'setPoolFinancials', 'role-restricted', undefined, 'Only SecurityPoolForker migrates pool financials.'),
	entry('SecurityPool', 'transferEth', 'role-restricted', undefined, 'Only SecurityPoolForker routes migration collateral.'),
	entry('SecurityPool', 'authorizeChildPool', 'role-restricted', undefined, 'Only SecurityPoolForker authorizes child pools.'),
	entry('SecurityPool', 'receive', 'role-restricted', undefined, 'Only the canonical forker, truth auction, or parent pool may send ETH directly.', undefined, 'receive'),
	entry('SecurityPoolLiquidationDelegate', 'performBundledLiquidation', 'excluded-dangerous', undefined, 'This storage-coupled module is valid only through SecurityPool delegatecall; a direct call uses isolated delegate storage.'),
	entry('SecurityPoolLiquidationDelegate', 'resumeForkedEscalationGame', 'excluded-dangerous', undefined, 'This storage-coupled module is valid only through the typed SecurityPool resumption entrypoint.'),
	entry('SecurityPoolLiquidationDelegate', 'setValidatedSettlementCollateral', 'excluded-dangerous', undefined, 'This storage-coupled module is valid only through SecurityPool delegatecall after validating the attached settlement collateral.'),
	entry('SecurityPoolLiquidationDelegate', 'setVaultCapacity', 'excluded-dangerous', undefined, 'This storage-coupled module is valid only through SecurityPool delegatecall during a checked vault deposit.'),
	entry('SecurityPoolEventEmitter', 'emitForkSnapshotEvents', 'excluded-dangerous', undefined, 'Direct calls can emit unauthenticated lookalike protocol events; only a canonical forker delegatecall is meaningful.'),
	entry('SecurityPoolEventEmitter', 'emitPoolAccountingCheckpoint', 'excluded-dangerous', undefined, 'Direct calls can emit unauthenticated lookalike protocol events; only a canonical pool delegatecall is meaningful.'),
	entry('SecurityPoolEventEmitter', 'emitVaultAccountingCheckpoint', 'excluded-dangerous', undefined, 'Direct calls can emit unauthenticated lookalike protocol events; only a canonical pool delegatecall is meaningful.'),

	entry('OpenOraclePriceCoordinator', 'requestPrice', 'selectable', 'statoblast.oracle.request-price'),
	entry('OpenOraclePriceCoordinator', 'recoverSettledPendingReport', 'lifecycle-obligation', 'statoblast.oracle.recover-report'),
	entry('OpenOraclePriceCoordinator', 'requestPriceIfNeededAndStageOperation', 'selectable', 'statoblast.staged.queue'),
	entry('OpenOraclePriceCoordinator', 'requestPriceIfNeededAndStageLiquidation', 'excluded-dangerous', undefined, 'The call snapshots mutable liquidation state only at inclusion and has no calldata guard for the simulated result or zero bad debt.'),
	entry('OpenOraclePriceCoordinator', 'executeStagedOperation', 'lifecycle-obligation', 'statoblast.staged.execute'),
	entry('OpenOraclePriceCoordinator', 'expireStagedOperation', 'lifecycle-obligation', 'statoblast.staged.expire'),
	entry('OpenOraclePriceCoordinator', 'openOracleCallback', 'role-restricted', undefined, 'Only OpenOracle calls the settlement callback.'),
	entry('OpenOraclePriceCoordinator', 'setLiquidationApprovalRegistry', 'role-restricted', undefined, 'Factory-only one-time wiring.'),
	entry('OpenOraclePriceCoordinator', 'setSecurityPool', 'role-restricted', undefined, 'Factory-only one-time wiring.'),
	entry('OpenOraclePriceCoordinator', 'setRepEthPrice', 'role-restricted', undefined, 'Pool-only child initialization.'),
	entry('PriceOracleManagerAndOperatorQueuerFactory', 'deployPriceOracleManagerAndOperatorQueuer', 'excluded-dangerous', undefined, 'Calling this deployment factory directly creates an orphan coordinator and registry outside SecurityPoolFactory registration.'),
	entry('LiquidationApprovalRegistryDeployer', 'deploy', 'role-restricted', undefined, 'Only its constructor-recorded coordinator factory may deploy and initialize registry clones.'),
	entry('PriceCoordinatorDeploymentWorker', 'deploy', 'role-restricted', undefined, 'Only its constructor-recorded coordinator factory may deploy price coordinators.'),
	entry('PriceCoordinatorDeploymentWorker', 'configureLiquidationApprovalRegistry', 'role-restricted', undefined, 'Only its constructor-recorded coordinator factory may perform one-time registry wiring.'),

	entry('LiquidationApprovalRegistry', 'initialize', 'excluded-dangerous', undefined, 'One-time registry wiring is deployment infrastructure and an unattended caller could bind an uninitialized registry to the wrong coordinator.'),
	entry('LiquidationApprovalRegistry', 'setLiquidationApproval', 'excluded-dangerous', undefined, 'Installing delegated liquidation authority requires an explicit receiver policy, durable quota tracking, and a selected external operator.'),
	entry('LiquidationApprovalRegistry', 'permitLiquidationApproval', 'excluded-dangerous', undefined, 'Relaying an arbitrary delegated-liquidation signature is outside the dedicated wallet boundary and requires durable signed-intent provenance.'),
	entry('LiquidationApprovalRegistry', 'revokeLiquidationApproval', 'excluded-dangerous', undefined, 'No chaos workflow installs delegated liquidation approvals, so it cannot identify a wallet-owned live approval safely enough to revoke it.'),
	entry('LiquidationApprovalRegistry', 'invalidateLiquidationApprovalNonce', 'excluded-dangerous', undefined, 'Global nonce invalidation can revoke unrelated receiver approvals and is not safe for randomized unattended execution.'),
	entry('LiquidationApprovalRegistry', 'reserve', 'role-restricted', undefined, 'Only the canonical price coordinator may reserve delegated liquidation quota.'),
	entry('LiquidationApprovalRegistry', 'release', 'role-restricted', undefined, 'Only the canonical price coordinator releases a staged liquidation reservation.'),
	entry('LiquidationApprovalRegistry', 'consume', 'role-restricted', undefined, 'Only the canonical price coordinator consumes a staged liquidation reservation.'),

	entry('SecurityPoolForker', 'initiateSecurityPoolFork', 'selectable', 'statoblast.fork.initiate'),
	entry('SecurityPoolForker', 'migrateRepToZoltar', 'lifecycle-obligation', 'statoblast.fork.migrate-rep'),
	entry('SecurityPoolForker', 'createChildUniverse', 'lifecycle-obligation', 'statoblast.fork.create-child'),
	entry('SecurityPoolForker', 'claimForkedEscalationDeposits', 'lifecycle-obligation', 'statoblast.escalation.claim-forked'),
	entry('SecurityPoolForker', 'migrateVault', 'lifecycle-obligation', 'statoblast.fork.migrate-vault'),
	entry('SecurityPoolForker', 'migrateVaultWithUnresolvedEscalation', 'lifecycle-obligation', 'statoblast.fork.migrate-vault-unresolved'),
	entry('SecurityPoolForker', 'startTruthAuction', 'lifecycle-obligation', 'statoblast.auction.start'),
	entry('SecurityPoolForker', 'finalizeTruthAuction', 'lifecycle-obligation', 'statoblast.auction.finalize-route'),
	entry('SecurityPoolForker', 'forkZoltarWithOwnEscalationGame', 'selectable', 'statoblast.fork.own-question'),
	semanticAlias(
		'SecurityPoolForker',
		'claimAuctionProceeds',
		'lifecycle-obligation',
		'statoblast.auction.settle-bids',
		'settleAuctionBids',
		'_claimAuctionProceeds',
		'Semantic alias of SecurityPoolForker.settleAuctionBids: both selectors execute the same finalized claim implementation, and the canonical route subsumes this claim-only batch without creating duplicate durable obligations.',
	),
	entry('SecurityPoolForker', 'settleAuctionBids', 'lifecycle-obligation', 'statoblast.auction.settle-bids'),
	entry('SecurityPoolForker', 'initializeChildForkedEscalationGameIfNeeded', 'role-restricted', undefined, 'The contract explicitly accepts only a self-call from SecurityPoolForker.'),
	entry('SecurityPoolForker', 'receive', 'role-restricted', undefined, 'Only a trusted canonical truth auction may send ETH directly.', undefined, 'receive'),
	entry('SecurityPoolForkerVaultMigrationDelegate', 'createChildUniverse', 'excluded-dangerous', undefined, 'This storage-coupled module is valid only through the canonical SecurityPoolForker delegatecall wrapper.'),
	entry('SecurityPoolForkerVaultMigrationDelegate', 'creditAuctionProceeds', 'excluded-dangerous', undefined, 'This storage-coupled module is valid only through canonical forker settlement; direct calls use isolated storage.'),
	entry('SecurityPoolForkerVaultMigrationDelegate', 'ensureChildPoolRepSplit', 'excluded-dangerous', undefined, 'This storage-coupled module is valid only through the canonical SecurityPoolForker delegatecall wrapper.'),
	entry('SecurityPoolForkerVaultMigrationDelegate', 'finalizeTruthAuctionRepair', 'excluded-dangerous', undefined, 'This storage-coupled repair path is valid only inside canonical forker finalization and must not receive direct ETH.'),
	entry('SecurityPoolForkerVaultMigrationDelegate', 'migrateVault', 'excluded-dangerous', undefined, 'This storage-coupled module is valid only through the canonical SecurityPoolForker delegatecall wrapper.'),
	entry('EscalationGameForker', 'claimForkedEscalationDeposits', 'excluded-dangerous', undefined, 'This storage-coupled module is valid only through the canonical SecurityPoolForker delegatecall wrapper.'),
	entry('EscalationGameForker', 'migrateVaultWithUnresolvedEscalation', 'excluded-dangerous', undefined, 'This storage-coupled module is valid only through the canonical SecurityPoolForker delegatecall wrapper.'),
	entry('SecurityPoolMigrationProxy', 'lockRep', 'role-restricted', undefined, 'Only the owning canonical SecurityPoolForker may lock a pool migration balance.'),
	entry('SecurityPoolMigrationProxy', 'forkUniverse', 'role-restricted', undefined, 'Only the owning canonical SecurityPoolForker may fork through the pool-specific migration identity.'),
	entry('SecurityPoolMigrationProxy', 'splitToChild', 'role-restricted', undefined, 'Only the owning canonical SecurityPoolForker may split the proxy migration balance.'),
	entry('SecurityPoolMigrationProxy', 'sweepChildRep', 'role-restricted', undefined, 'Only the owning canonical SecurityPoolForker may route child REP from the proxy.'),

	entry('EscalationGameFactory', 'deployEscalationGame', 'excluded-dangerous', undefined, 'A direct caller would deploy an orphan game whose security-pool identity is not registered by SecurityPoolFactory.'),
	entry('EscalationGameFactory', 'deployEscalationGameFromFork', 'excluded-dangerous', undefined, 'A direct caller would deploy an orphan continuation game outside canonical child-pool initialization.'),
	entry('EscalationGame', 'start', 'role-restricted', undefined, 'Only the deploying factory starts a game.'),
	entry('EscalationGame', 'startFromFork', 'role-restricted', undefined, 'Only a canonical child pool starts an inherited game.'),
	entry('EscalationGame', 'resumeFromFork', 'role-restricted', undefined, 'The pool owns game resumption.'),
	entry('EscalationGame', 'applyTruthAuctionHaircut', 'role-restricted', undefined, 'Only the owning pool applies the haircut.'),
	entry('EscalationGame', 'recordDepositFromSecurityPool', 'role-restricted', undefined, 'Deposits must be routed through SecurityPool.'),
	entry('EscalationGame', 'claimDepositForWinning', 'role-restricted', undefined, 'Only the owning SecurityPool or canonical forker may settle a winning deposit.'),
	entry('EscalationGame', 'claimDepositForWinningWithoutTransfer', 'role-restricted', undefined, 'Only the owning SecurityPool or canonical forker may settle a winning deposit without transfer.'),
	entry('EscalationGame', 'drainAllRep', 'role-restricted', undefined, 'Only the owning SecurityPool may drain REP during fork activation.'),
	entry('EscalationGame', 'exportForkedEscrowByOutcome', 'role-restricted', undefined, 'Only the owning SecurityPool or canonical forker may export forked escrow.'),
	entry('EscalationGame', 'exportForkedEscrowByOutcomeWithoutTransfer', 'role-restricted', undefined, 'Only the owning SecurityPool or canonical forker may export forked escrow without transfer.'),
	entry('EscalationGame', 'exportUnresolvedDeposit', 'role-restricted', undefined, 'Only the owning SecurityPool or canonical forker may export unresolved deposits.'),
	entry('EscalationGame', 'exportVaultUnresolvedTotals', 'role-restricted', undefined, 'Only the owning SecurityPool or canonical forker may export unresolved vault totals.'),
	entry('EscalationGame', 'exportVaultUnresolvedTotalsWithoutTransfer', 'role-restricted', undefined, 'Only the owning SecurityPool or canonical forker may export unresolved vault totals without transfer.'),
	entry('EscalationGame', 'initializeForkCarrySnapshotWithResolutionBalances', 'role-restricted', undefined, 'Only the owning SecurityPool may install the canonical inherited carry snapshot.'),
	entry('EscalationGame', 'recordForkedEscrowForOutcome', 'role-restricted', undefined, 'Only the owning SecurityPool or canonical forker may record inherited escrow.'),
	entry('EscalationGame', 'depositRepOnOutcome', 'selectable', 'statoblast.escalation.deposit-wallet-rep'),
	entry('EscalationGame', 'sweepResidualRepToSecurityPool', 'selectable', 'statoblast.escalation.sweep-residual'),
	entry('EscalationGame', 'withdrawDeposit', 'role-restricted', undefined, 'Only the owning SecurityPool or canonical forker may settle local or carried deposits.', ['withdrawDeposit(uint256,uint8)', 'withdrawDeposit((address,uint256,uint256,uint256,uint256,uint256,bytes32[],uint256,bytes32[]),uint8)']),
	entry('EscalationGame', 'fallback', 'role-restricted', undefined, 'This fallback delegates the claim-module surface, whose checkpoint mutation is restricted to the owning SecurityPool.', undefined, 'fallback'),
	entry('EscalationGameClaimDelegate', 'initializeForkClaimCheckpoint', 'role-restricted', undefined, 'The canonical EscalationGame exposes this selector through its fallback; only the owning SecurityPool may initialize the checkpoint.'),
	entry('EscalationGameDepositDelegate', 'applyTruthAuctionHaircut', 'excluded-dangerous', undefined, 'This per-game storage-coupled module is valid only through the typed EscalationGame delegatecall entrypoint.'),
	entry('EscalationGameDepositDelegate', 'consumeEscrowedRepForOwner', 'excluded-dangerous', undefined, 'This per-game storage-coupled module is valid only through internal EscalationGame delegatecall composition.'),
	entry('EscalationGameDepositDelegate', 'consumeUnresolvedRepForClaimOwners', 'excluded-dangerous', undefined, 'This per-game storage-coupled module is valid only through internal EscalationGame delegatecall composition.'),
	entry('EscalationGameDepositDelegate', 'creditClaimOwners', 'excluded-dangerous', undefined, 'This per-game storage-coupled module is valid only through internal EscalationGame delegatecall composition.'),
	entry('EscalationGameDepositDelegate', 'creditExternalClaimOwners', 'excluded-dangerous', undefined, 'This per-game storage-coupled module is valid only through internal EscalationGame delegatecall composition.'),
	entry('EscalationGameDepositDelegate', 'depositRepOnOutcome', 'excluded-dangerous', undefined, 'This per-game storage-coupled module is valid only through the typed EscalationGame deposit entrypoint; a direct call uses isolated delegate storage.'),
	entry('EscalationGameDepositDelegate', 'recordDeposit', 'excluded-dangerous', undefined, 'This per-game storage-coupled module is valid only through the typed EscalationGame deposit entrypoint.'),
	entry('EscalationGameDepositDelegate', 'recordForkedEscrowForOutcome', 'excluded-dangerous', undefined, 'This per-game storage-coupled module is valid only through the typed EscalationGame escrow entrypoint.'),
	entry('EscalationGameDepositDelegate', 'resumeFromFork', 'excluded-dangerous', undefined, 'This per-game storage-coupled module is valid only through the typed EscalationGame resumption entrypoint.'),

	entry('ShareTokenFactory', 'deployShareToken', 'excluded-dangerous', undefined, 'Calling this shared factory directly creates an orphan token outside SecurityPoolFactory lineage registration.'),
	entry('UniformPriceDualCapBatchAuction', 'startAuction', 'role-restricted', undefined, 'Only SecurityPoolForker initializes a truth auction.'),
	entry('UniformPriceDualCapBatchAuction', 'submitBid', 'selectable', 'statoblast.auction.bid'),
	entry('UniformPriceDualCapBatchAuction', 'finalize', 'role-restricted', undefined, 'Only the owning SecurityPoolForker can finalize; keepers must call finalizeTruthAuction instead.'),
	entry('UniformPriceDualCapBatchAuction', 'withdrawBids', 'role-restricted', undefined, 'Only SecurityPoolForker settles purchased REP.'),
	entry('UniformPriceDualCapBatchAuction', 'refundLosingBids', 'lifecycle-obligation', 'statoblast.auction.refund'),
	entry('UniformPriceDualCapBatchAuction', 'refundLosingBidsFor', 'role-restricted', undefined, 'Only the SecurityPoolForker owner can refund bids on behalf of another bidder.'),
	entry('UniformPriceDualCapBatchAuction', 'withdrawPendingEthRefund', 'lifecycle-obligation', 'statoblast.auction.withdraw-refund'),
	entry('UniformPriceDualCapBatchAuctionFactory', 'deployUniformPriceDualCapBatchAuction', 'excluded-dangerous', undefined, 'Calling this shared factory directly creates an orphan auction outside canonical child-pool migration.'),

	entry('OpenOracle', 'report', 'selectable', 'open-oracle.report'),
	entry('OpenOracle', 'dispute', 'selectable', 'open-oracle.dispute'),
	entry('OpenOracle', 'settle', 'lifecycle-obligation', 'open-oracle.settle'),
	entry('OpenOracle', 'withdraw', 'selectable', 'open-oracle.withdraw'),
	entry('OpenOracle', 'withdrawTo', 'selectable', 'open-oracle.withdraw-to', 'The operation fixes the recipient to the configured signer and verifies the exact ERC-20 transfer.'),
	entry('OpenOracle', 'dust', 'selectable', 'open-oracle.dust'),
	entry('OpenOracle', 'deposit', 'selectable', 'open-oracle.deposit', 'Only canonical WETH and REP ERC-20 deposits are planned. Native deposits are intentionally excluded because native internal credit has no exactly verifiable automated sweep.'),
	entry('OpenOracle', 'depositFromPermit2', 'excluded-dangerous', undefined, 'Arbitrary signed Permit2 payloads are outside unattended chaos execution.'),
	entry('OpenOracle', 'internalTransferFrom', 'excluded-dangerous', undefined, 'Delegated transfers require another holder and are not self-contained.'),
	entry('OpenOracle', 'pushOrCredit', 'selectable', 'open-oracle.push-or-credit', undefined, ['pushOrCredit(address,address,uint128)', 'pushOrCredit(address,address,uint128,uint32)']),
	entry('OpenOracle', 'approveInternal', 'selectable', 'open-oracle.approve-internal'),
	entry('WETH9', 'deposit', 'selectable', 'open-oracle.weth.wrap'),
	entry('WETH9', 'receive', 'selectable', 'open-oracle.weth.wrap', 'Exact payable alias of WETH9.deposit and the same bounded wrap operation.', undefined, 'receive'),
	entry('WETH9', 'withdraw', 'selectable', 'open-oracle.weth.unwrap'),
	entry('WETH9', 'approve', 'prerequisite', 'token.weth.approve'),
	entry('WETH9', 'transfer', 'excluded-dangerous', undefined, 'Raw transfers have no ecosystem postcondition.'),
	entry('WETH9', 'transferFrom', 'excluded-dangerous', undefined, 'Delegated raw transfers are not chaos workflows.'),

	entry('ShareToken', 'setApprovalForAll', 'prerequisite', 'token.shares.approve'),
	entry('ShareToken', 'migrate', 'selectable', 'trading.shares.migrate'),
	entry('ShareToken', 'authorize', 'role-restricted', undefined, 'Only the canonical factory authorizes a pool.'),
	entry('ShareToken', 'mintCompleteSets', 'role-restricted', undefined, 'Only an authorized SecurityPool mints complete sets.'),
	entry('ShareToken', 'burnCompleteSets', 'role-restricted', undefined, 'Only an authorized SecurityPool burns complete sets.'),
	entry('ShareToken', 'burnTokenIdAndGetRemainingSupply', 'role-restricted', undefined, 'Only an authorized SecurityPool burns winning shares.'),
	entry('ShareToken', 'safeTransferFrom', 'excluded-dangerous', undefined, 'Raw share transfers may strand positions.', ['safeTransferFrom(address,address,uint256,uint256)', 'safeTransferFrom(address,address,uint256,uint256,bytes)']),
	entry('ShareToken', 'safeBatchTransferFrom', 'excluded-dangerous', undefined, 'Raw share transfers may strand positions.', ['safeBatchTransferFrom(address,address,uint256[],uint256[])', 'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)']),

	entry('TwoWayConstantProductFactory', 'createPair', 'selectable', 'trading.pair.create'),
	entry('TwoWayConstantProductPair', 'approve', 'prerequisite', 'trading.lp.approve'),
	entry('TwoWayConstantProductPair', 'transfer', 'excluded-dangerous', undefined, 'Raw LP transfers have no ecosystem postcondition.'),
	entry('TwoWayConstantProductPair', 'transferFrom', 'excluded-dangerous', undefined, 'Delegated raw LP transfers are not chaos workflows.'),
	entry('TwoWayConstantProductPair', 'initialize', 'selectable', 'trading.pair.initialize-shares'),
	entry('TwoWayConstantProductPair', 'addLiquidity', 'selectable', 'trading.liquidity.add-shares'),
	entry('TwoWayConstantProductPair', 'removeLiquidity', 'selectable', 'trading.liquidity.remove-shares'),
	entry('TwoWayConstantProductPair', 'swapExactInput', 'selectable', 'trading.swap.exact-input'),
	entry('TwoWayConstantProductPair', 'swapExactOutput', 'selectable', 'trading.swap.exact-output'),
	entry('TwoWayConstantProductPair', 'sync', 'selectable', 'trading.pair.sync'),
	entry('TwoWayConstantProductRouter', 'enterPosition', 'selectable', 'trading.position.enter'),
	entry('TwoWayConstantProductRouter', 'exitPosition', 'selectable', 'trading.position.exit'),
	entry('TwoWayConstantProductRouter', 'redeemCompleteSet', 'selectable', 'trading.complete-set.redeem'),
	entry('TwoWayConstantProductRouter', 'createPairAndInitializeWithEth', 'selectable', 'trading.pair.create-and-initialize'),
	entry('TwoWayConstantProductRouter', 'initializeWithEth', 'selectable', 'trading.pair.initialize-eth'),
	entry('TwoWayConstantProductRouter', 'addLiquidityWithEth', 'selectable', 'trading.liquidity.add-eth'),
	entry('TwoWayConstantProductRouter', 'removeLiquidity', 'selectable', 'trading.liquidity.remove'),
	entry('TwoWayConstantProductRouter', 'receive', 'role-restricted', undefined, 'Only the active callback pool may return ETH during a router workflow.', undefined, 'receive'),
] as const

export function classifiedMethod(contract: string, method: string, abiEntryKind: ContractAbiEntryKind = 'function') {
	return MUTATING_CONTRACT_SURFACE.find(candidate => candidate.contract === contract && candidate.method === method && candidate.abiEntryKind === abiEntryKind)
}
