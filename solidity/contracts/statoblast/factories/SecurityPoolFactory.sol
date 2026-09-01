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
	uint256 public immutable initialEscalationGameDepositAttoRep;
	uint256 public immutable override minimumSecurityBondDebtAttoEth;
	uint256 public immutable override minimumVaultRepDepositAttoRep;
	SecurityPoolDeployment[] private securityPoolDeployments;
	mapping(bytes32 => ISecurityPool) private securityPoolsById;
	mapping(bytes32 => bool) private securityPoolIdClaims;
	mapping(ISecurityPool => bytes32) private securityPoolOriginIds;
	mapping(ISecurityPool => bool) private securityPoolHasInheritedForkOutcome;

	event DeploySecurityPool(ISecurityPool indexed securityPool, UniformPriceDualCapBatchAuction truthAuction, OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer, IShareToken shareToken, ISecurityPool indexed parent, uint248 indexed universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas, uint256 currentRetentionRate, uint256 settlementCollateralAttoEth);
	event SecurityPoolRegistered(bytes32 indexed originId, bytes32 indexed poolId, uint248 indexed universeId, ISecurityPool securityPool);

	constructor(ISecurityPoolForker _securityPoolForker, ZoltarQuestionData _questionData, EscalationGameFactory _escalationGameFactory, OpenOracle _openOracle, Zoltar _zoltar, ShareTokenFactory _shareTokenFactory, UniformPriceDualCapBatchAuctionFactory _uniformPriceDualCapBatchAuctionFactory, PriceOracleManagerAndOperatorQueuerFactory _priceOracleManagerAndOperatorQueuerFactory, uint256 _initialEscalationGameDepositAttoRep, uint256 _minimumSecurityBondDebtAttoEth, uint256 _minimumVaultRepDepositAttoRep, address operationsDelegate) {
		require(_initialEscalationGameDepositAttoRep == 1e18, 'Initial deposit must be 1 REP');
		securityPoolForker = _securityPoolForker;
		shareTokenFactory = _shareTokenFactory;
		uniformPriceDualCapBatchAuctionFactory = _uniformPriceDualCapBatchAuctionFactory;
		priceOracleManagerAndOperatorQueuerFactory = _priceOracleManagerAndOperatorQueuerFactory;
		zoltar = _zoltar;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		questionData = _questionData;
		initialEscalationGameDepositAttoRep = _initialEscalationGameDepositAttoRep;
		require(_minimumSecurityBondDebtAttoEth > 0, 'Minimum security bond debt zero');
		minimumSecurityBondDebtAttoEth = _minimumSecurityBondDebtAttoEth;
		minimumVaultRepDepositAttoRep = _minimumVaultRepDepositAttoRep;
		require(operationsDelegate != address(0), 'Operations delegate zero');
		require(operationsDelegate.code.length != 0, 'Operations delegate has no code');
		securityPoolDeployer = new SecurityPoolDeployer(operationsDelegate);
	}

	function securityPoolDeploymentCount() external view returns (uint256) {
		return securityPoolDeployments.length;
	}

	function getSecurityPool(bytes32 originId, uint248 universeId) external view returns (ISecurityPool) {
		return securityPoolsById[getPoolId(originId, universeId)];
	}

	function getSecurityPoolOriginId(ISecurityPool securityPool) external view returns (bytes32) {
		return securityPoolOriginIds[securityPool];
	}

	function getSecurityPoolHasInheritedForkOutcome(ISecurityPool securityPool) external view returns (bool) {
		return securityPoolHasInheritedForkOutcome[securityPool];
	}

	function getOriginId(uint248 originUniverseId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) public pure returns (bytes32) {
		return
			keccak256(abi.encode(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, originUniverseId));
	}

	function getPoolId(bytes32 originId, uint248 universeId) public pure returns (bytes32) {
		return keccak256(abi.encode(originId, universeId));
	}

	function securityPoolDeploymentsRange(uint256 startIndex, uint256 count) external view returns (SecurityPoolDeployment[] memory deployments) {
		require(startIndex <= securityPoolDeployments.length, 'Pool range start out of bounds');
		require(count <= securityPoolDeployments.length - startIndex, 'Pool range count too large');
		deployments = new SecurityPoolDeployment[](count);
		for (uint256 index = 0; index < count; index++) {
			deployments[index] = securityPoolDeployments[startIndex + index];
		}
	}

	function deployChildSecurityPool(ISecurityPool parent, IShareToken shareToken, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 currentRetentionRate, uint256 settlementCollateralAttoEth) external returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction) {
		require(msg.sender == address(securityPoolForker), 'Only security pool forker');
		bytes32 originId = securityPoolOriginIds[parent];
		require(address(securityPoolsById[getPoolId(originId, parent.universeId())]) == address(parent), 'Parent pool is not canonical');
		bool hasInheritedForkOutcome =
			securityPoolHasInheritedForkOutcome[parent] || zoltar.forkQuestionMatches(parent.universeId(), questionId);
		require(address(parent.shareToken()) == address(shareToken), 'Child share token mismatch');
		uint256 initialReportPriorityFeeAttoEthPerGas = parent.priceOracleManagerAndOperatorQueuer().initialReportPriorityFeeAttoEthPerGas();
		_reserveSecurityPool(originId, universeId);
		bytes32 securityPoolSalt = keccak256(abi.encode(parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas));
		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, initialReportPriorityFeeAttoEthPerGas, securityPoolSalt);

		truthAuction = uniformPriceDualCapBatchAuctionFactory.deployUniformPriceDualCapBatchAuction(address(securityPoolForker), securityPoolSalt);
		securityPool = deploySecurityPool(shareToken, parent, priceOracleManagerAndOperatorQueuer, universeId, questionId, statoblastSecurityMultiplierBps, currentRetentionRate, settlementCollateralAttoEth, address(truthAuction));
		_registerSecurityPool(originId, universeId, securityPool, hasInheritedForkOutcome);
		_recordSecurityPoolDeployment(SecurityPoolDeployment(securityPool, truthAuction, priceOracleManagerAndOperatorQueuer, shareToken, parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, currentRetentionRate, settlementCollateralAttoEth));
	}

	function deployOriginSecurityPool(uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) external returns (ISecurityPool securityPool) {
		// Origin pool deployment is intentionally public, so first deployers must not be able to
		// lock unsafe economic parameters into the canonical pool for a question/multiplier/
		// priority-fee configuration.
		// Zero-utilization origin pools always start at the protocol retention curve's maximum rate.
		require(statoblastSecurityMultiplierBps > SecurityPoolUtils.BPS_DENOMINATOR + 1, 'Multiplier must exceed 10001 BPS');

		// Validate that the question exists
		require(questionData.questionCreatedTimestamp(questionId) > 0, 'Question does not exist');

		// Validate that it's a yes-no question (exactly 2 outcomes: Yes and No)
		string[] memory outcomes = questionData.getOutcomeLabels(questionId, 0, 3);
		require(outcomes.length == 2, 'Question must have two outcomes');
		require(keccak256(bytes(outcomes[0])) == keccak256(bytes('Yes')), 'First outcome must be Yes');
		require(keccak256(bytes(outcomes[1])) == keccak256(bytes('No')), 'Second outcome must be No');
		require(zoltar.getForkTime(universeId) == 0, 'Universe already forked');

		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		require(address(reputationToken) != address(0x0), 'Universe REP token missing');
		require(zoltar.getNonDecisionThresholdAttoRep(universeId) > _getInitialEscalationDepositAttoRep(reputationToken), 'Escalation threshold too low');
		bytes32 originId = getOriginId(universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
		_reserveSecurityPool(originId, universeId);
		bytes32 securityPoolSalt = keccak256(abi.encode(address(0x0), universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas));
		OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer = priceOracleManagerAndOperatorQueuerFactory.deployPriceOracleManagerAndOperatorQueuer(openOracle, reputationToken, initialReportPriorityFeeAttoEthPerGas, securityPoolSalt);

		// Each origin lineage has its own share token, which is reused by all migrated children.
		IShareToken shareToken = shareTokenFactory.deployShareToken(originId, questionId);
		uint256 initialRetentionRate = SecurityPoolUtils.calculateRetentionRate(0, 0);
		securityPool = deploySecurityPool(shareToken, ISecurityPool(payable(address(0))), priceOracleManagerAndOperatorQueuer, universeId, questionId, statoblastSecurityMultiplierBps, initialRetentionRate, 0, address(0));

		_registerSecurityPool(originId, universeId, securityPool, false);
		shareToken.authorize(securityPool);
		_recordSecurityPoolDeployment(SecurityPoolDeployment(securityPool, UniformPriceDualCapBatchAuction(address(0)), priceOracleManagerAndOperatorQueuer, shareToken, ISecurityPool(payable(address(0))), universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, initialRetentionRate, 0));
	}

	function _reserveSecurityPool(bytes32 originId, uint248 universeId) private {
		bytes32 poolId = getPoolId(originId, universeId);
		require(!securityPoolIdClaims[poolId], 'Security pool origin and universe already claimed');
		securityPoolIdClaims[poolId] = true;
	}

	function _registerSecurityPool(bytes32 originId, uint248 universeId, ISecurityPool securityPool, bool hasInheritedForkOutcome) private {
		bytes32 poolId = getPoolId(originId, universeId);
		require(address(securityPoolsById[poolId]) == address(0x0), 'Pool already registered');
		securityPoolsById[poolId] = securityPool;
		securityPoolOriginIds[securityPool] = originId;
		securityPoolHasInheritedForkOutcome[securityPool] = hasInheritedForkOutcome;
		emit SecurityPoolRegistered(originId, poolId, universeId, securityPool);
	}

	function _recordSecurityPoolDeployment(SecurityPoolDeployment memory deployment) private {
		securityPoolDeployments.push(deployment);
		emit DeploySecurityPool(deployment.securityPool, deployment.truthAuction, deployment.priceOracleManagerAndOperatorQueuer, deployment.shareToken, deployment.parent, deployment.universeId, deployment.questionId, deployment.statoblastSecurityMultiplierBps, deployment.initialReportPriorityFeeAttoEthPerGas, deployment.currentRetentionRate, deployment.settlementCollateralAttoEth);
	}

	function deploySecurityPool(IShareToken shareToken, ISecurityPool parent, OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 currentRetentionRate, uint256 settlementCollateralAttoEth, address truthAuction) private returns (ISecurityPool securityPool) {
		securityPool = securityPoolDeployer.deploy(address(securityPoolForker), questionData, escalationGameFactory, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, parent, zoltar, universeId, questionId, statoblastSecurityMultiplierBps, initialEscalationGameDepositAttoRep, truthAuction);

		priceOracleManagerAndOperatorQueuer.setSecurityPool(securityPool);
		securityPool.setStartingParams(currentRetentionRate, settlementCollateralAttoEth);
	}

	function _getInitialEscalationDepositAttoRep(ReputationToken reputationToken) private view returns (uint256 initialDepositAttoRep) {
		return
			SecurityPoolUtils.calculateInitialEscalationDepositAttoRep(reputationToken.getTotalTheoreticalSupplyAttoRep());
	}
}
