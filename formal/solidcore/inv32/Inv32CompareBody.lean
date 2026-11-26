import Inv32CompareValues
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Actions Inv32QuoteExpr Inv32CompareValues
namespace Inv32CompareBody
def declareAdd (dst x y : String) := Stmt.varDecl .uint256 dst (some (add x y).core)
def setCarry := Stmt.ifElse (smaller "lowSum" "firstLow").core (.assign (.var "carry") (.word 1)) (.assign (.var "carry") (.word 0))
def check (x y : String) := Stmt.ifElse (smaller x y).core (.returnValues [.word 0]) .skip
def statements : List Stmt := [declareAdd "lowSum" "firstLow" "secondLow",.varDecl .uint256 "carry" none,setCarry,
  declareAdd "highWithoutCarry" "firstHigh" "secondHigh",check "highWithoutCarry" "firstHigh",
  declareAdd "highSum" "highWithoutCarry" "carry",check "highSum" "highWithoutCarry",.returnValues [last]]
theorem remaining : Inv32CompareProducts.ss.drop 27 = [.unchecked (.block statements)] := by rfl
theorem declAdd (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (dst x y : String) (a b : Nat)
    (ha : a<R) (hb : b<R) (C : c.checked=false) (X : locals r x = some a) (Y : locals r y = some b) :
    Stmt.eval (n+1) t c r (declareAdd dst x y) = pure (.normal (r.declareLocal dst (.word ((a+b)%R)))) :=
  Inv32Hoist.declEval _ _ _ _ _ _ _ _ (evalFormula _ _ _ _ (by change 5 ≤ 8; decide)
    (C ▸ addValue _ _ _ _ _ ha hb X Y)) (by rw [Ty.coerceValue?])
theorem branch (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y : String) (a b : Nat)
    (ha : a<R) (hb : b<R) (X : locals r x = some a) (Y : locals r y = some b) :
    Stmt.eval (n+2) t c r (check x y) = pure (if a<b then .returned r [.word 0] else .normal r) := by
  have guard := evalFormula (smaller x y) c r _ (by change 3≤6; decide) (less _ _ _ _ _ _ ha hb X Y)
  unfold check; rw [Inv32Blocks.branch _ _ _ _ _ _ _ _ guard]
  by_cases h : a<b
  · simp only [h,decide_true,if_true]; exact retOne n t c r (.word 0) 0 (by change Expr.evalFuel 2 c r (.word 0) = _; rw [Expr.evalFuel]; rfl)
  · simp only [h,decide_false,if_false,Bool.false_eq_true]; rw [Stmt.eval]

theorem run (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (p s z : Nat)
    (hp : p<R*R) (hs : s<R*R) (hz : z<R*R)
    (A : locals r "firstHigh" = some (p/R)) (B : locals r "firstLow" = some (p%R))
    (C : locals r "secondHigh" = some (s/R)) (D : locals r "secondLow" = some (s%R))
    (E : locals r "rightHigh" = some (z/R)) (F : locals r "rightLow" = some (z%R)) :
    ∃ next, Inv32WidePath.sameEffects next r ∧ Stmt.eval (n+4) t c r (.unchecked (.block statements)) =
      pure (.returned next [.word (boolWord (Inv32.limbCompare p s z))]) := by
  let ctx := {c with checked := false}
  let small := fun x => Nat.mod_lt x (Nat.two_pow_pos 256)
  let upper := fun (x : Nat) (bound : x<R*R) => (Nat.div_lt_iff_lt_mul (Nat.two_pow_pos 256)).mpr bound
  let l := (p%R+s%R)%R
  let carry := if l<p%R then 1 else 0
  let h := (p/R+s/R)%R
  let allH := (h+carry)%R
  have cr : carry<R := by dsimp [carry]; split <;> decide
  let lowState := r.pushScope.declareLocal "lowSum" (.word l)
  let ca := fun v => lowState.declareLocal "carry" (.word v)
  let mid := (ca carry).declareLocal "highWithoutCarry" (.word h)
  let end' := mid.declareLocal "highSum" (.word allH)
  have L := declAdd (n+1) t ctx r.pushScope "lowSum" "firstLow" "secondLow" _ _ (small _) (small _) rfl B D
  have Z := Inv32FloorStart.zero (n+1) t ctx lowState "carry"
  have guard := evalFormula (smaller "lowSum" "firstLow") ctx (ca 0) _ (by decide) (less _ _ _ _ l _ (small _) (small _) rfl B)
  have K : Stmt.eval (n+2) t ctx (ca 0) setCarry = pure (.normal (ca carry)) := by
    unfold setCarry; rw [Inv32Blocks.branch _ _ _ _ _ _ _ _ guard]
    by_cases h : l<p%R <;> simp only [h,decide_true,decide_false,Bool.false_eq_true,if_true,if_false]
    all_goals apply Inv32Writes.constant _ _ _ _ _ _ 0 _ rfl
    all_goals simp [ca,lowState,carry,h,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,
      Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?] <;> rfl
  have H := declAdd (n+1) t ctx (ca carry) "highWithoutCarry" "firstHigh" "secondHigh" _ _ (upper _ hp) (upper _ hs) rfl A C
  have B1 := branch n t ctx mid "highWithoutCarry" "firstHigh" h _ (small _) (upper _ hp) rfl A
  have T := declAdd (n+1) t ctx mid "highSum" "highWithoutCarry" "carry" h carry (small _) cr rfl rfl rfl
  have B2 := branch n t ctx end' "highSum" "highWithoutCarry" allH h (small _) (small _) rfl rfl
  have R' := retOne (n+1) t ctx end' last _ (finalExpr ctx end' allH l (z/R) (z%R) (small _) (small _) (upper _ hz) (small _) rfl rfl rfl E F)
  let rest := [check "highWithoutCarry" "firstHigh",declareAdd "highSum" "highWithoutCarry" "carry",
    check "highSum" "highWithoutCarry",.returnValues [last]]
  have prefix' : Stmt.evalList (n+2) t ctx r.pushScope statements = Stmt.evalList (n+2) t ctx mid rest :=
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ L).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ K).trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ H)))
  have finish (next : Runtime) (eff : Inv32WidePath.sameEffects next r) (word : Nat)
      (val : boolWord (Inv32.limbCompare p s z) = word)
      (ev : Stmt.evalList (n+2) t ctx mid rest = pure (.returned next [.word word])) :
      ∃ out, Inv32WidePath.sameEffects out r ∧ Stmt.eval (n+4) t c r (.unchecked (.block statements)) =
        pure (.returned out [.word (boolWord (Inv32.limbCompare p s z))]) := by
    refine ⟨next.popScope,fun ls => eff ls,?_⟩
    rw [Stmt.eval,val]
    exact Inv32FloorFastPath.blockReturned _ _ _ _ _ _ _ (prefix'.trans ev)
  by_cases one : h<p/R
  · rw [if_pos one] at B1
    exact finish mid (fun _ => rfl) 0 (by unfold Inv32.limbCompare; change boolWord (if h<p/R then false else _) = 0; rw [if_pos one]; rfl)
      (Inv32FloorFastPath.stop _ _ _ _ _ _ _ _ B1)
  · rw [if_neg one] at B1
    by_cases two : allH<h
    · rw [if_pos two] at B2
      apply finish end' (fun _ => rfl) 0
      · change boolWord (if h<p/R then false else if allH<h then false else _) = 0
        rw [if_neg one,if_pos two]; rfl
      · exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ B1).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ T).trans
          (Inv32FloorFastPath.stop _ _ _ _ _ _ _ _ B2))
    · rw [if_neg two] at B2
      apply finish end' (fun _ => rfl) (boolWord (test allH l (z/R) (z%R)))
      · change boolWord (if h<p/R then false else if allH<h then false else _) = _
        rw [if_neg one,if_neg two]; rfl
      · exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ B1).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ T).trans
          ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ B2).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ R')))
end Inv32CompareBody
