"""Development adapters: explicit receipts, never proof of a live integration."""
from typing import Protocol
from hashlib import sha256


class SignatureAdapter(Protocol):
    def sign(self, digest: str, actor: str) -> dict: ...


class CoreAdapter(Protocol):
    def settle(self, reference: str, amount: str) -> dict: ...


class DevelopmentSignature:
    def sign(self, digest, actor):
        return {"mode": "MOCK", "signed_digest": digest, "actor": actor,
                "reference": "DEV-SIGN-" + sha256((digest+actor).encode()).hexdigest()[:20],
                "notice": "Simulasi pengembangan; bukan tanda tangan PSrE"}


class DevelopmentCore:
    def settle(self, reference, amount):
        return {"mode": "MOCK", "status": "SETTLED", "reference": "DEV-CORE-" + reference,
                "amount": str(amount), "notice": "Bukan posting core banking nyata"}


class UnconfiguredLiveAdapter:
    def __getattr__(self, name):
        raise RuntimeError("Adapter LIVE belum dikonfigurasi dan tidak dapat disimulasikan")
