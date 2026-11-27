import Inv48RawMinimumResultHelpers
import Inv48QuoteContinuationIdentityExecution
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuffixPath
open Inv48.Positive Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def prologue : List Source.Stmt := [Inv32FloorFastPath.cleanParam "proposedRepPerEthPrice",.skip]
def guardPrefix : List Source.Stmt := [.requireStmt condition (some "Initial oracle price zero"),liquidationGuard,.varDecl .uint256 h0 none]
def repPrefix : List Source.Stmt := [.varDecl .uint256 h1 none,simpleCode h1 ret2 key2]
abbrev suffix := Inv48.MinimumSuccessInvert.innerTail
abbrev inner := guardPrefix ++ [simpleCode h0 ret1 key1] ++ repPrefix ++ suffix

/-- Successive cuts of one generated list. Neither a second selected site nor
an independently assumed suffix execution is stored here. -/
structure Path (n : Nat) (c : Context) (r : Runtime)
    (trace : Interaction.Transcript) (out : Result) where
  outside : Runtime
  guarded : Runtime
  collateral : Runtime
  rep : Runtime
  value : Result
  prologueTrace : Interaction.Transcript
  guardTrace : Interaction.Transcript
  collateralTrace : Interaction.Transcript
  repTrace : Interaction.Transcript
  suffixTrace : Interaction.Transcript
  split : trace = prologueTrace ++ (guardTrace ++ (collateralTrace ++ (repTrace ++ suffixTrace)))
  prologueRun : Interaction.Executes (Stmt.evalList (n+4) Inv48.Source.model.core.table c r.pushScope prologue)
    prologueTrace (.ok (.normal outside))
  guardRun : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c outside.pushScope guardPrefix)
    guardTrace (.ok (.normal guarded))
  collateralRun : Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c guarded (simpleCode h0 ret1 key1))
    collateralTrace (.ok (.normal collateral))
  repRun : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c collateral repPrefix)
    repTrace (.ok (.normal rep))
  suffixRun : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c rep suffix)
    suffixTrace (.ok value)
  originalResult : out = (value.mapRuntime Runtime.popScope).mapRuntime Runtime.popScope

 theorem recover (n : Nat) (c : Context) (r : Runtime)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body) trace (.ok out)) :
    Nonempty (Path n c r trace out) := by
  rw [bodyForm] at run
  obtain ⟨_,outer,eq,outEq,outerRun⟩ := Inv48.MinimumCollateralTrace.block _ _ _ _ _ _ _ run
  have outerOrd := Inv48.MinimumCollateralTrace.popOrdinary outer (by rwa [outEq] at ordinary)
  have outerFuel : ∀ k, n+5 = k+1 → k = n+4 := by omega
  have align := outerFuel _ eq
  subst align
  change Interaction.Executes (Stmt.evalList (n+4) _ c r.pushScope (prologue ++ [.block inner])) trace (.ok outer) at outerRun
  obtain ⟨outside,pt,it,sp,pre,inside⟩ := Inv48.MinimumCollateralTrace.listPrefix _ _ _ _ _ _ _ _ (by decide) outerOrd outerRun
  have inside := Inv48.MinimumCollateralTrace.singleton _ _ _ _ _ _ _ inside
  obtain ⟨k,value,eq2,outerEq,list⟩ := Inv48.MinimumCollateralTrace.block _ _ _ _ _ _ _ inside
  have kEq : k = n+3 := by omega
  subst k
  have valueOrd := Inv48.MinimumCollateralTrace.popOrdinary value (by rwa [outerEq] at outerOrd)
  change Interaction.Executes (Stmt.evalList (n+3) _ c outside.pushScope
    (guardPrefix ++ ([simpleCode h0 ret1 key1] ++ (repPrefix ++ suffix)))) it (.ok value) at list
  obtain ⟨guarded,gt,rest,sp2,guards,restRun⟩ := Inv48.MinimumCollateralTrace.listPrefix _ _ _ _ _ _ _ _ (by decide) valueOrd list
  obtain ⟨collateral,ct,rest2,sp3,first,restRun⟩ := Inv48.MinimumCollateralTrace.listPrefix _ _ _ _ _ _ _ _ (by decide) valueOrd restRun
  obtain ⟨rep,rt,st,sp4,second,last⟩ := Inv48.MinimumCollateralTrace.listPrefix _ _ _ _ _ _ _ _ (by decide) valueOrd restRun
  exact ⟨⟨outside,guarded,collateral,rep,value,pt,gt,ct,rt,st,
    by rw [sp,sp2,sp3,sp4],pre,guards,
    Inv48.MinimumCollateralTrace.singleton _ _ _ _ _ _ _ first,second,last,
    by rw [outEq,outerEq]⟩⟩

#print axioms recover
end Inv48.MinimumSuffixPath
