// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { SecurityPool } from '../SecurityPool.sol';
import { ISecurityPool, ISecurityPoolFactory } from '../interfaces/ISecurityPool.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { SecurityPoolOracleCoordinator } from '../SecurityPoolOracleCoordinator.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';

contract SecurityPoolDeployer {
	ISecurityPoolFactory immutable factory;
	SecurityPoolDeploymentWorker immutable worker;

	constructor() {
		factory = ISecurityPoolFactory(msg.sender);
		worker = new SecurityPoolDeploymentWorker();
	}

	function deploy(
		address securityPoolForker,
		ZoltarQuestionData questionData,
		EscalationGameFactory escalationGameFactory,
		SecurityPoolOracleCoordinator priceOracleManagerAndOperatorQueuer,
		IShareToken shareToken,
		OpenOracle openOracle,
		ISecurityPool parent,
		Zoltar zoltar,
		uint248 universeId,
		uint256 questionId,
		uint256 securityMultiplier,
		uint256 initialEscalationGameDeposit,
		address truthAuction
	) external returns (ISecurityPool securityPool) {
		require(msg.sender == address(factory), 'only factory');

		return
			worker.deploy(
				securityPoolForker,
				factory,
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

	constructor() {
		deployer = msg.sender;
	}

	function deploy(
		address securityPoolForker,
		ISecurityPoolFactory securityPoolFactory,
		ZoltarQuestionData questionData,
		EscalationGameFactory escalationGameFactory,
		SecurityPoolOracleCoordinator priceOracleManagerAndOperatorQueuer,
		IShareToken shareToken,
		OpenOracle openOracle,
		ISecurityPool parent,
		Zoltar zoltar,
		uint248 universeId,
		uint256 questionId,
		uint256 securityMultiplier,
		uint256 initialEscalationGameDeposit,
		address truthAuction
	) external returns (ISecurityPool securityPool) {
		require(msg.sender == deployer, 'only deployer');

		return
			ISecurityPool(
				payable(
					address(
						new SecurityPool{ salt: bytes32(0) }(
							securityPoolForker,
							securityPoolFactory,
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
					)
				)
			);
	}
}
