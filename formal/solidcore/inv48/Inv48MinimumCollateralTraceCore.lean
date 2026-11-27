import Inv48MinimumSuccessWordsPublic
import Inv48MinimumSuccessWordsOracle
import Inv48MinimumSuccessWordsTails
import Inv48CollateralMinimumExecution
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumCollateralTrace
open Inv48.RequestDispatch Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Invert a block without losing its actual child execution or transcript. -/
theorem block (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (ss : List Stmt) (tr : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval fuel t c r (.block ss)) tr (.ok out)) :
    ∃ n value, fuel = n+1 ∧ out = value.mapRuntime Runtime.popScope ∧
      Interaction.Executes (Stmt.evalList n t c r.pushScope ss) tr (.ok value) := by
  cases fuel with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [Stmt.eval] at run
    obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
    cases last
    simp only [List.append_nil] at split
    subst tr
    exact ⟨n,v,rfl,rfl,first⟩

/-- A nonescaping enclosing result makes the block child nonescaping. -/
theorem popOrdinary (v : Result) (h : ¬ Escapes (v.mapRuntime Runtime.popScope)) :
    ¬ Escapes v := by cases v <;> exact h

/-- A syntactically nonreturning prefix must finish normally when the enclosing
list has a nonescaping result. This uses the existing fuel-independent proof. -/
theorem listPrefix (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (xs ys : List Stmt) (tr : Interaction.Transcript) (out : Result)
    (safe : xs.all (loopFalls 10) = true) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.evalList n t c r (xs++ys)) tr (.ok out)) :
    ∃ mid before after, tr = before++after ∧
      Interaction.Executes (Stmt.evalList n t c r xs) before (.ok (.normal mid)) ∧
      Interaction.Executes (Stmt.evalList n t c mid ys) after (.ok out) := by
  rw [Inv48.WholeQuote.listAppend] at run
  obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
  have never := Inv48.FundingFallthrough.listNever n t c xs
    (fun s mem rt => loopNeverSound 10 s ((List.all_eq_true.mp safe) s mem) n t c rt) r
  cases v with
  | normal mid => exact ⟨mid,a,b,split,first,last⟩
  | returned rt vs => exact False.elim (never _ _ _ first)
  | _ => cases last; exact False.elim (ordinary trivial)
end Inv48.MinimumCollateralTrace
