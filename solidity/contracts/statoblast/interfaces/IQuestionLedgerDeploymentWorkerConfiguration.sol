// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolFactory } from './IQuestionLedger.sol';
import { QuestionLedgerEventEmitter } from '../QuestionLedgerEventEmitter.sol';

/// @dev Configuration a QuestionLedger constructor reads from the deployment worker that creates it.
interface IQuestionLedgerDeploymentWorkerConfiguration {
	function factory() external view returns (ISecurityPoolFactory);
	function eventEmitter() external view returns (QuestionLedgerEventEmitter);
	function operationsDelegate() external view returns (address);
}
