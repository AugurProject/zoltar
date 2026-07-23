// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './ISecurityPool.sol';
import { EscalationGame } from '../EscalationGame.sol';

interface ISecurityPoolForkerChildEscalationGameInitializer {
	function initializeChildForkedEscalationGameIfNeeded(
		ISecurityPool parent,
		ISecurityPool child,
		EscalationGame childEscalationGame
	) external returns (EscalationGame);
}
