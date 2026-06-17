// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { IUniformPriceDualCapBatchAuction } from './interfaces/IUniformPriceDualCapBatchAuction.sol';
import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { EscalationGame, MERKLE_MOUNTAIN_RANGE_MAX_PEAKS } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';
import { SecurityPoolForkerVaultMigrationDelegate } from './SecurityPoolForkerVaultMigrationDelegate.sol';
import { EscalationGameForker } from './EscalationGameForker.sol';
import { SecurityPoolForkerVaultMigrationBase } from './SecurityPoolForkerVaultMigrationBase.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';

contract SecurityPoolForker is SecurityPoolForkerVaultMigrationBase {
	using SafeERC20Ops for IERC20;
	uint256 constant ESCALATION_TIME_LENGTH = 4233600; // 7 weeks
	address private immutable vaultMigrationDelegate;
	address private immutable escalationGameForkerDelegate;

	event InitiateSecurityPoolFork(uint256 auctionableRepAtFork);
	event TruthAuctionStarted(uint256 completeSetCollateralAmount, uint256 repMigrated, uint256 auctionableRepAtFork);
	event TruthAuctionFinalized();
	event ClaimAuctionProceeds(address vault, uint256 amount, uint256 poolOwnershipAmount, uint256 poolOwnershipDenominator);
	event FinalizeAuction(uint256 repAvailable, uint256 migratedRep, uint256 repPurchased, uint256 poolOwnershipDenominator, uint256 completeSetCollateralAmount);

	function forkData(ISecurityPool securityPool) public view returns (
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
		uint8 outcomeIndex
	) {
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

	function getOwnForkRepBuckets(ISecurityPool securityPool) public view returns (
		uint256 vaultRepAtFork,
		uint256 unallocatedEscrowChildRep,
		uint256 escrowSourceRepAtFork
	) {
		SecurityPoolForkerForkData storage repBuckets = forkDataByPool[securityPool];
		uint256 escrowChildRepUsed;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			escrowChildRepUsed += ownForkChildRepAllocationByPoolAndOutcome[securityPool][outcomeIndex].escrowChildRepUsed;
		}
		return (
			repBuckets.vaultRepAtFork,
			repBuckets.escalationChildRepAtFork > escrowChildRepUsed ? repBuckets.escalationChildRepAtFork - escrowChildRepUsed : 0,
			repBuckets.escalationSourceRepAtFork
		);
	}

	function getOwnForkMigrationStatus(ISecurityPool securityPool) public view returns (
		bool ownFork,
		uint256 auctionableRepAtFork,
		uint256 vaultRepAtFork,
		uint256 unallocatedEscrowChildRep,
		uint256 escrowSourceRepAtFork
	) {
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		uint256 escrowChildRepUsed;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			escrowChildRepUsed += ownForkChildRepAllocationByPoolAndOutcome[securityPool][outcomeIndex].escrowChildRepUsed;
		}
		return (
			data.ownFork,
			data.auctionableRepAtFork,
			data.vaultRepAtFork,
			data.escalationChildRepAtFork > escrowChildRepUsed ? data.escalationChildRepAtFork - escrowChildRepUsed : 0,
			data.escalationSourceRepAtFork
		);
	}

	constructor(Zoltar _zoltar) SecurityPoolForkerVaultMigrationBase(_zoltar) {
		vaultMigrationDelegate = address(new SecurityPoolForkerVaultMigrationDelegate(_zoltar));
		escalationGameForkerDelegate = address(new EscalationGameForker(_zoltar));
	}

	function _forkOccurredBeforeEscalationSettled(EscalationGame escalationGame) private view returns (bool) {
		if (address(escalationGame) == address(0x0)) return false;
		return escalationGame.getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None;
	}

	function _getEscalationElapsedAtFork(EscalationGame escalationGame, uint256 forkTime) private view returns (uint256 elapsedAtFork) {
		if (escalationGame.forkContinuation()) {
			elapsedAtFork = escalationGame.forkElapsedAtStart();
			if (escalationGame.forkContinuationResumed()) {
				uint256 resumedAt = escalationGame.forkResumedAt();
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

	function _snapshotEscalationAtFork(SecurityPoolForkerForkData storage data, EscalationGame escalationGame, uint256 forkTime) private {
		if (!_forkOccurredBeforeEscalationSettled(escalationGame)) return;
		data.unresolvedEscalationAtFork = true;
		data.escalationStartBondAtFork = escalationGame.startBond();
		data.escalationNonDecisionThresholdAtFork = escalationGame.nonDecisionThreshold();
		data.escalationElapsedAtFork = _getEscalationElapsedAtFork(escalationGame, forkTime);
	}

	function _getForkData(ISecurityPool securityPool) private view returns (SecurityPoolForkerForkData storage data) {
		data = forkDataByPool[securityPool];
	}

	function _prepareForkState(ISecurityPool securityPool, EscalationGame escalationGame) private returns (SecurityPoolForkerForkData storage data) {
		uint248 universe = securityPool.universeId();
		uint256 forkTime = zoltar.getForkTime(universe);
		require(forkTime > 0, 'e7');
		require(securityPool.systemState() != SystemState.PoolForked, 'e8');
		require(securityPool.systemState() == SystemState.Operational, 'e9');
		require(address(escalationGame) == address(0x0) || escalationGame.getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'ea');
		data = forkDataByPool[securityPool];
		_snapshotEscalationAtFork(data, escalationGame, forkTime);
	}

	function _getMigrationProxySalt(ISecurityPool securityPool) private pure returns (bytes32) {
		return keccak256(abi.encode(address(securityPool)));
	}

	function getMigrationProxyAddress(ISecurityPool securityPool) public view returns (address) {
		bytes32 salt = _getMigrationProxySalt(securityPool);
		bytes32 initCodeHash = keccak256(abi.encodePacked(
			type(SecurityPoolMigrationProxy).creationCode,
			abi.encode(zoltar, securityPool.repToken(), securityPool.universeId(), address(this))
		));
		return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
	}

	// Lazily deploy one proxy per parent pool so that all Zoltar migration calls for
	// that pool use a unique `msg.sender`. CREATE2 keeps the proxy address stable
	// and predictable from the pool address before deployment.
	function _getOrDeployMigrationProxy(ISecurityPool securityPool) private returns (SecurityPoolMigrationProxy migrationProxy) {
		migrationProxy = migrationProxyByPool[securityPool];
		if (address(migrationProxy) != address(0x0)) return migrationProxy;
		migrationProxy = new SecurityPoolMigrationProxy{ salt: _getMigrationProxySalt(securityPool) }(zoltar, securityPool.repToken(), securityPool.universeId(), address(this));
		migrationProxyByPool[securityPool] = migrationProxy;
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
		EscalationGame parentEscalationGame = parent.escalationGame();
		EscalationGame childEscalationGame = child.escalationGame();
		if (
			address(parentEscalationGame) != address(0x0) &&
			address(childEscalationGame) != address(0x0) &&
			!childEscalationGame.forkCarrySnapshotInitialized()
		) {
			(
				bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3] memory inheritedCarryPeaks,
				uint256[3] memory inheritedCarryLeafCounts,
				uint256[3] memory inheritedCarryTotals,
				bytes32[3] memory inheritedNullifierRoots
			) = parentEscalationGame.getForkCarrySnapshot();
			if (parentForkData.ownFork) {
				uint256[3] memory inheritedResolutionBalances;
				child.initializeForkCarrySnapshotWithResolutionBalances(
					inheritedCarryPeaks,
					inheritedCarryLeafCounts,
					inheritedCarryTotals,
					inheritedResolutionBalances,
					inheritedNullifierRoots
				);
			} else {
				child.initializeForkCarrySnapshot(
					inheritedCarryPeaks,
					inheritedCarryLeafCounts,
					inheritedCarryTotals,
					inheritedNullifierRoots
				);
			}
		}
		if (child.systemState() == SystemState.Operational) {
			child.resumeForkedEscalationGame();
		}
	}

	function initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) external {
		require(msg.sender == address(this), 'os');
		_initializeChildForkedEscalationGameIfNeeded(parent, child);
	}

	function initiateSecurityPoolFork(ISecurityPool securityPool) public {
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
		require(data.auctionableRepAtFork >= previousMigrationBalance, 'migration balance regressed');
		emit InitiateSecurityPoolFork(data.auctionableRepAtFork);
		// TODO: we could pay the caller basefee*2 out of Open interest. We have to reward caller
	}

	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] memory outcomeIndices) public {
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[securityPool];
		require(address(migrationProxy) != address(0x0), 'e3');
		require(securityPool.systemState() == SystemState.PoolForked, 'parent pool not forked');
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		uint256 migrationAmount = data.ownFork ? data.vaultRepAtFork : data.auctionableRepAtFork;
		if (migrationAmount > 0) {
			for (uint256 index = 0; index < outcomeIndices.length; index++) {
				uint256 outcomeIndex = outcomeIndices[index];
				require(outcomeIndex <= type(uint8).max, 'eb');
				uint8 normalizedOutcomeIndex = uint8(outcomeIndex);
				ISecurityPool child = childrenByPoolAndOutcome[securityPool][normalizedOutcomeIndex];
				if (address(child) != address(0x0)) {
					require(child.systemState() == SystemState.ForkMigration, 'child branch already priced');
				}
				require(block.timestamp <= zoltar.getForkTime(securityPool.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'migration window closed');
				_splitMigrationRepToChild(securityPool, normalizedOutcomeIndex, migrationAmount, data.ownFork, false);
				pendingChildRepByPoolAndOutcome[securityPool][normalizedOutcomeIndex] += migrationAmount;
				_sweepChildRepToPool(securityPool, normalizedOutcomeIndex);
			}
		}
	}

	function _delegateMigrationCall(address delegate) private returns (bytes memory returnData) {
		(bool success, bytes memory data) = delegate.delegatecall(msg.data);
		if (!success) {
			assembly {
				revert(add(data, 0x20), mload(data))
			}
		}
		return data;
	}

	function createChildUniverse(ISecurityPool, uint8) public {
		_delegateVaultMigration();
	}

	function claimForkedEscalationDeposits(ISecurityPool, address vault, BinaryOutcomes.BinaryOutcome, uint256[] memory) public {
		require(msg.sender == vault, 'ov');
		_delegateEscalationGameForker();
	}

	// migrates vault into outcome universe after fork
	function migrateVault(ISecurityPool, uint8) public {
		_delegateVaultMigration();
	}

	function migrateVaultWithUnresolvedEscalation(ISecurityPool, address vault, uint8) public returns (bool moreToMigrate) {
		require(msg.sender == vault, 'ov');
		bytes memory returnData = _delegateEscalationGameForker();
		return abi.decode(returnData, (bool));
	}

	function _delegateVaultMigration() private returns (bytes memory returnData) {
		return _delegateMigrationCall(vaultMigrationDelegate);
	}

	function _delegateEscalationGameForker() private returns (bytes memory returnData) {
		return _delegateMigrationCall(escalationGameForkerDelegate);
	}

	function startTruthAuction(ISecurityPool securityPool) public {
		SecurityPoolForkerForkData storage data;
		SecurityPoolForkerForkData storage parentData;
		ISecurityPool parent;
		uint256 parentCollateral;
		(data, parentData, parent, parentCollateral) = _loadTruthAuctionState(securityPool);
		uint256 poolAuctionableRepAtFork = _getPoolAuctionableRepAtFork(parentData);
		emit TruthAuctionStarted(parentCollateral, data.migratedRep, poolAuctionableRepAtFork);
		_startTruthAuctionOrFinalize(securityPool, data, parentData, parentCollateral);
	}

	function _loadTruthAuctionState(ISecurityPool securityPool) private returns (
		SecurityPoolForkerForkData storage data,
		SecurityPoolForkerForkData storage parentData,
		ISecurityPool parent,
		uint256 parentCollateral
	) {
		require(securityPool.systemState() == SystemState.ForkMigration, 'f2');
		require(block.timestamp > zoltar.getForkTime(securityPool.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'f3');
		data = _getForkData(securityPool);
		securityPool.setSystemState(SystemState.ForkTruthAuction);
		data.truthAuctionStarted = block.timestamp;
		parent = securityPool.parent();
		parent.updateCollateralAmount();
		securityPool.setTotalShares(parent.shareTokenSupply());
		parentData = _getForkData(parent);
		parentCollateral = parentData.ownFork ? parentData.ownForkCollateralAtFork : parent.completeSetCollateralAmount();
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
		ethToBuy = parentCollateral - parentCollateral * data.migratedRep / poolAuctionableRepAtFork;
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

	function _getPoolAuctionableRepAtFork(SecurityPoolForkerForkData storage parentData) private view returns (uint256) {
		return parentData.ownFork ? parentData.vaultRepAtFork : parentData.auctionableRepAtFork;
	}

	function _finalizeTruthAuction(ISecurityPool securityPool) private {
		require(securityPool.systemState() == SystemState.ForkTruthAuction, 'f4');
		SecurityPoolForkerForkData storage data = _getForkData(securityPool);
		SecurityPoolForkerForkData storage parentData = _getForkData(securityPool.parent());
		ISecurityPool parent = securityPool.parent();
		uint256 repPurchased = _consumeTruthAuctionRep(securityPool, data);
		_captureUnclaimedCollateralForAuction(securityPool, parent, data);
		_finalizeOwnershipAfterAuction(securityPool, parentData, repPurchased);
		_finalizeEscalationStateAfterAuction(securityPool, parentData);
		_emitFinalizeAuctionEvent(securityPool, parentData, data, repPurchased);
		securityPool.updateRetentionRate();
	}

	function _consumeTruthAuctionRep(ISecurityPool securityPool, SecurityPoolForkerForkData storage data) private returns (uint256 repPurchased) {
		data.truthAuction.finalize();
		repPurchased = data.truthAuction.totalRepPurchased();
		securityPool.setSystemState(SystemState.Operational);
	}

	function _captureUnclaimedCollateralForAuction(ISecurityPool securityPool, ISecurityPool parent, SecurityPoolForkerForkData storage data) private {
		uint256 balance = address(securityPool).balance;
		uint256 feesOwed = securityPool.totalFeesOwedToVaults();
		uint256 collateralAmount = balance >= feesOwed ? balance - feesOwed : 0;
		uint256 parentTotalSecurityBondAllowance = parent.totalSecurityBondAllowance();
		data.auctionedSecurityBondAllowance = parentTotalSecurityBondAllowance - data.migratedSecurityBondAllowance;
		securityPool.setPoolFinancials(collateralAmount, parentTotalSecurityBondAllowance);
	}

	function _finalizeOwnershipAfterAuction(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage parentData,
		uint256 repPurchased
	) private {
		uint256 repAvailable = _getPoolAuctionableRepAtFork(parentData);
		if (repAvailable > 0) {
			uint256 unsoldRep = repAvailable - repPurchased;
			if (unsoldRep > 0) {
				// Preserve the current vault-ownership distribution while scaling it down to the
				// unsold REP that remains redeemable by migrated parent vaults. Auction buyers
				// will mint into the reserved gap via `claimAuctionProceeds`.
				uint256 currentOwnershipDenominator = securityPool.poolOwnershipDenominator();
				securityPool.setOwnershipDenominator(currentOwnershipDenominator * repAvailable / unsoldRep);
			} else {
				// All rep purchased; avoid division by zero by using repAvailable directly
				securityPool.setOwnershipDenominator(repAvailable * SecurityPoolUtils.PRICE_PRECISION);
			}
		}
		if (securityPool.poolOwnershipDenominator() == 0) {
			// wipe all rep holders in vaults
			securityPool.setOwnershipDenominator(repAvailable * SecurityPoolUtils.PRICE_PRECISION);
		}
	}

	function _finalizeEscalationStateAfterAuction(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage parentData
	) private {
		if (!parentData.unresolvedEscalationAtFork) return;
		securityPool.setAwaitingForkContinuation(false);
		EscalationGame childEscalationGame = securityPool.escalationGame();
		if (
			address(childEscalationGame) != address(0x0) &&
			childEscalationGame.forkContinuation() &&
			!childEscalationGame.forkContinuationResumed()
		) {
			securityPool.resumeForkedEscalationGame();
		}
	}

	function _emitFinalizeAuctionEvent(
		ISecurityPool securityPool,
		SecurityPoolForkerForkData storage parentData,
		SecurityPoolForkerForkData storage data,
		uint256 repPurchased
	) private {
		emit FinalizeAuction(
			_getPoolAuctionableRepAtFork(parentData),
			data.migratedRep,
			repPurchased,
			securityPool.poolOwnershipDenominator(),
			securityPool.completeSetCollateralAmount()
		);
	}

	function finalizeTruthAuction(ISecurityPool securityPool) public {
		require(block.timestamp > _getForkData(securityPool).truthAuctionStarted + SecurityPoolUtils.AUCTION_TIME, 'f5');
		_finalizeTruthAuction(securityPool);
	}

	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) public {
		EscalationGame escalationGame = securityPool.escalationGame();
		require(address(escalationGame) != address(0x0) && escalationGame.nonDecisionTimestamp() > 0, 'f6');
		require(securityPool.systemState() != SystemState.PoolForked, 'e8');
		require(securityPool.systemState() == SystemState.Operational, 'e9');
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
		uint256 forkTime = zoltar.getForkTime(securityPool.universeId());
		require(forkTime > 0, 'e7');
		_snapshotEscalationAtFork(data, escalationGame, forkTime);
		uint256 auctionableRepAtFork = zoltar.getMigrationRepBalance(address(migrationProxy), securityPool.universeId());
		uint256 totalRepBeforeBurn = poolRepToFork + escalationRepToFork;
		uint256 vaultRepAtFork = totalRepBeforeBurn == 0 ? 0 : poolRepToFork * auctionableRepAtFork / totalRepBeforeBurn;
		_initializeOwnForkRepBuckets(securityPool, vaultRepAtFork, auctionableRepAtFork - vaultRepAtFork, escalationRepToFork);
		data.auctionableRepAtFork = auctionableRepAtFork;
		data.ownForkCollateralAtFork = securityPool.completeSetCollateralAmount();
		data.ownForkMigratedRepCollateralized = 0;
		data.ownForkCollateralTransferred = 0;
		emit InitiateSecurityPoolFork(data.auctionableRepAtFork);
	}

	// Settles finalized truth-auction bids through the forker-owned auction.
	// Winning and partial bids credit purchased REP into the vault and assign the
	// corresponding share of auctioned allowance. Finalized losing bids may still
	// settle here as ETH-only refunds, in which case no vault accounting changes.
	// Anyone can call this so that settlement is not blocked on the bidder.
	function claimAuctionProceeds(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] memory tickIndices) public {
		_claimAuctionProceeds(securityPool, vault, tickIndices);
	}

	// settleAuctionBids lets callers submit both claim and refund batches in a single
	// transaction. Before finalization, only refundable bids can be settled.
	// After finalization, both sets are withdrawn as settlement payouts from the auction.
	function settleAuctionBids(
		ISecurityPool securityPool,
		address vault,
		IUniformPriceDualCapBatchAuction.TickIndex[] memory claimTickIndices,
		IUniformPriceDualCapBatchAuction.TickIndex[] memory refundTickIndices
	) public {
		require(claimTickIndices.length > 0 || refundTickIndices.length > 0, 'f7');
		if (forkDataByPool[securityPool].truthAuction.finalized()) {
			IUniformPriceDualCapBatchAuction.TickIndex[] memory allTickIndices = new IUniformPriceDualCapBatchAuction.TickIndex[](claimTickIndices.length + refundTickIndices.length);
			for (uint256 i = 0; i < claimTickIndices.length; i += 1) {
				allTickIndices[i] = claimTickIndices[i];
			}
			for (uint256 i = 0; i < refundTickIndices.length; i += 1) {
				allTickIndices[claimTickIndices.length + i] = refundTickIndices[i];
			}
			_claimAuctionProceeds(securityPool, vault, allTickIndices);
			return;
		}
		require(claimTickIndices.length == 0, 'f8');
		claimableRefundsForSettlement(securityPool, refundTickIndices);
	}

	function _claimAuctionProceeds(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] memory tickIndices) private {
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		require(data.truthAuction.finalized(), 'f9');
		(uint256 amount, ) = data.truthAuction.withdrawBids(vault, tickIndices);
		if (amount == 0) return;
		uint256 poolOwnershipAmount = repToPoolOwnership(securityPool, amount);
		(uint256 poolOwnership, uint256 currentSecurityBondAllowance, , uint256 currentFeeIndex) = securityPool.securityVaults(vault);
		uint256 newSecurityBondAllowance = _calculateAuctionedSecurityBondAllowance(data, amount);
		data.claimedAuctionRepPurchased += amount;
		data.claimedAuctionedSecurityBondAllowance += newSecurityBondAllowance;
		uint256 nextFeeIndex = currentSecurityBondAllowance > 0 ? currentFeeIndex : securityPool.feeIndex();
		securityPool.configureVault(vault, poolOwnership + poolOwnershipAmount, currentSecurityBondAllowance + newSecurityBondAllowance, nextFeeIndex);
		emit ClaimAuctionProceeds(vault, amount, poolOwnershipAmount, securityPool.poolOwnershipDenominator());
	}

	function _calculateAuctionedSecurityBondAllowance(
		SecurityPoolForkerForkData storage data,
		uint256 amount
	) private view returns (uint256 newSecurityBondAllowance) {
		uint256 totalRepPurchased = data.truthAuction.totalRepPurchased();
		if (data.claimedAuctionRepPurchased + amount == totalRepPurchased) {
			newSecurityBondAllowance = data.auctionedSecurityBondAllowance - data.claimedAuctionedSecurityBondAllowance;
		} else {
			newSecurityBondAllowance = data.auctionedSecurityBondAllowance * amount / totalRepPurchased;
		}
	}

	function claimableRefundsForSettlement(ISecurityPool securityPool, IUniformPriceDualCapBatchAuction.TickIndex[] memory tickIndices) private {
		forkDataByPool[securityPool].truthAuction.refundLosingBids(tickIndices);
	}

	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome) {
		SystemState systemState = securityPool.systemState();
		if (systemState == SystemState.PoolForked) return BinaryOutcomes.BinaryOutcome.None;
		ISecurityPool parent = securityPool.parent();
		if (address(parent) != address(0x0)) {
			SecurityPoolForkerForkData storage parentData = _getForkData(parent);
			SecurityPoolForkerForkData storage childData = _getForkData(securityPool);
			if (parentData.ownFork) return BinaryOutcomes.BinaryOutcome(childData.outcomeIndex);
		}
		if (systemState == SystemState.Operational) {
			EscalationGame escalationGame = securityPool.escalationGame();
			uint256 forkTime = zoltar.getForkTime(securityPool.universeId());
			if (address(escalationGame) != address(0x0)) {
				uint256 escalationEndDate = escalationGame.getEscalationGameEndDate();
				if (block.timestamp > escalationEndDate && (forkTime == 0 || escalationEndDate < forkTime)) return escalationGame.getQuestionResolution();
			}
		}
		return BinaryOutcomes.BinaryOutcome.None;
	}

	receive() external payable {
		require(trustedAuctionAddresses[msg.sender], 'fa');
	}
}
