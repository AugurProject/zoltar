// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { SecurityPool } from '../SecurityPool.sol';
import { ISecurityPool, ISecurityPoolFactory } from '../interfaces/ISecurityPool.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { SecurityPoolEventEmitter } from '../SecurityPoolEventEmitter.sol';
import { CreationCodeStorage } from './PriceOracleManagerAndOperatorQueuerFactory.sol';

contract SecurityPoolDeployer {
	ISecurityPoolFactory immutable factory;
	SecurityPoolDeploymentWorker immutable worker;
	SecurityPoolEventEmitter immutable eventEmitter;

	constructor(address operationsDelegate) {
		factory = ISecurityPoolFactory(msg.sender);
		eventEmitter = new SecurityPoolEventEmitter();
		worker = new SecurityPoolDeploymentWorker(factory, eventEmitter, operationsDelegate);
	}

	function deploy(address securityPoolForker, ZoltarQuestionData questionData, EscalationGameFactory escalationGameFactory, OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer, IShareToken shareToken, OpenOracle openOracle, ISecurityPool parent, Zoltar zoltar, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialEscalationGameDepositAttoRep, address truthAuction) external returns (ISecurityPool securityPool) {
		require(msg.sender == address(factory), 'Only SecurityPoolFactory can use the deployer');

		return
			worker.deploy(securityPoolForker, questionData, escalationGameFactory, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, parent, zoltar, universeId, questionId, statoblastSecurityMultiplierBps, initialEscalationGameDepositAttoRep, truthAuction);
	}
}

contract SecurityPoolDeploymentWorker {
	address immutable deployer;
	ISecurityPoolFactory public immutable factory;
	SecurityPoolEventEmitter public immutable eventEmitter;
	address public immutable liquidationDelegate;
	address private immutable creationCodeFirstChunk;
	address private immutable creationCodeSecondChunk;

	constructor(ISecurityPoolFactory _factory, SecurityPoolEventEmitter _eventEmitter, address _liquidationDelegate) {
		deployer = msg.sender;
		factory = _factory;
		eventEmitter = _eventEmitter;
		liquidationDelegate = _liquidationDelegate;
		(creationCodeFirstChunk, creationCodeSecondChunk) = CreationCodeStorage.store(type(SecurityPool).creationCode);
	}

	function deploy(address securityPoolForker, ZoltarQuestionData questionData, EscalationGameFactory escalationGameFactory, OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer, IShareToken shareToken, OpenOracle openOracle, ISecurityPool parent, Zoltar zoltar, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialEscalationGameDepositAttoRep, address truthAuction) external returns (ISecurityPool securityPool) {
		require(msg.sender == deployer, 'Only SecurityPoolDeployer can use the deployment worker');

		// Keep SecurityPool init code in code chunks so this worker's runtime stays below EIP-170
		// without paying storage-write gas during the factory deployment.
		bytes memory initCode = abi.encodePacked(CreationCodeStorage.load(creationCodeFirstChunk, creationCodeSecondChunk), abi.encode(securityPoolForker, questionData, escalationGameFactory, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, parent, zoltar, universeId, questionId, statoblastSecurityMultiplierBps, initialEscalationGameDepositAttoRep, truthAuction));
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
