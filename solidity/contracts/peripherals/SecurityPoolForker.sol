// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ReputationToken } from '../ReputationToken.sol';
import { Zoltar } from '../Zoltar.sol';
import { IUniformPriceDualCapBatchAuction } from './interfaces/IUniformPriceDualCapBatchAuction.sol';
import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from './interfaces/ISecurityPool.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';

struct ForkData {
	uint256 repAtFork;
	UniformPriceDualCapBatchAuction truthAuction;
	uint256 truthAuctionStarted;
	uint256 migratedRep;
	uint256 auctionedSecurityBondAllowance;
	uint256 claimedAuctionRepPurchased;
	uint256 claimedAuctionedSecurityBondAllowance;

	bool ownFork;
	uint8 outcomeIndex;
}

contract SecurityPoolForker is ISecurityPoolForker {
	Zoltar public immutable zoltar;

	mapping(ISecurityPool => ForkData) internal forkDataByPool;
	mapping(ISecurityPool => mapping(uint8 => ISecurityPool)) internal childrenByPoolAndOutcome;
	// Zoltar keys migration balances by `msg.sender`, so each parent pool needs its
	// own caller identity to avoid sharing migration state with other pools in the
	// same universe.
	mapping(ISecurityPool => SecurityPoolMigrationProxy) internal migrationProxyByPool;
	// Child-universe REP can be minted before the corresponding child security pool
	// exists. Track those balances per parent/outcome until the child pool is ready
	// to receive them.
	mapping(ISecurityPool => mapping(uint8 => uint256)) internal pendingChildRepByPoolAndOutcome;
	mapping(address => bool) private trustedAuctionAddresses;

	event InitiateSecurityPoolFork(uint256 repAtFork);
	event MigrateVault(address vault, uint8 outcome, uint256 poolOwnership, uint256 securityBondAllowance, uint256 parentLockedRepInEscalationGame);
	event TruthAuctionStarted(uint256 completeSetCollateralAmount, uint256 repMigrated, uint256 repAtFork);
	event TruthAuctionFinalized();
	event ClaimAuctionProceeds(address vault, uint256 amount, uint256 poolOwnershipAmount, uint256 poolOwnershipDenominator);
	event MigrateRepFromParent(address vault, uint256 parentSecurityBondAllowance, uint256 parentPoolOwnership);
	event FinalizeAuction(uint256 repAvailable, uint256 migratedRep, uint256 repPurchased, uint256 poolOwnershipDenominator, uint256 completeSetCollateralAmount);
	event MigrateFromEscalationGame(ISecurityPool parent, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256[] depositIndexes, uint256 totalRep, uint256 newOwnership);

	function repToPoolOwnership(ISecurityPool securityPool, uint256 repAmount) public view returns (uint256) {
		uint256 poolOwnershipDenominator = securityPool.poolOwnershipDenominator();
		uint256 childRepBalance = securityPool.repToken().balanceOf(address(securityPool));
		if (poolOwnershipDenominator == 0 || childRepBalance == 0) return repAmount * SecurityPoolUtils.PRICE_PRECISION;
		return repAmount * poolOwnershipDenominator / childRepBalance;
	}

	function poolOwnershipToRep(ISecurityPool securityPool, uint256 poolOwnership) public view returns (uint256) {
		return poolOwnership * securityPool.repToken().balanceOf(address(securityPool)) / securityPool.poolOwnershipDenominator();
	}

	function forkData(ISecurityPool securityPool) public view returns (
		uint256 repAtFork,
		UniformPriceDualCapBatchAuction truthAuction,
		uint256 truthAuctionStarted,
		uint256 migratedRep,
		uint256 auctionedSecurityBondAllowance,
		bool ownFork,
		uint8 outcomeIndex
	) {
		ForkData storage data = forkDataByPool[securityPool];
		return (
			data.repAtFork,
			data.truthAuction,
			data.truthAuctionStarted,
			data.migratedRep,
			data.auctionedSecurityBondAllowance,
			data.ownFork,
			data.outcomeIndex
		);
	}

	function getMigratedRep(ISecurityPool securityPool) public view returns (uint256) {
		return forkDataByPool[securityPool].migratedRep;
	}

	constructor(Zoltar _zoltar) {
		zoltar = _zoltar;
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

	function _getOrDeployChildPool(ISecurityPool parent, uint8 outcomeIndex) private returns (ISecurityPool child) {
		child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) {
			require(parent.systemState() == SystemState.PoolForked, 'Pool needs to have forked');
			require(block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME , 'migration time passed');
			uint248 childUniverseId = uint248(uint256(keccak256(abi.encode(parent.universeId(), outcomeIndex))));
			if (address(zoltar.getRepToken(childUniverseId)) == address(0x0)) {
				zoltar.deployChild(parent.universeId(), outcomeIndex);
			}

			uint256 retentionRate = SecurityPoolUtils.calculateRetentionRate(parent.completeSetCollateralAmount(), parent.totalSecurityBondAllowance());
			UniformPriceDualCapBatchAuction truthAuction;
			(child, truthAuction) = parent.securityPoolFactory().deployChildSecurityPool(parent, parent.shareToken(), childUniverseId, parent.questionId(), parent.securityMultiplier(), retentionRate, 0);
			forkDataByPool[child].outcomeIndex = outcomeIndex;
			forkDataByPool[child].truthAuction = truthAuction;
			trustedAuctionAddresses[address(truthAuction)] = true;
			childrenByPoolAndOutcome[parent][outcomeIndex] = child;
			parent.authorizeChildPool(child);

			if (forkDataByPool[parent].ownFork) {
				child.setOwnershipDenominator(parent.poolOwnershipDenominator() * forkDataByPool[parent].repAtFork / (forkDataByPool[parent].repAtFork + parent.escalationGame().nonDecisionThreshold()*2/5) );
			} else {
				child.setOwnershipDenominator(parent.poolOwnershipDenominator());
			}
		}

		_sweepChildRepToPool(parent, outcomeIndex);
	}

	function _sweepChildRepToPool(ISecurityPool parent, uint8 outcomeIndex) private {
		ISecurityPool child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) return;
		uint256 pendingChildRep = pendingChildRepByPoolAndOutcome[parent][outcomeIndex];
		if (pendingChildRep == 0) return;
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		require(address(migrationProxy) != address(0x0), 'migration proxy missing');
		pendingChildRepByPoolAndOutcome[parent][outcomeIndex] = 0;
		migrationProxy.sweepChildRep(address(child), child.repToken(), pendingChildRep);
	}

	function initiateSecurityPoolFork(ISecurityPool securityPool) public {
		uint248 universe = securityPool.universeId();
		EscalationGame escalationGame = securityPool.escalationGame();
		require(zoltar.getForkTime(universe) > 0, 'Zoltar needs to have forked before Security Pool can do so');
		require(securityPool.systemState() == SystemState.Operational, 'System is not operational');
		require(address(escalationGame) == address(0x0) || escalationGame.getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'question has been finalized already');
		ReputationToken rep = securityPool.repToken();
		uint256 repBalanceBefore = rep.balanceOf(address(this));
		securityPool.activateForkMode();
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 previousMigrationBalance = zoltar.getMigrationRepBalance(address(migrationProxy), universe);
		uint256 repBalanceAfter = rep.balanceOf(address(this));
		uint256 repToLock = repBalanceAfter - repBalanceBefore;
		if (repToLock > 0) rep.transfer(address(migrationProxy), repToLock);
		uint256 proxyRepBalance = rep.balanceOf(address(migrationProxy));
		if (proxyRepBalance > 0) migrationProxy.lockRep(proxyRepBalance);
		forkDataByPool[securityPool].repAtFork = previousMigrationBalance + proxyRepBalance;
		emit InitiateSecurityPoolFork(forkDataByPool[securityPool].repAtFork);
		// TODO: we could pay the caller basefee*2 out of Open interest. We have to reward caller
	}

	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] memory outcomeIndices) public {
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[securityPool];
		require(address(migrationProxy) != address(0x0), 'migration proxy missing');
		migrationProxy.splitToChild(forkDataByPool[securityPool].repAtFork, outcomeIndices);
		for (uint256 index = 0; index < outcomeIndices.length; index++) {
			uint256 outcomeIndex = outcomeIndices[index];
			require(outcomeIndex <= type(uint8).max, 'outcome index overflow');
			uint8 normalizedOutcomeIndex = uint8(outcomeIndex);
			pendingChildRepByPoolAndOutcome[securityPool][normalizedOutcomeIndex] += forkDataByPool[securityPool].repAtFork;
			_sweepChildRepToPool(securityPool, normalizedOutcomeIndex);
		}
	}

	function createChildUniverse(ISecurityPool parent, uint8 outcomeIndex) public {
		require(address(childrenByPoolAndOutcome[parent][outcomeIndex]) == address(0x0), 'child already created');
		_getOrDeployChildPool(parent, outcomeIndex);
	}

	function migrateFromEscalationGame(ISecurityPool parent, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256[] memory depositIndexes) public {
		EscalationGame escalationGame = parent.escalationGame();
		ISecurityPool child = _getOrDeployChildPool(parent, uint8(outcomeIndex));
		require(address(escalationGame) != address(0x0), 'escalation game needs to be deployed');
		require(escalationGame.nonDecisionTimestamp() > 0, 'escalation game has not reached non-decision');
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
		(uint256 currentPoolOwnership, uint256 currentSecurityBondAllowance, , uint256 currentFeeIndex, ) = child.securityVaults(vault);
		uint256 ownershipDelta = repToPoolOwnership(child, repMigratedFromEscalationGame);
		child.configureVault(vault, currentPoolOwnership + ownershipDelta, currentSecurityBondAllowance, currentFeeIndex);
		forkDataByPool[child].migratedRep += migratedPrincipal;
		emit MigrateFromEscalationGame(parent, vault, outcomeIndex, depositIndexes, repMigratedFromEscalationGame, ownershipDelta);
		// migrate open interest
		if (parentRepAtFork > 0) {
			parent.transferEth(payable(child), parent.completeSetCollateralAmount() * migratedPrincipal / parentRepAtFork);
		}
	}

	// migrates vault into outcome universe after fork
	function migrateVault(ISecurityPool parent, uint8 outcomeIndex) public {
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
			// migrate open interest
			if (migratedPoolOwnership > 0 && parentRepAtFork > 0) {
				parent.transferEth(payable(child), parent.completeSetCollateralAmount() * migratedRep / parentRepAtFork);
			}
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
				_finalizeTruthAuction(securityPool, 0);
			} else {
				// we need to buy all the collateral that is missing (did not migrate)
				uint256 ethToBuy = parentCollateral - parentCollateral * forkDataByPool[securityPool].migratedRep / forkDataByPool[parent].repAtFork;
				if (ethToBuy == 0) {
					_finalizeTruthAuction(securityPool, 0);
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

	function _finalizeTruthAuction(ISecurityPool securityPool, uint256 repPurchased) private {
		require(securityPool.systemState() == SystemState.ForkTruthAuction, 'Auction needs to have started');
		// finalize sends ETH to securityPool
		forkDataByPool[securityPool].truthAuction.finalize();
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
			uint256 denominator = repAvailable - repPurchased;
			if (denominator > 0) {
				securityPool.setOwnershipDenominator(forkDataByPool[securityPool].migratedRep * repAvailable * SecurityPoolUtils.PRICE_PRECISION / denominator);
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
		_finalizeTruthAuction(securityPool, forkDataByPool[securityPool].truthAuction.totalRepPurchased());
	}

	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) public {
		EscalationGame escalationGame = securityPool.escalationGame();
		require(address(escalationGame) != address(0x0) && escalationGame.nonDecisionTimestamp() > 0, 'escalation game has not triggered fork');
		ReputationToken rep = securityPool.repToken();
		uint256 repBalanceBefore = rep.balanceOf(address(this));
		securityPool.drainAllRep();
		forkDataByPool[securityPool].ownFork = true;
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 repBalanceAfter = rep.balanceOf(address(this));
		uint256 repToFork = repBalanceAfter - repBalanceBefore;
		if (repToFork > 0) rep.transfer(address(migrationProxy), repToFork);
		migrationProxy.forkUniverse(securityPool.questionId());
	}

	// accounts the purchased REP from truthAuction to the vault
	// we should also move a share of bad debt in the system to this vault
	// anyone can call these so that we can liquidate them if needed
	function claimAuctionProceeds(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] memory tickIndices) public {
		require(forkDataByPool[securityPool].truthAuction.finalized(), 'Auction needs to be finalized');
		(uint256 amount, ) = forkDataByPool[securityPool].truthAuction.withdrawBids(vault, tickIndices);
		require(amount > 0, 'Did not purchase anything'); // not really necessary, but good for testing
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

	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome){
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
		require(trustedAuctionAddresses[msg.sender], 'Unauthorized ETH sender');
	}

}
