import Inv39SignedMovement
import Inv39CleanParameters
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
structure Payment where
  from_ : Nat
  to_ : Nat
  value : Nat
  validAfter : Nat
  validBefore : Nat
  nonce : Nat
  v : Nat
  r : Nat
  s : Nat
structure Widths (p : Payment) : Prop where
  from_ : p.from_<2^160
  to_ : p.to_<2^160
  value : p.value<R
  after_ : p.validAfter<R
  before_ : p.validBefore<R
  nonce : p.nonce<R
  v : p.v<256
  r : p.r<R
  s : p.s<R
structure Seen (p : Payment) (rt : Runtime) : Prop where
  from_ : rt.lookupLocal? "from"=some (.word p.from_)
  to_ : rt.lookupLocal? "to"=some (.word p.to_)
  value : rt.lookupLocal? "value"=some (.word p.value)
  after_ : rt.lookupLocal? "validAfter"=some (.word p.validAfter)
  before_ : rt.lookupLocal? "validBefore"=some (.word p.validBefore)
  nonce : rt.lookupLocal? "nonce"=some (.fixedBytes 32 p.nonce)
  v : rt.lookupLocal? "v"=some (.word p.v)
  r : rt.lookupLocal? "r"=some (.fixedBytes 32 p.r)
  s : rt.lookupLocal? "s"=some (.fixedBytes 32 p.s)
def signedParams : List BindingDecl := [⟨"from",.address,false⟩,⟨"to",.address,false⟩,⟨"value",.uint256,false⟩,⟨"validAfter",.uint256,false⟩,
  ⟨"validBefore",.uint256,false⟩,⟨"nonce",.fixedBytes 32,false⟩,⟨"v",.uint256,false⟩,⟨"r",.fixedBytes 32,false⟩,⟨"s",.fixedBytes 32,false⟩]
def paramsWithHash := (⟨"typeHash",.fixedBytes 32,false⟩:BindingDecl)::signedParams
def signedFrame (p : Payment) : Frame := [("from",.word p.from_),("to",.word p.to_),("value",.word p.value),("validAfter",.word p.validAfter),
  ("validBefore",.word p.validBefore),("nonce",.fixedBytes 32 p.nonce),("v",.word p.v),("r",.fixedBytes 32 p.r),("s",.fixedBytes 32 p.s)]
def signedArgs (p : Payment) : List Source.Value := [.word p.from_,.word p.to_,.word p.value,.word p.validAfter,.word p.validBefore,.word p.nonce,.word p.v,.word p.r,.word p.s]
def signedPrologue : List Source.Stmt := [.skip,.skip,clean 256 "value",clean 256 "validAfter",clean 256 "validBefore",.skip,clean 8 "v",.skip,.skip]
def signedInner (early late : Source.Expr) (hash sig : Source.Stmt) : Source.Stmt :=
  .block (.skip::(signedPrologue++[.block (.requireStmt early (some "ERC3009 authorization not yet valid")::
    .requireStmt late (some "ERC3009 authorization expired")::(binds++[unusedFlag "from",hash,sig,declFlag "from",logFlag "from" "AuthorizationUsed",motionTail.value]))]))
abbrev signedKey := "__internal__transferWithAuthorization(bytes32,address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)#[SolidCore.Solidity.Ty.bytesN 32,\n SolidCore.Solidity.Ty.address false,\n SolidCore.Solidity.Ty.address false,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.bytesN 32,\n SolidCore.Solidity.Ty.uint 8,\n SolidCore.Solidity.Ty.bytesN 32,\n SolidCore.Solidity.Ty.bytesN 32]"
end Inv39.Auth
