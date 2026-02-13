// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ReputationToken } from '../ReputationToken.sol';
import { Zoltar } from '../Zoltar.sol';
import { Auction } from './Auction.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from './interfaces/ISecurityPool.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { EscalationGame } from './EscalationGame.sol';
import { YesNoMarkets } from './YesNoMarkets.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';

struct ForkData {
	uint256 repAtFork;
	mapping(uint8 => ISecurityPool) children; // outcome -> children
	Auction truthAuction;
	mapping(address => bool) claimedAuctionProceeds;
	uint256 truthAuctionStarted;
	uint256 migratedRep;
	uint256 auctionedSecurityBondAllowance;

	bool ownFork;
	uint8 outcomeIndex;
}

contract SecurityPoolForker is ISecurityPoolForker {
	Zoltar public immutable zoltar;
	YesNoMarkets public yesNoMarkets;

	mapping(ISecurityPool => ForkData) public forkData;

	event ForkSecurityPool(uint256 repAtFork);
	event MigrateVault(address vault, uint8 outcome, uint256 poolOwnership, uint256 securityBondAllowance, uint256 parentLockedRepInEscalationGame);
	event TruthAuctionStarted(uint256 completeSetCollateralAmount, uint256 repMigrated, uint256 repAtFork);
	event TruthAuctionFinalized();
	event ClaimAuctionProceeds(address vault, uint256 amount, uint256 poolOwnershipAmount, uint256 poolOwnershipDenominator);
	event MigrateRepFromParent(address vault, uint256 parentSecurityBondAllowance, uint256 parentpoolOwnership);
	event FinalizeAuction(uint256 repAvailable, uint256 migratedRep, uint256 repPurchased, uint256 poolOwnershipDenominator, uint256 completeSetCollateralAmount);
	event MigrateFromEscalationGame(ISecurityPool parent, address vault, YesNoMarkets.Outcome outcomeIndex, uint8[] depositIndexes, uint256 totalRep, uint256 newOwnership);

	function repToPoolOwnership(ISecurityPool securityPool, uint256 repAmount) public view returns (uint256) {
		if (securityPool.poolOwnershipDenominator() == 0) return repAmount * SecurityPoolUtils.PRICE_PRECISION;
		return repAmount * securityPool.poolOwnershipDenominator() / securityPool.repToken().balanceOf(address(securityPool));
	}

	function poolOwnershipToRep(ISecurityPool securityPool, uint256 poolOwnership) public view returns (uint256) {
		return poolOwnership * securityPool.repToken().balanceOf(address(securityPool)) / securityPool.poolOwnershipDenominator();
	}
	function getMigratedRep(ISecurityPool securityPool) public view returns (uint256) {
		return forkData[securityPool].migratedRep;
	}

	constructor(Zoltar _zoltar) {
		zoltar = _zoltar;
	}

	function forkSecurityPool(ISecurityPool securityPool) public {
		uint248 universe = securityPool.universeId();
		EscalationGame escalationGame = securityPool.escalationGame();
		require(zoltar.getForkTime(universe) > 0, 'Zoltar needs to have forked before Security Pool can do so');
		require(securityPool.systemState() == SystemState.Operational, 'System is not operational');
		require(address(escalationGame) == address(0x0) || escalationGame.getMarketResolution() == YesNoMarkets.Outcome.None, 'question has been finalized already');
		securityPool.setSystemState(SystemState.PoolForked);
		securityPool.updateCollateralAmount();
		securityPool.setRetentionRate(0);
		ReputationToken rep = securityPool.repToken();
		securityPool.stealAllRep();
		forkData[securityPool].repAtFork = rep.balanceOf(address(this));

		uint8[] memory outcomeIndices = new uint8[](4 + 1);
		for (uint8 index = 0; index < outcomeIndices.length; index++) {
			outcomeIndices[index] = index;
		}
		rep.approve(address(zoltar), type(uint256).max);
		zoltar.splitRep(universe, outcomeIndices);
		if (zoltar.getForkedBy(universe) == address(this)) {
			forkData[securityPool].repAtFork += zoltar.getForkerDeposit(universe);
			zoltar.forkerClaimRep(universe, outcomeIndices);
		}
		emit ForkSecurityPool(forkData[securityPool].repAtFork);
		// TODO: we could pay the caller basefee*2 out of Open interest. We have to reward caller
	}

	function createChildUniverse(ISecurityPool parent, uint8 outcomeIndex) public {
		require(address(forkData[parent].children[outcomeIndex]) == address(0x0), 'child already created');
		require(parent.systemState() == SystemState.PoolForked, 'Pool needs to have forked');
		require(block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME , 'migration time passed');
		// first vault migrater creates new pool and transfers all REP to it
		uint248 childUniverseId = uint248(uint256(keccak256(abi.encode(parent.universeId(), outcomeIndex))));
		uint256 retentionRate = SecurityPoolUtils.calculateRetentionRate(parent.completeSetCollateralAmount(), parent.totalSecurityBondAllowance());
		(ISecurityPool child, Auction truthAuction) = parent.securityPoolFactory().deployChildSecurityPool(parent, parent.shareToken(), childUniverseId, parent.marketId(), parent.securityMultiplier(), retentionRate, parent.priceOracleManagerAndOperatorQueuer().lastPrice(), 0);
		forkData[child].outcomeIndex = outcomeIndex;
		forkData[child].truthAuction = truthAuction;
		forkData[parent].children[outcomeIndex] = child;
		parent.authorize(child);
		ReputationToken childReputationToken = child.repToken();
		childReputationToken.transfer(address(child), childReputationToken.balanceOf(address(this)));

		//child.setPoolOwnershipDenominator(forkData[parent].repAtFork * SecurityPoolUtils.PRICE_PRECISION);
		if (forkData[parent].ownFork) {
			child.setPoolOwnershipDenominator(parent.poolOwnershipDenominator() * forkData[parent].repAtFork / (forkData[parent].repAtFork + parent.escalationGame().nonDecisionTreshold()*2/5) );
		} else {
			child.setPoolOwnershipDenominator(parent.poolOwnershipDenominator());
		}
	}

	//todo, atm this needs to be called after migratevault
	function migrateFromEscalationGame(ISecurityPool parent, address vault, YesNoMarkets.Outcome outcomeIndex, uint8[] memory depositIndexes) public {
		EscalationGame escalationGame = parent.escalationGame();
		if (address(forkData[parent].children[uint8(outcomeIndex)]) == address(0x0)) createChildUniverse(parent, uint8(outcomeIndex));
		ISecurityPool child = forkData[parent].children[uint8(outcomeIndex)];
		require(address(escalationGame) != address(0x0), 'escalation game needs to be deployed');
		uint256 repMigratedFromEscalationGame = 0;
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			(address depositor, uint256 amountToWithdraw) = escalationGame.claimDepositForWinning(depositIndexes[index], outcomeIndex);
			require(depositor == vault, 'deposit was not for this vault');
			repMigratedFromEscalationGame += amountToWithdraw;
		}
		(uint256 poolOwnership, , , , ) = child.securityVaults(vault);
		uint256 ownershipDelta = repToPoolOwnership(child, repMigratedFromEscalationGame);
		child.setVaultPoolOwnership(msg.sender, poolOwnership + ownershipDelta);
		forkData[child].migratedRep += repMigratedFromEscalationGame;
		emit MigrateFromEscalationGame(parent, vault, outcomeIndex, depositIndexes, repMigratedFromEscalationGame, ownershipDelta);
		// migrate open interest
		parent.migrateEth(payable(child), parent.completeSetCollateralAmount() * repMigratedFromEscalationGame / forkData[parent].repAtFork);

	}

	// migrates vault into outcome universe after fork
	function migrateVault(ISecurityPool parent, uint8 outcomeIndex) public {
		parent.updateVaultFees(msg.sender);
		if (address(forkData[parent].children[outcomeIndex]) == address(0x0)) createChildUniverse(parent, outcomeIndex);
		ISecurityPool child = forkData[parent].children[outcomeIndex];

		child.updateVaultFees(msg.sender);
		parent.updateCollateralAmount();
		(uint256 parentPoolOwnership, uint256 parentSecurityBondAllowance, , , uint256 parentLockedRepInEscalationGame) = parent.securityVaults(msg.sender);
		emit MigrateRepFromParent(msg.sender, parentSecurityBondAllowance, parentPoolOwnership);
		child.setVaultSecurityBondAllowance(msg.sender, parentSecurityBondAllowance);
		child.addToTotalSecurityBondAllowance(parentSecurityBondAllowance);

		if (parent.poolOwnershipDenominator() != 0 && child.repToken().balanceOf(address(child)) != 0) {
			uint256 ownership = parentPoolOwnership - repToPoolOwnership(child, parentLockedRepInEscalationGame);
			child.setVaultPoolOwnership(msg.sender, ownership);
			uint256 migratedRep = poolOwnershipToRep(child, ownership);
			forkData[child].migratedRep += migratedRep;
			child.setVaultFeeIndex(msg.sender, child.feeIndex());
			// migrate open interest
			if (ownership > 0) {
				parent.migrateEth(payable(child), parent.completeSetCollateralAmount() * migratedRep / forkData[parent].repAtFork);
			}
		}

		(uint256 poolOwnership, uint256 securityBondAllowance,,,) = parent.securityVaults(msg.sender);
		emit MigrateVault(msg.sender, outcomeIndex, poolOwnership, securityBondAllowance, parentLockedRepInEscalationGame);
		parent.setVaultOwnership(msg.sender, 0, 0);
	}

	function startTruthAuction(ISecurityPool securityPool) public {
		require(securityPool.systemState() == SystemState.ForkMigration, 'System needs to be in migration');
		require(block.timestamp > zoltar.getForkTime(securityPool.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'migration time needs to pass first');
		securityPool.setSystemState(SystemState.ForkTruthAuction);
		forkData[securityPool].truthAuctionStarted = block.timestamp;
		ISecurityPool parent = securityPool.parent();
		parent.updateCollateralAmount();
		uint256 parentCollateral = parent.completeSetCollateralAmount();
		securityPool.setShareTokenSupply(parent.shareTokenSupply());
		emit TruthAuctionStarted(parentCollateral, forkData[securityPool].migratedRep, forkData[parent].repAtFork);
		if (forkData[securityPool].migratedRep >= forkData[parent].repAtFork) {
			// we have acquired all the ETH already, no need for truthAuction
			_finalizeTruthAuction(securityPool, 0);
		} else {
			// we need to buy all the collateral that is missing (did not migrate)
			uint256 ethToBuy = parentCollateral - parentCollateral * forkData[securityPool].migratedRep / forkData[parent].repAtFork;
			// sell all but very small amount of REP for ETH. We cannot sell all for accounting purposes, as `poolOwnershipDenominator` cannot be infinite
			// only migratedRep gets this guarrantee that some of their rep never gets sold
			forkData[securityPool].truthAuction.startAuction(ethToBuy, forkData[parent].repAtFork - forkData[securityPool].migratedRep / SecurityPoolUtils.MAX_AUCTION_VAULT_HAIRCUT_DIVISOR);
		}
	}

	function _finalizeTruthAuction(ISecurityPool securityPool, uint256 repPurchased) private {
		require(securityPool.systemState() == SystemState.ForkTruthAuction, 'Auction need to have started');
		forkData[securityPool].truthAuction.finalizeAuction(address(securityPool)); // this sends the eth back
		securityPool.setSystemState(SystemState.Operational);
		ISecurityPool parent = securityPool.parent();
		uint256 repAvailable = forkData[parent].repAtFork;
		securityPool.setCompleteSetCollateralAmount(address(securityPool).balance - securityPool.totalFeesOvedToVaults()); //todo, we might want to reduce fees if we didn't get fully funded?
		uint256 parentTotalSecurityBondAllowance = parent.totalSecurityBondAllowance();
		forkData[securityPool].auctionedSecurityBondAllowance = parentTotalSecurityBondAllowance - securityPool.totalSecurityBondAllowance();
		securityPool.setTotalSecurityBondAllowance(parentTotalSecurityBondAllowance);
		if (repAvailable > 0) {
			securityPool.setPoolOwnershipDenominator(forkData[securityPool].migratedRep * repAvailable * SecurityPoolUtils.PRICE_PRECISION / (repAvailable - repPurchased));
		}
		if (securityPool.poolOwnershipDenominator() == 0) { // wipe all rep holders in vaults
			securityPool.setPoolOwnershipDenominator(repAvailable * SecurityPoolUtils.PRICE_PRECISION);
		}
		emit FinalizeAuction(repAvailable, forkData[securityPool].migratedRep, repPurchased, securityPool.poolOwnershipDenominator(), securityPool.completeSetCollateralAmount());
		securityPool.updateRetentionRate();
	}

	function finalizeTruthAuction(ISecurityPool securityPool) public {
		require(block.timestamp > forkData[securityPool].truthAuctionStarted + SecurityPoolUtils.AUCTION_TIME, 'truthAuction still ongoing');
		_finalizeTruthAuction(securityPool, forkData[securityPool].truthAuction.totalRepPurchased());
	}

	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) public {
		EscalationGame escalationGame = securityPool.escalationGame();
		require(address(escalationGame) != address(0x0) && escalationGame.nonDecisionTimestamp() > 0, 'escalation game has not triggered fork');
		(string memory extraInfo, string[4] memory outcomes) = securityPool.yesNoMarkets().getForkingData(securityPool.marketId());
		securityPool.stealAllRep();
		forkData[securityPool].ownFork = true;
		securityPool.repToken().approve(address(zoltar), type(uint256).max);
		zoltar.forkUniverse(securityPool.universeId(), extraInfo, outcomes);
	}

	// accounts the purchased REP from truthAuction to the vault
	// we should also move a share of bad debt in the system to this vault
	// anyone can call these so that we can liquidate them if needed
	function claimAuctionProceeds(ISecurityPool securityPool, address vault) public {
		require(forkData[securityPool].claimedAuctionProceeds[vault] == false, 'Already Claimed');
		require(forkData[securityPool].truthAuction.finalized(), 'Auction needs to be finalized');
		forkData[securityPool].claimedAuctionProceeds[vault] = true;
		uint256 amount = forkData[securityPool].truthAuction.purchasedRep(vault);
		require(amount > 0, 'Did not purchase anything'); // not really necessary, but good for testing
		uint256 poolOwnershipAmount = repToPoolOwnership(securityPool, amount);
		(uint256 poolOwnership,,,,) = securityPool.securityVaults(vault);
		securityPool.setVaultOwnership(vault, poolOwnership + poolOwnershipAmount, forkData[securityPool].auctionedSecurityBondAllowance * amount / forkData[securityPool].truthAuction.totalRepPurchased());
		emit ClaimAuctionProceeds(vault, amount, poolOwnershipAmount, securityPool.poolOwnershipDenominator());
	}

	function getMarketOutcome(ISecurityPool securityPool) external returns (YesNoMarkets.Outcome outcome){
		SystemState systemState = securityPool.systemState();
		if (systemState == SystemState.PoolForked) return YesNoMarkets.Outcome.None;
		ISecurityPool parent = securityPool.parent();
		if (address(parent) != address(0x0)) {
			if (forkData[parent].ownFork) return YesNoMarkets.Outcome(forkData[securityPool].outcomeIndex);
		}
		if (systemState == SystemState.Operational) {
			EscalationGame escalationGame = securityPool.escalationGame();
			uint256 forkTime = zoltar.getForkTime(securityPool.universeId());
			if (address(escalationGame) != address(0x0)) {
				uint256 escalationEndDate = escalationGame.getEscalationGameEndDate();
				if (block.timestamp > escalationEndDate && (forkTime == 0 || escalationEndDate < forkTime)) return escalationGame.getMarketResolution();
			}
		}
		return YesNoMarkets.Outcome.None;
	}
}
