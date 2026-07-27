// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';

interface IOpenOracleDispute {
	struct OracleGame {
		uint128 currentAmount1;
		uint128 currentAmount2;
		address currentReporter;
		uint48 reportTimestamp;
		uint48 settlementTimestamp;
		address token1;
		uint48 lastReportOppoTime;
		uint48 settlementTime;
		uint128 escalationHalt;
		address protocolFeeRecipient;
		uint96 settlerReward;
		address token2;
		uint24 numReports;
		uint24 disputeDelay;
		uint24 feePercentage;
		uint16 multiplier;
		address callbackContract;
		uint32 callbackGasLimit;
		uint24 protocolFee;
		uint8 flags;
	}

	struct PreimageHelper {
		uint256 reportId;
		address creator;
		uint256 blockTimestamp;
		uint256 blockNumber;
	}

	struct TimingBoundaries {
		uint256 blockNumber;
		uint256 blockNumberBound;
		uint256 blockTimestamp;
		uint256 blockTimestampBound;
	}

	function dispute(
		uint256 reportId,
		uint128 newAmount1,
		uint128 newAmount2,
		address disputer,
		bool tryInternalBalance1,
		bool tryInternalBalance2,
		OracleGame calldata params,
		PreimageHelper calldata helper,
		TimingBoundaries calldata timing
	) external payable;
}

/// @notice Funds one OpenOracle dispute atomically and rejects non-exact ERC-20 transfers.
/// @dev The caller remains the OpenOracle disputer. A successful dispute retains no operation-pulled token balance or OpenOracle allowance.
contract OpenOracleArbitrageExecutor {
	using SafeERC20Ops for IERC20;

	uint256 private constant PERCENTAGE_PRECISION = 1e7;
	bool private entered;

	function dispute(
		address openOracle,
		uint128 newAmount1,
		uint128 newAmount2,
		IOpenOracleDispute.OracleGame calldata game,
		IOpenOracleDispute.PreimageHelper calldata helper,
		IOpenOracleDispute.TimingBoundaries calldata timing
	) external {
		require(!entered, 'OpenOracle arbitrage executor reentrancy');
		require(openOracle.code.length > 0, 'OpenOracle address must contain contract code');
		require(
			game.token1 != address(0) && game.token2 != address(0),
			'OpenOracle arbitrage executor requires ERC20 tokens'
		);
		require(game.token1 != game.token2, 'OpenOracle arbitrage executor tokens must differ');
		require(msg.sender != game.currentReporter, 'OpenOracle arbitrage executor does not support self-disputes');
		entered = true;

		(uint256 contribution1, uint256 contribution2) = _contributions(game, newAmount1, newAmount2);
		uint256 executorBalance1 = IERC20(game.token1).balanceOf(address(this));
		uint256 executorBalance2 = IERC20(game.token2).balanceOf(address(this));
		uint256 oracleBalance1 = IERC20(game.token1).balanceOf(openOracle);
		uint256 oracleBalance2 = IERC20(game.token2).balanceOf(openOracle);

		_pullExact(IERC20(game.token1), contribution1, executorBalance1);
		_pullExact(IERC20(game.token2), contribution2, executorBalance2);
		_approveExact(IERC20(game.token1), openOracle, contribution1);
		_approveExact(IERC20(game.token2), openOracle, contribution2);

		IOpenOracleDispute(openOracle).dispute(
			helper.reportId,
			newAmount1,
			newAmount2,
			msg.sender,
			false,
			false,
			game,
			helper,
			timing
		);

		_approveExact(IERC20(game.token1), openOracle, 0);
		_approveExact(IERC20(game.token2), openOracle, 0);
		require(
			IERC20(game.token1).balanceOf(address(this)) == executorBalance1,
			'Token1 transfer amount was not exact'
		);
		require(
			IERC20(game.token2).balanceOf(address(this)) == executorBalance2,
			'Token2 transfer amount was not exact'
		);
		require(
			IERC20(game.token1).balanceOf(openOracle) == oracleBalance1 + contribution1,
			'OpenOracle token1 receipt was not exact'
		);
		require(
			IERC20(game.token2).balanceOf(openOracle) == oracleBalance2 + contribution2,
			'OpenOracle token2 receipt was not exact'
		);

		entered = false;
	}

	function contributions(
		IOpenOracleDispute.OracleGame calldata game,
		uint128 newAmount1,
		uint128 newAmount2
	) external pure returns (uint256 contribution1, uint256 contribution2) {
		return _contributions(game, newAmount1, newAmount2);
	}

	function _contributions(
		IOpenOracleDispute.OracleGame calldata game,
		uint128 newAmount1,
		uint128 newAmount2
	) private pure returns (uint256 contribution1, uint256 contribution2) {
		bool swapToken2 = uint256(newAmount2) * game.currentAmount1 > uint256(game.currentAmount2) * newAmount1;
		if (swapToken2) {
			contribution1 = newAmount1 > game.currentAmount1 ? newAmount1 - game.currentAmount1 : 0;
			contribution2 =
				uint256(newAmount2) +
				game.currentAmount2 +
				_fee(game.currentAmount2, game.feePercentage) +
				_fee(game.currentAmount2, game.protocolFee);
		} else {
			contribution1 =
				uint256(newAmount1) +
				game.currentAmount1 +
				_fee(game.currentAmount1, game.feePercentage) +
				_fee(game.currentAmount1, game.protocolFee);
			contribution2 = newAmount2 > game.currentAmount2 ? newAmount2 - game.currentAmount2 : 0;
		}
	}

	function _fee(uint256 amount, uint256 rate) private pure returns (uint256) {
		return (amount * rate) / PERCENTAGE_PRECISION;
	}

	function _pullExact(IERC20 token, uint256 amount, uint256 balanceBefore) private {
		if (amount == 0) return;
		token.safeTransferFrom(msg.sender, address(this), amount);
		require(token.balanceOf(address(this)) == balanceBefore + amount, 'Token transfer to executor was not exact');
	}

	function _approveExact(IERC20 token, address spender, uint256 amount) private {
		if (token.allowance(address(this), spender) != 0) token.safeApprove(spender, 0);
		if (amount != 0) token.safeApprove(spender, amount);
	}
}
