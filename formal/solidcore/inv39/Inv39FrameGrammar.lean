import Inv39FrameStatements
open SolidCore.Solidity.Source
namespace Inv39.Frame
def strictOp : BinaryOp → Bool | .boolAnd | .boolOr => false | _ => true
def readSyntax : Expr → Bool
  | .var _ | .word _ | .byteArray _ => true
  | .castOp _ _ e | .newBytes e => readSyntax e
  | .binary op x y => strictOp op && readSyntax x && readSyntax y
  | _ => false
theorem readSound (e : Expr) (valid : readSyntax e) : ReadOnly e := by
  fun_induction readSyntax e with
  | case1 name => exact localRead _
  | case2 v => exact word v
  | case3 bs => exact bytes bs
  | case4 k bits e ih => exact cast _ _ _ (ih valid)
  | case5 e ih => exact newBytes _ (ih valid)
  | case6 op x y left right =>
    simp only [readSyntax,Bool.and_eq_true] at valid
    apply numeric _ _ _ _ _ (left valid.1.2) (right valid.2)
    all_goals intro eq; subst op; simp [strictOp] at valid
  | case7 => contradiction
def simpleStatements : Stmt → Bool
  | .skip => true
  | .varDecl .uint256 _ none => true
  | .varDecl .uint256 _ (some (.castOp .uintCleanup _ e)) => readSyntax e
  | .memoryLocalize _ _ => true
  | .memoryVarDecl ty _ (some (.newBytes size)) => readSyntax size
  | .exprStmt (.incDec _ true (some (.uint 256)) (.var _)) => true
  | .exprStmt (.assignment (some _) (some (.uint 256)) (.var _) rhs) => readSyntax rhs
  | .assign (.var _) (.castOp .uintCleanup _ e) => readSyntax e
  | .assign (.index (.var _) idx) (.castOp (.fixedBytes _) _ e) => readSyntax idx && readSyntax e
  | .returnValues [.var _] | .returnValues [.byteArray _] => true
  | _ => false
theorem simpleSound (b : State) (t : FunctionTable) (c : Context) (s : Stmt) (h : simpleStatements s) : StmtPreserves (region b) t c s := by
  unfold simpleStatements at h
  split at h
  · intro n r hr; cases n <;> rw [Stmt.eval] <;> first | exact failure _ | exact pureValue (P:=fun res : Result => region b res.runtime) _ hr
  · apply declNone
  · apply declWord; exact cleaned (readSound _ h) _
  · apply localize
  · apply buffer; exact readSound _ h
  · apply expr; intro r ready; exact inc _ _ _ _ _ _ ready
  · apply expr; intro r ready; exact compound _ _ _ _ _ _ _ (readSound _ h) ready
  · apply cleanSet; exact readSound _ h
  · simp only [Bool.and_eq_true] at h
    exact indexedSet _ _ _ _ _ _ _ _ (readSound _ h.1) (readSound _ h.2)
  · apply returned; intro r
    simp only [Expr.evalReturnValue]
    split <;> first | exact pureValue _ rfl | exact localRead _ _ _ _
  · apply returned; intro r; exact bytes _ _ c r
  · contradiction
mutual
def stmts : Stmt → Bool
  | .block children => allStmts children
  | .whileLoop cond body => readSyntax cond && stmts body
  | .ifElse cond yes no => readSyntax cond && stmts yes && stmts no
  | other => simpleStatements other
def allStmts : List Stmt → Bool
  | [] => true
  | hd::rest => stmts hd && allStmts rest
end
mutual
theorem stmtsSound (b : State) (t : FunctionTable) (c : Context) (s : Stmt) (h : stmts s) : StmtPreserves (region b) t c s := by
  unfold stmts at h
  split at h
  · apply block (entered _) (exited _)
    exact allSound _ _ _ _ h
  · simp only [Bool.and_eq_true] at h
    exact loop _ _ _ _ _ (readSound _ h.1) (stmtsSound _ _ _ _ h.2)
  · simp only [Bool.and_eq_true] at h
    exact branch _ _ _ _ _ _ (readSound _ h.1.1) (stmtsSound _ _ _ _ h.1.2) (stmtsSound _ _ _ _ h.2)
  · exact simpleSound _ _ _ _ h
termination_by sizeOf s
theorem allSound (b : State) (t : FunctionTable) (c : Context) (ss : List Stmt) (h : allStmts ss) :
    ∀ s∈ss, StmtPreserves (region b) t c s := by
  cases ss with
  | nil => simp
  | cons s rest =>
    simp only [allStmts,Bool.and_eq_true] at h
    intro q mem; rcases List.mem_cons.mp mem with same|tail
    · subst q; exact stmtsSound _ _ _ _ h.1
    · exact allSound _ _ _ _ h.2 q tail
termination_by sizeOf ss
decreasing_by all_goals subst_vars <;> simp_wf <;> omega
end
end Inv39.Frame
