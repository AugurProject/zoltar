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
	address immutable factory;

	constructor() {
		factory = msg.sender;
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
		require(msg.sender == factory, 'only factory');

		securityPool = ISecurityPool(
			payable(
				address(
					new SecurityPool{ salt: bytes32(uint256(0)) }(
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
