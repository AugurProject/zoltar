// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolFactory } from './IQuestionLedger.sol';
import { QuestionLedgerAccountingModule } from '../QuestionLedgerAccountingModule.sol';

/// @dev Configuration a QuestionLedger constructor reads from the deployment worker that creates it.
interface IQuestionLedgerDeploymentWorkerConfiguration {
	function factory() external view returns (ISecurityPoolFactory);
	function accountingModule() external view returns (QuestionLedgerAccountingModule);
	function operationsDelegate() external view returns (address);
}
