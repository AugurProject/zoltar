import Inv32Midpoint
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32FloorStart Inv32Hoist
namespace Inv32RatioTest
abbrev a0 := "_ic_arg_0"
abbrev a1 := "_ic_arg_1"
abbrev a2 := "_ic_arg_2"
abbrev a3 := "_ic_arg_3"
abbrev a4 := "_ic_arg_4"
abbrev ret := "_ret___library_TwoWayConstantProductMath__productOfSumAtMost_0"
abbrev flag := "_sol_hoist_0"
def argv : List Expr := [.var a0,.var a1,.var a2,.var a3,.var a4]
def cmp := Stmt.internalCall [ret] Inv32Bodies.Comparison.key argv
def code := Stmt.block [temp a0 "midpoint",temp a1 "otherPart",temp a2 "numeratorPart",temp a3 "scale",
  temp a4 "numeratorPart",.varDecl .bool ret none,.captureReturn [ret] cmp,.assign (.var flag) (.var ret)]
def frame (s p o : Nat) : Frame := [("scale",.word s),("numeratorPart",.word p),("otherPart",.word o),("_ret0",.word 0)]
def root (r : Runtime) (s p o : Nat) := (r.withFrame (frame s p o)).pushScope.pushScope
def range (r : Runtime) (s p o l h : Nat) := ((root r s p o).declareLocal "low" (.word l)).declareLocal "high" (.word h)
def withMid (r : Runtime) (s p o l h m : Nat) := (range r s p o l h).pushScope.declareLocal "midpoint" (.word m)
def withFlag (r : Runtime) (s p o l h m b : Nat) := (withMid r s p o l h m).pushScope.declareLocal flag (.word b)
macro "write_comparison" : tactic => `(tactic|
  simp [withFlag,withMid,range,root,frame,flag,ret,a0,a1,a2,a3,a4,
    Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,LocalEnv.declare,
    LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem testExec (n : Nat) (c : Context) (r : Runtime) (s p o l h m : Nat) (hs : s<R) (hp : p<R) (ho : o<R) (hm : m<R) :
    let val := boolWord (Inv32CompareCall.answer m o p s p)
    Stmt.eval (n+13) Inv32Dispatch.model.core.table c (withFlag r s p o l h m 0) code =
      pure (.normal (withFlag r s p o l h m val)) := by
  let t := Inv32Dispatch.model.core.table
  let flagFrame := fun v => withFlag r s p o l h m v
  let A1 := fun v => (flagFrame v).pushScope.declareLocal a0 (.word m)
  let A2 := fun v => (A1 v).declareLocal a1 (.word o)
  let A3 := fun v => (A2 v).declareLocal a2 (.word p)
  let A4 := fun v => (A3 v).declareLocal a3 (.word s)
  let A5 := fun v => (A4 v).declareLocal a4 (.word p)
  let A6 := fun v tmp => (A5 v).declareLocal ret (.word tmp)
  let value := boolWord (Inv32CompareCall.answer m o p s p)
  have T0 := Inv32Temps.temp (n+11) t c (flagFrame 0).pushScope a0 "midpoint" m hm rfl
  have T1 := Inv32Temps.temp (n+11) t c (A1 0) a1 "otherPart" o ho rfl
  have T2 := Inv32Temps.temp (n+11) t c (A2 0) a2 "numeratorPart" p hp rfl
  have T3 := Inv32Temps.temp (n+11) t c (A3 0) a3 "scale" s hs rfl
  have T4 := Inv32Temps.temp (n+11) t c (A4 0) a4 "numeratorPart" p hp rfl
  have Z := zeroBool (n+11) t c (A5 0) ret
  have call := Inv32CompareCall.call n c (A6 0 0) a0 a1 a2 a3 a4 [ret] m o p s p hm ho hp hs hp rfl rfl rfl rfl rfl
  have U : (A6 0 0).assignLocal? ret (.word value) = some (A6 0 value) := by dsimp [A6,A5,A4,A3,A2,A1,flagFrame]; write_comparison
  have cap := takeReturn _ _ _ _ _ _ _ _ _ call U
  have cp := lastCopy (n+11) t c (A6 0 value) (A6 value value) flag ret 0 value rfl rfl
    (by dsimp [A6,A5,A4,A3,A2,A1,flagFrame]; write_comparison)
  apply block (n+12) t c _ (A6 value value)
  exact (seqStep _ _ _ _ _ _ _ T0).trans ((seqStep _ _ _ _ _ _ _ T1).trans
    ((seqStep _ _ _ _ _ _ _ T2).trans ((seqStep _ _ _ _ _ _ _ T3).trans ((seqStep _ _ _ _ _ _ _ T4).trans
    ((seqStep _ _ _ _ _ _ _ Z).trans ((seqStep _ _ _ _ _ _ _ cap).trans cp))))))
end Inv32RatioTest
