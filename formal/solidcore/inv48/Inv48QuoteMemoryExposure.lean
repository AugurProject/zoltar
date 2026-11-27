import Inv48QuoteMemoryGuards
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

abbrev Reads := Inv08.MemoryMember.Reads

theorem binaryRead (left : Reads c r x a) (right : Reads c r y b) (op : BinaryOp)
    (na : op ≠ .boolAnd) (no : op ≠ .boolOr)
    (operation : op.apply c.checked (.word a) (.word b) = .ok (.word v)) :
    Reads c r (.binary op x y) v := by
  intro fuel enough
  change x.orderFuel+y.orderFuel+1+1≤fuel at enough
  cases fuel with
  | zero => omega
  | succ n =>
      exact Inv32Eval.binary n c r op na no x y _ _ _
        (left _ (by omega)) (right _ (by omega)) operation

theorem mulSuccess (checked : Bool) (a b : Nat) (ha : a<R) (hb : b<R) (fit : a*b<R) :
    BinaryOp.apply checked .mul (.word a) (.word b) = .ok (.word (a*b)) := by
  have plain := Inv32Execution.mul (bv a) (bv b)
  simp only [BitVec.toNat_mul,BitVec.toNat_ofNat,Nat.mod_eq_of_lt ha,Nat.mod_eq_of_lt hb,
    Nat.mod_eq_of_lt fit] at plain
  have same : checkedMul checked a b = checkedMul false a b := by
    simp [checkedMul,show SolidCore.Solidity.Shared.norm a = a from Nat.mod_eq_of_lt ha,
      show SolidCore.Solidity.Shared.norm b = b from Nat.mod_eq_of_lt hb,
      show ¬wordModulus≤a*b from Nat.not_le_of_gt fit]
  have word : checkedMul false a b = .ok (a*b) := plain
  simp [BinaryOp.apply,BinaryOp.applyWord,BinaryOp.preservesFixedBytesWidth,
    Value.forceAbiLazy,Bind.bind,Except.bind,same,word]

def exposureExpr : Expr := clean (clean (.binary .mul
  (clean (clean (.binary .sub (clean (field 0)) (clean (.immutable "minimumReportCollateral")))))
  (.ternary (.word 1) (.word 100) (.word 100))))

/-- Checked subtraction and multiplication used by the exposureLimit assignment. -/
theorem exposureRead (c : Context) (r : Runtime) (id a b h e s minimum : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (imm : r.loadImmutableField c "minimumReportCollateral" = .ok (.word minimum))
    (ha : a<R) (hm : minimum<R) (le : minimum≤a) (fit : (a-minimum)*100<R) :
    Expr.eval c r exposureExpr = pure (.word ((a-minimum)*100),r) := by
  have coll : Reads c r (clean (field 0)) a := Inv08.MemoryMember.clean
    (Inv08.MemoryMember.fromMemory c r "quote" id 0 a [.word a,.word b,.word h,.word e,.word s]
      ref mem (by decide) rfl) ha
  have minRead : Reads c r (.immutable "minimumReportCollateral") minimum := by
    intro fuel enough
    change 1+1≤fuel at enough
    cases fuel with
    | zero => omega
    | succ n => rw [Expr.evalFuel,imm]; rfl
  have sub := binaryRead coll (Inv08.MemoryMember.clean minRead hm) .sub
    (by intro h; cases h) (by intro h; cases h) (Inv32QuoteExpr.subWord c.checked a minimum ha hm le)
  have hs : a-minimum<R := lt_of_le_of_lt (Nat.sub_le a minimum) ha
  have sub' := Inv08.MemoryMember.clean (Inv08.MemoryMember.clean sub hs) hs
  have hundred : Reads c r (.ternary (.word 1) (.word 100) (.word 100)) 100 := by
    intro fuel enough
    change 5≤fuel at enough
    obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le enough
    rw [Nat.add_comm,Expr.evalFuel]
    rfl
  have mul := binaryRead sub' hundred .mul (by intro h; cases h) (by intro h; cases h)
    (mulSuccess c.checked (a-minimum) 100 hs (by decide) fit)
  exact Inv08.MemoryMember.clean (Inv08.MemoryMember.clean mul fit) fit _ (by decide)

theorem exposureComputed (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s minimum : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (imm : r.loadImmutableField c "minimumReportCollateral" = .ok (.word minimum))
    (ha : a<R) (hm : minimum<R) (le : minimum≤a) (fit : (a-minimum)*100<R) :
    Stmt.eval (n+1) t c r (.assign (.index (.var "quote") (.word 3)) exposureExpr) =
      pure (.normal (put r id a b h ((a-minimum)*100) s)) := by
  exact assign n t c r _ id 3 ((a-minimum)*100) .uintCleanup 256 _ ref (by decide)
    (exposureRead c r id a b h e s minimum ref mem imm ha hm le fit)
    (write3 c r id a b h e s ((a-minimum)*100) mem)

#print axioms exposureComputed

#print axioms exposureRead
#print axioms mulSuccess
end Inv48.QuoteMemory
