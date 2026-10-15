// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolVaultPositionReceiver } from './interfaces/ISecurityPool.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Immutable custody of one historical aggregate question position.
/// @dev Only the portfolio can split existing rights to an owner's recovery vault. This account
/// cannot add exposure, spend REP, stake on an outcome, or choose a fork child.
contract SecurityPoolPortfolioPosition is ISecurityPoolVaultPositionReceiver {
	address public immutable portfolio;
	ISecurityPool public immutable pool;

	constructor(address _portfolio, ISecurityPool _pool) {
		portfolio = _portfolio;
		pool = _pool;
	}

	function onSecurityPoolVaultPositionReceived(address source) external view returns (bytes4) {
		require(msg.sender == address(pool) && source == portfolio, 'Position source is not canonical');
		return ISecurityPoolVaultPositionReceiver.onSecurityPoolVaultPositionReceived.selector;
	}

	function release(address recipient, uint256 numerator, uint256 denominator) external {
		require(msg.sender == portfolio, 'Only portfolio');
		pool.redeemFees(address(this));
		pool.splitVaultPosition(recipient, numerator, denominator);
		uint256 fees = Math.mulDiv(address(this).balance, numerator, denominator);
		if (fees > 0) {
			(bool sent, ) = payable(recipient).call{value: fees}('');
			require(sent, 'Position fee transfer failed');
		}
	}

	receive() external payable {}
}
