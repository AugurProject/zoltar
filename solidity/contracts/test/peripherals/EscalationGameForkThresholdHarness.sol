// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { EscalationGameCalculations } from '../../peripherals/EscalationGameCalculations.sol';
import { EscalationGameProofVerifier } from '../../peripherals/EscalationGameProofVerifier.sol';
import { EscalationGameClaimDelegate } from '../../peripherals/EscalationGameClaimDelegate.sol';
import { EscalationGameState } from '../../peripherals/EscalationGameState.sol';
import { ISecurityPool } from '../../peripherals/interfaces/ISecurityPool.sol';

contract EscalationGameForkBoundaryZoltar {
	uint256 private forkThreshold;
	uint256 private forkTime;

	constructor(uint256 _forkThreshold) {
		forkThreshold = _forkThreshold;
	}

	function setForkTime(uint256 _forkTime) external {
		forkTime = _forkTime;
	}

	function getForkThreshold(uint248) external view returns (uint256) {
		return forkThreshold;
	}

	function getForkTime(uint248) external view returns (uint256) {
		return forkTime;
	}
}

contract EscalationGameForkBoundarySecurityPool {
	Zoltar public immutable zoltar;
	uint248 public constant universeId = 0;

	constructor(address zoltarAddress) {
		zoltar = Zoltar(zoltarAddress);
	}
}

contract EscalationGameForkThresholdHarness is EscalationGameCalculations {
	function _getDepositDelegate() internal pure override returns (address) {
		return address(0x0);
	}

	constructor(
		ISecurityPool _securityPool,
		EscalationGameProofVerifier _proofVerifier
	)
		EscalationGameState(
			_securityPool,
			ReputationToken(address(0)),
			_proofVerifier,
			EscalationGameClaimDelegate(address(0))
		)
	{}

	function configureBoundary(uint256 gameEndDate, uint256 _nonDecisionThreshold, uint256 winningBalance) external {
		activationTime = gameEndDate;
		startBond = 1e18;
		nonDecisionThreshold = _nonDecisionThreshold;
		outcomeState[1].balance = winningBalance;
	}

	function computeWinningWithdrawal(
		uint256 depositAmount,
		uint256 cumulativeAmount
	) external view returns (uint256 amountToWithdraw, uint256 burnAmount) {
		return _computeWinningWithdrawal(1, depositAmount, cumulativeAmount);
	}
}
