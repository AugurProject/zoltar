// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { UniformPriceDualCapBatchAuction } from '../../peripherals/UniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from '../../peripherals/interfaces/ISecurityPool.sol';
import { IShareToken } from '../../peripherals/interfaces/IShareToken.sol';
import { ReputationToken } from '../../ReputationToken.sol';

contract TruthAuctionAliasAttackShareTokenMock {
	function isAuthorized(address) external pure returns (bool) {
		return true;
	}
}

contract TruthAuctionAliasAttackFactoryMock {
	ISecurityPool private childPool;
	UniformPriceDualCapBatchAuction private childTruthAuction;

	function configureChild(
		ISecurityPool configuredChildPool,
		UniformPriceDualCapBatchAuction configuredChildTruthAuction
	) external {
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

contract TruthAuctionAliasAttackParentMock {
	SystemState private currentSystemState = SystemState.Operational;
	ReputationToken private immutable configuredRepToken;
	ISecurityPoolFactory private immutable configuredFactory;
	IShareToken private immutable configuredShareToken;
	uint248 private immutable configuredUniverse;
	uint256 private immutable configuredQuestion;
	uint256 private immutable configuredMultiplier;
	uint256 private immutable configuredCollateral;

	constructor(
		ReputationToken repTokenAddress,
		ISecurityPoolFactory factory,
		IShareToken shareTokenAddress,
		uint248 universe,
		uint256 question,
		uint256 multiplier,
		uint256 collateral
	) {
		configuredRepToken = repTokenAddress;
		configuredFactory = factory;
		configuredShareToken = shareTokenAddress;
		configuredUniverse = universe;
		configuredQuestion = question;
		configuredMultiplier = multiplier;
		configuredCollateral = collateral;
	}

	function systemState() external view returns (SystemState) {
		return currentSystemState;
	}

	function universeId() external view returns (uint248) {
		return configuredUniverse;
	}

	function questionId() external view returns (uint256) {
		return configuredQuestion;
	}

	function statoblastSecurityMultiplierBps() external view returns (uint256) {
		return configuredMultiplier;
	}

	function securityPoolFactory() external view returns (ISecurityPoolFactory) {
		return configuredFactory;
	}

	function shareToken() external view returns (IShareToken) {
		return configuredShareToken;
	}

	function repToken() external view returns (ReputationToken) {
		return configuredRepToken;
	}

	function escalationGame() external pure returns (address) {
		return address(0x0);
	}

	function activateForkMode() external {
		currentSystemState = SystemState.PoolForked;
		uint256 balance = configuredRepToken.balanceOf(address(this));
		if (balance > 0) require(configuredRepToken.transfer(msg.sender, balance), 'REP transfer');
	}

	function completeSetCollateralAmount() external view returns (uint256) {
		return configuredCollateral;
	}

	function totalSecurityBondAllowance() external pure returns (uint256) {
		return 0;
	}

	function poolOwnershipDenominator() external pure returns (uint256) {
		return 0;
	}

	function shareTokenSupply() external pure returns (uint256) {
		return 0;
	}

	function updateCollateralAmount() external pure {}

	function authorizeChildPool(ISecurityPool) external pure {}
}

contract TruthAuctionAliasAttackChildMock {
	ISecurityPool private immutable configuredParent;
	ISecurityPoolFactory private immutable configuredFactory;
	ReputationToken private immutable configuredRepToken;
	address private immutable configuredForker;
	address private immutable configuredTruthAuction;
	address payable private immutable attackReceiver;
	uint248 private immutable configuredUniverse;
	SystemState private currentSystemState = SystemState.ForkMigration;
	uint256 private ownershipDenominator;

	uint256 public stolenEth;

	constructor(
		ISecurityPool parentPool,
		ISecurityPoolFactory factory,
		ReputationToken repTokenAddress,
		address forker,
		address truthAuctionAddress,
		address payable receiver,
		uint248 universe
	) {
		configuredParent = parentPool;
		configuredFactory = factory;
		configuredRepToken = repTokenAddress;
		configuredForker = forker;
		configuredTruthAuction = truthAuctionAddress;
		attackReceiver = receiver;
		configuredUniverse = universe;
	}

	function parent() external view returns (ISecurityPool) {
		return configuredParent;
	}

	function systemState() external view returns (SystemState) {
		return currentSystemState;
	}

	function universeId() external view returns (uint248) {
		return configuredUniverse;
	}

	function securityPoolFactory() external view returns (ISecurityPoolFactory) {
		return configuredFactory;
	}

	function securityPoolForker() external view returns (address) {
		return configuredForker;
	}

	function truthAuction() external view returns (address) {
		return configuredTruthAuction;
	}

	function escalationGame() external pure returns (address) {
		return address(0x0);
	}

	function repToken() external view returns (ReputationToken) {
		return configuredRepToken;
	}

	function setOwnershipDenominator(uint256 newDenominator) external {
		ownershipDenominator = newDenominator;
	}

	function poolOwnershipDenominator() external view returns (uint256) {
		return ownershipDenominator;
	}

	function setSystemState(SystemState newState) external {
		currentSystemState = newState;
	}

	function setTotalShares(uint256) external pure {}

	function setPoolFinancials(uint256, uint256, uint256) external pure {}

	function updateRetentionRate() external pure {}

	receive() external payable {
		stolenEth += msg.value;
		(bool sent, ) = attackReceiver.call{ value: msg.value }('');
		require(sent, 'Forward');
	}
}
