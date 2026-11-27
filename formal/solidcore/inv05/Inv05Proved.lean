import Inv05HarnessBindings
import Inv05Issuance
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv05

def mint (s : State) (cash units net : Nat) :=
  CheckedWordCall.read Inv03.model s "mintUnits" (Harness.args cash units net)

/-- Complete public outcome on an empty book or a nonempty book with positive net cash. The production cash cap
implies that the deposited scaled cash fits; the issued quotient can still overflow. -/
theorem mintAllUnits (s : State) (cash units net : Nat) (cap : cash<2^128)
    (hu : units<R) (hn : net<R) (funded : units=0 ∨ 0<net) :
    mint s cash units net = allUnits cash units net := by
  let c := CheckedWordCall.ctx Inv03.model
  have hc : cash<R := lt_trans cap (by decide)
  have fits : cash*10^9<R := lt_trans (Nat.mul_lt_mul_of_pos_right cap (by decide : 0<10^9)) (by decide)
  have run := Harness.execute 49968 c (CheckedWordCall.initial c s) cash units net hc hu hn funded fits
  rw [←Harness.checkedBody] at run
  cases Q : allUnits cash units net with
  | some a =>
    rw [Q] at run
    exact CheckedWordCall.returnsWord _ Harness.fn _ s _ _ a (Option.some_get _).symm (Harness.frameOk _ _ _)
      Harness.returns Harness.accepts run
  | none =>
    rw [Q] at run
    obtain ⟨nr,e,ev⟩ := run
    exact CheckedWordCall.reverts _ Harness.fn _ s _ _ nr e (Option.some_get _).symm (Harness.frameOk _ _ _) Harness.accepts ev

theorem publicMint (s : State) (cash units net : Nat) (cap : cash<2^128)
    (hu : units<R) (hn : net<R) (up : 0<units) (np : 0<net) :
    mint s cash units net = result cash units net := by
  simpa [allUnits,Nat.ne_of_gt up] using mintAllUnits s cash units net cap hu hn (Or.inr np)

/-- Every successful funded mint leaves less than one pre-mint net-cash numerator
of rounding residual and weakly increases the incumbent cash per unit. -/
theorem incumbentValue (s : State) (cash units net added : Nat) (cap : cash<2^128)
    (hu : units<R) (hn : net<R) (up : 0<units) (np : 0<net)
    (minted : mint s cash units net = some added) :
    added*net ≤ cash*10^9*units ∧ cash*10^9*units-added*net < net ∧
      net*(units+added) ≤ (net+cash*10^9)*units := by
  rw [publicMint _ _ _ _ cap hu hn up np] at minted
  rw [(Harness.resultSmall _ _ _ _ minted).1]
  exact issuance cash units net np
end Inv05

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for name in #[``Inv05.publicMint,``Inv05.incumbentValue] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected INV-05 axiom {dep}"
