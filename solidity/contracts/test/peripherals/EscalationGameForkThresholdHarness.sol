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
	uint256 private forkThresholdAttoRep;
	uint256 private forkTime;

	constructor(uint256 _forkThreshold) {
		forkThresholdAttoRep = _forkThreshold;
	}

	function setForkTime(uint256 _forkTime) external {
		forkTime = _forkTime;
	}

	function getForkThresholdAttoRep(uint248) external view returns (uint256) {
		return forkThresholdAttoRep;
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

	constructor(ISecurityPool _securityPool, EscalationGameProofVerifier _proofVerifier)
		EscalationGameState(
			_securityPool,
			ReputationToken(address(0)),
			_proofVerifier,
			EscalationGameClaimDelegate(address(0))
		)
	{}

	function configureBoundary(uint256 gameEndDate, uint256 _nonDecisionThresholdAttoRep, uint256 winningBalanceAttoRep) external {
		activationTime = gameEndDate;
		startBondAttoRep = 1e18;
		nonDecisionThresholdAttoRep = _nonDecisionThresholdAttoRep;
		outcomeState[1].balanceAttoRep = winningBalanceAttoRep;
	}

	function computeWinningWithdrawal(uint256 depositAmountAttoRep, uint256 cumulativeAmountAttoRep) external view returns (uint256 amountToWithdrawAttoRep, uint256 burnAmountAttoRep) {
		return _computeWinningWithdrawal(1, depositAmountAttoRep, cumulativeAmountAttoRep);
	}
}
