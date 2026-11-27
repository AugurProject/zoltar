import Inv48SimpleWrapperArgsDecode
import Inv48SimpleWrapperArgsReach
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.FundingFallthrough Inv48.RequestClassify Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
namespace Inv48.RawEscrowSchedule.Simple
open Inv48.SimpleWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

theorem emptyPrefix {α : Type} {root tail : SolI α} (h : Prefix root [] tail) : root = tail := by
  cases h
  rfl

theorem cutRejects (n : Nat) (c : Context) (state : State) (p a b : Nat)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256)
    (out : Result) (ordinary : ¬ Escapes out) :
    Rejects (wrapperCut n c state p a b hp ha hb).continuation out := by
  intro v escaped trace run
  cases v <;> try contradiction
  all_goals
    change Interaction.Executes (pure _) trace (.ok out) at run
    cases run
    exact ordinary trivial

/-- Arbitrary successful raw simple-wrapper execution. All five temporaries,
including the callback value, are derived before the same call's body is entered.
The original wrapper's continuation and contiguous trace slices are retained. -/
theorem rawEntry (wrapper : FunctionDef)
    (found : Inv48.RequestPrologue.publicRequest = some wrapper)
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
    ∃ p a b result,
      args = [.word p,.word a,.word b] ∧
      finish Inv48.Source.model.core wrapper state result = .ok out ∧
      ∃ site : Site (Stmt.eval (n+9) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        (Inv48.RequestPrologue.publicBase
          (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
          state p a b) wrapper.body) Inv48.Source.model.core.table call trace result,
        site.context = ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data ∧
        site.fuel = n+4 ∧
        Inv48.WrapperArgs.TempValues site.runtime (SolidCore.Solidity.Shared.norm sender) p a b 4000000 ∧
        ∃ bodyResult bt ft rest final,
          site.after = (bt++ft)++rest ∧
          Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table
            {site.context with checked := true}
            (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b 4000000)
            fn.body) bt (.ok bodyResult) ∧
          Interaction.Executes (internalCallFinish fn ["_ret__requestPrice_0"] site.runtime.locals bodyResult)
            ft (.ok (.normal final)) ∧
          Interaction.Executes (site.continuation (.normal final)) rest (.ok result) ∧
          (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b 4000000).lookupLocal? "sponsor" = some (.word (SolidCore.Solidity.Shared.norm sender)) ∧
          Inv48.GuardArgsFrame.Lookups
            (Inv48.GuardArgsFrame.entry site.runtime (SolidCore.Solidity.Shared.norm sender) p a b 4000000) p a b := by
  obtain ⟨p,a,b,argsEq,hp,ha,hb⟩ := decodedWords wrapper found _ args decoded
  let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data
  obtain ⟨actual,actualFound,params,returns,payable,_⟩ := Inv48.RequestPrologue.publicRegistered
  have same : actual = wrapper := Option.some.inj (actualFound.symm.trans found)
  subst actual
  have accepts : wrapper.acceptsValue value = true := by simp [FunctionDef.acceptsValue,payable]
  obtain ⟨tree,result,entry,exec,done⟩ := body (n+9) Inv48.Source.model.core base state self sender value data
    selector wrapper args read selected decoded accepts raw trace out linked run
  have publicEntry := publicEntryFor (n+9) c state p a b wrapper found
  rw [argsEq,publicEntry] at entry
  have treeEq := Option.some.inj entry
  rw [← treeEq] at exec
  have ordinary : ¬ Escapes result := successfulBodyOrdinary wrapper state result out
    (by simp [returns]) done success
  let cut := wrapperCut n c state p a b hp ha hb
  obtain ⟨empty,fuel,context,statement,values⟩ := cutValues n c state p a b hp ha hb
  have reached := cut.reached
  rw [empty,statement] at reached
  have rootEq := emptyPrefix reached
  have shape := wrapperBody wrapper found
  rw [shape] at exec
  rw [rootEq] at exec
  obtain ⟨v,during,rest,split,first,last⟩ := bindSuccess _ _ _ _ exec
  have reject := cutRejects n c state p a b hp ha hb result ordinary
  have never := neverSound 1 call rfl cut.siteFuel Inv48.Source.model.core.table cut.context cut.runtime
  have normal : ∃ final, v = .normal final := by
    cases v with
    | normal final => exact ⟨final,rfl⟩
    | returned r vs => exact False.elim (never _ _ _ first)
    | _ =>
      apply False.elim
      apply reject _ ?_ rest last
      trivial
  obtain ⟨final,rfl⟩ := normal
  let site : Site (Stmt.eval (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a b) wrapper.body)
      Inv48.Source.model.core.table call trace result :=
    ⟨cut.siteFuel,cut.context,cut.runtime,cut.continuation,[],trace,rfl,
      by simpa only [shape,statement,empty] using cut.reached,
      by simpa only [statement] using exec⟩
  have tempValues : Inv48.WrapperArgs.TempValues site.runtime
      (SolidCore.Solidity.Shared.norm sender) p a b 4000000 := values
  have callRun : Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table site.context
      site.runtime call) during (.ok (.normal final)) := by simpa only [fuel] using first
  obtain ⟨bodyResult,bt,ft,callSplit,bodyRun,finishRun,lookups⟩ :=
    Inv48.WrapperArgs.actualEntry (n+3) site.context site.runtime final ["_ret__requestPrice_0"] fn
      registered (SolidCore.Solidity.Shared.norm sender) p a b 4000000 tempValues during callRun
  refine ⟨p,a,b,result,argsEq,done,site,context,fuel,tempValues,bodyResult,bt,ft,rest,final,?_,
    bodyRun,finishRun,last,?_,lookups⟩
  · exact split.trans (congrArg (fun t => t++rest) callSplit)
  · rfl
end Inv48.RawEscrowSchedule.Simple
