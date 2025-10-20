// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;
import { ISecurityPool } from './ISecurityPool.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';

interface ISecurityPoolFactory {
	function deploySecurityPool(OpenOracle openOracle, ISecurityPool parent, Zoltar zoltar, uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPoolAddress);
}
