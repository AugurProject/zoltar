import Inv39PublicViewFrame
import Inv39MarkerHistoryReads
import Inv39AuthReads
import Inv39ReturnStorage
open SolidCore.Solidity.Source
namespace Inv39.ReadEvidence
open Frame
abbrev Resolves (e : Expr) := ∀ n c r, Ensures (Expr.resolveLValueFuel n c r e) (fun q => q.2=r)
theorem resolveVar (k : String) : Resolves (.var k) := by
  intro n c r; cases n with
  | zero => rw [Expr.resolveLValueFuel]; exact failure _
  | succ n =>
    rw [Expr.resolveLValueFuel]
    split
    · exact pureValue _ rfl
    · exact pureValue _ rfl
    · split <;> first | exact pureValue _ rfl | exact failure _
theorem resolveElement (k : String) (e : Expr) (read : ReadOnly e) : Resolves (.storageRead .element k [e]) := by
  intro n c r; cases n with
  | zero => rw [Expr.resolveLValueFuel]; exact failure _
  | succ n =>
    rw [Expr.resolveLValueFuel]; apply Frame.bind (read n c r)
    rintro ⟨v,q⟩ same; exact pureValue (P:=fun q : ResolvedLValue × Runtime => q.2=r) _ same
theorem resolveIndex (base idx : Expr) (B : Resolves base) (I : ReadOnly idx) : Resolves (.index base idx) := by
  intro n c r; cases n with
  | zero => rw [Expr.resolveLValueFuel]; exact failure _
  | succ n =>
    rw [Expr.resolveLValueFuel]; apply Frame.bind (B n c r)
    rintro ⟨loc,q⟩ same; change q=r at same; subst q
    apply Frame.bind (I n c r); rintro ⟨v,q⟩ same
    cases loc <;> dsimp only
    all_goals first
      | exact pureValue (P:=fun q : ResolvedLValue × Runtime => q.2=r) _ same
      | apply Frame.liftExcept; intro _; apply Frame.liftExcept; intro _; exact pureValue (P:=fun q : ResolvedLValue × Runtime => q.2=r) _ same
theorem element (k : String) (e : Expr) (read : ReadOnly e) : ReadOnly (.storageRead .element k [e]) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]; apply Frame.bind (read n c r)
    rintro ⟨v,q⟩ same; apply Frame.liftExcept; intro _; exact pureValue _ same
theorem listIndex (base idx : Expr) (B : ReadOnly base) (I : ReadOnly idx) (n : Nat) (c : Context) (r : Runtime) :
    Ensures (do
      let (vs,q) ← Expr.evalListFuel n c r [base,idx]
      match vs with
      | [b,i] => do
        let w ← i.expectWord
        let b ← q.derefMemoryValue b
        let v ← b.index? w
        let v ← q.derefMemoryValue v
        pure (v,q)
      | _ => throw (SolidityFailure.revert RevertData.typeMismatch)) (fun q => q.2=r) := by
  apply Frame.bind (inputs [base,idx] (by intro e h; simp only [List.mem_cons,List.not_mem_nil,or_false] at h; rcases h with rfl|rfl <;> assumption) n c r)
  rintro ⟨vs,q⟩ same
  dsimp only
  split <;> first | exact failure _ | skip
  apply Frame.liftExcept; intro _; apply Frame.liftExcept; intro _; apply Frame.liftExcept; intro _; apply Frame.liftExcept; intro _; exact pureValue _ same
theorem indexedNonvar (base idx : Expr) (B : ReadOnly base) (R : Resolves base) (I : ReadOnly idx) (notVar : ∀ k,base≠.var k) : ReadOnly (.index base idx) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]
    split
    · apply Frame.bind (R n c r); rintro ⟨loc,q⟩ same; change q=r at same; subst q
      dsimp only
      split
      · apply Frame.bind (I n c r); rintro ⟨v,q⟩ same; apply Frame.liftExcept; intro _; exact pureValue _ same
      · exact failure _
    · split
      · apply Frame.bind (resolveIndex base idx R I n c r); rintro ⟨loc,q⟩ same
        apply Frame.liftExcept; intro _; exact pureValue _ same
      · cases base <;> dsimp only
        all_goals first
          | exact listIndex _ idx B I n c r
          | (split
             · apply Frame.bind (I n c r); rintro ⟨v,q⟩ same; apply Frame.liftExcept; intro _; exact pureValue _ same
             · exact listIndex _ idx B I n c r)
    · exact fun k eq => notVar k eq
 theorem indexedVar (k : String) (idx : Expr) (I : ReadOnly idx) : ReadOnly (.index (.var k) idx) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]
    simp only [Expr.hasStorageRoot,Bool.false_eq_true,if_false]
    split
    · apply Frame.bind (resolveIndex (.var k) idx (resolveVar k) I n c r)
      rintro ⟨loc,q⟩ same; apply Frame.liftExcept; intro _; exact pureValue _ same
    · split
      · apply Frame.bind (I n c r); rintro ⟨v,q⟩ same; apply Frame.liftExcept; intro _; exact pureValue _ same
      · exact listIndex _ idx (localRead k) I n c r
 theorem indexed (base idx : Expr) (B : ReadOnly base) (R : Resolves base) (I : ReadOnly idx) : ReadOnly (.index base idx) := by
  by_cases h : ∃ k,base=.var k
  · obtain ⟨k,rfl⟩ := h; exact indexedVar k idx I
  · exact indexedNonvar base idx B R I (fun k eq => h ⟨k,eq⟩)
end Inv39.ReadEvidence
