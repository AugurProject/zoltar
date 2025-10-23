// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;
import { IShareToken } from './interfaces/IShareToken.sol';
import { SecurityPool } from './SecurityPool.sol';
import { ISecurityPool, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { Zoltar } from '../Zoltar.sol';
import { ShareTokenFactory } from './ShareTokenFactory.sol';
import { AuctionFactory } from './AuctionFactory.sol';
import { Auction } from './Auction.sol';
import { ShareToken } from './tokens/ShareToken.sol';
import { PriceOracleManagerAndOperatorQueuerFactory } from './PriceOracleManagerAndOperatorQueuerFactory.sol';
import { PriceOracleManagerAndOperatorQueuer } from './PriceOracleManagerAndOperatorQueuer.sol';
import { ReputationToken } from '../ReputationToken.sol';

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

	function deployChildSecurityPool(IShareToken shareToken, ISecurityPool parent, uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPool) {
		bytes32 salt = keccak256(abi.encodePacked(shareToken, parent, universeId, questionId, securityMultiplier));
		(ReputationToken reputationToken,,) = zoltar.universes(universeId);
		PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, salt);

		Auction truthAuction = auctionFactory.deployAuction(salt);

		securityPool = new SecurityPool{ salt: bytes32(uint256(0x1)) }(this, truthAuction, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, parent, zoltar, universeId, questionId, securityMultiplier);
		securityPool.setStartingParams(currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);

		truthAuction.setOwner(address(securityPool));

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		emit DeploySecurityPool(securityPool, truthAuction, priceOracleManagerAndOperatorQueuer, shareToken, parent, universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
	}

	function deployOriginSecurityPool(uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPool) {
		bytes32 salt = keccak256(abi.encodePacked(address(0x0), address(0x0), universeId, questionId, securityMultiplier));
		(ReputationToken reputationToken,,) = zoltar.universes(universeId);
		PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, salt);

		IShareToken shareToken = shareTokenFactory.deployShareToken(salt);

		securityPool = new SecurityPool{ salt: bytes32(uint256(0x1)) }(this, Auction(address(0x0)), priceOracleManagerAndOperatorQueuer, shareToken, openOracle, ISecurityPool(payable(0x0)), zoltar, universeId, questionId, securityMultiplier);
		securityPool.setStartingParams(currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);

		shareToken.authorize(securityPool);

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		emit DeploySecurityPool(securityPool, Auction(address(0x0)), priceOracleManagerAndOperatorQueuer, shareToken, ISecurityPool(payable(0x0)), universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
	}
}
