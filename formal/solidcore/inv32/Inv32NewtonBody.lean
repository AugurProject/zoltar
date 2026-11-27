import Inv32Compound
open SolidCore.Solidity.Source Inv32Scalar Inv32Product Inv32Division Inv32Actions
namespace Inv32NewtonBody
abbrev W := BitVec 256
def den := clean (localWord "denominator")
def inv := clean (localWord "inverse")
def twice (e : Formula) := clean (clean e)
def operand := twice (subF (literal 2) (twice (mulF den inv)))
def step : Stmt := .exprStmt (.assignment (some .mul) (some (.uint 256)) (.var "inverse") operand.core)
theorem stepsInBody : (Inv32FloorStart.instructions.drop 17).take 6 = List.replicate 6 step := by rfl

theorem mulWord (a b : W) :
    BinaryOp.apply false .mul (.word a.toNat) (.word b.toNat) = .ok (.word (a*b).toNat) := by
  simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,Inv32Execution.mul,Bind.bind,Except.bind]
theorem subWord (a b : W) :
    BinaryOp.apply false .sub (.word a.toNat) (.word b.toNat) = .ok (.word (a-b).toNat) := by
  simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,Inv32Execution.sub,Bind.bind,Except.bind]
theorem double (e : Formula) (env : Env) (v : W) (h : e.run false env = some v.toNat) :
    (twice e).run false env = some v.toNat :=
  Inv32ProductValues.cleanup _ _ _ _ v.isLt (Inv32ProductValues.cleanup _ _ _ _ v.isLt h)
theorem operandValue (env : Env) (d i : W)
    (dh : env "denominator" = some d.toNat) (ih : env "inverse" = some i.toNat) :
    operand.run false env = some (2-d*i).toNat := by
  have D := Inv32ProductValues.cleanup (localWord "denominator") false env _ d.isLt dh
  have I := Inv32ProductValues.cleanup (localWord "inverse") false env _ i.isLt ih
  have P : (twice (mulF den inv)).run false env = some (d*i).toNat := by
    apply double; simp [mulF,den,inv,binary,D,I,mulWord,projectWord]
  apply double
  have two : (literal 2).run false env = some (2 : W).toNat := rfl
  simp only [subF,binary,two,P,Option.bind_some,Option.bind]
  change projectWord (BinaryOp.apply false .sub (.word (2 : W).toNat) (.word (d*i).toNat)) = _
  rw [subWord (2 : W) (d*i)]; rfl

def put (r : Runtime) (i : W) := r.declareLocal "inverse" (.word i.toNat)
private theorem atInv (r : Runtime) (i : W) : (put r i).lookupLocal? "inverse" = some (.word i.toNat) := by
  cases h : r.locals <;> simp [put,Runtime.declareLocal,LocalEnv.declare,h,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
private theorem atDen (r : Runtime) (d i : W) (h : locals r "denominator" = some d.toNat) :
    locals (put r i) "denominator" = some d.toNat := by
  cases eqn : r.locals <;> simpa [locals,put,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,
    LocalEnv.lookup?,Frame.lookup?,eqn] using h
private theorem write (r : Runtime) (i j : W) : (put r i).assignLocal? "inverse" (.word j.toNat) = some (put r j) := by
  cases eqn : r.locals <;> simp [put,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,
    LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?,eqn]

theorem execute (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d i : W)
    (unchecked : c.checked = false) (hd : locals r "denominator" = some d.toNat) :
    Stmt.eval (n+1) t c (put r i) step = pure (.normal (put r (i*(2-d*i)))) := by
  have ih : locals (put r i) "inverse" = some i.toNat := by simp [locals,atInv]
  exact Inv32Compound.stmt _ _ _ _ _ _ _ _ _ _ operand (by decide) (atInv r i)
    (unchecked ▸ operandValue _ d i (atDen _ _ _ hd) ih)
    (unchecked ▸ mulWord i (2-d*i)) (i*(2-d*i)).isLt (write _ _ _)
theorem iterateSteps (k n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : W)
    (ss : List Stmt) (u : c.checked = false) (hd : locals r "denominator" = some d.toNat) :
    Stmt.evalList (n+1) t c (put r (Inv32Newton.seed d)) (List.replicate k step ++ ss) =
    Stmt.evalList (n+1) t c (put r (Inv32Newton.iterate d k)) ss := by
  induction k generalizing ss with
  | zero => rfl
  | succ k ih =>
    rw [List.replicate_succ',List.append_assoc,ih]
    exact Inv32FloorStart.seqStep _ _ _ _ _ _ _ (execute _ _ _ _ _ _ u hd)

theorem generatedSix (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : W)
    (ss : List Stmt) (u : c.checked = false) (hd : locals r "denominator" = some d.toNat) :
    Stmt.evalList (n+1) t c (put r (Inv32Newton.seed d)) (((Inv32FloorStart.instructions.drop 17).take 6) ++ ss) =
    Stmt.evalList (n+1) t c (put r (Inv32Newton.iterate d 6)) ss := by
  rw [stepsInBody,iterateSteps _ _ _ _ _ _ _ u hd]
end Inv32NewtonBody
