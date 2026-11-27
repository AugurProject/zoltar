import Inv48MinimumSuccessWordsCore
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessWords
open Inv48.RequestDispatch

/-- Inverting checked addition recovers its bound; no result budget is assumed. -/
theorem checkedAddRecovered (a b v : Nat) (ha : a < Inv32Division.R) (hb : b < Inv32Division.R)
    (success : checkedAdd true a b = .ok v) :
    a+b < Inv32Division.R ∧ v = a+b := by
  have h := Inv32Rounding.addition a b ha hb
  change (checkedAdd true a b).toOption = _ at h
  rw [success] at h
  by_cases fit : a+b < Inv32Division.R
  · rw [if_pos fit] at h
    exact ⟨fit,Option.some.inj h⟩
  · rw [if_neg fit] at h
    cases h

/-- Invert the Math helper's checked-addition return. The operand reads are
local inputs, not public helper-to-operands recovery. -/
theorem mathAdditionReturnRecovered (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (a b : Nat) (values : List Value) (trace : Interaction.Transcript)
    (ha : a < Inv32Division.R) (hb : b < Inv32Division.R) (checked : c.checked = true)
    (A : r.lookupLocal? Inv32CeilFlags.h2 = some (.word a))
    (B : r.lookupLocal? Inv32CeilFlags.h3 = some (.word b))
    (run : Interaction.Executes (Stmt.eval (n+1) t c r Inv32CeilAdd.ret)
      trace (.ok (.returned final values))) :
    a+b < Inv32Division.R ∧ values = [.word (a+b)] ∧ final = r ∧ trace = [] := by
  have fit : a+b < Inv32Division.R := by
    by_contra large
    rw [Inv32CeilAdd.bad n t c r a b ha hb (Nat.le_of_not_gt large) checked A B] at run
    cases run
  have good := Inv32CeilAdd.good n t c r a b ha hb fit checked
    (by simp [Inv32Actions.locals,A]) (by simp [Inv32Actions.locals,B])
  rw [good] at run
  cases run
  exact ⟨fit,rfl,rfl,rfl⟩
/-- Decoded uint256 exposure alone suffices for either exposure ceiling. -/
theorem exposureCeilingFits (x : Nat) (fit : x < Inv32Division.R) :
    Inv03.ceilQuot x 100 < Inv32Division.R := by
  have bound := (Inv03.ceil_le x 100 x (by decide)).mpr (by omega : x ≤ x*100)
  exact lt_of_le_of_lt bound fit

/-- Specialize the Math addition return to exposure-ceiling operands. This
return is not the collateral helper's final sum declaration. -/
theorem exposureAdditionAtMathReturn (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (base exposure : Nat) (values : List Value) (trace : Interaction.Transcript)
    (baseFits : base < Inv32Division.R) (exposureFits : exposure < Inv32Division.R)
    (checked : c.checked = true)
    (A : r.lookupLocal? Inv32CeilFlags.h2 = some (.word base))
    (B : r.lookupLocal? Inv32CeilFlags.h3 = some (.word (Inv03.ceilQuot exposure 100)))
    (run : Interaction.Executes (Stmt.eval (n+1) t c r Inv32CeilAdd.ret)
      trace (.ok (.returned final values))) :
    base + Inv03.ceilQuot exposure 100 < Inv32Division.R ∧
      values = [.word (base + Inv03.ceilQuot exposure 100)] := by
  have h := mathAdditionReturnRecovered n t c r final base (Inv03.ceilQuot exposure 100)
    values trace baseFits (exposureCeilingFits exposure exposureFits) checked A B run
  exact ⟨h.1,h.2.1⟩

/-- A representable final minimum entails the rounded REP budget. The budget is
an output of this lemma, not an assumed input to a forward execution theorem. -/
theorem minimumBudgetRecovered (C R p : Nat) (positive : 0 < p)
    (fit : Inv48.minimum C R p < Inv32Division.R) :
    C < Inv32Division.R ∧ R*10^18 ≤ (Inv32Division.R-1)*p := by
  have bound : Inv48.minimum C R p ≤ Inv32Division.R-1 := by omega
  have h := (Inv48.sufficient C R p (Inv32Division.R-1) positive).mp bound
  exact ⟨by omega,h.2⟩
end Inv48.MinimumSuccessWords
