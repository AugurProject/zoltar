// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

interface IOperationBountyResultReceiver {
	function recordOperationResult(uint256 bountyId, bool success) external;
}
