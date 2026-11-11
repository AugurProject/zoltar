// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { EscalationGameProofTestSecurityPool } from './EscalationGameProofTestSecurityPool.sol';
import { SecurityPoolReporterLedger } from '../../statoblast/SecurityPoolReporterLedger.sol';

/// @dev Real game/report custody with a deterministic portfolio clock for native clock tests.
contract EscalationGamePortfolioClockHarness is EscalationGameProofTestSecurityPool {
	uint48 public immutable wallAnchor;
	uint48 public immutable portfolioTimeAnchor;
	uint256 public constant questionId = 17;
	SecurityPoolReporterLedger public immutable reporters;

	constructor(Zoltar protocol, uint48 wallStart, uint48 portfolioStartTime) EscalationGameProofTestSecurityPool(protocol, 0, address(0)) {
		wallAnchor = wallStart;
		portfolioTimeAnchor = portfolioStartTime;
		reporters = new SecurityPoolReporterLedger(address(this), protocol);
		reporters.registerUniverse(0);
	}

	function portfolioCustody() external view returns (address) {
		return address(this);
	}
	function systemState() external pure returns (uint8) {
		return 0;
	}
	function securityPoolFactory() external view returns (address) {
		return address(this);
	}
	function getSecurityPoolPortfolio(address) external view returns (address) {
		return address(this);
	}
	function reporterLedger(uint248) external view returns (address) {
		return address(reporters);
	}
	function portfolioTime(uint248) external view returns (uint48) {
		return portfolioTimeForNative(0, uint48(block.timestamp));
	}
	function portfolioTimeForNative(uint248, uint48 timestamp) public view returns (uint48) {
		return portfolioTimeAnchor + (timestamp > wallAnchor ? timestamp - wallAnchor : 0);
	}
	function nativeTimeForPortfolioTime(uint248, uint48 timestamp) external view returns (uint48) {
		return wallAnchor + timestamp - portfolioTimeAnchor;
	}
	function forkPortfolioTime(uint248) external view returns (uint48) {
		return portfolioTimeAnchor;
	}
	function registerReporterGame(address game) external {
		require(game == address(escalationGame), 'Wrong test game');
		reporters.registerGame(questionId, game);
	}
	function onQuestionFinalityChanged(uint48) external view {
		require(msg.sender == address(escalationGame), 'Only test game');
	}
}

import { EscalationClaimCheckpointHarness } from './EscalationClaimCheckpointHarness.sol';

contract EscalationCentralClaimCheckpointHarness is EscalationClaimCheckpointHarness {
	constructor(address source) EscalationClaimCheckpointHarness(source, 2, 0) {}
	function portfolioCustody() external view returns (address) {
		return address(this);
	}
	function securityPoolFactory() external view returns (address) {
		return address(this);
	}
	function getSecurityPoolPortfolio(address) external view returns (address) {
		return address(this);
	}
}
