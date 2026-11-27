import Inv48QuoteMinimumObservedSyntax
import Inv48QuoteMinimumEventsCollateral
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteMinimumEvents
open Inv48.WrapperTraversal Inv48.RequestDispatch Inv48.RequestGuards Inv48.RequestClassify
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def minimumCall : Source.Stmt := .internalCall [Inv48.QuoteMinimumJoin.ret] Inv48.QuoteMinimumJoin.key
  [.var Inv32OneArg.argName]

def minimumRoute (n : Nat) : Blocks Inv48.Source.model.core.table minimumCall (n+3)
    Inv48.WholeQuote.minP.value :=
  .block (n+2) [Inv48.WholeQuote.zeroP.value]
        (Inv48.WholeQuote.hoistP Inv48.QuoteMinimumJoin.ret Inv48.QuoteMinimumJoin.key
          [Inv48.QuoteMemory.cleanP (Inv48.QuoteMemory.varP "proposedRepPerEthPrice")]).value
        [ (Inv48.WholeQuote.declP "#view48027" (Inv48.QuoteMemory.cleanP
            (Inv48.QuoteMemory.varP "_sol_hoist_0"))).value, Inv48.WholeQuote.minGuardP.value] (by decide)
        (.block (n+1)
          [.varDecl .uint256 Inv32OneArg.argName (some (Inv48.QuoteMemory.clean (.var "proposedRepPerEthPrice"))),
           .varDecl .uint256 Inv48.QuoteMinimumJoin.ret none]
          (.captureReturn [Inv48.QuoteMinimumJoin.ret] minimumCall)
          [.assign (.var "_sol_hoist_0") (.var Inv48.QuoteMinimumJoin.ret)] (by decide)
          (.capture n [Inv48.QuoteMinimumJoin.ret] minimumCall (.here n)))

/-- The minimum call is selected from the actual successful quote body. -/
theorem minimumSite (n : Nat) (c : Context) (r : Runtime)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c r
      Inv48.WholeQuote.minP.value) trace (.ok out)) :
    ∃ q : Site (Stmt.eval (n+3) Inv48.Source.model.core.table c r Inv48.WholeQuote.minP.value)
        Inv48.Source.model.core.table minimumCall trace out,
      ∃ final during rest, q.after = during ++ rest ∧
        Interaction.Executes (Stmt.eval q.fuel Inv48.Source.model.core.table q.context q.runtime minimumCall)
          during (.ok (.normal final)) ∧
        Interaction.Executes (q.continuation (.normal final)) rest (.ok out) := by
  have reject : Rejects pure out := by
    intro v bad tr exec
    cases exec
    exact ordinary bad
  have unit : (Stmt.eval (n+3) Inv48.Source.model.core.table c r Inv48.WholeQuote.minP.value >>= pure) =
      Stmt.eval (n+3) Inv48.Source.model.core.table c r Inv48.WholeQuote.minP.value := Interaction.bind_pure _
  have recovered := site (minimumRoute n) c r pure trace out reject (by rwa [unit])
  rw [unit] at recovered
  obtain ⟨q,_,rej⟩ := recovered
  obtain ⟨value,during,rest,split,first,last⟩ := bindSuccess _ _ _ _ q.suffix
  have never := Inv48.FundingFallthrough.neverSound 1 minimumCall rfl q.fuel
    Inv48.Source.model.core.table q.context q.runtime
  have normal : ∃ final, value = .normal final := by
    cases value with
    | normal final => exact ⟨final,rfl⟩
    | returned rt vs => exact False.elim (never _ _ _ first)
    | _ => apply False.elim; apply rej _ ?_ rest last; trivial
  obtain ⟨final,rfl⟩ := normal
  exact ⟨q,final,during,rest,split,first,last⟩
end Inv48.QuoteMinimumEvents

namespace Inv48.QuoteMinimumEvents
open Inv48.MinimumCollateralTrace Inv48.WrapperTraversal Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The actual quote body's first interior stage, after its real cleanup and
allocation. No minimum getter execution is supplied separately. -/
theorem quoteMinimumStage (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (hp : p < Inv32Division.R) (ha : a < Inv32Division.R) (hb : bounty < Inv32Division.R)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c
      (entry physical p a bounty) bodyP.value) trace (.ok out)) :
    ∃ mid during after,
      trace = during ++ after ∧
      Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c
        (prepared physical p a bounty) minP.value) during (.ok (.normal mid)) ∧
      ∃ q : Inv48.RequestClassify.Site
          (Stmt.eval (n+3) Inv48.Source.model.core.table c (prepared physical p a bounty) minP.value)
          Inv48.Source.model.core.table minimumCall during (.normal mid),
        ∃ final callTrace rest, q.after = callTrace ++ rest ∧
          Interaction.Executes (Stmt.eval q.fuel Inv48.Source.model.core.table q.context q.runtime minimumCall)
            callTrace (.ok (.normal final)) ∧
          Interaction.Executes (q.continuation (.normal final)) rest (.ok (.normal mid)) := by
  rw [bodyForm] at run
  obtain ⟨k,v,eq,outEq,outer⟩ := block _ _ _ _ _ _ _ run
  have kEq : k = n+4 := by omega
  subst k
  have ord := popOrdinary v (by rwa [outEq] at ordinary)
  rw [listAppend,prologueExecution (n+3) _ c physical p a bounty hp ha hb] at outer
  change Interaction.Executes (Stmt.evalList (n+4) _ c (allocated physical p a bounty).pushScope
    [.block (Inv48.WholeQuote.minP.value :: Inv48.QuoteMemory.collateralWrite ::
      Inv48.QuoteMemory.fundingCode ++ tailCode)]) trace (.ok v) at outer
  have inside := singleton _ _ _ _ _ _ _ outer
  obtain ⟨j,w,eq2,valueEq,interior⟩ := block _ _ _ _ _ _ _ inside
  have jEq : j = n+3 := by omega
  subst j
  have ordW := popOrdinary w (by rwa [valueEq] at ord)
  change Interaction.Executes (Stmt.evalList (n+3) _ c (prepared physical p a bounty)
    ([minP.value] ++ (Inv48.QuoteMemory.collateralWrite :: Inv48.QuoteMemory.fundingCode ++ tailCode))) trace (.ok w) at interior
  obtain ⟨mid,mt,rest,split2,minimum,_⟩ := listPrefix _ _ _ _ _ _ _ _ (by decide) ordW interior
  have minimum := singleton _ _ _ _ _ _ _ minimum
  obtain ⟨q,final,ct,rt,qsplit,call,last⟩ := minimumSite n c _ mt (.normal mid) (by simp [Escapes]) minimum
  exact ⟨mid,mt,rest,split2,minimum,q,final,ct,rt,qsplit,call,last⟩
end Inv48.QuoteMinimumEvents
