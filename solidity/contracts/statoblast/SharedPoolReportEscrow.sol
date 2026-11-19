// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { OpenOracle } from './openOracle/OpenOracle.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { ReputationToken } from '../ReputationToken.sol';

interface ISharedReportReceiver {
	function settleReport(uint256 reportId, uint256 amount1, uint256 amount2) external;
	function reportOutcome(uint256 reportId) external view returns (uint8);
}

/// @notice One independently funded report owns one isolated OpenOracle credit account.
/// @dev Concurrent reports must never share the reporter address: disputes credit
/// the old reporter before settlement, independently of other games' lifecycles.
contract SharedPoolReportEscrow {
	using SafeERC20Ops for IERC20;
	address public immutable feed;
	address public immutable sponsor;
	OpenOracle public immutable openOracle;
	IERC20 public immutable weth;
	ReputationToken public immutable reputationToken;
	/// @dev Gas the report promises its settlement callback.
	uint32 private immutable callbackGasLimit;
	/// @dev Allowance for entering the callback before its gas check runs. It is far
	/// above today's entry cost so that a gas repricing cannot make every settlement
	/// fail, and far below the callback budget an accepted report needs.
	uint256 private constant CALLBACK_ENTRY_GAS_MARGIN = 100_000;
	uint256 public reportId;
	/// @notice Emitted on every settlement callback, after the feed has processed the report.
	/// @param outcome The feed's `reportOutcome` after the callback: 0 = deferred and still
	/// pending (the settlement block's base fee exceeded the report's ceiling, so a later
	/// `recoverReport` can still complete it), 1 = accepted, 2 = rejected.
	event ReportCompleted(uint256 indexed reportId, address indexed priceFeed, uint8 outcome);

	constructor(address _sponsor, OpenOracle _openOracle, IERC20 _weth, ReputationToken _reputationToken, uint32 _callbackGasLimit) {
		callbackGasLimit = _callbackGasLimit;
		feed = msg.sender;
		sponsor = _sponsor;
		openOracle = _openOracle;
		weth = _weth;
		reputationToken = _reputationToken;
	}

	function start(OpenOracle.OracleGame calldata parameters) external payable returns (uint256) {
		require(msg.sender == feed && reportId == 0, 'Report escrow already started');
		weth.safeApprove(address(openOracle), parameters.currentAmount1);
		require(reputationToken.approve(address(openOracle), parameters.currentAmount2), 'Oracle REP approval failed');
		reportId = openOracle.report{value: msg.value}(parameters, false, false, OpenOracle.TimingBoundaries({blockNumber: 0, blockNumberBound: 0, blockTimestamp: 0, blockTimestampBound: 0}));
		return reportId;
	}

	function openOracleCallback(uint256 id, uint256 amount1, uint256 amount2, uint256, address, address) external {
		require(msg.sender == address(openOracle) && id == reportId, 'Wrong escrow report');
		// OpenOracle forwards less than the promised gas when its settler supplies
		// too little, and rejects the settlement only if almost none is left after
		// this call. A callback that merely reverted would hand its unused gas back
		// and let an under-funded settlement stand without accepting the price.
		// Consuming everything forwarded makes OpenOracle revert that settlement.
		if (gasleft() < uint256(callbackGasLimit) - CALLBACK_ENTRY_GAS_MARGIN) {
			assembly ('memory-safe') {
				invalid()
			}
		}
		ISharedReportReceiver(feed).settleReport(id, amount1, amount2);
		emit ReportCompleted(id, feed, ISharedReportReceiver(feed).reportOutcome(id));
		_withdrawOracleFunding();
	}

	/// @notice Anyone can deliver already-released report funding to its sponsor.
	/// A disputed or failed-callback candidate cannot lock another report's funds.
	function withdrawFunding() external {
		_withdrawOracleFunding();
		if (reportId == 0) return;
		_returnDirectBalance(weth);
		_returnDirectBalance(IERC20(address(reputationToken)));
	}

	function _returnDirectBalance(IERC20 token) private {
		uint256 balance = token.balanceOf(address(this));
		if (balance != 0) token.safeTransfer(sponsor, balance);
	}

	function _withdrawOracleFunding() private {
		openOracle.withdrawTo(address(weth), type(uint256).max, sponsor);
		openOracle.withdrawTo(address(reputationToken), type(uint256).max, sponsor);
	}
}
