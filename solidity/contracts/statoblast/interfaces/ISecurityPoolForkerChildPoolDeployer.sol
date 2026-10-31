// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './ISecurityPool.sol';
import { EscalationGame } from '../EscalationGame.sol';

interface ISecurityPoolForkerChildPoolDeployer {
	function getOrDeployChildPoolForEscalation(ISecurityPool parent, uint256 outcomeIndex) external returns (ISecurityPool child, EscalationGame game);
}
