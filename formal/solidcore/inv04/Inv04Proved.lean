import Inv04HarnessBindings
import Inv04RequiredCash

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv04

/-- On the specified execution domain the public call returns the least raw cash
amount whose scaled value covers both the units and the carried remainder. -/
theorem leastRequiredCash (state : State) (u n d rem : Nat)
    (hu : u<R) (hn : n<R) (hd : d<R) (hr : rem<R) (positive : 0<d)
    (fits : Inv03.ceilQuot (u*n) d+rem<R) :
    ∃ cash, CheckedWordCall.read Inv03.model state "requiredCash" (Harness.args u n d rem) = some cash ∧
      ∀ candidate, cash≤candidate ↔ u*n+rem*d ≤ (candidate*10^9)*d := by
  let c := CheckedWordCall.ctx Inv03.model
  have ev := Harness.execute 49972 c (CheckedWordCall.initial c state) u n d rem hu hn hd hr positive fits
  rw [←Harness.checkedBody] at ev
  exact ⟨Inv04Source.minimumCash u n d rem,CheckedWordCall.returnsWord Inv03.model Harness.fn "requiredCash" state _ _ _
    (Option.some_get _).symm (Harness.frameOk _ _ _ _) Harness.returns Harness.accepts ev,
    fun candidate => Inv04Source.minimumCash_le _ _ _ _ candidate positive⟩
end Inv04

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for dep in ← collectAxioms ``Inv04.leastRequiredCash do
    unless allowed.contains dep do throwError "Unexpected INV-04 axiom {dep}"
