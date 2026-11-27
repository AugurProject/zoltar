import Inv39InitSyntax
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem env (which : EnvWord) : Frame.ReadOnly (.env which) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact Frame.failure _
  | succ n =>
    cases which <;> rw [Expr.evalFuel] <;> first | exact Frame.pureValue _ rfl | exact .request (fun _ => Frame.pureValue _ rfl) | intro eq; cases eq
theorem self : Frame.ReadOnly .self := by
  intro n c r; cases n <;> rw [Expr.evalFuel] <;> first | exact Frame.failure _ | exact Frame.pureValue _ rfl
theorem unary (op : UnaryOp) (e : Expr) (reads : Frame.ReadOnly e) : Frame.ReadOnly (.unary op e) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact Frame.failure _
  | succ n => rw [Expr.evalFuel]; apply Frame.bind (reads n c r); rintro ⟨v,post⟩ eq; apply Frame.liftExcept; intro _; exact Frame.pureValue _ eq
theorem hashed (e : Expr) (reads : Frame.ReadOnly e) : Frame.ReadOnly (.keccak256 e) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact Frame.failure _
  | succ n =>
    rw [Expr.evalFuel]; apply Frame.bind (reads n c r); rintro ⟨v,post⟩ eq; apply Frame.liftExcept; intro val
    split <;> first | exact Frame.pureValue _ eq | exact Frame.failure _
theorem encode (kind : EncodeKind) (widths : List Nat) (ts : List Ty) (es : List Expr) (reads : ∀ e∈es,Frame.ReadOnly e) :
    Frame.ReadOnly (.encode kind none widths ts es) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact Frame.failure _
  | succ n =>
    rw [Expr.evalFuel]; apply Frame.bind (Frame.inputs es reads n c r)
    rintro ⟨vs,post⟩ eq; dsimp only; apply Frame.liftExcept; intro vals; split <;> first | exact Frame.pureValue _ eq | exact Frame.failure _
theorem booleans (op : BinaryOp) (x y : Expr) (left : Frame.ReadOnly x) (right : Frame.ReadOnly y) : Frame.ReadOnly (.binary op x y) := by
  by_cases andOp : op=.boolAnd
  · subst op; intro n c r; cases n with
    | zero => rw [Expr.evalFuel]; exact Frame.failure _
    | succ n =>
      rw [Expr.evalFuel]; apply Frame.bind (left n c r); rintro ⟨v,mid⟩ eq; change mid=r at eq; subst mid; apply Frame.liftExcept; intro w
      split
      · apply Frame.bind (right n c r); rintro ⟨v,post⟩ eq; apply Frame.liftExcept; intro _; exact Frame.pureValue _ eq
      · exact Frame.pureValue _ rfl
  by_cases orOp : op=.boolOr
  · subst op; intro n c r; cases n with
    | zero => rw [Expr.evalFuel]; exact Frame.failure _
    | succ n =>
      rw [Expr.evalFuel]; apply Frame.bind (left n c r); rintro ⟨v,mid⟩ eq; change mid=r at eq; subst mid; apply Frame.liftExcept; intro w
      split
      · exact Frame.pureValue _ rfl
      · apply Frame.bind (right n c r); rintro ⟨v,post⟩ eq; apply Frame.liftExcept; intro _; exact Frame.pureValue _ eq
  exact Frame.numeric _ _ _ andOp orOp left right
mutual
def pureExpr : Expr → Bool
  | .var _ | .word _ | .byteArray _ | .self | .caller | .env _ | .immutable _ | .storageRead _ _ []=>true
  | .unary _ e | .castOp _ _ e | .keccak256 e=>pureExpr e
  | .binary _ x y=>pureExpr x && pureExpr y
  | .ternary t x y=>pureExpr t && pureExpr x && pureExpr y
  | .encode _ none _ _ es=>pureList es
  | _=>false
def pureList : List Expr → Bool | []=>true | e::es=>pureExpr e && pureList es
end
mutual
theorem readSound (e : Expr) (valid : pureExpr e) : Frame.ReadOnly e := by
  unfold pureExpr at valid; split at valid
  · apply Frame.localRead
  · apply Frame.word
  · apply Frame.bytes
  · exact self
  · exact Frame.caller
  · exact env _
  · apply Frame.immutableRead
  · apply Frame.fieldRead
  · exact unary _ _ (readSound _ valid)
  · exact Frame.cast _ _ _ (readSound _ valid)
  · exact hashed _ (readSound _ valid)
  · simp only [Bool.and_eq_true] at valid; exact booleans _ _ _ (readSound _ valid.1) (readSound _ valid.2)
  · simp only [Bool.and_eq_true] at valid; exact Frame.ternary _ _ _ (readSound _ valid.1.1) (readSound _ valid.1.2) (readSound _ valid.2)
  · exact encode _ _ _ _ (listSound _ valid)
  · contradiction
termination_by sizeOf e
theorem listSound (es : List Expr) (h : pureList es) : ∀ e∈es,Frame.ReadOnly e := by
  cases es with
  | nil => simp
  | cons e es =>
    simp only [pureList,Bool.and_eq_true] at h
    intro x hx; rcases List.mem_cons.mp hx with eq|more
    · subst x; exact readSound _ h.1
    · exact listSound _ h.2 _ more
termination_by sizeOf es
decreasing_by all_goals subst_vars <;> simp_wf <;> omega
end
end Inv39.Auth
