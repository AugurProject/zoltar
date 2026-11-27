import Inv48PreLoopJoinTrack
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal
namespace Inv48.PreLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Successful raw operations entry, through actual cleanup and guards, to one
and the same recovered validation Site and its contiguous enclosing continuation.
No input lookup, scalar-gas lookup, successful occurrence, batch materialization,
length bound, or successful local prefix execution is a hypothesis. -/
theorem rawValidationInputs (wrapper : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some wrapper)
    (n : Nat) (base : Context) (state : State) (self sender value : Nat) (data : List Byte)
    (selector : Nat) (args : List Value)
    (read : ABI.readSelector? data = some selector)
    (selected : Inv48.Source.model.core.findFunctionBySelector? selector = some wrapper)
    (decoded : ABI.decodeFunctionArgs? wrapper (data.drop ABI.selectorBytes) = .ok args)
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+2) Inv48.Source.model.core
      base state self sender value data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    ∃ p a b rawBatch batch entryRuntime result,
      args = [.word p,.word a,.word b,rawBatch] ∧
      p < 2^256 ∧ a < 2^256 ∧ b < 2^256 ∧
      (Inv48.BatchLoopClosure.batchDecl wrapper).ty.coerceValue? rawBatch = some batch ∧
      Inv48.BatchInputLoop.Inputs entryRuntime p a b batch ∧
      finish Inv48.Source.model.core wrapper state result = .ok out ∧
      Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        entryRuntime wrapper.body) trace (.ok result) ∧
      ∃ s : Site (Stmt.eval (n+2) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        entryRuntime wrapper.body) Inv48.Source.model.core.table
        Inv48.OperationsWrapperArgs.loopP.value trace result,
        s.fuel = n ∧ Ready p a b batch s.runtime ∧
        ∃ final during rest,
          s.after = during++rest ∧
          Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table s.context s.runtime
            Inv48.OperationsWrapperArgs.loopP.value) during (.ok (.normal final)) ∧
          Interaction.Executes (s.continuation (.normal final)) rest (.ok result) ∧
          Inv48.BatchInputLoop.Inputs final p a b batch := by
  obtain ⟨p,a,b,rawBatch,argsEq,hp,ha,hb⟩ := decodedWords wrapper found _ args decoded
  have facts := List.all_eq_true.mp bothMetadata "requestSecurityPoolPriceWithOperations" (by decide)
  rw [show Inv48.Source.model.core.findFunctionByName? "requestSecurityPoolPriceWithOperations" = some wrapper
    from found,Option.any_some] at facts
  simp only [Bool.and_eq_true] at facts
  have accepts : wrapper.acceptsValue value = true := by simp [FunctionDef.acceptsValue,facts.1]
  obtain ⟨tree,result,entry,exec,done⟩ := body (n+2) Inv48.Source.model.core base state
    self sender value data selector wrapper args read selected decoded accepts raw trace out linked run
  have ordinary := successfulBodyOrdinary wrapper state result out (oneUint _ facts.2) done success
  unfold FunctionDef.evalBodyEntry at entry
  simp only [FunctionDef.acceptsValue,facts.1,Bool.true_or,if_true] at entry
  cases framed : wrapper.initialFrame? args with
  | none => simp [framed] at entry
  | some frame =>
    simp only [framed,Option.some.injEq] at entry
    rw [← entry] at exec
    have framedWords : wrapper.initialFrame? [.word p,.word a,.word b,rawBatch] = some frame := by
      rwa [← argsEq]
    obtain ⟨batch,bound,inputs⟩ := Inv48.BatchLoopClosure.initialFrameInputs wrapper found p a b rawBatch frame framedWords
    let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data
    let entryRuntime : Runtime :=
      {state := {state with
        selfBalance := SolidCore.Solidity.Shared.addWord
          (SolidCore.Solidity.Shared.Account.balanceAt c.accountBalances c.self) c.value
        worldMutatedSinceAdoption := true}
       locals := [frame]}
    change Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c entryRuntime wrapper.body)
      trace (.ok result) at exec
    obtain ⟨s,fuel,reject,ready⟩ := boundSite wrapper found n p a b batch hp ha hb c entryRuntime
      (inputs entryRuntime) trace result ordinary exec
    obtain ⟨v,during,rest,split,first,last⟩ := bindSuccess _ _ _ _ s.suffix
    have falls := safeSound 100 _ Inv48.OperationsPublicEntry.validationSafe s.fuel s.context s.runtime during v first
    have normal : ∃ final, v = .normal final := by
      cases v with
      | normal final => exact ⟨final,rfl⟩
      | reverted rt err => exact False.elim (reject (.reverted rt err) trivial rest last)
      | _ => contradiction
    obtain ⟨final,rfl⟩ := normal
    have loopRun : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table s.context s.runtime
        Inv48.OperationsWrapperArgs.loopP.value) during (.ok (.normal final)) := by
      simpa only [fuel] using first
    exact ⟨p,a,b,rawBatch,batch,_,result,argsEq,hp,ha,hb,bound,inputs entryRuntime,done,exec,
      s,fuel,ready,final,during,rest,split,loopRun,last,
      Inv48.BatchLoopClosure.validationInputs n s.context s.runtime final p a b 0 batch
        during ready.1 ready.2 loopRun⟩
end Inv48.PreLoopJoin
