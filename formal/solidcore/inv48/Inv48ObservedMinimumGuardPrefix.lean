import Inv48ObservedMinimumGuardCall
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.ObservedMinimumGuard
open Inv48.WholeQuote Inv48.QuoteMemory Inv48.QuoteMinimumJoin Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
set_option linter.unusedSimpArgs false
set_option linter.unnecessarySimpa false

def afterBase (r final : Runtime) : Runtime := {final with locals := r.locals}
def prefixOut (r final : Runtime) (m : Nat) :=
  (Inv32OneArg.store (afterBase r final) dst m).declareLocal "#view48027" (.word m)

macro "prefix_simp" : tactic => `(tactic|
  simp [callSite,Inv32OneArg.temps,Inv32OneArg.store,dst,ret,afterBase,
    Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,
    Runtime.lookupLocal?,Runtime.lookupMemoryRef?,LocalEnv.lookup?,Frame.lookup?,
    LocalEnv.assign?,Frame.assign?,Value.coerceLike?,Runtime.declareLocal,Runtime.pushScope,
    Runtime.popScope,LocalEnv.declare,Inv32OneArg.argName])

theorem prefixRun (fuel : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (p m : Nat) (final : Runtime)
    (hp : p<R) (hm : m<R)
    (bodyRun : (Stmt.eval fuel Inv48.Source.model.core.table {c with checked := true}
      (start {callSite r p with locals := []} p) Inv48.Public.body).runWith rows =
      .ok (.returned final [.word m]))
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p)) :
    (Stmt.evalList (fuel+3) Inv48.Source.model.core.table c r minPrefix).runWith rows =
      .ok (.normal (prefixOut r final m)) := by
  let t := Inv48.Source.model.core.table
  let next := afterBase r final
  let input := (Inv32OneArg.store r dst 0).pushScope
  have read : Expr.eval c input (clean (.var "proposedRepPerEthPrice")) = pure (.word p,input) := by
    change Expr.evalFuel 3 c input _ = _
    apply Inv32Guards.clean 2 c input _ p hp
    apply Inv32Guards.readWord 1 c input _ p
    cases eq : r.locals <;> simpa [eq,input,Inv32OneArg.store,dst,Runtime.declareLocal,Runtime.pushScope,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?] using P
  have D := Inv32Hoist.declEval (fuel+1) t c input Inv32OneArg.argName .uint256
    (clean (.var "proposedRepPerEthPrice")) p read (by rfl)
  have Z := Inv32FloorStart.zero (fuel+1) t c
    (input.declareLocal Inv32OneArg.argName (.word p)) ret
  have args : Expr.evalRefArgList c (callSite r p) [.var Inv32OneArg.argName] = pure ([.word p],callSite r p) := by
    apply Inv32FlagCalls.arg
    prefix_simp
  have call := internalGetter fuel c (callSite r p) rows p m final ret
    [.var Inv32OneArg.argName] args bodyRun
  have called : (Stmt.eval (fuel+1) t c (callSite r p)
      (.internalCall [ret] key [.var Inv32OneArg.argName])).runWith rows =
      .ok (.normal (Inv32OneArg.temps next dst ret 0 p m)) := by
    rw [call]
    simp [internalCallAssign,SolI.runWith,next]
    prefix_simp
    rfl
  have captured := Inv48.PositiveRuns.capture _ t c _ _ rows [ret] _ called
  dsimp only [callSite,Inv32OneArg.temps] at captured
  have copy := Inv32Temps.copy (fuel+1) t c (Inv32OneArg.temps next dst ret 0 p m)
    (Inv32OneArg.temps next dst ret m p m) dst ret 0 m
    (by cases eq : next.locals <;> simp [eq,Inv32OneArg.temps,Inv32OneArg.store,Runtime.declareLocal,Runtime.pushScope,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.declare,dst,ret,Inv32OneArg.argName])
    (by prefix_simp)
    (by cases eq : next.locals <;> simp [eq,Inv32OneArg.temps,Inv32OneArg.store,Runtime.declareLocal,Runtime.pushScope,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,Value.coerceLike?,dst,ret,Inv32OneArg.argName])
  dsimp only [Inv32OneArg.temps] at copy
  have code : (Stmt.eval (fuel+3) t c (Inv32OneArg.store r dst 0)
      (Inv32OneArg.code dst ret key .uint256 .uint256 (clean (.var "proposedRepPerEthPrice")))).runWith rows =
      .ok (.normal (Inv32OneArg.store next dst m)) := by
    have seq : (Stmt.evalList (fuel+2) t c input
        [.varDecl .uint256 Inv32OneArg.argName (some (clean (.var "proposedRepPerEthPrice"))),
          .varDecl .uint256 ret none,
          .captureReturn [ret] (.internalCall [ret] key [.var Inv32OneArg.argName]),
          .assign (.var dst) (.var ret)]).runWith rows =
        .ok (.normal (Inv32OneArg.temps next dst ret m p m)) := by
      rw [Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ (by rw [D]; rfl),
        Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ (by rw [Z]; rfl),
        Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ captured,
        Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ (by rw [copy]; rfl),Stmt.evalList]
      rfl
    simpa [Inv32OneArg.code,Inv32OneArg.temps,Inv32OneArg.store,Runtime.popScope,Runtime.pushScope]
      using Inv48.PositiveRuns.blockResult (fuel+2) t c (Inv32OneArg.store r dst 0) rows _ _ seq
  have resultRead : Expr.eval c (Inv32OneArg.store next dst m) (clean (.var dst)) =
      pure (.word m,Inv32OneArg.store next dst m) := by
    change Expr.evalFuel 3 c _ _ = _
    apply Inv32Guards.clean 2 c _ _ m hm
    apply Inv32Guards.readWord 1 c _ _ m
    cases eq : next.locals <;> simp [eq,Inv32OneArg.store,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.declare]
  have last := Inv32Hoist.declEval (fuel+2) t c (Inv32OneArg.store next dst m)
    "#view48027" .uint256 (clean (.var dst)) m resultRead (by rfl)
  dsimp only [dst,ret,key,Inv32OneArg.store,t] at code last
  rw [minimumDataflow.1]
  rw [Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ (by rw [Inv32FloorStart.zero]; rfl),
    Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ code,
    Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ (by rw [last]; rfl),Stmt.evalList]
  rfl

#print axioms prefixRun
end Inv48.ObservedMinimumGuard
