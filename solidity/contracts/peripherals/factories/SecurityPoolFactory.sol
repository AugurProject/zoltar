// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;
import { IShareToken } from '../interfaces/IShareToken.sol';
import { SecurityPool } from '../SecurityPool.sol';
import { ISecurityPool, ISecurityPoolFactory } from '../interfaces/ISecurityPool.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { ShareTokenFactory } from './ShareTokenFactory.sol';
import { AuctionFactory } from './AuctionFactory.sol';
import { Auction } from '../Auction.sol';
import { ShareToken } from '../tokens/ShareToken.sol';
import { PriceOracleManagerAndOperatorQueuerFactory } from './PriceOracleManagerAndOperatorQueuerFactory.sol';
import { PriceOracleManagerAndOperatorQueuer } from '../PriceOracleManagerAndOperatorQueuer.sol';
import { ReputationToken } from '../../ReputationToken.sol';

contract SecurityPoolFactory is ISecurityPoolFactory {
	ShareTokenFactory shareTokenFactory;
	AuctionFactory auctionFactory;
	PriceOracleManagerAndOperatorQueuerFactory priceOracleManagerAndOperatorQueuerFactory;
	Zoltar zoltar;
	OpenOracle openOracle;

	event DeploySecurityPool(ISecurityPool securityPool, Auction truthAuction, PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer, IShareToken shareToken, ISecurityPool parent, uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount);

	constructor(OpenOracle _openOracle, Zoltar _zoltar, ShareTokenFactory _shareTokenFactory, AuctionFactory _auctionFactory, PriceOracleManagerAndOperatorQueuerFactory _priceOracleManagerAndOperatorQueuerFactory) {
		shareTokenFactory = _shareTokenFactory;
		auctionFactory = _auctionFactory;
		priceOracleManagerAndOperatorQueuerFactory = _priceOracleManagerAndOperatorQueuerFactory;
		zoltar = _zoltar;
		openOracle = _openOracle;
	}

	function deployChildSecurityPool(IShareToken shareToken, uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPool) {
		ISecurityPool parent = ISecurityPool(payable(msg.sender));
		bytes32 securityPoolSalt = keccak256(abi.encodePacked(parent, universeId, questionId, securityMultiplier));
		(ReputationToken reputationToken,,) = zoltar.universes(universeId);
		PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, securityPoolSalt);

		Auction truthAuction = auctionFactory.deployAuction(securityPoolSalt);

		securityPool = new SecurityPool{ salt: bytes32(uint256(0x0)) }(this, truthAuction, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, parent, zoltar, universeId, questionId, securityMultiplier);

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		securityPool.setStartingParams(currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);

		truthAuction.setOwner(address(securityPool));
		emit DeploySecurityPool(securityPool, truthAuction, priceOracleManagerAndOperatorQueuer, shareToken, parent, universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
	}

	function deployOriginSecurityPool(uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPool) {
		bytes32 securityPoolSalt = keccak256(abi.encodePacked(address(0x0), universeId, questionId, securityMultiplier));
		(ReputationToken reputationToken,,) = zoltar.universes(universeId);
		PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, securityPoolSalt);

		// sharetoken has different salt as sharetoken address does not change in forks
		bytes32 shareTokenSalt = keccak256(abi.encodePacked(securityMultiplier));
		IShareToken shareToken = shareTokenFactory.deployShareToken(questionId, shareTokenSalt);

		securityPool = new SecurityPool{ salt: bytes32(uint256(0x0)) }(this, Auction(address(0x0)), priceOracleManagerAndOperatorQueuer, shareToken, openOracle, ISecurityPool(payable(0x0)), zoltar, universeId, questionId, securityMultiplier);

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		securityPool.setStartingParams(currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);

		shareToken.authorize(securityPool);

		emit DeploySecurityPool(securityPool, Auction(address(0x0)), priceOracleManagerAndOperatorQueuer, shareToken, ISecurityPool(payable(0x0)), universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
	}
}
