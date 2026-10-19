// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolPortfolioVault, ISecurityPoolPortfolio } from './SecurityPoolPortfolioVault.sol';
import { SecurityPoolPortfolioRecoveryDeployer } from './SecurityPoolPortfolioRecoveryDeployer.sol';
import { SecurityPoolPortfolioQuoteDeployer } from './SecurityPoolPortfolioQuoteDeployer.sol';

/// @dev Shared creation code with a separate deterministic vault namespace for every caller.
contract SecurityPoolPortfolioVaultDeployer {
	SecurityPoolPortfolioRecoveryDeployer public immutable helpers;

	constructor(SecurityPoolPortfolioQuoteDeployer quoteDeployer) {
		helpers = new SecurityPoolPortfolioRecoveryDeployer(quoteDeployer);
	}

	function createVault(address owner) external returns (SecurityPoolPortfolioVault) {
		return
			new SecurityPoolPortfolioVault{salt: keccak256(abi.encode(msg.sender, owner))}(owner, ISecurityPoolPortfolio(msg.sender));
	}

	function predictVaultAddress(address owner) external view returns (address) {
		bytes32 initCodeHash = keccak256(abi.encodePacked(type(SecurityPoolPortfolioVault).creationCode, abi.encode(owner, msg.sender)));
		return
			address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), keccak256(abi.encode(msg.sender, owner)), initCodeHash)))));
	}
}
