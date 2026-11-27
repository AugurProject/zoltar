import Inv48MinimumSuffixPathCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuffixPath
open Inv48.Positive Inv48.RequestDispatch Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def roundCall : Stmt := .internalCall [roundRet] Inv32Bodies.Ceil.key [.var a0,.var a1,.var a2,.var a3]
def afterRound : List Stmt := [.varDecl .uint256 h3 none,maxCode,.returnValues [(castWord h3).core]]

private theorem captureCall (n : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c r
      (.captureReturn [roundRet] roundCall)) tr (.ok (.normal final))) :
    Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r roundCall)
      tr (.ok (.normal final)) := by
  rw [Stmt.eval] at run
  obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
  have never := Inv48.FundingFallthrough.neverSound 1 roundCall rfl (n+1)
    Inv48.Source.model.core.table c r
  cases v with
  | normal mid =>
    cases last
    simp only [List.append_nil] at split
    subst tr
    exact first
  | returned rt vs => exact False.elim (never _ _ _ first)
  | _ => cases last

/-- The actual rounded invocation, cut from Path.suffixRun, with its original
caller scope, argument-evaluation tree and the remaining generated statements. -/
structure Rounded (path : Path n c r trace out) where
  declared : Runtime
  caller : Runtime
  callFinal : Runtime
  copied : Runtime
  final : Runtime
  value : Result
  declareTrace : Interaction.Transcript
  argsTrace : Interaction.Transcript
  callTrace : Interaction.Transcript
  copyTrace : Interaction.Transcript
  remainingTrace : Interaction.Transcript
  split : path.suffixTrace = declareTrace ++ ((argsTrace ++ (callTrace ++ copyTrace)) ++ remainingTrace)
  declareRun : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c path.rep
    [.varDecl .uint256 h2 none]) declareTrace (.ok (.normal declared))
  argsRun : Interaction.Executes (Stmt.evalList (n+2) Inv48.Source.model.core.table c declared.pushScope
    (roundArgs.map Inv32Actions.Action.core)) argsTrace (.ok (.normal caller))
  callRun : Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c caller roundCall)
    callTrace (.ok (.normal callFinal))
  copyRun : Interaction.Executes (Stmt.evalList (n+2) Inv48.Source.model.core.table c callFinal
    [.assign (.var h2) (.var roundRet)]) copyTrace (.ok (.normal copied))
  scope : final = copied.popScope
  remainingRun : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c final afterRound)
    remainingTrace (.ok path.value)

 theorem rounded (path : Path n c r trace out) (ordinary : ¬ Escapes out) :
    Nonempty (Rounded path) := by
  have valueOrd : ¬ Escapes path.value := by
    apply Inv48.MinimumCollateralTrace.popOrdinary
    apply Inv48.MinimumCollateralTrace.popOrdinary
    rwa [← path.originalResult]
  have run := path.suffixRun
  change Interaction.Executes (Stmt.evalList (n+3) _ c path.rep
    ([.varDecl .uint256 h2 none] ++ ([roundCode] ++ afterRound))) _ (.ok path.value) at run
  obtain ⟨declared,dt,rest,sp,decl,run⟩ := Inv48.MinimumCollateralTrace.listPrefix _ _ _ _ _ _ _ _ (by decide) valueOrd run
  obtain ⟨final,bt,rt,sp2,body,last⟩ := Inv48.MinimumCollateralTrace.listPrefix _ _ _ _ _ _ _ _ (by decide) valueOrd run
  have body := Inv48.MinimumCollateralTrace.singleton _ _ _ _ _ _ _ body
  obtain ⟨k,v,eq,finalEq,list⟩ := Inv48.MinimumCollateralTrace.block _ _ _ _ _ _ _ body
  have kEq : k = n+2 := by omega
  subst k
  cases v <;> simp only [Result.mapRuntime] at finalEq
  all_goals try contradiction
  case normal copied =>
    have normalEq := Result.normal.inj finalEq
    change Interaction.Executes (Stmt.evalList (n+2) _ c declared.pushScope
      (roundArgs.map Inv32Actions.Action.core ++
        [.captureReturn [roundRet] roundCall,.assign (.var h2) (.var roundRet)])) bt (.ok (.normal copied)) at list
    obtain ⟨caller,argt,rest2,sp3,args,run⟩ := Inv48.MinimumCollateralTrace.normalPrefix _ _ _ _ _ _ _ _ list
    obtain ⟨callFinal,ct,xt,sp4,call,copy⟩ := Inv48.MinimumCollateralTrace.normalPrefix (n+2) _ c caller copied
      [.captureReturn [roundRet] roundCall] [.assign (.var h2) (.var roundRet)] rest2 run
    have call := Inv48.MinimumCollateralTrace.singleton _ _ _ _ _ _ _ call
    have call := captureCall n c caller callFinal ct call
    exact ⟨⟨declared,caller,callFinal,copied,final,path.value,dt,argt,ct,xt,rt,
      by rw [sp,sp2,sp3,sp4],decl,args,call,copy,normalEq,last⟩⟩

#print axioms rounded
end Inv48.MinimumSuffixPath
