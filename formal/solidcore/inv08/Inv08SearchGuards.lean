import Inv08Loop
import Inv08SearchTable
open SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv08.Expiry
private theorem bindOk {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl

theorem retLocal (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) (v : Nat)
    (fit : v < 2^48) (look : r.lookupLocal? name=some (.word v)) :
    Stmt.eval (n+1) t c r (ret (w48 name)).value = pure (.returned r [.word v]) :=
  Inv32CompareValues.retOne _ _ _ _ _ _ (local48 _ _ _ _ fit look _ (Nat.le_succ _))

theorem assignLe (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (dest left right : String)
    (a b init : Nat) (af : a<2^48) (bf : b<2^48) (D : r.lookupLocal? dest=some (.word init))
    (L : r.lookupLocal? left=some (.word a)) (B : r.lookupLocal? right=some (.word b))
    (write : r.assignLocal? dest (.word (boolWord (decide (a≤b)))) = some next) :
    Stmt.eval (n+1) t c r (assign dest (Expr_binary BinaryOp_le (w48 left) (w48 right))).value = pure (.normal next) := by
  have noMem : (LValue.var dest).wantsMemoryRefRhs r = false := by
    simp [LValue.wantsMemoryRefRhs,Runtime.lookupMemoryRef?,D]
  change Stmt.eval _ _ _ _ (.assign (.var dest) (.binary .le _ _)) = _
  rw [Stmt.eval]
  dsimp only
  rw [noMem]
  simp only [Bool.false_eq_true,if_false,leEval c r left right a b af bf L B]
  change (do match ← ((LValue.var dest).resolveWithRuntime c r).caught with
             | .ok (target,r') => match target.write c r' (.word (boolWord (decide (a≤b)))) with
               | .ok updated => pure (Result.normal updated)
               | .error err => pure (Result.reverted r err)
             | .error err => pure (Result.reverted r err)) = _
  rw [Inv32Writes.resolve c r dest init D]
  have W : (ResolvedLValue.local dest).write c r (.word (boolWord (decide (a≤b)))) = .ok next := by
    simp [ResolvedLValue.write,write]
  change (match (ResolvedLValue.local dest).write c r (.word (boolWord (decide (a≤b)))) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (.reverted r err)) = _
  rw [W]

theorem notFlag (c : Context) (r : Runtime) (b : Bool)
    (look : r.lookupLocal? "#cond736"=some (.word (boolWord b))) :
    (Expr.unary .logicalNot (.var "#cond736")).eval c r=pure (.word (boolWord (!b)),r) := by
  change Expr.evalFuel 3 c r _ = _
  rw [Expr.evalFuel,Inv32Guards.readWord 1 c r _ _ look]
  cases b <;> rfl

theorem eqZero (c : Context) (r : Runtime) (hi : Nat) (fit : hi<2^48)
    (H : r.lookupLocal? "high"=some (.word hi)) :
    (Expr.binary .eq (w48 "high").value (uint48 (num 0)).value).eval c r = pure (.word (boolWord (decide (hi=0))),r) := by
  have zero : Inv40.Reads c r (uint48 (num 0)).value 0 := by
    intro n e
    change 2≤n at e
    obtain ⟨k,rfl⟩ := Nat.exists_eq_add_of_le e
    rw [Nat.add_comm]
    change Expr.evalFuel (k+2) c r (.castOp .uintCast 48 (.word 0)) = _
    rw [Expr.evalFuel,Expr.evalFuel]
    cases c.checked <;> rfl
  simpa [boolWord] using ReleaseQuote.binary (local48 _ _ _ _ fit H) zero .eq (by intro h; cases h) (by intro h; cases h)
    (Inv32WideGuards.eqWord _ _ _ (lt_trans fit (by decide)) (by decide)) _ (Nat.le_succ _)

def flagged (r : Runtime) (tm hi : Nat) (b : Bool) := (withHigh r tm hi).pushScope.declareLocal "#cond736" (.word (boolWord b))
def flaggedEnd (r : Runtime) (tm hi : Nat) (b : Bool) (d : Nat) := (flagged r tm hi b).pushScope.declareLocal "#read733" (.word d)

theorem upper (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm hi : Nat)
    (ends : Nat → Nat) (tf : tm<2^48) (hf : hi<2^48)
    (endF : ends hi<2^48) (table : EndTable c r.state ends hi) :
    Stmt.eval (n+6) t c (withHigh r tm hi) upperTest.value =
      pure (if hi=0 ∨ ends hi≤tm then .returned (withHigh r tm hi) [.word hi] else .normal (withHigh r tm hi)) := by
  let init := decide (hi=0)
  let result := decide (hi=0 ∨ ends hi≤tm)
  let outer := (withHigh r tm hi).pushScope
  let flag := fun b => flagged r tm hi b
  let test := Expr_unary logicalNot (varP "#cond736")
  let probe := block [atEnd "#read733" "high",assign "#cond736" (Expr_binary BinaryOp_le (w48 "#read733") (w48 "timestamp"))]
  let first := Stmt_ifElse test probe Stmt_skip
  let last := Stmt_ifElse (varP "#cond736") (ret (w48 "high")) Stmt_skip
  have D := Inv32Hoist.declEval (n+4) t c outer "#cond736" .bool _ (boolWord init) (eqZero c outer hi hf rfl)
    (Inv32Hoist.boolCoerce init)
  have F : Stmt.eval (n+5) t c (flag init) first.value = pure (.normal (flag result)) := by
    refine (Inv32Blocks.branch (n+4) t c (flag init) test.value _ _ (!init) (notFlag _ _ _ rfl)).trans ?_
    by_cases z : hi=0
    · simp only [init,result,z,true_or,decide_true,Bool.not_true,Bool.false_eq_true,if_false]
      change Stmt.eval (n+4) t c (flag true) .skip = _
      rw [Stmt.eval]
    · have i : init=false := decide_eq_false z
      have out : result=decide (ends hi≤tm) := by simp [result,z]
      rw [i,out]
      simp only [Bool.not_false,if_true]
      have read := readEnd c (flag false).pushScope "high" hi (ends hi) rfl (table _ _ rfl (by omega))
      have P := Inv32Hoist.declEval (n+2) t c (flag false).pushScope "#read733" .uint256 _ _ (cleaned read endF _ (Nat.le_succ _)) (by rfl)
      let rt := fun b => flaggedEnd r tm hi b (ends hi)
      have A := assignLe (n+2) t c (rt false) (rt (decide (ends hi≤tm))) "#cond736" "#read733" "timestamp" (ends hi) tm 0 endF tf rfl rfl rfl
        (by dsimp [rt,flaggedEnd,flagged]; write_expiry)
      exact Inv32Hoist.block _ _ _ _ _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ P).trans
        ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] A).trans (by rw [Stmt.evalList])))
  have L := Inv32Blocks.branch (n+4) t c (flag result) (varP "#cond736").value (ret (w48 "high")).value .skip result
    (Inv32Guards.readWord _ _ _ _ _ rfl)
  by_cases h : hi=0 ∨ ends hi≤tm
  · have res : result=true := decide_eq_true h
    rw [if_pos h]
    rw [show (if result=true then (ret (w48 "high")).value else Stmt.skip)=(ret (w48 "high")).value by simp [res]] at L
    have R' := (L.trans (retLocal _ _ _ _ "high" hi hf rfl))
    exact Inv32FloorFastPath.blockReturned _ _ _ _ _ _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ D).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ F).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ R')))
  · have res : result=false := decide_eq_false h
    rw [if_neg h]
    rw [show (if result=true then (ret (w48 "high")).value else Stmt.skip)=Stmt.skip by simp [res]] at L
    have skipped : Stmt.eval (n+4) t c (flag result) .skip = pure (.normal (flag result)) := by rw [Stmt.eval]
    rw [skipped] at L
    exact Inv32Hoist.block _ _ _ _ _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ D).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ F).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] L).trans (by rw [Stmt.evalList]))))
end Inv08.Expiry
