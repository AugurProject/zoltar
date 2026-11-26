import Inv32Dispatch
open SolidCore.Solidity.Source
namespace Inv32Shapes
structure Pattern (α : Type) where
  value : α
  test : α → Bool
  sound : ∀ x, test x = true → x = value

def lit {α : Type} [DecidableEq α] (v : α) : Pattern α :=
  ⟨v, fun x => decide (x = v), fun _ h => of_decide_eq_true h⟩

def List_nil {α : Type}  : Pattern (List α) where
  value := List.nil
  test
    | List.nil => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def List_cons {α : Type} (p0 : Pattern (α)) (p1 : Pattern (List α)) : Pattern (List α) where
  value := List.cons p0.value p1.value
  test
    | List.cons x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def Option_some {α : Type} (p0 : Pattern (α)) : Pattern (Option α) where
  value := Option.some p0.value
  test
    | Option.some x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def Option_none {α : Type}  : Pattern (Option α) where
  value := Option.none
  test
    | Option.none => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def Expr_var (p0 : Pattern (String)) : Pattern (Expr) where
  value := Expr.var p0.value
  test
    | Expr.var x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def Expr_word (p0 : Pattern (Nat)) : Pattern (Expr) where
  value := Expr.word p0.value
  test
    | Expr.word x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def Expr_assignment (p0 : Pattern (Option BinaryOp)) (p1 : Pattern (Option ValueCleanup)) (p2 : Pattern (Expr)) (p3 : Pattern (Expr)) : Pattern (Expr) where
  value := Expr.assignment p0.value p1.value p2.value p3.value
  test
    | Expr.assignment x0 x1 x2 x3 => p0.test x0 && p1.test x1 && p2.test x2 && p3.test x3
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 x3 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1.1
      have e1 := p1.sound x1 h.1.1.2
      have e2 := p2.sound x2 h.1.2
      have e3 := p3.sound x3 h.2
      simp only [e0, e1, e2, e3]
    · contradiction

def Expr_enumFromUInt (p0 : Pattern (Nat)) (p1 : Pattern (Expr)) : Pattern (Expr) where
  value := Expr.enumFromUInt p0.value p1.value
  test
    | Expr.enumFromUInt x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def Expr_ternary (p0 : Pattern (Expr)) (p1 : Pattern (Expr)) (p2 : Pattern (Expr)) : Pattern (Expr) where
  value := Expr.ternary p0.value p1.value p2.value
  test
    | Expr.ternary x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
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

def Expr_unary (p0 : Pattern (UnaryOp)) (p1 : Pattern (Expr)) : Pattern (Expr) where
  value := Expr.unary p0.value p1.value
  test
    | Expr.unary x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def Expr_castOp (p0 : Pattern (CastKind)) (p1 : Pattern (Nat)) (p2 : Pattern (Expr)) : Pattern (Expr) where
  value := Expr.castOp p0.value p1.value p2.value
  test
    | Expr.castOp x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
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

def Expr_binary (p0 : Pattern (BinaryOp)) (p1 : Pattern (Expr)) (p2 : Pattern (Expr)) : Pattern (Expr) where
  value := Expr.binary p0.value p1.value p2.value
  test
    | Expr.binary x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
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

def Expr_mulMod (p0 : Pattern (Expr)) (p1 : Pattern (Expr)) (p2 : Pattern (Expr)) : Pattern (Expr) where
  value := Expr.mulMod p0.value p1.value p2.value
  test
    | Expr.mulMod x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
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

def LValue_var (p0 : Pattern (String)) : Pattern (LValue) where
  value := LValue.var p0.value
  test
    | LValue.var x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def ValueCleanup_uint (p0 : Pattern (Nat)) : Pattern (ValueCleanup) where
  value := ValueCleanup.uint p0.value
  test
    | ValueCleanup.uint x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def Stmt_varDecl (p0 : Pattern (Ty)) (p1 : Pattern (String)) (p2 : Pattern (Option Expr)) : Pattern (Stmt) where
  value := Stmt.varDecl p0.value p1.value p2.value
  test
    | Stmt.varDecl x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
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

def Stmt_block (p0 : Pattern (List Stmt)) : Pattern (Stmt) where
  value := Stmt.block p0.value
  test
    | Stmt.block x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def Stmt_assign (p0 : Pattern (LValue)) (p1 : Pattern (Expr)) : Pattern (Stmt) where
  value := Stmt.assign p0.value p1.value
  test
    | Stmt.assign x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def Stmt_skip  : Pattern (Stmt) where
  value := Stmt.skip
  test
    | Stmt.skip => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def Stmt_exprStmt (p0 : Pattern (Expr)) : Pattern (Stmt) where
  value := Stmt.exprStmt p0.value
  test
    | Stmt.exprStmt x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def Stmt_captureReturn (p0 : Pattern (List String)) (p1 : Pattern (Stmt)) : Pattern (Stmt) where
  value := Stmt.captureReturn p0.value p1.value
  test
    | Stmt.captureReturn x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def Stmt_internalCall (p0 : Pattern (List String)) (p1 : Pattern (String)) (p2 : Pattern (List Expr)) : Pattern (Stmt) where
  value := Stmt.internalCall p0.value p1.value p2.value
  test
    | Stmt.internalCall x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
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

def Stmt_ifElse (p0 : Pattern (Expr)) (p1 : Pattern (Stmt)) (p2 : Pattern (Stmt)) : Pattern (Stmt) where
  value := Stmt.ifElse p0.value p1.value p2.value
  test
    | Stmt.ifElse x0 x1 x2 => p0.test x0 && p1.test x1 && p2.test x2
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

def Stmt_requireStmt (p0 : Pattern (Expr)) (p1 : Pattern (Option String)) : Pattern (Stmt) where
  value := Stmt.requireStmt p0.value p1.value
  test
    | Stmt.requireStmt x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def Stmt_returnValues (p0 : Pattern (List Expr)) : Pattern (Stmt) where
  value := Stmt.returnValues p0.value
  test
    | Stmt.returnValues x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def Stmt_revert (p0 : Pattern (String)) (p1 : Pattern (List Expr)) : Pattern (Stmt) where
  value := Stmt.revert p0.value p1.value
  test
    | Stmt.revert x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def Stmt_unchecked (p0 : Pattern (Stmt)) : Pattern (Stmt) where
  value := Stmt.unchecked p0.value
  test
    | Stmt.unchecked x0 => p0.test x0
    | _ => false
  sound v h := by
    split at h
    next x0 =>
      have e0 := p0.sound x0 h
      simp only [e0]
    · contradiction

def Stmt_whileLoop (p0 : Pattern (Expr)) (p1 : Pattern (Stmt)) : Pattern (Stmt) where
  value := Stmt.whileLoop p0.value p1.value
  test
    | Stmt.whileLoop x0 x1 => p0.test x0 && p1.test x1
    | _ => false
  sound v h := by
    split at h
    next x0 x1 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1
      have e1 := p1.sound x1 h.2
      simp only [e0, e1]
    · contradiction

def BinaryOp_add  : Pattern (BinaryOp) where
  value := BinaryOp.add
  test
    | BinaryOp.add => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_bitAnd  : Pattern (BinaryOp) where
  value := BinaryOp.bitAnd
  test
    | BinaryOp.bitAnd => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_bitOr  : Pattern (BinaryOp) where
  value := BinaryOp.bitOr
  test
    | BinaryOp.bitOr => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_bitXor  : Pattern (BinaryOp) where
  value := BinaryOp.bitXor
  test
    | BinaryOp.bitXor => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_boolAnd  : Pattern (BinaryOp) where
  value := BinaryOp.boolAnd
  test
    | BinaryOp.boolAnd => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_boolOr  : Pattern (BinaryOp) where
  value := BinaryOp.boolOr
  test
    | BinaryOp.boolOr => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_div  : Pattern (BinaryOp) where
  value := BinaryOp.div
  test
    | BinaryOp.div => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_eq  : Pattern (BinaryOp) where
  value := BinaryOp.eq
  test
    | BinaryOp.eq => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_gt  : Pattern (BinaryOp) where
  value := BinaryOp.gt
  test
    | BinaryOp.gt => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_le  : Pattern (BinaryOp) where
  value := BinaryOp.le
  test
    | BinaryOp.le => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_lt  : Pattern (BinaryOp) where
  value := BinaryOp.lt
  test
    | BinaryOp.lt => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_mod  : Pattern (BinaryOp) where
  value := BinaryOp.mod
  test
    | BinaryOp.mod => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_mul  : Pattern (BinaryOp) where
  value := BinaryOp.mul
  test
    | BinaryOp.mul => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def BinaryOp_sub  : Pattern (BinaryOp) where
  value := BinaryOp.sub
  test
    | BinaryOp.sub => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def CastKind_uintCast  : Pattern (CastKind) where
  value := CastKind.uintCast
  test
    | CastKind.uintCast => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def CastKind_uintCleanup  : Pattern (CastKind) where
  value := CastKind.uintCleanup
  test
    | CastKind.uintCleanup => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def Ty_bool  : Pattern (Ty) where
  value := Ty.bool
  test
    | Ty.bool => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def Ty_uint256  : Pattern (Ty) where
  value := Ty.uint256
  test
    | Ty.uint256 => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def UnaryOp_bitNot  : Pattern (UnaryOp) where
  value := UnaryOp.bitNot
  test
    | UnaryOp.bitNot => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def seq {α : Type} (xs : List (Pattern α)) : Pattern (List α) := xs.foldr List_cons List_nil
end Inv32Shapes
