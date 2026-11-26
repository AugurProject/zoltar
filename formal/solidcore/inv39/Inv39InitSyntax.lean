import Inv39InitHoist
open SolidCore.Solidity.Source
namespace Inv39.Init
def readSyntax : Expr → Bool
  | .var _ | .word _ | .byteArray _ | .caller | .immutable _ | .storageRead _ _ [] => true
  | .castOp _ _ value => readSyntax value
  | .binary op x y => Frame.strictOp op && readSyntax x && readSyntax y
  | .ternary cond x y => readSyntax cond && readSyntax x && readSyntax y
  | _ => false
theorem reads (e : Expr) (ok : readSyntax e) : Frame.ReadOnly e := by
  fun_induction readSyntax e with
  | case1 => apply Frame.localRead
  | case2 => apply Frame.word
  | case3 => apply Frame.bytes
  | case4 => exact Frame.caller
  | case5 => apply Frame.immutableRead
  | case6 => apply Frame.fieldRead
  | case7 k bits v ih => exact Frame.cast _ _ _ (ih ok)
  | case8 op x y left right =>
    simp only [Bool.and_eq_true] at ok
    apply Frame.numeric _ _ _ _ _ (left ok.1.2) (right ok.2)
    all_goals intro eq; subst op; simp [Frame.strictOp] at ok
  | case9 cond x y C L R =>
    simp only [Bool.and_eq_true] at ok; exact Frame.ternary _ _ _ (C ok.1.1) (L ok.1.2) (R ok.2)
  | case10 => contradiction
def getKey : String → Option Key
  | "universeId" => some .universe | "repNumber" => some .number | "_name" => some .name | "_symbol" => some .symbol
  | "totalTheoreticalSupplyAttoRep" => some .cap | _ => none
theorem namedKey (original : String) (k : Key) (eq : getKey original=some k) : original=name k := by
  unfold getKey at eq; split at eq <;> first | cases eq; rfl | contradiction
def extracts : Stmt → Option Expr
  | .block [
      .varDecl .uint256 "_ic_arg_0" (some e),
      .memoryVarDecl .bytesCalldata "_ret___library_DecimalStrings_toString_0" none,
      .captureReturn ["_ret___library_DecimalStrings_toString_0"]
        (.internalCall ["_ret___library_DecimalStrings_toString_0"] "__internal___library_DecimalStrings_toString(uint256)#[SolidCore.Solidity.Ty.uint 256]" [.var "_ic_arg_0"]),
      .assign (.var "_sol_hoist_0") (.var "_ret___library_DecimalStrings_toString_0")] => some e
  | _ => none
theorem extractEq (s : Stmt) (e : Expr) (eq : extracts s=some e) : s=fetch e := by
  unfold extracts at eq; split at eq <;> first | cases eq; rfl | contradiction
def wordSyntax : Expr → Bool | .castOp .uintCleanup _ e => readSyntax e | _ => false
theorem wordReads (e : Expr) (h : wordSyntax e) : Frame.TypedRead e Frame.isWord := by
  unfold wordSyntax at h; split at h <;> first | exact Frame.cleaned (reads _ h) _ | contradiction
def basic : Stmt → Bool
  | .requireStmt e _ => readSyntax e
  | .emitEvent _ es => es.all readSyntax
  | .assign (.var _) (.castOp .uintCleanup _ e) => readSyntax e
  | .assign (.storage field) (.castOp .uintCleanup _ e) => (getKey field).isSome && readSyntax e
  | .assign (.storage field) (.encode .packed none _ _ es) => (getKey field).isSome && es.all readSyntax
  | .memoryVarDecl _ _ none | .memoryVarDecl _ _ (some (.var _)) => true
  | _ => false
theorem basicSound (b : State) (c : Context) (fields : c.storageFields=model.core.context.storageFields) (s : Stmt) (h : basic s) :
    Frame.StmtPreserves (region b) model.core.table c s := by
  have known (label : String) (present : (getKey label).isSome) : ∃ k, label=name k ∧ c.storageField? (name k)=some (field k) := by
    obtain ⟨k,eq⟩ := Option.isSome_iff_exists.mp present
    exact ⟨k,namedKey _ _ eq,by change c.storageFields.find? _ = _; rw [fields]; exact layout k⟩
  unfold basic at h; split at h
  · apply requireFrame; exact reads _ h
  · apply emitFrame; exact fun e mem => reads e (List.all_eq_true.mp h e mem)
  · apply cleanLocal; exact reads _ h
  · simp only [Bool.and_eq_true] at h
    obtain ⟨k,eq,lookup⟩ := known _ h.1
    rw [eq]; exact scalarAssign _ _ _ _ _ _ (reads _ h.2) lookup
  · simp only [Bool.and_eq_true] at h
    obtain ⟨k,eq,lookup⟩ := known _ h.1
    rw [eq]; exact packedAssign _ _ _ _ _ _ _ (fun e mem => reads e (List.all_eq_true.mp h.2 e mem)) lookup
  · apply memNone
  · apply memVar
  · contradiction
mutual
def accepts : Stmt → Bool
  | s@(.block ss) => match extracts s with | some e => wordSyntax e | none => acceptsAll ss
  | .captureReturn _ inner => accepts inner
  | stmt => basic stmt
def acceptsAll : List Stmt → Bool | [] => true | s::ss => accepts s && acceptsAll ss
end
mutual
theorem sound (b : State) (c : Context) (fields : c.storageFields=model.core.context.storageFields) (s : Stmt) (h : accepts s) :
    Frame.StmtPreserves (region b) model.core.table c s := by
  unfold accepts at h; split at h
  · split at h
    · rename_i val eqn; rw [extractEq _ _ eqn]; exact hoist _ _ _ (wordReads val h)
    · exact Frame.block (entered _) (exited _) (allSound _ _ fields _ h)
  · exact capture _ _ _ _ _ (sound _ _ fields _ h)
  · exact basicSound _ _ fields _ h
termination_by sizeOf s
theorem allSound (b : State) (c : Context) (fields : c.storageFields=model.core.context.storageFields) (ss : List Stmt) (h : acceptsAll ss) :
    ∀ s∈ss, Frame.StmtPreserves (region b) model.core.table c s := by
  cases ss with
  | nil => simp
  | cons s rest =>
    simp only [acceptsAll,Bool.and_eq_true] at h
    intro q mem; rcases List.mem_cons.mp mem with eq|tail
    · subst q; exact sound _ _ fields _ h.1
    · exact allSound _ _ fields _ h.2 q tail
termination_by sizeOf ss
decreasing_by all_goals subst_vars <;> simp_wf <;> omega
end
end Inv39.Init
