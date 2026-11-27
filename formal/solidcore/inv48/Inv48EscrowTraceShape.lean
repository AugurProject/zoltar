import Inv48EscrowTrace
import Inv32Shapes
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.EscrowTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def encPattern (p0 : Pattern (EncodeKind)) (p1 : Pattern (Option Expr)) (p2 : Pattern (List Nat)) (p3 : Pattern (List Ty)) (p4 : Pattern (List Expr)) : Pattern (Expr) where
  value := Expr.encode p0.value p1.value p2.value p3.value p4.value
  test
    | Expr.encode x0 x1 x2 x3 x4 => p0.test x0 && p1.test x1 && p2.test x2 && p3.test x3 && p4.test x4
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 x3 x4 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1.1.1
      have e1 := p1.sound x1 h.1.1.1.2
      have e2 := p2.sound x2 h.1.1.2
      have e3 := p3.sound x3 h.1.2
      have e4 := p4.sound x4 h.2
      simp only [e0, e1, e2, e3, e4]
    · contradiction

def callPattern (p0 : Pattern (LowLevelCallKind)) (p1 : Pattern (Expr)) (p2 : Pattern (Expr)) (p3 : Pattern (Expr)) (p4 : Pattern (Option Expr)) (p5 : Pattern (Bool)) (p6 : Pattern (Bool)) (p7 : Pattern (List BindingDecl)) (p8 : Pattern (List AbiCleanup)) (p9 : Pattern (Stmt)) (p10 : Pattern (List TryCatchClause)) : Pattern (Stmt) where
  value := Stmt.tryExternalCall p0.value p1.value p2.value p3.value p4.value p5.value p6.value p7.value p8.value p9.value p10.value
  test
    | Stmt.tryExternalCall x0 x1 x2 x3 x4 x5 x6 x7 x8 x9 x10 => p0.test x0 && p1.test x1 && p2.test x2 && p3.test x3 && p4.test x4 && p5.test x5 && p6.test x6 && p7.test x7 && p8.test x8 && p9.test x9 && p10.test x10
    | _ => false
  sound v h := by
    split at h
    next x0 x1 x2 x3 x4 x5 x6 x7 x8 x9 x10 =>
      simp only [Bool.and_eq_true] at h
      have e0 := p0.sound x0 h.1.1.1.1.1.1.1.1.1.1
      have e1 := p1.sound x1 h.1.1.1.1.1.1.1.1.1.2
      have e2 := p2.sound x2 h.1.1.1.1.1.1.1.1.2
      have e3 := p3.sound x3 h.1.1.1.1.1.1.1.2
      have e4 := p4.sound x4 h.1.1.1.1.1.1.2
      have e5 := p5.sound x5 h.1.1.1.1.1.2
      have e6 := p6.sound x6 h.1.1.1.1.2
      have e7 := p7.sound x7 h.1.1.1.2
      have e8 := p8.sound x8 h.1.1.2
      have e9 := p9.sound x9 h.1.2
      have e10 := p10.sound x10 h.2
      simp only [e0, e1, e2, e3, e4, e5, e6, e7, e8, e9, e10]
    · contradiction

def bindingPattern (pn : Pattern String) (pt : Pattern Ty) (pr : Pattern Bool) : Pattern BindingDecl where
  value := ⟨pn.value,pt.value,pr.value⟩
  test v := pn.test v.name && pt.test v.ty && pr.test v.isStorageRef
  sound v h := by
    rcases v with ⟨n,t,r⟩
    simp only [Bool.and_eq_true] at h
    have a := pn.sound n h.1.1
    have b := pt.sound t h.1.2
    have c := pr.sound r h.2
    simp_all

def plainSelector  : Pattern (EncodeKind) where
  value := EncodeKind.withSelector
  test
    | EncodeKind.withSelector  => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def addressPattern  : Pattern (Ty) where
  value := Ty.address
  test
    | Ty.address  => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def noneCleanup  : Pattern (AbiCleanup) where
  value := AbiCleanup.none
  test
    | AbiCleanup.none  => true
    | _ => false
  sound v h := by
    split at h
    · rfl
    · contradiction

def calldataPattern : Pattern Expr := encPattern plainSelector
  (Option_some (Expr_word (lit 599290589))) (seq [])
  (seq [addressPattern,addressPattern,Ty_uint256])
  (seq [Expr_var (lit "payer"),Expr_var (lit "escrow"),
    Expr_castOp CastKind_uintCast (lit 256) (Expr_var (lit "repAmount"))])

def transferPattern : Pattern Stmt := callPattern (lit .call) (Expr_var (lit "rep"))
  calldataPattern (Expr_word (lit 0)) Option_none (lit false) (lit false)
  (seq [bindingPattern (lit "__ext0") Ty_bool (lit false)]) (seq [noneCleanup])
  (Stmt_assign (LValue_var (lit "_sol_hoist_0")) (Expr_var (lit "__ext0"))) (seq [])

theorem actualTransfer : actualStatements[7]? = some transferStmt :=
  (Option_some transferPattern).sound _ (by native_decide)

def guardPattern : Pattern Stmt := Stmt_requireStmt (Expr_var (lit "_sol_hoist_0"))
  (Option_some (lit "REP transfer for initial report failed"))

theorem actualGuard : actualStatements[8]? = some guardStmt :=
  (Option_some guardPattern).sound _ (by native_decide)

#print axioms actualTransfer
#print axioms actualGuard
end Inv48.EscrowTrace
