import Inv48OperationsRawJoinRaw
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal Inv48.PostLoopJoin
namespace Inv48.RawEscrowSchedule.Operations
open Inv48.OperationsRawJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Raw operations entry to the checked request body on the same trace. The
validation inputs and exact continuation belong to one recovered witness. -/
theorem rawEntry (wrapper : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some wrapper)
    (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (n : Nat) (base : Context) (state : State) (self sender value : Nat) (data : List Byte)
    (selector : Nat) (args : List Value)
    (read : ABI.readSelector? data = some selector)
    (selected : Inv48.Source.model.core.findFunctionBySelector? selector = some wrapper)
    (decoded : ABI.decodeFunctionArgs? wrapper (data.drop ABI.selectorBytes) = .ok args)
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+9) Inv48.Source.model.core
      base state self sender value data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    ∃ p a b rawBatch batch entryRuntime result,
      args = [.word p,.word a,.word b,rawBatch] ∧
      (Inv48.BatchLoopClosure.batchDecl wrapper).ty.coerceValue? rawBatch = some batch ∧
      finish Inv48.Source.model.core wrapper state result = .ok out ∧
      Interaction.Executes (Stmt.eval (n+9) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        entryRuntime wrapper.body) trace (.ok result) ∧
      ∃ needed g, needed ≤ g ∧ g < 2^32 ∧ 4000000+g ≤ 10000000 ∧
        ∃ site : Site (Stmt.eval (n+9) Inv48.Source.model.core.table
          (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
          entryRuntime wrapper.body) Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call trace result,
          site.context = ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data ∧
          site.fuel = n+5 ∧
          Inv48.WrapperArgs.TempValues site.runtime (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g) ∧
          ∃ bodyResult bt ft rest final,
            site.after = (bt++ft)++rest ∧
            Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table
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
              (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g)) p a b := by
  obtain ⟨p,a,b,rawBatch,batch,entryRuntime,result,argsEq,hp,ha,hb,bound,_,done,exec,
    validation,fuel,context,⟨ys,zs,continuation⟩,ready,_⟩ :=
    rawValidationInputs wrapper found (n+7) base state self sender value data selector args
      read selected decoded raw trace out linked run success
  let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data
  have ordinary := successfulBodyOrdinary wrapper state result out
    (by
      have facts := List.all_eq_true.mp Inv48.WrapperTraversal.bothMetadata "requestSecurityPoolPriceWithOperations" (by decide)
      rw [show Inv48.Source.model.core.findFunctionByName? "requestSecurityPoolPriceWithOperations" = some wrapper from found,Option.any_some] at facts
      simp only [Bool.and_eq_true] at facts
      exact Inv48.WrapperTraversal.oneUint _ facts.2) done success
  have cont : validation.continuation = enclosing (n+7) c ys zs := by
    simpa only [context] using continuation
  obtain ⟨needed,g,le,hg,limit,site,sfuel,scontext,temps,bodyResult,bt,ft,rest,final,split,body,finish,last⟩ :=
    fromValidation n c ys zs validation fuel context cont ordinary (publicChecked base self sender value data)
      p a b 0 batch hp ha hb ready.1 ready.2 fn registered
  refine ⟨p,a,b,rawBatch,batch,entryRuntime,result,argsEq,bound,done,exec,needed,g,le,hg,limit,
    site,scontext,sfuel,temps,bodyResult,bt,ft,rest,final,split,?_,finish,last,?_,?_,?_⟩
  · simpa only [scontext] using body
  · rfl
  · rfl
  · exact ⟨by rfl,by rfl,by rfl⟩
end Inv48.RawEscrowSchedule.Operations
