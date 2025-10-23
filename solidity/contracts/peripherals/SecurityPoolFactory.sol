// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;
import { SecurityPool } from './SecurityPool.sol';
import { ISecurityPool, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { Zoltar } from '../Zoltar.sol';

contract SecurityPoolFactory is ISecurityPoolFactory {
	event DeploySecurityPool(ISecurityPool securityPool, OpenOracle openOracle, ISecurityPool parent, Zoltar zoltar, uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount);
	function deploySecurityPool(OpenOracle openOracle, ISecurityPool parent, Zoltar zoltar, uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (ISecurityPool securityPoolAddress) {
		securityPoolAddress = new SecurityPool{salt: bytes32(uint256(0x1))}(this, openOracle, parent, zoltar, universeId, questionId, securityMultiplier);
		securityPoolAddress.setStartingParams(currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
		emit DeploySecurityPool(securityPoolAddress, openOracle, parent, zoltar, universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
	}
}
