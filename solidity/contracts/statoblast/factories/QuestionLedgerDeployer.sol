// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { QuestionLedger } from '../QuestionLedger.sol';
import { IQuestionLedger, ISecurityPoolFactory } from '../interfaces/IQuestionLedger.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { SharedPoolPriceFeed } from '../SharedPoolPriceFeed.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { CreationCodeStorage } from '../CreationCodeStorage.sol';
import { Create2Deployment } from './Create2Deployment.sol';

/// @dev Static fields follow the QuestionLedger constructor argument order.
struct QuestionLedgerConfiguration {
	address questionForker;
	ZoltarQuestionData questionData;
	EscalationGameFactory escalationGameFactory;
	SharedPoolPriceFeed priceFeed;
	IShareToken shareToken;
	OpenOracle openOracle;
	IQuestionLedger parent;
	Zoltar zoltar;
	uint248 universeId;
	uint256 questionId;
	uint256 statoblastSecurityMultiplierBps;
}

contract QuestionLedgerDeployer {
	ISecurityPoolFactory immutable factory;
	QuestionLedgerDeploymentWorker immutable worker;

	constructor(address delegate) {
		factory = ISecurityPoolFactory(msg.sender);
		worker = new QuestionLedgerDeploymentWorker(factory, delegate);
	}

	function deploy(QuestionLedgerConfiguration calldata configuration) external returns (IQuestionLedger questionLedger) {
		require(msg.sender == address(factory), 'Only SecurityPoolFactory can use the deployer');

		return worker.deploy(configuration);
	}
}

contract QuestionLedgerDeploymentWorker {
	address immutable deployer;
	ISecurityPoolFactory public immutable factory;
	address public immutable delegate;
	address private immutable creationCodeFirstChunk;
	address private immutable creationCodeSecondChunk;

	constructor(ISecurityPoolFactory _factory, address _delegate) {
		deployer = msg.sender;
		factory = _factory;
		delegate = _delegate;
		(creationCodeFirstChunk, creationCodeSecondChunk) = CreationCodeStorage.store(type(QuestionLedger).creationCode);
	}

	function deploy(QuestionLedgerConfiguration calldata configuration) external returns (IQuestionLedger questionLedger) {
		require(msg.sender == deployer, 'Only QuestionLedgerDeployer can use the deployment worker');

		// Keep QuestionLedger init code in code chunks so this worker's runtime stays below EIP-170
		// without paying storage-write gas during the factory deployment.
		bytes memory initCode = abi.encodePacked(CreationCodeStorage.load(creationCodeFirstChunk, creationCodeSecondChunk), abi.encode(configuration));
		address deployed = Create2Deployment.deploy(initCode, 0);
		require(deployed != address(0x0), 'Question ledger deployment failed');
		return IQuestionLedger(payable(deployed));
	}
}
