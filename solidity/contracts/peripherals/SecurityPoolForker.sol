// SPDX-License-Identifier: UNLICENSED
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
}

contract SecurityPoolForker is ISecurityPoolForker {
	Zoltar public immutable zoltar;
	ISecurityPoolFactory public immutable securityPoolFactory;
	mapping(ISecurityPool => ForkData) public forkData;
	YesNoMarkets public yesNoMarkets;

	event ForkSecurityPool(uint256 repAtFork);
	event MigrateVault(address vault, uint8 outcome, uint256 poolOwnership, uint256 securityBondAllowance);
	event TruthAuctionStarted(uint256 completeSetCollateralAmount, uint256 repMigrated, uint256 repAtFork);
	event TruthAuctionFinalized();
	event ClaimAuctionProceeds(address vault, uint256 amount, uint256 poolOwnershipAmount, uint256 poolOwnershipDenominator);
	event MigrateRepFromParent(address vault, uint256 parentSecurityBondAllowance, uint256 parentpoolOwnership);
	event FinalizeAuction(uint256 repAvailable, uint256 migratedRep, uint256 repPurchased, uint256 poolOwnershipDenominator);

	function repToPoolOwnership(ISecurityPool securityPool, uint256 repAmount) public view returns (uint256) {
		if (securityPool.poolOwnershipDenominator() == 0) return repAmount * SecurityPoolUtils.PRICE_PRECISION;
		return repAmount * securityPool.poolOwnershipDenominator() / securityPool.repToken().balanceOf(address(this));
	}

	function poolOwnershipToRep(ISecurityPool securityPool, uint256 poolOwnership) public view returns (uint256) {
		return poolOwnership * securityPool.repToken().balanceOf(address(this)) / securityPool.poolOwnershipDenominator();
	}

	function sharesToCash(ISecurityPool securityPool, uint256 completeSetAmount) public view returns (uint256) {
		return completeSetAmount * securityPool.completeSetCollateralAmount() / securityPool.shareTokenSupply();
	}

	function cashToShares(ISecurityPool securityPool, uint256 eth) public view returns (uint256) {
		return securityPool.completeSetCollateralAmount() == 0 ? (eth * SecurityPoolUtils.PRICE_PRECISION) : (eth * securityPool.shareTokenSupply() / securityPool.completeSetCollateralAmount());
	}

	constructor(Zoltar _zoltar, ISecurityPoolFactory _securityPoolFactory, YesNoMarkets _yesNoMarkets) {
		zoltar = _zoltar;
		securityPoolFactory = _securityPoolFactory;
		yesNoMarkets = _yesNoMarkets;
	}

	function forkSecurityPool(ISecurityPool securityPool) public {
		require(zoltar.getForkTime(securityPool.universeId()) > 0, 'Zoltar needs to have forked before Security Pool can do so');
		require(securityPool.systemState() == SystemState.Operational, 'System is not operational');
		require(securityPool.escalationGame().getMarketResolution() != YesNoMarkets.Outcome.None, 'question has been finalized already');
		securityPool.setSystemState(SystemState.PoolForked);
		securityPool.updateCollateralAmount();
		securityPool.setRetentionRate(0);
		forkData[securityPool].repAtFork = securityPool.repToken().balanceOf(address(this));
		emit ForkSecurityPool(forkData[securityPool].repAtFork);

		string[] memory categories = zoltar.getQuestionCategories(securityPool.universeId());

		uint8[] memory outcomeIndices = new uint8[](categories.length + 1);
		for (uint8 index = 0; index < outcomeIndices.length; index++) {
			outcomeIndices[index] = index;
		}
		zoltar.splitRep(securityPool.universeId(), outcomeIndices);
		// TODO: we could pay the caller basefee*2 out of Open interest. We have to reward caller
	}

	function ensureChildUniverse(ISecurityPool securityPool, uint8 outcomeIndex) public {
		if (address(forkData[securityPool].children[outcomeIndex]) != address(0x0)) return
		require(securityPool.systemState() == SystemState.PoolForked, 'Pool needs to have forked');
		require(block.timestamp <= zoltar.getForkTime(securityPool.universeId()) + SecurityPoolUtils.MIGRATION_TIME , 'migration time passed');
		// first vault migrater creates new pool and transfers all REP to it
		uint248 childUniverseId = uint248(uint256(keccak256(abi.encode(securityPool.universeId(), outcomeIndex))));
		uint256 retentionRate = SecurityPoolUtils.calculateRetentionRate(securityPool.completeSetCollateralAmount(), securityPool.totalSecurityBondAllowance());
		forkData[securityPool].children[outcomeIndex] = securityPoolFactory.deployChildSecurityPool(securityPool.shareToken(), childUniverseId, securityPool.marketId(), securityPool.securityMultiplier(), retentionRate, securityPool.priceOracleManagerAndOperatorQueuer().lastPrice(), 0);
		securityPool.shareToken().authorize(forkData[securityPool].children[outcomeIndex]); //TODO, need to grant acess
		ReputationToken childReputationToken = forkData[securityPool].children[outcomeIndex].repToken();
		childReputationToken.transfer(address(forkData[securityPool].children[outcomeIndex]), childReputationToken.balanceOf(address(this)));
	}

	// migrates vault into outcome universe after fork
	function migrateVault(ISecurityPool securityPool, uint8 outcomeIndex) public { // called on parent
		securityPool.updateVaultFees(msg.sender);
		ensureChildUniverse(securityPool, outcomeIndex);
		ISecurityPool child = forkData[securityPool].children[outcomeIndex];
		{
			child.updateVaultFees(msg.sender);
			securityPool.updateCollateralAmount();
			(uint256 parentPoolOwnership, uint256 parentSecurityBondAllowance,,,) = securityPool.securityVaults(msg.sender);
			emit MigrateRepFromParent(msg.sender, parentSecurityBondAllowance, parentPoolOwnership);
			child.setVaultSecurityBondAllowance(msg.sender, parentSecurityBondAllowance);
			child.addToTotalSecurityBondAllowance(parentSecurityBondAllowance);
			child.setPoolOwnershipDenominator(forkData[securityPool].repAtFork * SecurityPoolUtils.PRICE_PRECISION);

			if (!(securityPool.poolOwnershipDenominator() == 0 && child.repToken().balanceOf(address(this)) == 0)) {
				uint256 ownership = repToPoolOwnership(child, parentPoolOwnership * forkData[securityPool].repAtFork / securityPool.poolOwnershipDenominator());
				child.setVaultPoolOwnership(msg.sender, ownership);
				forkData[child].migratedRep += poolOwnershipToRep(child, ownership);
				child.setVaultFeeIndex(msg.sender, child.feeIndex());
			}
		}

		(uint256 poolOwnership, uint256 securityBondAllowance,,,) = securityPool.securityVaults(msg.sender);
		emit MigrateVault(msg.sender, outcomeIndex, poolOwnership, securityBondAllowance);
		// migrate open interest
		if (securityPool.poolOwnershipDenominator() > 0 && poolOwnership > 0) {
			(bool sent, ) = payable(child).call{ value: securityPool.completeSetCollateralAmount() * poolOwnership / securityPool.poolOwnershipDenominator() }('');
			require(sent, 'Failed to send Ether');
		}
		securityPool.setVaultOwnership(msg.sender, 0,0);
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
		if (repAvailable > 0) {
			securityPool.setPoolOwnershipDenominator(forkData[securityPool].migratedRep * repAvailable * SecurityPoolUtils.PRICE_PRECISION / (repAvailable - repPurchased));
		}
		uint256 parentTotalSecurityBondAllowance = parent.totalSecurityBondAllowance();
		forkData[securityPool].auctionedSecurityBondAllowance = parentTotalSecurityBondAllowance - securityPool.totalSecurityBondAllowance();
		securityPool.setTotalSecurityBondAllowance(parentTotalSecurityBondAllowance);
		if (securityPool.poolOwnershipDenominator() == 0) {
			securityPool.setPoolOwnershipDenominator(repAvailable * SecurityPoolUtils.PRICE_PRECISION);
		}
		emit FinalizeAuction(repAvailable, forkData[securityPool].migratedRep, repPurchased, securityPool.poolOwnershipDenominator());
		securityPool.updateRetentionRate();
	}

	function finalizeTruthAuction(ISecurityPool securityPool) public {
		require(block.timestamp > forkData[securityPool].truthAuctionStarted + SecurityPoolUtils.AUCTION_TIME, 'truthAuction still ongoing');
		_finalizeTruthAuction(securityPool, forkData[securityPool].truthAuction.totalRepPurchased());
	}

	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) public {
		require(!securityPool.escalationGame().hasForked(), 'escalation game has not triggered fork');
		(string memory extraInfo, string[] memory outcomes) = yesNoMarkets.getForkingData(securityPool.marketId());
		zoltar.forkUniverse(securityPool.universeId(), extraInfo, outcomes);
	}

	receive() external payable {
		// needed for Truth Auction to send ETH back
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
}
