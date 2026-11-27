import Inv48LiquidationFinish
import Inv48LiquidationRawSuccess
import Inv48LiquidationSourceLinkedGetter
import Inv48LiquidationGuardArithmetic
import Inv48RawPriceMonotonePublic
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RawPriceMonotone
set_option maxHeartbeats 20000000
set_option maxRecDepth 65536

theorem outputDecoded (s : Certificate r) :
    abiDecodeValuesExcept? [.uint256] r.out.output = .ok [.word (value s)] := by
  rw [s.bytes]
  have fit : value s < Inv32Division.R := max_lt s.Cfit s.quotientFit
  have norm : Shared.norm (value s) = value s := Nat.mod_eq_of_lt fit
  rw [ABI.encodeWord]
  change abiDecodeValuesExcept? [.uint256] (ABI.wordToBytesBE 32 (Shared.norm (value s))) = _
  rw [norm]
  exact Inv48.Minima.canonicalDecode (value s) fit

theorem decodedComparison (low high : Run) (sameBase : low.base.base = high.base.base)
    (stable : StableExposure low high) (rise : low.price ≤ high.price) :
    ∃ l : Certificate low, ∃ h : Certificate high,
      abiDecodeValuesExcept? [.uint256] high.out.output = .ok [.word (value h)] ∧
      abiDecodeValuesExcept? [.uint256] low.out.output = .ok [.word (value l)] ∧
      value h ≤ value l := by
  obtain ⟨l,h,order⟩ := comparison low high sameBase stable rise
  exact ⟨l,h,outputDecoded h,outputDecoded l,order⟩

#print axioms observationFromRaw
#print axioms recover
#print axioms exportComparison
#print axioms outputDecoded
#print axioms decodedComparison
end Inv48.RawPriceMonotone
