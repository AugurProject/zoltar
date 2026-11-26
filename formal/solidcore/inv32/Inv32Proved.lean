import Inv32ForwardCall
import Inv32InverseSound
/-!
# INV-32 on the generated exact-input and exact-output entry points

`Inv32Source.quote` typechecks the generated harness and calls its public function in
SolidCore's interpreter. `forwardExecution` and `inverseExecution` connect those
observations (including the fee and reverts) to the integer quote functions.
`minimumGrossInput` combines both refinements with their arithmetic minimality theorem.
The call starts from empty state since both Solidity entry points are pure.
-/

open Inv32Division Inv32Dispatch Inv32Wrapper Inv32Observed
namespace Inv32Source
theorem forwardExecution (x y g f : Nat) (hx : x<R) (hy : y<R) (hg : g<R) (hf : f<R) :
    quote "quoteExactInput" x y g f =
      observation ((Inv32.quoteExactInput x y g f).map (fun q => (q,Inv32ForwardCall.netFee g f))) := by
  apply publicQuote .forward _ _ _ _ _ hx hy hg hf
  let r := work initial .forward x y g f 0 0
  have run := Inv32ForwardCall.call 49715 ctx r s0 s1 s2 s3 (targets .forward) x y g f hx hy hg hf rfl rfl rfl rfl
  unfold Inv32ForwardCall.Binds at run
  cases Q : Inv32.quoteExactInput x y g f <;> rw [Q] at run <;> exact run

theorem forwardRefines : ForwardRefines := by
  intro x y g f out hx hy hg hf
  unfold returnsAmount
  rw [forwardExecution x y g f hx hy hg hf]
  cases Q : Inv32.quoteExactInput x y g f <;> simp [observation]

/-- For the checked Solidity harness, an exact-output quote returns the minimum
    gross input whose exact-input quote reaches the requested output. -/
theorem minimumGrossInput (x y target fee quoted gross : Nat)
    (hx : x < Inv32.word) (hy : y < Inv32.word) (ht : target < Inv32.word)
    (hf : fee < Inv32.word) (hg : gross < Inv32.word)
    (returned : returnsAmount "quoteExactOutput" x y target fee quoted) :
    quoted ≤ gross ↔ ∃ out, returnsAmount "quoteExactInput" x y gross fee out ∧ target ≤ out :=
  minimumGrossInput_of_refinement forwardRefines inverseSound x y target fee quoted gross hx hy ht hf hg returned
end Inv32Source
#print axioms Inv32Source.minimumGrossInput

open Lean in
run_cmd
  let allowed := #[``propext, ``Classical.choice, ``Lean.ofReduceBool, ``Lean.trustCompiler, ``Quot.sound]
  for theoremName in #[``Inv32Source.forwardRefines, ``Inv32Source.inverseSound, ``Inv32Source.minimumGrossInput] do
    for dep in ← collectAxioms theoremName do
      unless allowed.contains dep do throwError "Unexpected axiom {dep} in {theoremName}"
