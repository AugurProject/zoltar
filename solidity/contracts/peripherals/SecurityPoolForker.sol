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
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';
import { SecurityPoolForkerVaultMigrationDelegate } from './SecurityPoolForkerVaultMigrationDelegate.sol';
import { SecurityPoolForkerVaultMigrationBase } from './SecurityPoolForkerVaultMigrationBase.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerStorage.sol';

contract SecurityPoolForker is ISecurityPoolForker, SecurityPoolForkerVaultMigrationBase {
	using SafeERC20Ops for IERC20;
	uint256 constant ESCALATION_TIME_LENGTH = 4233600; // 7 weeks
	address private immutable vaultMigrationDelegate;

	event InitiateSecurityPoolFork(uint256 repAtFork);
	event TruthAuctionStarted(uint256 completeSetCollateralAmount, uint256 repMigrated, uint256 repAtFork);
	event TruthAuctionFinalized();
	event ClaimAuctionProceeds(address vault, uint256 amount, uint256 poolOwnershipAmount, uint256 poolOwnershipDenominator);
	event FinalizeAuction(uint256 repAvailable, uint256 migratedRep, uint256 repPurchased, uint256 poolOwnershipDenominator, uint256 completeSetCollateralAmount);

	function forkData(ISecurityPool securityPool) public view returns (
		uint256 repAtFork,
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
			data.repAtFork,
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

	constructor(Zoltar _zoltar) SecurityPoolForkerVaultMigrationBase(_zoltar) {
		vaultMigrationDelegate = address(new SecurityPoolForkerVaultMigrationDelegate(_zoltar));
	}

	function _forkOccurredBeforeEscalationSettled(EscalationGame escalationGame) private view returns (bool) {
		if (address(escalationGame) == address(0x0)) return false;
		if (escalationGame.nonDecisionTimestamp() > 0) return false;
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
		EscalationGame childEscalationGame = EscalationGame(payable(address(child.escalationGame())));
		if (!childEscalationGame.forkCarrySnapshotInitialized()) {
			EscalationGame parentEscalationGame = EscalationGame(payable(address(parent.escalationGame())));
			(bytes32[64][3] memory inheritedCarryPeaks, uint256[3] memory inheritedCarryLeafCounts, uint256[3] memory inheritedCarryTotals, bytes32[3] memory inheritedNullifierRoots) =
				parentEscalationGame.getForkCarrySnapshot();
			child.initializeForkCarrySnapshot(inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedNullifierRoots);
		}
		if (child.systemState() == SystemState.Operational) {
			child.resumeForkedEscalationGame();
		}
	}

	function initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) external {
		require(msg.sender == address(this), 'only self');
		_initializeChildForkedEscalationGameIfNeeded(parent, child);
	}

	function initiateSecurityPoolFork(ISecurityPool securityPool) public {
		uint248 universe = securityPool.universeId();
		uint256 forkTime = zoltar.getForkTime(universe);
		EscalationGame escalationGame = securityPool.escalationGame();
		require(forkTime > 0, 'e7');
		require(securityPool.systemState() != SystemState.PoolForked, 'e8');
		require(securityPool.systemState() == SystemState.Operational, 'e9');
		require(address(escalationGame) == address(0x0) || escalationGame.getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'ea');
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		_snapshotEscalationAtFork(data, escalationGame, forkTime);
		ReputationToken rep = securityPool.repToken();
		uint256 repBalanceBefore = rep.balanceOf(address(this));
		securityPool.activateForkMode();
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 previousMigrationBalance = zoltar.getMigrationRepBalance(address(migrationProxy), universe);
		uint256 repBalanceAfter = rep.balanceOf(address(this));
		uint256 repToLock = repBalanceAfter - repBalanceBefore;
		if (repToLock > 0) IERC20(address(rep)).safeTransfer(address(migrationProxy), repToLock);
		uint256 proxyRepBalance = rep.balanceOf(address(migrationProxy));
		if (proxyRepBalance > 0) migrationProxy.lockRep(proxyRepBalance);
		data.repAtFork = previousMigrationBalance + proxyRepBalance;
		emit InitiateSecurityPoolFork(data.repAtFork);
		// TODO: we could pay the caller basefee*2 out of Open interest. We have to reward caller
	}

	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] memory outcomeIndices) public {
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[securityPool];
		require(address(migrationProxy) != address(0x0), 'e3');
		migrationProxy.splitToChild(forkDataByPool[securityPool].repAtFork, outcomeIndices);
		for (uint256 index = 0; index < outcomeIndices.length; index++) {
			uint256 outcomeIndex = outcomeIndices[index];
			require(outcomeIndex <= type(uint8).max, 'eb');
			uint8 normalizedOutcomeIndex = uint8(outcomeIndex);
			pendingChildRepByPoolAndOutcome[securityPool][normalizedOutcomeIndex] += forkDataByPool[securityPool].repAtFork;
			_sweepChildRepToPool(securityPool, normalizedOutcomeIndex);
		}
	}

	function _delegateVaultMigrationCall() private {
		(bool success, bytes memory returnData) = vaultMigrationDelegate.delegatecall(msg.data);
		if (!success) {
			assembly {
				revert(add(returnData, 0x20), mload(returnData))
			}
		}
	}

	function createChildUniverse(ISecurityPool, uint8) public {
		_delegateVaultMigrationCall();
	}

	function migrateFromEscalationGame(ISecurityPool, address, BinaryOutcomes.BinaryOutcome, uint256[] memory) public {
		_delegateVaultMigrationCall();
	}

	// migrates vault into outcome universe after fork
	function migrateVault(ISecurityPool, uint8) public {
		_delegateVaultMigrationCall();
	}

	function migrateVaultWithUnresolvedEscalation(ISecurityPool, uint8) public {
		_delegateVaultMigrationCall();
	}

	function startTruthAuction(ISecurityPool securityPool) public {
		require(securityPool.systemState() == SystemState.ForkMigration, 'f2');
		require(block.timestamp > zoltar.getForkTime(securityPool.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'f3');
		securityPool.setSystemState(SystemState.ForkTruthAuction);
		forkDataByPool[securityPool].truthAuctionStarted = block.timestamp;
		ISecurityPool parent = securityPool.parent();
		parent.updateCollateralAmount();
		uint256 parentCollateral = parent.completeSetCollateralAmount();
		securityPool.setTotalShares(parent.shareTokenSupply());
		emit TruthAuctionStarted(parentCollateral, forkDataByPool[securityPool].migratedRep, forkDataByPool[parent].repAtFork);
		if (forkDataByPool[securityPool].migratedRep >= forkDataByPool[parent].repAtFork) {
			// we have acquired all the ETH already, no need for truthAuction
			_finalizeTruthAuction(securityPool);
		} else {
			// we need to buy all the collateral that is missing (did not migrate)
			uint256 ethToBuy = parentCollateral - parentCollateral * forkDataByPool[securityPool].migratedRep / forkDataByPool[parent].repAtFork;
			if (ethToBuy == 0) {
				_finalizeTruthAuction(securityPool);
				return;
			}
			// Sell effectively all REP for ETH while leaving only a tiny migrated-rep residue unsold.
			// This intentionally parses as `repAtFork - (migratedRep / divisor)`: the parent
			// pool keeps its full REP-at-fork anchor, and only the tiny unsold residue is scaled
			// down by the haircut divisor. We cannot sell literally all REP because
			// `poolOwnershipDenominator` still needs a finite anchor.
			forkDataByPool[securityPool].truthAuction.startAuction(ethToBuy, forkDataByPool[parent].repAtFork - forkDataByPool[securityPool].migratedRep / SecurityPoolUtils.MAX_AUCTION_VAULT_HAIRCUT_DIVISOR);
		}
	}

	function _finalizeTruthAuction(ISecurityPool securityPool) private {
		require(securityPool.systemState() == SystemState.ForkTruthAuction, 'f4');
		// finalize sends ETH to securityPool
		forkDataByPool[securityPool].truthAuction.finalize();
		uint256 repPurchased = forkDataByPool[securityPool].truthAuction.totalRepPurchased();
		securityPool.setSystemState(SystemState.Operational);
		ISecurityPool parent = securityPool.parent();
		uint256 repAvailable = forkDataByPool[parent].repAtFork;
		uint256 balance = address(securityPool).balance;
		uint256 feesOwed = securityPool.totalFeesOwedToVaults();
		uint256 collateralAmount = balance >= feesOwed ? balance - feesOwed : 0;
		uint256 parentTotalSecurityBondAllowance = parent.totalSecurityBondAllowance();
		forkDataByPool[securityPool].auctionedSecurityBondAllowance = parentTotalSecurityBondAllowance - securityPool.totalSecurityBondAllowance();
		securityPool.setPoolFinancials(collateralAmount, parentTotalSecurityBondAllowance);
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
		if (securityPool.poolOwnershipDenominator() == 0) { // wipe all rep holders in vaults
			securityPool.setOwnershipDenominator(repAvailable * SecurityPoolUtils.PRICE_PRECISION);
		}
		if (forkDataByPool[parent].unresolvedEscalationAtFork) {
			securityPool.setAwaitingForkContinuation(false);
		}
		if (
			forkDataByPool[parent].unresolvedEscalationAtFork &&
			address(securityPool.escalationGame()) != address(0x0) &&
			securityPool.escalationGame().forkContinuation()
		) {
			if (!securityPool.escalationGame().forkContinuationResumed()) {
				securityPool.resumeForkedEscalationGame();
			}
		}
		emit FinalizeAuction(repAvailable, forkDataByPool[securityPool].migratedRep, repPurchased, securityPool.poolOwnershipDenominator(), securityPool.completeSetCollateralAmount());
		securityPool.updateRetentionRate();
	}

	function finalizeTruthAuction(ISecurityPool securityPool) public {
		require(block.timestamp > forkDataByPool[securityPool].truthAuctionStarted + SecurityPoolUtils.AUCTION_TIME, 'f5');
		_finalizeTruthAuction(securityPool);
	}

	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) public {
		EscalationGame escalationGame = securityPool.escalationGame();
		require(address(escalationGame) != address(0x0) && escalationGame.nonDecisionTimestamp() > 0, 'f6');
		ReputationToken rep = securityPool.repToken();
		uint256 repBalanceBefore = rep.balanceOf(address(this));
		securityPool.drainAllRep();
		forkDataByPool[securityPool].ownFork = true;
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 repBalanceAfter = rep.balanceOf(address(this));
		uint256 repToFork = repBalanceAfter - repBalanceBefore;
		if (repToFork > 0) IERC20(address(rep)).safeTransfer(address(migrationProxy), repToFork);
		migrationProxy.forkUniverse(securityPool.questionId());
		initiateSecurityPoolFork(securityPool);
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
		require(forkDataByPool[securityPool].truthAuction.finalized(), 'f9');
		(uint256 amount, ) = forkDataByPool[securityPool].truthAuction.withdrawBids(vault, tickIndices);
		if (amount == 0) return;
		uint256 poolOwnershipAmount = repToPoolOwnership(securityPool, amount);
		(uint256 poolOwnership, uint256 currentSecurityBondAllowance, , uint256 currentFeeIndex, ) = securityPool.securityVaults(vault);
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		uint256 totalRepPurchased = data.truthAuction.totalRepPurchased();
		uint256 newSecurityBondAllowance;
		if (data.claimedAuctionRepPurchased + amount == totalRepPurchased) {
			newSecurityBondAllowance = data.auctionedSecurityBondAllowance - data.claimedAuctionedSecurityBondAllowance;
		} else {
			newSecurityBondAllowance = data.auctionedSecurityBondAllowance * amount / totalRepPurchased;
		}
		data.claimedAuctionRepPurchased += amount;
		data.claimedAuctionedSecurityBondAllowance += newSecurityBondAllowance;
		uint256 nextFeeIndex = currentSecurityBondAllowance > 0 ? currentFeeIndex : securityPool.feeIndex();
		securityPool.configureVault(vault, poolOwnership + poolOwnershipAmount, currentSecurityBondAllowance + newSecurityBondAllowance, nextFeeIndex);
		emit ClaimAuctionProceeds(vault, amount, poolOwnershipAmount, securityPool.poolOwnershipDenominator());
	}

	function claimableRefundsForSettlement(ISecurityPool securityPool, IUniformPriceDualCapBatchAuction.TickIndex[] memory tickIndices) private {
		forkDataByPool[securityPool].truthAuction.refundLosingBids(tickIndices);
	}

	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome) {
		SystemState systemState = securityPool.systemState();
		if (systemState == SystemState.PoolForked) return BinaryOutcomes.BinaryOutcome.None;
		ISecurityPool parent = securityPool.parent();
		if (address(parent) != address(0x0)) {
			if (forkDataByPool[parent].ownFork) return BinaryOutcomes.BinaryOutcome(forkDataByPool[securityPool].outcomeIndex);
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
