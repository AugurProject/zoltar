// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGameStorage } from './EscalationGameStorage.sol';
import {
	EscalationClaimBundle,
	ForkedEscrowState,
	MAX_CLAIM_BUNDLES_PER_VAULT,
	MAX_CLAIM_OWNERS_PER_BUNDLE,
	MAX_PAYOUT_CLAIM_IMPORT_BATCH,
	MAX_PAYOUT_CLAIM_BUNDLES
} from './EscalationGameTypes.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface IEscalationClaimGameContext {
	function securityPool() external view returns (address);
}

interface IEscalationClaimCheckpointSource {
	function applyInheritedClaimRetention(uint256 amount, uint256 parentDepositIndex) external view returns (uint256);
	function payoutClaimBundleCount() external view returns (uint256);
	function payoutClaimBundleKeyAt(uint256 index) external view returns (address);
	function getPayoutClaimOwner(
		address payoutKey,
		uint256 ownerIndex
	) external view returns (address ownerAddress, uint256 ownerShares, uint256 totalShares, uint256 escrowedRep);
	function rootClaimSourceGame() external view returns (address);
}

contract EscalationGameClaimDelegate is EscalationGameStorage {
	event EscalationClaimMoved(
		address indexed fromVault,
		address indexed toVault,
		uint256 numerator,
		uint256 denominator
	);
	event PayoutClaimCheckpointImported(
		address indexed sourceGame,
		uint256 startIndex,
		uint256 endIndex,
		uint256 sourceBundleCount
	);

	function moveEscalationClaim(address fromVault, address toVault, uint256 numerator, uint256 denominator) external {
		_validateClaimMover();
		address sourceGame = forkCarrySourceGame;
		require(
			sourceGame == address(0x0) ||
				forkCarryPayoutClaimImportCursor ==
					IEscalationClaimCheckpointSource(sourceGame).payoutClaimBundleCount(),
			'Claim checkpoint pending'
		);
		require(fromVault != address(0x0) && toVault != address(0x0) && fromVault != toVault, 'Vault');
		require(numerator > 0 && numerator <= denominator, 'Fraction');
		_moveRegistryClaims(payoutClaimBundlesByOwner, payoutClaimBundles, fromVault, toVault, numerator, denominator);
		_moveRegistryClaims(claimBundlesByOwner, escalationClaimBundles, fromVault, toVault, numerator, denominator);
		_moveClaimAccounting(fromVault, toVault, numerator, denominator);
		emit EscalationClaimMoved(fromVault, toVault, numerator, denominator);
	}
	function payoutClaimBundleCount() external view returns (uint256) {
		return payoutClaimBundleKeys.length;
	}

	function forkPayoutClaimCheckpointComplete() external view returns (bool) {
		address sourceGame = forkCarrySourceGame;
		return
			sourceGame == address(0x0) ||
			forkCarryPayoutClaimImportCursor == IEscalationClaimCheckpointSource(sourceGame).payoutClaimBundleCount();
	}

	function payoutClaimBundleKeyAt(uint256 index) external view returns (address) {
		return payoutClaimBundleKeys[index];
	}

	function rootClaimSourceGame() external view returns (address) {
		return forkCarryRootClaimSourceGame == address(0x0) ? address(this) : forkCarryRootClaimSourceGame;
	}

	function applyInheritedClaimRetention(uint256 amount, uint256 parentDepositIndex) external view returns (uint256) {
		address encodedSourceGame = address(uint160(parentDepositIndex >> 96));
		address sourceGame = encodedSourceGame == address(0x0) ? forkCarryRootClaimSourceGame : encodedSourceGame;
		if (sourceGame == address(0x0) || sourceGame == address(this)) return amount;
		(bool mantissaSuccess, bytes memory mantissaData) = sourceGame.staticcall(
			abi.encodeWithSignature('cumulativeClaimRetention()')
		);
		(bool exponentSuccess, bytes memory exponentData) = sourceGame.staticcall(
			abi.encodeWithSignature('cumulativeClaimRetentionExponent()')
		);
		require(mantissaSuccess && mantissaData.length == 32, 'Claim retention source');
		require(exponentSuccess && exponentData.length == 32, 'Claim retention exponent');
		uint256 sourceMantissa = abi.decode(mantissaData, (uint256));
		uint256 sourceExponent = abi.decode(exponentData, (uint256));
		require(
			cumulativeClaimRetentionExponent > sourceExponent ||
				(cumulativeClaimRetentionExponent == sourceExponent && cumulativeClaimRetention <= sourceMantissa),
			'Claim retention order'
		);
		uint256 retained = Math.mulDiv(amount, cumulativeClaimRetention, sourceMantissa);
		uint256 exponentDifference = cumulativeClaimRetentionExponent - sourceExponent;
		return exponentDifference >= 256 ? 0 : retained >> exponentDifference;
	}

	function applyInheritedSourceStorageBasis(
		uint256 amount,
		uint256 cumulativeAmount,
		uint256 parentDepositIndex
	) external view returns (uint256) {
		address sourceGame = forkCarrySourceGame;
		if (sourceGame == address(0x0)) return amount;
		require(cumulativeAmount >= amount, 'Carry cumulative low');
		uint256 retainedCumulativeAmount = IEscalationClaimCheckpointSource(sourceGame).applyInheritedClaimRetention(
			cumulativeAmount,
			parentDepositIndex
		);
		uint256 retainedPreviousAmount = IEscalationClaimCheckpointSource(sourceGame).applyInheritedClaimRetention(
			cumulativeAmount - amount,
			parentDepositIndex
		);
		require(retainedCumulativeAmount >= retainedPreviousAmount, 'Carry retention order');
		return retainedCumulativeAmount - retainedPreviousAmount;
	}

	function getClaimOwner(
		address bundleId,
		uint256 ownerIndex
	) external view returns (address ownerAddress, uint256 ownerShares, uint256 totalShares) {
		(ownerAddress, ownerShares, totalShares, ) = _getPayoutClaimOwner(
			_payoutClaimKey(address(this), bundleId),
			ownerIndex
		);
	}

	function getPayoutClaimOwner(
		address payoutKey,
		uint256 ownerIndex
	) external view returns (address ownerAddress, uint256 ownerShares, uint256 totalShares, uint256 escrowedRep) {
		return _getPayoutClaimOwner(payoutKey, ownerIndex);
	}

	function liquidationClaimRepByVault(address vault) external view returns (uint256 amount) {
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = payoutClaimBundlesByOwner[vault];
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address bundleId = bundleIds[bundleIndex];
			if (bundleId == address(0x0)) continue;
			EscalationClaimBundle storage bundle = payoutClaimBundles[bundleId];
			for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
				if (bundle.owners[ownerIndex] != vault || bundle.totalShares == 0) continue;
				uint256 bundleRep = _applyTruthAuctionRetention(bundle.escrowedRep);
				amount += (bundleRep * bundle.ownerShares[ownerIndex]) / bundle.totalShares;
				break;
			}
		}
	}

	function previewLiquidationClaimRep(
		address vault,
		uint256 numerator,
		uint256 denominator
	) external view returns (uint256 amount) {
		require(denominator > 0 && numerator <= denominator, 'Fraction');
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = payoutClaimBundlesByOwner[vault];
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address bundleId = bundleIds[bundleIndex];
			if (bundleId == address(0x0)) continue;
			EscalationClaimBundle storage bundle = payoutClaimBundles[bundleId];
			for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
				if (bundle.owners[ownerIndex] != vault || bundle.totalShares == 0) continue;
				uint256 ownerShares = bundle.ownerShares[ownerIndex];
				uint256 sharesToMove =
					numerator == denominator ? ownerShares : Math.mulDiv(ownerShares, numerator, denominator);
				amount += Math.mulDiv(
					_applyTruthAuctionRetention(bundle.escrowedRep),
					sharesToMove,
					bundle.totalShares
				);
				break;
			}
		}
	}

	function getLiquidationClaimPortfolio(
		address vault
	)
		external
		view
		returns (
			uint256[MAX_CLAIM_BUNDLES_PER_VAULT] memory bundleRep,
			uint256[MAX_CLAIM_BUNDLES_PER_VAULT] memory ownerShares,
			uint256[MAX_CLAIM_BUNDLES_PER_VAULT] memory totalShares
		)
	{
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = payoutClaimBundlesByOwner[vault];
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address bundleId = bundleIds[bundleIndex];
			if (bundleId == address(0x0)) continue;
			EscalationClaimBundle storage bundle = payoutClaimBundles[bundleId];
			for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
				if (bundle.owners[ownerIndex] != vault || bundle.totalShares == 0) continue;
				bundleRep[bundleIndex] = _applyTruthAuctionRetention(bundle.escrowedRep);
				ownerShares[bundleIndex] = bundle.ownerShares[ownerIndex];
				totalShares[bundleIndex] = bundle.totalShares;
				break;
			}
		}
	}

	function importForkPayoutClaims(uint256 maximumBundles) external {
		require(msg.sender == IEscalationClaimGameContext(address(this)).securityPool(), 'Only pool');
		require(forkContinuation && forkResumedAt == 0, 'Fork not paused');
		require(maximumBundles > 0 && maximumBundles <= MAX_PAYOUT_CLAIM_IMPORT_BATCH, 'Claim import batch');
		address sourceGame = forkCarrySourceGame;
		require(sourceGame != address(0x0), 'Claim source missing');
		_importForkPayoutClaims(sourceGame, maximumBundles);
	}

	function initializeForkPayoutClaimCheckpoint(address sourceGame) external {
		require(msg.sender == IEscalationClaimGameContext(address(this)).securityPool(), 'Only pool');
		require(sourceGame == forkCarrySourceGame && forkCarryPayoutClaimImportCursor == 0, 'Claim source');
		require(truthAuctionRepBefore == 0, 'Haircut applied');
		IEscalationClaimCheckpointSource source = IEscalationClaimCheckpointSource(sourceGame);
		address rootSource = source.rootClaimSourceGame();
		forkCarryRootClaimSourceGame = rootSource == address(0x0) ? sourceGame : rootSource;
		(bool retentionSuccess, bytes memory retentionData) = sourceGame.staticcall(
			abi.encodeWithSignature('cumulativeClaimRetention()')
		);
		(bool exponentSuccess, bytes memory exponentData) = sourceGame.staticcall(
			abi.encodeWithSignature('cumulativeClaimRetentionExponent()')
		);
		require(retentionSuccess && retentionData.length == 32, 'Claim retention source');
		require(exponentSuccess && exponentData.length == 32, 'Claim retention exponent');
		cumulativeClaimRetention = abi.decode(retentionData, (uint256));
		cumulativeClaimRetentionExponent = abi.decode(exponentData, (uint256));
	}

	function _getPayoutClaimOwner(
		address payoutKey,
		uint256 ownerIndex
	) private view returns (address ownerAddress, uint256 ownerShares, uint256 totalShares, uint256 escrowedRep) {
		require(ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE, 'Claim owner index');
		EscalationClaimBundle storage bundle = payoutClaimBundles[payoutKey];
		return (
			bundle.owners[ownerIndex],
			bundle.ownerShares[ownerIndex],
			bundle.totalShares,
			_applyTruthAuctionRetention(bundle.escrowedRep)
		);
	}

	function _importForkPayoutClaims(address sourceGame, uint256 maximumBundles) private {
		IEscalationClaimCheckpointSource source = IEscalationClaimCheckpointSource(sourceGame);
		uint256 sourceCount = source.payoutClaimBundleCount();
		require(sourceCount <= MAX_PAYOUT_CLAIM_BUNDLES, 'Claim checkpoint full');
		uint256 start = forkCarryPayoutClaimImportCursor;
		uint256 end = start + maximumBundles;
		if (end > sourceCount) end = sourceCount;
		for (uint256 sourceIndex = forkCarryPayoutClaimImportCursor; sourceIndex < end; sourceIndex++) {
			address payoutKey = source.payoutClaimBundleKeyAt(sourceIndex);
			EscalationClaimBundle storage destination = payoutClaimBundles[payoutKey];
			require(destination.totalShares == 0, 'Claim already imported');
			for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
				(address ownerAddress, uint256 ownerShares, uint256 totalShares, uint256 escrowedRep) = source
					.getPayoutClaimOwner(payoutKey, ownerIndex);
				if (destination.totalShares == 0) {
					destination.totalShares = totalShares;
					destination.escrowedRep = escrowedRep;
				}
				destination.owners[ownerIndex] = ownerAddress;
				destination.ownerShares[ownerIndex] = ownerShares;
				if (ownerAddress != address(0x0) && ownerShares != 0) {
					_registerPayoutClaimBundle(ownerAddress, payoutKey);
				}
			}
			payoutClaimBundleKeys.push(payoutKey);
		}
		forkCarryPayoutClaimImportCursor = end;
		emit PayoutClaimCheckpointImported(sourceGame, start, end, sourceCount);
	}

	function _registerPayoutClaimBundle(address ownerAddress, address payoutKey) private {
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = payoutClaimBundlesByOwner[ownerAddress];
		uint256 emptyIndex = MAX_CLAIM_BUNDLES_PER_VAULT;
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address registeredBundle = bundleIds[bundleIndex];
			if (registeredBundle == payoutKey) return;
			if (registeredBundle == address(0x0) && emptyIndex == MAX_CLAIM_BUNDLES_PER_VAULT) {
				emptyIndex = bundleIndex;
			}
		}
		require(emptyIndex < MAX_CLAIM_BUNDLES_PER_VAULT, 'Claim portfolio full');
		bundleIds[emptyIndex] = payoutKey;
	}

	function _moveRegistryClaims(
		mapping(address => address[MAX_CLAIM_BUNDLES_PER_VAULT]) storage registry,
		mapping(address => EscalationClaimBundle) storage bundles,
		address fromVault,
		address toVault,
		uint256 numerator,
		uint256 denominator
	) private {
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = registry[fromVault];
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address bundleId = bundleIds[bundleIndex];
			if (bundleId == address(0x0)) continue;
			_moveBundleOwnership(registry, bundleId, bundles[bundleId], fromVault, toVault, numerator, denominator);
		}
	}

	function _moveBundleOwnership(
		mapping(address => address[MAX_CLAIM_BUNDLES_PER_VAULT]) storage registry,
		address bundleId,
		EscalationClaimBundle storage bundle,
		address fromVault,
		address toVault,
		uint256 numerator,
		uint256 denominator
	) private {
		uint256 fromOwnerIndex = _getBundleOwnerIndex(bundle, fromVault);
		uint256 fromShares = bundle.ownerShares[fromOwnerIndex];
		if (fromShares == 0) return;
		(bool destinationExists, uint256 toOwnerIndex, uint256 liveOwnerCount) = _findBundleOwner(bundle, toVault);
		if (numerator == denominator) {
			if (destinationExists) {
				bundle.ownerShares[toOwnerIndex] += fromShares;
				bundle.owners[fromOwnerIndex] = address(0x0);
				bundle.ownerShares[fromOwnerIndex] = 0;
			} else {
				bundle.owners[fromOwnerIndex] = toVault;
			}
			_unregisterClaimBundle(registry, fromVault, bundleId);
			_registerClaimBundle(registry, toVault, bundleId);
			return;
		}
		uint256 sharesToMove = (fromShares * numerator) / denominator;
		if (sharesToMove == 0) return;
		if (!destinationExists) {
			require(liveOwnerCount + 1 < MAX_CLAIM_OWNERS_PER_BUNDLE, 'Full close required');
			toOwnerIndex = _addBundleOwner(registry, bundleId, bundle, toVault);
		}
		bundle.ownerShares[fromOwnerIndex] = fromShares - sharesToMove;
		bundle.ownerShares[toOwnerIndex] += sharesToMove;
	}

	function _validateClaimMover() private view {
		ISecurityPool sourcePool = ISecurityPool(payable(IEscalationClaimGameContext(address(this)).securityPool()));
		if (msg.sender == address(sourcePool)) return;
		ISecurityPool callerPool = ISecurityPool(payable(msg.sender));
		require(address(callerPool.securityPoolFactory()) == address(sourcePool.securityPoolFactory()), 'Factory');
		bytes32 originId = callerPool.securityPoolFactory().getSecurityPoolOriginId(callerPool);
		require(
			originId != bytes32(0) &&
				originId == sourcePool.securityPoolFactory().getSecurityPoolOriginId(sourcePool) &&
				address(callerPool.securityPoolFactory().getSecurityPool(originId, callerPool.universeId())) ==
					msg.sender,
			'Claim source'
		);
	}

	function _moveClaimAccounting(address fromVault, address toVault, uint256 numerator, uint256 denominator) private {
		uint256 unresolvedToMove = _fraction(unresolvedRepByVault[fromVault], numerator, denominator);
		unresolvedRepByVault[fromVault] -= unresolvedToMove;
		unresolvedRepByVault[toVault] += unresolvedToMove;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			uint256 localToMove = _fraction(
				localUnresolvedPrincipalByVaultAndOutcome[fromVault][outcomeIndex],
				numerator,
				denominator
			);
			localUnresolvedPrincipalByVaultAndOutcome[fromVault][outcomeIndex] -= localToMove;
			localUnresolvedPrincipalByVaultAndOutcome[toVault][outcomeIndex] += localToMove;
			ForkedEscrowState storage fromForked = forkedEscrowByVaultAndOutcome[fromVault][outcomeIndex];
			ForkedEscrowState storage toForked = forkedEscrowByVaultAndOutcome[toVault][outcomeIndex];
			uint256 sourceToMove = _fraction(
				fromForked.sourcePrincipal - fromForked.sourcePrincipalClaimed,
				numerator,
				denominator
			);
			uint256 childToMove = _fraction(fromForked.childRep - fromForked.childRepClaimed, numerator, denominator);
			fromForked.sourcePrincipal -= sourceToMove;
			fromForked.childRep -= childToMove;
			toForked.sourcePrincipal += sourceToMove;
			toForked.childRep += childToMove;
		}
	}

	function _fraction(uint256 amount, uint256 numerator, uint256 denominator) private pure returns (uint256) {
		return numerator == denominator ? amount : (amount * numerator) / denominator;
	}

	function _findBundleOwner(
		EscalationClaimBundle storage bundle,
		address ownerAddress
	) private view returns (bool exists, uint256 ownerIndex, uint256 liveOwnerCount) {
		for (uint256 index = 0; index < MAX_CLAIM_OWNERS_PER_BUNDLE; index++) {
			if (bundle.owners[index] != address(0x0) && bundle.ownerShares[index] != 0) liveOwnerCount++;
			if (bundle.owners[index] == ownerAddress && bundle.ownerShares[index] != 0) {
				exists = true;
				ownerIndex = index;
			}
		}
	}

	function _getBundleOwnerIndex(
		EscalationClaimBundle storage bundle,
		address ownerAddress
	) private view returns (uint256) {
		for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			if (bundle.owners[ownerIndex] == ownerAddress) return ownerIndex;
		}
		revert('Claim owner missing');
	}

	function _addBundleOwner(
		mapping(address => address[MAX_CLAIM_BUNDLES_PER_VAULT]) storage registry,
		address bundleId,
		EscalationClaimBundle storage bundle,
		address ownerAddress
	) private returns (uint256 ownerIndex) {
		for (ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			if (bundle.owners[ownerIndex] != address(0x0) && bundle.ownerShares[ownerIndex] != 0) continue;
			bundle.owners[ownerIndex] = ownerAddress;
			_registerClaimBundle(registry, ownerAddress, bundleId);
			return ownerIndex;
		}
		revert('Claim owners full');
	}

	function _registerClaimBundle(
		mapping(address => address[MAX_CLAIM_BUNDLES_PER_VAULT]) storage registry,
		address ownerAddress,
		address bundleId
	) private {
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = registry[ownerAddress];
		uint256 emptyIndex = MAX_CLAIM_BUNDLES_PER_VAULT;
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address registeredBundle = bundleIds[bundleIndex];
			if (registeredBundle == bundleId) return;
			if (registeredBundle == address(0x0) && emptyIndex == MAX_CLAIM_BUNDLES_PER_VAULT) {
				emptyIndex = bundleIndex;
			}
		}
		if (emptyIndex == MAX_CLAIM_BUNDLES_PER_VAULT) revert();
		bundleIds[emptyIndex] = bundleId;
	}

	function _unregisterClaimBundle(
		mapping(address => address[MAX_CLAIM_BUNDLES_PER_VAULT]) storage registry,
		address ownerAddress,
		address bundleId
	) private {
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = registry[ownerAddress];
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			if (bundleIds[bundleIndex] != bundleId) continue;
			bundleIds[bundleIndex] = address(0x0);
			return;
		}
	}
}
