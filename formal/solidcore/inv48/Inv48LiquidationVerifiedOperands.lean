import Inv48LiquidationVerifiedPrologue
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationBody
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl

def start (r : Runtime) := (r.declareLocal "_sol_hoist_0" (.word 0)).pushScope
def a0 (r : Runtime) (p : Nat) := r.declareLocal "_ic_arg_0" (.word p)
def a1 (r : Runtime) (p : Nat) := (a0 r p).declareLocal "_ic_arg_1" (.word 10000000)
def a2 (r : Runtime) (p u : Nat) := (a1 r p).declareLocal "_ic_arg_2" (.word (10000000+u))
def ready (r : Runtime) (p u : Nat) := (a2 r p u).declareLocal Inv32FloorHoist.ret (.word 0)

theorem denominatorFits (u : Nat) (hu : u<10000000) : 10000000+u<R := by
  have big : 20000000<R := by native_decide
  omega

theorem addChecked (a b : Nat) (ha : a<R) (hb : b<R) (hs : a+b<R) :
    BinaryOp.apply true .add (.word a) (.word b) = .ok (.word (a+b)) := by
  have V : BinaryOp.applyWord true .add a b = .ok (a+b) := by
    have h := Inv32Rounding.addition a b ha hb
    rw [if_pos hs] at h
    cases z : BinaryOp.applyWord true .add a b <;> simp_all [Except.toOption]
  simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,V,Bind.bind,Except.bind]

theorem denominatorEval (c : Context) (r : Runtime) (u : Nat) (hu : u<10000000)
    (U : r.lookupLocal? "uncertainty" = some (.word u)) (checked : c.checked=true) :
    Expr.eval c r (.castOp .uintCleanup 256 (.castOp .uintCleanup 256
      (.binary .add (.ternary (.word 1) (.word 10000000) (.word 10000000))
        (.castOp .uintCleanup 256 (.var "uncertainty"))))) =
      pure (.word (10000000+u),r) := by
  have bound := denominatorFits u hu
  have ub : u<R := by omega
  unfold Expr.eval
  apply Inv32Guards.clean _ _ _ _ _ bound
  apply Inv32Guards.clean _ _ _ _ _ bound
  apply Inv32Eval.binary _ _ _ .add (by intro h; cases h) (by intro h; cases h)
  · rfl
  · exact Inv32Guards.clean _ _ _ _ _ ub (Inv32Guards.readWord _ _ _ _ _ U)
  · rw [checked]; exact addChecked _ _ (by native_decide) ub bound

theorem setupEval (n : Nat) (c : Context) (r : Runtime) (p u : Nat)
    (hp : p<R) (hu : u<10000000) (checked : c.checked=true)
    (P : r.lookupLocal? "price" = some (.word p))
    (U : r.lookupLocal? "uncertainty" = some (.word u)) :
    Stmt.evalList (n+1) t c r setup = pure (.normal (ready r p u)) := by
  have d0 := Inv32Temps.temp n t c r "_ic_arg_0" "price" p hp P
  have d1 := Inv32Hoist.declEval n t c (a0 r p) "_ic_arg_1" .uint256
    (.ternary (.word 1) (.word 10000000) (.word 10000000)) 10000000 (by rfl) (by rfl)
  have U' : (a1 r p).lookupLocal? "uncertainty" = some (.word u) := by
    cases h : r.locals <;> simp [a1,a0,Runtime.declareLocal,LocalEnv.declare,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,h] at U ⊢ <;> exact U
  have d2 := Inv32Hoist.declEval n t c (a1 r p) "_ic_arg_2" .uint256 _ (10000000+u)
    (denominatorEval c _ u hu U' checked) (by rfl)
  have d3 := Inv32FloorStart.zero n t c (a2 r p u) Inv32FloorHoist.ret
  change Stmt.evalList (n+1) t c r [_,_,_,_] = _
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ d0]
  change Stmt.evalList (n+1) t c (a0 r p) _ = _
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ d1]
  change Stmt.evalList (n+1) t c (a1 r p) _ = _
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ d2]
  change Stmt.evalList (n+1) t c (a2 r p u) _ = _
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ d3,Stmt.evalList]
  rfl

theorem physicalOperands (r : Runtime) (p u : Nat) :
    (ready r p u).lookupLocal? "_ic_arg_0" = some (.word p) ∧
    (ready r p u).lookupLocal? "_ic_arg_1" = some (.word 10000000) ∧
    (ready r p u).lookupLocal? "_ic_arg_2" = some (.word (10000000+u)) := by
  cases h : r.locals <;>
    simp [ready,a2,a1,a0,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,
      LocalEnv.lookup?,Frame.lookup?,h,Inv32FloorHoist.ret]
#print axioms denominatorEval
#print axioms setupEval
#print axioms physicalOperands
end LiquidationBody
