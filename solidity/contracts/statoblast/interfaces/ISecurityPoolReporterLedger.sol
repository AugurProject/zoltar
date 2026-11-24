// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

interface ISecurityPoolReporterLedger {
	function balanceOfGame(address game) external view returns (uint256);
	function depositAndScheduleFinality(address game, uint256 amountAttoRep, uint48 finalAfter) external;
	function depositForGame(address game, uint256 amountAttoRep) external;
	function transferFromGame(address game, address recipient, uint256 amountAttoRep) external;
	function scheduleFinality(address game, uint48 finalAfter) external;
}

interface ISecurityPoolReporterHost {
	function settlement() external view returns (address);
	function securityPoolTime(uint248 universeId) external view returns (uint48);
	function securityPoolTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48);
	function nativeTimeForSecurityPoolTime(uint248 universeId, uint48 timestamp) external view returns (uint48);
	function reporterLedger(uint248 universeId) external view returns (address);
	function registerReporterGame(address game) external;
	function onQuestionFinalityChanged(uint48 nativeFinalAfter) external;
}
