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
}
