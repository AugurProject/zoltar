import Inv48FinalObservedTransferFunding
import Inv48RawEscrowScheduleSimpleEntry
import Inv48WrapperArgsSource
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.FundingFallthrough Inv48.RequestClassify Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
namespace Inv48.FinalObservedTransfer
open Inv48.CanonicalEscrowDispatch
open Inv48.QuoteFeeBounds
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000
theorem simpleRawFunding (wrapper : FunctionDef)
    (found : Inv48.RequestPrologue.publicRequest = some wrapper)
    (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (n helperFuel : Nat) (schedule : Schedule) (parentBudget : Nat) (quoteFn : InternalFunction)
    (quoteLinked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some quoteFn)
    (base : Context) (state : State) (self sender value : Nat) (data : List Byte)
    (initialOpen : base.selfDispatch? = none)
    (selector : Nat) (args : List Value)
    (read : ABI.readSelector? data = some selector)
    (selected : Inv48.Source.model.core.findFunctionBySelector? selector = some wrapper)
    (decoded : ABI.decodeFunctionArgs? wrapper (data.drop ABI.selectorBytes) = .ok args)
    (raw : SolI ABI.AbiCallResult) (observed : Inv48.NestedResponder.Observation raw) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext ((n+helperFuel+69)+9) Inv48.Source.model.core
      base state self sender value data = some raw)
    (completed : observed.outcome = .ok out) (success : out.success = true) :
    ∃ plan : Inv48.WrapperTraversal.Plan Inv48.Source.model.core.table wrapper.body,
      Inv48.WrapperTraversal.plan 100 Inv48.Source.model.core.table wrapper.body = some plan ∧
      plan.args = Inv48.WrapperArgs.callArgs ∧
    ∃ p a b result,
      args = [.word p,.word a,.word b] ∧
      finish Inv48.Source.model.core wrapper state result = .ok out ∧
      ∃ site : Site (Stmt.eval ((n+helperFuel+69)+9) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        (Inv48.RequestPrologue.publicBase
          (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
          state p a b) wrapper.body) Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call observed.trace result,
        site.context = (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data) ∧
        site.fuel = (n+helperFuel+69)+4 ∧
        Inv48.WrapperArgs.TempValues site.runtime (SolidCore.Solidity.Shared.norm sender) p a b 4000000 ∧
        Expr.evalRefArgList site.context site.runtime Inv48.WrapperArgs.callArgs =
          pure (Inv48.WrapperArgs.inputs (SolidCore.Solidity.Shared.norm sender) p a b 4000000,site.runtime) ∧
        ∃ bodyResult bt ft rest final,
          site.after = (bt++ft)++rest ∧
          Interaction.Executes (Stmt.eval ((n+helperFuel+69)+3) Inv48.Source.model.core.table
            {site.context with checked := true}
            (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b 4000000)
            fn.body) bt (.ok bodyResult) ∧
          Interaction.Executes (internalCallFinish fn ["_ret__requestPrice_0"] site.runtime.locals bodyResult)
            ft (.ok (.normal final)) ∧
          Interaction.Executes (site.continuation (.normal final)) rest (.ok result) ∧
          (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b 4000000).lookupLocal? "sponsor" = some (.word (SolidCore.Solidity.Shared.norm sender)) ∧
          Inv48.GuardArgsFrame.Lookups
            (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b 4000000) p a b ∧
          Inv48.FinalObservedTransfer.Funding n helperFuel {schedule with environment := (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)} parentBudget (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data) raw observed
            (Inv48.WrapperArgs.inputs (SolidCore.Solidity.Shared.norm sender) p a b 4000000) ["_ret__requestPrice_0"] Inv48.WrapperArgs.callArgs
            site final (bt++ft) rest quoteFn := by
  have run := observed.execution
  rw [completed] at run
  obtain ⟨plan,planFound⟩ := Inv48.WrapperTraversal.wrapperPlan "requestSecurityPoolPrice" wrapper (by decide) found
  have planArgs := Inv48.WrapperArgs.plannedArgs "requestSecurityPoolPrice" wrapper (by decide) found plan planFound
  obtain ⟨p,a,b,result,argsEq,finished,site,contextEq,fuel,temps,
    bodyResult,bt,ft,rest,final,split,bodyRun,finishRun,last,sponsor,lookups⟩ :=
    Inv48.RawEscrowSchedule.Simple.rawEntry wrapper found fn registered (n+helperFuel+69)
      base state self sender value data selector args read selected decoded raw observed.trace out
      linked run success
  have evaluated := Inv48.WrapperArgs.evaluated site.context site.runtime
    (SolidCore.Solidity.Shared.norm sender) p a b 4000000 temps
  have first : Interaction.Executes (Stmt.eval ((n+helperFuel+67)+6)
      Inv48.Source.model.core.table site.context site.runtime Inv48.SimpleWrapperArgs.call)
      (bt++ft) (.ok (.normal final)) := by
    have entered := Inv48.GuardArgsFrame.entered fn registered site.runtime
      (SolidCore.Solidity.Shared.norm sender) p a b 4000000
    change internalCallEnter? fn
      (Inv48.WrapperArgs.inputs (SolidCore.Solidity.Shared.norm sender) p a b 4000000) site.runtime = _ at entered
    have joined := Interaction.Executes.bind_ok bodyRun finishRun
    unfold Inv48.SimpleWrapperArgs.call
    rw [show (n+helperFuel+67)+6 = ((n+helperFuel+69)+3)+1 by omega,Stmt.eval]
    dsimp only
    rw [evaluated]
    simp only [registered]
    change Interaction.Executes (match internalCallEnter? fn
      (Inv48.WrapperArgs.inputs (SolidCore.Solidity.Shared.norm sender) p a b 4000000) site.runtime with
      | none => pure (.reverted site.runtime .typeMismatch)
      | some (inner,saved) => Stmt.eval ((n+helperFuel+69)+3) Inv48.Source.model.core.table
        {site.context with checked := true} inner fn.body >>=
          internalCallFinish fn ["_ret__requestPrice_0"] saved) _ _
    rw [entered]
    exact joined
  exact ⟨plan,planFound,planArgs,p,a,b,result,argsEq,finished,site,contextEq,fuel,temps,evaluated,
    bodyResult,bt,ft,rest,final,split,bodyRun,finishRun,last,sponsor,lookups,
    Inv48.FinalObservedTransfer.fundingOfRecovered n helperFuel {schedule with environment := (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)} parentBudget (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data) raw observed rfl _ _ _ site evaluated final (bt++ft) rest
      split first last fn quoteFn registered quoteLinked
      (by rw [contextEq]) (by rw [contextEq]) (by rw [contextEq])
      (by rw [contextEq]) rfl rfl (Nat.mod_lt _ (by decide)) initialOpen⟩

#print axioms simpleRawFunding
end Inv48.FinalObservedTransfer
