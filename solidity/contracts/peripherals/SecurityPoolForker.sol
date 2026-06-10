// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { IUniformPriceDualCapBatchAuction } from './interfaces/IUniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { ForkData, SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkerInheritedEscalationLogic } from './SecurityPoolForkerInheritedEscalationLogic.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';

contract SecurityPoolForker is SecurityPoolForkerBase, ISecurityPoolForker {
	address private immutable inheritedEscalationLogic;

	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {
		inheritedEscalationLogic = address(new SecurityPoolForkerInheritedEscalationLogic(_zoltar));
	}

	function initiateSecurityPoolFork(ISecurityPool securityPool) public override(SecurityPoolForkerBase, ISecurityPoolForker) {
		super.initiateSecurityPoolFork(securityPool);
	}

	function _delegateInheritedEscalationCall() private returns (bytes memory returnData) {
		address target = inheritedEscalationLogic;
		assembly ('memory-safe') {
			let input := mload(0x40)
			calldatacopy(input, 0, calldatasize())
			let succeeded := delegatecall(gas(), target, input, calldatasize(), 0, 0)
			let size := returndatasize()
			returnData := mload(0x40)
			mstore(returnData, size)
			returndatacopy(add(returnData, 0x20), 0, size)
			mstore(0x40, add(add(returnData, 0x20), and(add(size, 0x1f), not(0x1f))))
			if iszero(succeeded) {
				revert(add(returnData, 0x20), size)
			}
		}
	}

	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] memory outcomeIndices) public {
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[securityPool];
		require(address(migrationProxy) != address(0x0), 'proxy missing');
		migrationProxy.splitToChild(forkDataByPool[securityPool].repAtFork, outcomeIndices);
		for (uint256 index = 0; index < outcomeIndices.length; index++) {
			uint256 outcomeIndex = outcomeIndices[index];
			pendingChildRepByPoolAndOutcome[securityPool][outcomeIndex] += forkDataByPool[securityPool].repAtFork;
			_sweepChildRepToPool(securityPool, outcomeIndex);
		}
	}

	function createChildUniverse(ISecurityPool parent, uint256 outcomeIndex) public {
		require(address(childrenByPoolAndOutcome[parent][outcomeIndex]) == address(0x0), 'child already created');
		_getOrDeployChildPool(parent, outcomeIndex);
	}

	function migrateFromEscalationGame(ISecurityPool parent, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256[] memory depositIndexes) public {
		EscalationGame escalationGame = parent.escalationGame();
		ISecurityPool child = _getOrDeployChildPool(parent, uint256(uint8(outcomeIndex)));
		require(address(escalationGame) != address(0x0), 'escalation game needs to be deployed');
		require(_forkQuestionMatchesPool(parent), 'use inherited');
		uint256 parentRepAtFork = forkDataByPool[parent].repAtFork;
		uint256 repMigratedFromEscalationGame = 0;
		uint256 migratedPrincipal = 0;
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			(address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) = escalationGame.claimDepositForWinning(depositIndexes[index], outcomeIndex);
			require(depositor == vault, 'deposit was not for this vault');
			repMigratedFromEscalationGame += amountToWithdraw;
			migratedPrincipal += originalDepositAmount;
			parent.clearEscalationLockForForkMigration(vault, originalDepositAmount);
		}
		uint256 ownershipDelta = _applyRepClaimToVault(child, vault, repMigratedFromEscalationGame);
		forkDataByPool[child].migratedRep += migratedPrincipal;
		emit MigrateFromEscalationGame(parent, vault, outcomeIndex, depositIndexes, repMigratedFromEscalationGame, ownershipDelta);
		_transferMigratedCollateral(parent, child, migratedPrincipal, parentRepAtFork);
	}

	function migrateInheritedEscalationToBranch(
		ISecurityPool,
		address,
		uint256,
		BinaryOutcomes.BinaryOutcome,
		uint256[] memory
	) external {
		_delegateInheritedEscalationCall();
	}

	function settleInheritedEscalation(
		ISecurityPool,
		address,
		BinaryOutcomes.BinaryOutcome,
		uint256[] memory
	) external {
		_delegateInheritedEscalationCall();
	}

	function forkZoltarWithInheritedEscalationGame(ISecurityPool) external {
		_delegateInheritedEscalationCall();
	}

	function migrateInheritedEscalationToGrandchild(
		ISecurityPool,
		address,
		BinaryOutcomes.BinaryOutcome,
		uint256[] memory
	) external {
		_delegateInheritedEscalationCall();
	}

	// migrates vault into outcome universe after fork
	function migrateVault(ISecurityPool parent, uint256 outcomeIndex) public {
		parent.updateVaultFees(msg.sender);
		ISecurityPool child = _getOrDeployChildPool(parent, outcomeIndex);
		uint256 parentRepAtFork = forkDataByPool[parent].repAtFork;

		child.updateVaultFees(msg.sender);
		parent.updateCollateralAmount();
		(uint256 parentPoolOwnership, uint256 parentSecurityBondAllowance, , , uint256 parentLockedRepInEscalationGame) = parent.securityVaults(msg.sender);
		(uint256 childCurrentPoolOwnership, uint256 childCurrentSecurityBondAllowance, , uint256 childCurrentFeeIndex, ) = child.securityVaults(msg.sender);
		emit MigrateRepFromParent(msg.sender, parentSecurityBondAllowance, parentPoolOwnership);
		uint256 childCurrentCollateral = child.completeSetCollateralAmount();
		uint256 childCurrentBond = child.totalSecurityBondAllowance();
		child.setPoolFinancials(childCurrentCollateral, childCurrentBond + parentSecurityBondAllowance);

		uint256 vaultPoolOwnership = childCurrentPoolOwnership;
		uint256 vaultFeeIndex = childCurrentSecurityBondAllowance > 0 ? childCurrentFeeIndex : 0;
		if (parent.poolOwnershipDenominator() != 0 && child.repToken().balanceOf(address(child)) != 0) {
			uint256 migratedPoolOwnership = parentPoolOwnership - repToPoolOwnership(child, parentLockedRepInEscalationGame);
			vaultPoolOwnership += migratedPoolOwnership;
			if (parentSecurityBondAllowance > 0) vaultFeeIndex = child.feeIndex();
			uint256 migratedRep = poolOwnershipToRep(child, migratedPoolOwnership);
			forkDataByPool[child].migratedRep += migratedRep;
			_transferMigratedCollateral(parent, child, migratedPoolOwnership > 0 ? migratedRep : 0, parentRepAtFork);
		}

		child.configureVault(msg.sender, vaultPoolOwnership, childCurrentSecurityBondAllowance + parentSecurityBondAllowance, vaultFeeIndex);

		(uint256 poolOwnership, uint256 securityBondAllowance, , uint256 parentVaultFeeIndex, ) = parent.securityVaults(msg.sender);
		emit MigrateVault(msg.sender, outcomeIndex, poolOwnership, securityBondAllowance, parentLockedRepInEscalationGame);
		parent.configureVault(msg.sender, 0, 0, parentVaultFeeIndex);
	}

	function startTruthAuction(ISecurityPool securityPool) public {
		require(securityPool.systemState() == SystemState.ForkMigration, 'System needs to be in migration');
		require(block.timestamp > zoltar.getForkTime(securityPool.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'migration time needs to pass first');
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
		require(securityPool.systemState() == SystemState.ForkTruthAuction, 'Auction needs to have started');
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
		emit FinalizeAuction(repAvailable, forkDataByPool[securityPool].migratedRep, repPurchased, securityPool.poolOwnershipDenominator(), securityPool.completeSetCollateralAmount());
		securityPool.updateRetentionRate();
	}

	function finalizeTruthAuction(ISecurityPool securityPool) public {
		require(block.timestamp > forkDataByPool[securityPool].truthAuctionStarted + SecurityPoolUtils.AUCTION_TIME, 'truthAuction still ongoing');
		_finalizeTruthAuction(securityPool);
	}

	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) public {
		EscalationGame escalationGame = securityPool.escalationGame();
		require(address(escalationGame) != address(0x0) && escalationGame.nonDecisionTimestamp() > 0, 'escalation game has not triggered fork');
		_forkSecurityPoolOnQuestion(securityPool);
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
		require(claimTickIndices.length > 0 || refundTickIndices.length > 0, 'Pick one or more bids to settle first.');
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
		require(claimTickIndices.length == 0, 'Winning bids can only be claimed after the auction is finalized.');
		claimableRefundsForSettlement(securityPool, refundTickIndices);
	}

	function _claimAuctionProceeds(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] memory tickIndices) private {
		require(forkDataByPool[securityPool].truthAuction.finalized(), 'Auction needs to be finalized');
		(uint256 amount, ) = forkDataByPool[securityPool].truthAuction.withdrawBids(vault, tickIndices);
		if (amount == 0) return;
		uint256 poolOwnershipAmount = repToPoolOwnership(securityPool, amount);
		(uint256 poolOwnership, uint256 currentSecurityBondAllowance, , uint256 currentFeeIndex, ) = securityPool.securityVaults(vault);
		ForkData storage data = forkDataByPool[securityPool];
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

	function hasInheritedEscalation(ISecurityPool securityPool) external view returns (bool) {
		return address(inheritedEscalationRootPoolByChild[securityPool]) != address(0x0);
	}

	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome) {
		SystemState systemState = securityPool.systemState();
		if (systemState == SystemState.PoolForked) return BinaryOutcomes.BinaryOutcome.None;
		ISecurityPool parent = securityPool.parent();
		if (address(parent) != address(0x0)) {
			if (_forkQuestionMatchesPool(parent)) {
				uint256 childOutcomeIndex = forkDataByPool[securityPool].outcomeIndex;
				if (childOutcomeIndex == 0) return BinaryOutcomes.BinaryOutcome.Invalid;
				if (childOutcomeIndex == 1) return BinaryOutcomes.BinaryOutcome.Yes;
				if (childOutcomeIndex == 2) return BinaryOutcomes.BinaryOutcome.No;
				return BinaryOutcomes.BinaryOutcome.None;
			}
			ISecurityPool inheritedRootPool = inheritedEscalationRootPoolByChild[securityPool];
			if (address(inheritedRootPool) != address(0x0)) {
				EscalationGame inheritedEscalationGame = inheritedRootPool.escalationGame();
				if (address(inheritedEscalationGame) != address(0x0)) {
					if (inheritedEscalationGame.nonDecisionTimestamp() > 0) return BinaryOutcomes.BinaryOutcome.None;
					uint256 inheritedEscalationEndDate = inheritedEscalationGame.getEscalationGameEndDate();
					if (block.timestamp > inheritedEscalationEndDate) return inheritedEscalationGame.getQuestionResolution();
				}
			}
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
		require(trustedAuctionAddresses[msg.sender], 'Unauthorized ETH sender');
	}
}
