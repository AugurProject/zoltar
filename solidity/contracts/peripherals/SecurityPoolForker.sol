// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { IUniformPriceDualCapBatchAuction } from './interfaces/IUniformPriceDualCapBatchAuction.sol';
import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { EscalationGame } from './EscalationGame.sol';
import { ESCALATION_TIME_LENGTH } from './EscalationGameTypes.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';
import { SecurityPoolForkerVaultMigrationDelegate } from './SecurityPoolForkerVaultMigrationDelegate.sol';
import { EscalationGameForker } from './EscalationGameForker.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolEventEmitter } from './SecurityPoolEventEmitter.sol';
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

	event ChildPoolLinked(
		ISecurityPool indexed parent,
		uint256 indexed outcomeIndex,
		ISecurityPool indexed child,
		UniformPriceDualCapBatchAuction truthAuction
	);
	event ChildRepSplit(
		ISecurityPool indexed parent,
		uint256 indexed outcomeIndex,
		uint256 childPoolRepSplit,
		uint256 pendingChildRep
	);
	event ClaimForkedEscalationDepositsToWallet(
		ISecurityPool indexed parent,
		address indexed vault,
		BinaryOutcomes.BinaryOutcome indexed outcomeIndex,
		uint256[] depositIndexes,
		uint256 sourceRepClaimed,
		uint256 walletRepPaid,
		bool ownFork
	);
	event TruthAuctionStarted(
		ISecurityPool indexed securityPool,
		uint256 completeSetCollateralAmount,
		uint256 repMigrated,
		uint256 auctionableRepAtFork
	);
	event TruthAuctionFinalized(ISecurityPool indexed securityPool);
	event ClaimAuctionProceeds(
		ISecurityPool indexed securityPool,
		address indexed vault,
		uint256 amount,
		uint256 poolOwnershipAmount,
		uint256 poolOwnershipDenominator,
		uint256 claimedAuctionRepPurchased,
		uint256 claimedAuctionedSecurityBondAllowance
	);
	function forkData(
		ISecurityPool securityPool
	)
		public
		view
		returns (
			uint256 auctionableRepAtFork,
			UniformPriceDualCapBatchAuction truthAuction,
			uint256 truthAuctionStarted,
			uint256 migratedRep,
			uint256 auctionedSecurityBondAllowance,
			uint256 escalationElapsedAtFork,
			uint256 escalationStartBondAtFork,
			uint256 escalationNonDecisionThresholdAtFork,
			bool ownFork,
			bool unresolvedEscalationAtFork,
			uint256 outcomeIndex
		)
	{
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		return (
			data.auctionableRepAtFork,
			data.truthAuction,
			data.truthAuctionStarted,
			data.migratedRep,
			data.auctionedSecurityBondAllowance,
			data.escalationElapsedAtFork,
			data.escalationStartBondAtFork,
			data.escalationNonDecisionThresholdAtFork,
			data.ownFork,
			data.unresolvedEscalationAtFork,
			data.outcomeIndex
		);
	}

	function getMigratedRep(ISecurityPool securityPool) public view returns (uint256) {
		return forkDataByPool[securityPool].migratedRep;
	}

	function getForkActivationTime(ISecurityPool securityPool) external view returns (uint256) {
		return forkDataByPool[securityPool].forkActivationTime;
	}

	function isEscalationDepositClaimedDirectly(
		ISecurityPool securityPool,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256 parentDepositIndex
	) external view returns (bool) {
		return
			directlyClaimedEscalationDepositById[
				_getEscalationDepositId(securityPool, uint8(outcomeIndex), parentDepositIndex)
			];
	}

	function getEscalationDepositId(
		ISecurityPool securityPool,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256 parentDepositIndex
	) external view returns (bytes32) {
		return _getEscalationDepositId(securityPool, uint8(outcomeIndex), parentDepositIndex);
	}

	function getDirectlyClaimedEscalationPrincipal(
		ISecurityPool securityPool,
		BinaryOutcomes.BinaryOutcome outcomeIndex
	) external view returns (uint256) {
		return directlyClaimedEscalationPrincipalByPoolAndOutcome[securityPool][uint8(outcomeIndex)];
	}

	function isEscalationWinnerHaircutPaidByFork(ISecurityPool securityPool) external view returns (bool) {
		return forkDataByPool[securityPool].ownFork;
	}

	function getEscalationMigrationEntitlementStatus(
		ISecurityPool securityPool,
		address vault
	) external view returns (bool initialized, uint256 totalCurrentRep, bool[3] memory materializedByOutcome) {
		EscalationMigrationEntitlement storage entitlement = escalationMigrationEntitlementByPoolAndVault[securityPool][
			vault
		];
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			materializedByOutcome[outcomeIndex] = escalationEntitlementMaterializedByPoolVaultAndOutcome[securityPool][
				vault
			][outcomeIndex];
		}
		return (entitlement.initialized, entitlement.totalCurrentRep, materializedByOutcome);
	}

	function getOwnForkRepBuckets(
		ISecurityPool securityPool
	)
		public
		view
		returns (uint256 vaultRepAtFork, uint256 escalationChildRepPerSelectedOutcome, uint256 escrowSourceRepAtFork)
	{
		SecurityPoolForkerForkData storage repBuckets = forkDataByPool[securityPool];
		return (repBuckets.vaultRepAtFork, repBuckets.escalationChildRepAtFork, repBuckets.escalationSourceRepAtFork);
	}

	function getOwnForkMigrationStatus(
		ISecurityPool securityPool
	)
		public
		view
		returns (
			bool ownFork,
			uint256 auctionableRepAtFork,
			uint256 vaultRepAtFork,
			uint256 escalationChildRepPerSelectedOutcome,
			uint256 escrowSourceRepAtFork
		)
	{
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		return (
			data.ownFork,
			data.auctionableRepAtFork,
			data.vaultRepAtFork,
			data.escalationChildRepAtFork,
			data.escalationSourceRepAtFork
		);
	}

	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {
		vaultMigrationDelegate = address(new SecurityPoolForkerVaultMigrationDelegate(_zoltar));
		escalationGameForkerDelegate = address(new EscalationGameForker(_zoltar));
		forkEventEmitter = address(new SecurityPoolEventEmitter());
	}

	function _emitForkSnapshotEvents(
		ISecurityPool parent,
		address migrationProxy,
		address sourceGame,
		uint256 poolRepAtFork,
		uint256 escalationRepAtFork,
		uint256 resultingLockedRep
	) private {
		address eventEmitter = forkEventEmitter;
		assembly ('memory-safe') {
			let pointer := mload(0x40)
			mstore(pointer, shl(224, 0x408d33da))
			mstore(add(pointer, 0x04), parent)
			mstore(add(pointer, 0x24), migrationProxy)
			mstore(add(pointer, 0x44), sourceGame)
			mstore(add(pointer, 0x64), poolRepAtFork)
			mstore(add(pointer, 0x84), escalationRepAtFork)
			mstore(add(pointer, 0xa4), resultingLockedRep)
			if iszero(delegatecall(gas(), eventEmitter, pointer, 0xc4, 0, 0)) {
				revert(0, 0)
			}
		}
	}

	function _forkOccurredBeforeEscalationSettled(
		EscalationGame escalationGame,
		uint256 forkTime
	) private view returns (bool) {
		if (address(escalationGame) == address(0x0)) return false;
		// SecurityPool.isOperational prevents creating or funding a game after the universe fork.
		// The current unresolved check therefore preserves pre-existing non-decision games;
		// a game finalized before the fork fails both this check and the fork-time end-date check.
		return
			escalationGame.getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None ||
			escalationGame.getEscalationGameEndDate() >= forkTime;
	}

	function _getEscalationElapsedAtFork(
		EscalationGame escalationGame,
		uint256 forkTime
	) private view returns (uint256 elapsedAtFork) {
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

	function _snapshotEscalationAtFork(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage data,
		EscalationGame escalationGame,
		uint256 forkTime
	) private {
		if (!_forkOccurredBeforeEscalationSettled(escalationGame, forkTime)) return;
		EscalationForkSnapshot storage snapshot = escalationForkSnapshotByPool[securityPool];
		// Keep this unreachable double-initialization guard data-free so the forker
		// remains deployable under the EIP-170 runtime bytecode limit.
		if (snapshot.initialized) revert();
		(
			bytes32[64][3] memory carryPeaks,
			uint256[3] memory carryLeafCounts,
			uint256[3] memory carryTotals,
			bytes32[3] memory nullifierRoots
		) = escalationGame.getForkCarrySnapshot();
		uint256[3] memory resolutionBalances = escalationGame.getOutcomeBalances();
		bytes32[3] memory carryRoots = escalationGame.getForkCarryRoots();
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			for (uint8 peakIndex = 0; peakIndex < 64; peakIndex++) {
				snapshot.carryPeaks[outcomeIndex][peakIndex] = carryPeaks[outcomeIndex][peakIndex];
			}
			snapshot.carryLeafCounts[outcomeIndex] = carryLeafCounts[outcomeIndex];
			snapshot.carryTotals[outcomeIndex] = carryTotals[outcomeIndex];
			snapshot.resolutionBalances[outcomeIndex] = resolutionBalances[outcomeIndex];
			snapshot.nullifierRoots[outcomeIndex] = nullifierRoots[outcomeIndex];
		}
		snapshot.initialized = true;
		data.escalationSnapshotId = keccak256(
			abi.encode(
				address(escalationGame),
				carryRoots,
				nullifierRoots,
				carryLeafCounts,
				carryTotals,
				resolutionBalances
			)
		);
		data.unresolvedEscalationAtFork = true;
		data.escalationStartBondAtFork = escalationGame.startBond();
		data.escalationNonDecisionThresholdAtFork = escalationGame.nonDecisionThreshold();
		data.escalationElapsedAtFork = _getEscalationElapsedAtFork(escalationGame, forkTime);
	}

	function _getForkData(ISecurityPool securityPool) private view returns (SecurityPoolForkerForkData storage data) {
		data = forkDataByPool[securityPool];
	}

	function _getEscalationGame(ISecurityPool securityPool) private view returns (EscalationGame escalationGame) {
		escalationGame = securityPool.escalationGame();
		require(
			address(escalationGame) == address(0x0) || address(escalationGame.securityPool()) == address(securityPool),
			'Escalation game pool'
		);
	}

	function _prepareForkState(
		ISecurityPool securityPool,
		EscalationGame escalationGame
	) private returns (SecurityPoolForkerForkData storage data) {
		uint248 universe = securityPool.universeId();
		uint256 forkTime = zoltar.getForkTime(universe);
		require(forkTime > 0, 'Unforked');
		require(securityPool.systemState() != SystemState.PoolForked, 'Forked');
		require(securityPool.systemState() == SystemState.Operational, 'Inactive');
		require(
			address(escalationGame) == address(0x0) || _forkOccurredBeforeEscalationSettled(escalationGame, forkTime),
			'Resolved'
		);
		data = forkDataByPool[securityPool];
		_snapshotEscalationAtFork(securityPool, data, escalationGame, forkTime);
	}

	function _getMigrationProxySalt(ISecurityPool securityPool) private pure returns (bytes32) {
		return keccak256(abi.encode(address(securityPool)));
	}

	function getMigrationProxyAddress(ISecurityPool securityPool) public view returns (address) {
		bytes32 salt = _getMigrationProxySalt(securityPool);
		bytes32 initCodeHash = keccak256(
			abi.encodePacked(
				type(SecurityPoolMigrationProxy).creationCode,
				abi.encode(zoltar, securityPool.repToken(), securityPool.universeId(), address(this))
			)
		);
		return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
	}

	// Lazily deploy one proxy per parent pool so that all Zoltar migration calls for
	// that pool use a unique `msg.sender`. CREATE2 keeps the proxy address stable
	// and predictable from the pool address before deployment.
	function _getOrDeployMigrationProxy(
		ISecurityPool securityPool
	) private returns (SecurityPoolMigrationProxy migrationProxy) {
		migrationProxy = migrationProxyByPool[securityPool];
		if (address(migrationProxy) != address(0x0)) return migrationProxy;
		migrationProxy = new SecurityPoolMigrationProxy{ salt: _getMigrationProxySalt(securityPool) }(
			zoltar,
			securityPool.repToken(),
			securityPool.universeId(),
			address(this)
		);
		migrationProxyByPool[securityPool] = migrationProxy;
	}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) internal override {
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		if (!parentForkData.unresolvedEscalationAtFork) return;
		if (address(child.escalationGame()) == address(0x0)) {
			SecurityPoolForkerForkData storage childForkData = forkDataByPool[child];
			child.initializeForkedEscalationGame(
				parentForkData.escalationStartBondAtFork,
				parentForkData.escalationNonDecisionThresholdAtFork,
				parentForkData.escalationElapsedAtFork,
				childForkData.fixedQuestionOutcomePlusOne == 0
					? BinaryOutcomes.BinaryOutcome.None
					: BinaryOutcomes.BinaryOutcome(childForkData.fixedQuestionOutcomePlusOne - 1)
			);
		}
		super._initializeChildForkedEscalationGameIfNeeded(parent, child);
	}

	function initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) external {
		require(msg.sender == address(this), 'Forker');
		_initializeChildForkedEscalationGameIfNeeded(parent, child);
	}

	function initiateSecurityPoolFork(ISecurityPool securityPool) external {
		EscalationGame escalationGame = _getEscalationGame(securityPool);
		SecurityPoolForkerForkData storage data = _prepareForkState(securityPool, escalationGame);
		ReputationToken rep = securityPool.repToken();
		uint248 universe = securityPool.universeId();
		data.forkQuestionMatchesPoolQuestion = zoltar.forkQuestionMatches(universe, securityPool.questionId());
		uint256 escalationRepToLock = data.unresolvedEscalationAtFork ? rep.balanceOf(address(escalationGame)) : 0;
		uint256 repBalanceBefore = rep.balanceOf(address(this));
		securityPool.activateForkMode(data.forkQuestionMatchesPoolQuestion);
		data.forkActivationTime = block.timestamp;
		data.collateralAtFork = securityPool.completeSetCollateralAmount();
		data.migratedRepCollateralized = 0;
		data.collateralTransferred = 0;
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 previousMigrationBalance = zoltar.getMigrationRepBalance(address(migrationProxy), universe);
		uint256 repBalanceAfter = rep.balanceOf(address(this));
		uint256 poolRepToLock = repBalanceAfter - repBalanceBefore - escalationRepToLock;
		if (data.unresolvedEscalationAtFork) {
			data.escalationSourceRepAtFork = escalationRepToLock;
			data.escalationChildRepAtFork = escalationRepToLock;
		}
		uint256 repToLock = poolRepToLock + escalationRepToLock;
		if (repToLock > 0) {
			IERC20(address(rep)).safeTransfer(address(migrationProxy), repToLock);
			migrationProxy.lockRep(repToLock);
		}
		uint256 migrationBalance = zoltar.getMigrationRepBalance(address(migrationProxy), universe);
		// Keep this migration accounting invariant data-free so the forker remains deployable
		// under the EIP-3860 initcode limit.
		if (migrationBalance != previousMigrationBalance + repToLock) revert();
		data.auctionableRepAtFork = previousMigrationBalance + poolRepToLock;
		_emitForkSnapshotEvents(
			securityPool,
			address(migrationProxy),
			address(escalationGame),
			poolRepToLock,
			escalationRepToLock,
			migrationBalance
		);
		// TODO: we could pay the caller basefee*2 out of Open interest. We have to reward caller
	}

	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] calldata outcomeIndices) external {
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[securityPool];
		require(address(migrationProxy) != address(0x0), 'Proxy');
		require(securityPool.systemState() == SystemState.PoolForked, 'Unforked');
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		uint256 migrationAmount = data.ownFork ? data.vaultRepAtFork : data.auctionableRepAtFork;
		if (migrationAmount > 0) {
			for (uint256 index = 0; index < outcomeIndices.length; index++) {
				uint256 outcomeIndex = outcomeIndices[index];
				ISecurityPool child = childrenByPoolAndOutcome[securityPool][outcomeIndex];
				if (address(child) != address(0x0)) {
					require(child.systemState() == SystemState.ForkMigration, 'Child closed');
				}
				require(block.timestamp <= data.forkActivationTime + SecurityPoolUtils.MIGRATION_TIME, 'Closed');
				_delegateEnsureChildPoolRepSplit(securityPool, outcomeIndex, migrationAmount);
			}
		}
	}

	function _delegateEnsureChildPoolRepSplit(ISecurityPool parent, uint256 outcomeIndex, uint256 amount) private {
		_delegateMigrationCall(
			vaultMigrationDelegate,
			abi.encodeCall(
				SecurityPoolForkerVaultMigrationDelegate.ensureChildPoolRepSplit,
				(parent, outcomeIndex, amount)
			)
		);
	}

	function _delegateMigrationCall(address delegate, bytes memory callData) private {
		(bool success, bytes memory data) = delegate.delegatecall(callData);
		if (!success) {
			assembly ('memory-safe') {
				revert(add(data, 0x20), mload(data))
			}
		}
	}

	function createChildUniverse(ISecurityPool securityPool, uint256 outcomeIndex) external {
		_delegateMigrationCall(
			vaultMigrationDelegate,
			abi.encodeCall(SecurityPoolForkerVaultMigrationDelegate.createChildUniverse, (securityPool, outcomeIndex))
		);
	}

	function claimForkedEscalationDeposits(
		ISecurityPool securityPool,
		address vault,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256[] calldata depositIndexes
	) external {
		require(msg.sender == vault, 'Vault');
		_delegateMigrationCall(
			escalationGameForkerDelegate,
			abi.encodeCall(
				EscalationGameForker.claimForkedEscalationDeposits,
				(securityPool, vault, outcomeIndex, depositIndexes)
			)
		);
	}

	// migrates vault into outcome universe after fork
	function migrateVault(ISecurityPool securityPool, uint256 outcomeIndex) public {
		_delegateMigrationCall(
			vaultMigrationDelegate,
			abi.encodeCall(SecurityPoolForkerVaultMigrationDelegate.migrateVault, (securityPool, outcomeIndex))
		);
	}

	function migrateVaultWithUnresolvedEscalation(
		ISecurityPool securityPool,
		address vault,
		uint256 childOutcomeIndex
	) external {
		if (
			msg.sender == vault &&
			block.timestamp <= forkDataByPool[securityPool].forkActivationTime + SecurityPoolUtils.MIGRATION_TIME
		) {
			migrateVault(securityPool, childOutcomeIndex);
		}
		_delegateMigrationCall(
			escalationGameForkerDelegate,
			abi.encodeCall(
				EscalationGameForker.migrateVaultWithUnresolvedEscalation,
				(securityPool, vault, childOutcomeIndex)
			)
		);
	}

	function startTruthAuction(ISecurityPool securityPool) external {
		SecurityPoolForkerForkData storage data;
		SecurityPoolForkerForkData storage parentData;
		ISecurityPool parent;
		uint256 parentCollateral;
		(data, parentData, parent, parentCollateral) = _loadTruthAuctionState(securityPool);
		uint256 poolAuctionableRepAtFork = _getPoolAuctionableRepAtFork(parentData);
		emit TruthAuctionStarted(securityPool, parentCollateral, data.migratedRep, poolAuctionableRepAtFork);
		_startTruthAuctionOrFinalize(securityPool, data, parentData, parentCollateral);
	}

	function _loadTruthAuctionState(
		ISecurityPool securityPool
	)
		private
		returns (
			SecurityPoolForkerForkData storage data,
			SecurityPoolForkerForkData storage parentData,
			ISecurityPool parent,
			uint256 parentCollateral
		)
	{
		require(securityPool.systemState() == SystemState.ForkMigration, 'Not mig');
		parent = securityPool.parent();
		// The truth auction ends the parent's pool-specific migration phase for this child branch.
		uint256 parentForkActivationTime = forkDataByPool[parent].forkActivationTime;
		require(
			parentForkActivationTime > 0 &&
				block.timestamp > parentForkActivationTime + SecurityPoolUtils.MIGRATION_TIME,
			'Active'
		);
		data = _getForkData(securityPool);
		parentData = _getForkData(parent);
		uint256 requiredRep = _getPoolAuctionableRepAtFork(parentData);
		_delegateEnsureChildPoolRepSplit(parent, data.outcomeIndex, requiredRep);
		// Keep this invariant guard data-free: a revert string exceeds the EVM initcode limit.
		if (securityPool.repToken().balanceOf(address(securityPool)) < requiredRep) revert();
		securityPool.setSystemState(SystemState.ForkTruthAuction);
		data.truthAuctionStarted = block.timestamp;
		parent.updateCollateralAmount();
		// The parent is frozen for the lifetime of its fork. Reserve its complete
		// economic claim supply in every child, independently of how many ERC-1155
		// balances have materialized there so far.
		securityPool.setTotalShares(parent.shareTokenSupply());
		parentCollateral = parentData.collateralAtFork;
	}

	function _startTruthAuctionOrFinalize(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage data,
		SecurityPoolForkerForkData storage parentData,
		uint256 parentCollateral
	) private {
		if (_isAllRepMigrated(data, parentData)) {
			// we have acquired all the ETH already, no need for truthAuction
			_finalizeTruthAuction(securityPool);
			return;
		}
		uint256 ethToBuy = _computeRepNeededForAuction(parentCollateral, data, parentData);
		if (ethToBuy == 0) {
			_finalizeTruthAuction(securityPool);
			return;
		}
		// Sell effectively all REP for ETH while leaving only a tiny migrated-rep residue unsold.
		// This intentionally parses as `repAtFork - (migratedRep / divisor)`: the parent
		// pool keeps its full REP-at-fork anchor, and only the tiny unsold residue is scaled
		// down by the haircut divisor. We cannot sell literally all REP because
		// `poolOwnershipDenominator` still needs a finite anchor.
		data.truthAuction.startAuction(ethToBuy, _getTruthAuctionCap(data, parentData));
	}

	function _isAllRepMigrated(
		SecurityPoolForkerForkData storage data,
		SecurityPoolForkerForkData storage parentData
	) private view returns (bool) {
		return data.migratedRep >= _getPoolAuctionableRepAtFork(parentData);
	}

	function _computeRepNeededForAuction(
		uint256 parentCollateral,
		SecurityPoolForkerForkData storage data,
		SecurityPoolForkerForkData storage parentData
	) private view returns (uint256 ethToBuy) {
		uint256 poolAuctionableRepAtFork = _getPoolAuctionableRepAtFork(parentData);
		if (poolAuctionableRepAtFork == 0 || data.migratedRep >= poolAuctionableRepAtFork) return 0;
		if (data.forkCollateralReceived >= parentCollateral) return 0;
		// Migration rounds each branch's cumulative collateral target up. Auction only
		// the exact unfilled snapshot remainder so final collateral cannot exceed it.
		ethToBuy = parentCollateral - data.forkCollateralReceived;
	}

	function _getTruthAuctionCap(
		SecurityPoolForkerForkData storage data,
		SecurityPoolForkerForkData storage parentData
	) private view returns (uint256) {
		uint256 poolAuctionableRepAtFork = _getPoolAuctionableRepAtFork(parentData);
		uint256 migratedRepHaircut = data.migratedRep / SecurityPoolUtils.MAX_AUCTION_VAULT_HAIRCUT_DIVISOR;
		if (migratedRepHaircut >= poolAuctionableRepAtFork) return 0;
		return poolAuctionableRepAtFork - migratedRepHaircut;
	}

	function _getPoolAuctionableRepAtFork(
		SecurityPoolForkerForkData storage parentData
	) private view returns (uint256) {
		return parentData.ownFork ? parentData.vaultRepAtFork : parentData.auctionableRepAtFork;
	}

	function _finalizeTruthAuction(ISecurityPool securityPool) private {
		require(securityPool.systemState() == SystemState.ForkTruthAuction, 'Not auction');
		SecurityPoolForkerForkData storage data = _getForkData(securityPool);
		SecurityPoolForkerForkData storage parentData = _getForkData(securityPool.parent());
		(uint256 repPurchased, uint256 auctionEthReceived) = _consumeTruthAuctionRep(securityPool, data);
		_delegateMigrationCall(
			vaultMigrationDelegate,
			abi.encodeWithSelector(
				SecurityPoolForkerVaultMigrationDelegate.finalizeTruthAuctionRepair.selector,
				securityPool,
				auctionEthReceived,
				parentData.collateralAtFork
			)
		);
		_finalizeOwnershipAfterAuction(securityPool, data, parentData, repPurchased);
		_finalizeEscalationStateAfterAuction(securityPool, parentData);
		emit TruthAuctionFinalized(securityPool);
		securityPool.updateRetentionRate();
	}

	function _consumeTruthAuctionRep(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage data
	) private returns (uint256 repPurchased, uint256 ethReceived) {
		if (data.truthAuction.auctionStarted() != 0) {
			uint256 balanceBeforeFinalize = address(this).balance;
			data.truthAuction.finalize();
			ethReceived = address(this).balance - balanceBeforeFinalize;
			if (ethReceived > 0) {
				(bool sent, ) = payable(address(securityPool)).call{ value: ethReceived }('');
				require(sent, 'ETH');
			}
			repPurchased = data.truthAuction.totalRepPurchased();
		}
	}

	function _finalizeOwnershipAfterAuction(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage data,
		SecurityPoolForkerForkData storage parentData,
		uint256 repPurchased
	) private {
		uint256 repAvailable = _getPoolAuctionableRepAtFork(parentData);
		if (repAvailable > 0) {
			uint256 currentOwnershipDenominator = securityPool.poolOwnershipDenominator();
			uint256 auctionPoolOwnershipPerRep = _calculateAuctionPoolOwnershipPerRep(
				currentOwnershipDenominator,
				repAvailable,
				repPurchased
			);
			if (auctionPoolOwnershipPerRep > 0) {
				// Make every auction claim an exact ownership conversion. The final denominator
				// is a multiple of total pool REP, so `amount * auctionPoolOwnershipPerRep`
				// round-trips through `poolOwnershipToRep` without per-claim ceiling drift.
				data.auctionPoolOwnershipPerRep = auctionPoolOwnershipPerRep;
				securityPool.setOwnershipDenominator(repAvailable * auctionPoolOwnershipPerRep);
			} else if (currentOwnershipDenominator == 0) {
				securityPool.setOwnershipDenominator(repAvailable * SecurityPoolUtils.PRICE_PRECISION);
			}
		}
		if (securityPool.poolOwnershipDenominator() == 0) {
			// wipe all rep holders in vaults
			securityPool.setOwnershipDenominator(repAvailable * SecurityPoolUtils.PRICE_PRECISION);
		}
	}

	function _calculateAuctionPoolOwnershipPerRep(
		uint256 currentOwnershipDenominator,
		uint256 repAvailable,
		uint256 repPurchased
	) private pure returns (uint256) {
		if (repPurchased == 0 || repAvailable == 0) return 0;
		uint256 unsoldRep = repAvailable - repPurchased;
		if (unsoldRep == 0) {
			return
				currentOwnershipDenominator == 0 ? SecurityPoolUtils.PRICE_PRECISION : currentOwnershipDenominator + 1;
		}
		if (currentOwnershipDenominator == 0) return SecurityPoolUtils.PRICE_PRECISION;
		return (currentOwnershipDenominator - 1) / unsoldRep + 1;
	}

	function _finalizeEscalationStateAfterAuction(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage parentData
	) private {
		if (!parentData.unresolvedEscalationAtFork) return;
		EscalationGame childEscalationGame = securityPool.escalationGame();
		if (address(childEscalationGame) == address(0x0)) return;
		_finalizeAwaitingForkContinuationIfReady(securityPool, childEscalationGame);
	}

	function finalizeTruthAuction(ISecurityPool securityPool) external payable {
		require(msg.value == 0, 'Auction finalization does not accept repair contributions');
		require(
			block.timestamp > _getForkData(securityPool).truthAuctionStarted + SecurityPoolUtils.AUCTION_TIME,
			'Auction open'
		);
		_finalizeTruthAuction(securityPool);
	}

	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external {
		EscalationGame escalationGame = _getEscalationGame(securityPool);
		require(address(escalationGame) != address(0x0) && escalationGame.nonDecisionTimestamp() > 0, 'Need game');
		require(securityPool.systemState() != SystemState.PoolForked, 'Forked');
		require(securityPool.systemState() == SystemState.Operational, 'Inactive');
		ReputationToken rep = securityPool.repToken();
		uint256 poolRepToFork = rep.balanceOf(address(securityPool));
		uint256 escalationRepToFork = rep.balanceOf(address(escalationGame));
		uint256 repBalanceBefore = rep.balanceOf(address(this));
		securityPool.activateForkMode(true);
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		data.forkActivationTime = block.timestamp;
		data.ownFork = true;
		data.forkQuestionMatchesPoolQuestion = true;
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 repBalanceAfter = rep.balanceOf(address(this));
		uint256 repToFork = repBalanceAfter - repBalanceBefore;
		uint256 forkThreshold = zoltar.getForkThreshold(securityPool.universeId());
		// Keep these invariant guards data-free: revert strings exceed the EVM
		// runtime and initcode limits once fork reconciliation is enabled.
		if (repToFork < forkThreshold) revert();
		if (repToFork > 0) IERC20(address(rep)).safeTransfer(address(migrationProxy), repToFork);
		migrationProxy.forkUniverse(securityPool.questionId());
		uint256 excessForkRep = repToFork - forkThreshold;
		if (excessForkRep > 0) migrationProxy.lockRep(excessForkRep);
		uint256 forkTime = zoltar.getForkTime(securityPool.universeId());
		if (forkTime == 0) revert();
		// The universe fork extends the parent's fee horizon from the question end
		// to the fork timestamp. Materialize that final interval before capturing
		// collateral so the migration snapshot never includes fee-backed ETH.
		securityPool.updateCollateralAmount();
		_snapshotEscalationAtFork(securityPool, data, escalationGame, forkTime);
		uint256 auctionableRepAtFork = zoltar.getMigrationRepBalance(
			address(migrationProxy),
			securityPool.universeId()
		);
		uint256 forkHaircut = forkThreshold / zoltar.forkBurnDivisor();
		uint256 escalationChildRepAtFork = escalationRepToFork - forkHaircut;
		uint256 vaultRepAtFork = auctionableRepAtFork - escalationChildRepAtFork;
		_initializeOwnForkRepBuckets(securityPool, vaultRepAtFork, escalationChildRepAtFork, escalationRepToFork);
		data.auctionableRepAtFork = auctionableRepAtFork;
		data.collateralAtFork = securityPool.completeSetCollateralAmount();
		data.migratedRepCollateralized = 0;
		data.collateralTransferred = 0;
		_emitForkSnapshotEvents(
			securityPool,
			address(migrationProxy),
			address(escalationGame),
			poolRepToFork,
			escalationRepToFork,
			zoltar.getMigrationRepBalance(address(migrationProxy), securityPool.universeId())
		);
	}

	// Settles finalized truth-auction bids through the forker-owned auction.
	// Winning and partial bids credit purchased REP into the vault and assign the
	// corresponding share of auctioned allowance. Finalized losing bids may still
	// settle here as ETH-only refunds, in which case no vault accounting changes.
	// Anyone can call this so that settlement is not blocked on the bidder.
	function claimAuctionProceeds(
		ISecurityPool securityPool,
		address vault,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices
	) external {
		_claimAuctionProceeds(securityPool, vault, tickIndices);
	}

	// settleAuctionBids lets callers submit both claim and refund batches in a single
	// transaction. Before finalization, only refundable bids can be settled.
	// After finalization, both sets are withdrawn as settlement payouts from the auction.
	function settleAuctionBids(
		ISecurityPool securityPool,
		address vault,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata claimTickIndices,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata refundTickIndices
	) external {
		require(claimTickIndices.length > 0 || refundTickIndices.length > 0, 'Need action');
		if (forkDataByPool[securityPool].truthAuction.finalized()) {
			IUniformPriceDualCapBatchAuction.TickIndex[]
				memory allTickIndices = new IUniformPriceDualCapBatchAuction.TickIndex[](
					claimTickIndices.length + refundTickIndices.length
				);
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

	function _claimAuctionProceeds(
		ISecurityPool securityPool,
		address vault,
		IUniformPriceDualCapBatchAuction.TickIndex[] memory tickIndices
	) private {
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		require(data.truthAuction.finalized(), 'Not final');
		(uint256 amount, , uint256 newSecurityBondAllowance) = data.truthAuction.withdrawBids(
			vault,
			tickIndices,
			data.auctionedSecurityBondAllowance
		);
		_creditAuctionProceeds(
			securityPool,
			vault,
			data,
			amount,
			newSecurityBondAllowance,
			data.truthAuction.totalRepPurchased()
		);
	}

	function _creditAuctionProceeds(
		ISecurityPool securityPool,
		address vault,
		SecurityPoolForkerForkData storage data,
		uint256 amount,
		uint256 newSecurityBondAllowance,
		uint256 totalRepPurchased
	) internal {
		if (amount == 0 && newSecurityBondAllowance == 0) return;
		uint256 auctionPoolOwnershipPerRep = data.auctionPoolOwnershipPerRep;
		if (amount > 0) require(auctionPoolOwnershipPerRep > 0, 'Rate');
		uint256 poolOwnershipAmount = amount * auctionPoolOwnershipPerRep;
		uint256 nextClaimedAuctionPoolOwnership = data.claimedAuctionPoolOwnership + poolOwnershipAmount;
		require(nextClaimedAuctionPoolOwnership <= totalRepPurchased * auctionPoolOwnershipPerRep, 'REP');
		uint256 nextClaimedAuctionedSecurityBondAllowance =
			data.claimedAuctionedSecurityBondAllowance + newSecurityBondAllowance;
		require(nextClaimedAuctionedSecurityBondAllowance <= data.auctionedSecurityBondAllowance, 'Allowance');
		data.claimedAuctionRepPurchased += amount;
		data.claimedAuctionedSecurityBondAllowance = nextClaimedAuctionedSecurityBondAllowance;
		data.claimedAuctionPoolOwnership = nextClaimedAuctionPoolOwnership;
		securityPool.updateVaultFees(vault);
		(uint256 poolOwnership, uint256 currentSecurityBondAllowance, , uint256 currentFeeIndex) = securityPool
			.securityVaults(vault);
		securityPool.configureVault(
			vault,
			poolOwnership + poolOwnershipAmount,
			currentSecurityBondAllowance + newSecurityBondAllowance,
			currentFeeIndex
		);
		securityPool.addFeeEligibleSecurityBondAllowance(vault, newSecurityBondAllowance);
		emit ClaimAuctionProceeds(
			securityPool,
			vault,
			amount,
			poolOwnershipAmount,
			securityPool.poolOwnershipDenominator(),
			data.claimedAuctionRepPurchased,
			data.claimedAuctionedSecurityBondAllowance
		);
	}

	function _refundLosingAuctionBidsForSettlement(
		ISecurityPool securityPool,
		address vault,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices
	) private {
		forkDataByPool[securityPool].truthAuction.refundLosingBidsFor(vault, tickIndices);
	}

	function getQuestionOutcome(
		ISecurityPool securityPool
	) external view returns (BinaryOutcomes.BinaryOutcome outcome) {
		SystemState systemState = securityPool.systemState();
		if (systemState == SystemState.PoolForked) return BinaryOutcomes.BinaryOutcome.None;
		SecurityPoolForkerForkData storage data = _getForkData(securityPool);
		if (data.fixedQuestionOutcomePlusOne > 0)
			return BinaryOutcomes.BinaryOutcome(data.fixedQuestionOutcomePlusOne - 1);
		if (systemState == SystemState.Operational) {
			EscalationGame escalationGame = securityPool.escalationGame();
			uint256 forkTime = zoltar.getForkTime(securityPool.universeId());
			if (address(escalationGame) != address(0x0)) {
				uint256 escalationEndDate = escalationGame.getEscalationGameEndDate();
				if (block.timestamp > escalationEndDate && (forkTime == 0 || escalationEndDate < forkTime))
					return escalationGame.getFinalQuestionResolution();
			}
		}
		return BinaryOutcomes.BinaryOutcome.None;
	}

	receive() external payable {
		require(trustedAuctionAddresses[msg.sender], 'Trusted');
	}
}
