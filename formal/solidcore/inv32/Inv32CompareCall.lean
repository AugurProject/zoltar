import Inv32CompareBody
open SolidCore.Solidity.Source Inv32Division Inv32CompareProducts Inv32FloorFastPath
namespace Inv32CompareCall
def frame (k a b s v : Nat) : Frame := [("multiplier",.word k),("first",.word a),("second",.word b),
  ("rightMultiplier",.word s),("rightValue",.word v),("_ret0",.word 0)]
theorem bounded {x y : Nat} (hx : x<R) (hy : y<R) : x*y<R*R := lt_of_le_of_lt
  (Nat.mul_le_mul_right _ (Nat.le_of_lt hx)) (Nat.mul_lt_mul_of_pos_left hy (Nat.two_pow_pos 256))
def answer (k a b s v : Nat) := decide (k*(a+b)≤s*v)
theorem correct (k a b s v : Nat) (hk : k<R) (ha : a<R) (hb : b<R) (hs : s<R) (hv : v<R) :
    Inv32.limbCompare (k*a) (k*b) (s*v) = answer k a b s v := by
  apply Bool.eq_iff_iff.mpr
  simpa [answer,Nat.mul_add] using Inv32.limbCompare_correct _ _ _ (bounded hk ha) (bounded hk hb) (bounded hs hv)
set_option maxRecDepth 16000
theorem execute (n : Nat) (c : Context) (r : Runtime) (k a b s v : Nat) (hk : k<R) (ha : a<R)
    (hb : b<R) (hs : s<R) (hv : v<R) :
    ∃ next, Inv32WidePath.sameEffects next r ∧ Stmt.eval (n+10) Inv32Dispatch.model.core.table c (r.withFrame (frame k a b s v))
      Inv32Bodies.Comparison.body = pure (.returned next [.word (boolWord (answer k a b s v))]) := by
  let t := Inv32Dispatch.model.core.table
  let out := (r.withFrame (frame k a b s v)).pushScope
  let as' := products .first k a
  let bs := products .second k b ++ as'
  let cs := products .right s v ++ bs
  let atEnd := out.withFrame cs
  obtain ⟨next,eff,ev⟩ := Inv32CompareBody.run (n+4) t c atEnd (k*a) (k*b) (s*v) (bounded hk ha)
    (bounded hk hb) (bounded hs hv) rfl rfl rfl rfl rfl rfl
  rw [correct _ _ _ _ _ hk ha hb hs hv] at ev
  have segment : Stmt.evalList (n+8) t c out.pushScope ss = pure (.returned next [.word (boolWord (answer k a b s v))]) := by
    change Stmt.evalList _ _ _ _ (steps .first ++ (steps .second ++ (steps .right ++ [.unchecked (.block Inv32CompareBody.statements)]))) = _
    refine (Inv32CompareProducts.execute (n+6) c out [] .first k a hk ha rfl rfl _ (by omega)).trans ?_
    refine (Inv32CompareProducts.execute (n+6) c out as' .second k b hk hb rfl rfl _ (by omega)).trans ?_
    refine (Inv32CompareProducts.execute (n+6) c out bs .right s v hs hv rfl rfl _ (by omega)).trans ?_
    exact stop _ _ _ _ _ _ [] _ ev
  have inner := blockReturned _ t c out next ss _ segment
  have S : Stmt.eval (n+9) t c out .skip = pure (.normal out) := by rw [Stmt.eval]
  have K := cleanParamExec (n+8) t c out "multiplier" k hk rfl (by dsimp [out,frame]; write_param)
  have A := cleanParamExec (n+8) t c out "first" a ha rfl (by dsimp [out,frame]; write_param)
  have B := cleanParamExec (n+8) t c out "second" b hb rfl (by dsimp [out,frame]; write_param)
  have U := cleanParamExec (n+8) t c out "rightMultiplier" s hs rfl (by dsimp [out,frame]; write_param)
  have V := cleanParamExec (n+8) t c out "rightValue" v hv rfl (by dsimp [out,frame]; write_param)
  refine ⟨next.popScope.popScope,fun ls => eff ls,?_⟩
  apply blockReturned _ _ _ _ _ [cleanParam "multiplier",cleanParam "first",cleanParam "second",cleanParam "rightMultiplier",
    cleanParam "rightValue",.skip,.block ss]
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ K).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ B).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ U).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ V).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans
    (stop _ _ _ _ _ _ [] _ inner))))))
private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl
theorem call (n : Nat) (c : Context) (r : Runtime) (p0 p1 p2 p3 p4 : String) (targets : List String)
    (k a b s v : Nat) (hk : k<R) (ha : a<R) (hb : b<R) (hs : s<R) (hv : v<R)
    (K : r.lookupLocal? p0 = some (.word k)) (A : r.lookupLocal? p1 = some (.word a))
    (B : r.lookupLocal? p2 = some (.word b)) (S : r.lookupLocal? p3 = some (.word s)) (V : r.lookupLocal? p4 = some (.word v)) :
    Stmt.eval (n+11) Inv32Dispatch.model.core.table c r (.internalCall targets Inv32Bodies.Comparison.key
      [.var p0,.var p1,.var p2,.var p3,.var p4]) = internalCallAssign r targets [.word (boolWord (answer k a b s v))] := by
  obtain ⟨fn,link,ps,rs,bd⟩ := Inv32Library.linkComparison
  let empty := {r with locals := []}
  let src := empty.withFrame (frame k a b s v)
  have enter : internalCallEnter? fn [.word k,.word a,.word b,.word s,.word v] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have args : Expr.evalRefArgList c r [.var p0,.var p1,.var p2,.var p3,.var p4] = pure ([.word k,.word a,.word b,.word s,.word v],r) := by
    change Expr.evalRefArgListFuel (_+1) c r _ = _
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ K,
      Inv32ProductCall.wordArg _ _ _ _ A,Inv32ProductCall.wordArg _ _ _ _ B,Inv32ProductCall.wordArg _ _ _ _ S,Inv32ProductCall.wordArg _ _ _ _ V,pb]
  obtain ⟨next,eff,ev⟩ := execute n {c with checked := true} empty k a b s v hk ha hb hs hv
  rw [← bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args link enter ev]
  have restore : {next with locals := r.locals} = r := eff _
  have ret : coerceReturnBindingsRef fn.returns next [.word (boolWord (answer k a b s v))] = .ok [.word (boolWord (answer k a b s v))] := by
    rw [rs]; simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Inv32Hoist.boolCoerce,Bind.bind,Except.bind]
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,ret,restore]
end Inv32CompareCall
