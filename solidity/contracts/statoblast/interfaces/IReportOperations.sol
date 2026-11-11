// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice Ordered sponsor consent, bounded by execution gas rather than operation count.
interface IReportOperations {
	struct Operation {
		uint32 gasLimit;
		bytes data;
	}
	struct Batch {
		uint32 gasLimit;
		uint256 minimumPrice;
		uint256 maximumPrice;
		uint48 deadline;
		Operation[] operations;
	}
	function executeReportOperation(address sponsor, bytes calldata data) external;
}
