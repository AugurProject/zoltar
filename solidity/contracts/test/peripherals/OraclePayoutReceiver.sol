// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { LoggedOpenOracle } from '../../peripherals/openOracle/LoggedOpenOracle.sol';

contract OraclePayoutReceiver {
	bool public rejectEth = true;

	function setRejectEth(bool shouldReject) external {
		rejectEth = shouldReject;
	}

	function settle(LoggedOpenOracle oracle, uint256 reportId) external {
		oracle.settle(reportId);
	}

	function withdrawEthFees(LoggedOpenOracle oracle) external {
		oracle.getETHProtocolFees();
	}

	function withdrawTokenFees(LoggedOpenOracle oracle, address token) external {
		oracle.getProtocolFees(token);
	}

	receive() external payable {
		require(!rejectEth, 'ETH rejected');
	}
}
