import Inv48FinalObservedTransferFunding
import Inv48RawEscrowScheduleOperationsEntry
import Inv48ObservedOperationsCall
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.FundingFallthrough Inv48.RequestClassify Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
namespace Inv48.FinalObservedTransfer
open Inv48.CanonicalEscrowDispatch
open Inv48.QuoteFeeBounds
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000
theorem operationsRawFunding (wrapper : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some wrapper)
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
    (linked : ABI.Contract.callCalldataAtFromWithContext ((n+helperFuel+68)+9) Inv48.Source.model.core
      base state self sender value data = some raw)
    (completed : observed.outcome = .ok out) (success : out.success = true) :
    ∃ p a b rawBatch batch entryRuntime result,
      args = [.word p,.word a,.word b,rawBatch] ∧
      (Inv48.BatchLoopClosure.batchDecl wrapper).ty.coerceValue? rawBatch = some batch ∧
      finish Inv48.Source.model.core wrapper state result = .ok out ∧
      Interaction.Executes (Stmt.eval ((n+helperFuel+68)+9) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        entryRuntime wrapper.body) observed.trace (.ok result) ∧
      ∃ needed g, needed ≤ g ∧ g < 2^32 ∧ 4000000+g ≤ 10000000 ∧
        ∃ site : Site (Stmt.eval ((n+helperFuel+68)+9) Inv48.Source.model.core.table
          (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
          entryRuntime wrapper.body) Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call observed.trace result,
          site.context = (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data) ∧
        site.fuel = (n+helperFuel+68)+5 ∧
          Inv48.WrapperArgs.TempValues site.runtime (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g) ∧
          ∃ bodyResult bt ft rest final,
            site.after = (bt++ft)++rest ∧
            Interaction.Executes (Stmt.eval ((n+helperFuel+68)+4) Inv48.Source.model.core.table
              {site.context with checked := true}
              (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g))
              fn.body) bt (.ok bodyResult) ∧
            Interaction.Executes (internalCallFinish fn ["_ret__requestPrice_0"] site.runtime.locals bodyResult)
              ft (.ok (.normal final)) ∧
            Interaction.Executes (site.continuation (.normal final)) rest (.ok result) ∧
            (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g)).lookupLocal? "sponsor" =
              some (.word (SolidCore.Solidity.Shared.norm sender)) ∧
            (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g)).lookupLocal? "callbackGasLimit" =
              some (.word (4000000+g)) ∧
            Inv48.GuardArgsFrame.Lookups
              (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g)) p a b ∧
            Inv48.FinalObservedTransfer.Funding n helperFuel {schedule with environment := (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)} parentBudget (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data) raw observed
              (Inv48.WrapperArgs.inputs (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g))
              ["_ret__requestPrice_0"] Inv48.WrapperArgs.callArgs site final (bt++ft) rest quoteFn := by
  have run := observed.execution
  rw [completed] at run
  obtain ⟨p,a,b,rawBatch,batch,entryRuntime,result,argsEq,bound,done,exec,needed,g,le,hg,limit,
    site,contextEq,sfuel,temps,bodyResult,bt,ft,rest,final,split,bodyRun,finishRun,last,sponsor,gasLookup,lookups⟩ :=
    Inv48.RawEscrowSchedule.Operations.rawEntry wrapper found fn registered (n+helperFuel+68)
      base state self sender value data selector args read selected decoded raw observed.trace out linked run success
  have evaluated := Inv48.WrapperArgs.evaluated site.context site.runtime
    (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g) temps
  have first := Inv48.ObservedOperationsCall.callOfBody ((n+helperFuel+68)+4) site.context site.runtime final
    (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g) fn registered temps bodyResult bt ft bodyRun finishRun
  have aligned : ((n+helperFuel+68)+4)+1 = (n+helperFuel+67)+6 := by omega
  rw [aligned] at first
  exact ⟨p,a,b,rawBatch,batch,entryRuntime,result,argsEq,bound,done,exec,needed,g,le,hg,limit,
    site,contextEq,sfuel,temps,bodyResult,bt,ft,rest,final,split,bodyRun,finishRun,last,sponsor,gasLookup,lookups,
    Inv48.FinalObservedTransfer.fundingOfRecovered n helperFuel {schedule with environment := (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)} parentBudget (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data) raw observed rfl _ _ _ site evaluated
      final (bt++ft) rest split first last fn quoteFn registered quoteLinked
      (by rw [contextEq]) (by rw [contextEq]) (by rw [contextEq])
      (by rw [contextEq]) rfl rfl (Nat.mod_lt _ (by decide)) initialOpen⟩
#print axioms operationsRawFunding
end Inv48.FinalObservedTransfer
