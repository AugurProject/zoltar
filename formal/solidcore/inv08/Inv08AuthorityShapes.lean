import Inv08CursorExecution
import Inv08SearchGuards
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv08.Authority
def boundKey := "__internal___library_SecurityPoolBoundClones_boundAddress()#[]"
def ledgerKey := "__internal_capitalLedger()#[]"
abbrev bindingRet := "_ret___library_SecurityPoolBoundClones_boundAddress_0"
abbrev ledgerRet := "_ret_capitalLedger_0"
def addressTy : Pattern Ty := ⟨.address,fun | .address=>true | _=>false,by intro v h; dsimp only at h; split at h <;> simp_all⟩
def selfCode : Pattern Expr := ⟨.envBytesLookup .accountCode .self,fun | .envBytesLookup .accountCode .self=>true | _=>false,
  by intro v h; dsimp only at h; split at h <;> simp_all⟩
def caller : Pattern Expr := ⟨.caller,fun | .caller=>true | _=>false,by intro v h; dsimp only at h; split at h <;> simp_all⟩
def length (p : Pattern Expr) : Pattern Expr where
  value := .length p.value
  test | .length v => p.test v | _ => false
  sound v h := by
    split at h
    next e => rw [p.sound _ h]
    next => contradiction
def memoryDecl : Pattern Stmt where
  value := .memoryVarDecl .bytesCalldata "#extcode" (some selfCode.value)
  test | .memoryVarDecl .bytesCalldata "#extcode" (some e) => selfCode.test e | _ => false
  sound v h := by
    split at h
    next e => rw [selfCode.sound _ h]
    next => contradiction
def both (x y : Pattern Expr) := Expr_binary BinaryOp_boolAnd x y
def bin (op : Pattern BinaryOp) := Expr_binary op
def dclean (e : Pattern Expr) := clean (clean e)
def lengthTest := bin BinaryOp_eq (clean (length selfCode)) (dclean (bin BinaryOp_add (wvar "offset") (num 20)))
def addressDecl (name : String) := Stmt_varDecl addressTy (lit name)
def guard (e : Pattern Expr) (reason : String) := Stmt_requireStmt e (Option_some (lit reason))
def codeSize := clean (length (varP "#extcode"))
def indexOK := both (bin BinaryOp_lt (wvar "offset") codeSize)
  (bin BinaryOp_lt (wvar "#extindex") (dclean (bin BinaryOp_sub codeSize (wvar "offset"))))
def idx := bin BinaryOp_add (varP "offset") (varP "#extindex")
def codeByte : Pattern Expr where
  value := .index (.var "#extcode") idx.value
  test | .index (.var "#extcode") i => idx.test i | _ => false
  sound v h := by
    split at h
    next i => rw [idx.sound _ h]
    next => contradiction
def shiftOp : Pattern BinaryOp := ⟨.shl,fun | .shl => true | _ => false,by intro v h; dsimp only at h; split at h <;> simp_all⟩
def convert (bits : Nat) := Expr_castOp CastKind_uintCast (lit bits)
def shifted := convert 256 (bin shiftOp (varP "#extword") (num 8))
def selectedByte := Expr_ternary indexOK (dclean (convert 8 codeByte)) (num 0)
def nextWord := clean (bin BinaryOp_bitOr shifted selectedByte)
def nextIndex := dclean (bin BinaryOp_add (wvar "#extindex") (num 1))
def more := bin BinaryOp_lt (wvar "#extindex") (num 20)
def iteration := block [assign "#extword" nextWord,assign "#extindex" nextIndex]
def initOffset := assign "offset" (num 45)
def codeBlock := block [memoryDecl,decl "#extindex" (Option_some (num 0)),decl "#extword" (Option_some (num 0)),
  assign "#extword" (num 0),Stmt_whileLoop more iteration,assign "binding" (convert 160 (varP "#extword"))]
def boundBody := block [Stmt_skip,block [decl "offset" Option_none,Stmt_ifElse (num 1) initOffset initOffset,
  guard lengthTest "Capital module requires a clone",codeBlock]]
def via (slot key : String) := block [addressDecl slot Option_none,Stmt_captureReturn (seq [lit slot])
  (Stmt_internalCall (seq [lit slot]) (lit key) (seq [])),assign tmp (varP slot)]
def ledgerBody := block [Stmt_skip,block [addressDecl tmp Option_none,via bindingRet boundKey,ret (varP tmp)]]
def callerGuard := block [addressDecl tmp Option_none,via ledgerRet ledgerKey,addressDecl "#view274" (Option_some (varP tmp)),
  guard (bin BinaryOp_eq caller (varP "#view274")) "Only capital ledger"]
def duration : Pattern Expr := ⟨.storageRead .ref "rewardDuration" [],fun | .storageRead .ref "rewardDuration" []=>true | _=>false,
  by intro v h; dsimp only at h; split at h <;> simp_all⟩
def neOp : Pattern BinaryOp := ⟨.ne,fun | .ne => true | _ => false,by intro v h; dsimp only at h; split at h <;> simp_all⟩
def initializedGuard := guard (bin neOp (Expr_castOp CastKind_uintCleanup (lit 48) duration) (convert 48 (num 0))) "Fee streams not initialized"

theorem boundCode : (model.core.table.lookup? boundKey).map InternalFunction.body = some boundBody.value :=
  (Option_some boundBody).sound _ (by native_decide)
theorem ledgerCode : (model.core.table.lookup? ledgerKey).map InternalFunction.body = some ledgerBody.value :=
  (Option_some ledgerBody).sound _ (by native_decide)
end Inv08.Authority
