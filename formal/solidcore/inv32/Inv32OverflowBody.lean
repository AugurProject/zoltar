import Inv32PanicCall
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Actions Inv32FloorStart
namespace Inv32OverflowBody
abbrev a := "_ic_arg_0"
abbrev b := "_ic_arg_1"
abbrev c' := "_ic_arg_2"
abbrev result := "_ret___library_Math_ternary_0"
abbrev reason := "_sol_hoist_0"
def bit := Inv32WideGuards.zeroTest "denominator"
def declareCode (dst : String) (v : Nat) : Stmt :=
  .varDecl .uint256 dst (some (.ternary (.word 1) (.word v) (.word v)))
def vars : List Stmt := [.varDecl .bool a (some bit.core),declareCode b 18,declareCode c' 17,.varDecl .uint256 result none]
def choose : Stmt := .block (vars ++ [.captureReturn [result] (.internalCall [result] Inv32Bodies.Ternary.key
  [.var a,.var b,.var c']),.assign (.var reason) (.var result)])
def raise : Stmt := .block [temp a reason,.captureReturn [] (.internalCall [] Inv32Bodies.Panic.key [.var a])]
theorem shape : Inv32WideEntry.failureBranch = .block [.varDecl .uint256 reason none,choose,raise] := by rfl
def saved (r : Runtime) (v : Nat) := r.pushScope.declareLocal reason (.word v)
def flag (d : Nat) := decide (d=0)
theorem readFlag (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : Nat)
    (hd : d<R) (D : locals r "denominator" = some d) :
    Stmt.eval (n+1) t c r (.varDecl .bool a (some bit.core)) =
      pure (.normal (r.declareLocal a (.word (boolWord (flag d))))) := by
  have truth : (if d=0 then 1 else 0) = boolWord (flag d) := by by_cases z : d=0 <;> simp [flag,z,boolWord]
  have h := evalFormula bit c r _ (by decide) (Inv32WideGuards.zeroValue c.checked (locals r) _ d hd D)
  rw [truth] at h
  rw [Stmt.eval]; dsimp only; rw [h]
  cases flag d <;> rfl

theorem declareLiteral (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (dst : String) (v : Nat) (hv : v<R) :
    Stmt.eval (n+1) t c r (declareCode dst v) = pure (.normal (r.declareLocal dst (.word v))) := by
  let expr := choice (literal 1) (literal v) (literal v)
  have h : expr.run c.checked (locals r) = some (normWord v) := rfl
  have read := evalFormula expr c r _ (by change 2≤5; decide) h
  rw [show normWord v = v from Nat.mod_eq_of_lt hv] at read
  unfold declareCode; rw [Stmt.eval]; dsimp only
  change Expr.eval c r (.ternary (.word 1) (.word v) (.word v)) = _ at read
  rw [read]; rfl
macro "store_code" : tactic => `(tactic|
  simp [saved,a,b,c',result,reason,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
    Runtime.pushScope,Runtime.declareLocal,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,
    LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem chooseExec (n : Nat) (c : Context) (r : Runtime) (d : Nat) (hd : d<R) (D : locals r "denominator" = some d) :
    Stmt.eval (n+16) Inv32Dispatch.model.core.table c (saved r 0) choose =
      pure (.normal (saved r (Inv32PanicChoice.value (flag d)))) := by
  let t := Inv32Dispatch.model.core.table
  let yes := flag d
  let code := Inv32PanicChoice.value yes
  let start := (saved r 0).pushScope
  let x1 := start.declareLocal a (.word (boolWord yes))
  let x2 := x1.declareLocal b (.word 18)
  let x3 := x2.declareLocal c' (.word 17)
  let st := fun o v =>
    let arg0 := (saved r o).pushScope.declareLocal a (.word (boolWord yes))
    let arg1 := arg0.declareLocal b (.word 18)
    let arg2 := arg1.declareLocal c' (.word 17)
    arg2.declareLocal result (.word v)
  have A := readFlag (n+14) t c start d hd D
  have B := declareLiteral (n+14) t c x1 b 18 (by decide)
  have C := declareLiteral (n+14) t c x2 c' 17 (by decide)
  have Z := zero (n+14) t c x3 result
  have call := Inv32TernaryCall.call n c (st 0 0) a b c' [result] yes rfl rfl rfl
  have store : (st 0 0).assignNamedValuesRef? [result] [.word code] = some (st 0 code) := by dsimp [st]; store_code
  have ret : internalCallAssign (st 0 0) [result] [.word code] = pure (.normal (st 0 code)) := by simp [internalCallAssign,store]
  have cap := Inv32Internal.capture _ _ _ _ _ [result] _ (call.trans ret)
  have cp := Inv32Temps.copy (n+14) t c (st 0 code) (st code code) reason result 0 code rfl rfl (by dsimp [st]; store_code)
  have ls : Stmt.evalList (n+15) t c start (vars ++ [.captureReturn [result] (.internalCall [result] Inv32Bodies.Ternary.key
      [.var a,.var b,.var c']),.assign (.var reason) (.var result)]) = pure (.normal (st code code)) := by
    refine (seqStep _ _ _ _ _ _ _ A).trans ?_
    refine (seqStep _ _ _ _ _ _ _ B).trans ?_
    refine (seqStep _ _ _ _ _ _ _ C).trans ?_
    refine (seqStep _ _ _ _ _ _ _ Z).trans ?_
    refine (seqStep _ _ _ _ _ _ _ cap).trans ?_
    exact (seqStep _ _ _ _ _ _ [] cp).trans (by rw [Stmt.evalList])
  unfold choose; rw [Stmt.eval]; dsimp only; rw [ls]; rfl
end Inv32OverflowBody
