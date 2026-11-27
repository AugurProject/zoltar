import Inv48WholeQuoteEventsRecovery
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WholeQuoteEvents
open Inv48.MinimumCollateralTrace Inv48.RequestDispatch Inv48.WrapperTraversal
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.QuoteMinimumEvents
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def minHoist := (hoistP Inv48.QuoteMinimumJoin.ret Inv48.QuoteMinimumJoin.key
  [cleanP (varP "proposedRepPerEthPrice")]).value

theorem minimumCut (n : Nat) (c : Context) (r final : Runtime)
    (run : Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table c r minP.value)
      tr (.ok (.normal final))) :
    ∃ caller called,
      Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c caller minimumCall)
        tr (.ok (.normal called)) := by
  have form : minP.value = .block ([zeroP.value] ++ [minHoist] ++
      [(declP "#view48027" (cleanP (varP "_sol_hoist_0"))).value,minGuardP.value]) := rfl
  rw [form] at run
  obtain ⟨before,after,hoisted⟩ := blockCut (n+3) c r final [zeroP.value]
    [(declP "#view48027" (cleanP (varP "_sol_hoist_0"))).value,minGuardP.value] minHoist
    (by decide) (by decide) run
  have hoistForm : minHoist = .block
    ([.varDecl .uint256 Inv32OneArg.argName (some (clean (.var "proposedRepPerEthPrice"))),
      .varDecl .uint256 Inv48.QuoteMinimumJoin.ret none] ++
      [.captureReturn [Inv48.QuoteMinimumJoin.ret] minimumCall] ++
      [.assign (.var "_sol_hoist_0") (.var Inv48.QuoteMinimumJoin.ret)]) := rfl
  rw [hoistForm] at hoisted
  obtain ⟨caller,called,captured⟩ := blockCut (n+2) c before after
    [.varDecl .uint256 Inv32OneArg.argName (some (clean (.var "proposedRepPerEthPrice"))),
      .varDecl .uint256 Inv48.QuoteMinimumJoin.ret none]
    [.assign (.var "_sol_hoist_0") (.var Inv48.QuoteMinimumJoin.ret)]
    (.captureReturn [Inv48.QuoteMinimumJoin.ret] minimumCall)
    (by decide) (by decide) hoisted
  exact ⟨caller,called,Inv48.MinimumFullTrace.captureCall n c caller called _ _ _ captured⟩

/-- Both minimum queries descend from the minimum slice retained by quoteEntry.
The declaration, guard, capture and call finish have no events. -/
structure MinimumRecovery (fuel : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript) where
  bodyFuel : Nat
  inner : Runtime
  value : Result
  body : Inv48.MinimumFullTrace.BodyRecovery bodyFuel {c with checked := true} inner tr value

theorem recoverMinimum (n : Nat) (c : Context) (r final : Runtime)
    (run : Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table c r minP.value)
      tr (.ok (.normal final))) : Nonempty (MinimumRecovery (n+4) c r final tr) := by
  obtain ⟨caller,called,call⟩ := minimumCut n c r final run
  obtain ⟨k,fn,values,argFinal,inner,saved,value,at_,bt,ft,eq,found,body,entered,split,args,exec,finish,ord⟩ :=
    minimumEntered (n+1) c caller called tr call
  have an := Inv48.MinimumFullTrace.quietEvents _
    (Inv48.MinimumFullTrace.quietCaught _
      (Inv48.MinimumFullTrace.listQuiet _ c caller [.var Inv32OneArg.argName] (by decide)).2.1) args
  have fnil := Inv48.MinimumFullTrace.quietEvents _
    (Inv48.MinimumFullTrace.finishQuiet _ _ _ _) finish
  have same : tr=bt := by rw [split,an,fnil,List.nil_append,List.append_nil]
  obtain ⟨path⟩ := Inv48.MinimumFullTrace.bodyRecovery k {c with checked := true} inner bt value ord exec
  exact ⟨⟨k,inner,value,by rwa [same]⟩⟩
end Inv48.WholeQuoteEvents
