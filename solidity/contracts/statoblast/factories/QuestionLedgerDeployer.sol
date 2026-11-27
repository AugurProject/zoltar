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
import { QuestionLedgerAccountingModule } from '../QuestionLedgerAccountingModule.sol';
import { CreationCodeDeployer } from '../CreationCodeStorage.sol';

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

/// @dev Holds QuestionLedger creation code in two code chunks so this deployer stays below EIP-170,
/// and exposes the configuration each QuestionLedger constructor reads from its creator.
contract QuestionLedgerDeployer is CreationCodeDeployer {
	ISecurityPoolFactory public immutable factory;
	QuestionLedgerAccountingModule public immutable accountingModule;
	address public immutable operationsDelegate;

	constructor(address _operationsDelegate, QuestionLedgerAccountingModule _accountingModule) CreationCodeDeployer(type(QuestionLedger).creationCode) {
		factory = ISecurityPoolFactory(msg.sender);
		accountingModule = _accountingModule;
		operationsDelegate = _operationsDelegate;
	}

	function deploy(QuestionLedgerConfiguration calldata configuration) external returns (IQuestionLedger) {
		require(msg.sender == address(factory), 'Only SecurityPoolFactory can use the deployer');
		return IQuestionLedger(payable(_deploy2(abi.encode(configuration), 0)));
	}
}
