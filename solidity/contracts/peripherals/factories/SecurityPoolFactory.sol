// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;
import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { SecurityPool } from '../SecurityPool.sol';
import { ISecurityPool, ISecurityPoolFactory } from '../interfaces/ISecurityPool.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { ShareTokenFactory } from './ShareTokenFactory.sol';
import { UniformPriceDualCapBatchAuctionFactory } from './UniformPriceDualCapBatchAuctionFactory.sol';
import { UniformPriceDualCapBatchAuction } from '../UniformPriceDualCapBatchAuction.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { PriceOracleManagerAndOperatorQueuerFactory } from './PriceOracleManagerAndOperatorQueuerFactory.sol';
import { PriceOracleManagerAndOperatorQueuer } from '../PriceOracleManagerAndOperatorQueuer.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { ISecurityPoolForker } from '../interfaces/ISecurityPoolForker.sol';

contract SecurityPoolFactory is ISecurityPoolFactory {
	ShareTokenFactory shareTokenFactory;
	UniformPriceDualCapBatchAuctionFactory uniformPriceDualCapBatchAuctionFactory;
	PriceOracleManagerAndOperatorQueuerFactory priceOracleManagerAndOperatorQueuerFactory;
	Zoltar zoltar;
	OpenOracle openOracle;
	EscalationGameFactory escalationGameFactory;
	ZoltarQuestionData questionData;
	ISecurityPoolForker securityPoolForker;
	SecurityPoolDeployment[] private securityPoolDeployments;

	event DeploySecurityPool(ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction, PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer, IShareToken shareToken, ISecurityPool parent, uint248 universeId, uint256 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount);

	constructor(ISecurityPoolForker _securityPoolForker, ZoltarQuestionData _questionData, EscalationGameFactory _escalationGameFactory, OpenOracle _openOracle, Zoltar _zoltar, ShareTokenFactory _shareTokenFactory, UniformPriceDualCapBatchAuctionFactory _uniformPriceDualCapBatchAuctionFactory, PriceOracleManagerAndOperatorQueuerFactory _priceOracleManagerAndOperatorQueuerFactory) {
		securityPoolForker = _securityPoolForker;
		shareTokenFactory = _shareTokenFactory;
		uniformPriceDualCapBatchAuctionFactory = _uniformPriceDualCapBatchAuctionFactory;
		priceOracleManagerAndOperatorQueuerFactory = _priceOracleManagerAndOperatorQueuerFactory;
		zoltar = _zoltar;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		questionData = _questionData;
	}

	function securityPoolDeploymentCount() external view returns (uint256) {
		return securityPoolDeployments.length;
	}

	function securityPoolDeploymentAt(uint256 index) external view returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction, PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer, IShareToken shareToken, ISecurityPool parent, uint248 universeId, uint256 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) {
		SecurityPoolDeployment memory deployment = securityPoolDeployments[index];
		return (deployment.securityPool, deployment.truthAuction, deployment.priceOracleManagerAndOperatorQueuer, deployment.shareToken, deployment.parent, deployment.universeId, deployment.questionId, deployment.securityMultiplier, deployment.currentRetentionRate, deployment.startingRepEthPrice, deployment.completeSetCollateralAmount);
	}

	function securityPoolDeploymentsRange(uint256 startIndex, uint256 count) external view returns (SecurityPoolDeployment[] memory deployments) {
		require(startIndex <= securityPoolDeployments.length, 'range start out of bounds');
		require(count <= securityPoolDeployments.length - startIndex, 'range end out of bounds');
		deployments = new SecurityPoolDeployment[](count);
		for (uint256 index = 0; index < count; index++) {
			deployments[index] = securityPoolDeployments[startIndex + index];
		}
	}

	function deployChildSecurityPool(ISecurityPool parent, IShareToken shareToken, uint248 universeId, uint256 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction) {
		require(msg.sender == address(securityPoolForker), 'only securityPoolForker');
		bytes32 securityPoolSalt = keccak256(abi.encode(parent, universeId, questionId, securityMultiplier));
		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, securityPoolSalt);

		truthAuction = uniformPriceDualCapBatchAuctionFactory.deployUniformPriceDualCapBatchAuction(address(securityPoolForker), securityPoolSalt);

		securityPool = new SecurityPool{ salt: bytes32(uint256(0x0)) }(address(securityPoolForker), this, questionData, escalationGameFactory, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, parent, zoltar, universeId, questionId, securityMultiplier, address(truthAuction));

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		securityPool.setStartingParams(currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
		securityPoolDeployments.push(SecurityPoolDeployment(securityPool, truthAuction, priceOracleManagerAndOperatorQueuer, shareToken, parent, universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount));

		emit DeploySecurityPool(securityPool, truthAuction, priceOracleManagerAndOperatorQueuer, shareToken, parent, universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
	}

	function deployOriginSecurityPool(uint248 universeId, uint256 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice) external returns (ISecurityPool securityPool) {
		// Validate that the question exists
		require(questionData.questionCreatedTimestamp(questionId) > 0, 'Question does not exist');

		// Validate that it's a yes-no question (exactly 2 outcomes: Yes and No)
		// Fetch up to 3 outcomes to verify exactly 2 exist
		string[] memory outcomes = questionData.getOutcomeLabels(questionId, 0, 3);
		require(keccak256(bytes(outcomes[0])) == keccak256(bytes('Yes')), 'First outcome must be "Yes"');
		require(keccak256(bytes(outcomes[1])) == keccak256(bytes('No')), 'Second outcome must be "No"');
		require(bytes(outcomes[2]).length == 0, 'Question must have exactly 2 outcomes');

		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		bytes32 securityPoolSalt = keccak256(abi.encode(address(0x0), universeId, questionId, securityMultiplier));
		PriceOracleManagerAndOperatorQueuer priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, securityPoolSalt);

		// sharetoken has different salt as sharetoken address does not change in forks
		bytes32 shareTokenSalt = keccak256(abi.encode(securityMultiplier, questionId));
		IShareToken shareToken = shareTokenFactory.deployShareToken(shareTokenSalt, questionId);

		securityPool = new SecurityPool{ salt: bytes32(uint256(0x0)) }(address(securityPoolForker), this, questionData, escalationGameFactory, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, ISecurityPool(payable(0x0)), zoltar, universeId, questionId, securityMultiplier, address(0));

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		securityPool.setStartingParams(currentRetentionRate, startingRepEthPrice, 0);

		shareToken.authorize(securityPool);
		securityPoolDeployments.push(SecurityPoolDeployment(securityPool, UniformPriceDualCapBatchAuction(address(0x0)), priceOracleManagerAndOperatorQueuer, shareToken, ISecurityPool(payable(0x0)), universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, 0));

		emit DeploySecurityPool(securityPool, UniformPriceDualCapBatchAuction(address(0x0)), priceOracleManagerAndOperatorQueuer, shareToken, ISecurityPool(payable(0x0)), universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, 0);
	}
}
