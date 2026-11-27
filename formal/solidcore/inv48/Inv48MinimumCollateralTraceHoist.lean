import Inv48MinimumCollateralTraceEntry
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumCollateralTrace
open Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem normalPrefix (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (xs ys : List Stmt) (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.evalList n t c r (xs++ys)) tr (.ok (.normal final))) :
    ∃ mid before after, tr = before++after ∧
      Interaction.Executes (Stmt.evalList n t c r xs) before (.ok (.normal mid)) ∧
      Interaction.Executes (Stmt.evalList n t c mid ys) after (.ok (.normal final)) := by
  rw [Inv48.WholeQuote.listAppend] at run
  obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
  cases v with
  | normal mid => exact ⟨mid,a,b,split,first,last⟩
  | _ => cases last

theorem captureInternal (fuel : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (target key : String) (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval fuel t c r
      (.captureReturn [target] (.internalCall [target] key []))) tr (.ok (.normal final))) :
    ∃ n, fuel = n+1 ∧
      Interaction.Executes (Stmt.eval n t c r (.internalCall [target] key [])) tr (.ok (.normal final)) := by
  cases fuel with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [Stmt.eval] at run
    obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
    have never := Inv48.FundingFallthrough.neverSound 1 (.internalCall [target] key []) rfl n t c r
    cases v with
    | normal mid =>
      cases last
      simp only [List.append_nil] at split
      subst tr
      exact ⟨n,rfl,first⟩
    | returned rt vs => exact False.elim (never _ _ _ first)
    | _ => cases last

/-- Invert a successful generated hoist into its actual internal-call entry.
The helper execution is obtained from the hoist transcript, never supplied. -/
theorem hoistEntered (fuel : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (target key : String) (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval fuel t c r (Inv48.CollateralMinimum.hoist target key))
      tr (.ok (.normal final))) :
    ∃ n q mid before after callFinal during rest k,
      fuel = n+1 ∧ final = q.popScope ∧ tr = before++after ∧
      Interaction.Executes (Stmt.evalList n t c r.pushScope [.varDecl .uint256 target none])
        before (.ok (.normal mid)) ∧
      after = during++rest ∧ n = k+1 ∧
      Entered k t c mid [target] key during callFinal ∧
      Interaction.Executes (Stmt.evalList n t c callFinal [.assign (.var Inv03.Bodies.tmp) (.var target)])
        rest (.ok (.normal q)) := by
  obtain ⟨n,v,eq,outEq,first⟩ := block _ _ _ _ _ _ _ run
  cases v <;> simp only [Result.mapRuntime,Result.normal.injEq] at outEq
  all_goals try contradiction
  case normal q =>
    obtain ⟨mid,a,b,split,decl,last⟩ := normalPrefix n t c r.pushScope q
      [.varDecl .uint256 target none] _ tr first
    rw [Stmt.evalList] at last
    obtain ⟨w,d,e,split2,cap,assign⟩ := bindSuccess _ _ _ _ last
    cases w <;> try cases assign
    case normal callFinal =>
      obtain ⟨k,nEq,call⟩ := captureInternal n t c mid callFinal target key d cap
      exact ⟨n,q,mid,a,b,callFinal,d,e,k,eq,outEq,split,decl,split2,nEq,
        enter _ _ _ _ _ _ _ _ call,assign⟩
end Inv48.MinimumCollateralTrace
