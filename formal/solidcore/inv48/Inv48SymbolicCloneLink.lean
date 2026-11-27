import Inv48SymbolicCloneSyntax
import Inv32Shapes
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000

def Expr_length (p0 : Pattern (Expr)) : Pattern Expr where
  value := Expr.length p0.value
  test
    | Expr.length x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def Expr_index (p0 : Pattern (Expr)) (p1 : Pattern (Expr)) : Pattern Expr where
  value := Expr.index p0.value p1.value
  test
    | Expr.index x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def Expr_envBytesLookup (p0 : Pattern (EnvBytesLookup)) (p1 : Pattern (Expr)) : Pattern Expr where
  value := Expr.envBytesLookup p0.value p1.value
  test
    | Expr.envBytesLookup x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def Stmt_memoryVarDecl (p0 : Pattern (Ty)) (p1 : Pattern (String)) (p2 : Pattern (Option Expr)) : Pattern Stmt where
  value := Stmt.memoryVarDecl p0.value p1.value p2.value
  test
    | Stmt.memoryVarDecl x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1
      have e1 := p1.sound x1 h.1.2
      have e2 := p2.sound x2 h.2
      simp only [e0, e1, e2]
    · contradiction

def Expr_self : Pattern Expr where
  value := Expr.self
  test | Expr.self => true | _ => false
  sound v h := by split at h <;> first | rfl | contradiction

def EnvBytesLookup_accountCode : Pattern EnvBytesLookup where
  value := EnvBytesLookup.accountCode
  test _ := true
  sound v h := by cases v; rfl

def Ty_bytesCalldata : Pattern Ty where
  value := Ty.bytesCalldata
  test | Ty.bytesCalldata => true | _ => false
  sound v h := by split at h <;> first | rfl | contradiction

def BinaryOp_shl : Pattern BinaryOp where
  value := .shl
  test | .shl => true | _ => false
  sound v h := by split at h <;> first | rfl | contradiction

def libraryPattern : Pattern Stmt :=
(Stmt_block (seq [(Stmt_skip),
(Stmt_skip),
(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "offset") Option_none),
(Stmt_ifElse (Expr_word (lit 1)) (Stmt_assign (LValue_var (lit "offset")) (Expr_word (lit 45))) (Stmt_assign (LValue_var (lit "offset")) (Expr_word (lit 45)))),
(Stmt_requireStmt (Expr_binary BinaryOp_eq (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_length (Expr_envBytesLookup EnvBytesLookup_accountCode (Expr_self)))) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_binary BinaryOp_add (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "offset"))) (Expr_word (lit 51)))))) (Option_some (lit "Universe module requires a clone"))),
(Stmt_block (seq [(Stmt_memoryVarDecl Ty_bytesCalldata (lit "#extcode") (Option_some (Expr_envBytesLookup EnvBytesLookup_accountCode (Expr_self)))),
(Stmt_varDecl Ty_uint256 (lit "#extindex") (Option_some (Expr_word (lit 0)))),
(Stmt_varDecl Ty_uint256 (lit "#extword") (Option_some (Expr_word (lit 0)))),
(Stmt_assign (LValue_var (lit "#extword")) (Expr_word (lit 0))),
(Stmt_whileLoop (Expr_binary BinaryOp_lt (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#extindex"))) (Expr_word (lit 31))) (Stmt_block (seq [(Stmt_assign (LValue_var (lit "#extword")) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_binary BinaryOp_bitOr (Expr_castOp CastKind_uintCast (lit 256) (Expr_binary BinaryOp_shl (Expr_var (lit "#extword")) (Expr_word (lit 8)))) (Expr_ternary (Expr_binary BinaryOp_boolAnd (Expr_binary BinaryOp_lt (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "offset"))) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_length (Expr_var (lit "#extcode"))))) (Expr_binary BinaryOp_lt (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#extindex"))) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_binary BinaryOp_sub (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_length (Expr_var (lit "#extcode")))) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "offset")))))))) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCast (lit 8) (Expr_index (Expr_var (lit "#extcode")) (Expr_binary BinaryOp_add (Expr_var (lit "offset")) (Expr_var (lit "#extindex"))))))) (Expr_word (lit 0)))))),
(Stmt_assign (LValue_var (lit "#extindex")) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_binary BinaryOp_add (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#extindex"))) (Expr_word (lit 1))))))]))),
(Stmt_assign (LValue_var (lit "universe")) (Expr_castOp CastKind_uintCast (lit 248) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#extword"))))),
(Stmt_assign (LValue_var (lit "#extword")) (Expr_word (lit 0))),
(Stmt_whileLoop (Expr_binary BinaryOp_lt (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#extindex"))) (Expr_word (lit 51))) (Stmt_block (seq [(Stmt_assign (LValue_var (lit "#extword")) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_binary BinaryOp_bitOr (Expr_castOp CastKind_uintCast (lit 256) (Expr_binary BinaryOp_shl (Expr_var (lit "#extword")) (Expr_word (lit 8)))) (Expr_ternary (Expr_binary BinaryOp_boolAnd (Expr_binary BinaryOp_lt (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "offset"))) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_length (Expr_var (lit "#extcode"))))) (Expr_binary BinaryOp_lt (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#extindex"))) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_binary BinaryOp_sub (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_length (Expr_var (lit "#extcode")))) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "offset")))))))) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCast (lit 8) (Expr_index (Expr_var (lit "#extcode")) (Expr_binary BinaryOp_add (Expr_var (lit "offset")) (Expr_var (lit "#extindex"))))))) (Expr_word (lit 0)))))),
(Stmt_assign (LValue_var (lit "#extindex")) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_binary BinaryOp_add (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#extindex"))) (Expr_word (lit 1))))))]))),
(Stmt_assign (LValue_var (lit "token")) (Expr_castOp CastKind_uintCast (lit 160) (Expr_var (lit "#extword"))))]))]))]))

theorem checked_library : (Inv48.Source.model.core.table.lookup? Inv48.CloneRead.cloneKey).map
    InternalFunction.body = some libraryBody := by
  have h : (Option_some libraryPattern).test
      ((Inv48.Source.model.core.table.lookup? Inv48.CloneRead.cloneKey).map InternalFunction.body) = true := by
    native_decide
  exact (Option_some libraryPattern).sound _ h
#print axioms checked_library
end Inv48.SymbolicClone
