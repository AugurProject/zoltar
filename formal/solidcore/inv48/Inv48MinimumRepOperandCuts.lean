import Inv48MinimumOperandTransportPublic
import Inv48EscrowEntryCompose
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumRepOperand
open Inv48.Positive Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
open Inv48.MinimumCollateralTrace Inv48.MinimumSuccessWords Inv48.MinimumSuffixPath
open Inv48.MinimumOperandTransport
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

structure RepCut (path : Path n c r trace out) where
  declared : Runtime
  declareTrace : Interaction.Transcript
  simpleTrace : Interaction.Transcript
  split : path.repTrace = declareTrace ++ simpleTrace
  declareRun : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c path.collateral
    [.varDecl .uint256 h1 none]) declareTrace (.ok (.normal declared))
  cut : Simple n c declared path.rep h1 ret2 key2 simpleTrace

theorem repCut (path : Path n c r trace out) : Nonempty (RepCut path) := by
  obtain ⟨declared,dt,st,sp,decl,run⟩ := normalPrefix (n+3) _ c path.collateral path.rep
    [.varDecl .uint256 h1 none] [simpleCode h1 ret2 key2] path.repTrace path.repRun
  obtain ⟨cut⟩ := simple (singleton _ _ _ _ _ _ _ run)
  exact ⟨⟨declared,dt,st,sp,decl,cut⟩⟩

def publicCut (path : Path n c r trace out) (s : RepCut path) :
    Cut (n+5) Inv48.Source.model.core.table c r Inv48.Public.body :=
  blockCut (n+4) _ c r path.outside prologue (.block inner) [] path.prologueTrace path.prologueRun
    (blockCut (n+3) _ c path.outside s.declared
      (guardPrefix ++ [simpleCode h0 ret1 key1] ++ [.varDecl .uint256 h1 none])
      (simpleCode h1 ret2 key2) suffix
      (path.guardTrace ++ (path.collateralTrace ++ s.declareTrace))
      (by
        have one : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c
            path.guarded [simpleCode h0 ret1 key1]) path.collateralTrace (.ok (.normal path.collateral)) := by
          rw [Stmt.evalList]
          simpa only [List.append_nil] using Interaction.Executes.bind_ok
            (next := fun v : Result => match v with
              | .normal rr => Stmt.evalList (n+3) Inv48.Source.model.core.table c rr []
              | v => pure v) path.collateralRun
            (show Inv48.EscrowPrefix.ExecutesOK
              (Stmt.evalList (n+3) Inv48.Source.model.core.table c path.collateral []) [] (.normal path.collateral) by
                rw [Stmt.evalList]; exact .done _)
        have first := Inv48.EscrowEntry.appendExecution _ _ _ _ _ _ _ _ _ _ path.guardRun one
        simpa only [List.append_assoc] using
          Inv48.EscrowEntry.appendExecution _ _ _ _ _ _ _ _ _ _ first s.declareRun)
      (simpleCut s.cut))

theorem completed (path : Path n c r trace out) (s : RepCut path)
    (body : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body)
      trace (.ok out)) :
    ∃ site : Inv48.RequestClassify.Site
      (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body)
      Inv48.Source.model.core.table (.internalCall [ret2] key2 []) trace out,
      site.runtime = s.cut.caller ∧
      site.after = s.cut.callTrace ++ (s.cut.copyTrace ++ path.suffixTrace) ∧
      Entered site.fuel Inv48.Source.model.core.table site.context site.runtime [ret2] key2
        s.cut.callTrace s.cut.callFinal ∧
      Interaction.Executes (site.continuation (.normal s.cut.callFinal))
        (s.cut.copyTrace ++ path.suffixTrace) (.ok out) := by
  let cut := publicCut path s
  have split : trace = cut.trace ++ (s.cut.callTrace ++ (s.cut.copyTrace ++ path.suffixTrace)) := by
    calc
      trace = _ := path.split
      _ = _ := by simp [s.split,s.cut.split,cut,publicCut,simpleCut,blockCut,captureCut,here,List.append_assoc]
  have reached : Prefix (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body)
      cut.trace (Stmt.eval (n+1) Inv48.Source.model.core.table c s.cut.caller
        (.internalCall [ret2] key2 []) >>= cut.continuation) := cut.reached
  have suffixRun := peel reached (by rw [← split]; exact body)
  have afterCall := peel (Prefix.ofExecution s.cut.callRun cut.continuation) suffixRun
  exact ⟨⟨n+1,c,s.cut.caller,cut.continuation,cut.trace,_,split,reached,suffixRun⟩,
    rfl,rfl,enter _ _ _ _ _ _ _ _ s.cut.callRun,afterCall⟩

#print axioms completed
#print axioms repCut
#print axioms publicCut
end Inv48.MinimumRepOperand
