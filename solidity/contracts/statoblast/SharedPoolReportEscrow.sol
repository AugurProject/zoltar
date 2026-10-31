// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { OpenOracle } from './openOracle/OpenOracle.sol';
import { IWeth9 } from './interfaces/IWeth9.sol';
import { ReputationToken } from '../ReputationToken.sol';

interface ISharedReportReceiver {
	function settleReport(uint256 reportId, uint256 amount1, uint256 amount2) external;
	function reportOutcome(uint256 reportId) external view returns (uint8);
}

/// @notice One independently funded report owns one isolated OpenOracle credit account.
/// @dev Concurrent reports must never share the reporter address: disputes credit
/// the old reporter before settlement, independently of other games' lifecycles.
contract SharedPoolReportEscrow {
	address public immutable feed;
	address public immutable sponsor;
	OpenOracle public immutable openOracle;
	IWeth9 public immutable weth;
	ReputationToken public immutable reputationToken;
	uint256 public reportId;
	event ReportCompleted(uint256 indexed reportId, address indexed priceFeed, bool accepted);

	constructor(address _sponsor, OpenOracle _openOracle, IWeth9 _weth, ReputationToken _reputationToken) {
		feed = msg.sender;
		sponsor = _sponsor;
		openOracle = _openOracle;
		weth = _weth;
		reputationToken = _reputationToken;
	}

	function start(OpenOracle.OracleGame calldata parameters) external payable returns (uint256) {
		require(msg.sender == feed && reportId == 0, 'Report escrow already started');
		require(weth.approve(address(openOracle), parameters.currentAmount1), 'Oracle WETH approval failed');
		require(reputationToken.approve(address(openOracle), parameters.currentAmount2), 'Oracle REP approval failed');
		reportId = openOracle.report{value: msg.value}(parameters, false, false, OpenOracle.TimingBoundaries({blockNumber: 0, blockNumberBound: 0, blockTimestamp: 0, blockTimestampBound: 0}));
		return reportId;
	}

	function openOracleCallback(uint256 id, uint256 amount1, uint256 amount2, uint256, address, address) external {
		require(msg.sender == address(openOracle) && id == reportId, 'Wrong escrow report');
		ISharedReportReceiver(feed).settleReport(id, amount1, amount2);
		emit ReportCompleted(id, feed, ISharedReportReceiver(feed).reportOutcome(id) == 1);
		withdrawFunding();
	}

	/// @notice Anyone can deliver already-released report funding to its sponsor.
	/// A disputed or failed-callback candidate cannot lock another report's funds.
	function withdrawFunding() public {
		openOracle.withdrawTo(address(weth), type(uint256).max, sponsor);
		openOracle.withdrawTo(address(reputationToken), type(uint256).max, sponsor);
	}
}
