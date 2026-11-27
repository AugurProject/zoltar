import Inv32CeilBody
open SolidCore.Solidity.Source Inv32Division Inv32FloorFastPath Inv32Exit Inv32CeilBody
namespace Inv32CeilCall
def frame (x y d : Nat) : Frame := [("x",.word x),("y",.word y),("denominator",.word d),("rounding",.word 1),("_ret0",.word 0)]
theorem exec (n : Nat) (c : Context) (r : Runtime) (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d)
    (ch : c.checked=true) :
    Terminates r (words (ceilResult x y d)) (Stmt.eval (n+27) Inv32Dispatch.model.core.table c
      (r.withFrame (frame x y d)) Inv32Bodies.Ceil.body) := by
  let t := Inv32Dispatch.model.core.table
  let outside := (r.withFrame (frame x y d)).pushScope
  have body := block _ t c r outside _ _ (runFlags n c r x y d hx hy hd hp ch)
  have A := cleanParamExec (n+25) t c outside "x" x hx rfl (by dsimp [outside,frame]; write_param)
  have B := cleanParamExec (n+25) t c outside "y" y hy rfl (by dsimp [outside,frame]; write_param)
  have D := cleanParamExec (n+25) t c outside "denominator" d hd rfl (by dsimp [outside,frame]; write_param)
  have S : Stmt.eval (n+26) t c outside .skip = pure (.normal outside) := by rw [Stmt.eval]
  apply block _ _ _ _ _ [cleanParam "x",cleanParam "y",cleanParam "denominator",.skip,.skip,.block Inv32CeilFlags.ss]
  exact pass _ _ _ _ _ _ _ _ _ A (pass _ _ _ _ _ _ _ _ _ B (pass _ _ _ _ _ _ _ _ _ D
    (pass _ _ _ _ _ _ _ _ _ S (pass _ _ _ _ _ _ _ _ _ S (stop _ _ _ _ _ _ [] _ body)))))

def Binds (r : Runtime) (targets : List String) (v : Option Nat) (program : SolI Result) : Prop :=
  match v with
  | some a => program = internalCallAssign r targets [.word a]
  | none => ∃ next err, program = pure (.reverted next err)

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem args4 (c : Context) (r : Runtime) (s1 s2 s3 s4 : String) (a b d e : Nat)
    (A : r.lookupLocal? s1 = some (.word a)) (B : r.lookupLocal? s2 = some (.word b))
    (D : r.lookupLocal? s3 = some (.word d)) (E : r.lookupLocal? s4 = some (.word e)) :
    Expr.evalRefArgList c r [.var s1,.var s2,.var s3,.var s4] = pure ([.word a,.word b,.word d,.word e],r) := by
  change Expr.evalRefArgListFuel (_+1) c r _ = _
  simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ A,
    Inv32ProductCall.wordArg _ _ _ _ B,Inv32ProductCall.wordArg _ _ _ _ D,Inv32ProductCall.wordArg _ _ _ _ E,pb]
theorem call (n : Nat) (c : Context) (r : Runtime) (s1 s2 s3 s4 : String) (targets : List String)
    (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d)
    (A : r.lookupLocal? s1 = some (.word x)) (B : r.lookupLocal? s2 = some (.word y))
    (D : r.lookupLocal? s3 = some (.word d)) (E : r.lookupLocal? s4 = some (.word 1)) :
    Binds r targets (ceilResult x y d) (Stmt.eval (n+28) Inv32Dispatch.model.core.table c r
      (.internalCall targets Inv32Bodies.Ceil.key [.var s1,.var s2,.var s3,.var s4])) := by
  obtain ⟨fn,link,ps,rs,bd⟩ := Inv32Library.linkCeil
  let empty := {r with locals := []}
  let src := empty.withFrame (frame x y d)
  have enter : internalCallEnter? fn [.word x,.word y,.word d,.word 1] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have body := exec n {c with checked := true} empty x y d hx hy hd hp rfl
  rw [←bd] at body
  cases result : ceilResult x y d with
  | none =>
    rw [result] at body
    obtain ⟨next,err,ev⟩ := body
    exact ⟨next,err,Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (args4 _ _ _ _ _ _ _ _ _ _ A B D E) link enter ev⟩
  | some v =>
    rw [result] at body
    obtain ⟨next,effect,ev⟩ := body
    change Stmt.eval _ _ _ src fn.body = pure (.returned next [.word v]) at ev
    unfold Binds
    rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (args4 _ _ _ _ _ _ _ _ _ _ A B D E) link enter ev]
    have restore : {next with locals := r.locals} = r := effect _
    have out : coerceReturnBindingsRef fn.returns next [.word v] = .ok [.word v] := by
      rw [rs]; simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,Runtime.derefMemoryValueDeep,
        Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
    simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,out,restore]
end Inv32CeilCall
