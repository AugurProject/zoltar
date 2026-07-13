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
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';

contract SecurityPoolForker is SecurityPoolForkerBase {
	using SafeERC20Ops for IERC20;
	// These delegates keep fork/migration behavior under the EVM bytecode-size limit while
	// sharing the same storage layout defined by `SecurityPoolForkerBase` and `SecurityPoolForkerStorage`.
	address private immutable vaultMigrationDelegate;
	address private immutable escalationGameForkerDelegate;

	event InitiateSecurityPoolFork(ISecurityPool securityPool, uint256 auctionableRepAtFork, bool ownFork);
	event MigrationProxyDeployed(ISecurityPool securityPool, SecurityPoolMigrationProxy migrationProxy);
	event MigrateVault(
		ISecurityPool parent,
		ISecurityPool child,
		address vault,
		uint256 outcome,
		uint256 poolOwnership,
		uint256 securityBondAllowance,
		uint256 childPoolOwnership,
		uint256 childSecurityBondAllowance
	);
	event MigrateRepFromParent(
		ISecurityPool parent,
		ISecurityPool child,
		address vault,
		uint256 parentSecurityBondAllowance,
		uint256 parentPoolOwnership,
		uint256 migratedSecurityBondAllowance
	);
	event ChildPoolLinked(
		ISecurityPool parent,
		uint256 outcomeIndex,
		ISecurityPool child,
		UniformPriceDualCapBatchAuction truthAuction
	);
	event ChildRepSplit(ISecurityPool parent, uint256 outcomeIndex, uint256 childPoolRepSplit, uint256 pendingChildRep);
	event ChildRepSwept(ISecurityPool parent, uint256 outcomeIndex, ISecurityPool child, uint256 amount);
	event OwnForkChildRepAllocated(
		ISecurityPool parent,
		uint256 outcomeIndex,
		uint256 vaultChildRepUsed,
		uint256 escrowChildRepUsed
	);
	event OwnForkCollateralTransferred(
		ISecurityPool parent,
		ISecurityPool child,
		uint256 childRepAmount,
		uint256 ownForkMigratedRepCollateralized,
		uint256 ownForkCollateralTransferred
	);
	event ClaimForkedEscalationDepositsToWallet(
		ISecurityPool parent,
		address vault,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256[] depositIndexes,
		uint256 sourceRepClaimed,
		uint256 walletRepPaid,
		bool ownFork
	);
	event TruthAuctionStarted(
		ISecurityPool securityPool,
		uint256 completeSetCollateralAmount,
		uint256 repMigrated,
		uint256 auctionableRepAtFork
	);
	event TruthAuctionFinalized(ISecurityPool securityPool);
	event ClaimAuctionProceeds(
		ISecurityPool securityPool,
		address vault,
		uint256 amount,
		uint256 poolOwnershipAmount,
		uint256 poolOwnershipDenominator,
		uint256 claimedAuctionRepPurchased,
		uint256 claimedAuctionedSecurityBondAllowance
	);
	event FinalizeAuction(
		ISecurityPool securityPool,
		uint256 repAvailable,
		uint256 migratedRep,
		uint256 repPurchased,
		uint256 poolOwnershipDenominator,
		uint256 completeSetCollateralAmount
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

	function getOwnForkRepBuckets(
		ISecurityPool securityPool
	) public view returns (uint256 vaultRepAtFork, uint256 unallocatedEscrowChildRep, uint256 escrowSourceRepAtFork) {
		SecurityPoolForkerForkData storage repBuckets = forkDataByPool[securityPool];
		return (
			repBuckets.vaultRepAtFork,
			_unallocatedEscrowChildRep(securityPool, repBuckets),
			repBuckets.escalationSourceRepAtFork
		);
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
			uint256 unallocatedEscrowChildRep,
			uint256 escrowSourceRepAtFork
		)
	{
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		return (
			data.ownFork,
			data.auctionableRepAtFork,
			data.vaultRepAtFork,
			_unallocatedEscrowChildRep(securityPool, data),
			data.escalationSourceRepAtFork
		);
	}

	function isOwnFork(ISecurityPool securityPool) external view returns (bool) {
		return forkDataByPool[securityPool].ownFork;
	}

	function _unallocatedEscrowChildRep(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage data
	) private view returns (uint256) {
		uint256 escrowChildRepUsed;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			escrowChildRepUsed += ownForkChildRepAllocationByPoolAndOutcome[securityPool][outcomeIndex]
				.escrowChildRepUsed;
		}
		uint256 escalationChildRepAtFork = data.escalationChildRepAtFork;
		if (escalationChildRepAtFork <= escrowChildRepUsed) return 0;
		return escalationChildRepAtFork - escrowChildRepUsed;
	}

	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {
		vaultMigrationDelegate = address(new SecurityPoolForkerVaultMigrationDelegate(_zoltar));
		escalationGameForkerDelegate = address(new EscalationGameForker(_zoltar));
	}

	function _forkOccurredBeforeEscalationSettled(EscalationGame escalationGame) private view returns (bool) {
		if (address(escalationGame) == address(0x0)) return false;
		return escalationGame.getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None;
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
		SecurityPoolForkerForkData storage data,
		EscalationGame escalationGame,
		uint256 forkTime
	) private {
		if (!_forkOccurredBeforeEscalationSettled(escalationGame)) return;
		data.unresolvedEscalationAtFork = true;
		data.escalationStartBondAtFork = escalationGame.startBond();
		data.escalationNonDecisionThresholdAtFork = escalationGame.nonDecisionThreshold();
		data.escalationElapsedAtFork = _getEscalationElapsedAtFork(escalationGame, forkTime);
	}

	function _getForkData(ISecurityPool securityPool) private view returns (SecurityPoolForkerForkData storage data) {
		data = forkDataByPool[securityPool];
	}

	function _prepareForkState(
		ISecurityPool securityPool,
		EscalationGame escalationGame
	) private returns (SecurityPoolForkerForkData storage data) {
		uint248 universe = securityPool.universeId();
		uint256 forkTime = zoltar.getForkTime(universe);
		require(forkTime > 0, 'No fork');
		require(securityPool.systemState() != SystemState.PoolForked, 'Already forked');
		require(securityPool.systemState() == SystemState.Operational, 'Not operational');
		require(
			address(escalationGame) == address(0x0) ||
				escalationGame.getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None,
			'Resolved'
		);
		data = forkDataByPool[securityPool];
		_snapshotEscalationAtFork(data, escalationGame, forkTime);
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
		emit MigrationProxyDeployed(securityPool, migrationProxy);
	}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) internal override {
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		if (!parentForkData.unresolvedEscalationAtFork) return;
		if (address(child.escalationGame()) == address(0x0)) {
			child.initializeForkedEscalationGame(
				parentForkData.escalationStartBondAtFork,
				parentForkData.escalationNonDecisionThresholdAtFork,
				parentForkData.escalationElapsedAtFork
			);
		}
		super._initializeChildForkedEscalationGameIfNeeded(parent, child);
	}

	function initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) external {
		require(msg.sender == address(this), 'Forker');
		_initializeChildForkedEscalationGameIfNeeded(parent, child);
	}

	function initiateSecurityPoolFork(ISecurityPool securityPool) external {
		EscalationGame escalationGame = securityPool.escalationGame();
		SecurityPoolForkerForkData storage data = _prepareForkState(securityPool, escalationGame);
		ReputationToken rep = securityPool.repToken();
		uint248 universe = securityPool.universeId();
		uint256 repBalanceBefore = rep.balanceOf(address(this));
		securityPool.activateForkMode();
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 previousMigrationBalance = zoltar.getMigrationRepBalance(address(migrationProxy), universe);
		uint256 repBalanceAfter = rep.balanceOf(address(this));
		uint256 repToLock = repBalanceAfter - repBalanceBefore;
		if (repToLock > 0) IERC20(address(rep)).safeTransfer(address(migrationProxy), repToLock);
		uint256 proxyRepBalance = rep.balanceOf(address(migrationProxy));
		if (proxyRepBalance > 0) migrationProxy.lockRep(proxyRepBalance);
		data.auctionableRepAtFork = zoltar.getMigrationRepBalance(address(migrationProxy), universe);
		require(data.auctionableRepAtFork >= previousMigrationBalance, 'Shrank');
		emit InitiateSecurityPoolFork(securityPool, data.auctionableRepAtFork, data.ownFork);
		// TODO: we could pay the caller basefee*2 out of Open interest. We have to reward caller
	}

	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] calldata outcomeIndices) external {
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[securityPool];
		require(address(migrationProxy) != address(0x0), 'No proxy');
		require(securityPool.systemState() == SystemState.PoolForked, 'Not forked');
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		uint256 migrationAmount = data.ownFork ? data.vaultRepAtFork : data.auctionableRepAtFork;
		if (migrationAmount > 0) {
			for (uint256 index = 0; index < outcomeIndices.length; index++) {
				uint256 outcomeIndex = outcomeIndices[index];
				ISecurityPool child = childrenByPoolAndOutcome[securityPool][outcomeIndex];
				if (address(child) != address(0x0)) {
					require(child.systemState() == SystemState.ForkMigration, 'Child closed');
				}
				require(
					block.timestamp <= zoltar.getForkTime(securityPool.universeId()) + SecurityPoolUtils.MIGRATION_TIME,
					'Closed'
				);
				_delegateMigrationCall(
					vaultMigrationDelegate,
					abi.encodeCall(
						SecurityPoolForkerVaultMigrationDelegate.ensureChildPoolRepSplit,
						(securityPool, outcomeIndex, migrationAmount)
					)
				);
			}
		}
	}

	function _delegateMigrationCall(address delegate, bytes memory callData) private returns (bytes memory returnData) {
		(bool success, bytes memory data) = delegate.delegatecall(callData);
		if (!success) {
			assembly {
				revert(add(data, 0x20), mload(data))
			}
		}
		return data;
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
	function migrateVault(ISecurityPool securityPool, uint256 outcomeIndex) external {
		_delegateMigrationCall(
			vaultMigrationDelegate,
			abi.encodeCall(SecurityPoolForkerVaultMigrationDelegate.migrateVault, (securityPool, outcomeIndex))
		);
	}

	function migrateVaultWithUnresolvedEscalation(
		ISecurityPool securityPool,
		address vault,
		uint256 childOutcomeIndex
	) external returns (bool moreToMigrate) {
		require(msg.sender == vault, 'Vault');
		bytes memory returnData = _delegateMigrationCall(
			escalationGameForkerDelegate,
			abi.encodeCall(
				EscalationGameForker.migrateVaultWithUnresolvedEscalation,
				(securityPool, vault, childOutcomeIndex)
			)
		);
		return abi.decode(returnData, (bool));
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
		require(securityPool.systemState() == SystemState.ForkMigration, 'Not migrating');
		parent = securityPool.parent();
		// The truth auction ends the parent's migration phase for this child branch.
		// A child universe has no fork time until it forks again, so using the child
		// universe timestamp would let auctions start immediately on normal chains.
		uint256 parentForkTime = zoltar.getForkTime(parent.universeId());
		require(parentForkTime > 0 && block.timestamp > parentForkTime + SecurityPoolUtils.MIGRATION_TIME, 'Active');
		data = _getForkData(securityPool);
		securityPool.setSystemState(SystemState.ForkTruthAuction);
		data.truthAuctionStarted = block.timestamp;
		parent.updateCollateralAmount();
		securityPool.setTotalShares(parent.shareTokenSupply());
		parentData = _getForkData(parent);
		parentCollateral =
			parentData.ownFork ? parentData.ownForkCollateralAtFork : parent.completeSetCollateralAmount();
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
		ethToBuy = parentCollateral - (parentCollateral * data.migratedRep) / poolAuctionableRepAtFork;
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
		require(securityPool.systemState() == SystemState.ForkTruthAuction, 'Not in auction');
		SecurityPoolForkerForkData storage data = _getForkData(securityPool);
		SecurityPoolForkerForkData storage parentData = _getForkData(securityPool.parent());
		ISecurityPool parent = securityPool.parent();
		uint256 repPurchased = _consumeTruthAuctionRep(securityPool, data);
		_captureUnclaimedCollateralForAuction(securityPool, parent, data);
		_finalizeOwnershipAfterAuction(securityPool, data, parentData, repPurchased);
		_finalizeEscalationStateAfterAuction(securityPool, parentData);
		_emitFinalizeAuctionEvent(securityPool, parentData, data, repPurchased);
		emit TruthAuctionFinalized(securityPool);
		securityPool.updateRetentionRate();
	}

	function _consumeTruthAuctionRep(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage data
	) private returns (uint256 repPurchased) {
		if (data.truthAuction.auctionStarted() != 0) {
			uint256 balanceBeforeFinalize = address(this).balance;
			data.truthAuction.finalize();
			uint256 ethReceived = address(this).balance - balanceBeforeFinalize;
			if (ethReceived > 0) {
				(bool sent, ) = payable(address(securityPool)).call{ value: ethReceived }('');
				require(sent, 'ETH transfer');
			}
			repPurchased = data.truthAuction.totalRepPurchased();
		}
		securityPool.setSystemState(SystemState.Operational);
	}

	function _captureUnclaimedCollateralForAuction(
		ISecurityPool securityPool,
		ISecurityPool parent,
		SecurityPoolForkerForkData storage data
	) private {
		uint256 balance = address(securityPool).balance;
		uint256 feesOwed = securityPool.totalFeesOwedToVaults();
		uint256 collateralAmount = balance >= feesOwed ? balance - feesOwed : 0;
		uint256 parentTotalSecurityBondAllowance = parent.totalSecurityBondAllowance();
		data.auctionedSecurityBondAllowance = parentTotalSecurityBondAllowance - data.migratedSecurityBondAllowance;
		securityPool.setPoolFinancials(collateralAmount, parentTotalSecurityBondAllowance);
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

	function _emitFinalizeAuctionEvent(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage parentData,
		SecurityPoolForkerForkData storage data,
		uint256 repPurchased
	) private {
		emit FinalizeAuction(
			securityPool,
			_getPoolAuctionableRepAtFork(parentData),
			data.migratedRep,
			repPurchased,
			securityPool.poolOwnershipDenominator(),
			securityPool.completeSetCollateralAmount()
		);
	}

	function finalizeTruthAuction(ISecurityPool securityPool) external {
		require(
			block.timestamp > _getForkData(securityPool).truthAuctionStarted + SecurityPoolUtils.AUCTION_TIME,
			'Auction open'
		);
		_finalizeTruthAuction(securityPool);
	}

	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external {
		EscalationGame escalationGame = securityPool.escalationGame();
		require(address(escalationGame) != address(0x0) && escalationGame.nonDecisionTimestamp() > 0, 'Need fork game');
		require(securityPool.systemState() != SystemState.PoolForked, 'Already forked');
		require(securityPool.systemState() == SystemState.Operational, 'Not operational');
		ReputationToken rep = securityPool.repToken();
		uint256 poolRepToFork = rep.balanceOf(address(securityPool));
		uint256 repBalanceBefore = rep.balanceOf(address(this));
		securityPool.activateForkMode();
		uint256 escalationRepToFork = escalationGame.drainAllRep(address(this));
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		data.ownFork = true;
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 repBalanceAfter = rep.balanceOf(address(this));
		uint256 repToFork = repBalanceAfter - repBalanceBefore;
		if (repToFork > 0) IERC20(address(rep)).safeTransfer(address(migrationProxy), repToFork);
		migrationProxy.forkUniverse(securityPool.questionId());
		uint256 leftoverProxyRep = rep.balanceOf(address(migrationProxy));
		if (leftoverProxyRep > 0) migrationProxy.lockRep(leftoverProxyRep);
		uint256 forkTime = zoltar.getForkTime(securityPool.universeId());
		require(forkTime > 0, 'No time');
		_snapshotEscalationAtFork(data, escalationGame, forkTime);
		uint256 auctionableRepAtFork = zoltar.getMigrationRepBalance(
			address(migrationProxy),
			securityPool.universeId()
		);
		uint256 totalRepBeforeBurn = poolRepToFork + escalationRepToFork;
		uint256 vaultRepAtFork =
			totalRepBeforeBurn == 0 ? 0 : (poolRepToFork * auctionableRepAtFork) / totalRepBeforeBurn;
		_initializeOwnForkRepBuckets(
			securityPool,
			vaultRepAtFork,
			auctionableRepAtFork - vaultRepAtFork,
			escalationRepToFork
		);
		data.auctionableRepAtFork = auctionableRepAtFork;
		data.ownForkCollateralAtFork = securityPool.completeSetCollateralAmount();
		data.ownForkMigratedRepCollateralized = 0;
		data.ownForkCollateralTransferred = 0;
		emit InitiateSecurityPoolFork(securityPool, data.auctionableRepAtFork, data.ownFork);
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
		require(claimTickIndices.length > 0 || refundTickIndices.length > 0, 'Need claim/refund');
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
		(uint256 amount, ) = data.truthAuction.withdrawBids(vault, tickIndices);
		if (amount == 0) return;
		uint256 auctionPoolOwnershipPerRep = data.auctionPoolOwnershipPerRep;
		require(auctionPoolOwnershipPerRep > 0, 'No rate');
		uint256 poolOwnershipAmount = amount * auctionPoolOwnershipPerRep;
		uint256 nextClaimedAuctionPoolOwnership = data.claimedAuctionPoolOwnership + poolOwnershipAmount;
		require(
			nextClaimedAuctionPoolOwnership <= data.truthAuction.totalRepPurchased() * auctionPoolOwnershipPerRep,
			'Claim exceeds REP'
		);
		(uint256 poolOwnership, uint256 currentSecurityBondAllowance, , uint256 currentFeeIndex) = securityPool
			.securityVaults(vault);
		uint256 newSecurityBondAllowance = _calculateAuctionedSecurityBondAllowance(data, amount);
		data.claimedAuctionRepPurchased += amount;
		data.claimedAuctionedSecurityBondAllowance += newSecurityBondAllowance;
		data.claimedAuctionPoolOwnership = nextClaimedAuctionPoolOwnership;
		uint256 nextFeeIndex = currentSecurityBondAllowance > 0 ? currentFeeIndex : securityPool.feeIndex();
		securityPool.configureVault(
			vault,
			poolOwnership + poolOwnershipAmount,
			currentSecurityBondAllowance + newSecurityBondAllowance,
			nextFeeIndex
		);
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

	function _calculateAuctionedSecurityBondAllowance(
		SecurityPoolForkerForkData storage data,
		uint256 amount
	) private view returns (uint256 newSecurityBondAllowance) {
		uint256 totalRepPurchased = data.truthAuction.totalRepPurchased();
		if (data.claimedAuctionRepPurchased + amount == totalRepPurchased) {
			newSecurityBondAllowance = data.auctionedSecurityBondAllowance - data.claimedAuctionedSecurityBondAllowance;
		} else {
			newSecurityBondAllowance = (data.auctionedSecurityBondAllowance * amount) / totalRepPurchased;
		}
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
		ISecurityPool parent = securityPool.parent();
		if (address(parent) != address(0x0)) {
			SecurityPoolForkerForkData storage parentData = _getForkData(parent);
			SecurityPoolForkerForkData storage childData = _getForkData(securityPool);
			if (parentData.ownFork) {
				require(childData.outcomeIndex <= uint256(BinaryOutcomes.BinaryOutcome.No), 'Bad outcome');
				return BinaryOutcomes.BinaryOutcome(childData.outcomeIndex);
			}
		}
		if (systemState == SystemState.Operational) {
			EscalationGame escalationGame = securityPool.escalationGame();
			uint256 forkTime = zoltar.getForkTime(securityPool.universeId());
			if (address(escalationGame) != address(0x0)) {
				uint256 escalationEndDate = escalationGame.getEscalationGameEndDate();
				if (block.timestamp > escalationEndDate && (forkTime == 0 || escalationEndDate < forkTime))
					return escalationGame.getQuestionResolution();
			}
		}
		return BinaryOutcomes.BinaryOutcome.None;
	}

	receive() external payable {
		require(trustedAuctionAddresses[msg.sender], 'Trusted only');
	}
}
