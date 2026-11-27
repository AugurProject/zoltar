import Inv48MinimumOperandTransportCuts
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumOperandTransport
open Inv48.Positive Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
open Inv48.MinimumCollateralTrace Inv48.MinimumSuccessWords Inv48.MinimumSuffixPath
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def collateralCut (path : Path n c r trace out)
    (s : Simple n c path.guarded path.collateral h0 ret1 key1 path.collateralTrace) :
    Cut (n+5) Inv48.Source.model.core.table c r Inv48.Public.body :=
  blockCut (n+4) _ c r path.outside prologue (.block inner) [] path.prologueTrace path.prologueRun
    (blockCut (n+3) _ c path.outside path.guarded guardPrefix (simpleCode h0 ret1 key1)
      (repPrefix ++ suffix) path.guardTrace path.guardRun (simpleCut s))

theorem completedCollateral (path : Path n c r trace out)
    (s : Simple n c path.guarded path.collateral h0 ret1 key1 path.collateralTrace)
    (body : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body)
      trace (.ok out)) :
    ∃ site : Inv48.RequestClassify.Site
      (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body)
      Inv48.Source.model.core.table (.internalCall [ret1] key1 []) trace out,
      site.runtime = s.caller ∧ site.context = c ∧ site.fuel = n+1 ∧
      site.after = s.callTrace ++ (s.copyTrace ++ (path.repTrace ++ path.suffixTrace)) ∧
      Entered site.fuel Inv48.Source.model.core.table site.context site.runtime [ret1] key1
        s.callTrace s.callFinal ∧
      Interaction.Executes (site.continuation (.normal s.callFinal))
        (s.copyTrace ++ (path.repTrace ++ path.suffixTrace)) (.ok out) := by
  let cut := collateralCut path s
  have split : trace = cut.trace ++ (s.callTrace ++ (s.copyTrace ++ (path.repTrace ++ path.suffixTrace))) := by
    calc
      trace = _ := path.split
      _ = _ := by simp [s.split,cut,collateralCut,simpleCut,blockCut,captureCut,here,List.append_assoc]
  have reached : Prefix (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body)
      cut.trace (Stmt.eval (n+1) Inv48.Source.model.core.table c s.caller
        (.internalCall [ret1] key1 []) >>= cut.continuation) := cut.reached
  have suffixRun := peel reached (by rw [← split]; exact body)
  have afterCall := peel (Prefix.ofExecution s.callRun cut.continuation) suffixRun
  exact ⟨⟨n+1,c,s.caller,cut.continuation,cut.trace,_,split,reached,suffixRun⟩,
    rfl,rfl,rfl,rfl,enter _ _ _ _ _ _ _ _ s.callRun,afterCall⟩

/-- The input of the existing helper recovery is built from the path's own
collateral call. The caller and continuation are the dependent cuts above. -/
theorem recoveredCollateral (path : Path n c r trace out)
    (s : Simple n c path.guarded path.collateral h0 ret1 key1 path.collateralTrace)
    (body : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body)
      trace (.ok out)) :
    Recovered (n+5) c r trace out := by
  obtain ⟨site,_,_,_,split,entered,last⟩ := completedCollateral path s body
  exact completedList _ _ _ _ _ ⟨site,s.callFinal,s.callTrace,_,split,entered,last⟩

#print axioms collateralCut
#print axioms completedCollateral
#print axioms recoveredCollateral
end Inv48.MinimumOperandTransport
