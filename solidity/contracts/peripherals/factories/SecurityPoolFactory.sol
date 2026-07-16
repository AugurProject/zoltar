// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
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
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { ISecurityPoolForker } from '../interfaces/ISecurityPoolForker.sol';
import { SecurityPoolDeployer } from './SecurityPoolDeployer.sol';
import { SecurityPoolUtils } from '../SecurityPoolUtils.sol';

contract SecurityPoolFactory is ISecurityPoolFactory {
	ShareTokenFactory immutable shareTokenFactory;
	UniformPriceDualCapBatchAuctionFactory immutable uniformPriceDualCapBatchAuctionFactory;
	PriceOracleManagerAndOperatorQueuerFactory immutable priceOracleManagerAndOperatorQueuerFactory;
	Zoltar immutable zoltar;
	OpenOracle immutable openOracle;
	EscalationGameFactory immutable escalationGameFactory;
	ZoltarQuestionData immutable questionData;
	ISecurityPoolForker immutable securityPoolForker;
	SecurityPoolDeployer immutable securityPoolDeployer;
	uint256 public immutable initialEscalationGameDeposit;
	SecurityPoolDeployment[] private securityPoolDeployments;

	event DeploySecurityPool(
		ISecurityPool indexed securityPool,
		UniformPriceDualCapBatchAuction truthAuction,
		OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer,
		IShareToken shareToken,
		ISecurityPool indexed parent,
		uint248 indexed universeId,
		uint256 questionId,
		uint256 securityMultiplier,
		uint256 currentRetentionRate,
		uint256 completeSetCollateralAmount
	);

	constructor(
		ISecurityPoolForker _securityPoolForker,
		ZoltarQuestionData _questionData,
		EscalationGameFactory _escalationGameFactory,
		OpenOracle _openOracle,
		Zoltar _zoltar,
		ShareTokenFactory _shareTokenFactory,
		UniformPriceDualCapBatchAuctionFactory _uniformPriceDualCapBatchAuctionFactory,
		PriceOracleManagerAndOperatorQueuerFactory _priceOracleManagerAndOperatorQueuerFactory,
		uint256 _initialEscalationGameDeposit
	) {
		require(_initialEscalationGameDeposit > 0, 'Initial escalation game deposit must be greater than zero');
		securityPoolForker = _securityPoolForker;
		shareTokenFactory = _shareTokenFactory;
		uniformPriceDualCapBatchAuctionFactory = _uniformPriceDualCapBatchAuctionFactory;
		priceOracleManagerAndOperatorQueuerFactory = _priceOracleManagerAndOperatorQueuerFactory;
		zoltar = _zoltar;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		questionData = _questionData;
		initialEscalationGameDeposit = _initialEscalationGameDeposit;
		securityPoolDeployer = new SecurityPoolDeployer();
	}

	function securityPoolDeploymentCount() external view returns (uint256) {
		return securityPoolDeployments.length;
	}

	function securityPoolDeploymentsRange(
		uint256 startIndex,
		uint256 count
	) external view returns (SecurityPoolDeployment[] memory deployments) {
		require(
			startIndex <= securityPoolDeployments.length,
			'Security pool deployment range start index is out of bounds'
		);
		require(
			count <= securityPoolDeployments.length - startIndex,
			'Security pool deployment range count exceeds available entries'
		);
		deployments = new SecurityPoolDeployment[](count);
		for (uint256 index = 0; index < count; index++) {
			deployments[index] = securityPoolDeployments[startIndex + index];
		}
	}

	function deployChildSecurityPool(
		ISecurityPool parent,
		IShareToken shareToken,
		uint248 universeId,
		uint256 questionId,
		uint256 securityMultiplier,
		uint256 currentRetentionRate,
		uint256 completeSetCollateralAmount
	) external returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction) {
		require(msg.sender == address(securityPoolForker), 'Only the security pool forker can deploy child pools');
		bytes32 securityPoolSalt = keccak256(abi.encode(parent, universeId, questionId, securityMultiplier));
		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory
			.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, securityPoolSalt);

		truthAuction = uniformPriceDualCapBatchAuctionFactory.deployUniformPriceDualCapBatchAuction(
			address(securityPoolForker),
			securityPoolSalt
		);
		securityPool = deploySecurityPool(
			shareToken,
			parent,
			priceOracleManagerAndOperatorQueuer,
			universeId,
			questionId,
			securityMultiplier,
			currentRetentionRate,
			completeSetCollateralAmount,
			address(truthAuction)
		);
		_recordSecurityPoolDeployment(
			SecurityPoolDeployment(
				securityPool,
				truthAuction,
				priceOracleManagerAndOperatorQueuer,
				shareToken,
				parent,
				universeId,
				questionId,
				securityMultiplier,
				currentRetentionRate,
				completeSetCollateralAmount
			)
		);
	}

	function deployOriginSecurityPool(
		uint248 universeId,
		uint256 questionId,
		uint256 securityMultiplier
	) external returns (ISecurityPool securityPool) {
		// Origin pool deployment is intentionally public, so first deployers must not be able to
		// lock unsafe economic parameters into the canonical pool for a question/multiplier pair.
		// Zero-utilization origin pools always start at the protocol retention curve's maximum rate.
		require(securityMultiplier > 1, 'Security multiplier must be greater than one');

		// Validate that the question exists
		require(
			questionData.questionCreatedTimestamp(questionId) > 0,
			'Security pool question must exist before deployment'
		);

		// Validate that it's a yes-no question (exactly 2 outcomes: Yes and No)
		string[] memory outcomes = questionData.getOutcomeLabels(questionId, 0, 3);
		require(outcomes.length == 2, 'Security pool question must have exactly two outcomes');
		require(keccak256(bytes(outcomes[0])) == keccak256(bytes('Yes')), 'Security pool first outcome must be Yes');
		require(keccak256(bytes(outcomes[1])) == keccak256(bytes('No')), 'Security pool second outcome must be No');
		require(zoltar.getForkTime(universeId) == 0, 'Security pool universe has already forked');

		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		require(address(reputationToken) != address(0x0), 'Security pool universe is missing a REP token');
		bytes32 securityPoolSalt = keccak256(abi.encode(address(0x0), universeId, questionId, securityMultiplier));
		OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory
			.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, securityPoolSalt);

		// sharetoken has different salt as sharetoken address does not change in forks
		bytes32 shareTokenSalt = keccak256(abi.encode(securityMultiplier, questionId));
		IShareToken shareToken = shareTokenFactory.deployShareToken(shareTokenSalt, questionId);
		uint256 initialRetentionRate = SecurityPoolUtils.calculateRetentionRate(0, 0);
		securityPool = deploySecurityPool(
			shareToken,
			ISecurityPool(payable(address(0))),
			priceOracleManagerAndOperatorQueuer,
			universeId,
			questionId,
			securityMultiplier,
			initialRetentionRate,
			0,
			address(0)
		);

		shareToken.authorize(securityPool);
		_recordSecurityPoolDeployment(
			SecurityPoolDeployment(
				securityPool,
				UniformPriceDualCapBatchAuction(address(0)),
				priceOracleManagerAndOperatorQueuer,
				shareToken,
				ISecurityPool(payable(address(0))),
				universeId,
				questionId,
				securityMultiplier,
				initialRetentionRate,
				0
			)
		);
	}

	function _recordSecurityPoolDeployment(SecurityPoolDeployment memory deployment) private {
		securityPoolDeployments.push(deployment);
		emit DeploySecurityPool(
			deployment.securityPool,
			deployment.truthAuction,
			deployment.priceOracleManagerAndOperatorQueuer,
			deployment.shareToken,
			deployment.parent,
			deployment.universeId,
			deployment.questionId,
			deployment.securityMultiplier,
			deployment.currentRetentionRate,
			deployment.completeSetCollateralAmount
		);
	}

	function deploySecurityPool(
		IShareToken shareToken,
		ISecurityPool parent,
		OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer,
		uint248 universeId,
		uint256 questionId,
		uint256 securityMultiplier,
		uint256 currentRetentionRate,
		uint256 completeSetCollateralAmount,
		address truthAuction
	) private returns (ISecurityPool securityPool) {
		securityPool = securityPoolDeployer.deploy(
			address(securityPoolForker),
			questionData,
			escalationGameFactory,
			priceOracleManagerAndOperatorQueuer,
			shareToken,
			openOracle,
			parent,
			zoltar,
			universeId,
			questionId,
			securityMultiplier,
			initialEscalationGameDeposit,
			truthAuction
		);

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		securityPool.setStartingParams(currentRetentionRate, completeSetCollateralAmount);
	}
}
