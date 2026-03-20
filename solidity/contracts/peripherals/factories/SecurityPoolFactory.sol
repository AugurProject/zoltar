// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;
import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { SecurityPool } from '../SecurityPool.sol';
import { ISecurityPool, ISecurityPoolFactory } from '../interfaces/ISecurityPool.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { ShareTokenFactory } from './ShareTokenFactory.sol';
import { DualCapBatchAuctionFactory } from './DualCapBatchAuctionFactory.sol';
import { DualCapBatchAuction } from '../DualCapBatchAuction.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { PriceOracleManagerAndOperatorQueuerFactory } from './PriceOracleManagerAndOperatorQueuerFactory.sol';
import { PriceOracleManagerAndOperatorQueuer } from '../PriceOracleManagerAndOperatorQueuer.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { ISecurityPoolForker } from '../interfaces/ISecurityPoolForker.sol';

contract SecurityPoolFactory is ISecurityPoolFactory {
	ShareTokenFactory shareTokenFactory;
	DualCapBatchAuctionFactory dualCapBatchAuctionFactory;
	PriceOracleManagerAndOperatorQueuerFactory priceOracleManagerAndOperatorQueuerFactory;
	Zoltar zoltar;
	OpenOracle openOracle;
	EscalationGameFactory escalationGameFactory;
	ZoltarQuestionData questionData;
	ISecurityPoolForker securityPoolForker;

	event DeploySecurityPool(ISecurityPool securityPool, DualCapBatchAuction truthAuction, PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer, IShareToken shareToken, ISecurityPool parent, uint248 universeId, uint256 marketId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount);

	constructor(ISecurityPoolForker _securityPoolForker, ZoltarQuestionData _questionData, EscalationGameFactory _escalationGameFactory, OpenOracle _openOracle, Zoltar _zoltar, ShareTokenFactory _shareTokenFactory, DualCapBatchAuctionFactory _dualCapBatchAuctionFactory, PriceOracleManagerAndOperatorQueuerFactory _priceOracleManagerAndOperatorQueuerFactory) {
		securityPoolForker = _securityPoolForker;
		shareTokenFactory = _shareTokenFactory;
		dualCapBatchAuctionFactory = _dualCapBatchAuctionFactory;
		priceOracleManagerAndOperatorQueuerFactory = _priceOracleManagerAndOperatorQueuerFactory;
		zoltar = _zoltar;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		questionData = _questionData;
	}

	function deployChildSecurityPool(ISecurityPool parent, IShareToken shareToken, uint248 universeId, uint256 marketId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPool, DualCapBatchAuction truthAuction) {
		require(msg.sender == address(securityPoolForker), 'only securityPoolForker');
		bytes32 securityPoolSalt = keccak256(abi.encode(parent, universeId, marketId, securityMultiplier));
		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, securityPoolSalt);

		truthAuction = dualCapBatchAuctionFactory.deployDualCapBatchAuction(address(securityPoolForker), securityPoolSalt);

		securityPool = new SecurityPool{ salt: bytes32(uint256(0x0)) }(address(securityPoolForker), this, questionData, escalationGameFactory, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, parent, zoltar, universeId, marketId, securityMultiplier);

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		securityPool.setStartingParams(currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);

		emit DeploySecurityPool(securityPool, truthAuction, priceOracleManagerAndOperatorQueuer, shareToken, parent, universeId, marketId, securityMultiplier, currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
	}

	function deployOriginSecurityPool(uint248 universeId, string memory extraInfo, uint256 marketEndDate, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice) external returns (ISecurityPool securityPool) {
		ZoltarQuestionData.QuestionData memory qd = ZoltarQuestionData.QuestionData({
			title: extraInfo,
			description: '',
			startTime: 0,
			endTime: marketEndDate,
			numTicks: 0,
			displayValueMin: 0,
			displayValueMax: 0,
			answerUnit: ''
		});
		string[] memory outcomes = new string[](2);
		outcomes[0] = 'Yes';
		outcomes[1] = 'No';
		uint256 questionId = questionData.createQuestion(qd, outcomes);
		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		bytes32 securityPoolSalt = keccak256(abi.encode(address(0x0), universeId, questionId, securityMultiplier));
		PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, securityPoolSalt);

		// sharetoken has different salt as sharetoken address does not change in forks
		bytes32 shareTokenSalt = keccak256(abi.encode(securityMultiplier, questionId));
		IShareToken shareToken = shareTokenFactory.deployShareToken(shareTokenSalt);

		securityPool = new SecurityPool{ salt: bytes32(uint256(0x0)) }(address(securityPoolForker), this, questionData, escalationGameFactory, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, ISecurityPool(payable(0x0)), zoltar, universeId, questionId, securityMultiplier);

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		securityPool.setStartingParams(currentRetentionRate, startingRepEthPrice, 0);

		shareToken.authorize(securityPool);

		emit DeploySecurityPool(securityPool, DualCapBatchAuction(address(0x0)), priceOracleManagerAndOperatorQueuer, shareToken, ISecurityPool(payable(0x0)), universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, 0);
	}
}
