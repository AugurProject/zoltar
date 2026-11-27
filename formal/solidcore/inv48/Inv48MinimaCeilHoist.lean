import Inv48MinimaCeilCall
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32FloorStart Inv32Hoist
namespace Inv48.MinimaCeil
abbrev slot := "_ret___library_Math_ceilDiv_0"
private def temps (r : Runtime) (v x result : Nat) :=
  (st2 r Inv03.Bodies.tmp v x 100).declareLocal slot (.word result)
def code (src : String) := Inv03.Bodies.hoist Inv04.Shapes.ceilKey slot
  [(a0,Inv03.Bodies.wvar src),(a1,Inv32Shapes.Expr_ternary (Inv03.Bodies.num 1) (Inv03.Bodies.num 100) (Inv03.Bodies.num 100))]
theorem hoist (table : FunctionTable) (ceilLinked : Inv32Library.LinkAt table Inv04.Shapes.ceilKey [.word "a",.word "b"] [.word "_ret0"] Inv04.Shapes.ceilShape.value) (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body) (n : Nat) (c : Context) (r : Runtime) (src : String) (x : Nat) (small : x<R)
    (X : (start r Inv03.Bodies.tmp 0).lookupLocal? src = some (.word x)) :
    Stmt.eval (n+16) table c (Inv32OneArg.store r Inv03.Bodies.tmp 0) (code src).value =
      pure (.normal (Inv32OneArg.store r Inv03.Bodies.tmp (Inv03.ceilQuot x 100))) := by
  let t := table
  let st := fun o v => temps r o x v
  let v := Inv03.ceilQuot x 100
  have called := call table ceilLinked uintLinked n c (st 0 0) x small a0 a1 slot rfl rfl
  have put : (st 0 0).assignLocal? slot (.word v) = some (st 0 v) := by
    cases H : r.locals <;> dsimp [st,temps,slot] <;> write_temps
  have picked := takeReturn _ _ _ _ _ _ _ _ _ called put
  have cp : Stmt.evalList (n+15) t c (st 0 v) [.assign (.var Inv03.Bodies.tmp) (.var slot)] =
      pure (.normal (st v v)) := by
    apply lastCopy _ _ _ _ _ _ _ 0 v
    all_goals cases H : r.locals <;> dsimp [st,temps,slot,Inv03.Bodies.tmp,Inv32CeilFlags.h0] <;> write_temps
  have literal : Expr.eval c (st1 r Inv03.Bodies.tmp 0 x)
      (.ternary (.word 1) (.word 100) (.word 100)) =
      pure (.word 100,st1 r Inv03.Bodies.tmp 0 x) := by rfl
  apply block _ _ _ _ (st v v)
  refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+14) t c _ a0 src x small X)).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (declEval (n+14) t c _ a1 .uint256 _ 100 literal (by rfl))).trans ?_
  exact (seqStep _ _ _ _ _ _ _ (zero (n+14) t c _ slot)).trans ((seqStep _ _ _ _ _ _ _ picked).trans cp)
end Inv48.MinimaCeil
