// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { UniformPriceDualCapBatchAuction } from '../../peripherals/UniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from '../../peripherals/interfaces/ISecurityPool.sol';
import { IShareToken } from '../../peripherals/interfaces/IShareToken.sol';
import { ReputationToken } from '../../ReputationToken.sol';

contract SecurityPoolForkerMaliciousEventEmitter {
	ISecurityPool private immutable targetPool;
	address payable private immutable receiver;

	constructor(ISecurityPool configuredTargetPool, address payable configuredReceiver) {
		targetPool = configuredTargetPool;
		receiver = configuredReceiver;
	}

	function emitForkSnapshotEvents(ISecurityPool, address, address, uint256, uint256, uint256) external {
		targetPool.transferEth(receiver, targetPool.completeSetCollateralAmount());
	}
}

contract SecurityPoolForkerFakePoolMock {
	uint248 private immutable configuredUniverseId;
	ReputationToken private immutable configuredRepToken;
	uint256 private immutable configuredQuestionId;
	address private immutable configuredEventEmitter;

	constructor(
		uint248 configuredUniverse,
		ReputationToken configuredRep,
		uint256 configuredQuestion,
		address configuredEmitter
	) {
		configuredUniverseId = configuredUniverse;
		configuredRepToken = configuredRep;
		configuredQuestionId = configuredQuestion;
		configuredEventEmitter = configuredEmitter;
	}

	function universeId() external view returns (uint248) {
		return configuredUniverseId;
	}

	function systemState() external pure returns (SystemState) {
		return SystemState.Operational;
	}

	function escalationGame() external pure returns (address) {
		return address(0x0);
	}

	function repToken() external view returns (ReputationToken) {
		return configuredRepToken;
	}

	function questionId() external view returns (uint256) {
		return configuredQuestionId;
	}

	function activateForkMode(bool) external pure {}

	function completeSetCollateralAmount() external pure returns (uint256) {
		return 0;
	}

	function securityPoolEventEmitter() external view returns (address) {
		return configuredEventEmitter;
	}
}

contract SecurityPoolForkerAttackFactoryMock {
	ISecurityPool private immutable childPool;
	UniformPriceDualCapBatchAuction private immutable childTruthAuction;

	constructor(ISecurityPool configuredChildPool, UniformPriceDualCapBatchAuction configuredChildTruthAuction) {
		childPool = configuredChildPool;
		childTruthAuction = configuredChildTruthAuction;
	}

	function deployChildSecurityPool(
		ISecurityPool,
		IShareToken,
		uint248,
		uint256,
		uint256,
		uint256,
		uint256
	) external view returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction) {
		return (childPool, childTruthAuction);
	}
}

contract SecurityPoolForkerAttackParentMock {
	SystemState private immutable configuredSystemState;
	uint248 private immutable configuredUniverseId;
	ISecurityPoolFactory private immutable configuredSecurityPoolFactory;
	IShareToken private immutable configuredShareToken;
	uint256 private immutable configuredQuestionId;
	uint256 private immutable configuredSecurityMultiplier;
	uint256 private immutable configuredCompleteSetCollateralAmount;
	uint256 private immutable configuredTotalSecurityBondAllowance;
	uint256 private immutable configuredPoolOwnershipDenominator;

	constructor(
		uint248 configuredUniverse,
		ISecurityPoolFactory configuredFactory,
		IShareToken configuredShareTokenAddress,
		uint256 configuredQuestion,
		uint256 configuredMultiplier,
		uint256 configuredCollateralAmount,
		uint256 configuredBondAllowance,
		uint256 configuredDenominator
	) {
		configuredSystemState = SystemState.PoolForked;
		configuredUniverseId = configuredUniverse;
		configuredSecurityPoolFactory = configuredFactory;
		configuredShareToken = configuredShareTokenAddress;
		configuredQuestionId = configuredQuestion;
		configuredSecurityMultiplier = configuredMultiplier;
		configuredCompleteSetCollateralAmount = configuredCollateralAmount;
		configuredTotalSecurityBondAllowance = configuredBondAllowance;
		configuredPoolOwnershipDenominator = configuredDenominator;
	}

	function systemState() external view returns (SystemState) {
		return configuredSystemState;
	}

	function universeId() external view returns (uint248) {
		return configuredUniverseId;
	}

	function securityPoolFactory() external view returns (ISecurityPoolFactory) {
		return configuredSecurityPoolFactory;
	}

	function shareToken() external view returns (IShareToken) {
		return configuredShareToken;
	}

	function questionId() external view returns (uint256) {
		return configuredQuestionId;
	}

	function securityMultiplier() external view returns (uint256) {
		return configuredSecurityMultiplier;
	}

	function completeSetCollateralAmount() external view returns (uint256) {
		return configuredCompleteSetCollateralAmount;
	}

	function totalSecurityBondAllowance() external view returns (uint256) {
		return configuredTotalSecurityBondAllowance;
	}

	function poolOwnershipDenominator() external view returns (uint256) {
		return configuredPoolOwnershipDenominator;
	}

	function authorizeChildPool(ISecurityPool) external pure {}

	function escalationGame() external pure returns (address) {
		return address(0x0);
	}
}
