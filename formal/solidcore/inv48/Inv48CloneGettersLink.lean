import Inv48CloneGettersLibrary
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.CloneGetters
open Inv48.SymbolicClone Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000

def addrPattern : Pattern Ty where
  value := .address
  test | .address => true | _ => false
  sound v h := by split at h <;> first | rfl | contradiction

def binding (name : String) (ty : Pattern Ty) : Pattern BindingDecl where
  value := ⟨name,ty.value,false⟩
  test v := decide (v.name = name) && ty.test v.ty && !v.isStorageRef
  sound v h := by
    rcases v with ⟨n,t,s⟩
    simp only [Bool.and_eq_true,Bool.not_eq_true',decide_eq_true_eq] at h
    have ht := ty.sound t h.1.2
    rcases h with ⟨⟨hn,_⟩,hs⟩
    subst n; subst t; subst s
    rfl

def fnPattern (name : String) (returns : List (Pattern BindingDecl)) (body : Pattern Stmt) : Pattern InternalFunction where
  value := ⟨name,[],(seq returns).value,body.value,none⟩
  test f := decide (f.name = name) && List_nil.test f.params && (seq returns).test f.returns &&
    body.test f.body && Option_none.test f.id?
  sound f h := by
    rcases f with ⟨n,p,r,b,id⟩
    simp only [Bool.and_eq_true,decide_eq_true_eq] at h
    have hp := List_nil.sound p h.1.1.1.2
    have hr := (seq returns).sound r h.1.1.2
    have hb := body.sound b h.1.2
    have hi := Option_none.sound id h.2
    have hn := h.1.1.1.1
    simp only at hn
    subst n; subst p; subst r; subst b; subst id
    rfl

def libraryFn : InternalFunction := ⟨cloneKey,[],[⟨"universe",.uint256,false⟩,⟨"token",.address,false⟩],libraryBody,none⟩

def retU := "_ret___library_SecurityPoolBoundClones_universeBindings_0"
def retT := "_ret___library_SecurityPoolBoundClones_universeBindings_1"
def reputationKey := "__internal_reputationToken()#[]"
def tuplePattern := seq [lit retU,lit retT]
def callPattern := Stmt_captureReturn tuplePattern (Stmt_internalCall tuplePattern (lit cloneKey) List_nil)
def uBodyPattern := Stmt_block (seq [Stmt_skip,Stmt_block (seq [Stmt_block (seq [
  Stmt_varDecl Ty_uint256 (lit retU) Option_none,
  Stmt_varDecl addrPattern (lit retT) Option_none,
  callPattern,Stmt_assign (LValue_var (lit "universe")) (Expr_var (lit retU))])])])
def tBodyPattern := Stmt_block (seq [Stmt_skip,Stmt_block (seq [
  Stmt_varDecl addrPattern (lit "token") Option_none,
  Stmt_varDecl Ty_uint256 (lit retU) Option_none,
  Stmt_varDecl addrPattern (lit retT) Option_none,
  callPattern,Stmt_assign (LValue_var (lit "token")) (Expr_var (lit retT)),
  Stmt_returnValues (seq [Expr_var (lit "token")])])])
def libraryFnPattern := fnPattern cloneKey [binding "universe" Ty_uint256,binding "token" addrPattern] libraryPattern
def universeFnPattern := fnPattern universeKey [binding "universe" Ty_uint256] uBodyPattern
def reputationFnPattern := fnPattern reputationKey [binding "_ret0" addrPattern] tBodyPattern
def universeFn := universeFnPattern.value
def reputationFn := reputationFnPattern.value

def checks (t : FunctionTable) :=
  (Option_some libraryFnPattern).test (t.lookup? cloneKey) &&
  (Option_some universeFnPattern).test (t.lookup? universeKey) &&
  (Option_some reputationFnPattern).test (t.lookup? reputationKey)

end Inv48.CloneGetters
