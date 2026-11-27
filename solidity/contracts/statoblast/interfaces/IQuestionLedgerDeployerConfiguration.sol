// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolFactory } from './IQuestionLedger.sol';

/// @dev Configuration a QuestionLedger constructor reads from the deployer that creates it.
interface IQuestionLedgerDeployerConfiguration {
	function factory() external view returns (ISecurityPoolFactory);
	function delegate() external view returns (address);
}
