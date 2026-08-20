// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGameClaimDelegate } from '../../statoblast/EscalationGameClaimDelegate.sol';

contract EscalationClaimSourceNode {
	address public immutable rootClaimSourceGame;
	uint256 public immutable cumulativeClaimRetention;
	uint256 public immutable cumulativeClaimRetentionExponent;

	constructor(address rootSource, uint256 retention, uint256 retentionExponent) {
		rootClaimSourceGame = rootSource == address(0x0) ? address(this) : rootSource;
		cumulativeClaimRetention = retention;
		cumulativeClaimRetentionExponent = retentionExponent;
	}
}

contract EscalationClaimSourcesHarness is EscalationGameClaimDelegate {
	function configure(address rootSource, uint256 currentRetention, uint256 currentExponent) external {
		forkCarryRootClaimSourceGame = rootSource;
		cumulativeClaimRetention = currentRetention;
		cumulativeClaimRetentionExponent = currentExponent;
	}

	function applyRootRetention(uint256 amount) external view returns (uint256) {
		return this.applyInheritedClaimRetention(amount, 0);
	}
}
