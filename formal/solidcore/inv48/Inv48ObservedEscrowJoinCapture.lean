import Inv48ObservedEscrowJoinCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedEscrowJoin
open Inv48.EscrowPrefix Inv48.QuoteTransport Inv48.FundingContinuation
set_option autoImplicit false
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

def quoteBlock := getBlock (Inv48.RequestQuote.actual[6]?)

theorem quoteBlockShape : Inv48.RequestQuote.actual[6]? = some (.block quoteBlock) := by
  unfold quoteBlock
  rw [Inv48.RequestPrologue.actualQuoteBlock]
  rfl

theorem quoteBlockTail : quoteBlock.drop 4 =
    [Inv48.RequestQuote.quoteCaptureP.value,aliasP.value] := by
  unfold quoteBlock
  rw [Inv48.RequestPrologue.actualQuoteBlock]
  rfl

/-- One successful generated execution contains capture, aliasRun, all five suffix
statements, preparation, and the request. No separate suffix run is assumed. -/
theorem sameRun (n : Nat) (c : Context) (start final : Runtime)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList (n+2) Inv48.Source.model.core.table c start
      (Inv48.RequestQuote.actual.drop 6)) trace (.normal final)) :
    ∃ entered captured aliased outer pending called last outerFinal
      prefixTrace captureTrace aliasTrace suffixTrace callTrace tailTrace outerTrace,
      trace = prefixTrace ++ captureTrace ++ aliasTrace ++ suffixTrace ++ callTrace ++ tailTrace ++ outerTrace ∧
      ExecutesOK (Stmt.evalList (n+1) Inv48.Source.model.core.table c start.pushScope
        (quoteBlock.take 4)) prefixTrace (.normal entered) ∧
      ExecutesOK (Stmt.eval (n+1) Inv48.Source.model.core.table c entered
        Inv48.RequestQuote.quoteCaptureP.value) captureTrace (.normal captured) ∧
      ExecutesOK (Stmt.eval (n+1) Inv48.Source.model.core.table c captured
        aliasP.value) aliasTrace (.normal aliased) ∧
      aliased.popScope = outer ∧
      ExecutesOK (Stmt.evalList (n+2) Inv48.Source.model.core.table c outer
        ((Inv48.RequestQuote.actual.drop 7).take 5)) suffixTrace (.normal pending) ∧
      ExecutesOK (Stmt.eval (n+1) Inv48.Source.model.core.table c (callPrep pending)
        Inv48.RequestQuote.callStmt) callTrace (.normal called) ∧
      ExecutesOK (Stmt.evalList (n+1) Inv48.Source.model.core.table c called
        (requestTail.drop 1)) tailTrace (.normal last) ∧
      last.popScope = outerFinal ∧
      ExecutesOK (Stmt.evalList (n+2) Inv48.Source.model.core.table c outerFinal
        (Inv48.RequestQuote.actual.drop 13)) outerTrace (.normal final) := by
  rw [dropHead Inv48.RequestQuote.actual 6 _ quoteBlockShape] at run
  obtain ⟨outer,bt,rest,split,blockRun,suffixRun⟩ :=
    normalCons (n+2) Inv48.Source.model.core.table c start final _ _ trace run
  rw [Stmt.eval] at blockRun
  change Interaction.Executes
    (Stmt.evalList (n+1) Inv48.Source.model.core.table c start.pushScope quoteBlock >>=
      fun v => pure (v.mapRuntime Runtime.popScope)) bt (.ok (.normal outer)) at blockRun
  obtain ⟨result,body,popped⟩ := Inv48.ChildExtraction.terminal _
    (fun v : Result => .ok (v.mapRuntime Runtime.popScope)) bt (.normal outer) blockRun
  cases result with
  | normal aliased =>
    have pop : aliased.popScope = outer := by cases popped; rfl
    have shape : quoteBlock = quoteBlock.take 4 ++
        [Inv48.RequestQuote.quoteCaptureP.value,aliasP.value] := by
      rw [← quoteBlockTail,List.take_append_drop]
    rw [shape] at body
    obtain ⟨entered,pt,rt,split2,prefixRun,remaining⟩ := normalAppend (n+1) _ c _ aliased _ _ bt body
    obtain ⟨captured,ct,aliasTrace,split3,capture,aliasRun⟩ := normalCons (n+1) _ c _ aliased _ _ rt remaining
    rw [Inv48.WholeQuote.singleList] at aliasRun
    obtain ⟨pending,called,last,outerFinal,st,callt,tt,ot,split4,writes,call,tail,pop2,finish⟩ :=
      downstream n c outer final rest suffixRun
    exact ⟨entered,captured,aliased,outer,pending,called,last,outerFinal,
      pt,ct,aliasTrace,st,callt,tt,ot,by simp [split,split2,split3,split4,List.append_assoc],
      prefixRun,capture,aliasRun,pop,writes,call,tail,pop2,finish⟩
  | returned r vs => cases popped
  | constructorReturned r code => cases popped
  | selfdestructed r => cases popped
  | reverted r err => cases popped
  | broke r => cases popped
  | continued r => cases popped

#print axioms quoteBlockShape
#print axioms quoteBlockTail
#print axioms sameRun
end Inv48.ObservedEscrowJoin
