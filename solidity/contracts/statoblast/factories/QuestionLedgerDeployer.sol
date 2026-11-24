// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { QuestionLedger } from '../QuestionLedger.sol';
import { IQuestionLedger, ISecurityPoolFactory } from '../interfaces/IQuestionLedger.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { QuestionLedgerEventEmitter } from '../QuestionLedgerEventEmitter.sol';
import { CreationCodeStorage } from '../CreationCodeStorage.sol';
import { Create2Deployment } from './Create2Deployment.sol';

contract QuestionLedgerDeployer {
	ISecurityPoolFactory immutable factory;
	QuestionLedgerDeploymentWorker immutable worker;
	QuestionLedgerEventEmitter immutable eventEmitter;

	constructor(address operationsDelegate, QuestionLedgerEventEmitter accountingDelegate) {
		factory = ISecurityPoolFactory(msg.sender);
		eventEmitter = accountingDelegate;
		worker = new QuestionLedgerDeploymentWorker(factory, eventEmitter, operationsDelegate);
	}

	function deploy(address questionForker, ZoltarQuestionData questionData, EscalationGameFactory escalationGameFactory, OpenOraclePriceCoordinator openOraclePriceCoordinator, IShareToken shareToken, OpenOracle openOracle, IQuestionLedger parent, Zoltar zoltar, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps) external returns (IQuestionLedger questionLedger) {
		require(msg.sender == address(factory), 'Only SecurityPoolFactory can use the deployer');

		return
			worker.deploy(questionForker, questionData, escalationGameFactory, openOraclePriceCoordinator, shareToken, openOracle, parent, zoltar, universeId, questionId, statoblastSecurityMultiplierBps);
	}
}

contract QuestionLedgerDeploymentWorker {
	address immutable deployer;
	ISecurityPoolFactory public immutable factory;
	QuestionLedgerEventEmitter public immutable eventEmitter;
	address public immutable operationsDelegate;
	address private immutable creationCodeFirstChunk;
	address private immutable creationCodeSecondChunk;

	constructor(ISecurityPoolFactory _factory, QuestionLedgerEventEmitter _eventEmitter, address _operationsDelegate) {
		deployer = msg.sender;
		factory = _factory;
		eventEmitter = _eventEmitter;
		operationsDelegate = _operationsDelegate;
		(creationCodeFirstChunk, creationCodeSecondChunk) = CreationCodeStorage.store(type(QuestionLedger).creationCode);
	}

	function deploy(address questionForker, ZoltarQuestionData questionData, EscalationGameFactory escalationGameFactory, OpenOraclePriceCoordinator openOraclePriceCoordinator, IShareToken shareToken, OpenOracle openOracle, IQuestionLedger parent, Zoltar zoltar, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps) external returns (IQuestionLedger questionLedger) {
		require(msg.sender == deployer, 'Only QuestionLedgerDeployer can use the deployment worker');

		// Keep QuestionLedger init code in code chunks so this worker's runtime stays below EIP-170
		// without paying storage-write gas during the factory deployment.
		bytes memory initCode = abi.encodePacked(CreationCodeStorage.load(creationCodeFirstChunk, creationCodeSecondChunk), abi.encode(questionForker, questionData, escalationGameFactory, openOraclePriceCoordinator, shareToken, openOracle, parent, zoltar, universeId, questionId, statoblastSecurityMultiplierBps));
		address deployed = Create2Deployment.deploy(initCode, 0);
		require(deployed != address(0x0), 'Question ledger deployment failed');
		return IQuestionLedger(payable(deployed));
	}
}
