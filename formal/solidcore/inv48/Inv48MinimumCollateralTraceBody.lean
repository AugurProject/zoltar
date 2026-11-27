import Inv48MinimumCollateralTraceCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumCollateralTrace
open Inv48.RequestDispatch Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem singleton (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (s : Stmt) (tr : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.evalList n t c r [s]) tr (.ok out)) :
    Interaction.Executes (Stmt.eval n t c r s) tr (.ok out) := by
  rw [Stmt.evalList] at run
  obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
  cases v <;> simp only [Stmt.evalList] at last <;> cases last <;>
    simp only [List.append_nil] at split <;> subst tr <;> exact first

theorem skipCons (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (ss : List Stmt) (tr : Interaction.Transcript) (out : Result)
    (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.evalList n t c r (.skip::ss)) tr (.ok out)) :
    Interaction.Executes (Stmt.evalList n t c r ss) tr (.ok out) := by
  cases n with
  | zero => rw [Stmt.evalList,Stmt.eval] at run; cases run
  | succ n => simpa only [Stmt.evalList,Stmt.eval] using run

/-- Descend the actual three generated scopes to the source list. All runtime
and transcript evidence comes from the supplied enclosing execution. -/
theorem bodyList (fuel : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.CollateralMinimum.table c r
      Inv48.Minima.collateralBody) tr (.ok out)) :
    ∃ n value, fuel = n+3 ∧
      out = ((value.mapRuntime Runtime.popScope).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope ∧
      ¬ Escapes value ∧
      Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c
        r.pushScope.pushScope.pushScope Inv48.CollateralMinimum.minimumList) tr (.ok value) := by
  rw [Inv48.CollateralMinimum.minimumBodyShape] at run
  obtain ⟨n,a,eq,oa,first⟩ := block _ _ _ _ _ _ _ run
  have ordinaryA : ¬ Escapes a := popOrdinary a (by rwa [oa] at ordinary)
  have second := singleton _ _ _ _ _ _ _ (skipCons _ _ _ _ _ _ _ ordinaryA first)
  obtain ⟨m,b,eq2,ab,second⟩ := block _ _ _ _ _ _ _ second
  have ordinaryB : ¬ Escapes b := popOrdinary b (by rwa [ab] at ordinaryA)
  have third := singleton _ _ _ _ _ _ _ second
  obtain ⟨k,v,eq3,bv,last⟩ := block _ _ _ _ _ _ _ third
  refine ⟨k,v,by omega,?_,?_,last⟩
  · rw [oa,ab,bv]
  · exact popOrdinary v (by rwa [bv] at ordinaryB)

/-- Recover the exact aggregate invocation and source tail from the same list,
using the existing prefix classifier rather than a fresh helper success. -/
theorem listStages (n : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c r
      Inv48.CollateralMinimum.minimumList) tr (.ok out)) :
    ∃ mid before after, tr = before++after ∧
      Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c r
        [ .varDecl .uint256 Inv48.Minima.operand (some (.castOp .uintCleanup 256 (.immutable "minimumReportCollateral"))),
          .varDecl .uint256 Inv03.Bodies.tmp none,
          Inv48.CollateralMinimum.hoist Inv48.CollateralMinimum.aggregateRet Inv48.CollateralMinimum.aggregateKey])
        before (.ok (.normal mid)) ∧
      Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c mid
        Inv48.Minima.collateralTail) after (.ok out) := by
  exact listPrefix _ _ _ _ _ _ _ _ (by decide) ordinary run
end Inv48.MinimumCollateralTrace
