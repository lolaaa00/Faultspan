from dataclasses import dataclass
from secrets import token_urlsafe
from time import time
from eth_account import Account
from eth_account.messages import encode_defunct


@dataclass
class Challenge:
    address: str
    message: str
    expires_at: int
    used: bool = False


@dataclass
class Session:
    address: str
    expires_at: int


class WalletAuth:
    """Prototype in-memory nonce/session store.

    Production replacement: a durable store with atomic consume semantics and
    encrypted, revocable sessions. The cryptographic wallet check is real.
    """

    def __init__(self, challenge_ttl_seconds: int = 300, session_ttl_seconds: int = 3_600):
        self.challenge_ttl_seconds = challenge_ttl_seconds
        self.session_ttl_seconds = session_ttl_seconds
        self.challenges: dict[str, Challenge] = {}
        self.sessions: dict[str, Session] = {}

    def issue(self, address: str) -> tuple[str, Challenge]:
        challenge_id = token_urlsafe(24)
        nonce = token_urlsafe(24)
        expires_at = int(time()) + self.challenge_ttl_seconds
        message = (
            "Faultspan authentication\n"
            f"Address: {address.lower()}\n"
            f"Nonce: {nonce}\n"
            f"Expires: {expires_at}\n"
            "Purpose: submit public dispute evidence"
        )
        challenge = Challenge(address=address.lower(), message=message, expires_at=expires_at)
        self.challenges[challenge_id] = challenge
        return challenge_id, challenge

    def verify(self, challenge_id: str, signature: str) -> tuple[str, Session]:
        challenge = self.challenges.get(challenge_id)
        if challenge is None:
            raise ValueError("challenge not found")
        if challenge.used:
            raise ValueError("challenge already used")
        if challenge.expires_at < int(time()):
            raise ValueError("challenge expired")
        recovered = Account.recover_message(encode_defunct(text=challenge.message), signature=signature).lower()
        if recovered != challenge.address:
            raise ValueError("signature does not match challenge address")
        challenge.used = True
        token = token_urlsafe(32)
        session = Session(address=recovered, expires_at=int(time()) + self.session_ttl_seconds)
        self.sessions[token] = session
        return token, session

    def authenticate(self, token: str) -> Session:
        session = self.sessions.get(token)
        if session is None or session.expires_at < int(time()):
            raise ValueError("session is missing or expired")
        return session

