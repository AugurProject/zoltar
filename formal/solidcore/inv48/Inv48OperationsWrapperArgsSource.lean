import Inv48SimpleWrapperArgsPublic
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.OperationsWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def P_Stmt_block (p0 : Pattern (List Stmt)) : Pattern Stmt where
  value := Stmt.block p0.value
  test
    | Stmt.block x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def P_Stmt_varDecl (p0 : Pattern (Ty)) (p1 : Pattern (String)) (p2 : Pattern (Option Expr)) : Pattern Stmt where
  value := Stmt.varDecl p0.value p1.value p2.value
  test
    | Stmt.varDecl x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1
      have e1 := p1.sound x1 h.1.2
      have e2 := p2.sound x2 h.2
      simp only [e0, e1, e2]
    · contradiction

def P_Expr_word (p0 : Pattern (Nat)) : Pattern Expr where
  value := Expr.word p0.value
  test
    | Expr.word x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def P_Stmt_forLoop (p0 : Pattern (Stmt)) (p1 : Pattern (Expr)) (p2 : Pattern (Stmt)) (p3 : Pattern (Stmt)) : Pattern Stmt where
  value := Stmt.forLoop p0.value p1.value p2.value p3.value
  test
    | Stmt.forLoop x0 x1 x2 x3 => p0.test x0 && p1.test x1 && p2.test x2 && p3.test x3
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 x3 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1.1
      have e1 := p1.sound x1 h.1.1.2
      have e2 := p2.sound x2 h.1.2
      have e3 := p3.sound x3 h.2
      simp only [e0, e1, e2, e3]
    · contradiction

def P_Stmt_skip  : Pattern Stmt where
  value := Stmt.skip
  test
    | Stmt.skip => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def P_Expr_binary (p0 : Pattern (BinaryOp)) (p1 : Pattern (Expr)) (p2 : Pattern (Expr)) : Pattern Expr where
  value := Expr.binary p0.value p1.value p2.value
  test
    | Expr.binary x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1
      have e1 := p1.sound x1 h.1.2
      have e2 := p2.sound x2 h.2
      simp only [e0, e1, e2]
    · contradiction

def P_BinaryOp_lt  : Pattern BinaryOp where
  value := BinaryOp.lt
  test
    | BinaryOp.lt => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def P_Expr_castOp (p0 : Pattern (CastKind)) (p1 : Pattern (Nat)) (p2 : Pattern (Expr)) : Pattern Expr where
  value := Expr.castOp p0.value p1.value p2.value
  test
    | Expr.castOp x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1
      have e1 := p1.sound x1 h.1.2
      have e2 := p2.sound x2 h.2
      simp only [e0, e1, e2]
    · contradiction

def P_CastKind_uintCleanup  : Pattern CastKind where
  value := CastKind.uintCleanup
  test
    | CastKind.uintCleanup => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def P_Expr_var (p0 : Pattern (String)) : Pattern Expr where
  value := Expr.var p0.value
  test
    | Expr.var x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def P_Expr_length (p0 : Pattern (Expr)) : Pattern Expr where
  value := Expr.length p0.value
  test
    | Expr.length x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def P_Expr_index (p0 : Pattern (Expr)) (p1 : Pattern (Expr)) : Pattern Expr where
  value := Expr.index p0.value p1.value
  test
    | Expr.index x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def P_Stmt_exprStmt (p0 : Pattern (Expr)) : Pattern Stmt where
  value := Stmt.exprStmt p0.value
  test
    | Stmt.exprStmt x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def P_Expr_incDec (p0 : Pattern (BinaryOp)) (p1 : Pattern (Bool)) (p2 : Pattern (Option ValueCleanup)) (p3 : Pattern (Expr)) : Pattern Expr where
  value := Expr.incDec p0.value p1.value p2.value p3.value
  test
    | Expr.incDec x0 x1 x2 x3 => p0.test x0 && p1.test x1 && p2.test x2 && p3.test x3
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 x3 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1.1
      have e1 := p1.sound x1 h.1.1.2
      have e2 := p2.sound x2 h.1.2
      have e3 := p3.sound x3 h.2
      simp only [e0, e1, e2, e3]
    · contradiction

def P_BinaryOp_add  : Pattern BinaryOp where
  value := BinaryOp.add
  test
    | BinaryOp.add => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def P_ValueCleanup_uint (p0 : Pattern (Nat)) : Pattern ValueCleanup where
  value := ValueCleanup.uint p0.value
  test
    | ValueCleanup.uint x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def P_Stmt_requireStmt (p0 : Pattern (Expr)) (p1 : Pattern (Option String)) : Pattern Stmt where
  value := Stmt.requireStmt p0.value p1.value
  test
    | Stmt.requireStmt x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def P_BinaryOp_ne  : Pattern BinaryOp where
  value := BinaryOp.ne
  test
    | BinaryOp.ne => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def P_CastKind_uintCast  : Pattern CastKind where
  value := CastKind.uintCast
  test
    | CastKind.uintCast => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def P_BinaryOp_le  : Pattern BinaryOp where
  value := BinaryOp.le
  test
    | BinaryOp.le => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def P_Expr_ternary (p0 : Pattern (Expr)) (p1 : Pattern (Expr)) (p2 : Pattern (Expr)) : Pattern Expr where
  value := Expr.ternary p0.value p1.value p2.value
  test
    | Expr.ternary x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1
      have e1 := p1.sound x1 h.1.2
      have e2 := p2.sound x2 h.2
      simp only [e0, e1, e2]
    · contradiction

def P_Expr_assignment (p0 : Pattern (Option BinaryOp)) (p1 : Pattern (Option ValueCleanup)) (p2 : Pattern (Expr)) (p3 : Pattern (Expr)) : Pattern Expr where
  value := Expr.assignment p0.value p1.value p2.value p3.value
  test
    | Expr.assignment x0 x1 x2 x3 => p0.test x0 && p1.test x1 && p2.test x2 && p3.test x3
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 x3 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1.1
      have e1 := p1.sound x1 h.1.1.2
      have e2 := p2.sound x2 h.1.2
      have e3 := p3.sound x3 h.2
      simp only [e0, e1, e2, e3]
    · contradiction

def P_Stmt_captureReturn (p0 : Pattern (List String)) (p1 : Pattern (Stmt)) : Pattern Stmt where
  value := Stmt.captureReturn p0.value p1.value
  test
    | Stmt.captureReturn x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def P_Stmt_internalCall (p0 : Pattern (List String)) (p1 : Pattern (String)) (p2 : Pattern (List Expr)) : Pattern Stmt where
  value := Stmt.internalCall p0.value p1.value p2.value
  test
    | Stmt.internalCall x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1
      have e1 := p1.sound x1 h.1.2
      have e2 := p2.sound x2 h.2
      simp only [e0, e1, e2]
    · contradiction

def P_Stmt_assign (p0 : Pattern (LValue)) (p1 : Pattern (Expr)) : Pattern Stmt where
  value := Stmt.assign p0.value p1.value
  test
    | Stmt.assign x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def P_LValue_var (p0 : Pattern (String)) : Pattern LValue where
  value := LValue.var p0.value
  test
    | LValue.var x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      try simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def P_Expr_caller  : Pattern Expr where
  value := Expr.caller
  test
    | Expr.caller => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def loopP := (P_Stmt_block (seq [(P_Stmt_varDecl Ty_uint256 (lit "index") (Option_some (P_Expr_word (lit 0)))),
(P_Stmt_forLoop (P_Stmt_skip) (P_Expr_binary (P_BinaryOp_lt) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_var (lit "index"))) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_length (P_Expr_index (P_Expr_var (lit "batch")) (P_Expr_word (lit 4)))))) (P_Stmt_exprStmt (P_Expr_incDec (P_BinaryOp_add) (lit true) (Option_some (P_ValueCleanup_uint (lit 256))) (P_Expr_var (lit "index")))) (P_Stmt_block (seq [(P_Stmt_requireStmt (P_Expr_binary (P_BinaryOp_ne) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 32) (P_Expr_index (P_Expr_index (P_Expr_index (P_Expr_var (lit "batch")) (P_Expr_word (lit 4))) (P_Expr_var (lit "index"))) (P_Expr_word (lit 0)))) (P_Expr_castOp (P_CastKind_uintCast) (lit 32) (P_Expr_word (lit 0)))) (Option_some (lit "Operation gas zero"))),
(P_Stmt_requireStmt (P_Expr_binary (P_BinaryOp_le) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_length (P_Expr_index (P_Expr_index (P_Expr_index (P_Expr_var (lit "batch")) (P_Expr_word (lit 4))) (P_Expr_var (lit "index"))) (P_Expr_word (lit 1))))) (P_Expr_ternary (P_Expr_word (lit 1)) (P_Expr_word (lit 512)) (P_Expr_word (lit 512)))) (Option_some (lit "Operation data too large"))),
(P_Stmt_exprStmt (P_Expr_assignment (Option_some (P_BinaryOp_add)) (Option_some (P_ValueCleanup_uint (lit 256))) (P_Expr_var (lit "requiredGas")) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_binary (P_BinaryOp_add) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_castOp (P_CastKind_uintCast) (lit 256) (P_Expr_index (P_Expr_index (P_Expr_index (P_Expr_var (lit "batch")) (P_Expr_word (lit 4))) (P_Expr_var (lit "index"))) (P_Expr_word (lit 0))))) (P_Expr_ternary (P_Expr_word (lit 1)) (P_Expr_castOp (P_CastKind_uintCast) (lit 32) (P_Expr_word (lit 100000))) (P_Expr_castOp (P_CastKind_uintCast) (lit 32) (P_Expr_word (lit 100000)))))))))])))]))

def getterP := (P_Stmt_block (seq [(P_Stmt_varDecl Ty_uint256 (lit "_ret_getSettlementCallbackGasLimit_0") Option_none),
(P_Stmt_captureReturn (seq [(lit "_ret_getSettlementCallbackGasLimit_0")]) (P_Stmt_internalCall (seq [(lit "_ret_getSettlementCallbackGasLimit_0")]) (lit "__internal_getSettlementCallbackGasLimit()#[]") (seq []))),
(P_Stmt_assign (P_LValue_var (lit "_sol_hoist_0")) (P_Expr_var (lit "_ret_getSettlementCallbackGasLimit_0")))]))

def callbackP := (P_Stmt_varDecl Ty_uint256 (lit "callbackGas") (Option_some (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_binary (P_BinaryOp_add) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_castOp (P_CastKind_uintCast) (lit 256) (P_Expr_var (lit "_sol_hoist_0")))) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_var (lit "_sol_hoist_1"))))))))

def limitP := (P_Stmt_requireStmt (P_Expr_binary (P_BinaryOp_le) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_var (lit "callbackGas"))) (P_Expr_ternary (P_Expr_word (lit 1)) (P_Expr_word (lit 10000000)) (P_Expr_word (lit 10000000)))) (Option_some (lit "Callback gas exceeds limit")))

def requestP := (P_Stmt_block (seq [(P_Stmt_varDecl Inv48.EscrowTrace.addressPattern (lit "_ic_arg_0") (Option_some (P_Expr_caller))),
(P_Stmt_varDecl Ty_uint256 (lit "_ic_arg_1") (Option_some (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_var (lit "proposedRepPerEthPrice"))))),
(P_Stmt_varDecl Ty_uint256 (lit "_ic_arg_2") (Option_some (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_var (lit "requestedInitialAttoWeth"))))),
(P_Stmt_varDecl Ty_uint256 (lit "_ic_arg_3") (Option_some (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_var (lit "bountyAttoEth"))))),
(P_Stmt_varDecl Ty_uint256 (lit "_ic_arg_4") (Option_some (P_Expr_castOp (P_CastKind_uintCast) (lit 32) (P_Expr_castOp (P_CastKind_uintCleanup) (lit 256) (P_Expr_castOp (P_CastKind_uintCast) (lit 256) (P_Expr_var (lit "callbackGas"))))))),
(P_Stmt_varDecl Ty_uint256 (lit "_ret__requestPrice_0") Option_none),
(P_Stmt_captureReturn (seq [(lit "_ret__requestPrice_0")]) (P_Stmt_internalCall (seq [(lit "_ret__requestPrice_0")]) (lit "__internal__requestPrice(address,uint256,uint256,uint256,uint32)#[SolidCore.Solidity.Ty.address false,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 32]") (seq [(P_Expr_var (lit "_ic_arg_0")),
(P_Expr_var (lit "_ic_arg_1")),
(P_Expr_var (lit "_ic_arg_2")),
(P_Expr_var (lit "_ic_arg_3")),
(P_Expr_var (lit "_ic_arg_4"))]))),
(P_Stmt_assign (P_LValue_var (lit "_sol_hoist_0")) (P_Expr_var (lit "_ret__requestPrice_0")))]))

def wrapper := Inv48.Source.model.core.findFunctionByName? "requestSecurityPoolPriceWithOperations"
def mainStatements (fn : FunctionDef) : List Stmt :=
  match fn.body with
  | .block outer => match outer[5]? with
    | some (Stmt.block ss) => ss
    | _ => []
  | _ => []
def sourceCheck : Bool := wrapper.any fun fn =>
  let ss := mainStatements fn
  (ss[4]?.any loopP.test) && (ss[8]?.any getterP.test) &&
  (ss[9]?.any callbackP.test) && (ss[10]?.any limitP.test) &&
  (ss[12]?.any requestP.test)
theorem checkedSource : sourceCheck = true := by native_decide

theorem actualNodes (fn : FunctionDef) (found : wrapper = some fn) :
    (mainStatements fn)[4]? = some loopP.value ∧
    (mainStatements fn)[8]? = some getterP.value ∧
    (mainStatements fn)[9]? = some callbackP.value ∧
    (mainStatements fn)[10]? = some limitP.value ∧
    (mainStatements fn)[12]? = some requestP.value := by
  have h := checkedSource
  simp only [sourceCheck,found,Option.any_some,Bool.and_eq_true] at h
  have get {α : Type} (p : Pattern α) (v : Option α) (h : v.any p.test = true) : v = some p.value := by
    cases v with
    | none => contradiction
    | some v => exact congrArg some (p.sound v h)
  exact ⟨get _ _ h.1.1.1.1,get _ _ h.1.1.1.2,get _ _ h.1.1.2,get _ _ h.1.2,get _ _ h.2⟩

theorem identicalGetter : getterP.value = Inv48.SimpleWrapperArgs.getterBlock := by rfl

theorem callbackGetterExecution (n : Nat) (c : Context) (r : Runtime) :
    Stmt.eval (n+6) Inv48.Source.model.core.table c
      (r.declareLocal Inv48.SimpleWrapperArgs.hoist (.word 0)) getterP.value =
    pure (.normal (r.declareLocal Inv48.SimpleWrapperArgs.hoist (.word 4000000))) := by
  rw [identicalGetter]
  exact Inv48.SimpleWrapperArgs.getterBlockExecution n c r
end Inv48.OperationsWrapperArgs
