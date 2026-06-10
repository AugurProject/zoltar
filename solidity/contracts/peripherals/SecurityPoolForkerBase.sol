// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { Zoltar } from '../Zoltar.sol';
import { IUniformPriceDualCapBatchAuction } from './interfaces/IUniformPriceDualCapBatchAuction.sol';
import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
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
	uint256 outcomeIndex;
}

struct ImportedEscalationPosition {
	ISecurityPool rootPool;
	address beneficiaryVault;
	uint256 principal;
	bool settledOrMigrated;
}

abstract contract SecurityPoolForkerBase {
	Zoltar public immutable zoltar;

	mapping(ISecurityPool => ForkData) internal forkDataByPool;
	mapping(ISecurityPool => mapping(uint256 => ISecurityPool)) internal childrenByPoolAndOutcome;
	// Zoltar keys migration balances by `msg.sender`, so each parent pool needs its
	// own caller identity to avoid sharing migration state with other pools in the
	// same universe.
	mapping(ISecurityPool => SecurityPoolMigrationProxy) internal migrationProxyByPool;
	// Child-universe REP can be minted before the corresponding child security pool
	// exists. Track those balances per parent/outcome until the child pool is ready
	// to receive them.
	mapping(ISecurityPool => mapping(uint256 => uint256)) internal pendingChildRepByPoolAndOutcome;
	mapping(ISecurityPool => ISecurityPool) internal inheritedEscalationRootPoolByChild;
	mapping(ISecurityPool => mapping(uint8 => mapping(uint256 => ImportedEscalationPosition))) internal importedEscalationPositionsByPool;
	mapping(address => bool) internal trustedAuctionAddresses;

	event InitiateSecurityPoolFork(uint256 repAtFork);
	event MigrateVault(address vault, uint256 outcome, uint256 poolOwnership, uint256 securityBondAllowance, uint256 parentLockedRepInEscalationGame);
	event TruthAuctionStarted(uint256 completeSetCollateralAmount, uint256 repMigrated, uint256 repAtFork);
	event TruthAuctionFinalized();
	event ClaimAuctionProceeds(address vault, uint256 amount, uint256 poolOwnershipAmount, uint256 poolOwnershipDenominator);
	event MigrateRepFromParent(address vault, uint256 parentSecurityBondAllowance, uint256 parentPoolOwnership);
	event FinalizeAuction(uint256 repAvailable, uint256 migratedRep, uint256 repPurchased, uint256 poolOwnershipDenominator, uint256 completeSetCollateralAmount);
	event MigrateFromEscalationGame(ISecurityPool parent, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256[] depositIndexes, uint256 totalRep, uint256 newOwnership);

	constructor(Zoltar _zoltar) {
		zoltar = _zoltar;
	}

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
		uint256 outcomeIndex
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

	function _forkQuestionMatchesPool(ISecurityPool securityPool) internal view returns (bool) {
		(, uint256 forkQuestionId, , , ) = zoltar.universes(securityPool.universeId());
		return forkQuestionId == securityPool.questionId();
	}

	function _applyRepClaimToVault(ISecurityPool securityPool, address vault, uint256 repAmount) internal returns (uint256 ownershipDelta) {
		(uint256 currentPoolOwnership, uint256 currentSecurityBondAllowance, , uint256 currentFeeIndex, ) = securityPool.securityVaults(vault);
		ownershipDelta = repToPoolOwnership(securityPool, repAmount);
		securityPool.configureVault(vault, currentPoolOwnership + ownershipDelta, currentSecurityBondAllowance, currentFeeIndex);
	}

	function _transferMigratedCollateral(ISecurityPool source, ISecurityPool target, uint256 migratedPrincipal, uint256 repAtFork) internal {
		if (migratedPrincipal == 0 || repAtFork == 0) return;
		source.transferEth(payable(target), source.completeSetCollateralAmount() * migratedPrincipal / repAtFork);
	}

	function _forkSecurityPoolOnQuestion(ISecurityPool securityPool) internal {
		ReputationToken rep = securityPool.repToken();
		uint256 repBalanceBefore = rep.balanceOf(address(this));
		securityPool.drainAllRep();
		forkDataByPool[securityPool].ownFork = true;
		SecurityPoolMigrationProxy migrationProxy = _getOrDeployMigrationProxy(securityPool);
		uint256 repBalanceAfter = rep.balanceOf(address(this));
		uint256 repToFork = repBalanceAfter - repBalanceBefore;
		if (repToFork > 0) rep.transfer(address(migrationProxy), repToFork);
		migrationProxy.forkUniverse(securityPool.questionId());
		initiateSecurityPoolFork(securityPool);
	}

	function _getMigrationProxySalt(ISecurityPool securityPool) internal pure returns (bytes32) {
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
	function _getOrDeployMigrationProxy(ISecurityPool securityPool) internal returns (SecurityPoolMigrationProxy migrationProxy) {
		migrationProxy = migrationProxyByPool[securityPool];
		if (address(migrationProxy) != address(0x0)) return migrationProxy;
		migrationProxy = new SecurityPoolMigrationProxy{ salt: _getMigrationProxySalt(securityPool) }(zoltar, securityPool.repToken(), securityPool.universeId(), address(this));
		migrationProxyByPool[securityPool] = migrationProxy;
	}

	function _getOrDeployChildPool(ISecurityPool parent, uint256 outcomeIndex) internal returns (ISecurityPool child) {
		child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) {
			require(parent.systemState() == SystemState.PoolForked, 'Pool needs to have forked');
			require(block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'migration time passed');
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
			if (!_forkQuestionMatchesPool(parent) && address(parent.escalationGame()) != address(0x0)) {
				inheritedEscalationRootPoolByChild[child] = parent;
			}

			if (_forkQuestionMatchesPool(parent) && address(parent.escalationGame()) != address(0x0)) {
				child.setOwnershipDenominator(parent.poolOwnershipDenominator() * forkDataByPool[parent].repAtFork / (forkDataByPool[parent].repAtFork + parent.escalationGame().nonDecisionThreshold() * 2 / 5));
			} else {
				child.setOwnershipDenominator(parent.poolOwnershipDenominator());
			}
		}

		_sweepChildRepToPool(parent, outcomeIndex);
	}

	function _sweepChildRepToPool(ISecurityPool parent, uint256 outcomeIndex) internal {
		ISecurityPool child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) return;
		uint256 pendingChildRep = pendingChildRepByPoolAndOutcome[parent][outcomeIndex];
		if (pendingChildRep == 0) return;
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		require(address(migrationProxy) != address(0x0), 'proxy missing');
		pendingChildRepByPoolAndOutcome[parent][outcomeIndex] = 0;
		migrationProxy.sweepChildRep(address(child), child.repToken(), pendingChildRep);
	}

	function initiateSecurityPoolFork(ISecurityPool securityPool) public virtual {
		uint248 universe = securityPool.universeId();
		EscalationGame escalationGame = securityPool.escalationGame();
		require(zoltar.getForkTime(universe) > 0, 'Zoltar needs to have forked before Security Pool can do so');
		require(securityPool.systemState() != SystemState.PoolForked, 'Security pool fork already initiated');
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
}
