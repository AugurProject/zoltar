// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice Native question callbacks into the canonical portfolio's central settlement custody.
/// @dev Every mutating callback authenticates msg.sender as a registered native question pool.
/// Redemption follows the native token burn and pays the recipient from central custody.
interface IPortfolioSettlement {
	function availableMintCapacity(uint248 universeId) external view returns (uint256);
	function mintQuestionSettlement()
		external
		payable
		returns (uint256 mintedShares, uint256 totalEconomicShares, uint256 questionCashAttoEth);
	function redeemQuestionSettlement(address recipient, uint256 burnedShares) external returns (uint256 paidCashAttoEth, uint256 totalEconomicShares, uint256 questionCashAttoEth);
	function checkpointQuestionSettlement()
		external
		returns (uint256 totalEconomicShares, uint256 questionCashAttoEth, uint48 logicalClock);
	function refreshQuestionSettlement()
		external
		returns (uint256 totalEconomicShares, uint256 questionCashAttoEth, uint48 logicalClock);
	function quoteQuestionSettlement(address pool, uint256 outcomeShares) external view returns (uint256 cashAttoEth);
	function quoteQuestionRecoveryRep(address pool, uint256 outcomeShares) external view returns (uint256 recoveryAttoRep);
	function quoteQuestionMint(address pool, uint256 cashAttoEth) external view returns (uint256 outcomeShares);
	function onQuestionRepIncome(uint256 amountAttoRep) external;
}
