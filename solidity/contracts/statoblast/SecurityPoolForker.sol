// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { IUniformPriceDualCapBatchAuction } from './interfaces/IUniformPriceDualCapBatchAuction.sol';
import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';
import { UniformPriceDualCapBatchAuctionStorage } from './UniformPriceDualCapBatchAuctionStorage.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { EscalationGame } from './EscalationGame.sol';
import { ESCALATION_TIME_LENGTH } from './EscalationGameTypes.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';
import { SecurityPoolForkerVaultMigrationDelegate } from './SecurityPoolForkerVaultMigrationDelegate.sol';
import { EscalationGameForker } from './EscalationGameForker.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkEventEmitter } from './SecurityPoolEventEmitter.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { DelegateCall } from './DelegateCall.sol';
import {
	EscalationForkSnapshot,
	EscalationMigrationEntitlement,
	SecurityPoolForkerForkData
} from './SecurityPoolForkerTypes.sol';

contract SecurityPoolForker is SecurityPoolForkerBase {
	using SafeERC20Ops for IERC20;
	// These delegates keep fork/migration behavior under the EVM bytecode-size limit while
	// sharing the same storage layout defined by `SecurityPoolForkerBase` and `SecurityPoolForkerStorage`.
	address private immutable vaultMigrationDelegate;
	address private immutable escalationGameForkerDelegate;
	// Never delegate through a module address supplied by an external pool.
	address private immutable forkEventEmitter;

	event ChildPoolLinked(ISecurityPool indexed parent, uint256 indexed outcomeIndex, ISecurityPool indexed child, UniformPriceDualCapBatchAuction truthAuction);
	event ChildRepSplit(ISecurityPool indexed parent, uint256 indexed outcomeIndex, uint256 childPoolRepSplitAttoRep, uint256 pendingChildAttoRep);

	event ClaimForkedEscalationDepositsToWallet(ISecurityPool indexed parent, address indexed vault, BinaryOutcomes.BinaryOutcome indexed outcomeIndex, uint256[] depositIndexes, uint256 sourceRepClaimedAttoRep, uint256 walletRepPaidAttoRep, bool ownFork);
	event TruthAuctionStarted(ISecurityPool indexed securityPool, uint256 settlementCollateralAttoEth, uint256 repMigratedAttoRep, uint256 auctionableAttoRepAtFork);
	event TruthAuctionFinalized(ISecurityPool indexed securityPool);

	/// @notice Returns the fork and truth-auction bookkeeping recorded for `securityPool`.
	function forkData(ISecurityPool securityPool)
		public
		view
		returns (
			uint256 auctionableAttoRepAtFork,
			UniformPriceDualCapBatchAuction truthAuction,
			uint256 truthAuctionStarted,
			uint256 migratedAttoRep,
			uint256 auctionedUnderwritingLimitAttoEth,
			uint256 escalationElapsedAtFork,
			uint256 escalationStartBondAtForkAttoRep,
			uint256 escalationNonDecisionThresholdAtForkAttoRep,
			bool ownFork,
			bool unresolvedEscalationAtFork,
			uint256 outcomeIndex,
			uint256 forkActivationTime
		)
	{
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		return (
			data.auctionableAttoRepAtFork,
			data.truthAuction,
			data.truthAuctionStarted,
			data.migratedAttoRep,
			data.auctionedUnderwritingLimitAttoEth,
			data.escalationElapsedAtFork,
			data.escalationStartBondAtForkAttoRep,
			data.escalationNonDecisionThresholdAtForkAttoRep,
			data.ownFork,
			data.unresolvedEscalationAtFork,
			data.outcomeIndex,
			data.forkActivationTime
		);
	}

	/// @notice Returns unclaimed auction backing units, underwriting limit, and bad debt, then the auction bad-debt generation and fee index.
	function getUnassignedPosition(ISecurityPool securityPool) external view returns (uint256, uint256, uint256, uint256, uint256) {
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		return (
			data.unassignedRepBackingUnitsAtFinalization - data.claimedAuctionRepBackingUnits,
			data.auctionedUnderwritingLimitAttoEth - data.claimedAuctionedUnderwritingLimitAttoEth,
			auctionedBadDebtByPool[securityPool] - claimedAuctionedBadDebtByPool[securityPool],
			data.auctionBadDebtGeneration,
			data.auctionFeeIndexAtFinalization
		);
	}

	/// @notice Returns whether a parent escalation deposit was already claimed through `claimForkedEscalationDeposits`.
	function isEscalationDepositClaimedDirectly(ISecurityPool securityPool, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256 parentDepositIndex) external view returns (bool) {
		return
			directlyClaimedEscalationDepositById[
				_getEscalationDepositId(securityPool, uint8(outcomeIndex), parentDepositIndex)
			];
	}

	/// @notice Returns the identifier used to track a parent escalation deposit claim.
	function getEscalationDepositId(ISecurityPool securityPool, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256 parentDepositIndex) external view returns (bytes32) {
		return _getEscalationDepositId(securityPool, uint8(outcomeIndex), parentDepositIndex);
	}

	/// @notice Returns the source principal claimed for `outcomeIndex` through `claimForkedEscalationDeposits`.
	function getDirectlyClaimedEscalationPrincipal(ISecurityPool securityPool, BinaryOutcomes.BinaryOutcome outcomeIndex) external view returns (uint256) {
		return directlyClaimedEscalationPrincipalByPoolAndOutcome[securityPool][uint8(outcomeIndex)];
	}

	/// @notice Returns whether `securityPool` forked on its own escalation game, in which case the fork paid the winner haircut.
	function isEscalationWinnerHaircutPaidByFork(ISecurityPool securityPool) external view returns (bool) {
		return forkDataByPool[securityPool].ownFork;
	}

	/// @notice Returns `vault`'s escalation migration entitlement and which child outcomes have materialized it.
	function getEscalationMigrationEntitlementStatus(ISecurityPool securityPool, address vault) external view returns (bool initialized, uint256 totalCurrentAttoRep, bool[3] memory materializedByOutcome) {
		EscalationMigrationEntitlement storage entitlement = escalationMigrationEntitlementByPoolAndVault[securityPool][
			vault
		];
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			materializedByOutcome[outcomeIndex] = escalationEntitlementMaterializedByPoolVaultAndOutcome[securityPool][
				vault
			][outcomeIndex];
		}
		return (entitlement.initialized, entitlement.totalCurrentAttoRep, materializedByOutcome);
	}

	/// @notice Returns the vault, per-child escalation, and escrow source REP recorded at an own-game fork.
	function getOwnForkRepBuckets(ISecurityPool securityPool)
		public
		view
		returns (
			uint256 vaultRepAtForkAttoRep,
			uint256 escalationChildRepPerSelectedOutcomeAttoRep,
			uint256 escrowSourceRepAtForkAttoRep
		)
	{
		SecurityPoolForkerForkData storage repBuckets = forkDataByPool[securityPool];
		return (
			repBuckets.vaultRepAtForkAttoRep,
			repBuckets.escalationChildRepAtForkAttoRep,
			repBuckets.escalationSourceRepAtForkAttoRep
		);
	}

	/// @notice Returns whether the pool forked on its own game, its auctionable REP at fork, and its own-fork REP buckets.
	function getOwnForkMigrationStatus(ISecurityPool securityPool)
		public
		view
		returns (
			bool ownFork,
			uint256 auctionableAttoRepAtFork,
			uint256 vaultRepAtForkAttoRep,
			uint256 escalationChildRepPerSelectedOutcomeAttoRep,
			uint256 escrowSourceRepAtForkAttoRep
		)
	{
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		return (
			data.ownFork,
			data.auctionableAttoRepAtFork,
			data.vaultRepAtForkAttoRep,
			data.escalationChildRepAtForkAttoRep,
			data.escalationSourceRepAtForkAttoRep
		);
	}

	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {
		vaultMigrationDelegate = address(new SecurityPoolForkerVaultMigrationDelegate(_zoltar));
		escalationGameForkerDelegate = address(new EscalationGameForker(_zoltar));
		forkEventEmitter = address(new SecurityPoolForkEventEmitter());
	}

	function _emitForkSnapshotEvents(ISecurityPool parent, address migrationProxy, address sourceGame, uint256 totalPoolHeldRepAtForkAttoRep, uint256 disputeStakedRepAtForkAttoRep, uint256 resultingLockedAttoRep) private {
		DelegateCall.invoke(forkEventEmitter, abi.encodeCall(SecurityPoolForkEventEmitter.emitForkSnapshotEvents, (parent, migrationProxy, sourceGame, totalPoolHeldRepAtForkAttoRep, disputeStakedRepAtForkAttoRep, resultingLockedAttoRep)));
	}

	function _forkOccurredBeforeEscalationSettled(EscalationGame escalationGame, uint256 forkTime) private view returns (bool) {
		if (address(escalationGame) == address(0x0)) return false;
		// SecurityPool.isOperational prevents creating or funding a game after the universe fork.
		// The current unresolved check therefore preserves pre-existing non-decision games;
		// a game finalized before the fork fails both this check and the fork-time end-date check.
		return
			escalationGame.getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None ||
			escalationGame.getEscalationGameEndDate() >= forkTime;
	}

	function _getEscalationElapsedAtFork(EscalationGame escalationGame, uint256 forkTime) private view returns (uint256 elapsedAtFork) {
		if (escalationGame.forkContinuation()) {
			elapsedAtFork = escalationGame.forkElapsedAtStart();
			uint256 resumedAt = escalationGame.forkResumedAt();
			if (resumedAt != 0) {
				if (forkTime > resumedAt) {
					elapsedAtFork += forkTime - resumedAt;
				}
			}
		} else {
			uint256 activationTime = escalationGame.activationTime();
			if (forkTime <= activationTime) return 0;
			elapsedAtFork = forkTime - activationTime;
		}
		if (elapsedAtFork > ESCALATION_TIME_LENGTH) {
			elapsedAtFork = ESCALATION_TIME_LENGTH;
		}
	}

	function _snapshotEscalationAtFork(ISecurityPool securityPool, SecurityPoolForkerForkData storage data, EscalationGame escalationGame, uint256 forkTime) private {
		if (!_forkOccurredBeforeEscalationSettled(escalationGame, forkTime)) return;
		EscalationForkSnapshot storage snapshot = escalationForkSnapshotByPool[securityPool];
		// Keep this unreachable initialization guard data-free for the EIP-170 size limit.
		if (snapshot.initialized) revert();
		(
			bytes32[64][3] memory carryPeaks,
			uint256[3] memory carryLeafCounts,
			uint256[3] memory carryTotalsAttoRep,
			bytes32[3] memory nullifierRoots
		) = escalationGame.getForkCarrySnapshot();
		uint256[3] memory resolutionBalancesAttoRep = escalationGame.getOutcomeBalancesAttoRep();
		bytes32[3] memory carryRoots = escalationGame.getForkCarryRoots();
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			for (uint8 peakIndex = 0; peakIndex < 64; peakIndex++) {
				snapshot.carryPeaks[outcomeIndex][peakIndex] = carryPeaks[outcomeIndex][peakIndex];
			}
			snapshot.carryLeafCounts[outcomeIndex] = carryLeafCounts[outcomeIndex];
			snapshot.carryTotalsAttoRep[outcomeIndex] = carryTotalsAttoRep[outcomeIndex];
			snapshot.resolutionBalancesAttoRep[outcomeIndex] = resolutionBalancesAttoRep[outcomeIndex];
			snapshot.nullifierRoots[outcomeIndex] = nullifierRoots[outcomeIndex];
		}
		snapshot.initialized = true;
		data.escalationSnapshotId = keccak256(abi.encode(address(escalationGame), carryRoots, nullifierRoots, carryLeafCounts, carryTotalsAttoRep, resolutionBalancesAttoRep));
		data.unresolvedEscalationAtFork = true;
		data.escalationStartBondAtForkAttoRep = escalationGame.startBondAttoRep();
		data.escalationNonDecisionThresholdAtForkAttoRep = escalationGame.nonDecisionThresholdAttoRep();
		data.escalationElapsedAtFork = _getEscalationElapsedAtFork(escalationGame, forkTime);
	}

	function _getForkData(ISecurityPool securityPool) private view returns (SecurityPoolForkerForkData storage data) {
		data = forkDataByPool[securityPool];
	}

	function _getEscalationGame(ISecurityPool securityPool) private view returns (EscalationGame escalationGame) {
		escalationGame = securityPool.escalationGame();
		require(address(escalationGame) == address(0x0) || address(escalationGame.securityPool()) == address(securityPool), 'Escalation game pool');
	}

	function _prepareForkState(ISecurityPool securityPool, EscalationGame escalationGame) private returns (SecurityPoolForkerForkData storage data) {
		if (!securityPool.shareToken().isAuthorized(address(securityPool))) revert('Pool is not authorized');
		uint248 universe = securityPool.universeId();
		uint256 forkTime = zoltar.getForkTime(universe);
		require(forkTime > 0, 'Unforked');
		require(securityPool.systemState() != SystemState.PoolForked, 'Forked');
		require(securityPool.systemState() == SystemState.Operational, 'Inactive');
		require(address(escalationGame) == address(0x0) || _forkOccurredBeforeEscalationSettled(escalationGame, forkTime), 'Resolved');
		data = forkDataByPool[securityPool];
		_snapshotEscalationAtFork(securityPool, data, escalationGame, forkTime);
	}

	function _getMigrationProxySalt(ISecurityPool securityPool) private pure returns (bytes32) {
		return keccak256(abi.encode(address(securityPool)));
	}

	/// @notice Returns the deterministic CREATE2 address of `securityPool`'s migration proxy.
	function getMigrationProxyAddress(ISecurityPool securityPool) public view returns (address) {
		bytes32 salt = _getMigrationProxySalt(securityPool);
		bytes32 initCodeHash = keccak256(abi.encodePacked(type(SecurityPoolMigrationProxy).creationCode, abi.encode(zoltar, securityPool.repToken(), securityPool.universeId(), address(this))));
		return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
	}

	// A deterministic proxy gives each parent pool a unique caller for Zoltar migration.
	function _getOrDeployMigrationProxy(ISecurityPool securityPool) private returns (SecurityPoolMigrationProxy migrationProxy) {
		migrationProxy = migrationProxyByPool[securityPool];
		if (address(migrationProxy) != address(0x0)) return migrationProxy;
		migrationProxy = new SecurityPoolMigrationProxy{salt: _getMigrationProxySalt(securityPool)}(zoltar, securityPool.repToken(), securityPool.universeId(), address(this));
		migrationProxyByPool[securityPool] = migrationProxy;
	}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child, EscalationGame childEscalationGame) internal override returns (EscalationGame) {
		_validateChildEscalationGame(child, childEscalationGame);
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		if (!parentForkData.unresolvedEscalationAtFork) return childEscalationGame;
		if (address(childEscalationGame) == address(0x0)) {
			SecurityPoolForkerForkData storage childForkData = forkDataByPool[child];
			child.initializeForkedEscalationGame(parentForkData.escalationStartBondAtForkAttoRep, parentForkData.escalationNonDecisionThresholdAtForkAttoRep, parentForkData.escalationElapsedAtFork, childForkData.fixedQuestionOutcomePlusOne == 0 ? BinaryOutcomes.BinaryOutcome.None : BinaryOutcomes.BinaryOutcome(childForkData.fixedQuestionOutcomePlusOne - 1));
			childEscalationGame = child.escalationGame();
			_validateChildEscalationGame(child, childEscalationGame);
		}
		return super._initializeChildForkedEscalationGameIfNeeded(parent, child, childEscalationGame);
	}

	/// @notice Self-call only: initializes the child's fork-continuation escalation game when the parent forked with an unresolved escalation.
	function initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child, EscalationGame childEscalationGame) external returns (EscalationGame) {
		if (msg.sender != address(this)) revert('Only self');
		return _initializeChildForkedEscalationGameIfNeeded(parent, child, childEscalationGame);
	}

	/// @notice Activates fork mode on a pool in a forked universe and locks its REP and unresolved escrow REP into Zoltar migration; callable by anyone.
	function initiateSecurityPoolFork(ISecurityPool securityPool) external {
		EscalationGame escalationGame = _getEscalationGame(securityPool);
		SecurityPoolForkerForkData storage data = _prepareForkState(securityPool, escalationGame);
		ReputationToken rep = securityPool.repToken();
		uint248 universe = securityPool.universeId();
		data.forkQuestionMatchesPoolQuestion = zoltar.forkQuestionMatches(universe, securityPool.questionId());
		uint256 disputeStakedRepToLockAttoRep =
			data.unresolvedEscalationAtFork ? rep.balanceOf(address(escalationGame)) : 0;
		uint256 repBalanceBeforeAttoRep = rep.balanceOf(address(this));
		securityPool.activateForkMode();
		badDebtAtForkByPool[securityPool] = securityPool.totalBadDebtAttoEth();
		data.forkActivationTime = block.timestamp;
		data.settlementCollateralAtForkAttoEth = securityPool.settlementCollateralAttoEth();
		data.migratedRepAllocatedForSettlementCollateralAttoRep = 0;
		data.settlementCollateralTransferredAttoEth = 0;
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 previousMigrationBalanceAttoRep = zoltar.getMigrationRepBalanceAttoRep(address(migrationProxy), universe);
		uint256 repBalanceAfterAttoRep = rep.balanceOf(address(this));
		uint256 poolRepToLockAttoRep = repBalanceAfterAttoRep - repBalanceBeforeAttoRep - disputeStakedRepToLockAttoRep;
		if (data.unresolvedEscalationAtFork) {
			data.escalationSourceRepAtForkAttoRep = disputeStakedRepToLockAttoRep;
			data.escalationChildRepAtForkAttoRep = disputeStakedRepToLockAttoRep;
		}
		uint256 repToLockAttoRep = poolRepToLockAttoRep + disputeStakedRepToLockAttoRep;
		if (repToLockAttoRep > 0) {
			IERC20(address(rep)).safeTransfer(address(migrationProxy), repToLockAttoRep);
			migrationProxy.lockRep(repToLockAttoRep);
		}
		uint256 migrationBalanceAttoRep = zoltar.getMigrationRepBalanceAttoRep(address(migrationProxy), universe);
		if (migrationBalanceAttoRep != previousMigrationBalanceAttoRep + repToLockAttoRep)
			revert('Incorrect migration balance');
		data.auctionableAttoRepAtFork = previousMigrationBalanceAttoRep + poolRepToLockAttoRep;
		_emitForkSnapshotEvents(securityPool, address(migrationProxy), address(escalationGame), poolRepToLockAttoRep, disputeStakedRepToLockAttoRep, migrationBalanceAttoRep);
	}

	/// @notice Ensures the pool's migration REP is split into the selected outcome children during the migration window; callable by anyone.
	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] calldata outcomeIndices) external {
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[securityPool];
		if (address(migrationProxy) == address(0x0)) revert('Migration proxy unavailable');
		require(securityPool.systemState() == SystemState.PoolForked, 'Unforked');
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		uint256 migrationAmountAttoRep = data.ownFork ? data.vaultRepAtForkAttoRep : data.auctionableAttoRepAtFork;
		if (migrationAmountAttoRep > 0) {
			for (uint256 index = 0; index < outcomeIndices.length; index++) {
				uint256 outcomeIndex = outcomeIndices[index];
				ISecurityPool child = childrenByPoolAndOutcome[securityPool][outcomeIndex];
				if (address(child) != address(0x0)) {
					require(child.systemState() == SystemState.ForkMigration, 'Child closed');
				}
				require(block.timestamp <= data.forkActivationTime + SecurityPoolUtils.MIGRATION_TIME, 'Closed');
				_delegateEnsureChildPoolRepSplit(securityPool, outcomeIndex, migrationAmountAttoRep);
			}
		}
	}

	function _delegateEnsureChildPoolRepSplit(ISecurityPool parent, uint256 outcomeIndex, uint256 amountAttoRep) private {
		_delegateMigrationCall(vaultMigrationDelegate, abi.encodeCall(SecurityPoolForkerVaultMigrationDelegate.ensureChildPoolRepSplit, (parent, outcomeIndex, amountAttoRep)));
	}

	function _delegateMigrationCall(address delegate, bytes memory callData) private returns (bytes memory data) {
		return DelegateCall.invoke(delegate, callData);
	}

	/// @notice Deploys the child universe (if needed) and child pool for `outcomeIndex` during the migration window; reverts if the pool exists.
	function createChildUniverse(ISecurityPool securityPool, uint256 outcomeIndex) external {
		_delegateMigrationCall(vaultMigrationDelegate, abi.encodeCall(SecurityPoolForkerVaultMigrationDelegate.createChildUniverse, (securityPool, outcomeIndex)));
	}

	/// @notice Vault-only: after an own-game fork, carries the vault's deposits on `outcomeIndex` into the child game and exports the child REP to the vault.
	function claimForkedEscalationDeposits(ISecurityPool securityPool, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256[] calldata depositIndexes) external {
		require(msg.sender == vault, 'Vault');
		_delegateMigrationCall(escalationGameForkerDelegate, abi.encodeCall(EscalationGameForker.claimForkedEscalationDeposits, (securityPool, vault, outcomeIndex, depositIndexes)));
	}

	/// @notice Migrates the caller's non-escrowed vault accounting into the `outcomeIndex` child pool during the migration window.
	function migrateVault(ISecurityPool securityPool, uint256 outcomeIndex) public {
		_migrateVaultAndReturnChild(securityPool, outcomeIndex);
	}

	function _migrateVaultAndReturnChild(ISecurityPool securityPool, uint256 outcomeIndex) private returns (ISecurityPool child, EscalationGame childEscalationGame) {
		bytes memory returnData = _delegateMigrationCall(vaultMigrationDelegate, abi.encodeCall(SecurityPoolForkerVaultMigrationDelegate.migrateVault, (securityPool, outcomeIndex)));
		return abi.decode(returnData, (ISecurityPool, EscalationGame));
	}

	/// @notice Vault-only: during the migration window, migrates the vault and materializes its unresolved escalation entitlement in a child pool.
	function migrateVaultWithUnresolvedEscalation(ISecurityPool securityPool, address vault, uint256 childOutcomeIndex) external {
		ISecurityPool child;
		EscalationGame childEscalationGame;
		if (
			msg.sender == vault &&
			block.timestamp <= forkDataByPool[securityPool].forkActivationTime + SecurityPoolUtils.MIGRATION_TIME
		) {
			(child, childEscalationGame) = _migrateVaultAndReturnChild(securityPool, childOutcomeIndex);
		}
		_delegateMigrationCall(escalationGameForkerDelegate, abi.encodeCall(EscalationGameForker.migrateVaultWithUnresolvedEscalation, (securityPool, vault, childOutcomeIndex, child, childEscalationGame)));
	}

	/// @notice After the parent's migration window, starts the child pool's truth auction, or finalizes directly when nothing needs raising.
	function startTruthAuction(ISecurityPool securityPool) external {
		SecurityPoolForkerForkData storage data;
		SecurityPoolForkerForkData storage parentData;
		ISecurityPool parent;
		uint256 parentSettlementCollateralAttoEth;
		(data, parentData, parent, parentSettlementCollateralAttoEth) = _loadTruthAuctionState(securityPool);
		uint256 poolAuctionableRepAtForkAttoRep = _getPoolAuctionableRepAtFork(parentData);
		emit TruthAuctionStarted(securityPool, parentSettlementCollateralAttoEth, data.migratedAttoRep, poolAuctionableRepAtForkAttoRep);
		_startTruthAuctionOrFinalize(securityPool, data, parentData, parentSettlementCollateralAttoEth);
	}

	function _loadTruthAuctionState(ISecurityPool securityPool)
		private
		returns (
			SecurityPoolForkerForkData storage data,
			SecurityPoolForkerForkData storage parentData,
			ISecurityPool parent,
			uint256 parentSettlementCollateralAttoEth
		)
	{
		require(securityPool.systemState() == SystemState.ForkMigration, 'Not mig');
		parent = securityPool.parent();
		// The truth auction ends the parent's pool-specific migration phase for this child branch.
		uint256 parentForkActivationTime = forkDataByPool[parent].forkActivationTime;
		require(parentForkActivationTime > 0 && block.timestamp > parentForkActivationTime + SecurityPoolUtils.MIGRATION_TIME, 'Active');
		data = _getForkData(securityPool);
		parentData = _getForkData(parent);
		uint256 requiredAttoRep = _getPoolAuctionableRepAtFork(parentData);
		_delegateEnsureChildPoolRepSplit(parent, data.outcomeIndex, requiredAttoRep);
		if (securityPool.repToken().balanceOf(address(securityPool)) < requiredAttoRep)
			revert('Insufficient pool-held REP');
		securityPool.setSystemState(SystemState.ForkTruthAuction);
		data.truthAuctionStarted = block.timestamp;
		parent.updateSettlementCollateral();
		// The parent is frozen for the lifetime of its fork. Reserve its complete
		// economic claim supply in every child, independently of how many ERC-1155
		// balances have materialized there so far.
		securityPool.setShareTokenSupplyAttoShares(parent.shareTokenSupplyAttoShares());
		parentSettlementCollateralAttoEth = parentData.settlementCollateralAtForkAttoEth;
	}

	function _startTruthAuctionOrFinalize(ISecurityPool securityPool, SecurityPoolForkerForkData storage data, SecurityPoolForkerForkData storage parentData, uint256 parentSettlementCollateralAttoEth) private {
		if (_isAllRepMigrated(data, parentData, parentSettlementCollateralAttoEth)) {
			// we have acquired all the ETH already, no need for truthAuction
			_finalizeTruthAuction(securityPool);
			return;
		}
		uint256 settlementCollateralToRaiseAttoEth = _computeSettlementCollateralToRaiseAttoEth(parentSettlementCollateralAttoEth, data);
		if (settlementCollateralToRaiseAttoEth == 0) {
			_finalizeTruthAuction(securityPool);
			return;
		}
		// With migrated REP, sell effectively all REP while leaving a tiny residue as
		// the existing vaults' backingUnits anchor. With no migrated REP the full cap may
		// sell; finalization then installs the standard PRICE_PRECISION backingUnits rate
		// because the inherited denominator has no live child-vault owners.
		data.truthAuction.startAuction(settlementCollateralToRaiseAttoEth, _getTruthAuctionCap(securityPool, data, parentData));
	}

	function _isAllRepMigrated(SecurityPoolForkerForkData storage data, SecurityPoolForkerForkData storage parentData, uint256 parentSettlementCollateralAttoEth) private view returns (bool) {
		return
			data.migratedAttoRep >= _getPoolAuctionableRepAtFork(parentData) &&
			data.forkSettlementCollateralReceivedAttoEth >= parentSettlementCollateralAttoEth;
	}

	function _computeSettlementCollateralToRaiseAttoEth(uint256 parentSettlementCollateralAttoEth, SecurityPoolForkerForkData storage data) private view returns (uint256 settlementCollateralToRaiseAttoEth) {
		if (data.forkSettlementCollateralReceivedAttoEth >= parentSettlementCollateralAttoEth) return 0;
		// Migration rounds each branch's cumulative collateral target up. Auction only
		// the exact unfilled snapshot remainder so final collateral cannot exceed it.
		settlementCollateralToRaiseAttoEth =
			parentSettlementCollateralAttoEth - data.forkSettlementCollateralReceivedAttoEth;
	}

	function _getTruthAuctionCap(ISecurityPool securityPool, SecurityPoolForkerForkData storage data, SecurityPoolForkerForkData storage parentData) private view returns (uint256) {
		uint256 poolAuctionableRepAtForkAttoRep = _getPoolAuctionableRepAtFork(parentData);
		uint256 disputeStakedAttoRep = _getEscalationAuctionableRep(securityPool, parentData);
		uint256 combinedAuctionableAttoRep = poolAuctionableRepAtForkAttoRep + disputeStakedAttoRep;
		// Reserve enough combined pool and escalation inventory for the pool's
		// proportional residue to retain every positive migrated claim. Reserving
		// the pool target directly from the combined inventory can leave only game
		// REP unsold and let the pool residue round back to zero.
		uint256 migratedPoolRepRetentionAttoRep = Math.ceilDiv(data.migratedAttoRep, SecurityPoolUtils.MAX_AUCTION_VAULT_HAIRCUT_DIVISOR);
		uint256 combinedRepRetentionAttoRep =
			migratedPoolRepRetentionAttoRep == 0
				? 0
				: Math.mulDiv(migratedPoolRepRetentionAttoRep, combinedAuctionableAttoRep, poolAuctionableRepAtForkAttoRep, Math.Rounding.Ceil);
		if (combinedRepRetentionAttoRep >= combinedAuctionableAttoRep) return 0;
		uint256 cap = combinedAuctionableAttoRep - combinedRepRetentionAttoRep;
		if (cap == combinedAuctionableAttoRep && address(securityPool.escalationGame()) != address(0x0)) cap -= 1;
		return cap;
	}

	function _getEscalationAuctionableRep(ISecurityPool securityPool, SecurityPoolForkerForkData storage parentData) private view returns (uint256) {
		if (!parentData.unresolvedEscalationAtFork) return 0;
		EscalationGame game = securityPool.escalationGame();
		return address(game) == address(0x0) ? 0 : game.totalDisputeStakedAttoRep();
	}

	function _getPoolAuctionableRepAtFork(SecurityPoolForkerForkData storage parentData) private view returns (uint256) {
		return parentData.ownFork ? parentData.vaultRepAtForkAttoRep : parentData.auctionableAttoRepAtFork;
	}

	function _finalizeTruthAuction(ISecurityPool securityPool) private {
		require(securityPool.systemState() == SystemState.ForkTruthAuction, 'Not auction');
		SecurityPoolForkerForkData storage data = _getForkData(securityPool);
		SecurityPoolForkerForkData storage parentData = _getForkData(securityPool.parent());
		(uint256 repPurchasedAttoRep, uint256 auctionSettlementCollateralReceivedAttoEth) = _consumeTruthAuctionRep(securityPool, data);
		uint256 disputeStakedRepSoldAttoRep = _applyEscalationTruthAuctionHaircut(securityPool, parentData, repPurchasedAttoRep);
		_delegateMigrationCall(vaultMigrationDelegate, abi.encodeWithSelector(SecurityPoolForkerVaultMigrationDelegate.finalizeTruthAuctionRepair.selector, securityPool, auctionSettlementCollateralReceivedAttoEth, parentData.settlementCollateralAtForkAttoEth));
		_finalizeBackingUnitsAfterAuction(securityPool, data, parentData, repPurchasedAttoRep, disputeStakedRepSoldAttoRep);
		_finalizeEscalationStateAfterAuction(securityPool, parentData.unresolvedEscalationAtFork);
		emit TruthAuctionFinalized(securityPool);
		securityPool.updateRetentionRate();
	}

	function _consumeTruthAuctionRep(ISecurityPool securityPool, SecurityPoolForkerForkData storage data) private returns (uint256 repPurchasedAttoRep, uint256 ethReceived) {
		if (data.truthAuction.auctionStarted() != 0) {
			uint256 balanceBeforeFinalize = address(this).balance;
			data.truthAuction.finalize();
			ethReceived = address(this).balance - balanceBeforeFinalize;
			if (ethReceived > 0) {
				(bool sent, ) = payable(address(securityPool)).call{value: ethReceived}('');
				require(sent, 'ETH');
			}
			repPurchasedAttoRep = data.truthAuction.totalAttoRepPurchased();
		}
	}

	function _finalizeBackingUnitsAfterAuction(ISecurityPool securityPool, SecurityPoolForkerForkData storage data, SecurityPoolForkerForkData storage parentData, uint256 repPurchasedAttoRep, uint256 disputeStakedRepSoldAttoRep) private {
		uint256 existingPoolBackingUnits = _getPoolAuctionableRepAtFork(parentData);
		uint256 poolHeldRepAtFinalizationAttoRep = existingPoolBackingUnits + disputeStakedRepSoldAttoRep;
		if (poolHeldRepAtFinalizationAttoRep == 0 || repPurchasedAttoRep == 0) {
			data.unassignedRepBackingUnitsAtFinalization = securityPool.totalRepBackingUnits() - data.migratedAttoRep;
			return;
		}
		// Purchases stay pool-held; subtract them after escrow transfers its sold share.
		uint256 existingOwnersResidualRepAttoRep = poolHeldRepAtFinalizationAttoRep - repPurchasedAttoRep;
		uint256 auctionRepBackingUnits;
		uint256 totalRepBackingUnitsAtFinalization;
		if (existingOwnersResidualRepAttoRep == 0) {
			// A full-cap auction has no positive REP residue from which to derive a
			// dilution ratio. Bound auction ownership at the fixed scale while retaining
			// child-local migrated units so sub-haircut claims cannot resurrect.
			auctionRepBackingUnits = Math.mulDiv(poolHeldRepAtFinalizationAttoRep, SecurityPoolUtils.PRICE_PRECISION, 1);
			totalRepBackingUnitsAtFinalization = auctionRepBackingUnits + data.migratedAttoRep;
		} else {
			// Before the auction, pool-held REP equals backing units for all existing pool owners, including unmigrated vaults.
			// Round the complete ratio once; an integer units-per-REP rate would over-dilute those owners.
			totalRepBackingUnitsAtFinalization = Math.mulDiv(existingPoolBackingUnits, poolHeldRepAtFinalizationAttoRep, existingOwnersResidualRepAttoRep, Math.Rounding.Ceil);
			auctionRepBackingUnits = totalRepBackingUnitsAtFinalization - existingPoolBackingUnits;
		}
		securityPool.setTotalRepBackingUnits(totalRepBackingUnitsAtFinalization);
		data.auctionRepBackingUnits = auctionRepBackingUnits;
		data.unassignedRepBackingUnitsAtFinalization = totalRepBackingUnitsAtFinalization - data.migratedAttoRep;
	}

	function _applyEscalationTruthAuctionHaircut(ISecurityPool securityPool, SecurityPoolForkerForkData storage parentData, uint256 repPurchasedAttoRep) private returns (uint256 disputeStakedRepSoldAttoRep) {
		uint256 disputeStakedRepBeforeAttoRep = _getEscalationAuctionableRep(securityPool, parentData);
		if (disputeStakedRepBeforeAttoRep == 0 || repPurchasedAttoRep == 0) return 0;
		uint256 combinedRepBeforeAttoRep = _getPoolAuctionableRepAtFork(parentData) + disputeStakedRepBeforeAttoRep;
		disputeStakedRepSoldAttoRep = Math.mulDiv(repPurchasedAttoRep, disputeStakedRepBeforeAttoRep, combinedRepBeforeAttoRep);
		if (disputeStakedRepSoldAttoRep == 0) return 0;
		securityPool.escalationGame().applyTruthAuctionHaircut(disputeStakedRepSoldAttoRep);
	}

	/// @notice Finalizes the child pool's truth auction after the auction period and installs the post-auction pool state; callable by anyone.
	function finalizeTruthAuction(ISecurityPool securityPool) external payable {
		require(msg.value == 0, 'No repair ETH');
		require(block.timestamp >= _getForkData(securityPool).truthAuctionStarted + UniformPriceDualCapBatchAuctionStorage.AUCTION_TIME, 'Auction open');
		_finalizeTruthAuction(securityPool);
	}

	/// @notice Forks the universe on the pool's own question once its escalation game allows it, using pool-held and escrowed REP; callable by anyone.
	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external {
		EscalationGame escalationGame = _getEscalationGame(securityPool);
		require(address(escalationGame) != address(0x0) && escalationGame.canTriggerOwnFork(), 'Need game');
		require(securityPool.systemState() != SystemState.PoolForked, 'Forked');
		require(securityPool.systemState() == SystemState.Operational, 'Inactive');
		ReputationToken rep = securityPool.repToken();
		uint256 poolRepToForkAttoRep = rep.balanceOf(address(securityPool));
		uint256 disputeStakedRepToForkAttoRep = rep.balanceOf(address(escalationGame));
		uint256 repBalanceBeforeAttoRep = rep.balanceOf(address(this));
		securityPool.activateForkMode();
		badDebtAtForkByPool[securityPool] = securityPool.totalBadDebtAttoEth();
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		data.forkActivationTime = block.timestamp;
		data.ownFork = true;
		data.forkQuestionMatchesPoolQuestion = true;
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 repBalanceAfterAttoRep = rep.balanceOf(address(this));
		uint256 repToForkAttoRep = repBalanceAfterAttoRep - repBalanceBeforeAttoRep;
		uint256 forkThresholdAttoRep = zoltar.getForkThresholdAttoRep(securityPool.universeId());
		if (repToForkAttoRep < forkThresholdAttoRep) revert('Fork threshold not reached');
		if (repToForkAttoRep > 0) IERC20(address(rep)).safeTransfer(address(migrationProxy), repToForkAttoRep);
		migrationProxy.forkUniverse(securityPool.questionId());
		uint256 excessForkAttoRep = repToForkAttoRep - forkThresholdAttoRep;
		if (excessForkAttoRep > 0) migrationProxy.lockRep(excessForkAttoRep);
		uint256 forkTime = zoltar.getForkTime(securityPool.universeId());
		if (forkTime == 0) revert('Universe has not forked');
		// The universe fork extends the parent's fee horizon from the question end
		// to the fork timestamp. Materialize that final interval before capturing
		// collateral so the migration snapshot never includes fee-backed ETH.
		securityPool.updateSettlementCollateral();
		_snapshotEscalationAtFork(securityPool, data, escalationGame, forkTime);
		uint256 auctionableAttoRepAtFork = zoltar.getMigrationRepBalanceAttoRep(address(migrationProxy), securityPool.universeId());
		uint256 forkHaircutAttoRep = forkThresholdAttoRep / zoltar.forkBurnDivisor();
		uint256 escalationChildRepAtForkAttoRep = disputeStakedRepToForkAttoRep - forkHaircutAttoRep;
		uint256 vaultRepAtForkAttoRep = auctionableAttoRepAtFork - escalationChildRepAtForkAttoRep;
		_initializeOwnForkRepBuckets(securityPool, vaultRepAtForkAttoRep, escalationChildRepAtForkAttoRep, disputeStakedRepToForkAttoRep);
		data.auctionableAttoRepAtFork = auctionableAttoRepAtFork;
		data.settlementCollateralAtForkAttoEth = securityPool.settlementCollateralAttoEth();
		data.migratedRepAllocatedForSettlementCollateralAttoRep = 0;
		data.settlementCollateralTransferredAttoEth = 0;
		_emitForkSnapshotEvents(securityPool, address(migrationProxy), address(escalationGame), poolRepToForkAttoRep, disputeStakedRepToForkAttoRep, zoltar.getMigrationRepBalanceAttoRep(address(migrationProxy), securityPool.universeId()));
	}

	/// @notice Accept the entire orphaned position of a finalized zero-purchase auction.
	function takeOverUnassignedCommitment(ISecurityPool securityPool, uint256 maximumCommitmentAttoEth) external {
		_delegateMigrationCall(vaultMigrationDelegate, abi.encodeCall(SecurityPoolForkerVaultMigrationDelegate.takeOverUnassignedCommitment, (securityPool, maximumCommitmentAttoEth)));
	}

	/// @notice Settles finalized truth-auction bids through the forker-owned auction.
	/// @dev Winning and partial bids credit purchased REP into the vault and assign the
	/// corresponding share of auctioned capacity ownership. Finalized losing bids may still
	/// settle here as ETH-only refunds, in which case no vault accounting changes.
	/// Anyone can call this so that settlement is not blocked on the bidder.
	function claimAuctionProceeds(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices) external {
		_claimAuctionProceeds(securityPool, vault, tickIndices);
	}

	/// @notice Submits claim and refund batches for `vault`'s truth-auction bids in a single transaction.
	/// @dev Before finalization, only refundable bids can be settled.
	/// After finalization, both sets are withdrawn as settlement payouts from the auction.
	function settleAuctionBids(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] calldata claimTickIndices, IUniformPriceDualCapBatchAuction.TickIndex[] calldata refundTickIndices) external {
		require(claimTickIndices.length > 0 || refundTickIndices.length > 0, 'Need action');
		if (forkDataByPool[securityPool].truthAuction.finalized()) {
			IUniformPriceDualCapBatchAuction.TickIndex[]
				memory allTickIndices = new IUniformPriceDualCapBatchAuction.TickIndex[](claimTickIndices.length + refundTickIndices.length);
			for (uint256 i = 0; i < claimTickIndices.length; i += 1) {
				allTickIndices[i] = claimTickIndices[i];
			}
			for (uint256 i = 0; i < refundTickIndices.length; i += 1) {
				allTickIndices[claimTickIndices.length + i] = refundTickIndices[i];
			}
			_claimAuctionProceeds(securityPool, vault, allTickIndices);
			return;
		}
		require(claimTickIndices.length == 0, 'Not final');
		_refundLosingAuctionBidsForSettlement(securityPool, vault, refundTickIndices);
	}

	function _claimAuctionProceeds(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] memory tickIndices) private {
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		require(data.truthAuction.finalized(), 'Not final');
		(
			uint256 amountAttoRep,
			,
			uint256 newUnderwritingLimitAttoEth,
			uint256 badDebtToAssignAttoEth,
			uint256 auctionRepBackingUnits
		) = data.truthAuction.withdrawBids(vault, tickIndices, data.auctionedUnderwritingLimitAttoEth, auctionedBadDebtByPool[securityPool], data.auctionRepBackingUnits);
		_delegateMigrationCall(vaultMigrationDelegate, abi.encodeCall(SecurityPoolForkerVaultMigrationDelegate.creditAuctionProceeds, (securityPool, vault, amountAttoRep, newUnderwritingLimitAttoEth, badDebtToAssignAttoEth, data.truthAuction.totalAttoRepPurchased(), auctionRepBackingUnits)));
	}

	function _refundLosingAuctionBidsForSettlement(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices) private {
		forkDataByPool[securityPool].truthAuction.refundLosingBidsFor(vault, tickIndices);
	}

	/// @notice Returns the pool's final question outcome, or None while unresolved or while the pool is forked.
	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome) {
		SystemState systemState = securityPool.systemState();
		if (systemState == SystemState.PoolForked) return BinaryOutcomes.BinaryOutcome.None;
		SecurityPoolForkerForkData storage data = _getForkData(securityPool);
		if (data.fixedQuestionOutcomePlusOne > 0)
			return BinaryOutcomes.BinaryOutcome(data.fixedQuestionOutcomePlusOne - 1);
		if (systemState == SystemState.Operational) {
			EscalationGame escalationGame = securityPool.escalationGame();
			if (address(escalationGame) != address(0x0)) return escalationGame.getFinalQuestionResolution();
		}
		return BinaryOutcomes.BinaryOutcome.None;
	}

	/// @notice Accepts ETH only from trusted truth auctions.
	receive() external payable {
		if (!trustedAuctionAddresses[msg.sender]) revert('Only trusted auction');
	}
}
