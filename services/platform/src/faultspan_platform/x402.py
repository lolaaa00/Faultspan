from eth_account import Account
from eth_account.messages import encode_defunct
from .evidence import canonical_json
from .models import X402Receipt, X402Verification


def receipt_signing_message(receipt: X402Receipt) -> str:
    fields = receipt.model_dump(exclude={"signature"}, mode="json")
    return "Faultspan x402 receipt v1\n" + canonical_json(fields).decode("utf-8")


def verify_receipt(receipt: X402Receipt) -> X402Verification:
    try:
        recovered = Account.recover_message(
            encode_defunct(text=receipt_signing_message(receipt)), signature=receipt.signature
        ).lower()
    except Exception:
        return X402Verification(valid=False, recovered_signer=None, reason="malformed signature")
    if recovered != receipt.signer:
        return X402Verification(valid=False, recovered_signer=recovered, reason="signature does not match signer")
    if receipt.signer not in (receipt.payer, receipt.payee):
        return X402Verification(valid=False, recovered_signer=recovered, reason="signer is not a receipt party")
    return X402Verification(valid=True, recovered_signer=recovered, reason="signature verified")

