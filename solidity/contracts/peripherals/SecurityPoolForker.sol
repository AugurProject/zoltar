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

struct ForkData {
	uint256 repAtFork;
	UniformPriceDualCapBatchAuction truthAuction;
	uint256 truthAuctionStarted;
	uint256 migratedRep;
	uint256 auctionedSecurityBondAllowance;

	bool ownFork;
	uint8 outcomeIndex;
}

contract SecurityPoolForker is ISecurityPoolForker {
	Zoltar public immutable zoltar;

	mapping(ISecurityPool => ForkData) internal forkDataByPool;
	mapping(ISecurityPool => mapping(uint8 => ISecurityPool)) internal childrenByPoolAndOutcome;
	mapping(ISecurityPool => mapping(address => bool)) internal claimedAuctionProceedsByPoolAndVault;
	mapping(address => bool) private trustedAuctionAddresses;

	event InitiateSecurityPoolFork(uint256 repAtFork);
	event MigrateVault(address vault, uint8 outcome, uint256 poolOwnership, uint256 securityBondAllowance, uint256 parentLockedRepInEscalationGame);
	event TruthAuctionStarted(uint256 completeSetCollateralAmount, uint256 repMigrated, uint256 repAtFork);
	event TruthAuctionFinalized();
	event ClaimAuctionProceeds(address vault, uint256 amount, uint256 poolOwnershipAmount, uint256 poolOwnershipDenominator);
	event MigrateRepFromParent(address vault, uint256 parentSecurityBondAllowance, uint256 parentPoolOwnership);
	event FinalizeAuction(uint256 repAvailable, uint256 migratedRep, uint256 repPurchased, uint256 poolOwnershipDenominator, uint256 completeSetCollateralAmount);
	event MigrateFromEscalationGame(ISecurityPool parent, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint8[] depositIndexes, uint256 totalRep, uint256 newOwnership);

	function repToPoolOwnership(ISecurityPool securityPool, uint256 repAmount) public view returns (uint256) {
		if (securityPool.poolOwnershipDenominator() == 0) return repAmount * SecurityPoolUtils.PRICE_PRECISION;
		return repAmount * securityPool.poolOwnershipDenominator() / securityPool.repToken().balanceOf(address(securityPool));
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

	function initiateSecurityPoolFork(ISecurityPool securityPool) public {
		uint248 universe = securityPool.universeId();
		EscalationGame escalationGame = securityPool.escalationGame();
		require(zoltar.getForkTime(universe) > 0, 'Zoltar needs to have forked before Security Pool can do so');
		require(securityPool.systemState() == SystemState.Operational, 'System is not operational');
		require(address(escalationGame) == address(0x0) || escalationGame.getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'question has been finalized already');
		securityPool.activateForkMode();
		ReputationToken rep = securityPool.repToken();
		rep.approve(address(zoltar), type(uint256).max);
		zoltar.prepareRepForMigration(universe, rep.balanceOf(address(this)));
		forkDataByPool[securityPool].repAtFork = zoltar.repTokensMigrated(address(this), universe);
		emit InitiateSecurityPoolFork(forkDataByPool[securityPool].repAtFork);
		// TODO: we could pay the caller basefee*2 out of Open interest. We have to reward caller
	}

	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] memory outcomeIndices) public {
		uint248 universe = securityPool.universeId();
		zoltar.migrateInternalRep(universe, forkDataByPool[securityPool].repAtFork, outcomeIndices);
	}

	function createChildUniverse(ISecurityPool parent, uint8 outcomeIndex) public {
		require(address(childrenByPoolAndOutcome[parent][outcomeIndex]) == address(0x0), 'child already created');
		require(parent.systemState() == SystemState.PoolForked, 'Pool needs to have forked');
		require(block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME , 'migration time passed');
		// first vault migrater creates new pool and transfers all REP to it
		uint248 childUniverseId = uint248(uint256(keccak256(abi.encode(parent.universeId(), outcomeIndex))));
		uint256 retentionRate = SecurityPoolUtils.calculateRetentionRate(parent.completeSetCollateralAmount(), parent.totalSecurityBondAllowance());
		(ISecurityPool child, UniformPriceDualCapBatchAuction truthAuction) = parent.securityPoolFactory().deployChildSecurityPool(parent, parent.shareToken(), childUniverseId, parent.questionId(), parent.securityMultiplier(), retentionRate, parent.priceOracleManagerAndOperatorQueuer().lastPrice(), 0);
		forkDataByPool[child].outcomeIndex = outcomeIndex;
		forkDataByPool[child].truthAuction = truthAuction;
		trustedAuctionAddresses[address(truthAuction)] = true;
		childrenByPoolAndOutcome[parent][outcomeIndex] = child;
		parent.authorizeChildPool(child);
		ReputationToken childReputationToken = child.repToken();
		childReputationToken.transfer(address(child), childReputationToken.balanceOf(address(this)));

		if (forkDataByPool[parent].ownFork) {
			child.setOwnershipDenominator(parent.poolOwnershipDenominator() * forkDataByPool[parent].repAtFork / (forkDataByPool[parent].repAtFork + parent.escalationGame().nonDecisionThreshold()*2/5) );
		} else {
			child.setOwnershipDenominator(parent.poolOwnershipDenominator());
		}
	}

	// TODO, atm this needs to be called after migratevault
	function migrateFromEscalationGame(ISecurityPool parent, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint8[] memory depositIndexes) public {
		EscalationGame escalationGame = parent.escalationGame();
		if (address(childrenByPoolAndOutcome[parent][uint8(outcomeIndex)]) == address(0x0)) createChildUniverse(parent, uint8(outcomeIndex));
		ISecurityPool child = childrenByPoolAndOutcome[parent][uint8(outcomeIndex)];
		require(address(escalationGame) != address(0x0), 'escalation game needs to be deployed');
		uint256 repMigratedFromEscalationGame = 0;
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			(address depositor, uint256 amountToWithdraw) = escalationGame.claimDepositForWinning(depositIndexes[index], outcomeIndex);
			require(depositor == vault, 'deposit was not for this vault');
			repMigratedFromEscalationGame += amountToWithdraw;
		}
		(uint256 currentPoolOwnership, uint256 currentSecurityBondAllowance, , uint256 currentFeeIndex, ) = child.securityVaults(vault);
		uint256 ownershipDelta = repToPoolOwnership(child, repMigratedFromEscalationGame);
		child.configureVault(vault, currentPoolOwnership + ownershipDelta, currentSecurityBondAllowance, currentFeeIndex);
		forkDataByPool[child].migratedRep += repMigratedFromEscalationGame;
		emit MigrateFromEscalationGame(parent, vault, outcomeIndex, depositIndexes, repMigratedFromEscalationGame, ownershipDelta);
		// migrate open interest
		parent.transferEth(payable(child), parent.completeSetCollateralAmount() * repMigratedFromEscalationGame / forkDataByPool[parent].repAtFork);
	}

	// migrates vault into outcome universe after fork
	function migrateVault(ISecurityPool parent, uint8 outcomeIndex) public {
		parent.updateVaultFees(msg.sender);
		if (address(childrenByPoolAndOutcome[parent][outcomeIndex]) == address(0x0)) createChildUniverse(parent, outcomeIndex);
		ISecurityPool child = childrenByPoolAndOutcome[parent][outcomeIndex];

		child.updateVaultFees(msg.sender);
		parent.updateCollateralAmount();
		(uint256 parentPoolOwnership, uint256 parentSecurityBondAllowance, , , uint256 parentLockedRepInEscalationGame) = parent.securityVaults(msg.sender);
		emit MigrateRepFromParent(msg.sender, parentSecurityBondAllowance, parentPoolOwnership);
		uint256 childCurrentCollateral = child.completeSetCollateralAmount();
		uint256 childCurrentBond = child.totalSecurityBondAllowance();
		child.setPoolFinancials(childCurrentCollateral, childCurrentBond + parentSecurityBondAllowance);

		uint256 vaultPoolOwnership = 0;
		uint256 vaultFeeIndex = 0;
		if (parent.poolOwnershipDenominator() != 0 && child.repToken().balanceOf(address(child)) != 0) {
			vaultPoolOwnership = parentPoolOwnership - repToPoolOwnership(child, parentLockedRepInEscalationGame);
			vaultFeeIndex = child.feeIndex();
			uint256 migratedRep = poolOwnershipToRep(child, vaultPoolOwnership);
			forkDataByPool[child].migratedRep += migratedRep;
			// migrate open interest
			if (vaultPoolOwnership > 0) {
				parent.transferEth(payable(child), parent.completeSetCollateralAmount() * migratedRep / forkDataByPool[parent].repAtFork);
			}
		}

		child.configureVault(msg.sender, vaultPoolOwnership, parentSecurityBondAllowance, vaultFeeIndex);

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
			// sell all but very small amount of REP for ETH. We cannot sell all for accounting purposes, as `poolOwnershipDenominator` cannot be infinite
			// only migratedRep gets this guarantee that some of their rep never gets sold
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
		securityPool.drainAllRep();
		forkDataByPool[securityPool].ownFork = true;
		securityPool.repToken().approve(address(zoltar), type(uint256).max);
		zoltar.forkUniverse(securityPool.universeId(), securityPool.questionId());
	}

	// accounts the purchased REP from truthAuction to the vault
	// we should also move a share of bad debt in the system to this vault
	// anyone can call these so that we can liquidate them if needed
	function claimAuctionProceeds(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] memory tickIndices) public {
		require(claimedAuctionProceedsByPoolAndVault[securityPool][vault] == false, 'Already Claimed');
		require(forkDataByPool[securityPool].truthAuction.finalized(), 'Auction needs to be finalized');
		claimedAuctionProceedsByPoolAndVault[securityPool][vault] = true;
		(uint256 amount, ) = forkDataByPool[securityPool].truthAuction.withdrawBids(vault, tickIndices);
		require(amount > 0, 'Did not purchase anything'); // not really necessary, but good for testing
		uint256 poolOwnershipAmount = repToPoolOwnership(securityPool, amount);
		(uint256 poolOwnership, , , uint256 currentFeeIndex, ) = securityPool.securityVaults(vault);
		uint256 newSecurityBondAllowance = forkDataByPool[securityPool].auctionedSecurityBondAllowance * amount / forkDataByPool[securityPool].truthAuction.totalRepPurchased();
		securityPool.configureVault(vault, poolOwnership + poolOwnershipAmount, newSecurityBondAllowance, currentFeeIndex);
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
