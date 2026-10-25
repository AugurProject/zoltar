// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

interface ICapitalFeeStreams {
	function addStream(uint256 ethAmount, uint256 repAmount) external;
	function checkpoint(uint48 eligibleThrough) external returns (uint256 ethAmount, uint256 repAmount);
	function takeDeferred() external returns (uint256 ethAmount, uint256 repAmount);
	function defer(uint256 ethAmount, uint256 repAmount) external;
	function resume(address index, uint256 price) external;
}

interface ICapitalPriceExposure {
	function validateExposure() external view;
	function targetPriceErrorForDispute() external view returns (uint256);
	function acceptedEpoch() external view returns (uint256);
	function reportAuthorization(uint256 reportId, uint256 newExposure) external view returns (uint256 conservativeReportPrice, uint256 epoch);
}

interface ICapitalLedgerAccounting {
	function priceFeed(uint248 universeId) external view returns (address);
	function creditServiceFees(uint248 universeId) external payable;
	/// @dev Deliver collateral-funded fees earned before this deadline, before any
	/// change to eligibility. The accounting contract must not advance past it.
	function checkpointCapitalFees(uint248 universeId, uint48 through) external;
}
