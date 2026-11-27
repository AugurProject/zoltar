import Inv48SimpleWrapperArgsSource
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.SimpleWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
set_option linter.unusedSimpArgs false

theorem readWordBound (data : List Byte) (offset p : Nat)
    (read : ABI.readWord? data offset = some p) : p < 2^256 := by
  unfold ABI.readWord? at read
  cases chunk : ABI.readBytes? data offset ABI.wordBytes with
  | none => simp [chunk] at read
  | some bytes =>
    simp only [chunk,Option.some.injEq] at read
    subst p
    exact Nat.mod_lt _ (by decide)

theorem decodeUint (lazy : Bool) (data : List Byte) (index : Nat) (v : Value)
    (decoded : ABI.decodeValueAt? lazy data index .uint256 = .ok v) :
    ∃ p, v = .word p ∧ p < 2^256 := by
  simp only [ABI.decodeValueAt?,ABI.Ty.abiDecodeFuel,ABI.decodeValueAtWithFuel?] at decoded
  cases read : ABI.readWord? data (ABI.wordBytes * index) with
  | none => simp [read,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure] at decoded
  | some p =>
    simp [read,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure] at decoded
    exact ⟨p,decoded.symm,readWordBound data _ p read⟩

def threeTypes : List (Bool × Ty) := [(true,.uint256),(true,.uint256),(true,.uint256)]
theorem decodeThree (data : List Byte) (values : List Value)
    (decoded : ABI.decodeArgsWith? threeTypes data = .ok values) :
    ∃ p a b, values = [.word p,.word a,.word b] ∧ p < 2^256 ∧ a < 2^256 ∧ b < 2^256 := by
  simp only [ABI.decodeArgsWith?,threeTypes,List.map_cons,List.map_nil,
    ABI.Ty.listAbiHeadWords?,ABI.Ty.abiHeadWords?,ABI.Ty.isDynamicAbi,
    ABI.Ty.staticAbiHeadWords?,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure] at decoded
  by_cases short : data.length < 96
  · simp [ABI.wordBytes,short] at decoded
  · simp only [ABI.wordBytes,show ¬ data.length < 32 * 3 by simpa using short,
      not_false_eq_true,if_false] at decoded
    cases one : ABI.decodeValueAt? true data 0 .uint256 with
    | error err => simp [short,ABI.decodeArgsAux?,one,Bind.bind,Except.bind,Pure.pure,Except.pure] at decoded
    | ok first =>
      obtain ⟨p,rfl,hp⟩ := decodeUint true data 0 first one
      cases two : ABI.decodeValueAt? true data 1 .uint256 with
      | error err => simp [short,ABI.decodeArgsAux?,one,two,ABI.Ty.abiHeadWords?,
          ABI.Ty.isDynamicAbi,ABI.Ty.staticAbiHeadWords?,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure] at decoded
      | ok second =>
        obtain ⟨a,rfl,ha⟩ := decodeUint true data 1 second two
        cases three : ABI.decodeValueAt? true data 2 .uint256 with
        | error err => simp [short,ABI.decodeArgsAux?,one,two,three,ABI.Ty.abiHeadWords?,
            ABI.Ty.isDynamicAbi,ABI.Ty.staticAbiHeadWords?,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure] at decoded
        | ok third =>
          obtain ⟨b,rfl,hb⟩ := decodeUint true data 2 third three
          simp [short,ABI.decodeArgsAux?,one,two,three,ABI.Ty.abiHeadWords?,
            ABI.Ty.isDynamicAbi,ABI.Ty.staticAbiHeadWords?,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure] at decoded
          exact ⟨p,a,b,decoded.symm,hp,ha,hb⟩

theorem decodedWords (fn : FunctionDef) (found : Inv48.RequestPrologue.publicRequest = some fn)
    (data : List Byte) (values : List Value)
    (decoded : ABI.decodeFunctionArgs? fn data = .ok values) :
    ∃ p a b, values = [.word p,.word a,.word b] ∧ p < 2^256 ∧ a < 2^256 ∧ b < 2^256 := by
  obtain ⟨actual,registered,params,returns,payable,prologue⟩ := Inv48.RequestPrologue.publicRegistered
  have same : actual = fn := Option.some.inj (registered.symm.trans found)
  subst actual
  have cleanups := wrapperCleanups fn found
  have decodeEq : ABI.decodeFunctionArgs? fn data = (do
      let vs ← ABI.decodeArgsWith? threeTypes data
      ABI.abiArgOpt (AbiCleanups.lazyParamValues [.uint 256,.uint 256,.uint 256] vs)) := by
    simp only [ABI.decodeFunctionArgs?,params,cleanups,Inv48.RequestPrologue.quoteParams]
    rfl
  rw [decodeEq] at decoded
  cases decodedArgs : ABI.decodeArgsWith? threeTypes data with
  | error err => simp [decodedArgs,Bind.bind,Except.bind,Pure.pure,Except.pure] at decoded
  | ok vs =>
    obtain ⟨p,a,b,rfl,hp,ha,hb⟩ := decodeThree data vs decodedArgs
    have pn : SolidCore.Solidity.Shared.norm p = p := Nat.mod_eq_of_lt hp
    have an : SolidCore.Solidity.Shared.norm a = a := Nat.mod_eq_of_lt ha
    have bn : SolidCore.Solidity.Shared.norm b = b := Nat.mod_eq_of_lt hb
    simp [decodedArgs,AbiCleanups.lazyParamValues,AbiCleanup.lazyParamValue,
      AbiCleanup.accepts,pn,an,bn,hp,ha,hb,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure,Option.bind,
      show p < 115792089237316195423570985008687907853269984665640564039457584007913129639936 from hp,
      show a < 115792089237316195423570985008687907853269984665640564039457584007913129639936 from ha,
      show b < 115792089237316195423570985008687907853269984665640564039457584007913129639936 from hb] at decoded
    exact ⟨p,a,b,decoded.symm,hp,ha,hb⟩
end Inv48.SimpleWrapperArgs
