// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

library Constants {
	uint88 constant MAX_ATTO_REP = 11_000_000e18;
	uint256 constant NUM_OUTCOMES = 3;
	uint256 constant MINIMUM_FORK_BURN_DIVISOR = 5;
	uint256 constant FORK_CHOICE_TIME = 8 weeks;
	uint256 constant FORK_RECAPITALIZATION_TIME = 1 weeks;
	uint256 constant FORK_RESPONSE_TIME = 1 weeks;
	address constant BURN_ADDRESS = 0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF;
	/// @dev The one response period after a fork-relevant event: Escalation Game activation delay,
	/// minimum fork response and inherited-outcome finality must all use this value (#1479).
	/// FORK_RESPONSE_TIME must stay strictly above it.
	uint48 constant FORK_RESPONSE_DELAY = 3 days;
	uint256 constant ESCALATION_TIME_LENGTH = 7 weeks;
	/// @dev The prepaid resolution premium covers the longest unforked report: activation delay plus escalation.
	uint48 constant RESOLUTION_PREMIUM_WINDOW = FORK_RESPONSE_DELAY + uint48(ESCALATION_TIME_LENGTH);
	/// @dev Escalation winners receive this share of binding capital as the escalation reward and the rest of the
	/// denominator is burned. Fork-child solvency requires MINIMUM_FORK_BURN_DIVISOR >=
	/// 2 * ESCALATION_PAYOUT_DENOMINATOR / (ESCALATION_PAYOUT_DENOMINATOR - ESCALATION_REWARD_NUMERATOR).
	uint256 constant ESCALATION_REWARD_NUMERATOR = 3;
	uint256 constant ESCALATION_BURN_NUMERATOR = 2;
	uint256 constant ESCALATION_PAYOUT_DENOMINATOR = 5;
}
