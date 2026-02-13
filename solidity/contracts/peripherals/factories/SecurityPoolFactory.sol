// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;
import { SecurityPool } from '../SecurityPool.sol';
import { ISecurityPool, ISecurityPoolFactory } from '../interfaces/ISecurityPool.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { ShareTokenFactory } from './ShareTokenFactory.sol';
import { AuctionFactory } from './AuctionFactory.sol';
import { Auction } from '../Auction.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { PriceOracleManagerAndOperatorQueuerFactory } from './PriceOracleManagerAndOperatorQueuerFactory.sol';
import { PriceOracleManagerAndOperatorQueuer } from '../PriceOracleManagerAndOperatorQueuer.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { YesNoMarkets } from '../YesNoMarkets.sol';
import { ISecurityPoolForker } from '../interfaces/ISecurityPoolForker.sol';

contract SecurityPoolFactory is ISecurityPoolFactory {
	ShareTokenFactory shareTokenFactory;
	AuctionFactory auctionFactory;
	PriceOracleManagerAndOperatorQueuerFactory priceOracleManagerAndOperatorQueuerFactory;
	Zoltar zoltar;
	OpenOracle openOracle;
	EscalationGameFactory escalationGameFactory;
	YesNoMarkets yesNoMarkets;
	ISecurityPoolForker securityPoolForker;

	event DeploySecurityPool(ISecurityPool securityPool, Auction truthAuction, PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer, IShareToken shareToken, ISecurityPool parent, uint248 universeId, uint256 marketId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount);

	constructor(ISecurityPoolForker _securityPoolForker, YesNoMarkets _yesNoMarkets, EscalationGameFactory _escalationGameFactory, OpenOracle _openOracle, Zoltar _zoltar, ShareTokenFactory _shareTokenFactory, AuctionFactory _auctionFactory, PriceOracleManagerAndOperatorQueuerFactory _priceOracleManagerAndOperatorQueuerFactory) {
		securityPoolForker  = _securityPoolForker;
		shareTokenFactory = _shareTokenFactory;
		auctionFactory = _auctionFactory;
		priceOracleManagerAndOperatorQueuerFactory = _priceOracleManagerAndOperatorQueuerFactory;
		zoltar = _zoltar;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		yesNoMarkets = _yesNoMarkets;
	}

	function deployChildSecurityPool(ISecurityPool parent, IShareToken shareToken, uint248 universeId, uint256 marketId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPool, Auction truthAuction) {
		require(msg.sender === address(securityPoolForker), 'only securityPoolForker')
		bytes32 securityPoolSalt = keccak256(abi.encode(parent, universeId, marketId, securityMultiplier));
		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, securityPoolSalt);

		truthAuction = auctionFactory.deployAuction(securityPoolSalt);

		securityPool = new SecurityPool{ salt: bytes32(uint256(0x0)) }(address(securityPoolForker), this, yesNoMarkets, escalationGameFactory, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, parent, zoltar, universeId, marketId, securityMultiplier);

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		securityPool.setStartingParams(currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);

		truthAuction.setOwner(address(securityPoolForker));
		emit DeploySecurityPool(securityPool, truthAuction, priceOracleManagerAndOperatorQueuer, shareToken, parent, universeId, marketId, securityMultiplier, currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
	}

	function deployOriginSecurityPool(uint248 universeId, string memory extraInfo, uint256 marketEndDate, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice) external returns (ISecurityPool securityPool) {
		uint256 marketId = yesNoMarkets.createMarket(extraInfo, marketEndDate, keccak256(abi.encode(address(this), universeId, securityMultiplier, extraInfo, marketEndDate)));
		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		bytes32 securityPoolSalt = keccak256(abi.encode(address(0x0), universeId, marketId, securityMultiplier));
		PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, securityPoolSalt);

		// sharetoken has different salt as sharetoken address does not change in forks
		bytes32 shareTokenSalt = keccak256(abi.encode(securityMultiplier, marketId));
		IShareToken shareToken = shareTokenFactory.deployShareToken(shareTokenSalt);

		securityPool = new SecurityPool{ salt: bytes32(uint256(0x0)) }(address(securityPoolForker), this, yesNoMarkets, escalationGameFactory, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, ISecurityPool(payable(0x0)), zoltar, universeId, marketId, securityMultiplier);

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		securityPool.setStartingParams(currentRetentionRate, startingRepEthPrice, 0);

		shareToken.authorize(securityPool);

		emit DeploySecurityPool(securityPool, Auction(address(0x0)), priceOracleManagerAndOperatorQueuer, shareToken, ISecurityPool(payable(0x0)), universeId, marketId, securityMultiplier, currentRetentionRate, startingRepEthPrice, 0);
	}
}
