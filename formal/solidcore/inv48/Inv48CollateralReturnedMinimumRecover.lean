import Inv48MinimumCollateralTraceHoist
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralReturnedMinimum
open Inv48.MinimumCollateralTrace Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The aggregate entry is descended from the actual first three collateral
statements; its transcript precedes the actual collateral source tail. -/
theorem aggregateEntered (n : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c r
      Inv48.CollateralMinimum.minimumList) tr (.ok out)) :
    ∃ tailStart prefixTrace tailTrace mid before after q callFinal during rest k,
      tr = prefixTrace++tailTrace ∧ prefixTrace = before++after ∧
      Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c r
        [ .varDecl .uint256 Inv48.Minima.operand (some (.castOp .uintCleanup 256 (.immutable "minimumReportCollateral"))),
          .varDecl .uint256 Inv03.Bodies.tmp none]) before (.ok (.normal mid)) ∧
      after = during++rest ∧
      Entered k Inv48.CollateralMinimum.table c
        (mid.pushScope.declareLocal Inv48.CollateralMinimum.aggregateRet (.word 0))
        [Inv48.CollateralMinimum.aggregateRet] Inv48.CollateralMinimum.aggregateKey during callFinal ∧
      tailStart = Runtime.popScope q ∧
      n = (k+1)+1 ∧
      Interaction.Executes (Stmt.evalList (k+1) Inv48.CollateralMinimum.table c callFinal
        [.assign (.var Inv03.Bodies.tmp) (.var Inv48.CollateralMinimum.aggregateRet)]) rest (.ok (.normal q)) ∧
      Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c tailStart
        Inv48.Minima.collateralTail) tailTrace (.ok out) := by
  obtain ⟨tailStart,pt,tt,split,first,tail⟩ := listStages n c r tr out ordinary run
  obtain ⟨mid,a,b,split2,decl,last⟩ := normalPrefix n _ c r tailStart
    [ .varDecl .uint256 Inv48.Minima.operand (some (.castOp .uintCleanup 256 (.immutable "minimumReportCollateral"))),
      .varDecl .uint256 Inv03.Bodies.tmp none] _ pt first
  have hoist := singleton _ _ _ _ _ _ _ last
  obtain ⟨m,q,inside,pre,post,callFinal,ct,rest,k,nEq,outEq,split3,decl2,split4,mEq,entered,assign⟩ :=
    hoistEntered n _ c mid tailStart _ _ b hoist
  have insideEq : inside = mid.pushScope.declareLocal Inv48.CollateralMinimum.aggregateRet (.word 0) := by
    have d := singleton _ _ _ _ _ _ _ decl2
    cases m with
    | zero => rw [Stmt.eval] at d; cases d
    | succ m =>
      rw [Inv48.CloneGetters.decl_none] at d
      simp only [Ty.defaultValue] at d
      cases d
      rfl
  subst inside
  have preNil : pre = [] := by
    have d := singleton _ _ _ _ _ _ _ decl2
    cases m with
    | zero => rw [Stmt.eval] at d; cases d
    | succ m => rw [Inv48.CloneGetters.decl_none] at d; simp only [Ty.defaultValue] at d; cases d; rfl
  subst pre
  simp only [List.nil_append] at split3
  subst b
  exact ⟨tailStart,pt,tt,mid,a,post,q,callFinal,ct,rest,k,split,split2,decl,split4,entered,outEq,by omega,by simpa only [mEq] using assign,tail⟩
end Inv48.CollateralReturnedMinimum
