// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Constants } from '../Constants.sol';
import { ESCALATION_TIME_LENGTH } from '../statoblast/EscalationGameTypes.sol';
import { SecurityPoolBoundClones } from '../statoblast/SecurityPoolBoundClones.sol';
import { SecurityPoolRepairAuctionVaultClones } from '../statoblast/SecurityPoolRepairAuctionVault.sol';
import { EscalationGameStorage } from '../statoblast/EscalationGameStorage.sol';

/// @dev Exposes the library and internal constants whose agreement or ordering several safety properties depend on (#1479).
contract ConstantsCouplingHarness is EscalationGameStorage {
	struct Coupling {
		uint256 forkResponseDelay;
		uint256 activationDelay;
		uint256 forkResponseTime;
		uint256 escalationTimeLength;
		uint256 resolutionPremiumWindow;
		uint256 minimumForkBurnDivisor;
		uint256 rewardNumerator;
		uint256 burnNumerator;
		uint256 payoutDenominator;
		uint256 forwarderLength;
		uint256 repairAuctionVaultRuntimeLength;
		uint256 repairAuctionVaultBindingsLength;
	}

	function coupling() external pure returns (Coupling memory) {
		return
			Coupling(Constants.FORK_RESPONSE_DELAY, ACTIVATION_DELAY, Constants.FORK_RESPONSE_TIME, ESCALATION_TIME_LENGTH, Constants.RESOLUTION_PREMIUM_WINDOW, Constants.MINIMUM_FORK_BURN_DIVISOR, Constants.ESCALATION_REWARD_NUMERATOR, Constants.ESCALATION_BURN_NUMERATOR, Constants.ESCALATION_PAYOUT_DENOMINATOR, SecurityPoolBoundClones.FORWARDER_LENGTH, SecurityPoolRepairAuctionVaultClones.RUNTIME_LENGTH, SecurityPoolRepairAuctionVaultClones.BINDINGS_LENGTH);
	}
}
