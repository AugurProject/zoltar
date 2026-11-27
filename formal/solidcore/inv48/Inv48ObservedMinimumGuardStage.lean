import Inv48ObservedMinimumGuardQuote
open SolidCore.Solidity.Source Inv32Division EvmCompiler.Simulation
namespace Inv48.ObservedMinimumGuard
open Inv48.WholeQuote Inv48.QuoteMinimumJoin Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

theorem prefixPop (r final : Runtime) (m : Nat) :
    (prefixOut r.pushScope final m).popScope = afterBase r final := by
  simp [prefixOut,afterBase,Inv32OneArg.store,Runtime.pushScope,Runtime.popScope,
    Runtime.declareLocal,LocalEnv.declare]

theorem adoptedLocal (r final : Runtime) (name : String) :
    (afterBase r final).lookupLocal? name = r.lookupLocal? name := rfl

/-- Executes the real minimum block, including capture, hoist, cleanup and
public guard. The result adopts every nonlocal component of the observed
getter poststate while restoring precisely the caller's local environment. -/
theorem minimumStage (fuel : Nat) (c : Context) (r final : Runtime)
    (rows : ScriptedResponder) (p a m : Nat) (hp : p<R) (ha : a<R) (hm : m<R)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (bodyRun : (Stmt.eval fuel Inv48.Source.model.core.table {c with checked := true}
      (start {callSite r.pushScope p with locals := []} p) Inv48.Public.body).runWith rows =
      .ok (.returned final [.word m])) (sufficient : m≤a) :
    (Stmt.eval (fuel+4) Inv48.Source.model.core.table c r minP.value).runWith rows =
      .ok (.normal (afterBase r final)) := by
  have PP : r.pushScope.lookupLocal? "proposedRepPerEthPrice" = some (.word p) := by
    simpa [Runtime.pushScope,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?] using P
  have AA : r.pushScope.lookupLocal? "requestedInitialAttoWeth" = some (.word a) := by
    simpa [Runtime.pushScope,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?] using A
  have pre := prefixRun fuel c r.pushScope rows p m final hp hm bodyRun PP
  have guard := minimumCheck (fuel+2) Inv48.Source.model.core.table c
    (prefixOut r.pushScope final m) "#view48027" a m ha hm sufficient
    (prefixAmount _ _ _ _ AA) (prefixMinimum _ _ _)
  have list : (Stmt.evalList (fuel+3) Inv48.Source.model.core.table c r.pushScope
      (minPrefix++[minimumGuard "#view48027"])).runWith rows =
      .ok (.normal (prefixOut r.pushScope final m)) := by
    rw [listAppend,Inv48.PositiveRuns.bind,pre]
    change (Stmt.evalList (fuel+3) _ c _ [minimumGuard "#view48027"]).runWith rows = _
    rw [singleList,guard]
    rfl
  have block := Inv48.PositiveRuns.blockResult (fuel+3) Inv48.Source.model.core.table c r rows _ _ list
  rw [← minimumStatement] at block
  simpa only [Result.mapRuntime,prefixPop] using block

/-- Quote success supplies the comparison; the caller does not assume guard
success or rebuild a numerical getter input record. -/
theorem quoteStage (fuel : Nat) (c : Context) (physical final after : Runtime)
    (rows : ScriptedResponder) (p a bounty m : Nat)
    (hp : p<R) (ha : a<R) (hb : bounty<R) (hm : m<R)
    (bodyRun : (Stmt.eval fuel Inv48.Source.model.core.table {c with checked := true}
      (start {callSite (prepared physical p a bounty).pushScope p with locals := []} p)
      Inv48.Public.body).runWith rows = .ok (.returned final [.word m]))
    (run : (Stmt.eval (fuel+6) Inv48.Source.model.core.table c
      (entry physical p a bounty) bodyP.value).runWith rows = .ok (.normal after)) :
    m≤a ∧
    (Stmt.eval (fuel+4) Inv48.Source.model.core.table c (prepared physical p a bounty)
      minP.value).runWith rows = .ok (.normal (afterBase (prepared physical p a bounty) final)) ∧
    (afterBase (prepared physical p a bounty) final).lookupLocal? "proposedRepPerEthPrice" = some (.word p) ∧
    (afterBase (prepared physical p a bounty) final).lookupLocal? "requestedInitialAttoWeth" = some (.word a) ∧
    (afterBase (prepared physical p a bounty) final).lookupLocal? "bountyAttoEth" = some (.word bounty) := by
  have sufficient := successfulQuote fuel c physical after final rows p a bounty m hp ha hb hm bodyRun run
  exact ⟨sufficient,minimumStage fuel c _ final rows p a m hp ha hm (by rfl) (by rfl) bodyRun sufficient,
    rfl,rfl,rfl⟩

#print axioms prefixPop
#print axioms adoptedLocal
#print axioms minimumStage
#print axioms quoteStage
end Inv48.ObservedMinimumGuard
