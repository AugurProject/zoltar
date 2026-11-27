import Inv39Sites
import Inv03Bodies
import CheckedWordCall
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv39.Getter
inductive Kind | actual | ceiling deriving DecidableEq
def field : Kind → WordField.Field | .actual => circulating | .ceiling => theoretical
def name : Kind → String | .actual => "totalSupply" | .ceiling => "getTotalTheoreticalSupply"
def ref (field : String) : Pattern Expr := ⟨.storageIdent field, fun | .storageRead .ref n [] => n==field | _ => false,
  by intro e h; dsimp only at h; split at h <;> simp_all [Expr.storageIdent]⟩
def retExpr (k : Kind) := clean (ref (field k).name)
def shape (k : Kind) := block [Stmt_skip,block [ret (retExpr k)]]
def matchesMeta (f : FunctionDef) := match f.params,f.returns with
  | [],[⟨"_ret0",.uint256,false⟩] => true
  | _,_ => false
def observed (k : Kind) := model.core.findFunctionByName? (name k)
def flag (k : Kind) := ((observed k).map fun f => matchesMeta f && (shape k).test f.body) == some true
private theorem both : flag .actual && flag .ceiling := by native_decide
private theorem readMetadata (f : FunctionDef) (h : matchesMeta f) :
    f.params=[] ∧ f.returns=Inv32Internal.wordBindings ["_ret0"] := by
  unfold matchesMeta at h; split at h <;> simp_all [Inv32Internal.wordBindings]
private theorem check (k : Kind) (o : Option FunctionDef)
    (h : (o.map fun f => matchesMeta f && (shape k).test f.body) = some true) :
    ∃ f, o=some f ∧ f.params=[] ∧ f.returns=Inv32Internal.wordBindings ["_ret0"] ∧ f.body=(shape k).value := by
  cases o with
  | none => contradiction
  | some f =>
    simp only [Option.map_some,Option.some.injEq,Bool.and_eq_true] at h
    have m := readMetadata f h.1
    exact ⟨f,rfl,m.1,m.2,(shape k).sound _ h.2⟩
theorem linked (k : Kind) : ∃ f, observed k=some f ∧ f.params=[] ∧
    f.returns=Inv32Internal.wordBindings ["_ret0"] ∧ f.body=(shape k).value := by
  apply check
  have all := both
  simp only [Bool.and_eq_true,flag,beq_iff_eq] at all
  cases k <;> first | exact all.1 | exact all.2
end Inv39.Getter
