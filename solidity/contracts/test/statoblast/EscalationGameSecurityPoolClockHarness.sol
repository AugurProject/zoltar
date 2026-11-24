// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { EscalationGameProofTestQuestionLedger } from './EscalationGameProofTestQuestionLedger.sol';
import { SecurityPoolReporterLedger } from '../../statoblast/SecurityPoolReporterLedger.sol';

/// @dev Real game/report custody with a deterministic security pool clock for native clock tests.
contract EscalationGameSecurityPoolClockHarness is EscalationGameProofTestQuestionLedger {
	uint48 public immutable wallAnchor;
	uint48 public immutable securityPoolTimeAnchor;
	uint256 public constant questionId = 17;
	SecurityPoolReporterLedger public immutable reporters;

	constructor(Zoltar protocol, uint48 wallStart, uint48 securityPoolStartTime) EscalationGameProofTestQuestionLedger(protocol, 0, address(0)) {
		wallAnchor = wallStart;
		securityPoolTimeAnchor = securityPoolStartTime;
		reporters = new SecurityPoolReporterLedger(address(this), protocol);
		reporters.registerUniverse(0);
	}

	function securityPoolCustody() external view returns (address) {
		return address(this);
	}
	function systemState() external pure returns (uint8) {
		return 0;
	}
	function securityPoolFactory() external view returns (address) {
		return address(this);
	}
	function securityPoolOf(address) external view returns (address) {
		return address(this);
	}
	function reporterLedger(uint248) external view returns (address) {
		return address(reporters);
	}
	function securityPoolTime(uint248) external view returns (uint48) {
		return securityPoolTimeForNative(0, uint48(block.timestamp));
	}
	function securityPoolTimeForNative(uint248, uint48 timestamp) public view returns (uint48) {
		return securityPoolTimeAnchor + (timestamp > wallAnchor ? timestamp - wallAnchor : 0);
	}
	function nativeTimeForSecurityPoolTime(uint248, uint48 timestamp) external view returns (uint48) {
		return wallAnchor + timestamp - securityPoolTimeAnchor;
	}
	function forkSecurityPoolTime(uint248) external view returns (uint48) {
		return securityPoolTimeAnchor;
	}
	function registerReporterGame(address game) external {
		require(game == address(escalationGame), 'Wrong test game');
		reporters.registerGame(questionId, game);
	}
	function onQuestionFinalityChanged(uint48) external view {
		require(msg.sender == address(escalationGame), 'Only test game');
	}
}
