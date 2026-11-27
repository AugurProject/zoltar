import Inv48QuoteMemoryCore
import Inv48EscrowTraceCall
open SolidCore.Solidity.Source
namespace Inv48.RequestQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
abbrev R := 2^256
abbrev quoteTuple := Inv48.QuoteMemory.tuple

def types : List Ty := [.address,.address,.uint256,.uint256,.uint256,.uint256,.uint256]
def values (payer sponsor a b h bounty gas : Nat) : List Value :=
  [.word payer,.word sponsor,.word a,.word b,.word h,.word bounty,.word gas]
def payload (payer sponsor a b h bounty gas : Nat) : List Byte :=
  [payer,sponsor,a,b,h,bounty,gas].flatMap (wordToBytesBE wordBytes)

theorem encode (payer sponsor a b h bounty gas : Nat)
    (hp : payer<2^160) (hs : sponsor<2^160) :
    abiEncodeValues? types (values payer sponsor a b h bounty gas) =
      some (payload payer sponsor a b h bounty gas) := by
  have addr (x : Nat) (bound : x<2^160) : abiAddressFits x=true :=
    decide_eq_true (lt_of_le_of_lt (Nat.mod_le _ _) bound)
  simp [types,values,payload,abiEncodeValues?,abiEncodeValuesAux?,Ty.listAbiHeadWords?,
    Ty.abiHeadWords?,Ty.isDynamicAbi,Ty.staticAbiHeadWords?,abiEncodeStaticValue?,
    abiStaticBytes?,addr payer hp,addr sponsor hs,Bind.bind,Option.bind,List.append_assoc]

/-- The actual internal return epilogue preserves the quote reference and shared
memory, restoring the saved caller frame before reference-aware assignment. -/
theorem quoteReturn (fn : InternalFunction) (saved : LocalEnv) (r next : Runtime)
    (id : Nat) (returned : List Value) (target : String)
    (coerce : (if returned.isEmpty then collectReturnBindingsRef fn.returns r
      else coerceReturnBindingsRef fn.returns r returned) = .ok [.memoryRef id])
    (write : ({r with locals := saved}).assignNamedValuesRef? [target] [.memoryRef id] = some next) :
    internalCallFinish fn [target] saved (.returned r returned) = pure (.normal next) := by
  simp only [internalCallFinish,coerce,internalCallAssign,List.isEmpty_cons,Bool.false_eq_true,if_false,write]

#print axioms encode
#print axioms quoteReturn
end Inv48.RequestQuote
