// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { SecurityPool } from '../SecurityPool.sol';
import { ISecurityPool, ISecurityPoolFactory } from '../interfaces/ISecurityPool.sol';
import { LoggedOpenOracle } from '../openOracle/LoggedOpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { SecurityPoolEventEmitter } from '../SecurityPoolEventEmitter.sol';

contract SecurityPoolDeployer {
	ISecurityPoolFactory immutable factory;
	SecurityPoolDeploymentWorker immutable worker;
	SecurityPoolEventEmitter immutable eventEmitter;

	constructor() {
		factory = ISecurityPoolFactory(msg.sender);
		eventEmitter = new SecurityPoolEventEmitter();
		worker = new SecurityPoolDeploymentWorker(factory, eventEmitter);
	}

	function deploy(
		address securityPoolForker,
		ZoltarQuestionData questionData,
		EscalationGameFactory escalationGameFactory,
		OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer,
		IShareToken shareToken,
		LoggedOpenOracle openOracle,
		ISecurityPool parent,
		Zoltar zoltar,
		uint248 universeId,
		uint256 questionId,
		uint256 securityMultiplier,
		uint256 initialEscalationGameDeposit,
		address truthAuction
	) external returns (ISecurityPool securityPool) {
		require(msg.sender == address(factory), 'Only SecurityPoolFactory can use the deployer');

		return
			worker.deploy(
				securityPoolForker,
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
	}
}

contract SecurityPoolDeploymentWorker {
	address immutable deployer;
	ISecurityPoolFactory public immutable factory;
	SecurityPoolEventEmitter public immutable eventEmitter;
	bytes private securityPoolCreationCode;

	constructor(ISecurityPoolFactory _factory, SecurityPoolEventEmitter _eventEmitter) {
		deployer = msg.sender;
		factory = _factory;
		eventEmitter = _eventEmitter;
		securityPoolCreationCode = type(SecurityPool).creationCode;
	}

	function deploy(
		address securityPoolForker,
		ZoltarQuestionData questionData,
		EscalationGameFactory escalationGameFactory,
		OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer,
		IShareToken shareToken,
		LoggedOpenOracle openOracle,
		ISecurityPool parent,
		Zoltar zoltar,
		uint248 universeId,
		uint256 questionId,
		uint256 securityMultiplier,
		uint256 initialEscalationGameDeposit,
		address truthAuction
	) external returns (ISecurityPool securityPool) {
		require(msg.sender == deployer, 'Only SecurityPoolDeployer can use the deployment worker');

		// Keep SecurityPool init code in storage so this worker's runtime stays below EIP-170.
		bytes memory initCode = abi.encodePacked(
			securityPoolCreationCode,
			abi.encode(
				securityPoolForker,
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
			)
		);
		address deployed;
		assembly {
			deployed := create2(0, add(initCode, 0x20), mload(initCode), 0)
			if iszero(deployed) {
				let revertDataSize := returndatasize()
				if gt(revertDataSize, 0) {
					returndatacopy(0, 0, revertDataSize)
					revert(0, revertDataSize)
				}
			}
		}
		require(deployed != address(0x0), 'Security pool deployment failed');
		return ISecurityPool(payable(deployed));
	}
}
