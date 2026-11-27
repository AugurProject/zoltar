import Inv48PositiveTernaryCore
import Inv48PositiveOuter
import Inv32QuoteExpr
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32FloorFastPath Inv32Shapes
open Inv32NewtonBody
namespace Inv48.PositiveMaxCore
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
abbrev key := "__internal___library_Math_max(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def w (s : String) := Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit s))
def cleanParam (s : String) := Stmt_assign (LValue_var (lit s)) (w s)
abbrev out := "_sol_hoist_0"
abbrev ret := "_ret___library_Math_ternary_0"
abbrev a0 := "_ic_arg_0"
abbrev a1 := "_ic_arg_1"
abbrev a2 := "_ic_arg_2"
def stageShape : Pattern Stmt := Stmt_block (seq [
  Stmt_varDecl Ty_bool (lit a0) (Option_some (Expr_binary BinaryOp_gt (w "a") (w "b"))),
  Stmt_varDecl Ty_uint256 (lit a1) (Option_some (w "a")),
  Stmt_varDecl Ty_uint256 (lit a2) (Option_some (w "b")),
  Stmt_varDecl Ty_uint256 (lit ret) Option_none,
  Stmt_captureReturn (seq [lit ret]) (Stmt_internalCall (seq [lit ret]) (lit Inv32Bodies.Ternary.key)
    (seq [Expr_var (lit a0),Expr_var (lit a1),Expr_var (lit a2)])),
  Stmt_assign (LValue_var (lit out)) (Expr_var (lit ret))])
def shape : Pattern Stmt := Stmt_block (seq [cleanParam "a",cleanParam "b",Stmt_skip,
  Stmt_block (seq [Stmt_varDecl Ty_uint256 (lit out) Option_none,stageShape,
    Stmt_returnValues (seq [w out])])])
def body := shape.value

def frame (a b : Nat) : Frame := [("a",.word a),("b",.word b),("_ret0",.word 0)]
def root (r : Runtime) (a b : Nat) := (r.withFrame (frame a b)).pushScope.pushScope
def stageArgs : List Action := [
  Inv48.Positive.declare .bool a0 (Inv32WideGuards.gtF (Inv48.Positive.cleanWord "a") (Inv48.Positive.cleanWord "b")) (by decide),
  Inv48.Positive.declare .uint256 a1 (Inv48.Positive.cleanWord "a") (by decide),
  Inv48.Positive.declare .uint256 a2 (Inv48.Positive.cleanWord "b") (by decide),declareZero ret]
def staged (r : Runtime) (a b v tmp : Nat) :=
  ((((Inv48.Positive.saved (root r a b) out v).pushScope.declareLocal a0 (.word (boolWord (decide (b<a))))).declareLocal a1 (.word a)).declareLocal a2 (.word b)).declareLocal ret (.word tmp)

theorem stageExec (table : FunctionTable) (ternaryLinked : Inv32Library.LinkAt table Inv32Bodies.Ternary.key [.flag "condition",.word "a",.word "b"] [.word "_ret0"] Inv32Bodies.Ternary.body) (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body) (n : Nat) (c : Context) (r : Runtime) (a b : W) :
    Stmt.eval (n+16) table c (Inv48.Positive.saved (root r a.toNat b.toNat) out 0)
      stageShape.value = pure (.normal (Inv48.Positive.saved (root r a.toNat b.toNat) out (max a.toNat b.toNat))) := by
  let v := max a.toNat b.toNat
  have select : (if decide (b.toNat<a.toNat) then a.toNat else b.toNat) = v := by
    dsimp [v]; split <;> simp_all [Nat.max_def]
  have call := Inv48.PositiveTernaryCore.call table ternaryLinked uintLinked n c (staged r a.toNat b.toNat 0 0)
    a0 a1 a2 [ret] (decide (b.toNat<a.toNat)) a b rfl rfl rfl
  rw [select] at call
  have pre : runList c.checked (Inv48.Positive.saved (root r a.toNat b.toNat) out 0).pushScope stageArgs =
      some (staged r a.toNat b.toNat 0 0) := by
    by_cases cmp : b.toNat < a.toNat <;>
      simp [cmp,show wordEq 0 0 = true by decide,show wordEq 1 1 = true by decide,stageArgs,runList,Inv48.Positive.declare,declareZero,Inv48.Positive.cleanWord,
      Inv32WideGuards.gtF,clean,Inv32Scalar.cast,localWord,binary,locals,staged,Inv48.Positive.saved,root,frame,out,ret,a0,a1,a2,
      Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,
      LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,Ty.coerceValue?,Ty.defaultValue,
      Inv32Guards.cleanupWord c.checked a.toNat a.isLt,Inv32Guards.cleanupWord c.checked b.toNat b.isLt,
      Inv32QuoteExpr.gt _ _ _ a.isLt b.isLt,projectWord,boolWord]
  have H := Inv48.Positive.hoist (n+14) table c
    (Inv48.Positive.saved (root r a.toNat b.toNat) out 0)
    (staged r a.toNat b.toNat 0 0) (staged r a.toNat b.toNat 0 v)
    (staged r a.toNat b.toNat v v) out ret Inv32Bodies.Ternary.key stageArgs
    [.var a0,.var a1,.var a2] v (by simp [stageArgs,listDepth,Inv48.Positive.declare,declareZero]) pre call
    (by dsimp [staged,root,frame,out,ret,a0,a1,a2]; positive_store) (by rfl) (by rfl) (by dsimp [staged,root,frame,out,ret,a0,a1,a2]; positive_store)
  simpa [stageShape,stageArgs,Inv48.Positive.declare,Inv48.Positive.cleanWord,clean,Inv32Scalar.cast,localWord,
    Inv32WideGuards.gtF,binary,declareZero,staged,Inv48.Positive.saved,Runtime.popScope,Runtime.pushScope] using H

theorem execute (table : FunctionTable) (ternaryLinked : Inv32Library.LinkAt table Inv32Bodies.Ternary.key [.flag "condition",.word "a",.word "b"] [.word "_ret0"] Inv32Bodies.Ternary.body) (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body) (n : Nat) (c : Context) (r : Runtime) (a b : W) :
    let src := r.withFrame (frame a.toNat b.toNat)
    Stmt.eval (n+19) table c src body =
      pure (.returned src [.word (max a.toNat b.toNat)]) := by
  let t := table
  let src := r.withFrame (frame a.toNat b.toNat)
  let outside := src.pushScope
  let inside := root r a.toNat b.toNat
  let after := Inv48.Positive.saved inside out (max a.toNat b.toNat)
  have Z := Inv32FloorStart.zero (n+16) t c inside out
  have S := stageExec table ternaryLinked uintLinked (n+1) c r a b
  have bound : max a.toNat b.toNat < R := max_lt a.isLt b.isLt
  have read := Inv32Guards.clean 2 c after (.var out) _ bound
    (Inv32Guards.readWord 1 c after out _ rfl)
  have L := Inv48.Positive.returnExpr (n+16) t c after (w out).value _ read
  have list : Stmt.evalList (n+17) t c inside
      [.varDecl .uint256 out none,stageShape.value,.returnValues [(w out).value]] =
      pure (.returned after [.word (max a.toNat b.toNat)]) :=
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans (stop _ _ _ _ _ _ [] _ L))
  have inner := blockReturned (n+17) t c outside after _ _ list
  have A := cleanParamExec (n+17) t c outside "a" a.toNat a.isLt rfl
    (by dsimp [outside,src,frame]; store_flag)
  have B := cleanParamExec (n+17) t c outside "b" b.toNat b.isLt rfl
    (by dsimp [outside,src,frame]; store_flag)
  have skip : Stmt.eval (n+18) t c outside .skip = pure (.normal outside) := by rw [Stmt.eval]
  apply blockReturned (n+18) t c src outside _ _
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ B).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip).trans (stop _ _ _ _ _ _ [] _ inner)))

theorem call (table : FunctionTable) (linked : Inv32Library.LinkAt table key [.word "a",.word "b"] [.word "_ret0"] body) (ternaryLinked : Inv32Library.LinkAt table Inv32Bodies.Ternary.key [.flag "condition",.word "a",.word "b"] [.word "_ret0"] Inv32Bodies.Ternary.body) (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body) (n : Nat) (c : Context) (r : Runtime) (x y : String) (targets : List String)
    (a b : W) (X : r.lookupLocal? x = some (.word a.toNat)) (Y : r.lookupLocal? y = some (.word b.toNat)) :
    Stmt.eval (n+20) table c r (.internalCall targets key [.var x,.var y]) =
      internalCallAssign r targets [.word (max a.toNat b.toNat)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := linked
  let empty := {r with locals := []}
  let source := empty.withFrame (frame a.toNat b.toNat)
  have enter : internalCallEnter? fn [.word a.toNat,.word b.toNat] r = some (source,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,source,empty,Runtime.withFrame,frame]
  have ev := execute table ternaryLinked uintLinked n {c with checked := true} empty a b
  change Stmt.eval _ _ _ source _ = _ at ev
  rw [←bd] at ev
  have args := Inv32ProductCall.args c r x y a.toNat b.toNat X Y
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,source,empty,
    Runtime.withFrame,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]

#print axioms stageExec
#print axioms execute
#print axioms call
end Inv48.PositiveMaxCore
