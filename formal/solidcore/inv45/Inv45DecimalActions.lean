import Inv45DecimalShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Decimal
theorem update (n : Nat) (t : FunctionTable) (c : Context) (r dst : Runtime) (isUp : Bool) (name : String) (old val : Nat)
    (loc : r.lookupLocal? name=some (.word old)) (fit : val<R)
    (operation : (if isUp then Source.BinaryOp.add else .sub).apply c.checked (.word old) (.word 1)=.ok (.word val))
    (store : r.assignLocal? name (.word val)=some dst) :
    Stmt.eval (n+1) t c r (adjust isUp name).value=pure (.normal dst) := by
  let op := if isUp then Source.BinaryOp.add else .sub
  have ns : r.lookupStorageBase? name=none := by simp [Runtime.lookupStorageBase?,loc]
  have resolve : Expr.resolveLValueFuel 2 c r (.var name)=pure (.local name,r) := by rw [Expr.resolveLValueFuel,ns,loc]
  have read : (ResolvedLValue.local name).read c r=.ok (.word old) := by
    simp [ResolvedLValue.read,ResolvedLValue.readRaw,loc,Runtime.derefMemoryValue,Bind.bind,Except.bind]
  have wr : (ResolvedLValue.local name).write c r (.word val)=.ok dst := by simp [ResolvedLValue.write,store]
  have cl : (ValueCleanup.uint 256).apply c.checked (.word val)=.ok (.word val) := Inv32Guards.cleanupWord _ _ fit
  have act : (ResolvedLValue.local name).applyIncDecCleanup c r op true (.uint 256)=.ok (.word old,dst) := by
    simp [ResolvedLValue.applyIncDecCleanup,read,wr,Value.oneLike?,op,operation,cl,Bind.bind,Except.bind]
  have E : Expr.eval c r (.incDec op true (some (.uint 256)) (.var name))=pure (.word old,dst) := by
    change Expr.evalFuel 3 c r _=_
    rw [Expr.evalFuel,resolve]
    simp only [Inv08.Authority.bindPure,act,Inv08.Authority.liftPure]
  change Stmt.eval _ _ _ _ (.exprStmt (.incDec op true (some (.uint 256)) (.var name)))=_
  rw [Stmt.eval];dsimp only;rw [E];rfl
theorem divideExec (n : Nat) (t : FunctionTable) (c : Context) (r dst : Runtime) (name : String) (v : Nat)
    (loc : r.lookupLocal? name=some (.word v)) (fit : v<R) (store : r.assignLocal? name (.word (v/10))=some dst) :
    Stmt.eval (n+1) t c r (divide name).value = pure (.normal dst) := by
  apply Inv32Compound.stmt n t .div c r dst name v 10 (v/10) (Inv32Scalar.literal 10) (by change 1≤3;decide) loc rfl
    (Inv32Eval.divideWords _ _ _ fit (by decide) (by decide)) (lt_of_le_of_lt (Nat.div_le_self ..) fit) store
theorem testNonzero (c : Context) (r : Runtime) (name : String) (v : Nat) (fit : v<R) (loc : r.lookupLocal? name=some (.word v)) :
    Inv40.Reads c r (notZero name).value (if v=0 then 0 else 1) := by
  apply Inv08.ReleaseQuote.binary (MulDiv.wordVar c r name _ fit loc) (Inv08.Authority.literal c r 0 (by decide)) .ne
    (by intro h;cases h) (by intro h;cases h)
  change Except.ok (Value.word (boolWord (!(wordEq v 0))))=_
  have N : Shared.norm v=v := Nat.mod_eq_of_lt fit
  by_cases zero : v=0
  · subst v;rfl
  · simp [wordEq,N,zero,boolWord,show Shared.norm 0=0 from rfl]
theorem stopLoop (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (test body) (D : Inv40.Reads c r test 0) :
    Stmt.evalWhile (n+1) t c r test body=pure (.normal r) := by
  have ev : Expr.eval c r test=pure (.word 0,r) := D _ (by omega)
  rw [Stmt.evalWhile,ev];rfl
theorem stepLoop (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (test body)
    (D : Inv40.Reads c r test 1) (B : Stmt.eval n t c r body=pure (.normal next)) :
    Stmt.evalWhile (n+1) t c r test body=Stmt.evalWhile n t c next test body := by
  have ev : Expr.eval c r test=pure (.word 1,r) := D _ (by omega)
  rw [Stmt.evalWhile,ev]
  change (do match ← Stmt.eval n t c r body with
    | .normal r | .continued r => Stmt.evalWhile n t c r test body
    | .broke r => pure (.normal r)
    | result => pure result)=_
  rw [B];rfl
def countState (r : Runtime) (d v : Nat) := r.withFrame [("digits",.word d),("tempValue",.word v)]
macro "store_digits" : tactic => `(tactic|
  simp [countState,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
    LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem countStep (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d v : Nat)
    (D : d+1<R) (V : v<R) : Stmt.eval (n+2) t c (countState r d v) countBody.value=pure (.normal (countState r (d+1) (v/10))) := by
  let s := countState r d v
  let m := countState r (d+1) v
  let f := countState r (d+1) (v/10)
  have up := update n t c s.pushScope m.pushScope true "digits" d (d+1) rfl D (Inv40.addWords _ _ _ D) (by dsimp [s,m];store_digits)
  have div := divideExec n t c m.pushScope f.pushScope "tempValue" v rfl V (by dsimp [m,f];store_digits)
  have list : Stmt.evalList (n+1) t c s.pushScope [(adjust true "digits").value,(divide "tempValue").value]=pure (.normal f.pushScope) :=
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ up).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ div).trans (by rw [Stmt.evalList]))
  change Stmt.eval (n+2) t c s (.block [_,_])=_
  rw [Stmt.eval];dsimp only;rw [list];rfl
theorem count (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v d : Nat) (V : v<R)
    (D : d+(reversed v).length<R) :
    Stmt.evalWhile (fuel+3+(reversed v).length) t c (countState r d v) (notZero "tempValue").value countBody.value=
      pure (.normal (countState r (d+(reversed v).length) 0)) := by
  induction v using Nat.strong_induction_on generalizing d with
  | h v ih =>
    have test := testNonzero c (countState r d v) "tempValue" v V rfl
    by_cases z : v=0
    · subst v;rw [if_pos rfl] at test
      have len : (reversed 0).length=0 := by rw [reversed];rfl
      rw [len,Nat.add_zero,Nat.add_zero];exact stopLoop _ _ _ _ _ _ test
    · rw [if_neg z] at test
      have stepDigits : reversed v=(48+v%10)::reversed (v/10) := by rw [reversed,dif_neg z]
      rw [stepDigits,List.length_cons] at D ⊢
      let k := (reversed (v/10)).length
      have V' := lt_of_le_of_lt (Nat.div_le_self v 10) V
      have act := countStep (fuel+1+k) t c r d v (by omega) V
      have next := ih (v/10) (Nat.div_lt_self (Nat.pos_of_ne_zero z) (by decide)) (d+1) V' (by dsimp [k] at *;omega)
      rw [show fuel+3+((reversed (v/10)).length+1)=(fuel+1+k+2)+1 by dsimp [k];omega,stepLoop _ _ _ _ _ _ _ test act]
      change Stmt.evalWhile (fuel+1+k+2) t c (countState r (d+1) (v/10)) _ _ =
        pure (.normal (countState r (d+(k+1)) 0))
      rw [show fuel+1+k+2=fuel+3+k by omega,show d+(k+1)=d+1+k by omega]
      exact next
end Inv45.Decimal
