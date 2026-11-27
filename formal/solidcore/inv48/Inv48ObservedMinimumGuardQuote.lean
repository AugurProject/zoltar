import Inv48ObservedMinimumGuardPrefix
import Inv48QuoteMinimumObservedGuard
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.ObservedMinimumGuard
open Inv48.QuoteMinimumJoin Inv48.Positive
open Inv48.WholeQuote Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
set_option linter.unnecessarySimpa false

theorem prefixMinimum (r final : Runtime) (m : Nat) :
    (prefixOut r final m).lookupLocal? "#view48027" = some (.word m) := by
  cases eq : r.locals <;> simp [prefixOut,afterBase,Inv32OneArg.store,
    Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.lookup?,LocalEnv.declare,Frame.lookup?,eq]

theorem prefixAmount (r final : Runtime) (m a : Nat)
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a)) :
    (prefixOut r final m).lookupLocal? "requestedInitialAttoWeth" = some (.word a) := by
  cases eq : r.locals <;> simpa [prefixOut,afterBase,Inv32OneArg.store,dst,
    Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.lookup?,LocalEnv.declare,Frame.lookup?,eq] using A

theorem quoteFailure (fuel : Nat) (c : Context) (baseRuntime : Runtime)
    (rows : ScriptedResponder) (p a bounty m : Nat) (final : Runtime)
    (hp : p<R) (ha : a<R) (hb : bounty<R) (hm : m<R)
    (bodyRun : (Stmt.eval fuel Inv48.Source.model.core.table {c with checked := true}
      (start {callSite (prepared baseRuntime p a bounty).pushScope p with locals := []} p)
      Inv48.Public.body).runWith rows = .ok (.returned final [.word m]))
    (lt : a<m) :
    (Stmt.eval (fuel+6) Inv48.Source.model.core.table c (entry baseRuntime p a bounty) bodyP.value).runWith rows =
      .ok (.reverted (prefixOut (prepared baseRuntime p a bounty).pushScope final m).popScope.popScope.popScope (.error "Report funding below minimum")) := by
  let t := Inv48.Source.model.core.table
  let start := (prepared baseRuntime p a bounty).pushScope
  let out := prefixOut (prepared baseRuntime p a bounty).pushScope final m
  let err := RevertData.error "Report funding below minimum"
  have pre := prefixRun fuel c start rows p m final hp hm bodyRun (by rfl)
  have bad := guardFailure (fuel+2) c out a _ ha hm lt
    (prefixAmount _ _ _ _ (by rfl)) (prefixMinimum _ _ _)
  have minList : (Stmt.evalList (fuel+3) t c start
      (minPrefix++[minimumGuard "#view48027"])).runWith rows = .ok (.reverted out err) := by
    rw [listAppend,Inv48.PositiveRuns.bind,pre]
    change (Stmt.evalList (fuel+3) t c out [minimumGuard "#view48027"]).runWith rows = _
    rw [singleList,bad]
    rfl
  have minBlock := Inv48.PositiveRuns.blockResult (fuel+3) t c
    (prepared baseRuntime p a bounty) rows _ _ minList
  rw [← minimumStatement] at minBlock
  have interior : (Stmt.evalList (fuel+4) t c (prepared baseRuntime p a bounty)
      (minP.value :: collateralWrite :: fundingCode ++ tailCode)).runWith rows =
      .ok (.reverted out.popScope err) := by
    simp only [List.cons_append]
    rw [Stmt.evalList,Inv48.PositiveRuns.bind,minBlock]
    rfl
  have inner := Inv48.PositiveRuns.blockResult (fuel+4) t c
    (allocated baseRuntime p a bounty).pushScope rows _ _ interior
  have pro := prologueExecution (fuel+4) t c baseRuntime p a bounty hp ha hb
  have bodyList : (Stmt.evalList (fuel+5) t c (entry baseRuntime p a bounty).pushScope
      (prologue++[.block (minP.value :: collateralWrite :: fundingCode ++ tailCode)])).runWith rows =
      .ok (.reverted out.popScope.popScope err) := by
    rw [appendNormal _ _ _ _ _ _ _ pro,singleList]
    exact inner
  rw [Inv48.WholeQuote.bodyForm]
  exact Inv48.PositiveRuns.blockResult (fuel+5) t c (entry baseRuntime p a bounty) rows _ _ bodyList

theorem successfulQuote (fuel : Nat) (c : Context) (baseRuntime after final : Runtime)
    (rows : ScriptedResponder) (p a bounty m : Nat)
    (hp : p<R) (ha : a<R) (hb : bounty<R) (hm : m<R)
    (bodyRun : (Stmt.eval fuel Inv48.Source.model.core.table {c with checked := true}
      (start {callSite (prepared baseRuntime p a bounty).pushScope p with locals := []} p)
      Inv48.Public.body).runWith rows = .ok (.returned final [.word m]))
    (run : (Stmt.eval (fuel+6) Inv48.Source.model.core.table c
      (entry baseRuntime p a bounty) bodyP.value).runWith rows = .ok (.normal after)) : m≤a := by
  by_contra H
  have bad := quoteFailure fuel c baseRuntime rows p a bounty m final hp ha hb hm bodyRun (by omega)
  rw [bad] at run
  cases run

#print axioms prefixMinimum
#print axioms prefixAmount
#print axioms quoteFailure
#print axioms successfulQuote
end Inv48.ObservedMinimumGuard
