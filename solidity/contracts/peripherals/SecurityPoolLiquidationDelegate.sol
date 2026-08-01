// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { MAX_CLAIM_SOURCE_DEPTH } from './EscalationGameTypes.sol';
import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';

library EscalationClaimSources {
	function collect(
		address initialGame
	) internal view returns (address[MAX_CLAIM_SOURCE_DEPTH] memory games, uint256 gameCount) {
		address currentGame = initialGame;
		for (uint256 depth = 0; depth < MAX_CLAIM_SOURCE_DEPTH; depth++) {
			games[gameCount++] = currentGame;
			(bool hasSource, bytes memory sourceData) = currentGame.staticcall(hex'db05d0b2');
			if (!hasSource || sourceData.length != 32) return (games, gameCount);
			address nextGame = abi.decode(sourceData, (address));
			if (nextGame == address(0x0) || nextGame == currentGame) return (games, gameCount);
			currentGame = nextGame;
			if (depth + 1 == MAX_CLAIM_SOURCE_DEPTH) revert('Claim depth');
		}
	}
}

contract SecurityPoolLiquidationDelegate is SecurityPoolStorage {
	function performBundledLiquidation(
		address callerVault,
		address targetVault,
		uint256 debtAmount,
		uint256 snapshotTargetOwnership,
		uint256 snapshotTargetAllowance,
		uint256 snapshotTotalRep,
		uint256 snapshotDenominator,
		uint256 repEthPrice
	) external returns (uint256 debtToMove, uint256 repToMove) {
		uint256 targetFreeRep =
			snapshotDenominator == 0
				? snapshotTargetOwnership / SecurityPoolUtils.PRICE_PRECISION
				: (snapshotTargetOwnership * snapshotTotalRep) / snapshotDenominator;
		uint256 targetEscalationRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.escrowedRepByVault(targetVault);
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(
			!SecurityPoolUtils.isVaultHealthy(
				targetFreeRep,
				targetEscalationRep,
				snapshotTargetAllowance,
				repEthPrice,
				statoblastSecurityMultiplierBps
			),
			'Target safe'
		);
		uint256 ownershipToMove;
		(debtToMove, repToMove, ownershipToMove) = SecurityPoolUtils.calculateBundledLiquidationTransfer(
			securityVaults[targetVault].poolOwnership,
			snapshotTargetAllowance,
			debtAmount,
			IERC20(address(pool.repToken())).balanceOf(address(this)),
			poolOwnershipDenominator
		);
		require(debtToMove > 0, 'No liq');

		feeIndexRemainder = 0;
		securityVaults[targetVault].securityBondAllowance = snapshotTargetAllowance - debtToMove;
		securityVaults[targetVault].poolOwnership -= ownershipToMove;
		securityVaults[callerVault].securityBondAllowance += debtToMove;
		securityVaults[callerVault].poolOwnership += ownershipToMove;
		uint256 targetFees = securityVaults[targetVault].unpaidEthFees;
		uint256 feesToMove =
			debtToMove == snapshotTargetAllowance ? targetFees : (targetFees * debtToMove) / snapshotTargetAllowance;
		securityVaults[targetVault].unpaidEthFees = targetFees - feesToMove;
		securityVaults[callerVault].unpaidEthFees += feesToMove;
		if (address(escalationGame) != address(0x0)) {
			(address[MAX_CLAIM_SOURCE_DEPTH] memory claimGames, uint256 claimGameCount) = EscalationClaimSources
				.collect(address(escalationGame));
			for (uint256 gameIndex = 0; gameIndex < claimGameCount; gameIndex++) {
				_moveEscalationClaim(
					claimGames[gameIndex],
					targetVault,
					callerVault,
					debtToMove,
					snapshotTargetAllowance
				);
			}
		}
		uint256 callerEscalationRep;
		if (address(escalationGame) != address(0x0)) {
			try escalationGame.escrowedRepByVault(callerVault) returns (uint256 claimRep) {
				callerEscalationRep = claimRep;
			} catch {
				revert('Claim balance failed');
			}
		}
		require(
			SecurityPoolUtils.isVaultHealthy(
				pool.poolOwnershipToRep(securityVaults[callerVault].poolOwnership),
				callerEscalationRep,
				securityVaults[callerVault].securityBondAllowance,
				repEthPrice,
				statoblastSecurityMultiplierBps
			),
			'Caller bad'
		);
	}

	function _moveEscalationClaim(
		address game,
		address fromVault,
		address toVault,
		uint256 numerator,
		uint256 denominator
	) private {
		(bool claimMoved, ) = game.call(
			abi.encodeWithSignature(
				'moveEscalationClaim(address,address,uint256,uint256)',
				fromVault,
				toVault,
				numerator,
				denominator
			)
		);
		require(claimMoved, 'Claim move failed');
	}
}
