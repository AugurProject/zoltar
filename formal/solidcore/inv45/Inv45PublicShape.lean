import Inv45Invariant
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Public
set_option maxHeartbeats 4000000
set_option linter.unusedSimpArgs false
def pat_BinaryOp_add : Pattern Source.BinaryOp where
  value:=Source.BinaryOp.add
  test | Source.BinaryOp.add=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_BinaryOp_boolAnd : Pattern Source.BinaryOp where
  value:=Source.BinaryOp.boolAnd
  test | Source.BinaryOp.boolAnd=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_BinaryOp_eq : Pattern Source.BinaryOp where
  value:=Source.BinaryOp.eq
  test | Source.BinaryOp.eq=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_BinaryOp_lt : Pattern Source.BinaryOp where
  value:=Source.BinaryOp.lt
  test | Source.BinaryOp.lt=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_BinaryOp_ne : Pattern Source.BinaryOp where
  value:=Source.BinaryOp.ne
  test | Source.BinaryOp.ne=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_BinaryOp_sub : Pattern Source.BinaryOp where
  value:=Source.BinaryOp.sub
  test | Source.BinaryOp.sub=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_CastKind_intCleanup : Pattern Source.CastKind where
  value:=Source.CastKind.intCleanup
  test | Source.CastKind.intCleanup=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_CastKind_uintCast : Pattern Source.CastKind where
  value:=Source.CastKind.uintCast
  test | Source.CastKind.uintCast=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_CastKind_uintCleanup : Pattern Source.CastKind where
  value:=Source.CastKind.uintCleanup
  test | Source.CastKind.uintCleanup=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_Expr_binary (p0 : Pattern (Source.BinaryOp)) (p1 : Pattern (Source.Expr)) (p2 : Pattern (Source.Expr)) : Pattern Source.Expr where
  value:=Source.Expr.binary p0.value p1.value p2.value
  test | Source.Expr.binary a0 a1 a2=>p0.test a0 && p1.test a1 && p2.test a2 | _=>false
  sound v h:=by
    split at h
    next a0 a1 a2 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨⟨h0,h1⟩,h2⟩
      rw [p0.sound _ h0, p1.sound _ h1, p2.sound _ h2]
    next => contradiction

def pat_Expr_byteArray (p0 : Pattern (List Nat)) : Pattern Source.Expr where
  value:=Source.Expr.byteArray p0.value
  test | Source.Expr.byteArray a0=>p0.test a0 | _=>false
  sound v h:=by
    split at h
    next a0 =>
      rw [p0.sound _ h]
    next => contradiction

def pat_Expr_castOp (p0 : Pattern (Source.CastKind)) (p1 : Pattern (Nat)) (p2 : Pattern (Source.Expr)) : Pattern Source.Expr where
  value:=Source.Expr.castOp p0.value p1.value p2.value
  test | Source.Expr.castOp a0 a1 a2=>p0.test a0 && p1.test a1 && p2.test a2 | _=>false
  sound v h:=by
    split at h
    next a0 a1 a2 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨⟨h0,h1⟩,h2⟩
      rw [p0.sound _ h0, p1.sound _ h1, p2.sound _ h2]
    next => contradiction

def pat_Expr_fixedArray (p0 : Pattern (List Source.Expr)) : Pattern Source.Expr where
  value:=Source.Expr.fixedArray p0.value
  test | Source.Expr.fixedArray a0=>p0.test a0 | _=>false
  sound v h:=by
    split at h
    next a0 =>
      rw [p0.sound _ h]
    next => contradiction

def pat_Expr_index (p0 : Pattern (Source.Expr)) (p1 : Pattern (Source.Expr)) : Pattern Source.Expr where
  value:=Source.Expr.index p0.value p1.value
  test | Source.Expr.index a0 a1=>p0.test a0 && p1.test a1 | _=>false
  sound v h:=by
    split at h
    next a0 a1 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨h0,h1⟩
      rw [p0.sound _ h0, p1.sound _ h1]
    next => contradiction

def pat_Expr_length (p0 : Pattern (Source.Expr)) : Pattern Source.Expr where
  value:=Source.Expr.length p0.value
  test | Source.Expr.length a0=>p0.test a0 | _=>false
  sound v h:=by
    split at h
    next a0 =>
      rw [p0.sound _ h]
    next => contradiction

def pat_Expr_storageRead (p0 : Pattern (Source.StorageReadMode)) (p1 : Pattern (String)) (p2 : Pattern (List Source.Expr)) : Pattern Source.Expr where
  value:=Source.Expr.storageRead p0.value p1.value p2.value
  test | Source.Expr.storageRead a0 a1 a2=>p0.test a0 && p1.test a1 && p2.test a2 | _=>false
  sound v h:=by
    split at h
    next a0 a1 a2 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨⟨h0,h1⟩,h2⟩
      rw [p0.sound _ h0, p1.sound _ h1, p2.sound _ h2]
    next => contradiction

def pat_Expr_var (p0 : Pattern (String)) : Pattern Source.Expr where
  value:=Source.Expr.var p0.value
  test | Source.Expr.var a0=>p0.test a0 | _=>false
  sound v h:=by
    split at h
    next a0 =>
      rw [p0.sound _ h]
    next => contradiction

def pat_Expr_word (p0 : Pattern (Nat)) : Pattern Source.Expr where
  value:=Source.Expr.word p0.value
  test | Source.Expr.word a0=>p0.test a0 | _=>false
  sound v h:=by
    split at h
    next a0 =>
      rw [p0.sound _ h]
    next => contradiction

def pat_LValue_var (p0 : Pattern (String)) : Pattern Source.LValue where
  value:=Source.LValue.var p0.value
  test | Source.LValue.var a0=>p0.test a0 | _=>false
  sound v h:=by
    split at h
    next a0 =>
      rw [p0.sound _ h]
    next => contradiction

def pat_Stmt_assign (p0 : Pattern (Source.LValue)) (p1 : Pattern (Source.Expr)) : Pattern Source.Stmt where
  value:=Source.Stmt.assign p0.value p1.value
  test | Source.Stmt.assign a0 a1=>p0.test a0 && p1.test a1 | _=>false
  sound v h:=by
    split at h
    next a0 a1 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨h0,h1⟩
      rw [p0.sound _ h0, p1.sound _ h1]
    next => contradiction

def pat_Stmt_block (p0 : Pattern (List Source.Stmt)) : Pattern Source.Stmt where
  value:=Source.Stmt.block p0.value
  test | Source.Stmt.block a0=>p0.test a0 | _=>false
  sound v h:=by
    split at h
    next a0 =>
      rw [p0.sound _ h]
    next => contradiction

def pat_Stmt_captureReturn (p0 : Pattern (List String)) (p1 : Pattern (Source.Stmt)) : Pattern Source.Stmt where
  value:=Source.Stmt.captureReturn p0.value p1.value
  test | Source.Stmt.captureReturn a0 a1=>p0.test a0 && p1.test a1 | _=>false
  sound v h:=by
    split at h
    next a0 a1 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨h0,h1⟩
      rw [p0.sound _ h0, p1.sound _ h1]
    next => contradiction

def pat_Stmt_ifElse (p0 : Pattern (Source.Expr)) (p1 : Pattern (Source.Stmt)) (p2 : Pattern (Source.Stmt)) : Pattern Source.Stmt where
  value:=Source.Stmt.ifElse p0.value p1.value p2.value
  test | Source.Stmt.ifElse a0 a1 a2=>p0.test a0 && p1.test a1 && p2.test a2 | _=>false
  sound v h:=by
    split at h
    next a0 a1 a2 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨⟨h0,h1⟩,h2⟩
      rw [p0.sound _ h0, p1.sound _ h1, p2.sound _ h2]
    next => contradiction

def pat_Stmt_internalCall (p0 : Pattern (List String)) (p1 : Pattern (String)) (p2 : Pattern (List Source.Expr)) : Pattern Source.Stmt where
  value:=Source.Stmt.internalCall p0.value p1.value p2.value
  test | Source.Stmt.internalCall a0 a1 a2=>p0.test a0 && p1.test a1 && p2.test a2 | _=>false
  sound v h:=by
    split at h
    next a0 a1 a2 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨⟨h0,h1⟩,h2⟩
      rw [p0.sound _ h0, p1.sound _ h1, p2.sound _ h2]
    next => contradiction

def pat_Stmt_memoryLocalize (p0 : Pattern (Source.Ty)) (p1 : Pattern (String)) : Pattern Source.Stmt where
  value:=Source.Stmt.memoryLocalize p0.value p1.value
  test | Source.Stmt.memoryLocalize a0 a1=>p0.test a0 && p1.test a1 | _=>false
  sound v h:=by
    split at h
    next a0 a1 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨h0,h1⟩
      rw [p0.sound _ h0, p1.sound _ h1]
    next => contradiction

def pat_Stmt_memoryVarDecl (p0 : Pattern (Source.Ty)) (p1 : Pattern (String)) (p2 : Pattern (Option Source.Expr)) : Pattern Source.Stmt where
  value:=Source.Stmt.memoryVarDecl p0.value p1.value p2.value
  test | Source.Stmt.memoryVarDecl a0 a1 a2=>p0.test a0 && p1.test a1 && p2.test a2 | _=>false
  sound v h:=by
    split at h
    next a0 a1 a2 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨⟨h0,h1⟩,h2⟩
      rw [p0.sound _ h0, p1.sound _ h1, p2.sound _ h2]
    next => contradiction

def pat_Stmt_returnValues (p0 : Pattern (List Source.Expr)) : Pattern Source.Stmt where
  value:=Source.Stmt.returnValues p0.value
  test | Source.Stmt.returnValues a0=>p0.test a0 | _=>false
  sound v h:=by
    split at h
    next a0 =>
      rw [p0.sound _ h]
    next => contradiction

def pat_Stmt_skip : Pattern Source.Stmt where
  value:=Source.Stmt.skip
  test | Source.Stmt.skip=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_Stmt_varDecl (p0 : Pattern (Source.Ty)) (p1 : Pattern (String)) (p2 : Pattern (Option Source.Expr)) : Pattern Source.Stmt where
  value:=Source.Stmt.varDecl p0.value p1.value p2.value
  test | Source.Stmt.varDecl a0 a1 a2=>p0.test a0 && p1.test a1 && p2.test a2 | _=>false
  sound v h:=by
    split at h
    next a0 a1 a2 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨⟨h0,h1⟩,h2⟩
      rw [p0.sound _ h0, p1.sound _ h1, p2.sound _ h2]
    next => contradiction

def pat_StorageReadMode_element : Pattern Source.StorageReadMode where
  value:=Source.StorageReadMode.element
  test | Source.StorageReadMode.element=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_StorageReadMode_load : Pattern Source.StorageReadMode where
  value:=Source.StorageReadMode.load
  test | Source.StorageReadMode.load=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_Ty_bool : Pattern Source.Ty where
  value:=Source.Ty.bool
  test | Source.Ty.bool=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_Ty_bytesCalldata : Pattern Source.Ty where
  value:=Source.Ty.bytesCalldata
  test | Source.Ty.bytesCalldata=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_Ty_fixedArray (p0 : Pattern (Nat)) (p1 : Pattern (Source.Ty)) : Pattern Source.Ty where
  value:=Source.Ty.fixedArray p0.value p1.value
  test | Source.Ty.fixedArray a0 a1=>p0.test a0 && p1.test a1 | _=>false
  sound v h:=by
    split at h
    next a0 a1 =>
      simp only [Bool.and_eq_true] at h
      rcases h with ⟨h0,h1⟩
      rw [p0.sound _ h0, p1.sound _ h1]
    next => contradiction

def pat_Ty_int256 : Pattern Source.Ty where
  value:=Source.Ty.int256
  test | Source.Ty.int256=>true | _=>false
  sound v h:=by split at h <;> simp_all

def pat_Ty_uint256 : Pattern Source.Ty where
  value:=Source.Ty.uint256
  test | Source.Ty.uint256=>true | _=>false
  sound v h:=by split at h <;> simp_all

def getter? := model.core.findFunctionByName? "getAnswerOptionName"
theorem getterPresent : getter?.isSome := by native_decide
def getter := getter?.get getterPresent
def getterShape := (pat_Stmt_block (seq [(pat_Stmt_assign (pat_LValue_var (lit "questionId")) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_var (lit "questionId")))),(pat_Stmt_assign (pat_LValue_var (lit "answer")) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_var (lit "answer")))),(pat_Stmt_memoryLocalize (pat_Ty_bytesCalldata) (lit "_ret0")),(pat_Stmt_block (seq [(pat_Stmt_ifElse (pat_Expr_binary (pat_BinaryOp_eq) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_length (pat_Expr_storageRead (pat_StorageReadMode_element) (lit "outcomeLabels") (seq [(pat_Expr_var (lit "questionId"))])))) (pat_Expr_word (lit 0))) (pat_Stmt_block (seq [(pat_Stmt_block (seq [(pat_Stmt_varDecl (pat_Ty_bool) (lit "_sol_hoist_0") Option_none),(pat_Stmt_block (seq [(pat_Stmt_varDecl (pat_Ty_uint256) (lit "_ic_arg_0") (Option_some (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_var (lit "answer"))))),(pat_Stmt_varDecl (pat_Ty_bool) (lit "_ret_hasNonZeroScalarReservedBits_0") Option_none),(pat_Stmt_captureReturn (seq [(lit "_ret_hasNonZeroScalarReservedBits_0")]) (pat_Stmt_internalCall (seq [(lit "_ret_hasNonZeroScalarReservedBits_0")]) (lit "__internal_hasNonZeroScalarReservedBits(uint256)#[SolidCore.Solidity.Ty.uint 256]") (seq [(pat_Expr_var (lit "_ic_arg_0"))]))),(pat_Stmt_assign (pat_LValue_var (lit "_sol_hoist_0")) (pat_Expr_var (lit "_ret_hasNonZeroScalarReservedBits_0")))])),(pat_Stmt_varDecl (pat_Ty_bool) (lit "#view1566") (Option_some (pat_Expr_var (lit "_sol_hoist_0")))),(pat_Stmt_ifElse (pat_Expr_var (lit "#view1566")) (pat_Stmt_returnValues (seq [(pat_Expr_byteArray (seq [(lit 77),(lit 97),(lit 108),(lit 102),(lit 111),(lit 114),(lit 109),(lit 101),(lit 100)]))])) (pat_Stmt_skip))])),(pat_Stmt_varDecl (pat_Ty_bool) (lit "invalid") Option_none),(pat_Stmt_varDecl (pat_Ty_uint256) (lit "firstPart") Option_none),(pat_Stmt_varDecl (pat_Ty_uint256) (lit "secondPart") Option_none),(pat_Stmt_varDecl (pat_Ty_uint256) (lit "_ic_arg_0") (Option_some (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_var (lit "answer"))))),(pat_Stmt_varDecl (pat_Ty_bool) (lit "_ret_splitUint256IntoTwoWithInvalid_0") Option_none),(pat_Stmt_varDecl (pat_Ty_uint256) (lit "_ret_splitUint256IntoTwoWithInvalid_1") Option_none),(pat_Stmt_varDecl (pat_Ty_uint256) (lit "_ret_splitUint256IntoTwoWithInvalid_2") Option_none),(pat_Stmt_captureReturn (seq [(lit "_ret_splitUint256IntoTwoWithInvalid_0"),(lit "_ret_splitUint256IntoTwoWithInvalid_1"),(lit "_ret_splitUint256IntoTwoWithInvalid_2")]) (pat_Stmt_internalCall (seq [(lit "_ret_splitUint256IntoTwoWithInvalid_0"),(lit "_ret_splitUint256IntoTwoWithInvalid_1"),(lit "_ret_splitUint256IntoTwoWithInvalid_2")]) (lit "__internal_splitUint256IntoTwoWithInvalid(uint256)#[SolidCore.Solidity.Ty.uint 256]") (seq [(pat_Expr_var (lit "_ic_arg_0"))]))),(pat_Stmt_assign (pat_LValue_var (lit "invalid")) (pat_Expr_var (lit "_ret_splitUint256IntoTwoWithInvalid_0"))),(pat_Stmt_assign (pat_LValue_var (lit "firstPart")) (pat_Expr_var (lit "_ret_splitUint256IntoTwoWithInvalid_1"))),(pat_Stmt_assign (pat_LValue_var (lit "secondPart")) (pat_Expr_var (lit "_ret_splitUint256IntoTwoWithInvalid_2"))),(pat_Stmt_ifElse (pat_Expr_var (lit "invalid")) (pat_Stmt_block (seq [(pat_Stmt_ifElse (pat_Expr_binary (pat_BinaryOp_boolAnd) (pat_Expr_binary (pat_BinaryOp_eq) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 120) (pat_Expr_var (lit "firstPart"))) (pat_Expr_castOp (pat_CastKind_uintCast) (lit 120) (pat_Expr_word (lit 0)))) (pat_Expr_binary (pat_BinaryOp_eq) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 120) (pat_Expr_var (lit "secondPart"))) (pat_Expr_castOp (pat_CastKind_uintCast) (lit 120) (pat_Expr_word (lit 0))))) (pat_Stmt_returnValues (seq [(pat_Expr_byteArray (seq [(lit 73),(lit 110),(lit 118),(lit 97),(lit 108),(lit 105),(lit 100)]))])) (pat_Stmt_skip)),(pat_Stmt_returnValues (seq [(pat_Expr_byteArray (seq [(lit 77),(lit 97),(lit 108),(lit 102),(lit 111),(lit 114),(lit 109),(lit 101),(lit 100)]))]))])) (pat_Stmt_skip)),(pat_Stmt_varDecl (pat_Ty_uint256) (lit "sum") (Option_some (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_binary (pat_BinaryOp_add) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_castOp (pat_CastKind_uintCast) (lit 256) (pat_Expr_var (lit "firstPart")))) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_castOp (pat_CastKind_uintCast) (lit 256) (pat_Expr_var (lit "secondPart"))))))))),(pat_Stmt_block (seq [(pat_Stmt_varDecl (pat_Ty_uint256) (lit "#read1610") (Option_some (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 120) (pat_Expr_index (pat_Expr_storageRead (pat_StorageReadMode_element) (lit "questions") (seq [(pat_Expr_var (lit "questionId"))])) (pat_Expr_word (lit 4)))))),(pat_Stmt_varDecl (pat_Ty_bool) (lit "#cond1619") (Option_some (pat_Expr_binary (pat_BinaryOp_ne) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 120) (pat_Expr_var (lit "#read1610"))) (pat_Expr_castOp (pat_CastKind_uintCast) (lit 120) (pat_Expr_word (lit 0)))))),(pat_Stmt_ifElse (pat_Expr_var (lit "#cond1619")) (pat_Stmt_block (seq [(pat_Stmt_varDecl (pat_Ty_uint256) (lit "#read1617") (Option_some (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 120) (pat_Expr_index (pat_Expr_storageRead (pat_StorageReadMode_element) (lit "questions") (seq [(pat_Expr_var (lit "questionId"))])) (pat_Expr_word (lit 4)))))),(pat_Stmt_assign (pat_LValue_var (lit "#cond1619")) (pat_Expr_binary (pat_BinaryOp_eq) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_var (lit "sum"))) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_var (lit "#read1617")))))])) (pat_Stmt_skip)),(pat_Stmt_ifElse (pat_Expr_var (lit "#cond1619")) (pat_Stmt_block (seq [(pat_Stmt_memoryVarDecl (pat_Ty_bytesCalldata) (lit "_sol_hoist_0") Option_none),(pat_Stmt_block (seq [(pat_Stmt_memoryVarDecl (pat_Ty_fixedArray (lit 2) (pat_Ty_uint256)) (lit "_ic_arg_0") (Option_some (pat_Expr_fixedArray (seq [(pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 120) (pat_Expr_var (lit "firstPart"))),(pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 120) (pat_Expr_var (lit "secondPart")))])))),(pat_Stmt_memoryVarDecl (pat_Ty_bytesCalldata) (lit "_ic_arg_1") (Option_some (pat_Expr_storageRead (pat_StorageReadMode_load) (lit "questions") (seq [(pat_Expr_var (lit "questionId")),(pat_Expr_word (lit 7))])))),(pat_Stmt_varDecl (pat_Ty_uint256) (lit "_ic_arg_2") (Option_some (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_index (pat_Expr_storageRead (pat_StorageReadMode_element) (lit "questions") (seq [(pat_Expr_var (lit "questionId"))])) (pat_Expr_word (lit 4)))))),(pat_Stmt_varDecl (pat_Ty_int256) (lit "_ic_arg_3") (Option_some (pat_Expr_castOp (pat_CastKind_intCleanup) (lit 256) (pat_Expr_index (pat_Expr_storageRead (pat_StorageReadMode_element) (lit "questions") (seq [(pat_Expr_var (lit "questionId"))])) (pat_Expr_word (lit 5)))))),(pat_Stmt_varDecl (pat_Ty_int256) (lit "_ic_arg_4") (Option_some (pat_Expr_castOp (pat_CastKind_intCleanup) (lit 256) (pat_Expr_index (pat_Expr_storageRead (pat_StorageReadMode_element) (lit "questions") (seq [(pat_Expr_var (lit "questionId"))])) (pat_Expr_word (lit 6)))))),(pat_Stmt_memoryVarDecl (pat_Ty_bytesCalldata) (lit "_ret___library_ScalarOutcomes_getScalarOutcomeName_0") Option_none),(pat_Stmt_captureReturn (seq [(lit "_ret___library_ScalarOutcomes_getScalarOutcomeName_0")]) (pat_Stmt_internalCall (seq [(lit "_ret___library_ScalarOutcomes_getScalarOutcomeName_0")]) (lit "__internal___library_ScalarOutcomes_getScalarOutcomeName(uint120[2],string,uint256,int256,int256)#[SolidCore.Solidity.Ty.array (SolidCore.Solidity.Ty.uint 120) (some 2),\n SolidCore.Solidity.Ty.string,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.int 256,\n SolidCore.Solidity.Ty.int 256]") (seq [(pat_Expr_var (lit "_ic_arg_0")),(pat_Expr_var (lit "_ic_arg_1")),(pat_Expr_var (lit "_ic_arg_2")),(pat_Expr_var (lit "_ic_arg_3")),(pat_Expr_var (lit "_ic_arg_4"))]))),(pat_Stmt_assign (pat_LValue_var (lit "_sol_hoist_0")) (pat_Expr_var (lit "_ret___library_ScalarOutcomes_getScalarOutcomeName_0")))])),(pat_Stmt_returnValues (seq [(pat_Expr_var (lit "_sol_hoist_0"))]))])) (pat_Stmt_skip))]))])) (pat_Stmt_ifElse (pat_Expr_binary (pat_BinaryOp_eq) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_var (lit "answer"))) (pat_Expr_word (lit 0))) (pat_Stmt_returnValues (seq [(pat_Expr_byteArray (seq [(lit 73),(lit 110),(lit 118),(lit 97),(lit 108),(lit 105),(lit 100)]))])) (pat_Stmt_ifElse (pat_Expr_binary (pat_BinaryOp_lt) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_var (lit "answer"))) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_binary (pat_BinaryOp_add) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_length (pat_Expr_storageRead (pat_StorageReadMode_element) (lit "outcomeLabels") (seq [(pat_Expr_var (lit "questionId"))])))) (pat_Expr_word (lit 1)))))) (pat_Stmt_block (seq [(pat_Stmt_returnValues (seq [(pat_Expr_index (pat_Expr_storageRead (pat_StorageReadMode_element) (lit "outcomeLabels") (seq [(pat_Expr_var (lit "questionId"))])) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_binary (pat_BinaryOp_sub) (pat_Expr_castOp (pat_CastKind_uintCleanup) (lit 256) (pat_Expr_var (lit "answer"))) (pat_Expr_word (lit 1))))))]))])) (pat_Stmt_skip)))),(pat_Stmt_returnValues (seq [(pat_Expr_byteArray (seq [(lit 77),(lit 97),(lit 108),(lit 102),(lit 111),(lit 114),(lit 109),(lit 101),(lit 100)]))]))]))]))
theorem getterSource : getter.body=getterShape.value := getterShape.sound _ (by native_decide)
end Inv45.Public
