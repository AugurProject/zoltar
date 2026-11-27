// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolFactory } from './IQuestionLedger.sol';

/// @dev Configuration a QuestionLedger constructor reads from the deployment worker that creates it.
interface IQuestionLedgerDeploymentWorkerConfiguration {
	function factory() external view returns (ISecurityPoolFactory);
	function delegate() external view returns (address);
}
