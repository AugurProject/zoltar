import Inv48MinimumCollateralTraceBody
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumCollateralTrace
open Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def Recovered (fuel : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result) : Prop :=
  ∃ s : Inv48.RequestClassify.Site
      (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body)
      Inv48.Source.model.core.table (.internalCall [Inv48.Positive.ret1] Inv48.Positive.key1 []) tr out,
    ∃ final during rest n fn inner saved value bodyTrace finishTrace k listValue,
      s.after = during++rest ∧ s.fuel = n+1 ∧
      Inv48.Source.model.core.table.lookup? Inv48.Positive.key1 = some fn ∧
      fn.body = Inv48.Minima.collateralBody ∧
      internalCallEnter? fn [] s.runtime = some (inner,saved) ∧
      during = bodyTrace++finishTrace ∧ n = k+3 ∧
      value = ((listValue.mapRuntime Runtime.popScope).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope ∧
      ¬ Escapes listValue ∧
      Interaction.Executes (Stmt.evalList k Inv48.CollateralMinimum.table
        {s.context with checked := true} inner.pushScope.pushScope.pushScope
        Inv48.CollateralMinimum.minimumList) bodyTrace (.ok listValue) ∧
      Interaction.Executes (internalCallFinish fn
        [Inv48.Positive.ret1] saved value) finishTrace (.ok (.normal final)) ∧
      Interaction.Executes (s.continuation (.normal final)) rest (.ok out)

/-- Specialize the collateral component of rawHelperBodies using its actual
generated table link. The three source scopes and their execution are inverted;
no independently supplied helper or tail success appears in the premises. -/
theorem completedList (fuel : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result)
    (completed : CompletedBody fuel c r tr out [Inv48.Positive.ret1] Inv48.Positive.key1) :
    Recovered fuel c r tr out := by
  unfold Recovered
  obtain ⟨s,final,during,rest,split,entered,last⟩ := completed
  obtain ⟨n,fn,inner,saved,value,bt,ft,fuelEq,found,entry,traceEq,body,finish,ordinary⟩ := entered
  obtain ⟨expected,lookup,params,returns,shape⟩ := Inv48.Minima.TableCheck.generatedLinks.1
  have same : fn = expected := Option.some.inj (found.symm.trans lookup)
  subst fn
  rw [shape] at body
  obtain ⟨k,v,nEq,valueEq,ord,run⟩ := bodyList n _ inner bt value ordinary body
  exact ⟨s,final,during,rest,n,expected,inner,saved,value,bt,ft,k,v,split,fuelEq,lookup,shape,entry,traceEq,nEq,valueEq,ord,run,finish,last⟩
end Inv48.MinimumCollateralTrace

namespace Inv48.MinimumCollateralTrace
open Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumSuccessWords
/-- Raw ABI entry into the collateral source list. The recovered source-list
execution retains its original public site and the actual internal finish. -/
theorem rawCollateralList (n : Nat) (base : Context) (state : State)
    (self sender : Nat) (data : List Byte) (p : Nat)
    (read : ABI.readSelector? data = some 4197127132)
    (selected : Inv48.Source.model.core.findFunctionBySelector? 4197127132 = some Inv48.PositiveABI.entry)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry (data.drop ABI.selectorBytes) = .ok [.word p])
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+5) Inv48.Source.model.core
      base state self sender 0 data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data
    let r := Inv48.Positive.start (Inv48.Positive.entryBase c state) p
    0 < p ∧ ∃ result,
      finish Inv48.Source.model.core Inv48.PositiveABI.entry state result = .ok out ∧
      Recovered (n+5) c r trace result := by
  obtain ⟨positive,result,done,body,collateral,rep⟩ := rawHelperBodies n base state self sender data p
    read selected decoded raw trace out linked run success
  exact ⟨positive,result,done,completedList _ _ _ _ _ collateral⟩
end Inv48.MinimumCollateralTrace
