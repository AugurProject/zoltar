import Inv48MinimumSuffixPathObservation
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumOperandTransport
open Inv48.Positive Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
open Inv48.MinimumCollateralTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem peel (h : Prefix tree before tail)
    (run : Interaction.Executes tree (before ++ after) result) :
    Interaction.Executes tail after result := by
  induction h with
  | refl => exact run
  | request answer rest ih => cases run; exact ih (by assumption)

structure Simple (n : Nat) (c : Context) (r final : Runtime) (dst ret key : String)
    (trace : Interaction.Transcript) where
  caller : Runtime
  callFinal : Runtime
  copied : Runtime
  declareTrace : Interaction.Transcript
  callTrace : Interaction.Transcript
  copyTrace : Interaction.Transcript
  split : trace = declareTrace ++ (callTrace ++ copyTrace)
  declareRun : Interaction.Executes (Stmt.evalList (n+2) Inv48.Source.model.core.table c r.pushScope
    [.varDecl .uint256 ret none]) declareTrace (.ok (.normal caller))
  callRun : Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c caller
    (.internalCall [ret] key [])) callTrace (.ok (.normal callFinal))
  copyRun : Interaction.Executes (Stmt.evalList (n+2) Inv48.Source.model.core.table c callFinal
    [.assign (.var dst) (.var ret)]) copyTrace (.ok (.normal copied))
  scope : final = copied.popScope

theorem simple (run : Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c r
    (simpleCode dst ret key)) trace (.ok (.normal final))) :
    Nonempty (Simple n c r final dst ret key trace) := by
  obtain ⟨k,v,eq,outEq,list⟩ := block _ _ _ _ _ _ _ run
  have ke : k = n+2 := by omega
  subst k
  cases v <;> simp only [Result.mapRuntime,Result.normal.injEq] at outEq
  all_goals try contradiction
  case normal copied =>
    obtain ⟨caller,dt,rest,sp,decl,last⟩ := normalPrefix (n+2) _ c r.pushScope copied
      [.varDecl .uint256 ret none] _ trace list
    obtain ⟨cf,ct,xt,sp2,cap,copy⟩ := normalPrefix (n+2) _ c caller copied
      [.captureReturn [ret] (.internalCall [ret] key [])] _ rest last
    obtain ⟨k,eq,call⟩ := captureInternal _ _ _ _ _ _ _ _ (singleton _ _ _ _ _ _ _ cap)
    have ke : k = n+1 := by omega
    subst k
    exact ⟨⟨caller,cf,copied,dt,ct,xt,by rw [sp,sp2],decl,call,copy,outEq⟩⟩

def simpleCut (s : Simple n c r final dst ret key trace) :
    Cut (n+3) Inv48.Source.model.core.table c r (simpleCode dst ret key) :=
  blockCut (n+2) _ c r s.caller [.varDecl .uint256 ret none]
    (.captureReturn [ret] (.internalCall [ret] key [])) [.assign (.var dst) (.var ret)]
    s.declareTrace s.declareRun
    (captureCut (n+1) _ c s.caller [ret] (.internalCall [ret] key [])
      (here (n+1) _ c s.caller (.internalCall [ret] key [])))

#print axioms peel
#print axioms simple
#print axioms simpleCut
end Inv48.MinimumOperandTransport
