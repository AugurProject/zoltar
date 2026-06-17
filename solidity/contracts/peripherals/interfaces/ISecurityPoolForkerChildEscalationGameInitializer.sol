// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './ISecurityPool.sol';

interface ISecurityPoolForkerChildEscalationGameInitializer {
	function initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) external;
}
