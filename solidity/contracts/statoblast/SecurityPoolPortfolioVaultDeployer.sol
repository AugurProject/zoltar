// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolPortfolioVault, ISecurityPoolPortfolio } from './SecurityPoolPortfolioVault.sol';
import { SecurityPoolPortfolioPosition } from './SecurityPoolPortfolioPosition.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';

/// @dev Keeps vault creation code outside the portfolio's runtime. Only its creating portfolio can deploy.
contract SecurityPoolPortfolioVaultDeployer {
	ISecurityPoolPortfolio public immutable portfolio;

	constructor() {
		portfolio = ISecurityPoolPortfolio(msg.sender);
	}

	function createVault(address owner) external returns (SecurityPoolPortfolioVault) {
		require(msg.sender == address(portfolio), 'Only portfolio');
		return new SecurityPoolPortfolioVault{salt: bytes32(uint256(uint160(owner)))}(owner, portfolio);
	}

	function createPosition(ISecurityPool pool) external returns (SecurityPoolPortfolioPosition) {
		require(msg.sender == address(portfolio), 'Only portfolio');
		return new SecurityPoolPortfolioPosition(address(portfolio), pool);
	}

	function predictVaultAddress(address owner) external view returns (address) {
		bytes32 initCodeHash = keccak256(abi.encodePacked(type(SecurityPoolPortfolioVault).creationCode, abi.encode(owner, portfolio)));
		return
			address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(uint256(uint160(owner))), initCodeHash)))));
	}
}
