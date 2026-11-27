import Inv48RawPriceMonotoneCore
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RawPriceMonotone
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Recover the observation once from the original raw ABI run. Deployment and
oracle assumptions are subsequently attached to this very witness, not a rerun. -/
theorem observationFromRaw (n : Nat) (base : Context) (state : State)
    (self sender : Nat) (data : List Source.Byte) (p : Nat)
    (read : ABI.readSelector? data = some 4197127132)
    (selected : Inv48.Source.model.core.findFunctionBySelector? 4197127132 = some Inv48.PositiveABI.entry)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry (data.drop ABI.selectorBytes) = .ok [.word p])
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+5) Inv48.Source.model.core
      base state self sender 0 data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    Nonempty (Inv48.MinimumRepOperand.Observation n
      (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data)
      state p trace out) := by
  obtain ⟨s⟩ := Inv48.RawMinimumResult.fromRaw n base state self sender data p read selected decoded raw trace out linked run success
  obtain ⟨s⟩ := Inv48.MinimumOperandTransport.extend s success (data.drop ABI.selectorBytes) decoded
  exact Inv48.MinimumRepOperand.extend s

/-- Export contains exact output bytes and leastness for each independently
recovered run, actual successful oracle reads, and the derived output order. -/
theorem exportComparison (low high : Run) (sameBase : low.base.base = high.base.base)
    (stable : StableExposure low high) (rise : low.price ≤ high.price) :
    ∃ l : Certificate low, ∃ h : Certificate high,
      high.out.output = ABI.encodeWord (value h) ∧
      low.out.output = ABI.encodeWord (value l) ∧
      (∀ amount, value h ≤ amount ↔ h.C ≤ amount ∧ h.R*10^18 ≤ amount*high.price) ∧
      (∀ amount, value l ≤ amount ↔ l.C ≤ amount ∧ l.R*10^18 ≤ amount*low.price) ∧
      value h ≤ value l := by
  obtain ⟨l,h,order⟩ := comparison low high sameBase stable rise
  exact ⟨l,h,h.bytes,l.bytes,h.least,l.least,order⟩

#print axioms observationFromRaw
#print axioms exportComparison
end Inv48.RawPriceMonotone
